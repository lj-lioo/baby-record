import { chromium } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export async function albumHarness() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'album-ui-'));
  process.env.DATA_DIR = data; process.env.PHOTO_TOKEN = 'ui-test-token';
  const { handleRequest } = await import('../../sync/photo-server/server.js');
  const site = path.resolve(new URL('../../site/', import.meta.url).pathname);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = createServer((req, res) => {
    if (/^\/(v1\/|health)/.test(req.url)) return handleRequest(req, res);
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(site, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(site + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    let content = fs.readFileSync(file);
    if (file.endsWith('/config.js')) content = content.toString().replace(/syncApi: '[^']*'/, "syncApi: ''");
    res.end(content);
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try { browser = await chromium.launch(); } catch (e) { server.close(); fs.rmSync(data, { recursive: true, force: true }); throw e; }
  const errors = [];
  async function phone({ role = '爸爸', photos = [], userAgent, share = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: true, ...(userAgent ? { userAgent } : {}) });
    await context.addInitScript(({ base, role, photos, share }) => {
      if (!localStorage.getItem('babyrecord.v1')) localStorage.setItem('babyrecord.v1', JSON.stringify({ events: [], photos, settings: { memberRole: role, photoApi: base, photoToken: 'ui-test-token', babyBirthday: '2026-09-17' } }));
      window.__shared = [];
      if (share) { navigator.canShare = () => true; navigator.share = async ({ files }) => { const f = files[0]; window.__shared.push({ name: f.name, type: f.type, bytes: [...new Uint8Array(await f.arrayBuffer())] }); }; }
    }, { base, role, photos, share });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#/album'); await page.waitForSelector('#albumList');
    return page;
  }
  return { base, data, phone, browser, errors, async close() { await browser.close(); await new Promise((r) => server.close(r)); fs.rmSync(data, { recursive: true, force: true }); } };
}
export async function addPhoto(page, { upload = true, takenAt = Date.now(), note = '' } = {}) {
  return page.evaluate(async ({ upload, takenAt, note }) => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1600;
    const x = c.getContext('2d'); x.fillStyle = '#d86a3b'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = 'white'; x.font = '160px sans-serif'; x.fillText('朝朝', 300, 800);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .95));
    const P = await import('/js/photos.js');
    const result = await P.addPhotoFromFile(new File([blob], 'test.jpg', { type: 'image/jpeg', lastModified: takenAt }), { upload, takenAt, note });
    if (result.uploadError) throw new Error(result.uploadError);
    return result.photo;
  }, { upload, takenAt, note });
}
export async function expandMonths(page) {
  await page.locator('.album-month').evaluateAll((nodes) => nodes.forEach((n) => { n.open = true; }));
  await page.waitForTimeout(50);
}
