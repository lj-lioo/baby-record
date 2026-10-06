// 端到端：云同步（多台“手机” + 盒子命令行 + 配对链接）。
// 本地：cd sync/worker && npx wrangler dev --port 8788，然后 node test/sync-ui.mjs
// 线上：BASE=https://lj-lioo.github.io/baby-record/ SYNC_BASE=https://<worker> node test/sync-ui.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import { execFileSync } from 'child_process';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SYNC = process.env.SYNC_BASE || 'http://127.0.0.1:8788';
const SHOTS = '/workspace/baby-app/screenshots/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
const errors = [];
const leaked = [];
async function phone(name, syncApi, { standalone = false, hideBanner = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', userAgent: IPHONE });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('**/config.js*', async (route) => {
    const r = await route.fetch(); const body = (await r.text()).replace(/syncApi: '[^']*'/, `syncApi: '${syncApi}'`);
    route.fulfill({ response: r, body });
  });
  if (standalone) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push/i.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('request', (r) => { if (r.url().includes('brs1_') || (r.headers().referer || '').includes('brs1_')) leaked.push(`${name}: ${r.url()}`); });
  if (hideBanner) {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.setItem('babyrecord.hideBanner', '1'));
    await page.reload(); await page.waitForTimeout(600);
  }
  return { ctx, page };
}
const events = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1') || '{"events":[]}').events);
const syncMeta = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.sync') || '{}'));
const syncNowIn = (page) => page.evaluate(async () => { const m = await import('./js/sync.js'); await m.syncNow('test'); return m.syncStatus(); });
const settings = async (P) => { await P.page.goto(BASE + '#/settings'); await P.page.waitForTimeout(500); };

// 0) 未配置 syncApi：设置页没有云同步
{
  const P = await phone('plain', '');
  await settings(P);
  ok('未配置 syncApi 时不显示「云同步」、不启用同步', (await P.page.locator('#syncCard').count()) === 0 && (await syncMeta(P.page)).enabled === undefined);
  await P.ctx.close();
}

// 1) 手机 A：生成新密钥开启，生成体检计划
const A = await phone('A', SYNC);
await settings(A);
ok('设置页出现「☁️ 云同步」，默认是「粘贴同步密钥」', await A.page.locator('#syncCard').isVisible() && await A.page.locator('#syncPaste').isVisible() && await A.page.locator('#btnSyncJoin').isVisible());
await A.page.evaluate(() => document.getElementById('syncCard').scrollIntoView({ block: 'start' }));
await A.page.waitForTimeout(300);
await A.page.screenshot({ path: SHOTS + '13-sync-settings-paste.png' });
await A.page.locator('#syncCard details summary').click();
await A.page.click('#btnSyncOn');
await A.page.waitForSelector('#btnSyncCopy');
const metaA = await syncMeta(A.page);
ok('A：「生成新密钥并开启」→ brs1_ 密钥，状态「已开启 · 上次同步」', /^brs1_[A-Za-z0-9_-]{43}$/.test(metaA.key) && (await A.page.textContent('#syncState')).includes('上次同步'), await A.page.textContent('#syncState'));
ok('A：密钥默认打码', (await A.page.inputValue('#syncKey')).includes('••••'));
await A.page.click('#btnSyncCopy'); await A.page.waitForTimeout(200);
ok('A：「复制密钥」复制完整密钥', (await A.page.evaluate(() => navigator.clipboard.readText())) === metaA.key);
await A.page.evaluate(() => document.getElementById('syncCard').scrollIntoView({ block: 'start' }));
await A.page.waitForTimeout(2500);
await A.page.screenshot({ path: SHOTS + '12-sync-settings-on.png' });
await A.page.click('#btnChk'); await A.page.waitForSelector('.vp-item'); await A.page.click('#vp-ok');
await A.page.waitForTimeout(2600); await syncNowIn(A.page);
ok('A：修改后自动上传（12 个体检事项 + 宝宝生日）', Object.keys((await syncMeta(A.page)).acked).length === 13, `acked=${Object.keys((await syncMeta(A.page)).acked).length}`);

