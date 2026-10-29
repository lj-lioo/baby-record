// 生长记录 UI：列表 / 曲线 / 添加；截图 38–41
import { chromium } from 'playwright';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const shotDir = path.join(here, '../screenshots');
fs.mkdirSync(shotDir, { recursive: true });

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

const APP_PORT = 8096;
const appSrv = staticServer(site, APP_PORT);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
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

await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
// 在已加载的 store 上设生日（只改 localStorage 不会刷新内存态）
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-09-17', babyName: '朝朝' });
});
await page.goto(`http://127.0.0.1:${APP_PORT}/#/growth`);
await page.waitForTimeout(700);

await check('生长页标题', await page.locator('h1').innerText() === '生长记录');
await check('底部生长 Tab', await page.locator('#tabbar a[data-tab=growth]').count() === 1);
await check('四个子 Tab', await page.locator('.gr-tab').count() === 4);
await check('空态', (await page.locator('.album-empty').count()) === 1 || (await page.innerText('body')).includes('还没有生长记录'));
await page.screenshot({ path: path.join(shotDir, '38-growth-empty.png'), fullPage: true });

await page.click('#btnAddGrowth');
await page.waitForTimeout(400);
await page.fill('#gr-date', '2026-09-17');
await page.fill('#gr-h', '49');
await page.fill('#gr-w', '2.8');
await page.click('#grSave');
await page.waitForTimeout(500);

await page.click('#btnAddGrowth');
await page.waitForTimeout(300);
await page.fill('#gr-date', '2026-10-18');
await page.fill('#gr-h', '53.5');
await page.fill('#gr-w', '4.2');
await page.fill('#gr-hd', '37.6');
await page.click('#grSave');
await page.waitForTimeout(500);

await check('两条记录', await page.locator('.gr-card').count() === 2);
const body = await page.locator('#grBody').innerText();
await check('显示日龄第1天', body.includes('第1天'));
await check('显示1个月1天', body.includes('1个月1天'));
await check('相对上次', body.includes('相对上次') || body.includes('身高'));
await page.screenshot({ path: path.join(shotDir, '39-growth-list.png'), fullPage: true });

await page.click('.gr-tab[data-tab=height]');
await page.waitForTimeout(400);
await check('身高曲线 SVG', await page.locator('.gr-chart svg polyline').count() === 1);
await page.screenshot({ path: path.join(shotDir, '40-growth-height-chart.png'), fullPage: true });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/help`);
await page.waitForTimeout(400);
await check('帮助有生长章节', await page.locator('#h-growth').count() === 1);
await page.locator('#h-growth').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(shotDir, '41-help-growth.png') });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`);
await page.waitForTimeout(400);
const v = await page.locator('#appVer').innerText();
await check('版本 1.9.0', v.includes('v1.9.0'));

await check('无页面 JS 错误', errors.length === 0);
if (errors.length) console.log(errors);

console.log(`\ngrowth-ui ${pass} pass, ${fail} fail`);
await browser.close();
appSrv.close();
process.exit(fail ? 1 : 0);
