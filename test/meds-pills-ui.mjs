// v1.12.3 用药：频次排序 + K1 药丸进度联动日历；截图 54（屏蔽 SW，仅本机 localStorage，不连云端）
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

const APP_PORT = 8098;
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


const k1 = JSON.parse(fs.readFileSync('/tmp/k1ev.json', 'utf8')).map((e) => ({ ...e, reminders: [], alarmAdded: false }));
const meds = [
  { name: '维生素K1', dose: '注射', start: '2026-09-17', end: '2026-09-17' },
  { name: '维生素AD', dose: '一天一粒', start: '2026-09-21', end: '' },
  { name: '维生素K1（口服）', dose: '一周 1 毫克', start: '2026-10-16', end: '', series: 'vitk' },
  { name: '益生菌', dose: '一天两袋', start: '2026-10-05', end: '' },
];
await page.goto(`http://127.0.0.1:${APP_PORT}/`);
await page.waitForTimeout(400);
await page.evaluate(async ({ k1, meds }) => {
  const { store } = await import('./js/store.js');
  store.updateSettings({ babyBirthday: '2026-09-17', babyName: '朝朝' });
  store.applyRemote({ upserts: k1 });
  for (const m of meds) store.upsertMed(m);
}, { k1, meds });
await page.goto(`http://127.0.0.1:${APP_PORT}/#/growth`);
await page.waitForTimeout(700);
const order = await page.locator('.md-row.on .md-name').allInnerTexts();
await check('在用顺序 AD→益生菌→K1口服 ' + order.join('/'), order.join('/') === '维生素AD/益生菌/维生素K1（口服）');
const k1row = page.locator('.md-row', { hasText: '维生素K1（口服）' });
await check('10 颗药丸', await k1row.locator('.md-pill').count() === 10);
await check('亮 3 颗', await k1row.locator('.md-pill.on').count() === 3);
await check('文案 已用 3/共 10 次', (await k1row.innerText()).includes('已用 3/共 10 次'));
await check('注射 K1 无药丸', await page.locator('.md-row', { hasText: '注射' }).locator('.md-pill').count() === 0);
const f = await page.evaluate(async () => {
  const g = await import('./js/growth.js');
  return [g.medFreqRank({ dose: '一天一粒' }), g.medFreqRank({ dose: '一天两袋' }), g.medFreqRank({ dose: '一周 1 毫克' }), g.medFreqRank({ dose: '每月一次' }), g.medFreqRank({ dose: '' })];
});
await check('频次识别 ' + f, f.join() === '0,0,2,3,1');
await page.screenshot({ path: path.join(shotDir, '54-meds-pills.png'), fullPage: true });
// 日历里把第4次标记完成 → 生长页自动多亮一颗
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const e = store.events().find((x) => x.scheduleId === 'vitk:4');
  store.applyRemote({ upserts: [{ ...e, done: true, updatedAt: Date.now() }] });
});
await page.waitForTimeout(400);
await check('完成后亮 4 颗', await page.locator('.md-row', { hasText: '维生素K1（口服）' }).locator('.md-pill.on').count() === 4);
// 编辑保存保留关联
await page.locator('.md-row', { hasText: '维生素K1（口服）' }).click();
await page.fill('#md-note', '周五');
await page.click('#mdSave');
await page.waitForTimeout(400);
await check('编辑后仍有药丸', await page.locator('.md-row', { hasText: '维生素K1（口服）' }).locator('.md-pill').count() === 10);
await check('无页面错误 ' + errors.join(';'), errors.length === 0);
await browser.close(); appSrv.close();
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