// 2) 手机 B：「从剪贴板粘贴」→「连接并同步」
const B = await phone('B', SYNC);
await settings(B);
await B.page.evaluate((k) => navigator.clipboard.writeText(`密钥：${k}`), metaA.key);
await B.page.click('#btnSyncClip'); await B.page.waitForTimeout(200);
ok('B：「从剪贴板粘贴」取出密钥', (await B.page.inputValue('#syncPaste')) === metaA.key);
await B.page.click('#btnSyncJoin');
await B.page.waitForSelector('#btnSyncCopy');
let evB = await events(B.page);
ok('B：连接后拉取到 A 的 12 个体检事项', evB.filter((e) => (e.scheduleId || '').startsWith('chk:')).length === 12, `n=${evB.length}`);
ok('B：宝宝生日也同步过来', (await B.page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).settings.babyBirthday)) === '2026-09-17');

// 3) 盒子命令行（同一密钥）shop / add → 手机收到
const envFile = '/tmp/sync-ui-test.env';
fs.writeFileSync(envFile, `BABY_SYNC_URL=${SYNC}\nBABY_SYNC_KEY=${metaA.key}\n`, { mode: 0o600 });
// 去掉环境变量里的 BABY_SYNC_KEY / BABY_SYNC_URL（盒子上可能注入了正式密钥，它优先于配置文件），只用临时配置
const cli = (...args) => execFileSync('node', ['/workspace/baby-app/sync/add-item.js', ...args], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'BABY_SYNC_KEY' && k !== 'BABY_SYNC_URL')), BABY_SYNC_ENV: envFile }, encoding: 'utf8' });
ok('命令行 shop：添加购物清单', cli('shop', '尿不湿 NB码', '婴儿湿巾', '--date', '2026-09-30').includes('已添加'));
ok('命令行 add：添加带时间的事项', cli('add', '--title', '带宝宝晒太阳', '--date', '2026-10-02', '--time', '10:00', '--note', '15分钟').includes('已添加'));
const cliList = cli('list', '--all');
ok('命令行 list：能解密手机上传的事项（共 14 个）', cliList.includes('满月体检') && cliList.includes('共 14 个'), cliList.trim().split('\n').pop());
await B.page.click('#btnSyncNow'); await B.page.waitForTimeout(1000);
evB = await events(B.page);
ok('B：「立即同步」后收到命令行的购物清单和事项', evB.some((e) => e.title.includes('尿不湿')) && evB.some((e) => e.title === '带宝宝晒太阳' && e.time === '10:00' && e.reminders.length === 3));
await A.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await A.page.waitForTimeout(2000);
ok('A：切回前台时自动同步，收到购物清单', (await events(A.page)).some((e) => e.title.includes('尿不湿')));

// 4) 删除 / 完成 双向同步
const del = evB.find((e) => e.scheduleId === 'chk:m3');
await B.page.evaluate(async (id) => { const { store } = await import('./js/store.js'); store.deleteEvent(id); }, del.id);
await B.page.waitForTimeout(2600); await syncNowIn(B.page);
const doneId = evB.find((e) => e.scheduleId === 'chk:m6').id;
await A.page.evaluate(async (id) => { const { store } = await import('./js/store.js'); store.setDone(id, true); }, doneId);
await A.page.waitForTimeout(2600); await syncNowIn(A.page); await syncNowIn(B.page);
ok('B 删除的事项在 A 上也删除（tombstone）', !(await events(A.page)).some((e) => e.id === del.id));
ok('A 标记完成的事项在 B 上也是已完成', (await events(B.page)).find((e) => e.id === doneId)?.done === true);

