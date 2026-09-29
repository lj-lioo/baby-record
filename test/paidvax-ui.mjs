// 端到端（iPhone 尺寸）：v1.7.0 自费疫苗「待定」目录 → 加入计划（系列自动排期、间隔/月龄）→ 顺延 → 移出计划；截图 23～26。BASE=... 可指定地址
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
const paidEvs = async (fam) => (await events()).filter((e) => fam ? (e.scheduleId === `paid:${fam}` || (e.scheduleId || '').startsWith(`paid:${fam}-`)) : (e.scheduleId || '').startsWith('paid:'))
  .sort((a, b) => a.scheduleId.localeCompare(b.scheduleId, 'en', { numeric: true }));
const hideToast = () => page.evaluate(() => { document.activeElement?.blur(); document.getElementById('toast').hidden = true; });
const sheetKind = () => page.evaluate(() => { const s = document.getElementById('sheet'); return s.hidden ? '' : (s.dataset.kind || 'other'); });
async function openCard() {
  if (!(await page.locator('#paidCard .pc-wrap').count())) { await page.click('#pcToggle'); await page.waitForTimeout(250); }
}
async function openEntry(fam, root = '#paidCard') {
  await page.evaluate(([f, r]) => { const d = document.querySelector(`${r} .pc-item[data-fam="${f}"]`); d.open = true; d.dispatchEvent(new Event('toggle')); }, [fam, root]);
  await page.waitForTimeout(100);
}
async function addSeries(fam, date = null) {
  await page.goto(BASE + '#/'); await page.waitForTimeout(300);
  await openCard(); await openEntry(fam);
  await page.click(`#paidCard [data-add="${fam}"]`); await page.waitForSelector('#sp-list li');
  if (date) { await page.fill('#sp-date', date); await page.waitForTimeout(150); }
  await page.click('#sp-ok'); await page.waitForTimeout(500);
  return paidEvs(fam);
}
const brief = (list) => list.map((e) => `${e.scheduleId.slice(5)}:${e.date}${e.earliest !== e.date ? `(E${e.earliest})` : ''}${e.latest ? `[L${e.latest}]` : ''}`).join(' ');

// 先生成免费疫苗计划
await page.click('#vaxGo'); await page.waitForSelector('.vp-item'); await page.click('#vp-ok'); await page.waitForTimeout(500);

// —— 1. 设置页：版本、入口按钮 ——
await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
const verTxt = await page.textContent('#appVer');
ok('设置页版本 v1.7.0', verTxt.includes('宝宝记录 v1.7.0') && !verTxt.includes('正在更新'), verTxt);
ok('「一键生成日程」的自费按钮改为「💰 自费疫苗（待定）」', (await page.textContent('#btnPaid')).trim() === '💰 自费疫苗（待定）');
ok('显示「已加入计划的自费疫苗 0 种」', /已加入计划的自费疫苗\s*0 种/.test(await page.locator('#vaxCard').innerText()));
await page.click('#btnPaid'); await page.waitForSelector('#sheet .pc-item');
ok('设置入口打开「💰 自费疫苗（待定）」目录（11 种，全部待定）', (await sheetKind()) === 'paidcat' && (await page.locator('#sheet .pc-item').count()) === 11 && (await page.locator('#sheet .pc-st').allInnerTexts()).every((t) => t === '待定'));
ok('目录分组：常用 7 种 + 备选 4 种（Hib/流脑结合/甲肝灭活/乙脑灭活）', (await page.locator('#sheet .pc-group').allInnerTexts()).join('|') === '常用自费疫苗|备选（替代免费疫苗，或不打五联时）'
  && (await page.locator('#sheet .pc-item').evaluateAll((l) => l.map((d) => d.dataset.fam).join(','))) === 'rsv,pcv13,penta,rota5,ev71,flu,var,hib,mcv,hepai,jei');
ok('打开目录不会写入任何自费事项', (await paidEvs()).length === 0);
await page.click('#pcClose');

