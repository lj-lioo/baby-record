// v1.11.0 一句话记事 UI
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
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => { localStorage.setItem('babyrecord.hideBanner', '1'); localStorage.setItem('babyrecord.hideChkCta', '1'); });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-10-29T10:00:00+08:00') });
let pass = 0, fail = 0; const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? '✅' : '❌', n, x); };
await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
await page.evaluate(async () => { const { store } = await import('./js/store.js'); store.updateSettings({ babyName: '朝朝', babyBirthday: '2026-09-17' }); });
await page.waitForTimeout(300);
check('首页有语音入口', await page.locator('#btnVoice').isVisible());
await page.screenshot({ path: path.join(shotDir, '52-voice-entry.png') });
await page.click('#btnVoice'); await page.waitForTimeout(200);
check('输入框自动聚焦', await page.evaluate(() => document.activeElement && document.activeElement.id === 'v-text'));
check('提示键盘话筒', (await page.locator('#sheet').innerText()).includes('点键盘上的'));
check('Chromium headless 支持 webkitSpeechRecognition 时显示按住说话（否则隐藏）', await page.evaluate(() => { const b = document.querySelector('#v-hold'); return !!(window.SpeechRecognition || window.webkitSpeechRecognition) === !b.hidden; }));
await page.fill('#v-text', '11月5号买奶粉');
await page.waitForTimeout(400);
check('解析一张卡', await page.locator('.v-card').count() === 1);
check('标题', await page.locator('.v-title').inputValue() === '买奶粉');
check('日期', await page.locator('.v-date').inputValue() === '2026-11-05');
await page.screenshot({ path: path.join(shotDir, '52-voice-confirm.png') });
await page.fill('#v-text', '11月5号买奶粉。下周六上午10点打疫苗\n周三体检');
await page.waitForTimeout(400);
check('多句 3 张卡', await page.locator('.v-card').count() === 3);
check('按钮显示条数', (await page.locator('#v-save').innerText()).includes('3条'));
check('第2条时间', await page.locator('.v-time').nth(1).inputValue() === '10:00');
check('第2条分类疫苗', await page.locator('.v-cat').nth(1).inputValue() === 'vaccine');
await page.locator('.v-title').nth(0).fill('买奶粉两罐');
await page.locator('.v-date').nth(0).fill('2026-11-06'); await page.locator('.v-date').nth(0).dispatchEvent('change');
await page.screenshot({ path: path.join(shotDir, '52-voice-multi.png') });
await page.locator('.v-del').nth(2).click();
check('删掉一条剩 2', await page.locator('.v-card').count() === 2);
await page.click('#v-save'); await page.waitForTimeout(300);
const evs = await page.evaluate(async () => { const { store } = await import('./js/store.js'); return store.events().map((e) => [e.title, e.date, e.time, e.category]); });
check('保存改过的标题/日期', evs.some((e) => e[0] === '买奶粉两罐' && e[1] === '2026-11-06'), JSON.stringify(evs));
check('保存疫苗 11/7 10:00', evs.some((e) => e[0] === '打疫苗' && e[1] === '2026-11-07' && e[2] === '10:00' && e[3] === 'vaccine'));
check('只存 2 条', evs.length === 2);
await page.goto(`http://127.0.0.1:${APP_PORT}/#help`); await page.waitForTimeout(400);
const help = await page.locator('#h-voice').innerText().catch(() => '');
check('帮助页说明', help.includes('启用听写') && help.includes('华为'));
await page.locator('#h-voice').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(shotDir, '52-voice-help.png') });
await page.goto(`http://127.0.0.1:${APP_PORT}/#settings`); await page.waitForTimeout(300);
check(`版本 ${APP_V}`, /^1\.1[1-9]\./.test(APP_V) && (await page.content()).includes(APP_V));
check('无页面错误', errors.length === 0, errors.join(' | '));
console.log(`\n${pass}/${pass + fail} passed`);
await browser.close(); appSrv.close();
process.exit(fail ? 1 : 0);