// 5) 已有数据的手机 C 连接同一个密钥：本机数据上传合并，不被清空
const C = await phone('C', SYNC);
await settings(C);
await C.page.click('#btnChk'); await C.page.waitForSelector('.vp-item'); await C.page.click('#vp-ok'); await C.page.waitForTimeout(300);
await settings(C);
await C.page.click('#btnVax'); await C.page.waitForSelector('.vp-item'); await C.page.click('#vp-ok'); await C.page.waitForTimeout(300);
const cLocal = await C.page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  store.upsertEvent({ id: 'cOwn1', date: '2026-10-05', time: '15:00', title: '本机自己的事项', category: 'other', reminders: [] });
  const m1 = store.events().find((e) => e.scheduleId === 'chk:m1');
  store.setAlarmAdded(m1.id, true, 'sig');                       // 这条在手机上已设了 iPhone 闹钟
  // 模拟旧版本存下的生日（没有 profileUpdatedAt）
  const raw = JSON.parse(localStorage.getItem('babyrecord.v1')); delete raw.settings.profileUpdatedAt; localStorage.setItem('babyrecord.v1', JSON.stringify(raw));
  return { n: store.events().length, m1: m1.id };
});
await C.page.reload(); await C.page.waitForTimeout(500);
await settings(C);
await C.page.fill('#syncPaste', metaA.key); await C.page.click('#btnSyncJoin');
await C.page.waitForSelector('#btnSyncCopy');
await syncNowIn(C.page); await syncNowIn(A.page); await syncNowIn(C.page);
const evC = await events(C.page), evA = await events(A.page);
const chkC = evC.filter((e) => (e.scheduleId || '').startsWith('chk:'));
ok('C：本机自己的事项保留并上传到 A', evC.some((e) => e.id === 'cOwn1') && evA.some((e) => e.id === 'cOwn1'));
ok('C：本机的 20 个疫苗事项保留并上传到 A', evC.filter((e) => (e.scheduleId || '').startsWith('nip:')).length === 20 && evA.filter((e) => (e.scheduleId || '').startsWith('nip:')).length === 20);
ok('C：体检计划与云端去重（每个 scheduleId 只有一条；B 删掉的那条不复活，C 自己的 3月龄 保留）', new Set(chkC.map((e) => e.scheduleId)).size === chkC.length && chkC.length === 12 && !chkC.some((e) => e.id === del.id), `n=${chkC.length}`);
ok('C：去重时保留了手机上已设闹钟的那条满月体检', chkC.find((e) => e.scheduleId === 'chk:m1')?.id === cLocal.m1 && evA.find((e) => e.scheduleId === 'chk:m1')?.alarmAdded === true);
ok('A 与 C 事项完全一致', evA.map((e) => e.id + e.updatedAt).sort().join() === evC.map((e) => e.id + e.updatedAt).sort().join(), `A=${evA.length} C=${evC.length}`);
ok('命令行也能看到 C 上传的事项', cli('list', '--all').includes('本机自己的事项'));

// 6) 配对链接 #pair=<密钥>
{
  const S = await phone('SafariTab', SYNC, { hideBanner: false });
  await S.page.goto(BASE + '#pair=' + metaA.key); await S.page.waitForTimeout(800);
  const url = S.page.url();
  ok('配对链接：打开后地址栏里的密钥被去掉', !url.includes('brs1_') && url.endsWith('#/settings'), url);
  ok('Safari 标签页（非主屏幕 App）：提示复制到 App，不自动导入', (await S.page.locator('#pairCopy').isVisible()) && (await S.page.textContent('#sheet')).includes('从剪贴板粘贴') && !(await syncMeta(S.page)).enabled);
  await S.page.screenshot({ path: SHOTS + '14-sync-pair-safari.png' });
  await S.page.click('#pairCopy'); await S.page.waitForTimeout(200);
  ok('「复制同步密钥」复制完整密钥', (await S.page.evaluate(() => navigator.clipboard.readText())) === metaA.key);
  const hist = await S.page.evaluate(() => history.length);
  ok('浏览器历史里没有密钥', !(await S.page.evaluate(() => location.href)).includes('brs1_'), `history=${hist}`);
  await S.ctx.close();
  const H = await phone('HomeScreenApp', SYNC, { standalone: true, hideBanner: false });
  await H.page.goto(BASE + '#pair=' + metaA.key); await H.page.waitForTimeout(800);
  ok('主屏幕 App 里打开配对链接：显示「连接并同步」', await H.page.locator('#pairJoin').isVisible());
  await H.page.click('#pairJoin'); await H.page.waitForTimeout(2500);
  ok('主屏幕 App：连接后拉取到全部事项', (await syncMeta(H.page)).key === metaA.key && (await events(H.page)).length === evA.length, `n=${(await events(H.page)).length}`);
  await H.ctx.close();
}
ok('任何网络请求（含 Referer）都没有带出密钥', leaked.length === 0, leaked.join(' | '));

// 7) 同步服务不可用
await B.ctx.route(SYNC + '/**', (r) => r.abort());
const st = await syncNowIn(B.page);
ok('同步服务连不上时 App 照常使用，显示「同步失败」', !!st.lastError, st.lastError);
await B.ctx.unroute(SYNC + '/**');

ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
fs.rmSync(envFile, { force: true });
fs.writeFileSync('/workspace/baby-app/test/results-sync.json', JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
