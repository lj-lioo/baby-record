// 端到端：自费疫苗计划 + 「自费疫苗」类别（iPhone 尺寸），截图 15/16/17。BASE=... 可指定地址
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = '/workspace/baby-app/screenshots/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-09-29T16:30:00+08:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push/i.test(m.text())) errors.push(m.text()); });
await page.goto(BASE);
await page.evaluate(() => { localStorage.setItem('babyrecord.hideBanner', '1'); localStorage.setItem('babyrecord.hideChkCta', '1'); });
await page.reload(); await page.waitForTimeout(800);
const events = () => page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events);

// 先生成免费疫苗计划（日历上才能看到两种颜色）
await page.click('#vaxGo'); await page.waitForSelector('.vp-item'); await page.click('#vp-ok'); await page.waitForTimeout(500);

await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
const verTxt = await page.textContent('#appVer');
ok('设置页版本 v1.6.0', verTxt.includes('宝宝记录 v1.6.0'), verTxt + ' ' + page.url() + ' ' + (await page.locator('#vaxCard').count()));
ok('「一键生成日程」有第三个按钮「💰自费疫苗(可选)」', (await page.textContent('#btnPaid')).trim() === '💰自费疫苗(可选)');
ok('显示「已生成的自费疫苗事项 0 个」', (await page.locator('#vaxCard').innerText()).includes('已生成的自费疫苗事项\n0 个') || /自费疫苗事项\s*0 个/.test(await page.locator('#vaxCard').innerText()));
await page.click('#btnPaid');
await page.waitForSelector('.vp-item');
ok('默认生日 2026-09-17', (await page.inputValue('#vp-bday')) === '2026-09-17');
ok('预览 29 项（默认 18 + 备选 11）', (await page.locator('.vp-item').count()) === 29, `n=${await page.locator('.vp-item').count()}`);
ok('默认勾选 18 项（RSV + 常用方案），备选不勾选', (await page.locator('.vp-item input:checked').count()) === 18 && (await page.locator('.vp-item.is-opt input:checked').count()) === 0);
const first = await page.locator('.vp-item').first().innerText();
ok('第一项 RSV单抗 2026年10月17日，标「已安排」', first.includes('RSV单抗（尼塞韦单抗）') && first.includes('2026年10月17日') && (await page.locator('.vp-item.is-req').count()) === 1, first.replace(/\n/g, ' | '));
ok('有「备选方案」分组标题', (await page.locator('.vp-group').innerText()).includes('备选方案'));
ok('标题「(可选·自费) 13价肺炎 第1剂」', (await page.locator('.vp-item').nth(1).innerText()).includes('(可选·自费) 13价肺炎 第1剂'));
ok('按钮「添加 18 个自费疫苗事项」、蓝色', (await page.textContent('#vp-ok')).includes('添加 18 个自费疫苗事项') && (await page.$eval('#vp-ok', (b) => getComputedStyle(b).backgroundColor)) === 'rgb(31, 143, 229)');
ok('免责：以接种门诊建议为准', (await page.locator('#sheet').innerText()).includes('以接种门诊建议为准'));
await page.evaluate(() => { document.activeElement?.blur(); document.getElementById('toast').hidden = true; }); await page.waitForTimeout(500);
await page.screenshot({ path: SHOTS + '15-paid-plan-preview.png' });
await page.evaluate(() => document.querySelector('.vp-group').scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '17-paid-plan-alternatives.png' });
await page.click('#vp-ok'); await page.waitForTimeout(600);

const evs = await events();
const paid = evs.filter((e) => (e.scheduleId || '').startsWith('paid:'));
ok('已添加 18 个（类别=自费疫苗，09:00，前一天20:00+当天08:00）', paid.length === 18 && paid.every((e) => e.category === 'paidvax' && e.time === '09:00' && e.reminders.map((r) => r.preset).join(',') === 'eve20,morning8'), `n=${paid.length}`);
const rsv = paid.find((e) => e.scheduleId === 'paid:rsv');
ok('RSV：2026-10-17 09:00，标题无(可选)，备注含与乙肝第2剂同一天/剂量', rsv && rsv.date === '2026-10-17' && rsv.title === 'RSV单抗（尼塞韦单抗）' && /乙肝疫苗第2剂同一天/.test(rsv.note) && /50mg/.test(rsv.note));
ok('RSV 与免费乙肝第2剂同一天', evs.some((e) => e.scheduleId === 'nip:hepb-2' && e.date === rsv.date));

