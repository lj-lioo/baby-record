// v1.12.15 相册分组：主标题日期 + 次要「第X天」，无 N 项；屏蔽 SW，不写云端、不打印密钥
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

const APP_PORT = 8114;
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

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
const bday = '2026-09-17';

await page.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await page.waitForTimeout(500);

const unit = await page.evaluate(async (bday) => {
  const { dayNumberOnDate, fmtAlbumDayTitle, fmtDayTitle } = await import('./js/photos.js');
  return {
    d1: dayNumberOnDate(bday, '2026-09-17'),
    d41: dayNumberOnDate(bday, '2026-10-27'),
    d42: dayNumberOnDate(bday, '2026-10-28'),
    noB: fmtAlbumDayTitle('2026-10-27', '') === fmtDayTitle('2026-10-27'),
    t41: fmtAlbumDayTitle('2026-10-27', bday),
    t42: fmtAlbumDayTitle('2026-10-28', bday),
  };
}, bday);
check('出生当天第1天', unit.d1 === 1);
check('10/27 第41天', unit.d41 === 41);
check('10/28 第42天', unit.d42 === 42);
check('无生日不加天数', unit.noB);
check(`标题含第41天 (${unit.t41})`, unit.t41.includes('第41天') && unit.t41.includes('10月27日'));
check(`昨天标题 (${unit.t42})`, unit.t42.includes('第42天')); // 相对词依赖「今天」

await page.evaluate(async ({ thumb, bday }) => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: bday, babyName: '朝朝' });
  const mk = (id, ymd, note) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const takenAt = new Date(y, m - 1, d, 10, 30).getTime();
    return { id, takenAt, uploadedAt: takenAt, note, mime: 'image/jpeg', size: 1200, width: 1, height: 1, thumbData: thumb, kind: 'photo', remoteReady: false, createdAt: takenAt, updatedAt: takenAt };
  };
  store.applyRemote({
    photosUpserts: [
      mk('ph:demo28', '2026-10-28', '示例·昨天'),
      mk('ph:demo27', '2026-10-27', '示例·前天'),
    ],
  });
}, { thumb: THUMB, bday });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await page.waitForTimeout(800);

const titles = await page.locator('.album-day-title').allTextContents();
const joined = titles.join(' | ');
check(`分组标题含第42天 (${joined})`, titles.some((t) => t.includes('第42天')));
check('分组标题含第41天', titles.some((t) => t.includes('第41天')));
check('昨天+第42天同组', titles.some((t) => /昨天\s*第42天/.test(t)));
check('10月27日+第41天', titles.some((t) => /10月27日\s*第41天/.test(t)));
check('无「N 项」计数', !titles.some((t) => /\d+\s*项/.test(t)));
const ageCls = await page.locator('.album-day-age').count();
check(`第X天用次要样式 .album-day-age (${ageCls})`, ageCls >= 2);
const ageSmall = await page.locator('.album-day-age').first().evaluate((el) => {
  const s = getComputedStyle(el);
  const h2 = getComputedStyle(el.parentElement);
  return { ageFs: parseFloat(s.fontSize), titleFs: parseFloat(h2.fontSize), muted: s.color !== h2.color || el.classList.contains('muted') };
});
check(`第X天字号小于标题 (${ageSmall.ageFs}<${ageSmall.titleFs})`, ageSmall.ageFs < ageSmall.titleFs && ageSmall.muted);
check(`版本 ${APP_V}`, APP_V === '1.12.15');

await page.screenshot({ path: path.join(shotDir, '69-album-day-age-small.png'), fullPage: true });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`);
await page.waitForTimeout(500);
const ver = await page.locator('#appVer').innerText();
check(`设置页版本 ${ver}`, ver.includes('v1.12.15'));
await page.screenshot({ path: path.join(shotDir, '70-settings-v1.12.15.png'), fullPage: true });

check('无页面 JS 错误', errors.length === 0);
if (errors.length) console.log(errors);

console.log(`\nalbum-day-ui ${pass} pass, ${fail} fail`);
await browser.close();
appSrv.close();
process.exit(fail ? 1 : 0);
