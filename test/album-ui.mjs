// 相册 UI：本地静态服务 + 照片服务；生成截图 35–37
import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const shotDir = path.join(here, '../screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const APP_V = /APP_BUILD = '([^']+)'/.exec(fs.readFileSync(path.join(site, 'js/views/settings.js'), 'utf8'))[1];

function staticServer(root, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const PHOTO_PORT = 18791;
const APP_PORT = 8095;
const dataDir = fs.mkdtempSync('/tmp/br-album-');
const photoProc = spawn(process.execPath, [path.join(here, '../sync/photo-server/server.js')], {
  env: { ...process.env, PORT: String(PHOTO_PORT), DATA_DIR: dataDir },
  stdio: 'ignore',
});
const appSrv = staticServer(site, APP_PORT);
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => { if (!localStorage.getItem('babyrecord.v1')) localStorage.setItem('babyrecord.v1', JSON.stringify({ events: [], settings: { memberRole: '爸爸' } })); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = 0, fail = 0;
async function check(name, cond) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name); }
}

await page.goto(`http://127.0.0.1:${APP_PORT}/#/album`);
await page.waitForTimeout(800);
await check('相册页有标题', await page.locator('h1').innerText() === '相册');
await check('有上传按钮', await page.locator('#btnAddPhoto').count() === 1);
await check('底部有相册 Tab', await page.locator('#tabbar a[data-tab=album]').count() === 1);
await check('相册 input 无 capture', await page.locator('#filePhotoAlbum').count() === 1 && !(await page.locator('#filePhotoAlbum').getAttribute('capture')));
await check('拍照 input 有 capture', (await page.locator('#filePhotoCamera').getAttribute('capture')) === 'environment');
await page.click('#btnAddPhoto');
await page.waitForTimeout(300);
await check('上传面板有从相册选择', await page.locator('#pickAlbum').count() === 1);
await check('上传面板有拍照', await page.locator('#pickCamera').count() === 1);
await page.click('#pickCancel');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shotDir, '35-album-empty.png'), fullPage: true });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`);
await page.waitForTimeout(600);
await check('设置有照片服务卡片', await page.locator('#photoCard').count() === 1);
await page.fill('#photoApi', `http://127.0.0.1:${PHOTO_PORT}`);
await page.click('#btnPhotoTest');
await page.waitForTimeout(800);
const tip = await page.locator('#photoTestResult').innerText();
await check('测试连接成功', tip.includes('成功'));
await page.screenshot({ path: path.join(shotDir, '36-photo-service-settings.png'), fullPage: true });

await page.goto(`http://127.0.0.1:${APP_PORT}/#/help`);
await page.waitForTimeout(500);
await check('帮助有相册章节', await page.locator('#h-album').count() === 1);
await check('帮助有极空间章节', await page.locator('#h-nas').count() === 1);
await page.locator('#h-album').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(shotDir, '37-help-album-nas.png') });

{
  await page.goto(`http://127.0.0.1:${APP_PORT}/#/settings`);
  await page.waitForTimeout(400);
  const v = await page.locator('#appVer').innerText();
  await check(`设置页版本 ${APP_V}`, v.includes(`v${APP_V}`));
}

await check('无页面 JS 错误', errors.length === 0);
if (errors.length) console.log(errors);

console.log(`\nalbum-ui ${pass} pass, ${fail} fail`);
await browser.close();
photoProc.kill('SIGTERM');
appSrv.close();
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