// 日历：两种疫苗颜色
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-11-17' })));
await page.waitForTimeout(500);
const cell = page.locator('.day[data-date="2026-11-17"]');
ok('11月17日同时有紫色(免费)和蓝色(自费)圆点', (await cell.locator('.dot.cat-vaccine').count()) >= 1 && (await cell.locator('.dot.cat-paidvax').count()) >= 1);
ok('蓝色圆点颜色 #1F8FE5', (await cell.locator('.dot.cat-paidvax').first().evaluate((d) => getComputedStyle(d).backgroundColor)) === 'rgb(31, 143, 229)');
ok('图例含「自费疫苗」', (await page.locator('.legend').innerText()).includes('自费疫苗'));
ok('当天列表有蓝色的自费疫苗卡片', (await page.locator('#dayCard .item.cat-paidvax').count()) >= 3);
await page.evaluate(() => { document.getElementById('toast').hidden = true; document.getElementById('calCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); });
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + '16-calendar-two-colors.png' });
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2027-04-17' })));
await page.waitForTimeout(400);
ok('只有自费疫苗的日子（2027-04-17 EV71）有蓝色 💰 角标', (await page.locator('.day[data-date="2027-04-17"].has-paidvax .vbadge.paid').count()) === 1);

// 编辑器类别、提醒文字、快捷指令、ICS、全屏提醒
const r = await page.evaluate(async () => {
  const { buildICS } = await import('./js/ics.js');
  const { notifyBody } = await import('./js/reminders.js');
  const { alarmLines } = await import('./js/shortcuts.js');
  const { store, normalizeEvent } = await import('./js/store.js');
  const ev = store.events().find((e) => e.scheduleId === 'paid:pcv13-1');
  const ics = buildICS(ev);
  const body = notifyBody(ev, Date.now(), '提前一天');
  const lines = alarmLines(ev, [{ fireAt: new Date('2026-11-16T20:00:00+08:00').getTime(), label: '前一天 20:00' }]);
  const repaired = normalizeEvent({ id: 'x', date: '2026-10-17', title: 'RSV', category: 'other', scheduleId: 'paid:rsv', updatedAt: 5 });
  const unknown = normalizeEvent({ id: 'y', date: '2026-10-17', title: 'X', category: 'weird', scheduleId: 'paid:x' });
  const plainOther = normalizeEvent({ id: 'z', date: '2026-10-17', title: 'Y', category: 'other' });
  store.applyRemote({ upserts: [{ id: 'old1', date: '2026-12-01', title: '(可选·自费) 旧客户端存的', category: 'other', scheduleId: 'paid:zz', updatedAt: 7 }] });
  const applied = store.events().find((e) => e.id === 'old1');
  store.deleteEvent('old1');
  return { ics: ics.includes('CATEGORIES:自费疫苗'), body, line: lines[0], repaired: [repaired.category, repaired.updatedAt], unknown: unknown.category, plainOther: plainOther.category, applied: applied.category };
});
ok('ICS 类别=自费疫苗', r.ics);
ok('通知正文「💰 自费疫苗」', r.body.startsWith('💰 自费疫苗'), r.body.split('\n')[0]);
ok('闹钟快捷指令备注「💰自费疫苗」', r.line.includes('💰自费疫苗'), r.line);
ok('兼容：旧版本存成 other 的 paid: 事项自动改回 paidvax（不改 updatedAt，不会重复上传）', r.repaired[0] === 'paidvax' && r.repaired[1] === 5 && r.unknown === 'paidvax' && r.plainOther === 'other' && r.applied === 'paidvax', JSON.stringify(r));

await page.click('#fab'); await page.waitForSelector('#f-cat');
ok('编辑器类别有 4 个（含 💰 自费疫苗）', (await page.locator('#f-cat button').count()) === 4 && (await page.locator('#f-cat button[data-cat="paidvax"]').innerText()).includes('自费疫苗'));
await page.click('#f-cat button[data-cat="paidvax"]');
ok('选中后蓝色 + 快捷标题含 13价肺炎', (await page.$eval('#f-cat button[data-cat="paidvax"]', (b) => getComputedStyle(b).backgroundColor)) === 'rgb(31, 143, 229)' && (await page.locator('#f-quick').innerText()).includes('13价肺炎'));
await page.keyboard.press('Escape'); await page.evaluate(async () => (await import('./js/ui.js')).closeSheet?.()); await page.waitForTimeout(300);

await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const { showAlarm } = await import('./js/views/alarm.js');
  const ev = store.events().find((e) => e.scheduleId === 'paid:rsv');
  showAlarm({ rid: 'test', eventId: ev.id, fireAt: Date.now(), label: '测试' });
});
await page.waitForTimeout(300);
ok('全屏提醒：蓝色主题 + 💰 + 「自费疫苗」', (await page.getAttribute('#alarm', 'class')).includes('cat-paidvax') && (await page.locator('#alarm .bell').innerText()).includes('💰') && (await page.locator('#alarm .a-top').innerText()).includes('自费疫苗'));
await page.evaluate(async () => (await import('./js/views/alarm.js')).closeAlarm());

// 重新打开 App（从 localStorage 读取）：数据不丢；旧版本存成 other 的 paid: 事项自动改回自费疫苗
const nBefore = (await events()).length;
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('babyrecord.v1')); d.events.push({ id: 'old2', date: '2026-12-02', title: '旧版存的', category: 'other', scheduleId: 'paid:zz2', updatedAt: 9, reminders: [] }); localStorage.setItem('babyrecord.v1', JSON.stringify(d)); });
await page.reload(); await page.waitForTimeout(800);
const reloaded = await page.evaluate(async () => (await import('./js/store.js')).store.events().map((e) => [e.id, e.category, e.updatedAt]));
ok('重新打开后事项全部还在（读取数据不报错）', reloaded.length === nBefore + 1, `before=${nBefore} after=${reloaded.length}`);
ok('重新打开后旧版 other 的 paid: 事项显示为自费疫苗（updatedAt 不变）', reloaded.some(([id, c, u]) => id === 'old2' && c === 'paidvax' && u === 9));
await page.evaluate(async () => (await import('./js/store.js')).store.deleteEvent('old2'));

// 再次生成：不重复
await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
ok('设置页显示自费疫苗 18 个', /自费疫苗事项\s*18 个/.test(await page.locator('#vaxCard').innerText()));
await page.click('#btnPaid'); await page.waitForSelector('.vp-item');
ok('再次打开：18 个已添加，按钮禁用', (await page.locator('.vp-item.is-have').count()) === 18 && await page.isDisabled('#vp-ok'));
ok('免费疫苗计划不受影响（20 个 nip）', (await events()).filter((e) => (e.scheduleId || '').startsWith('nip:')).length === 20);
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
fs.writeFileSync('/workspace/baby-app/test/results-paidvax.json', JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
