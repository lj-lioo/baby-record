// v1.12.7 免费疫苗合集卡 + 待完成/已完成默认收起；屏蔽 SW，仅本机数据，不写云端
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
const APP_PORT = 8101;
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

await check(`版本 ${APP_V}`, APP_V === '1.12.7');
await check('待完成默认收起', await page.locator('#pendBody').isHidden());
await check('已完成默认收起', await page.locator('#doneFoldBody').isHidden());
// 点日历有待完成的一天 → 自动展开待完成
await page.locator('.day.selected, .day.today').first().click(); await page.waitForTimeout(400);
// 今天可能没有事项；选一个有紫针的日子
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-11-17' })));
await page.waitForTimeout(500);
await check('点日历/跳到有事项的天会展开待完成', await page.locator('#pendBody').isVisible());
await page.reload(); await page.waitForTimeout(800);
await check('刷新后待完成再次默认收起（不记忆）', await page.locator('#pendBody').isHidden());

const free = page.locator('#freeVaxCard');
const paid = page.locator('#paidCard');
await check('有免费疫苗卡', await free.count() === 1);
await check('免费卡在自费卡上方', await page.evaluate(() => {
  const a = document.getElementById('freeVaxCard'), b = document.getElementById('paidCard');
  return !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}));
const head = await free.locator('#fvToggle').innerText();
await check(`标题与统计（${head.replace(/\s+/g, ' ').slice(0, 40)}）`, head.includes('免费疫苗') && /\d+\s*针/.test(head) && /已打\s*\d+/.test(head));
await check('免费卡默认收起', await free.locator('.pc-wrap').count() === 0);
await free.locator('#fvToggle').click(); await page.waitForTimeout(500);
await check('展开后有疫苗分组', await free.locator('.fv-item').count() >= 8);
const names = await free.locator('.fv-item .pc-name').allInnerTexts();
await check('含乙肝/卡介苗/脊灰/百白破/麻腮风', ['乙肝疫苗', '卡介苗', '脊灰疫苗', '百白破疫苗', '麻腮风疫苗'].every((n) => names.some((t) => t.includes(n))));
// 展开百白破看剂次
const dtap = free.locator('.fv-item', { hasText: '百白破疫苗' }).first();
await dtap.locator('summary').click(); await page.waitForTimeout(300);
await check('百白破有多剂', await dtap.locator('.fv-dose').count() >= 4);

// 若有五联计划，脊灰/百白破应标被替代
const hasPenta = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events.some((e) => (e.scheduleId || '').startsWith('paid:penta')));
if (hasPenta) {
  const pol = free.locator('.fv-item', { hasText: '脊灰疫苗' }).first();
  await pol.locator('summary').click(); await page.waitForTimeout(200);
  await check('脊灰有被替代样式', await pol.locator('.fv-dose.replaced').count() >= 1);
  await check('被替代文案含五联', (await pol.locator('.fv-st.replaced').first().innerText()).includes('五联'));
} else {
  // 加入五联再验
  await page.evaluate(async () => {
    const { store, uid } = await import('./js/store.js');
    const { seriesPlan } = await import('./js/paidvax.js');
    const bday = store.state.settings.babyBirthday;
    const plan = seriesPlan('penta', bday, '2026-11-17');
    for (const d of plan) {
      store.upsertEvent({ id: uid(), date: d.date, time: '09:00', title: d.title, category: 'paidvax', note: d.note || '', scheduleId: d.scheduleId, reminders: [], done: false });
    }
  });
  await page.reload(); await page.waitForTimeout(800);
  await page.locator('#freeVaxCard #fvToggle').click(); await page.waitForTimeout(400);
  const pol = page.locator('#freeVaxCard .fv-item', { hasText: '脊灰疫苗' }).first();
  await pol.locator('summary').click(); await page.waitForTimeout(200);
  await check('加入五联后脊灰被替代', await pol.locator('.fv-dose.replaced').count() >= 1);
  await check('替代注明五联', (await pol.locator('.fv-st.replaced').first().innerText()).includes('五联'));
}

await page.locator('#freeVaxCard').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(shotDir, '60-free-vax-card.png'), fullPage: false });

// 点一剂 → 详情面板（先展开乙肝分组，点可见剂次）
const hepb = page.locator('#freeVaxCard .fv-item', { hasText: '乙肝疫苗' }).first();
if (!(await hepb.getAttribute('open'))) await hepb.locator('summary').click();
await page.waitForTimeout(200);
const dose = hepb.locator('.fv-dose').first();
await dose.click(); await page.waitForTimeout(500);
await check('点剂次弹出详情面板', await page.locator('#sheet .ev-detail, #sheet h3').count() >= 1);
const sheetTxt = await page.locator('#sheet').innerText();
await check('详情是底部面板（有关闭）', sheetTxt.includes('关闭') || await page.locator('#evdClose, #fvClose').count() >= 1);
await page.locator('#evdClose, #fvClose, #sheetBackdrop').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(300);

await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`); await page.waitForTimeout(500);
await check(`设置页版本 v${APP_V}`, (await page.locator('#appVer').innerText()).includes(`v${APP_V}`));
await check('无页面 JS 错误', errors.length === 0); if (errors.length) console.log(errors);

console.log(`\nfreevax-ui ${pass} pass, ${fail} fail`);
await browser.close(); appSrv.close();
process.exit(fail ? 1 : 0);
