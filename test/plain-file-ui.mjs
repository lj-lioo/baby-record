// v1.14.0：新上传存成普通文件 + 旧密文迁移
import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '../site');
const PP = 18793, AP = 8097;
const dataDir = fs.mkdtempSync('/tmp/br-plain-');
const proc = spawn(process.execPath, [path.join(here, '../sync/photo-server/server.js')], { env: { ...process.env, PORT: String(PP), DATA_DIR: dataDir }, stdio: 'ignore' });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const fp = path.join(site, u);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(res);
}).listen(AP, '127.0.0.1');
await new Promise((r) => setTimeout(r, 400));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${AP}/#/album`);
await page.waitForTimeout(800);
const r = await page.evaluate(async (PP) => {
  const P = await import('/js/photos.js');
  const S = await import('/js/sync.js');
  const core = await import('/js/sync-core.js');
  const { store } = await import('/js/store.js');
  store.updateSettings({ photoApi: `http://127.0.0.1:${PP}` });
  // 合成一张 600KB 级 png
  const c = document.createElement('canvas'); c.width = 900; c.height = 700;
  const x = c.getContext('2d'); const id0 = x.createImageData(900, 700);
  for (let i = 0; i < id0.data.length; i++) id0.data[i] = (Math.random() * 255) | 0;
  x.putImageData(id0, 0, 0);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  const file = new File([blob], 'IMG_0001.PNG', { type: 'image/png', lastModified: Date.parse('2026-10-29T10:20:30+08:00') });
  const a = await P.addPhotoFromFile(file);
  const m1 = store.getPhoto(a.photo.id);
  const back = await (await fetch(`http://127.0.0.1:${PP}/v1/file/${m1.id}`)).arrayBuffer();
  const same = back.byteLength === blob.size;
  // 旧密文：手工 seal 分块传 /v1/video
  await S.enableSync().catch(() => {});
  const { enc } = await core.deriveKeys(S.syncStatus().key);
  const plain = new Uint8Array(await blob.arrayBuffer());
  const lid = 'legacy' + Date.now();
  const CH = 256 * 1024, n = Math.ceil(plain.length / CH);
  for (let i = 0; i < n; i++) {
    const packed = await core.sealBytes(enc, `${lid}:${i}`, plain.subarray(i * CH, (i + 1) * CH));
    await fetch(`http://127.0.0.1:${PP}/v1/video/${lid}/${i}`, { method: 'PUT', body: packed });
  }
  store.upsertPhoto({ id: lid, takenAt: Date.parse('2026-09-01T08:00:00+08:00'), mime: 'image/png', thumbData: m1.thumbData, remoteReady: true, storage: 'chunks', chunks: n, chunkSize: CH });
  const legacyBefore = P.legacyEncryptedPhotos().length;
  const mig = await P.migrateLegacyToPlain();
  const m2 = store.getPhoto(lid);
  const back2 = await (await fetch(`http://127.0.0.1:${PP}/v1/file/${lid}`)).arrayBuffer();
  const loaded = await P.loadPhotoBlob(m1.id);
  await P.removePhoto(m1.id);
  const gone = (await fetch(`http://127.0.0.1:${PP}/v1/file/${m1.id}`)).status;
  return { storage: m1.storage, ext: m1.ext, same, legacyBefore, mig, m2storage: m2.storage, back2: back2.byteLength === plain.length, loaded: loaded.source, gone };
}, PP);
console.log(JSON.stringify(r));
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(dataDir, p)); } })(dataDir);
console.log(dataDir, files);
await browser.close(); srv.close(); proc.kill();
