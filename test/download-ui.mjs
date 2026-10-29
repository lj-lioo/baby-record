// v1.12.6 下载原片：本地静态服务 + 临时 photo-server（临时目录，非 NAS 生产），屏蔽 SW，不连云端
import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const shotDir = path.join(here, '../screenshots'); fs.mkdirSync(shotDir, { recursive: true });
const IMG = process.env.IMG || '/tmp/dl-orig.jpg';
const VIDEO = process.env.VIDEO || '/tmp/bv.webm';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
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
const PHOTO_PORT = 18793, APP_PORT = 8097;
const dataDir = fs.mkdtempSync('/tmp/br-dl-');
const photoProc = spawn(process.execPath, [path.join(here, '../sync/photo-server/server.js')], { env: { ...process.env, PORT: String(PHOTO_PORT), DATA_DIR: dataDir }, stdio: 'ignore' });
const appSrv = staticServer(site, APP_PORT);
await new Promise((r) => setTimeout(r, 400));
const browser = await chromium.launch();
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const AND_UA = 'Mozilla/5.0 (Linux; Android 14; HarmonyOS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const mk = (ua) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', userAgent: ua, serviceWorkers: 'block', acceptDownloads: true });
let pass = 0, fail = 0; const errors = [];
const check = (n, c) => { if (c) { pass++; console.log('✅', n); } else { fail++; console.log('❌', n); } };
const imgHash = sha(fs.readFileSync(IMG)), vidHash = sha(fs.readFileSync(VIDEO));

// ── A：上传者（安卓/鸿蒙 Chrome）
const A = await mk(AND_UA); const pa = await A.newPage(); pa.on('pageerror', (e) => errors.push(e.message));
await pa.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await pa.evaluate(({ port }) => {
  const b = 'abcdefghijklmnopqrstuvwxyz234567'; let k = 'brs1_'; for (let i = 0; i < 52; i++) k += b[Math.floor(Math.random() * 32)];
  localStorage.setItem('babyrecord.sync', JSON.stringify({ enabled: true, key: k, url: 'http://127.0.0.1:1' })); // 测试密钥；云端指向不存在端口
  const s = JSON.parse(localStorage.getItem('babyrecord.v1') || '{"events":[],"settings":{}}');
  s.settings = { ...(s.settings || {}), photoApi: `http://127.0.0.1:${port}` }; localStorage.setItem('babyrecord.v1', JSON.stringify(s));
}, { port: PHOTO_PORT });
await pa.reload(); await pa.waitForTimeout(700);
await pa.setInputFiles('#filePhotoAlbum', IMG); await pa.waitForSelector('.album-cell', { timeout: 20000 });
await pa.setInputFiles('#filePhotoAlbum', VIDEO); await pa.waitForSelector('.album-play', { timeout: 30000 });
await pa.waitForTimeout(500);
const metas = await pa.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).photos);
check('两项均已上传极空间', metas.length === 2 && metas.every((m) => m.remoteReady));
const photoIdx = metas.findIndex((m) => m.kind !== 'video');
const cells = pa.locator('.album-cell');
// 打开照片
const cellFor = async (page, kind) => { const n = await page.locator('.album-cell').count(); for (let i = 0; i < n; i++) { const c = page.locator('.album-cell').nth(i); const isV = await c.locator('.album-play').count(); if ((kind === 'video') === !!isV) return c; } };
await (await cellFor(pa, 'photo')).click(); await pa.waitForTimeout(600);
check('照片查看页有「下载原图」', (await pa.locator('#avDl').innerText()).includes('下载原图'));
const [dl] = await Promise.all([pa.waitForEvent('download'), pa.click('#avDl')]);
const dlPath = await dl.path(); const name = dl.suggestedFilename();
check(`安卓直接下载，文件名带拍摄日期（${name}）`, /^朝朝_\d{8}_\d{6}_\w{4}\.jpg$/.test(name));
check('下载内容与原图逐字节一致', sha(fs.readFileSync(dlPath)) === imgHash);
await pa.waitForTimeout(200);
check('显示已下载状态', (await pa.locator('#avDlState').innerText()).includes('已下载'));
await pa.click('#avClose'); await pa.waitForTimeout(300);
const state = await pa.evaluate(() => ({ v1: localStorage.getItem('babyrecord.v1'), sync: localStorage.getItem('babyrecord.sync') }));

