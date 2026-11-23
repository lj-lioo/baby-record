import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('设置底部可在浮层查看和跳转完整帮助', async (t) => {
  const site = fileURLToPath(new URL('../site/', import.meta.url));
  const version = /appVersion: '([^']+)'/.exec(await readFile(path.join(site, 'config.js'), 'utf8'))[1];
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': mime['.js'] });
      return res.end('window.BABY_CONFIG = ' + JSON.stringify({ appVersion: version }));
    }
    const file = path.resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname));
    try {
      if (!file.startsWith(site) || !(await stat(file)).isFile()) throw new Error('Not found');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(bytes);
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
    finally { await new Promise((resolve) => server.close(resolve)); }
  });
  browser = await chromium.launch();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    if (!localStorage.getItem('babyrecord.v1')) localStorage.setItem('babyrecord.v1', JSON.stringify({
      settings: { memberRole: '爸爸' },
    }));
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '#/settings');
  const entry = page.getByRole('button', { name: '使用帮助', exact: true });
  const help = page.getByRole('dialog', { name: '使用帮助' });
  const helpBody = help.locator('.help-window-body');
  const close = help.getByRole('button', { name: '关闭帮助' });
  const sheet = page.locator('#sheet');
  assert.equal(await entry.evaluate((node) => node === node.parentElement.lastElementChild), true);
  assert.equal(await page.locator('#tabbar [data-tab="help"]').count(), 0);
  await entry.click();
  await help.waitFor();
  const box = await help.boundingBox();
  assert.ok(box.x >= 10 && box.y > 30 && box.width < 390 && box.height < 844);
  assert.ok(await helpBody.locator('section.card').count() >= 12);
  assert.ok(await helpBody.evaluate((node) => node.scrollHeight > node.clientHeight));
  assert.equal(await close.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator('#app').evaluate((node) => node.inert), true);
  await helpBody.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  assert.ok(await helpBody.evaluate((node) => node.scrollTop > 0));
  // The shared sheet's swipe-to-dismiss gesture must not interrupt reading.
  await helpBody.evaluate((node) => {
    node.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, touches: [new Touch({ identifier: 1, target: node, clientY: 160 })],
    }));
    node.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, changedTouches: [new Touch({ identifier: 1, target: node, clientY: 330 })],
    }));
  });
  assert.equal(await close.isVisible(), true);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator('#app').evaluate((node) => node.inert), false);

  await page.locator('[data-settings-help]').first().click();
  await help.waitFor();
  await page.waitForFunction(() => {
    const content = document.querySelector('.help-window-body');
    const section = document.getElementById('h-shortcut');
    return content && section && Math.abs(section.getBoundingClientRect().top - content.getBoundingClientRect().top - 12) < 4;
  });
  await close.click();
  assert.equal(new URL(page.url()).hash, '#/settings');

  await page.evaluate(async () => {
    const { openAlarmSheet } = await import('/js/views/actions.js');
    openAlarmSheet({ id: 'help-demo', title: '连结测试', date: '2030-01-01', time: '08:00', category: 'other', reminders: [] });
  });
  await page.locator('#al-help').click();
  await help.waitFor();
  assert.ok(await helpBody.evaluate((node) => node.scrollTop > 0));
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await sheet.getAttribute('aria-labelledby'), null);

  await page.goto(base + '#/help?section=h-shortcut');
  await help.waitFor();
  assert.equal(new URL(page.url()).hash, '#/settings');
  await close.click();
  assert.equal(await page.getByRole('heading', { name: '设置', exact: true }).isVisible(), true);

  await page.evaluate(async () => (await import('/js/store.js')).store.updateSettings({ memberRole: '爷爷' }));
  await page.setViewportSize({ width: 320, height: 568 });
  assert.equal(await entry.evaluate((node) => node === node.parentElement.lastElementChild), true);
  await entry.click();
  await help.waitFor();
  assert.equal(await helpBody.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await page.mouse.click(4, 4);
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(errors, []);
});