// —— 2. 首页：月列表里没有自费事项；月列表下方可折叠卡片 ——
await page.goto(BASE + '#/'); await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-11-17' }))); await page.waitForTimeout(400);
ok('11月没有自费疫苗卡片 / 日历没有蓝点（待定不排进日程）', (await page.locator('#dayCard .item.cat-paidvax').count()) === 0 && (await page.locator('.dot.cat-paidvax').count()) === 1 /* 仅图例 */);
ok('#paidCard 在 #dayCard 之后，默认折叠，显示「11 种待定」', await page.evaluate(() => document.getElementById('dayCard').nextElementSibling?.id === 'paidCard')
  && (await page.locator('#paidCard .pc-wrap').count()) === 0 && (await page.textContent('#pcToggle')).includes('11 种待定'));
await openCard();
await openEntry('penta');
const penta = await page.locator('#paidCard .pc-item[data-fam="penta"]').innerText();
ok('五联条目：预防/程序/第1剂最早（本宝宝 11月17日 周二）/未规定最迟/可替代/门诊提示/加入计划按钮',
  penta.includes('4剂 · 最早 11月17日') && penta.includes('白喉、破伤风、百日咳') && penta.includes('18月龄加强') && penta.includes('最早 11月17日 周二') && penta.includes('未规定最迟')
  && penta.includes('免费百白破第1～4剂、脊灰第1～4剂') && penta.includes('以接种门诊建议为准') && penta.includes('➕ 加入计划'), penta.replace(/\n/g, ' | ').slice(0, 300));
