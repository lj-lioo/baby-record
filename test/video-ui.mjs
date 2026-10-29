// v1.10.0 相册视频 UI：上传（分块加密）→ 网格 ▶时长 → 点开不自动下载 → 点播放才下载 → 大小上限；截图 46–49
import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const shotDir = path.join(here, '../screenshots');
const VIDEO = process.env.VIDEO || '/tmp/bv.webm';
function staticServer(root, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return createServer((req, res) => {
    let u = decodeURIComponent((req.url || '/').split('?')[0]);
    if (u.endsWith('/')) u += 'index.html';
    const fp = path.join(root, u.replace(/^\//, ''));
    if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  }).listen(port, '127.0.0.1');
}
const PHOTO_PORT = 18792, APP_PORT = 8096;
const dataDir = fs.mkdtempSync('/tmp/br-video-');
const photoProc = spawn(process.execPath, [path.join(here, '../sync/photo-server/server.js')], { env: { ...process.env, PORT: String(PHOTO_PORT), DATA_DIR: dataDir }, stdio: 'ignore' });
const appSrv = staticServer(site, APP_PORT);
await new Promise((r) => setTimeout(r, 400));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const videoReqs = []; page.on('request', (r) => { if (r.url().includes('/v1/video/') && r.method() === 'GET') videoReqs.push(r.url()); });
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('✅', n); } else { fail++; console.log('❌', n); } };

await page.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await page.evaluate(({ port }) => {
  // 测试用随机密钥（brs1_ 格式，本机临时，不是用户的密钥）；同步地址指向不存在的端口
  const b = 'abcdefghijklmnopqrstuvwxyz234567'; let k = 'brs1_'; for (let i = 0; i < 52; i++) k += b[Math.floor(Math.random() * 32)];
  localStorage.setItem('babyrecord.sync', JSON.stringify({ enabled: true, key: k, url: 'http://127.0.0.1:1' }));
  const s = JSON.parse(localStorage.getItem('babyrecord.v1') || '{"events":[],"settings":{}}');
  s.settings = { ...(s.settings || {}), photoApi: `http://127.0.0.1:${port}` };
  localStorage.setItem('babyrecord.v1', JSON.stringify(s));
}, { port: PHOTO_PORT });
await page.reload(); await page.waitForTimeout(800);
check('相册 input 接受视频', (await page.locator('#filePhotoAlbum').getAttribute('accept')).includes('video/*'));
check('录视频 input', (await page.locator('#fileVideoCamera').getAttribute('accept')) === 'video/*');
await page.click('#btnAddPhoto'); await page.waitForTimeout(300);
check('上传面板有录视频', await page.locator('#pickVideo').count() === 1);
await page.screenshot({ path: path.join(shotDir, '46-video-upload-sheet.png') });
await page.click('#pickCancel'); await page.waitForTimeout(200);

await page.setInputFiles('#filePhotoAlbum', VIDEO);
await page.waitForSelector('.album-play', { timeout: 30000 });
const badge = await page.locator('.album-play').innerText();
check(`网格显示 ▶ 时长（${badge}）`, /▶ 0:0[78]/.test(badge));
check('视频已上传（无「本地」角标）', await page.locator('.album-cell .album-badge').count() === 0);
const vdir = fs.readdirSync(dataDir).find((f) => f.startsWith('v_'));
const chunks = vdir ? fs.readdirSync(path.join(dataDir, vdir)) : [];
check(`极空间分块存储 3 块（${chunks.join(',')}）`, chunks.length === 3);
const plain = fs.readFileSync(VIDEO).subarray(0, 64);
check('服务端是密文（不含 webm 头）', vdir && !fs.readFileSync(path.join(dataDir, vdir, '0.bin')).includes(plain.subarray(0, 4)));
const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).photos[0]);
check('元数据含 kind/duration/size/chunks/封面', meta.kind === 'video' && meta.duration > 7 && meta.size > 9e6 && meta.chunks === 3 && meta.thumbData.startsWith('data:image/jpeg'));
check('同步元数据不含视频本体', JSON.stringify(meta).length < 200000);
await page.screenshot({ path: path.join(shotDir, '47-video-grid.png') });

// 模拟家人：清空本机缓存后打开
await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`); await page.waitForTimeout(600);
check('设置有视频上限', (await page.locator('#videoMaxMB').inputValue()) === '200');
await page.click('#btnVideoCacheClear'); await page.waitForTimeout(500);
check('缓存已清空', (await page.locator('#videoCacheInfo').innerText()).includes('0 个'));
await page.locator('#videoMaxMB').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(shotDir, '48-video-settings.png') });
await page.goto(`http://127.0.0.1:${APP_PORT}/#/album`); await page.waitForTimeout(600);
videoReqs.length = 0;
await page.click('.album-cell'); await page.waitForTimeout(1200);
const btn = await page.locator('#avPlay').innerText();
check(`点开只显示封面+大小（${btn}）`, /播放（约 9\.6 MB）/.test(btn));
check('点开不自动下载', videoReqs.length === 0 && await page.locator('#avImg video').count() === 0);
await page.screenshot({ path: path.join(shotDir, '49-video-viewer-before-play.png') });
await page.click('#avPlay');
await page.waitForSelector('#avImg video', { timeout: 20000 });
check(`点播放后才分块下载（${videoReqs.length} 次）`, videoReqs.length === 3);
await page.waitForTimeout(1500);
const vs = await page.evaluate(() => { const v = document.querySelector('#avImg video'); return { d: v.duration, w: v.videoWidth, err: v.error && v.error.code }; });
check(`解密后视频可播（${JSON.stringify(vs)}）`, vs.w === 1280 && !vs.err);
await page.screenshot({ path: path.join(shotDir, '50-video-playing.png') });
await page.click('#avClose'); await page.waitForTimeout(300);
videoReqs.length = 0;
await page.click('.album-cell'); await page.waitForTimeout(600);
check('再次打开提示已在本机', (await page.locator('#avPlay').innerText()).includes('已在本机'));
await page.click('#avPlay'); await page.waitForSelector('#avImg video');
check('缓存播放不再下载', videoReqs.length === 0);
await page.click('#avClose'); await page.waitForTimeout(300);

// 大小上限
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('babyrecord.v1')); s.settings.videoMaxMB = 10; localStorage.setItem('babyrecord.v1', JSON.stringify(s)); });
await page.reload(); await page.waitForTimeout(600);
await page.setInputFiles('#filePhotoAlbum', { name: 'big.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(11 * 1024 * 1024, 1) });
await page.waitForTimeout(800);
const toastTxt = await page.evaluate(() => document.body.innerText);
check('超上限拒绝并提示剪短', toastTxt.includes('超过上限 10MB') && toastTxt.includes('剪短'));
check('超上限未入库', await page.locator('.album-cell').count() === 1);

// 删除 → 服务端整段删掉
await page.click('.album-cell'); await page.waitForTimeout(400);
await page.click('#avDel'); await page.waitForTimeout(300);
await page.locator('.sheet button.danger, button:has-text("删除")').last().click(); await page.waitForTimeout(800);
check('删除后服务端目录移除', !fs.existsSync(path.join(dataDir, vdir)));
check('无页面 JS 错误', errors.length === 0); if (errors.length) console.log(errors);
console.log(`\nvideo-ui ${pass} pass, ${fail} fail`);
await browser.close(); photoProc.kill('SIGTERM'); appSrv.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
