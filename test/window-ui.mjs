// 端到端（iPhone 尺寸）：v1.6.0 起 本月全部事项列表 + 接种窗口 + 计划日（改计划日），截图 18~22。BASE=... 可指定地址
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
const bySid = async (sid) => (await events()).find((e) => e.scheduleId === sid);
const hideToast = () => page.evaluate(() => { document.activeElement?.blur(); const t = document.getElementById('toast'); if (t) t.hidden = true; });
const selectDate = (d) => page.evaluate((d) => window.dispatchEvent(new CustomEvent('select-date', { detail: d })), d);

// 生成免费疫苗 / 体检计划；自费疫苗（v1.7.0 起默认待定）从「💰 自费疫苗（待定）」加入：RSV 10-17，13价、五价轮状第1剂 11-17
await page.click('#vaxGo'); await page.waitForSelector('.vp-item'); await page.click('#vp-ok'); await page.waitForTimeout(500);
await page.goto(BASE + '#/settings'); await page.waitForTimeout(400);
await page.click('#btnChk'); await page.waitForSelector('.vp-item'); await page.click('#vp-ok'); await page.waitForTimeout(500);
for (const [fam, date] of [['rsv', '2026-10-17'], ['pcv13', '2026-11-17'], ['rota5', '2026-11-17']]) {
  await page.goto(BASE + '#/settings'); await page.waitForTimeout(400);
  await page.click('#btnPaid'); await page.waitForSelector('#sheet .pc-item');
  await page.evaluate((f) => { document.querySelector(`#sheet .pc-item[data-fam="${f}"]`).open = true; }, fam);
  await page.click(`#sheet [data-add="${fam}"]`); await page.waitForSelector('#sp-list li');
  await page.fill('#sp-date', date); await page.waitForTimeout(150);
  await page.click('#sp-ok'); await page.waitForTimeout(500);
}
await page.goto(BASE + '#/settings'); await page.waitForTimeout(400);
ok('设置页版本 v1.7.0', (await page.textContent('#appVer')).includes('宝宝记录 v1.7.0'));

// 生成的事项带窗口字段；计划日（date）不变
const hb2 = await bySid('nip:hepb-2'), hb3 = await bySid('nip:hepb-3'), rsv = await bySid('paid:rsv'), m1 = await bySid('chk:m1');
ok('乙肝第2剂：最早=计划=2026-10-17，未规定最迟', hb2.date === '2026-10-17' && hb2.earliest === '2026-10-17' && hb2.latest === '', JSON.stringify([hb2.earliest, hb2.latest]));
ok('乙肝第3剂：最迟 2027-09-16（<12月龄）', hb3.latest === '2027-09-16');
ok('RSV：最早 09-17、计划 10-17、最迟 2027-03-31', rsv.earliest === '2026-09-17' && rsv.date === '2026-10-17' && rsv.latest === '2027-03-31');
ok('满月体检：窗口 10-15 ~ 10-29（参考），计划 10-17', m1.earliest === '2026-10-15' && m1.latest === '2026-10-29' && m1.date === '2026-10-17' && /参考/.test(m1.windowNote));

// 补两个手动事项：10月9日「办医保」、9月20日未完成的「新生儿家访」（过期）
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  store.upsertEvent({ id: 'man-yb', title: '办医保', date: '2026-10-09', time: '', category: 'other', note: '', reminders: [], done: false });
  store.upsertEvent({ id: 'man-fs', title: '新生儿家访', date: '2026-09-20', time: '10:00', category: 'checkup', note: '', reminders: [], done: false });
});

