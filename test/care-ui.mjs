import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

test('手机喂养页支持喂奶切换、大小便多选和补记，以及语音、统计和离线重开', async (t) => {
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
        care: [
          { id: 'old-bottle', kind: 'bottle', date: '2024-02-29', time: '08:15', ml: 65, milk: 'breast', updatedAt: 1 },
          { id: 'old-nursing', kind: 'nursing', date: '2024-02-29', time: '07:30', ml: 42, minutes: 9, updatedAt: 1 },
        ],
        settings: { memberRole: '爸爸', babyName: '演示宝宝' },
      }));
    }
    window.SpeechRecognition = class {
      start() { window.careRecognizer = this; }
      stop() { this.stopped = true; }
      abort() { this.aborted = true; }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2024-03-01T01:10:00Z'));
  await page.goto(base + '/#/care');
  await page.getByRole('heading', { name: '喂养记录', exact: true }).waitFor();
  assert.deepEqual(await page.locator('#tabbar a').evaluateAll((links) => links.slice(0, 2).map((link) => link.dataset.tab)), ['care', 'home']);
  const timeline = page.locator('.care-timeline');
  const quick = (kind) => page.locator(`.care-quick-grid [data-care-kind="${kind}"]`);
  const save = () => page.locator('#care-form').getByRole('button', { name: '保存' }).click();
  const confirmToilet = () => page.getByRole('button', { name: '确认记录' }).click();
  const feed = (label) => page.getByRole('radio', { name: label, exact: true });
  const toilet = (label) => page.getByRole('checkbox', { name: label, exact: true });

  assert.equal(await page.locator('.care-quick-grid button').count(), 3);
  await quick('feed').click();
  assert.equal(await page.locator('#care-date').inputValue(), '2024-03-01');
  assert.equal(await page.locator('#care-time').inputValue(), '09:10');
  assert.equal(await feed('母乳').isChecked(), true);
  assert.equal(await page.locator('#care-ml').isHidden(), true);
  assert.equal(await page.locator('#care-milk').count(), 0);
  await feed('瓶喂').check();
  await page.locator('#care-ml').fill('200');
  await feed('母乳').check();
  await page.locator('#care-minutes').fill('13');
  await save();
  assert.match(await timeline.innerText(), /13 分钟/);
  assert.doesNotMatch(await timeline.innerText(), /200 mL/);

  await quick('feed').click();
  await feed('瓶喂').check();
  await page.locator('#care-ml').fill('0');
  await save();
  await page.getByRole('alert').filter({ hasText: '请填写有效的奶量' }).waitFor();
  await page.locator('#care-ml').fill('90.5');
  await save();
  assert.match(await timeline.innerText(), /瓶喂\s+90.5 mL/);

  await quick('toilet').click();
  assert.equal(await page.locator('#care-time').inputValue(), '09:10');
  await confirmToilet();
  await page.getByRole('alert').filter({ hasText: '至少选择大便或小便' }).waitFor();
  await toilet('大便').check();
  await toilet('小便').check();
  await page.locator('#care-stool').selectOption('soft');
  assert.equal(await timeline.getByRole('button', { name: /大便|小便/ }).count(), 0);
  await confirmToilet();
  assert.equal(await timeline.getByRole('button', { name: /09:10.*(?:大便|小便)/ }).count(), 2);
  assert.match(await timeline.innerText(), /软便/);
  await page.getByRole('button', { name: '撤销刚才记录' }).click();
  assert.equal(await timeline.getByRole('button', { name: /大便|小便/ }).count(), 0);

  await quick('toilet').click();
  await toilet('大便').check();
  await page.locator('#care-time').fill('09:00');
  await page.locator('#care-stool').selectOption('soft');
  await confirmToilet();
  assert.equal(await timeline.getByRole('button', { name: /09:00.*大便/ }).count(), 1);
  assert.equal(await timeline.getByRole('button', { name: /小便/ }).count(), 0);

  await quick('toilet').click();
  await toilet('小便').check();
  assert.equal(await page.locator('#care-stool').isHidden(), true);
  await page.locator('#care-date').fill('2024-02-29');
  await page.locator('#care-time').fill('08:40');
  await confirmToilet();
  assert.equal(await page.locator('#care-day').inputValue(), '2024-02-29');
  assert.equal(await timeline.getByRole('button', { name: /08:40.*小便/ }).count(), 1);
  assert.equal(await timeline.getByRole('button', { name: /大便/ }).count(), 0);
  await page.getByRole('button', { name: '今天', exact: true }).click();

  await quick('dose').click();
  await page.getByRole('button', { name: '维生素AD', exact: true }).click();
  await page.locator('#care-dose').fill('示例用量');
  await save();
  assert.match(await timeline.innerText(), /维生素AD\s+示例用量/);
  assert.match(await timeline.innerText(), /演示旧用药\s+原用药记录/);

  await page.getByRole('button', { name: '前一天' }).click();
  assert.equal(await page.locator('#care-day').inputValue(), '2024-02-29');
  await timeline.getByRole('button', { name: /08:15.*瓶喂/ }).click();
  assert.equal(await feed('瓶喂').isChecked(), true);
  assert.equal(await page.locator('#care-ml').inputValue(), '65');
  await save();
  assert.match(await timeline.innerText(), /65 mL · 母乳/);
  await timeline.getByRole('button', { name: /07:30.*母乳亲喂/ }).click();
  assert.equal(await page.locator('#care-ml').isHidden(), true);
  await page.locator('#care-minutes').fill('10');
  await save();
  assert.match(await timeline.innerText(), /10 分钟 · 实测 42 mL/);
  await quick('feed').click();
  await feed('瓶喂').check();
  assert.equal(await page.locator('#care-time').inputValue(), '');
  await page.locator('#care-time').fill('08:30');
  await page.locator('#care-ml').fill('40');
  await save();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.getByRole('button', { name: '近 90 天' }).click();
  assert.match(await page.locator('.care-stats').first().innerText(), /195.5 mL/);
  assert.match(await page.locator('.care-stats').first().innerText(), /母乳 65 mL · 未标注 130.5 mL/);
  await page.getByRole('button', { name: '小便次数' }).click();
  assert.equal(await page.locator('.care-chart > span').count(), 90);
  await page.locator('.care-breakdown summary').click();
  assert.equal(await page.locator('.care-breakdown tbody tr').count(), 90);
  assert.match(await page.locator('.care-breakdown thead').innerText(), /大便.*小便/s);

  await page.getByRole('button', { name: '记录', exact: true }).click();
  const voice = page.getByRole('button', { name: /语音听写/ });
  await voice.click();
  const conversation = page.getByRole('log', { name: '喂养记录对话' });
  const mic = page.locator('#care-voice-mic');
  const dictation = page.locator('#care-voice-text');
  const status = page.locator('#care-voice-status');
  const notice = page.locator('#care-voice-notice');
  const webMic = page.getByRole('button', { name: '网页麦克风' });
  const processText = page.getByRole('button', { name: '处理文字' });
  const startCapture = () => page.evaluate(() => window.careRecognizer.onaudiostart());
  const emitSpeech = (text, final, end = false) => page.evaluate(({ text, final, end }) => {
    const recognizer = window.careRecognizer;
    recognizer.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    if (end) recognizer.onend();
  }, { text, final, end });
  await status.filter({ hasText: '正在打开麦克风' }).waitFor();
  await startCapture();
  await status.filter({ hasText: '正在听写' }).waitFor();
  await emitSpeech('刚才瓶喂了八十毫升', false);
  assert.equal(await page.locator('#care-voice-draft').innerText(), '刚才瓶喂了八十毫升');
  assert.equal(await conversation.getByText(/已记录/).count(), 0);
  await page.evaluate(() => window.careRecognizer.onspeechend?.());
  assert.equal(await page.evaluate(() => !!window.careRecognizer.stopped), false);
  await emitSpeech('早上8:00为了奶', true, true);
  await conversation.getByText(/母乳亲喂，还是用奶瓶喂/).waitFor();
  assert.equal(await page.evaluate(() => !!window.careRecognizer.aborted), false);
  await mic.click();
  await emitSpeech('用瓶子味的喝了30毫升', true);
  await conversation.getByText(/已记录 1 条.*08:00.*瓶喂.*30 mL/s).waitFor();
  assert.equal(await conversation.getByText(/母乳亲喂，还是用奶瓶喂/).count(), 1);
  assert.equal(await timeline.getByText('30 mL', { exact: true }).count(), 1);
  await page.getByRole('button', { name: '撤销本次记录' }).click();
  assert.equal(await timeline.getByText('30 mL', { exact: true }).count(), 0);
  await mic.click();
  await emitSpeech('上午八点瓶喂了一百毫升', true);
  await page.getByRole('button', { name: '取消听写' }).click();
  assert.equal(await page.evaluate(() => window.careRecognizer.aborted), true);
  assert.equal(await timeline.getByText('100 mL', { exact: true }).count(), 0);

  await mic.click();
  await startCapture();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForFunction(() => window.careRecognizer.aborted);
  await voice.click();
  await status.filter({ hasText: '正在打开麦克风' }).waitFor();
  await startCapture();
  await emitSpeech('早上8:00为了奶', true, true);
  await conversation.getByText(/母乳亲喂，还是用奶瓶喂/).waitFor();
  await page.clock.install({ time: new Date('2024-03-01T01:10:00Z') });
  await mic.click();
  await startCapture();
  await page.clock.fastForward(8100);
  await notice.filter({ hasText: '识别服务没有返回文字' }).waitFor();
  assert.equal(await dictation.isVisible(), true);
  assert.equal(await status.isVisible(), false);
  assert.equal(await page.evaluate(() => window.careRecognizer.aborted), true);
  await dictation.fill('母乳');
  await conversation.getByText(/已记录 1 条.*08:00.*母乳亲喂/s).waitFor();
  await page.getByRole('button', { name: '撤销本次记录' }).click();

  await webMic.click();
  await page.clock.fastForward(20100);
  await notice.filter({ hasText: '麦克风未开始收音' }).waitFor();
  assert.equal(await dictation.isVisible(), true);

  for (const [error, feedback] of [
    ['no-speech', '没听清'],
    ['not-allowed', '麦克风权限受限'],
    ['network', '语音识别连接失败'],
    ['audio-capture', '无法录音'],
    ['service-not-allowed', '当前打开方式无法使用语音识别服务'],
  ]) {
    await webMic.click();
    await page.evaluate((error) => window.careRecognizer.onerror({ error }), error);
    await notice.filter({ hasText: feedback }).waitFor();
    assert.equal(await dictation.isVisible(), true);
  }
  await page.evaluate(() => {
    const start = window.SpeechRecognition.prototype.start;
    window.SpeechRecognition.prototype.start = function () {
      window.SpeechRecognition.prototype.start = start;
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await webMic.click();
  await notice.filter({ hasText: '麦克风权限受限' }).waitFor();
  assert.equal(await dictation.isVisible(), true);
  await page.getByRole('button', { name: '打开系统键盘' }).click();
  assert.equal(await dictation.evaluate((input) => input === document.activeElement), true);
  assert.equal(await processText.isVisible(), true);
  await dictation.fill('早上八点亲喂了十二分钟');
  await dictation.fill('早上八点亲喂了十二分钟，然后刚刚拉了一次软便');
  await conversation.getByText(/已记录 2 条/).waitFor();
  assert.equal(await timeline.getByText('12 分钟', { exact: true }).count(), 1);

  await page.getByRole('button', { name: '打字' }).click();
  await dictation.fill('晚点喂70毫升配方奶');
  await page.getByRole('button', { name: '发送' }).click();
  await conversation.getByText(/疑问、否定或计划/).waitFor();
  assert.equal(await timeline.getByText(/70 mL/).count(), 0);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
    window.previousCareRecognizer = window.careRecognizer;
  });
  await voice.tap();
  assert.equal(await page.evaluate(() => window.careRecognizer === window.previousCareRecognizer), true);
  assert.equal(await mic.isVisible(), false);
  assert.equal(await dictation.evaluate((input) => input === document.activeElement), true);
  await processText.tap();
  await notice.filter({ hasText: '还没有文字' }).waitFor();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: window.innerHeight - 250 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  assert.ok(await page.locator('#sheet').evaluate((sheet) => parseInt(getComputedStyle(sheet).bottom, 10) > 0));
  // Some keyboards can leave visible text without delivering an input event.
  await dictation.evaluate((input) => { input.value = '早上8:00为了三瓶奶'; });
  await processText.tap();
  await conversation.getByText(/实际喝下了多少毫升/).waitFor();
  await dictation.fill('实际喝了三十');
  await conversation.getByText(/已记录 1 条.*08:00.*30 mL/s).waitFor();
  await page.getByRole('button', { name: '撤销本次记录' }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await page.locator('#sheet').evaluate((sheet) => sheet.style.getPropertyValue('--care-keyboard-inset')), '');

  await page.evaluate(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  });
  await voice.click();
  assert.equal(await webMic.isVisible(), false);
  assert.equal(await dictation.isVisible(), true);
  assert.equal(await processText.isVisible(), true);
  await dictation.fill('刚才小便了');
  await conversation.getByText(/已记录 1 条.*小便/s).waitFor();
  assert.equal(await timeline.getByRole('button', { name: /09:10.*小便/ }).count(), 1);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('#care-day').inputValue(), '2024-03-01');
  await timeline.getByText('维生素AD', { exact: true }).waitFor();
  await page.evaluate(async () => (await import('/js/store.js')).store.updateSettings({ memberRole: '奶奶' }));
  assert.equal(await quick('feed').count(), 0);
  assert.equal(await timeline.getByRole('button').count(), 0);
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  assert.deepEqual(errors, []);
});
