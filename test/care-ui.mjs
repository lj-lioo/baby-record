import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('手机喂养页支持快捷记账、补记、编辑撤销、统计和离线重开', async (t) => {
  const site = fileURLToPath(new URL('../site/', import.meta.url));
  const version = /appVersion: '([^']+)'/.exec(fs.readFileSync(path.join(site, 'config.js'), 'utf8'))[1];
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': mime['.js'] });
      return res.end(`window.BABY_CONFIG = {appVersion: ${JSON.stringify(version)}, syncApi: '', photoApi: '', pushApi: ''};`);
    }
    const file = path.resolve(site, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(site) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally { await new Promise((resolve) => server.close(resolve)); }
  });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('babyrecord.v1')) {
      localStorage.setItem('babyrecord.v1', JSON.stringify({
        events: [], meds: [{ id: 'old', name: '演示旧用药', start: '2024-03-01', end: '2024-03-01' }],
        settings: { memberRole: '爸爸', babyName: '演示宝宝' },
      }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2024-03-01T01:10:00Z'));
  await page.goto(base + '/#/care');
  await page.getByRole('heading', { name: '喂养记录', exact: true }).waitFor();
  const timeline = page.locator('.care-timeline');
  const quick = (kind) => page.locator(`.care-quick-grid [data-care-kind="${kind}"]`);
  const save = () => page.locator('#care-form').getByRole('button', { name: '保存' }).click();

  await quick('nursing').click();
  await timeline.getByRole('button', { name: /09:10.*母乳亲喂/ }).click();
  await page.locator('#care-minutes').fill('13');
  await save();
  assert.match(await timeline.innerText(), /13 分钟/);

  await quick('bottle').click();
  await page.locator('#care-ml').fill('0');
  await save();
  await page.getByRole('alert').filter({ hasText: '请填写有效的奶量' }).waitFor();
  await page.locator('#care-ml').fill('90.5');
  await page.locator('#care-milk').selectOption('formula');
  await save();
  assert.match(await quick('bottle').innerText(), /瓶喂 90.5 mL/);
  await quick('bottle').click();
  assert.equal(await timeline.getByRole('button', { name: /瓶喂/ }).count(), 2);
  await page.getByRole('button', { name: '撤销刚才记录' }).click();
  assert.equal(await timeline.getByRole('button', { name: /瓶喂/ }).count(), 1);

  await quick('stool').click();
  await timeline.getByRole('button', { name: /排便/ }).click();
  await page.locator('#care-stool').selectOption('soft');
  await save();
  assert.match(await timeline.innerText(), /软便/);
  await quick('dose').click();
  await page.getByRole('button', { name: '维生素AD', exact: true }).click();
  await page.locator('#care-dose').fill('示例用量');
  await save();
  assert.match(await timeline.innerText(), /维生素AD\s+示例用量/);
  assert.match(await timeline.innerText(), /演示旧用药\s+原用药记录/);

  await page.getByRole('button', { name: '前一天' }).click();
  assert.equal(await page.locator('#care-day').inputValue(), '2024-02-29');
  await quick('bottle').click();
  assert.equal(await page.locator('#care-time').inputValue(), '');
  await page.locator('#care-time').fill('08:30');
  await page.locator('#care-ml').fill('65');
  await page.locator('#care-milk').selectOption('breast');
  await save();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.getByRole('button', { name: '近 90 天' }).click();
  assert.match(await page.locator('.care-stats').first().innerText(), /155.5 mL/);
  assert.match(await page.locator('.care-stats').first().innerText(), /母乳 65 mL · 配方奶 90.5 mL/);
  await page.getByRole('button', { name: '排便次数' }).click();
  assert.equal(await page.locator('.care-chart > span').count(), 90);
  await page.locator('.care-breakdown summary').click();
  assert.equal(await page.locator('.care-breakdown tbody tr').count(), 90);

  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('#care-day').inputValue(), '2024-03-01');
  await timeline.getByText('维生素AD', { exact: true }).waitFor();
  await page.evaluate(async () => (await import('/js/store.js')).store.updateSettings({ memberRole: '奶奶' }));
  assert.equal(await quick('bottle').count(), 0);
  assert.equal(await timeline.getByRole('button').count(), 0);
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  assert.deepEqual(errors, []);
});