// 1) 翻到 10 月（不点任何日期），日历下面就列出 10 月全部事项，按日期分组
await page.goto(BASE + '#/'); await page.waitForTimeout(400);
await selectDate('2026-09-29'); await page.waitForTimeout(300);
await page.click('#nextM'); await page.waitForTimeout(400);
ok('翻到 2026年10月', (await page.textContent('.month')).includes('2026年10月'));
const head = await page.locator('#dayCard .day-panel-head').innerText();
ok('列表标题「10月的事项 共 4 个」', head.includes('10月的事项') && head.includes('共 4 个'), head.replace(/\n/g, ' '));
const groups = await page.locator('#dayCard .grp').evaluateAll((gs) => gs.map((g) => g.id));
ok('按日期分组：10月9日、10月17日', JSON.stringify(groups) === JSON.stringify(['g-2026-10-09', 'g-2026-10-17']), JSON.stringify(groups));
const g17 = page.locator('#g-2026-10-17');
const g17h = await g17.locator('.grp-head').innerText();
ok('分组标题「10月17日 周六 · 还有18天」', g17h.includes('10月17日 周六') && g17h.includes('还有18天'), g17h.replace(/\n/g, ' '));
const g17t = await g17.innerText();
ok('10月17日组里有 乙肝第2剂 / 满月体检 / RSV单抗（无需点日期）', ['乙肝疫苗 第2剂', '满月体检', 'RSV单抗'].every((s) => g17t.includes(s)));
ok('不点日期时没有选中分组', (await page.locator('#dayCard .grp.sel').count()) === 0);
await hideToast();
await page.evaluate(() => { document.getElementById('calCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '18-month-list-october.png' });
await page.evaluate(() => { document.getElementById('g-2026-10-17').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '19-month-list-oct17-group.png' });

// 卡片：最早 / 计划 / 窗口 / 状态
const rsvCard = page.locator(`#g-2026-10-17 .item[data-id="${rsv.id}"]`);
const rsvTxt = await rsvCard.innerText();
ok('RSV 卡片：「最早 9月17日 周四 · 计划 10月17日 周六 09:00」', rsvTxt.includes('最早 9月17日 周四 · 计划 10月17日 周六 09:00'), rsvTxt.split('\n').slice(1, 3).join(' | '));
ok('RSV 卡片：「接种窗口（参考）：9月17日 – 2027年3月31日（最迟） · 窗口中（还剩183天）」', rsvTxt.includes('接种窗口（参考）：9月17日 – 2027年3月31日（最迟）') && rsvTxt.includes('窗口中（还剩183天）'));
const hbTxt = await page.locator(`.item[data-id="${hb2.id}"]`).innerText();
ok('乙肝第2剂卡片：「计划 10月17日 周六 09:00（最早可接种日）」「10月17日 起（未规定最迟）· 未到窗口（还有18天）」', hbTxt.includes('计划 10月17日 周六 09:00（最早可接种日）') && hbTxt.includes('10月17日 起（未规定最迟）') && hbTxt.includes('未到窗口（还有18天）'));
const m1Txt = await page.locator(`.item[data-id="${m1.id}"]`).innerText();
ok('满月体检卡片：「体检窗口（参考）：10月15日 – 10月29日（最迟）」', m1Txt.includes('体检窗口（参考）：10月15日 – 10月29日（最迟）'));
ok('手动事项（办医保）没有窗口行、没有改计划日', (await page.locator('.item[data-id="man-yb"] .iwin').count()) === 0 && (await page.locator('.item[data-id="man-yb"] [data-act=plan]').count()) === 0);
ok('每个疫苗/体检卡片都有「📆 改计划日」', (await page.locator('#g-2026-10-17 [data-act=plan]').count()) === 3);

// 日历标记：● 计划日，○ 最早日（与计划日不同）
ok('10月15日（满月体检最早）有空心圈 ○', (await page.locator('.day[data-date="2026-10-15"] .ring.cat-checkup').count()) === 1);
ok('10月29日（13价/轮状首剂最早）有 2 个蓝色空心圈', (await page.locator('.day[data-date="2026-10-29"] .ring.cat-paidvax').count()) === 2);
ok('10月17日有实心圆点 ●（3个）', (await page.locator('.day[data-date="2026-10-17"] .dot').count()) === 3);
ok('图例第二行：计划日 / 最早可接种 / 窗口 / 最迟', /计划日[\s\S]*最早可接种[\s\S]*窗口[\s\S]*最迟/.test(await page.locator('.legend2').innerText()));
ok('未选事项时日历上没有窗口底色', (await page.locator('.day.win').count()) === 0);

// 2) 点 17 号：跳到并高亮该组；日历显示最迟日期最近的事项（满月体检）的窗口
await page.click('.day[data-date="2026-10-17"]'); await page.waitForTimeout(900);
ok('点 17 号后 10月17日组高亮', await g17.evaluate((g) => g.classList.contains('sel')));
ok('点 17 号后仍列出全月（办医保组还在）', (await page.locator('#g-2026-10-09').count()) === 1);
const winDays = await page.locator('.day.win.win-checkup').evaluateAll((ds) => ds.map((d) => d.dataset.date));
ok('日历窗口底色：10月15日 ~ 10月29日（15天，体检绿色）', winDays.length === 15 && winDays[0] === '2026-10-15' && winDays.at(-1) === '2026-10-29', `${winDays[0]}..${winDays.at(-1)} n=${winDays.length}`);
ok('最早日虚线圈（10月15日）、计划日实心（10月17日）、最迟日「止」（10月29日）', await page.locator('.day[data-date="2026-10-15"].early-focus').count() === 1 && await page.locator('.day[data-date="2026-10-17"].plan-focus').count() === 1 && (await page.locator('.day[data-date="2026-10-29"].late-focus .lbadge').innerText()) === '止');
ok('日历下方显示「满月体检：10月15日 – 10月29日（最迟）」', (await page.locator('.focus-bar').innerText()).includes('满月体检：10月15日 – 10月29日（最迟）'));
ok('满月体检卡片高亮并显示窗口说明', await page.locator(`.item[data-id="${m1.id}"].is-focus .inote`).count() === 1);
await hideToast();
await page.evaluate(() => { document.getElementById('calCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '20-calendar-window-marks.png' });
await page.locator('#fbX').click(); await page.waitForTimeout(300);
ok('点 ✕ 取消窗口显示', (await page.locator('.day.win').count()) === 0);

// 3) 给乙肝第2剂设过闹钟，再改计划日到 10月20日 周二 10:30
await page.locator(`.item[data-id="${hb2.id}"] [data-act=alarm]`).click(); await page.waitForSelector('#al-added');
await page.check('#al-added'); await page.waitForTimeout(200);
await page.evaluate(async () => (await import('./js/ui.js')).closeSheet());
await page.waitForTimeout(300);
ok('乙肝第2剂已标记「已设闹钟」', (await bySid('nip:hepb-2')).alarmAdded === true && (await page.locator(`.item[data-id="${hb2.id}"] .alarm-btn.added`).count()) === 1);
const before = await bySid('nip:hepb-2');

await page.locator(`.item[data-id="${hb2.id}"] [data-act=plan]`).click(); await page.waitForSelector('#pd-date');
const sheetTxt = await page.locator('#sheet').innerText();
ok('改计划日面板：标题、窗口、已设闹钟提示', sheetTxt.includes('改计划接种日') && sheetTxt.includes('最早 10月17日 周六') && sheetTxt.includes('需重设闹钟'));
ok('日期选择器最早只能选 10-17（min）', (await page.getAttribute('#pd-date', 'min')) === '2026-10-17');
const chips = await page.locator('#pd-chips button').allInnerTexts();
ok('快捷选项：最早 10月17日 周六、10月18日 周日、10月24日 周六、10月25日 周日', JSON.stringify(chips) === JSON.stringify(['最早 10月17日 周六', '10月18日 周日', '10月24日 周六', '10月25日 周日']), JSON.stringify(chips));
await page.fill('#pd-date', '2026-10-16'); await page.dispatchEvent('#pd-date', 'input'); await page.waitForTimeout(150);
ok('早于最早日：⛔ 提示 + 保存按钮禁用', (await page.locator('.pd-bad').count()) === 1 && await page.isDisabled('#pd-save'));
await page.fill('#pd-date', '2026-10-20'); await page.dispatchEvent('#pd-date', 'input');
await page.fill('#pd-time', '10:30'); await page.waitForTimeout(150);
ok('10月20日：✓ 在窗口内，可保存', (await page.locator('#pd-warn').innerText()).includes('在窗口内') && !(await page.isDisabled('#pd-save')));
await hideToast();
await page.screenshot({ path: SHOTS + '22-plan-date-picker.png' });
await page.click('#pd-save'); await page.waitForTimeout(700);

const after = await bySid('nip:hepb-2');
ok('保存后：date=2026-10-20 time=10:30，最早仍为 10-17，备注/提醒/完成状态不变', after.date === '2026-10-20' && after.time === '10:30' && after.earliest === '2026-10-17' && after.note === before.note && JSON.stringify(after.reminders) === JSON.stringify(before.reminders) && after.done === false && after.updatedAt >= before.updatedAt, JSON.stringify({ d: after.date, t: after.time, e: after.earliest, n: after.note === before.note, r: JSON.stringify(after.reminders) === JSON.stringify(before.reminders), done: after.done, u: [before.updatedAt, after.updatedAt] }));
ok('闹钟仍标记已添加，但签名不同 → 「需重设闹钟」', after.alarmAdded === true && after.alarmSig === before.alarmSig
  && (await page.locator(`.item[data-id="${hb2.id}"] .alarm-btn.warn`).count()) === 1 && (await page.locator(`.item[data-id="${hb2.id}"] .alarm-btn`).innerText()).includes('重设闹钟'));
ok('列表：乙肝第2剂移到「10月20日 周二」组，10月20日组被高亮', (await page.locator(`#g-2026-10-20 .item[data-id="${hb2.id}"]`).count()) === 1 && (await page.locator('#g-2026-10-20.sel').count()) === 1 && (await page.locator(`#g-2026-10-17 .item[data-id="${hb2.id}"]`).count()) === 0);
const card2 = await page.locator(`.item[data-id="${hb2.id}"]`).innerText();
ok('卡片：「最早 10月17日 周六 · 计划 10月20日 周二 10:30」', card2.includes('最早 10月17日 周六 · 计划 10月20日 周二 10:30'), card2.split('\n')[1]);
ok('日历：10月20日实心紫点、10月17日紫色空心圈（最早）', (await page.locator('.day[data-date="2026-10-20"] .dot.cat-vaccine').count()) === 1 && (await page.locator('.day[data-date="2026-10-17"] .ring.cat-vaccine').count()) === 1);
const rem = await page.locator('#remindCard').innerText();
ok('近期提醒（未来7天）里没有乙肝第2剂', !rem.includes('乙肝疫苗 第2剂'));

// 提醒 / 快捷指令 / 苹果日历都按计划日
const out = await page.evaluate(async (id) => {
  const { store } = await import('./js/store.js');
  const { alarmLines } = await import('./js/shortcuts.js');
  const { buildICS } = await import('./js/ics.js');
  const ev = store.getEvent(id);
  return { lines: alarmLines(ev), ics: buildICS(ev) };
}, hb2.id);
ok('快捷指令闹钟：2026-10-19 20:00 与 2026-10-20 08:00（计划日）', out.lines.length === 2 && out.lines[0].startsWith('2026-10-19 20:00|') && out.lines[1].startsWith('2026-10-20 08:00|') && out.lines[0].includes('10:30'), out.lines.map((l) => l.split('|')[0]).join(', '));
ok('.ics：DTSTART 2026-10-20 10:30', /DTSTART[^:\r\n]*:20261020T103000/.test(out.ics), (out.ics.match(/DTSTART[^\r\n]*20261020[^\r\n]*/) || [''])[0]);

// 在日历上看乙肝第2剂的窗口：最早 10-17 虚线圈、计划 10-20 实心
await page.locator(`.item[data-id="${hb2.id}"] [data-act=focus]`).click(); await page.waitForTimeout(700);
ok('「🪟 窗口」按钮：10月17日虚线圈（最早）+ 10月20日实心（计划）', await page.locator('.day[data-date="2026-10-17"].early-focus.ef-vaccine').count() === 1 && await page.locator('.day[data-date="2026-10-20"].plan-focus.pf-vaccine').count() === 1);
await page.locator(`.item[data-id="${hb2.id}"]`).scrollIntoViewIfNeeded();
await page.evaluate((id) => { document.querySelector(`.item[data-id="${id}"]`).scrollIntoView({ block: 'center' }); }, hb2.id); await page.waitForTimeout(300);
await hideToast();
await page.screenshot({ path: SHOTS + '21-card-window-planned.png' });

// 晚于最迟：提醒但允许（逾期补种）
await page.locator(`.item[data-id="${m1.id}"] [data-act=plan]`).click(); await page.waitForSelector('#pd-date');
await page.fill('#pd-date', '2026-11-02'); await page.dispatchEvent('#pd-date', 'input'); await page.waitForTimeout(150);
ok('晚于最迟：⚠️ 提醒但允许保存', (await page.locator('.pd-warn').count()) === 1 && !(await page.isDisabled('#pd-save')));
await page.click('#pd-save'); await page.waitForTimeout(600);
ok('满月体检卡片显示「计划日晚于最迟日期」', (await page.locator(`.item[data-id="${m1.id}"] .iwarn`).innerText()).includes('晚于最迟'));
ok('改计划日跳到 11 月', (await page.textContent('.month')).includes('2026年11月'));

// 4) 过期未完成：9月20日的家访在 9 月列表里红色显示；「已过最迟」红色
await selectDate('2026-09-29'); await page.waitForTimeout(400);
ok('9月列表：新生儿家访 已过期未完成（红色）', (await page.locator('.item[data-id="man-fs"].is-overdue .tag.overdue').count()) === 1);
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  store.upsertEvent({ id: 'man-old', title: '听力复查', date: '2026-08-30', time: '', category: 'checkup', note: '', reminders: [], done: false, earliest: '2026-08-20', latest: '2026-09-10' });
});
await page.waitForTimeout(300);
ok('本月列表顶部「⚠️ 之前未完成」列出上个月没完成的事项', (await page.locator('#g-earlier .item[data-id="man-old"]').count()) === 1 && (await page.locator('#g-earlier').innerText()).includes('之前未完成'));
ok('已过最迟：窗口行红色「已过最迟（超过19天）」', (await page.locator('.item[data-id="man-old"] .iwin.st-late').innerText()).includes('已过最迟（超过19天）'));

// 5) 兼容：旧版本（v1.5.0）同步来的事项没有窗口字段 → 按 scheduleId + 生日推算显示，不改 updatedAt
const mod = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('babyrecord.v1'));
  const e = s.events.find((x) => x.scheduleId === 'nip:hepb-3');
  delete e.earliest; delete e.latest; delete e.windowNote;
  localStorage.setItem('babyrecord.v1', JSON.stringify(s));
  return { id: e.id, u: e.updatedAt, date: e.date };
});
await page.reload(); await page.waitForTimeout(800);
const r3 = await page.evaluate(async (id) => (await import('./js/store.js')).store.getEvent(id), mod.id);
ok('旧事项加载后（内存中）补上窗口（最迟 2027-09-16），updatedAt/date 不变', r3.latest === '2027-09-16' && r3.earliest === mod.date && r3.updatedAt === mod.u, JSON.stringify({ e: r3.earliest, l: r3.latest, u: [mod.u, r3.updatedAt], d: mod.date }));
await selectDate(mod.date); await page.waitForTimeout(400);
ok('旧事项卡片显示窗口', (await page.locator(`.item[data-id="${mod.id}"] .iwin`).innerText()).includes('2027年9月16日（最迟）'));

// 帮助页
await page.goto(BASE + '#/help'); await page.waitForTimeout(400);
ok('帮助页有「🪟 接种窗口与计划日」', (await page.locator('#h-window').innerText()).includes('改计划日'));

ok('无页面错误', errors.length === 0, errors.join(' | '));
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync('/workspace/baby-app/test/results-window.json', JSON.stringify(results, null, 2));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
