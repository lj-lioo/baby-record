// v1.12.2：大量未推 ph: 条目（总量远超 1MB）也能分批推完；超大单条跳过不阻塞；另一台能拉到全部 gr:/md:
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SYNC = process.env.SYNC_BASE || 'http://127.0.0.1:8788';
let fail = 0; const ok = (n, c, x = '') => { if (!c) fail++; console.log(c ? '✅' : '❌', n, x); };
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
async function phone() {
  const ctx = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  await ctx.route('**/config.js*', async (r) => { const f = await r.fetch(); r.fulfill({ response: f, body: (await f.text()).replace(/syncApi: '[^']*'/, `syncApi: '${SYNC}'`) }); });
  const page = await ctx.newPage(); await page.goto(BASE); await page.waitForTimeout(500); return page;
}
const A = await phone();
await A.goto(BASE + '#/settings'); await A.waitForTimeout(500);
await A.locator('#syncCard details summary').click(); await A.click('#btnSyncOn'); await A.waitForSelector('#btnSyncCopy');
await A.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('babyrecord.v1') || '{"version":1,"events":[],"settings":{}}');
  const rnd = (n) => { let t = ''; while (t.length < n) t += Math.random().toString(36).slice(2); return t.slice(0, n); };
  const now = Date.now();
  s.photos = [];
  for (let i = 0; i < 120; i++) s.photos.push({ id: 'p' + i, takenAt: now - i * 1e6, createdAt: now, updatedAt: now + i, kind: 'photo', thumbData: 'data:image/jpeg;base64,' + rnd(i < 2 ? 60000 : 16000) });
  s.growth = []; for (let i = 0; i < 33; i++) s.growth.push({ id: 'g' + i, date: '2026-10-0' + (i % 9 + 1), weight: 3 + i / 100, updatedAt: now + i });
  s.meds = []; for (let i = 0; i < 7; i++) s.meds.push({ id: 'm' + i, name: '药' + i, start: '2026-10-01', updatedAt: now + i });
  localStorage.setItem('babyrecord.v1', JSON.stringify(s));
});
await A.reload(); await A.waitForTimeout(800);
const st = await A.evaluate(async () => { const m = await import('./js/sync.js'); await m.syncNow('t'); await m.syncNow('t'); return m.syncStatus(); });
const metaA = await A.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.sync')));
const acked = Object.keys(metaA.acked);
ok('总量 ~2MB 分批推完：118 张正常 ph: 全部 ack', acked.filter((k) => k.startsWith('ph:')).length === 118, acked.filter((k) => k.startsWith('ph:')).length);
ok('gr:33 + md:7 全部 ack', acked.filter((k) => k.startsWith('gr:')).length === 33 && acked.filter((k) => k.startsWith('md:')).length === 7);
ok('超大单条跳过并给出可读提示，不是 too_large', /太大未上传/.test(metaA.lastError || '') && !/too_large/.test(metaA.lastError), metaA.lastError);
const B = await phone();
await B.evaluate((m) => localStorage.setItem('babyrecord.sync', JSON.stringify({ enabled: true, key: m.key, acked: {}, dels: {}, cursor: 0 })), metaA);
await B.reload(); await B.waitForTimeout(500);
await B.evaluate(async () => { const m = await import('./js/sync.js'); await m.syncNow('t'); });
const sB = await B.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1') || '{"photos":[],"growth":[],"meds":[]}'));
const mB = await B.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.sync')));
ok('另一台分页拉到 118 ph / 33 gr / 7 md', sB.photos.length === 118 && sB.growth.length === 33 && sB.meds.length === 7, `${sB.photos.length}/${sB.growth.length}/${sB.meds.length} err=${mB.lastError}`);
await browser.close(); process.exit(fail ? 1 : 0);