await openEntry('rota5');
const rota = await page.locator('#paidCard .pc-item[data-fam="rota5"]').innerText();
ok('五价轮状条目：第1剂最早 10月29日、最迟 12月10日（12周龄）', rota.includes('最早 10月29日') && rota.includes('最迟 12月10日'), rota.replace(/\n/g, ' | ').slice(0, 160));
await page.evaluate(() => { const d = document.querySelector('#paidCard .pc-item[data-fam="rota5"]'); d.open = false; });
await hideToast();
await page.evaluate(() => { document.getElementById('paidCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '23-paid-catalog.png' });

// —— 3. 加入计划：选第1剂日期 + 预览 ——
await page.click('#paidCard [data-add="penta"]'); await page.waitForSelector('#sp-list li');
ok('选择器默认最早日期 2026-11-17、min=2026-11-17、时间 09:00', (await page.inputValue('#sp-date')) === '2026-11-17' && (await page.getAttribute('#sp-date', 'min')) === '2026-11-17' && (await page.inputValue('#sp-time')) === '09:00');
const chips = await page.locator('#sp-chips button').allInnerTexts();
ok('有「最早」和周末快捷按钮', chips[0].startsWith('最早 11月17日') && chips.some((t) => t.includes('周六')) && chips.some((t) => t.includes('周日')), chips.join(' / '));
const prev = await page.locator('#sp-list li').allInnerTexts();
ok('预览 4 剂：11-17、12-17(最早12-15)、2027-01-17(最早01-14)、2028-03-17（18月龄）', prev.length === 4 && prev[0].includes('11月17日') && prev[1].includes('12月17日') && prev[1].includes('最早 12月15日')
  && prev[2].includes('2027年1月17日') && prev[2].includes('最早 2027年1月14日') && prev[3].includes('2028年3月17日'), prev.map((t) => t.replace(/\n/g, ' ')).join(' / '));
await page.fill('#sp-date', '2026-11-10'); await page.waitForTimeout(150);
ok('早于最早日期：⛔ 提示，按钮禁用，没有预览', (await page.locator('#sp-warn .pd-bad').count()) === 1 && await page.isDisabled('#sp-ok') && (await page.locator('#sp-list li').count()) === 0);
await page.click('#sp-chips button:has-text("11月21日")'); await page.waitForTimeout(150);
const prev2 = await page.locator('#sp-list li').allInnerTexts();
ok('点周六 11-21：第2剂 12-21、第3剂 2027-01-21、加强仍 2028-03-17（月龄晚于间隔）', prev2[1].includes('12月21日') && prev2[2].includes('2027年1月21日') && prev2[3].includes('2028年3月17日'), prev2.map((t) => t.replace(/\n/g, ' ')).join(' / '));
await page.click('#sp-chips button:has-text("最早")'); await page.waitForTimeout(150);
ok('按钮「加入计划（4剂）」', (await page.textContent('#sp-ok')).trim() === '加入计划（4剂）');
await hideToast(); await page.waitForTimeout(200);
await page.screenshot({ path: SHOTS + '24-paid-add-picker.png' });
await page.click('#sp-ok'); await page.waitForTimeout(600);
let pe = await paidEvs('penta');
ok('五联 4 剂已写入：09:00、提醒前一天20:00+当天08:00、scheduleId penta-1..4、标题「五联疫苗 第1剂」',
  pe.length === 4 && pe.every((e) => e.category === 'paidvax' && e.time === '09:00' && e.reminders.map((r) => r.preset).join(',') === 'eve20,morning8' && !e.done)
  && pe.map((e) => e.scheduleId).join(',') === 'paid:penta-1,paid:penta-2,paid:penta-3,paid:penta-4' && pe[0].title === '五联疫苗 第1剂' && pe[3].title === '五联疫苗 第4剂（加强）', brief(pe));
ok('每剂有最早日期（最短间隔）和计划日', brief(pe) === 'penta-1:2026-11-17 penta-2:2026-12-17(E2026-12-15) penta-3:2027-01-17(E2027-01-14) penta-4:2028-03-17', brief(pe));
ok('只写入五联，没有其他自费事项', (await paidEvs()).length === 4);

// —— 4. 月列表：五联卡片 + 免费百白破/脊灰的提示 ——
ok('跳到 11月17日：当天有蓝色五联卡片', (await page.locator('#g-2026-11-17 .item.cat-paidvax').count()) === 1 && (await page.locator('#g-2026-11-17 .item.cat-paidvax .ititle').innerText()) === '五联疫苗 第1剂');
const reps = await page.locator('#g-2026-11-17 .item.cat-vaccine').evaluateAll((l) => l.map((c) => [c.querySelector('.ititle').textContent, c.querySelector('.irep')?.textContent || '']));
ok('免费百白破第1剂、脊灰第1剂卡片提示「已计划五联，可不打此剂（以门诊为准）」', reps.filter(([t, h]) => /百白破疫苗 第1剂|脊灰疫苗 第1剂/.test(t) && h.includes('已计划五联，可不打此剂（以门诊为准）')).length === 2, JSON.stringify(reps));
const nip = (await events()).filter((e) => (e.scheduleId || '').startsWith('nip:'));
ok('免费事项没有被删除（20 个）', nip.length === 20);
const allHints = await page.evaluate(async () => { const { replacementHints } = await import('./js/paidvax.js'); const { store } = await import('./js/store.js'); return [...replacementHints(store.events()).keys()].sort().join(','); });
ok('提示覆盖百白破1–4、脊灰1–4（不含百白破第5剂）', allHints === 'nip:dtap-1,nip:dtap-2,nip:dtap-3,nip:dtap-4,nip:polio-1,nip:polio-2,nip:polio-3,nip:polio-4', allHints);
await hideToast();
await page.evaluate(() => { document.getElementById('g-2026-11-17').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '25-month-list-penta.png' });
ok('日历 11-17 同时有紫色和蓝色圆点', (await page.locator('.day[data-date="2026-11-17"] .dot.cat-vaccine').count()) >= 1 && (await page.locator('.day[data-date="2026-11-17"] .dot.cat-paidvax').count()) === 1);

// —— 5. 其他疫苗的间隔/月龄 ——
// 五价轮状：先试晚于最迟
await page.goto(BASE + '#/'); await page.waitForTimeout(300); await openCard(); await openEntry('rota5');
await page.click('#paidCard [data-add="rota5"]'); await page.waitForSelector('#sp-list li');
await page.fill('#sp-date', '2026-12-20'); await page.waitForTimeout(150);
ok('五价轮状：晚于第1剂最迟（12-10）→ ⚠️ 提醒但允许；超 32 周龄的剂次标「晚于最迟」', (await page.locator('#sp-warn .pd-warn').count()) === 1 && !(await page.isDisabled('#sp-ok')) && (await page.locator('#sp-list .sp-late').count()) >= 1);
await page.click('#sp-cancel'); await page.waitForTimeout(200);
let r5 = await addSeries('rota5');
ok('五价轮状 3 剂：10-29、11-29、12-29（间隔 1 个月，最早 +28 天；最迟 +10 周、第3剂≤32周龄）', brief(r5) === 'rota5-1:2026-10-29[L2026-12-10] rota5-2:2026-11-29(E2026-11-26)[L2027-01-07] rota5-3:2026-12-29(E2026-12-27)[L2027-02-07]', brief(r5));
const p13 = await addSeries('pcv13');
ok('13价 4 剂：10-29、12-29、2027-02-28（间隔 2 个月，最短 28 天）、加强 2027-09-17（12月龄晚于第3剂+8周）', brief(p13) === 'pcv13-1:2026-10-29[L2027-04-16] pcv13-2:2026-12-29(E2026-11-26) pcv13-3:2027-02-28(E2027-01-26)[L2027-09-16] pcv13-4:2027-09-17[L2028-01-16]', brief(p13));
const ev71 = await addSeries('ev71');
ok('EV71 2 剂：2027-03-17、04-17（间隔 1 个月）', brief(ev71) === 'ev71-1:2027-03-17[L2032-09-16] ev71-2:2027-04-17[L2032-09-16]', brief(ev71));
const flu = await addSeries('flu');
ok('流感：默认按流感季 2027-09-20，第2剂 +4 周 10-18', brief(flu) === 'flu-1:2027-09-20(E2027-03-17) flu-2:2027-10-18', brief(flu));
const va = await addSeries('var');
ok('水痘：2027-09-17；第2剂 4 周岁 2030-09-17（最早＝第1剂+3个月 2027-12-17）', brief(va) === 'var-1:2027-09-17 var-2:2030-09-17(E2027-12-17)', brief(va));
const rsv = await addSeries('rsv', '2026-10-17');
ok('RSV：单剂 paid:rsv 2026-10-17，最迟 2027-03-31，标题不变', rsv.length === 1 && rsv[0].scheduleId === 'paid:rsv' && rsv[0].date === '2026-10-17' && rsv[0].latest === '2027-03-31' && rsv[0].title === 'RSV单抗（尼塞韦单抗）' && /50mg/.test(rsv[0].note));
ok('RSV 与免费乙肝第2剂同一天', (await events()).some((e) => e.scheduleId === 'nip:hepb-2' && e.date === '2026-10-17'));
const unit = await page.evaluate(async () => {
  const m = await import('./js/paidvax.js');
  const j = m.seriesPlan('jei', '2026-09-17', '2027-05-17').map((x) => `${x.date}/${x.earliest}/${x.latest}`);
  const h = m.seriesPlan('hepai', '2026-09-17', '2028-03-17').map((x) => `${x.date}/${x.earliest}/${x.latest}`);
  return { j, h };
});
ok('乙脑灭活：8月龄2剂间隔7天（最迟+10天）、2岁、6岁（与上剂≥1个月/≥3年）', unit.j.join(' ') === '2027-05-17/2027-05-17/ 2027-05-24/2027-05-24/2027-05-27 2028-09-17/2027-06-24/2029-09-16 2032-09-17/2031-09-17/2033-09-16', unit.j.join(' '));
ok('甲肝灭活：18月龄、2岁（间隔≥6个月）', unit.h.join(' ') === '2028-03-17/2028-03-17/2028-09-16 2028-09-17/2028-09-17/2029-09-16', unit.h.join(' '));
await page.goto(BASE + '#/'); await page.waitForTimeout(300); await openCard();
ok('目录：已加入计划 7 种（含RSV）+ 待定 4 种（备选）', (await page.locator('#paidCard .pc-st.in').count()) === 7 && (await page.locator('#paidCard .pc-st').filter({ hasText: '待定' }).count()) === 4
  && (await page.textContent('#pcToggle')).includes('4 种待定 · 7 种已计划'), await page.textContent('#pcToggle'));
await openEntry('hib');
ok('Hib 条目：⚠️ 已计划五联（含Hib），不要再打', (await page.locator('#paidCard .pc-item[data-fam="hib"]').innerText()).includes('已计划五联（含Hib），不要再打Hib疫苗'));

// —— 6. 顺延：改计划日 ——
await page.evaluate(async () => {
  const { store } = await import('./js/store.js'); const { alarmSig } = await import('./js/shortcuts.js');
  const e = store.events().find((x) => x.scheduleId === 'paid:penta-2'); store.setAlarmAdded(e.id, true, alarmSig(e));
});
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-11-17' }))); await page.waitForTimeout(400);
await page.click('#g-2026-11-17 .item.cat-paidvax [data-act="plan"]'); await page.waitForSelector('#pd-date');
await page.fill('#pd-date', '2026-11-21'); await page.waitForTimeout(100);
await page.click('#pd-save'); await page.waitForTimeout(500);
ok('改五联第1剂计划日 → 弹出「后续剂次一起顺延」', (await sheetKind()) === 'cascade' && (await page.locator('#sheet h3').innerText()).includes('后续剂次一起顺延'));
const cc = await page.locator('.cc-list li').allInnerTexts();
ok('列出新日期：第2剂 12月17日→12月21日（设过闹钟：需重设）、第3剂 1月17日→2027年1月21日；加强剂不变不列出', cc.length === 2 && cc[0].includes('12月21日') && cc[0].includes('需重设闹钟') && cc[1].includes('2027年1月21日'), cc.map((t) => t.replace(/\n/g, ' ')).join(' / '));
await hideToast(); await page.waitForTimeout(200);
await page.screenshot({ path: SHOTS + '26-cascade-prompt.png' });
await page.click('#cc-yes'); await page.waitForTimeout(500);
pe = await paidEvs('penta');
ok('顺延后：penta-1 11-21，penta-2 12-21(最早12-19)，penta-3 2027-01-21(最早01-18)，加强 2028-03-17 不变', brief(pe) === 'penta-1:2026-11-21(E2026-11-17) penta-2:2026-12-21(E2026-12-19) penta-3:2027-01-21(E2027-01-18) penta-4:2028-03-17', brief(pe));
const ast = await page.evaluate(async () => { const { store } = await import('./js/store.js'); const { alarmState } = await import('./js/views/actions.js'); return alarmState(store.events().find((x) => x.scheduleId === 'paid:penta-2')); });
ok('顺延的剂次原来设过闹钟 → 变成「需重设闹钟」', ast === 'changed', ast);
// 不顺延：只更新最早日期
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-29' }))); await page.waitForTimeout(400);
await page.click('#g-2026-10-29 .item:has-text("13价肺炎 第1剂") [data-act="plan"]'); await page.waitForSelector('#pd-date');
await page.fill('#pd-date', '2026-11-01'); await page.click('#pd-save'); await page.waitForTimeout(500);
ok('13价第1剂改到 11-01 → 顺延提示', (await sheetKind()) === 'cascade');
await page.click('#cc-no'); await page.waitForTimeout(400);
const p13b = await paidEvs('pcv13');
ok('选「保持原计划」：后续计划日不变，只更新第2剂最早日期（11-29）', brief(p13b) === 'pcv13-1:2026-11-01(E2026-10-29)[L2027-04-16] pcv13-2:2026-12-29(E2026-11-29) pcv13-3:2027-02-28(E2027-01-26)[L2027-09-16] pcv13-4:2027-09-17[L2028-01-16]', brief(p13b));
// 编辑器改日期也会提示
await page.evaluate(async () => { const { store } = await import('./js/store.js'); const { openEditor } = await import('./js/views/editor.js'); openEditor({ id: store.events().find((x) => x.scheduleId === 'paid:ev71-1').id }); });
await page.waitForSelector('#f-date'); await page.fill('#f-date', '2027-03-20'); await page.click('#f-save'); await page.waitForTimeout(500);
ok('在「编辑」里改 EV71 第1剂日期 → 也提示顺延第2剂（→ 04-20）', (await sheetKind()) === 'cascade' && (await page.locator('.cc-list li').innerText()).includes('4月20日'));
await page.click('#cc-yes'); await page.waitForTimeout(300);

// —— 7. 实际接种日不同 → 顺延；已完成的剂次不动 ——
await page.clock.setFixedTime(new Date('2026-11-03T10:00:00+08:00'));
await page.reload(); await page.waitForTimeout(700);
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-29' }))); await page.waitForTimeout(400);
await page.click('#g-earlier .item:has-text("五价轮状 第1剂") [data-act="done"], #g-2026-10-29 .item:has-text("五价轮状 第1剂") [data-act="done"]'); await page.waitForTimeout(300);
ok('系列剂次点「✅ 已完成」→ 可填实际接种日（默认计划日，最大今天）', (await sheetKind()) === 'done' && (await page.inputValue('#dn-date')) === '2026-10-29' && (await page.getAttribute('#dn-date', 'max')) === '2026-11-03');
await page.fill('#dn-date', '2026-11-02'); await page.click('#dn-ok'); await page.waitForTimeout(500);
ok('实际接种日 11-02 ≠ 计划日 → 顺延提示', (await sheetKind()) === 'cascade' && (await page.locator('#sheet').innerText()).includes('实际接种日'));
await page.click('#cc-yes'); await page.waitForTimeout(400);
r5 = await paidEvs('rota5');
ok('轮状：第1剂已完成且日期=11-02，第2剂 12-02，第3剂 2027-01-02', r5[0].done && r5[0].date === '2026-11-02' && r5[1].date === '2026-12-02' && r5[2].date === '2027-01-02' && r5[2].latest === '2027-02-10' && r5[1].earliest === '2026-11-30', brief(r5));
const doneBefore = JSON.stringify(r5[0]);
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-12-02' }))); await page.waitForTimeout(400);
await page.click('#g-2026-12-02 .item:has-text("五价轮状 第2剂") [data-act="plan"]'); await page.waitForSelector('#pd-date');
await page.fill('#pd-date', '2026-12-05'); await page.click('#pd-save'); await page.waitForTimeout(500);
if ((await sheetKind()) === 'cascade') { await page.click('#cc-yes'); await page.waitForTimeout(300); }
r5 = await paidEvs('rota5');
ok('再改第2剂：只顺延第3剂（→ 2027-01-05），已完成的第1剂一字不变', r5[2].date === '2027-01-05' && JSON.stringify(r5[0]) === doneBefore, brief(r5));
// 非系列事项点已完成：直接完成，无弹窗
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-17' }))); await page.waitForTimeout(300);
await page.click('#g-2026-10-17 .item:has-text("RSV") [data-act="done"]'); await page.waitForTimeout(300);
ok('单剂/最后一剂点「已完成」：直接完成，不弹窗', (await sheetKind()) === '' && (await paidEvs('rsv'))[0].done);

// —— 8. 移出计划（回到待定） ——
await page.goto(BASE + '#/settings'); await page.waitForTimeout(400);
ok('设置页：已加入计划的自费疫苗 6 种（RSV 已完成不算）', /已加入计划的自费疫苗\s*6 种（16 剂未完成）/.test(await page.locator('#vaxCard').innerText()), (await page.locator('#vaxCard').innerText()).replace(/\n/g, ' '));
await page.click('#btnPaid'); await page.waitForSelector('#sheet .pc-item');
await openEntry('penta', '#sheet');
await page.click('#sheet [data-rm="penta"]'); await page.waitForTimeout(300);
ok('移出计划有确认框（4 个未完成的剂次，提到闹钟）', (await page.locator('#sheet h3').innerText()).includes('把「五联疫苗」移出计划？将删除 4 个未完成的剂次') && (await page.locator('#sheet h3').innerText()).includes('闹钟'));
await page.click('#sheet [data-a="no"]'); await page.waitForTimeout(300);
ok('取消：五联仍在计划中，回到目录', (await paidEvs('penta')).length === 4 && (await sheetKind()) === 'paidcat');
await openEntry('penta', '#sheet');
await page.click('#sheet [data-rm="penta"]'); await page.waitForTimeout(300);
await page.click('#sheet [data-a="yes"]'); await page.waitForTimeout(400);
ok('确认：五联 4 剂全部删除，目录里回到「待定」', (await paidEvs('penta')).length === 0 && (await page.locator('#sheet .pc-item[data-fam="penta"] .pc-st').innerText()) === '待定');
await openEntry('rota5', '#sheet');
await page.click('#sheet [data-rm="rota5"]'); await page.waitForTimeout(300);
ok('轮状确认框写明已完成的 1 剂保留', (await page.locator('#sheet h3').innerText()).includes('将删除 2 个未完成的剂次（已完成的 1 剂保留）'));
await page.click('#sheet [data-a="yes"]'); await page.waitForTimeout(400);
r5 = await paidEvs('rota5');
ok('轮状只删未完成的 2 剂，已完成的第1剂一字不变；条目显示「已接种」', r5.length === 1 && JSON.stringify(r5[0]) === doneBefore && (await page.locator('#sheet .pc-item[data-fam="rota5"] .pc-st').innerText()) === '已接种');
await page.click('#pcClose');
await page.goto(BASE + '#/'); await page.waitForTimeout(300);
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-11-17' }))); await page.waitForTimeout(400);
ok('移出五联后，免费百白破/脊灰卡片不再提示', (await page.locator('#dayCard .irep').count()) === 0);
const tomb = await page.evaluate(async () => { const { store } = await import('./js/store.js'); return store.events().filter((e) => (e.scheduleId || '').startsWith('paid:penta')).length; });
ok('本机数据里没有五联（同步时会发删除标记）', tomb === 0);

// —— 9. 类别兼容（沿用 v1.5.0 的检查） ——
const r = await page.evaluate(async () => {
  const { buildICS } = await import('./js/ics.js');
  const { notifyBody } = await import('./js/reminders.js');
  const { alarmLines } = await import('./js/shortcuts.js');
  const { store, normalizeEvent } = await import('./js/store.js');
  const ev = store.events().find((e) => e.scheduleId === 'paid:pcv13-2');
  const ics = buildICS(ev);
  const body = notifyBody(ev, Date.now(), '提前一天');
  const lines = alarmLines(ev, [{ fireAt: new Date('2026-12-28T20:00:00+08:00').getTime(), label: '前一天 20:00' }]);
  const repaired = normalizeEvent({ id: 'x', date: '2026-10-17', title: 'RSV', category: 'other', scheduleId: 'paid:rsv', updatedAt: 5 });
  const plainOther = normalizeEvent({ id: 'z', date: '2026-10-17', title: 'Y', category: 'other' });
  return { ics: ics.includes('CATEGORIES:自费疫苗'), body, line: lines[0], repaired: [repaired.category, repaired.updatedAt], plainOther: plainOther.category };
});
ok('ICS 类别=自费疫苗；通知「💰 自费疫苗」；闹钟备注「💰自费疫苗」', r.ics && r.body.startsWith('💰 自费疫苗') && r.line.includes('💰自费疫苗'), r.body.split('\n')[0]);
ok('兼容：旧版本存成 other 的 paid: 事项自动改回 paidvax（不改 updatedAt）', r.repaired[0] === 'paidvax' && r.repaired[1] === 5 && r.plainOther === 'other');
const nBefore = (await events()).length;
await page.reload(); await page.waitForTimeout(800);
ok('重新打开后事项全部还在', (await events()).length === nBefore);
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
fs.writeFileSync('/workspace/baby-app/test/results-paidvax.json', JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