// ── B：家人 iPhone（全新本机缓存 → 必须从极空间取回解密）
const B = await mk(IOS_UA);
await B.addInitScript(() => {
  window.__shared = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => { const f = d.files[0]; const buf = await f.arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', buf); window.__shared.push({ name: f.name, type: f.type, size: f.size, hash: [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('') }); };
});
const pb = await B.newPage(); pb.on('pageerror', (e) => errors.push(e.message));
const reqs = []; pb.on('request', (r) => { if (/\/v1\/(photo|video)\//.test(r.url()) && r.method() === 'GET') reqs.push(r.url()); });
await pb.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await pb.evaluate((st) => { localStorage.setItem('babyrecord.v1', st.v1); localStorage.setItem('babyrecord.sync', st.sync); }, state);
await pb.reload(); await pb.waitForTimeout(800);
await (await cellFor(pb, 'photo')).click(); await pb.waitForSelector('#avImg img', { timeout: 15000 }); await pb.waitForTimeout(400);
const preReq = reqs.length;
await pb.click('#avDl'); await pb.waitForTimeout(800);
check('iPhone 第一次点：取回原件并提示再点一次', (await pb.locator('#avDl').innerText()).includes('保存到手机相册') && (await pb.locator('#avDlState').innerText()).includes('存储图像'));
check('复用查看时已取回的原图，不重复下载', reqs.length === preReq);
await pb.screenshot({ path: path.join(shotDir, '57-download-photo-iphone.png') });
await pb.click('#avDl'); await pb.waitForTimeout(500);
let sh = await pb.evaluate(() => window.__shared);
check(`iPhone 调起分享面板（${sh[0]?.name}）`, sh.length === 1 && /^朝朝_\d{8}_\d{6}_\w{4}\.jpg$/.test(sh[0].name) && sh[0].type === 'image/jpeg');
check('分享的是解密后原图（哈希一致）', sh[0]?.hash === imgHash);
await pb.click('#avClose'); await pb.waitForTimeout(300);
// 视频
await (await cellFor(pb, 'video')).click(); await pb.waitForTimeout(600);
const vreq0 = reqs.filter((u) => u.includes('/video/')).length;
check('视频查看页有「下载原视频」且未自动下载', (await pb.locator('#avDl').innerText()).includes('下载原视频') && vreq0 === 0);
await pb.click('#avDl'); await pb.waitForTimeout(300);
const warn = await pb.locator('#avDlState').innerText();
check(`下载前提示大小与流量（${warn.slice(0, 30)}…）`, /约 9\.6 MB/.test(warn) && warn.includes('流量') && reqs.filter((u) => u.includes('/video/')).length === 0);
await pb.screenshot({ path: path.join(shotDir, '58-download-video-confirm-iphone.png') });
await pb.click('#avDl');
await pb.waitForFunction(() => document.querySelector('#avDl')?.innerText.includes('保存到手机相册'), null, { timeout: 30000 });
check('分块下载 3 块', reqs.filter((u) => u.includes('/video/')).length === 3);
await pb.click('#avDl'); await pb.waitForTimeout(800);
sh = await pb.evaluate(() => window.__shared);
check(`视频分享（${sh[1]?.name} ${sh[1]?.size}）`, sh.length === 2 && /\.webm$/.test(sh[1].name) && sh[1].hash === vidHash);
await pb.screenshot({ path: path.join(shotDir, '59-download-video-ready-iphone.png') });
await pb.click('#avClose');

// ── C：连不上极空间
const C = await mk(AND_UA); const pc = await C.newPage(); pc.on('pageerror', (e) => errors.push(e.message));
await pc.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await pc.evaluate((st) => { const s = JSON.parse(st.v1); s.settings.photoApi = 'http://127.0.0.1:2'; localStorage.setItem('babyrecord.v1', JSON.stringify(s)); localStorage.setItem('babyrecord.sync', st.sync); }, state);
await pc.reload(); await pc.waitForTimeout(700);
await (await cellFor(pc, 'photo')).click(); await pc.waitForTimeout(1200);
await pc.click('#avDl'); await pc.waitForTimeout(1200);
const errTxt = await pc.locator('#avDlState').innerText();
check(`连不上时可读提示（${errTxt}）`, errTxt.includes('Wi‑Fi') && errTxt.includes('VPN'));
check('失败后按钮可重试', !(await pc.locator('#avDl').isDisabled()));

check('无页面 JS 错误', errors.length === 0); if (errors.length) console.log(errors);
console.log(`\ndownload-ui ${pass} pass, ${fail} fail`);
await browser.close(); photoProc.kill('SIGTERM'); appSrv.close();
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
