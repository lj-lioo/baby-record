// 生长记录 UI：列表 / 曲线 / 添加；v1.12.0 用药记录 UI；截图 53
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
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = 0, fail = 0;
async function check(name, cond) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name); }
}

await page.goto(`http://127.0.0.1:${APP_PORT}/`);
const csv = fs.readFileSync('/tmp/growth.csv', 'utf8').trim().split('\n');
const meds = JSON.parse(fs.readFileSync('/tmp/meds.json', 'utf8'));
await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
await page.evaluate(async ({ csv, meds }) => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-09-17', babyName: '朝朝' });
  for (const l of csv) { const [date, weight, height, head, note] = l.split(','); store.upsertGrowth({ date, weight, height, head, note }); }
  for (const m of meds) store.upsertMed(m);
}, { csv, meds });
await page.goto(`http://127.0.0.1:${APP_PORT}/#/growth`);
await page.waitForTimeout(700);
await check('生长列表 33 条', await page.locator('.gr-card').count() === 33);
await check('用药卡在生长列表下方', await page.locator('#grBody + #medsCard').count() === 1);
await check('在用 3 条排上面', await page.locator('.md-row.on').count() === 3 && await page.locator('.md-row').first().evaluate((e) => e.classList.contains('on')));
await check('共 7 条', await page.locator('.md-row').count() === 7);
const txt = await page.locator('#medsCard').innerText();
await check('单次显示', txt.includes('9月17日 · 单次'));
await check('至今显示', txt.includes('至今'));
// 编辑：给 AD 加备注
await page.locator('.md-row', { hasText: '维生素AD' }).click();
await page.fill('#md-note', '测试备注');
await page.click('#mdSave');
await page.waitForTimeout(300);
await check('编辑保存', (await page.locator('#medsCard').innerText()).includes('测试备注'));
// 新增 + 删除
await page.click('#btnAddMed');
await page.fill('#md-name', '临时药');
await page.click('#mdSave');
await page.waitForTimeout(300);
await check('新增', await page.locator('.md-row').count() === 8);
await page.locator('.md-row', { hasText: '临时药' }).click();
await page.click('#mdDel');
await page.waitForTimeout(300);
await page.locator('.sheet button.danger, button:has-text("删除")').last().click();
await page.waitForTimeout(400);
await check('删除', await page.locator('.md-row').count() === 7);
// 出生记录无身长时也可编辑保存
await page.locator('.gr-card', { hasText: '2026-09-17' }).click();
await page.click('#grSave');
await page.waitForTimeout(300);
await check('仅体重可保存', await page.locator('#grErr').isHidden().catch(() => true));
await page.click('.gr-tab[data-tab=weight]');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(shotDir, '53-growth-meds.png'), fullPage: true });
await check('无页面错误', errors.length === 0);
console.log(`版本 ${APP_V}：${pass} 通过，${fail} 失败`, errors);
await browser.close(); appSrv.close();
process.exit(fail ? 1 : 0);
