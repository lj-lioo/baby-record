// v1.12.9 日历点击：简介小框＋二次点击；FAB 左下；屏蔽 SW，不写云端
import { chromium } from 'playwright';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const shotDir = path.join(here, '../screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const APP_V = /APP_BUILD = '([^']+)'/.exec(fs.readFileSync(path.join(site, 'js/views/settings.js'), 'utf8'))[1];

function staticServer(root, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return createServer((req, res) => {
    let u = decodeURIComponent((req.url || '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
    const fp = path.join(root, u.replace(/^\//, ''));
    if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  }).listen(port, '127.0.0.1');
}
const APP_PORT = 8109;
const appSrv = staticServer(site, APP_PORT);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('✅', n); } else { fail++; console.log('❌', n); } };

const all = JSON.parse(fs.readFileSync('/tmp/ev.json', 'utf8')).map((e) => ({ ...e, reminders: e.reminders || [], alarmAdded: !!e.alarmAdded }));
await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
await page.evaluate(async (all) => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-09-17', babyName: '朝朝' });
  store.applyRemote({ upserts: all });
}, all);
await page.reload(); await page.waitForTimeout(900);
const day = (d) => page.locator(`.day[data-date="${d}"]`);
const shot = async (n) => { await page.evaluate(() => { const p = document.getElementById('dayPanel'); if (p) window.scrollBy(0, p.getBoundingClientRect().bottom - window.innerHeight + 200); }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(shotDir, n) }); };
check(`版本 ${APP_V}`, APP_V === '1.12.12');
// 1) 有事项（含黄色其他）第一次点 → 小框，不展开不滚
await day('2026-10-30').scrollIntoViewIfNeeded(); const y0 = await page.evaluate(() => window.scrollY);
await day('2026-10-30').evaluate((b) => b.click()); await page.waitForTimeout(400);
check('10/30 首点出现小框', await page.locator('#dayPanel').isVisible());
check('小框 2 条（K1+13价）', await page.locator('#dayPanel .dp-row').count() === 2);
check('首点不展开待完成', await page.locator('#pendBody').isHidden());
{ const y1 = await page.evaluate(() => window.scrollY); check(`首点不滚动 ${y0}->${y1}`, Math.abs(y1 - y0) < 30); }
await shot('61-daypanel-1030.png');
{ const ds = await page.locator('#dayPanel .dp-row .dot').evaluateAll((a) => a.map((d) => { const r = d.getBoundingClientRect(); return { c: d.className, w: r.width, bg: getComputedStyle(d).backgroundColor }; }));
  check(`10/30 每行色点都可见 ${JSON.stringify(ds.map((d) => d.w))}`, ds.length === 2 && ds.every((d) => d.w >= 7 && d.bg !== 'rgba(0, 0, 0, 0)'));
  check('含自费疫苗色点', ds.some((d) => d.c.includes('cat-paidvax'))); }
// 四类色点：注入长标题样例逐类检查宽度
{ const r = await page.evaluate(() => { const box = document.createElement('ul'); box.className = 'dp-list'; box.style.width = '300px'; document.getElementById('dayPanel').appendChild(box);
    box.innerHTML = ['vaccine', 'paidvax', 'checkup', 'other'].map((c) => `<li class="dp-row"><i class="dot cat-${c}"></i><span class="dp-t">很长很长的标题很长很长的标题很长很长的标题<small class="dp-w">🪟 2026年10月29日 – 2027年4月16日（最迟）</small></span><span class="dp-time">09:00</span><span class="dp-st ok">✅已完成</span></li>`).join('');
    const out = [...box.querySelectorAll('.dot')].map((d) => d.getBoundingClientRect().width); box.remove(); return out; });
  check(`四类色点长标题下宽度≥7 ${JSON.stringify(r)}`, r.every((w) => w >= 7)); }
// 点某条 → 详情面板
await page.locator('#dayPanel .dp-row').first().click(); await page.waitForTimeout(400);
check('点条目弹出详情面板', await page.locator('#sheet .ev-detail').isVisible());
await page.locator('#sheetBackdrop').click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(300);
// 2) 再点同一天 → 展开并滚动到该天卡片
await day('2026-10-30').evaluate((b) => b.click()); await page.waitForTimeout(900);
check('二次点展开待完成', await page.locator('#pendBody').isVisible());
check('二次点滚动到下方', await page.evaluate(() => window.scrollY) > y0 + 100);
// 黄色其他（已完成）10/14
await page.evaluate(() => window.scrollTo(0, 0));
await day('2026-10-14').click(); await page.waitForTimeout(400);
check('10/14 其他事项也出小框', await page.locator('#dayPanel').isVisible() && (await page.locator('#dayPanel').innerText()).includes('RSV'));
check('已完成状态显示', (await page.locator('#dayPanel').innerText()).includes('已完成'));
// 3) 空白日第一次 → 只选中
await day('2026-10-27').click(); await page.waitForTimeout(400);
check('空白日首点选中', await day('2026-10-27').evaluate((b) => b.classList.contains('selected')));
check('空白日首点无小框', await page.locator('#dayPanel').count() === 0);
check('空白日首点无弹窗', await page.locator('#sheet').isHidden());
// 4) 空白日再点 → 添加事项预填
await day('2026-10-27').click(); await page.waitForTimeout(500);
check('空白日二次点弹添加表单', await page.locator('#sheet').isVisible());
check('预填日期', await page.locator('#sheet input[type=date]').first().inputValue() === '2026-10-27');
await page.locator('#sheetBackdrop').click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(300);
// × 关闭、切月关闭
await page.evaluate(() => window.scrollTo(0, 0));
await day('2026-10-30').click(); await page.waitForTimeout(300);
await page.locator('#dpX').click(); await page.waitForTimeout(300);
check('× 关闭小框', await page.locator('#dayPanel').count() === 0);
for (let i = 0; i < 3; i++) { await page.locator('#nextM').click(); await page.waitForTimeout(250); }
check('切月后无小框', await page.locator('#dayPanel').count() === 0);
await day('2027-01-17').click(); await page.waitForTimeout(400);
check('1/17 小框只剩五联（脊灰/百白破被替代不列）', await page.locator('#dayPanel .dp-row').count() === 1 && (await page.locator('#dayPanel').innerText()).includes('五联'));
await shot('62-daypanel-0117.png');
// v1.12.12：无浮动＋；空日子不在列表生成占位框
check('无浮动＋', await page.locator('#fab, .fab').count() === 0);
check('列表无「这一天还没有安排」', !(await page.locator('body').innerText()).includes('这一天还没有安排'));
{ const gd = await page.locator('#g-done').count();
  if (gd) { const bg = await page.locator('#g-done').evaluate((n) => getComputedStyle(n).backgroundColor + '|' + getComputedStyle(n).boxShadow); check(`已完成板块无灰底 (${bg})`, bg.startsWith('rgba(0, 0, 0, 0)') && bg.endsWith('none')); } else check('已完成板块无灰底（本月无已完成，跳过）', true); }
check('保留月标题＋添加', await page.locator('#addHere').count() === 1);
// 被自费替代的免费剂次：日历/小框/列表完全不显示
const reps = await page.evaluate(async () => { const { store } = await import('./js/store.js'); const { replacementHints } = await import('./js/paidvax.js'); const h = replacementHints(store.events()); return store.events().filter((e) => e.category === 'vaccine' && !e.done && h.get(e.scheduleId)).map((e) => ({ id: e.id, date: e.date, title: e.title })); });
console.log('被替代剂次', reps.map((r) => r.date + ' ' + r.title).join(' | '));
check('fixture 有被替代剂次', reps.length > 0);
await page.reload(); await page.waitForTimeout(800);
check('图例无「已被自费替代」', !(await page.locator('#calCard, .legend2').first().innerText()).includes('替代'));
let leak = 0;
for (let i = 0; i < 4; i++) {
  leak += await page.locator('.vbadge.replaced, .day.has-replaced').count();
  for (const r of reps) if (await page.locator(`[data-id="${r.id}"], [data-dp="${r.id}"]`).count()) leak++;
  if (i === 0) { await page.evaluate(() => { const b = document.getElementById('prevM'); b.click(); }); await page.waitForTimeout(250); await shot('63-no-replaced-sep.png'); await page.locator('#nextM').click(); await page.waitForTimeout(250); }
  await page.locator('#nextM').click(); await page.waitForTimeout(250);
  if (i === 0) await shot('64-no-replaced-nov.png');
}
check('9–12 月日历/列表无被替代标记', leak === 0);
const r0 = reps[0];
if (r0) { await page.reload(); await page.waitForTimeout(700);
  while (!(await page.locator(`.day[data-date="${r0.date}"]:not(.other-month)`).count())) { await page.locator('#nextM').click(); await page.waitForTimeout(200); }
  await page.locator(`.day[data-date="${r0.date}"]:not(.other-month)`).evaluate((b) => b.click()); await page.waitForTimeout(300);
  const t = (await page.locator('#dayPanel').count()) ? await page.locator('#dayPanel').innerText() : '';
  check(`当天小框不列 ${r0.title}`, !t.includes(r0.title)); }
check('免费疫苗合集卡仍显示「已被…替代」', (await page.locator('#freeVaxCard').innerText()).includes('替代') || (await page.locator('#freeVaxCard').innerHTML()).includes('替代'));
check('无页面 JS 错误', errors.length === 0);
console.log(`daypanel-ui ${pass} pass, ${fail} fail`);
await browser.close(); appSrv.close(); process.exit(fail ? 1 : 0);
