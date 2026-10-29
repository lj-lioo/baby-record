// v1.9.3 宝宝名字 + 已出生日龄：首页标题 / 设置资料 / 编辑弹层；截图 43–44
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

const APP_PORT = 8097;
const appSrv = staticServer(site, APP_PORT);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => {
  localStorage.setItem('babyrecord.hideBanner', '1');
  localStorage.setItem('babyrecord.hideChkCta', '1');
});
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-10-29T12:00:00+08:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = 0, fail = 0;
async function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name, extra); }
  else { fail++; console.log('❌', name, extra); }
}

await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(500);

await check('版本 1.9.3', APP_V === '1.9.3');
await check('未设置时标题占位「宝宝记录」', (await page.locator('#btnBabyProfile h1').innerText()) === '宝宝记录');
await check('未设置提示点此设置生日', (await page.locator('#btnBabyProfile .sub').innerText()).includes('点此设置生日'));

await page.click('#btnBabyProfile');
await page.waitForTimeout(300);
await check('弹层标题', (await page.locator('#sheet h3').innerText()) === '宝宝资料');
await page.fill('#bp-name', '豆豆');
await page.fill('#bp-bday', '2026-10-20');
await page.click('#sheet [data-a=save]');
await page.waitForTimeout(500);

await check('标题变名字', (await page.locator('#btnBabyProfile h1').innerText()) === '豆豆');
const sub = await page.locator('#btnBabyProfile .sub').innerText();
await check('已出生第10天（10/20→10/29，出生当天第1天）', sub.includes('已出生第10天'), sub);
await page.screenshot({ path: path.join(shotDir, '43-home-baby-name.png'), fullPage: false });

await page.click('a[data-tab=settings]');
await page.waitForTimeout(400);
await check('设置页资料卡', await page.locator('#babyProfileCard').count() === 1);
await check('设置显示名字', (await page.locator('#babyProfileCard').innerText()).includes('豆豆'));
await check('设置显示生日', (await page.locator('#babyProfileCard').innerText()).includes('2026'));
await check('页脚版本', (await page.locator('#appVer').innerText()).includes('v1.9.3'));
await page.screenshot({ path: path.join(shotDir, '44-settings-baby-profile.png'), fullPage: false });

// 出生当天＝第1天
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-10-29' });
});
await page.click('a[data-tab=home]');
await page.waitForTimeout(400);
const sub1 = await page.locator('#btnBabyProfile .sub').innerText();
await check('出生当天第1天', sub1.includes('已出生第1天'), sub1);

await check('无页面错误', errors.length === 0, errors.join('; '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
appSrv.close();
process.exit(fail ? 1 : 0);
