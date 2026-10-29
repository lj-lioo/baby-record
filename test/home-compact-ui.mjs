// v1.12.4 日程卡片详情折叠 + 近期提醒详情面板 + 待完成/已完成分组；截图 55/56（屏蔽 SW，仅本机数据）
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
    let u = decodeURIComponent((req.url || '/').split('?')[0]);
    if (u.endsWith('/')) u += 'index.html';
    const fp = path.join(root, u.replace(/^\//, ''));
    if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  }).listen(port, '127.0.0.1');
}

const APP_PORT = 8099;
const appSrv = staticServer(site, APP_PORT);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = 0, fail = 0;
async function check(name, cond) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name); }
}



const all = JSON.parse(fs.readFileSync('/tmp/ev.json', 'utf8')).map((e) => ({ ...e, reminders: e.reminders || [], alarmAdded: false }));
await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
await page.evaluate(async (all) => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-09-17', babyName: '朝朝' });
  store.applyRemote({ upserts: all });
}, all);
await page.reload(); await page.waitForTimeout(800);
const pend = await page.locator('#pendFold').innerText();
await check('待完成分组 ' + pend.trim(), /待完成（\d+）/.test(pend));
await check('待完成默认收起', await page.locator('#pendBody').isHidden());
const df0 = page.locator('#doneFold');
if (await df0.count()) await check('已完成默认收起', await page.locator('#doneFoldBody').isHidden());
await page.click('#pendFold'); await page.waitForTimeout(300);
await check('点标题展开待完成', await page.locator('#pendBody').isVisible());
const withNote = page.locator('.item:has(.det-toggle)').first();
await check('有「显示详情 ▾」', (await withNote.locator('.det-toggle').innerText()).includes('显示详情'));
await check('详情默认隐藏', await withNote.locator('.idetails').isHidden());
await check('卡片里看不到📝', !(await page.locator('#pendBody').innerText()).includes('📝'));
await check('操作按钮仍在', await withNote.locator('[data-act=edit]').count() === 1 && await withNote.locator('[data-act=ics]').count() === 1);
await page.evaluate(() => { const el = document.getElementById('pendFold'); const y = el.getBoundingClientRect().top + window.scrollY - 70; window.scrollTo(0, y); document.scrollingElement.scrollTop = y; document.querySelector('main, #view')?.scrollTo?.(0, y); }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shotDir, '55-home-compact.png'), fullPage: false });
const id = await withNote.getAttribute('data-id');
await withNote.locator('.det-toggle').click(); await page.waitForTimeout(300);
const c2 = page.locator(`.item[data-id="${id}"]`);
await check('点开显示详情', await c2.locator('.idetails').isVisible() && (await c2.locator('.det-toggle').innerText()).includes('收起'));
await c2.locator('.det-toggle').click(); await page.waitForTimeout(300);
await check('再点收起', await page.locator(`.item[data-id="${id}"] .idetails`).isHidden());
await page.click('#pendFold'); await page.waitForTimeout(300);
await check('再点标题收起待完成', await page.locator('#pendBody').isHidden());
await page.click('#pendFold'); await page.waitForTimeout(300);
const df = page.locator('#doneFold');
if (await df.count()) {
  await check('已完成（N）标题', /已完成（\d+）/.test(await df.innerText()));
}
// 近期提醒 → 详情面板
const r = page.locator('.ritem').first();
await check('近期提醒有项', await r.count() === 1);
await r.click(); await page.waitForTimeout(400);
await check('弹出详情面板', await page.locator('#sheet .ev-detail').isVisible());
await check('面板不是编辑器、无改日期', await page.locator('#sheet input[type=date]').count() === 0 && !(await page.locator('#sheet').innerText()).includes('改计划日'));
await check('面板有已完成与闹钟按钮', await page.locator('#evdDone').count() === 1 && await page.locator('#evdAlarm').count() === 1);
await page.screenshot({ path: path.join(shotDir, '56-reminder-detail.png'), fullPage: false });
await page.locator('#sheetBackdrop').click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(300);
await check('点遮罩关闭', await page.locator('#sheet').isHidden());
const tabs = await page.locator('#tabbar a').allInnerTexts();
await check('底部导航顺序 ' + tabs.map((t) => t.replace(/\s+/g, '')).join('/'), tabs.map((t) => t.replace(/[^\u4e00-\u9fa5]/g, '')).join('/') === '日程/生长/相册/设置/帮助');
await check('无页面错误 ' + errors.join(';'), errors.length === 0);
await browser.close(); appSrv.close();
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
