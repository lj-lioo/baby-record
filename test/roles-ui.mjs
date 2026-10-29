// v1.13.0 亲友身份 + 邀请链接：本机角色、权限拦截、邀请写入；截图 70–72
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
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  serviceWorkers: 'block',
});
await ctx.addInitScript(() => {
  localStorage.setItem('babyrecord.hideBanner', '1');
  localStorage.setItem('babyrecord.hideChkCta', '1');
  localStorage.setItem('babyrecord.hideVaxCta', '1');
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
await page.waitForTimeout(600);

await check(`版本 ${APP_V}`, APP_V === '1.13.0');

// 首装引导：选爸爸
const sheetH = page.locator('#sheet h3');
await check('首装身份引导', await sheetH.innerText() === '选择你的身份');
await page.click('.role-pick[data-role="爸爸"]');
await page.waitForTimeout(400);

await page.click('a[data-tab=settings]');
await page.waitForTimeout(400);
await check('设置有亲友团', await page.locator('#familyCard').count() === 1);
await check('当前身份爸爸', (await page.locator('#familyRoleLab').innerText()).includes('爸爸'));
await check('管理员可见宝宝资料', await page.locator('#babyProfileCard').count() === 1);
await check('管理员可见云同步或照片卡或一键生成', await page.locator('#vaxCard').count() === 1);
await page.screenshot({ path: path.join(shotDir, '70-settings-family-admin.png'), fullPage: false });

// 爸爸：日程有添加
await page.click('a[data-tab=home]');
await page.waitForTimeout(400);
await check('爸爸可见＋添加', await page.locator('#addHere').count() === 1);

// 切换为爷爷
await page.click('a[data-tab=settings]');
await page.waitForTimeout(300);
await page.selectOption('#familyRole', '爷爷');
await page.waitForTimeout(500);
await check('切到爷爷', (await page.locator('#familyRoleLab').innerText()).includes('爷爷'));
await check('老人设置无宝宝资料编辑区', await page.locator('#babyProfileCard').count() === 0);
await check('老人设置无疫苗计划卡', await page.locator('#vaxCard').count() === 0);
await check('老人设置无照片服务卡', await page.locator('#photoCard').count() === 0);
await check('老人设置无同步密钥输入', await page.locator('#syncKey, #syncPaste, #btnSyncOn').count() === 0);
await page.screenshot({ path: path.join(shotDir, '71-settings-family-elder.png'), fullPage: false });

await page.click('a[data-tab=home]');
await page.waitForTimeout(400);
await check('爷爷无＋添加', await page.locator('#addHere').count() === 0);
await check('爷爷无编辑按钮', await page.locator('[data-act=edit]').count() === 0);
await check('爷爷无设闹钟按钮', await page.locator('[data-act=alarm]').count() === 0);
await check('爷爷无改计划日', await page.locator('[data-act=plan]').count() === 0);

await page.click('a[data-tab=album]');
await page.waitForTimeout(400);
await check('爷爷仍可见上传', await page.locator('#btnAddPhoto').count() === 1);

await page.click('a[data-tab=growth]');
await page.waitForTimeout(400);
await check('爷爷无生长添加', await page.locator('#btnAddGrowth').count() === 0);

await page.screenshot({ path: path.join(shotDir, '72-home-elder-no-add.png'), fullPage: false });

// 邀请链接：切回爸爸后生成并打开（本机无 sync 时软接受）
await page.evaluate(async () => {
  const { setRole } = await import('./js/roles.js');
  setRole('爸爸');
});
await page.click('a[data-tab=settings]');
await page.waitForTimeout(500);
await check('恢复爸爸后可见邀请按钮', await page.locator('[data-inv="姥姥"]').count() === 1);

// 构造邀请：调用页面内 createInvite
const inviteUrl = await page.evaluate(async () => {
  const { createInvite } = await import('./js/roles.js');
  const { url } = await createInvite('姥姥');
  return url;
});
const roleEnc = encodeURIComponent('姥姥');
const invOk = inviteUrl.includes('#/join?') && (inviteUrl.includes('role=' + roleEnc) || inviteUrl.includes('role=姥姥'));
await check('邀请 URL 含 join 与 role', invOk, inviteUrl.slice(-100));
await check('邀请不含同步密钥前缀', !inviteUrl.includes('brs1_'));

const hash = inviteUrl.slice(inviteUrl.indexOf('#'));
await page.goto(`http://127.0.0.1:${APP_PORT}/${hash}`);
await page.waitForTimeout(800);
await check('打开邀请后到设置', (await page.locator('h1').first().innerText()).includes('设置') || await page.locator('#familyCard').count() === 1);
const roleLab = await page.locator('#familyRoleLab').innerText().catch(() => '');
const stored = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('babyrecord.v1')).settings.memberRole; } catch { return ''; }
});
await check('邀请写入姥姥', stored === '姥姥', `lab=${roleLab} stored=${stored}`);
await check('姥姥为老人视图', await page.locator('#babyProfileCard').count() === 0);

await check('无页面错误', errors.length === 0, errors.join(' | '));

console.log(`\nroles-ui: ${pass} pass, ${fail} fail`);
await browser.close();
appSrv.close();
process.exit(fail ? 1 : 0);
