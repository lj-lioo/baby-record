// 升级路径测试：旧版本 Service Worker（缓存里是旧 JS）→ v1.4.1，确认最多「关闭再打开」一次就是新界面。
// 准备：mkdir -p /tmp/swtest/v120 /tmp/swtest/v140 && git archive 0c01f7d site | tar -x -C /tmp/swtest/v120 && git archive 304e87b site | tar -x -C /tmp/swtest/v140
//       echo '/tmp/swtest/v120/site|0|600' > /tmp/swtest/mode && python3 test/sw-upgrade-server.py &   （:8091，可切换目录 + 模拟 GitHub Pages 的 max-age=600）
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'http://127.0.0.1:8091/';
const NEW = process.env.NEW_SITE || '/workspace/baby-app/site';
const setMode = (root, html, js) => fs.writeFileSync('/tmp/swtest/mode', `${root}|${html}|${js}\n`);
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
const errors = [];

async function open(ctx, label) {
  const page = await ctx.newPage();
  let navs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(BASE);
  await sleep(4000);                       // 等 SW 检查更新 / 安装 / 接管（以及可能的自动刷新）
  const reloads = navs - 1;
  const dbg = await page.evaluate(() => ({ inline: document.documentElement.innerHTML.includes('br-sw-reload'), ctl: navigator.serviceWorker.controller?.scriptURL || '' }));
  await page.evaluate(() => { location.hash = '#/settings'; });
  await sleep(700);
  const st = await page.evaluate(async () => {
    const txt = document.getElementById('view')?.innerText || '';
    const reg = await navigator.serviceWorker.getRegistration();
    const sw = reg && reg.active ? reg.active.scriptURL : '';
    const keys = await caches.keys();
    return { plan: txt.includes('一键生成日程'), chk: !!document.getElementById('btnChk'), sync: !!document.getElementById('syncCard'),
      oldVax: txt.includes('💉 疫苗计划'), footer: (txt.match(/宝宝记录 v[^\n]*/) || [''])[0], caches: keys.join(','), controlled: !!navigator.serviceWorker.controller };
  });
  st.navs = reloads; st.dbg = dbg;
  console.log(`   [${label}] reloads=${reloads} inline=${dbg.inline} footer="${st.footer}" plan=${st.plan} chk=${st.chk} sync=${st.sync} oldVax=${st.oldVax} caches=${st.caches}`);
  return { page, st };
}
const isNew = (st) => st.plan && st.chk && st.sync && st.footer.startsWith('宝宝记录 v1.4.1');

async function staleState(label, htmlB = 0) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  setMode('/tmp/swtest/v120/site', 0, 600);   // 页面/config.js 每次向服务器确认，JS 按 GitHub Pages 缓存 10 分钟
  let r = await open(ctx, `${label} v1.2.0 首次`); await r.page.close();
  r = await open(ctx, `${label} v1.2.0 再开`); await r.page.close();
  // 部署 v1.4.0：页面和 config.js 已过期（max-age 0），JS 还在浏览器 HTTP 缓存里（max-age=600）
  setMode('/tmp/swtest/v140/site', htmlB, 600);
  r = await open(ctx, `${label} 部署 v1.4.0 后第1次`); await r.page.close();
  r = await open(ctx, `${label} 部署 v1.4.0 后第2次`); await r.page.close();
  return { ctx, st: r.st };
}

// 1) 复现：v1.4.0 SW 缓存里是旧 JS
{
  const { ctx, st } = await staleState('复现');
  ok('复现问题：页脚 v1.4.0，但设置页还是旧「💉 疫苗计划」，没有体检和云同步', st.footer.includes('v1.4.0') && st.oldVax && !st.chk && !st.sync, st.footer);
  await ctx.close();
}

// 2) 升级到 v1.4.1（最坏情况：页面也在 HTTP 缓存里 max-age=600）
for (const [variant, html] of [['页面已过期', 0], ['页面仍在HTTP缓存(max-age=600)', 600]]) {
  const { ctx } = await staleState(variant, html);
  setMode(NEW, html, 600);
  const r1 = await open(ctx, `${variant} 部署 v1.4.1 后第1次打开`);
  const first = isNew(r1.st);
  await r1.page.close();
  const r2 = await open(ctx, `${variant} 关闭再打开`);
  ok(`${variant}：最多关闭再打开一次就是新界面（第1次打开${first ? '就已' : '未'}更新）`, isNew(r2.st) && (html === 600 || first), `第1次=${first} 第2次=${isNew(r2.st)}`);
  ok(`${variant}：没有刷新循环（每次打开最多 1 次自动刷新）`, r1.st.navs <= 1 && r2.st.navs <= 1, `navs=${r1.st.navs},${r2.st.navs}`);
  ok(`${variant}：只剩 v1.4.1 缓存`, r2.st.caches === 'baby-record-v1.4.1', r2.st.caches);
  // 离线：断网后重新打开仍可使用
  await ctx.setOffline(true);
  const r3 = await open(ctx, `${variant} 断网再打开`);
  ok(`${variant}：断网仍能打开，设置页是新界面`, isNew(r3.st), r3.st.footer);
  await ctx.setOffline(false);
  await r2.page.close(); await r3.page.close();
  await ctx.close();
}

// 3) 全新安装：不自动刷新
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  setMode(NEW, 600, 600);
  const r = await open(ctx, '全新安装');
  ok('全新安装：直接是新界面，不自动刷新', isNew(r.st) && r.st.navs === 0, `navs=${r.st.navs}`);
  // 之后 JS 在服务器上改了（没改版本号、HTTP 缓存还没过期）：网络优先 + no-cache，下次打开就拿到
  await r.page.close();
  fs.rmSync('/tmp/swtest/v141b', { recursive: true, force: true });
  fs.cpSync(NEW, '/tmp/swtest/v141b/site', { recursive: true });
  const f = '/tmp/swtest/v141b/site/js/views/settings.js';
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('宝宝记录 v${esc(APP_BUILD)}', '宝宝记录 v${esc(APP_BUILD)} 热修复'));
  setMode('/tmp/swtest/v141b/site', 600, 600);
  const r2 = await open(ctx, '服务器上 JS 改了');
  ok('JS 在服务器上更新后（不改版本号），下次打开就是新 JS', r2.st.footer.includes('热修复'), r2.st.footer);
  await ctx.close();
}
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
