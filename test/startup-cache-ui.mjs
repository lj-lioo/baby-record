import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('打开 App 使用缓存，离线可用，同版本号的发布仍会更新', async (t) => {
  const site = fileURLToPath(new URL('../site/', import.meta.url));
  const basePath = '/baby-record/';
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png' };
  const version = /appVersion: '([^']+)'/.exec(await readFile(join(site, 'config.js'), 'utf8'))[1];
  const requests = [];
  let revision = 'initial';
  let blockStatic = false;
  let probe = 0;
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith(basePath)) { res.writeHead(404).end(); return; }
    const file = pathname.slice(basePath.length) || 'index.html';
    requests.push(file);
    if (file === 'api/probe') {
      res.writeHead(200, { 'Cache-Control': 'no-store' }).end(String(++probe));
      return;
    }
    if (blockStatic && file !== 'sw.js') { res.writeHead(503).end(); return; }
    try {
      let body = await readFile(join(site, file));
      if (file === 'config.js') body = 'window.BABY_CONFIG = ' + JSON.stringify({ appVersion: version });
      if (file === 'sw.js') body = body.toString().replace("const REVISION = '';", "const REVISION = '" + revision + "';");
      if (file === 'index.html') body = body.toString().replace('<body>', '<body data-test-release="' + revision + '">');
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'max-age=0, must-revalidate' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    if (!localStorage.getItem('babyrecord.v1')) localStorage.setItem('babyrecord.v1',
      JSON.stringify({ settings: { memberRole: '爸爸' } }));
  });
  const base = 'http://127.0.0.1:' + server.address().port + basePath;
  const url = base + '?entry=start#/care';
  const care = (page) => page.getByRole('heading', { name: '喂养记录' });
  const errors = [];
  const newPage = async () => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };

  const first = await newPage();
  await first.goto(url);
  await care(first).waitFor();
  await first.waitForFunction(() => !!navigator.serviceWorker.controller);
  await first.evaluate(() => caches.open('unrelated-cache').then(() => {}));
  assert.equal(await first.locator('body').getAttribute('data-test-release'), 'initial');
  await first.close();

  requests.length = 0;
  blockStatic = true;
  const warm = await newPage();
  await warm.goto(url);
  await care(warm).waitFor();
  assert.deepEqual(requests.filter((file) => file !== 'sw.js'), []);
  assert.equal(new URL(warm.url()).search, '?entry=start');
  const [a, b, type, ics] = await warm.evaluate(async () => {
    const a = await (await fetch('api/probe')).text();
    const b = await (await fetch('api/probe')).text();
    const ics = await fetch('ics/test.ics?d=' + btoa('BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
    return [a, b, ics.headers.get('content-type'), await ics.text()];
  });
  assert.deepEqual([a, b], ['1', '2']);
  assert.equal(type, 'text/calendar; charset=utf-8');
  assert.equal(ics, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  await warm.close();

  await context.setOffline(true);
  const offline = await newPage();
  await offline.goto(base + 'index.html#/settings');
  await offline.getByRole('button', { name: '使用帮助', exact: true }).waitFor();
  assert.match(await offline.locator('#appVer').innerText(), new RegExp('v' + version.replaceAll('.', '\\.')));
  await offline.close();
  await context.setOffline(false);

  blockStatic = false;
  const updated = await newPage();
  await updated.goto(url);
  await care(updated).waitFor();
  let reloads = 0;
  updated.on('framenavigated', (frame) => { if (frame === updated.mainFrame()) reloads++; });
  revision = 'hotfix';
  await updated.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await updated.waitForSelector('body[data-test-release="hotfix"]');
  await care(updated).waitFor();
  assert.equal(reloads, 1);
  assert.equal(new URL(updated.url()).search, '?entry=start');
  assert.deepEqual((await updated.evaluate(() => caches.keys())).sort(),
    ['baby-record-v' + version + '-hotfix', 'unrelated-cache']);
  assert.deepEqual(errors, []);
});
