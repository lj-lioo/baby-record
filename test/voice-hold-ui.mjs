// v1.11.2 点一下说话：mock SpeechRecognition，连续 5 次「点开始→模拟结果→点结束」都能用；看门狗；降级提示
import { chromium } from 'playwright';
import { createServer } from 'http';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)); const site = path.join(here, '../site');
const srv = createServer((req, res) => { let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const fp = path.join(site, u);
  if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' }[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(res); }).listen(8098);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
await ctx.addInitScript(() => {
  localStorage.setItem('babyrecord.hideBanner', '1'); localStorage.setItem('babyrecord.hideChkCta', '1');
  window.__recs = []; window.__mode = 'ok';
  window.webkitSpeechRecognition = class { constructor() { window.__recs.push(this); this.started = false; this.aborted = false; }
    start() { if (window.__mode === 'throw') throw new Error('x'); this.started = true; }
    stop() { const t = this; setTimeout(() => { if (window.__mode === 'noend') return; if (t.text) t.onresult && t.onresult({ results: [[{ transcript: t.text }]] }); t.onend && t.onend(); }, 50); }
    abort() { this.aborted = true; } }; window.SpeechRecognition = window.webkitSpeechRecognition;
});
const page = await ctx.newPage();
let pass = 0, fail = 0; const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? '✅' : '❌', n, x); };
await page.goto('http://127.0.0.1:8098/'); await page.waitForTimeout(400);
await page.click('#btnVoice'); await page.waitForTimeout(200);
const btn = page.locator('#v-hold');
check('点一下说话按钮可见', await btn.isVisible());
check('空闲文案', (await btn.textContent()).includes('点一下说话'));

const tap = async () => {
  // Playwright click → 真实 click 事件（点按制）；间隔大于防抖
  await page.waitForTimeout(400);
  await btn.click();
};

const cycle = async (text) => {
  const n0 = await page.evaluate(() => window.__recs.length);
  await tap();
  const st = await page.evaluate((n0) => ({ n: window.__recs.length - n0, on: document.getElementById('v-hold').classList.contains('on'), txt: document.getElementById('v-hold').textContent }), n0);
  await page.evaluate((t) => { const r = window.__recs.at(-1); if (r) r.text = t; }, text);
  await tap(); // 结束
  await page.waitForTimeout(150);
  return st;
};

const words = ['11月5号买奶粉', '明天下午3点体检', '下周六打疫苗', '20号买尿布', '月底剪头发'];
for (let i = 0; i < 5; i++) {
  const st = await cycle(words[i]);
  check(`第${i + 1}次点开始：新建1个实例并进入聆听`, st.n === 1 && st.on && st.txt.includes('正在听') && st.txt.includes('再点一下结束'), JSON.stringify(st));
  check(`第${i + 1}次点结束：复位`, !(await btn.getAttribute('class') || '').split(/\s+/).includes('on') && (await btn.textContent()).includes('点一下说话'));
}
const v = await page.inputValue('#v-text');
check('5 段文字都追加（不覆盖）', words.every((w) => v.includes(w)), v);
await page.waitForTimeout(400);
check('解析出 5 张卡', (await page.locator('.v-card').count()) === 5);
check('旧实例都 abort', await page.evaluate(() => window.__recs.slice(0, -1).every((r) => r.aborted)));
await page.screenshot({ path: path.join(here, '../screenshots/54-voice-hold.png') });

// 结束后看门狗：onend 不来 → 1.5s 强制复位
await page.evaluate(() => { window.__mode = 'noend'; });
await tap(); // start
check('noend 模式进入聆听', (await btn.getAttribute('class') || '').includes('on'));
await tap(); // end → stop() 不触发 onend
await page.waitForTimeout(1700);
check('onend 不触发时 1.5s 强制复位', !(await btn.getAttribute('class') || '').split(/\s+/).includes('on') && (await btn.textContent()).includes('点一下说话'));
await page.evaluate(() => { window.__mode = 'ok'; });
const st = await cycle('还能用');
check('强制复位后还能再启动', st.on && st.n === 1);

// 降级：两次失败（start throw）
await page.evaluate(() => { window.__mode = 'throw'; });
await tap(); check('一次失败无提示', await page.locator('#v-hold-tip').isHidden());
await page.waitForTimeout(400); await tap(); await page.waitForTimeout(100);
check('两次失败显示降级提示', (await page.locator('#v-hold-tip').innerText()).includes('请用键盘上的 🎤'));
check('焦点回到输入框', await page.evaluate(() => document.activeElement.id === 'v-text'));

await page.evaluate(() => { window.__mode = 'ok'; });
await page.waitForTimeout(400);
// onerror not-allowed 两次
await page.reload(); await page.waitForTimeout(300); await page.click('#btnVoice'); await page.waitForTimeout(200);
for (let k = 0; k < 2; k++) {
  await page.waitForTimeout(400);
  await btn.click();
  await page.evaluate(() => { const r = window.__recs.at(-1); r.onerror({ error: 'not-allowed' }); });
}
check('onerror not-allowed 两次后降级', (await page.locator('#v-hold-tip').innerText()).includes('键盘'));
await page.screenshot({ path: path.join(here, '../screenshots/55-voice-hold-fallback.png') });
check('无页面错误', !errs.length, errs.join(';'));
console.log(`\n${pass} 通过, ${fail} 失败`); await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
