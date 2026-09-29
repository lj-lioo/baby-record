// 单元测试：自费疫苗计划（node test/paidvax.test.mjs）
// paidvax.js 必须不依赖其他模块：这里和命令行一样用 data: URL 加载（有 import 会直接失败）。
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../site/js/paidvax.js'), 'utf8');
const P = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('✅', name); };

const plan = P.planPaid('2026-09-17', '2026-09-29');
const byId = Object.fromEntries(plan.map((d) => [d.id, d]));

t('不依赖其他模块（无 import 语句）', () => { assert.ok(!/^\s*import\s/m.test(src)); });
t('RSV单抗：2026-10-17（与乙肝第2剂同一天），非可选，标题无(可选)，备注含剂量/同时接种', () => {
  const r = plan[0];
  assert.equal(r.scheduleId, 'paid:rsv'); assert.equal(r.date, '2026-10-17'); assert.equal(r.optional, false);
  assert.equal(r.title, 'RSV单抗（尼塞韦单抗）');
  assert.match(r.note, /乙肝疫苗第2剂同一天/); assert.match(r.note, /<5kg 用50mg、≥5kg 用100mg/); assert.match(r.note, /不同部位接种/);
  assert.match(r.note, /以接种门诊建议为准$/);
});
const DEF = {
  'pcv13-1': '2026-11-17', 'pcv13-2': '2027-01-17', 'pcv13-3': '2027-03-17', 'pcv13-4': '2027-09-17',
  'penta-1': '2026-11-17', 'penta-2': '2026-12-17', 'penta-3': '2027-01-17', 'penta-4': '2028-03-17',
  'rota5-1': '2026-11-17', 'rota5-2': '2026-12-17', 'rota5-3': '2027-01-17',
  'ev71-1': '2027-04-17', 'ev71-2': '2027-05-17', 'flu-1': '2027-09-20', 'flu-2': '2027-10-18',
  'var-1': '2027-09-17', 'var-2': '2030-09-17',
};
t('默认方案 17 剂 + RSV：日期全部正确', () => {
  const def = plan.filter((d) => !d.optional && d.id !== 'rsv');
  assert.deepEqual(Object.fromEntries(def.map((d) => [d.id, d.date])), DEF);
});
t('标题格式「(可选·自费) 名称 第N剂」，备注含免责、不含价格', () => {
  for (const d of plan.filter((x) => x.id !== 'rsv')) {
    assert.match(d.title, /^\(可选·自费\) .+ 第\d剂/);
    assert.match(d.note, /是否接种、品牌和时间以接种门诊建议为准$/);
  }
  for (const d of plan) assert.ok(!/[元￥¥]|价格/.test(d.note), d.id);
});
t('替代说明：五联替代百白破1～4剂和脊灰1～4剂；轮状提到兰州；甲肝/乙脑灭活提到替代免费减毒活疫苗', () => {
  assert.match(byId['penta-1'].note, /百白破第1～4剂和脊灰第1～4剂/);
  assert.match(byId['rota5-1'].note, /兰州/);
  assert.match(byId['hepai-1'].note, /不用再打免费的甲肝减毒活疫苗/);
  assert.match(byId['jei-1'].note, /不打免费的乙脑减毒活疫苗/);
  assert.match(byId['flu-1'].note, /2剂、间隔≥4周/);
});
t('备选方案默认不勾选（Hib、流脑结合、甲肝灭活、乙脑灭活），并有提示', () => {
  const opt = plan.filter((d) => d.optional);
  assert.deepEqual([...new Set(opt.map((d) => d.family))], ['hib', 'mcv', 'hepai', 'jei']);
  assert.ok(opt.every((d) => d.hint));
  assert.equal(byId['jei-2'].date, '2027-05-24');
});
t('scheduleId 唯一且以 paid: 开头；existing 去重', () => {
  assert.equal(new Set(plan.map((d) => d.scheduleId)).size, plan.length);
  assert.ok(plan.every((d) => d.scheduleId.startsWith('paid:')));
  const p2 = P.planPaid('2026-09-17', '2026-09-29', [{ scheduleId: 'paid:rsv' }, { scheduleId: 'nip:hepb-2' }]);
  assert.deepEqual(p2.filter((d) => d.existing).map((d) => d.id), ['rsv']);
});
t('流感首剂：满6月龄在3～8月 → 当年9月20日；在9～2月 → 满6月龄当天；月底对齐', () => {
  assert.equal(P.fluStart('2026-09-17'), '2027-09-20');
  assert.equal(P.fluStart('2026-04-10'), '2026-10-10');
  assert.equal(P.fluStart('2026-07-31'), '2027-01-31');
  assert.equal(P.addMonthsP('2026-08-31', 6), '2027-02-28');
  assert.equal(P.addDaysP('2026-12-30', 3), '2027-01-02');
});
// —— v1.7.0：按系列加入计划 ——
const B = '2026-09-17';
const sp = (fam, start) => P.seriesPlan(fam, B, start).map((x) => [x.scheduleId.slice(5), x.earliest, x.date, x.latest || '']);
t('目录 11 种：常用 7 + 备选 4；每种都有 预防/程序/来源；可替代的列出免费剂次', () => {
  assert.deepEqual(P.SERIES_ORDER, ['rsv', 'pcv13', 'penta', 'rota5', 'ev71', 'flu', 'var', 'hib', 'mcv', 'hepai', 'jei']);
  for (const f of P.SERIES_ORDER) { const S = P.SERIES[f]; assert.ok(S.prevents && S.schedule && S.source && S.doses.length, f); }
  assert.deepEqual(P.SERIES.penta.replaceIds, ['dtap-1', 'dtap-2', 'dtap-3', 'dtap-4', 'polio-1', 'polio-2', 'polio-3', 'polio-4']);
  assert.deepEqual(P.SERIES.hepai.replaceIds, ['hepa-1']); assert.deepEqual(P.SERIES.jei.replaceIds, ['je-1', 'je-2']);
});
t('第1剂最早/最迟/默认日期（生日 2026-09-17，今天 09-29）', () => {
  const i = (f) => { const x = P.seriesStartInfo(f, B, '2026-09-29'); return [x.earliest, x.latest, x.def]; };
  assert.deepEqual(i('penta'), ['2026-11-17', '', '2026-11-17']);
  assert.deepEqual(i('pcv13'), ['2026-10-29', '2027-04-16', '2026-10-29']);
  assert.deepEqual(i('rota5'), ['2026-10-29', '2026-12-10', '2026-10-29']);
  assert.deepEqual(i('flu'), ['2027-03-17', '', '2027-09-20']);
  assert.deepEqual(i('rsv'), ['2026-09-17', '2027-03-31', '2026-09-29']); // 最早已过 → 默认今天
});
t('五联：3 剂间隔 1 个月（最短 28 天）＋ 18 月龄加强（与第3剂≥6个月，取较晚）', () => {
  assert.deepEqual(sp('penta', '2026-11-17'), [['penta-1', '2026-11-17', '2026-11-17', ''], ['penta-2', '2026-12-15', '2026-12-17', ''], ['penta-3', '2027-01-14', '2027-01-17', ''], ['penta-4', '2028-03-17', '2028-03-17', '']]);
  // 晚起种（6 月龄）：加强剂仍 18 月龄；若第3剂+6个月更晚则取它
  assert.equal(P.seriesPlan('penta', B, '2027-11-17').at(-1).date, '2028-07-17');
});
t('13价：间隔 2 个月（最短 28 天）、第3剂最迟 <12月龄、加强 12 月龄（与第3剂≥8周）', () => {
  assert.deepEqual(sp('pcv13', '2026-10-29'), [['pcv13-1', '2026-10-29', '2026-10-29', '2027-04-16'], ['pcv13-2', '2026-11-26', '2026-12-29', ''], ['pcv13-3', '2027-01-26', '2027-02-28', '2027-09-16'], ['pcv13-4', '2027-09-17', '2027-09-17', '2028-01-16']]);
  assert.equal(P.seriesPlan('pcv13', B, '2027-03-17').at(-1).date, '2027-09-17'); // 第3剂 2027-07-17 + 8周 = 09-11 < 12月龄
  assert.equal(P.seriesPlan('pcv13', B, '2027-04-16').at(-1).date, '2027-10-11'); // 第3剂 08-16 + 56天 = 10-11，晚于 12 月龄
});
t('五价轮状：间隔 1 个月（最短 28 天、最长 10 周），第3剂 ≤32 周龄', () => {
  assert.deepEqual(sp('rota5', '2026-10-29'), [['rota5-1', '2026-10-29', '2026-10-29', '2026-12-10'], ['rota5-2', '2026-11-26', '2026-11-29', '2027-01-07'], ['rota5-3', '2026-12-27', '2026-12-29', '2027-02-07']]);
  const late = P.seriesPlan('rota5', B, '2027-02-20'); assert.equal(late[2].latest, '2027-04-29'); assert.ok(late[2].date <= late[2].latest);
});
t('EV71 间隔 1 个月；流感首次 2 剂间隔 4 周；水痘第2剂 4 周岁（最早＝第1剂+3个月）', () => {
  assert.deepEqual(sp('ev71', '2027-03-17'), [['ev71-1', '2027-03-17', '2027-03-17', '2032-09-16'], ['ev71-2', '2027-04-17', '2027-04-17', '2032-09-16']]);
  assert.deepEqual(sp('flu', '2027-09-20'), [['flu-1', '2027-03-17', '2027-09-20', ''], ['flu-2', '2027-10-18', '2027-10-18', '']]);
  assert.deepEqual(sp('var', '2027-09-17'), [['var-1', '2027-09-17', '2027-09-17', ''], ['var-2', '2027-12-17', '2030-09-17', '']]);
});
t('乙脑灭活 7 天 / ≥1个月·2岁 / ≥3年·6岁；甲肝灭活 ≥6个月·2岁；Hib 同五联；流脑结合只排第1剂', () => {
  assert.deepEqual(sp('jei', '2027-05-17').map((x) => x[2]), ['2027-05-17', '2027-05-24', '2028-09-17', '2032-09-17']);
  assert.equal(P.seriesPlan('jei', B, '2027-05-17')[1].latest, '2027-05-27');
  assert.deepEqual(sp('hepai', '2028-03-17').map((x) => x[2]), ['2028-03-17', '2028-09-17']);
  assert.deepEqual(sp('hib', '2026-11-17').map((x) => x[2]), sp('penta', '2026-11-17').map((x) => x[2]));
  assert.equal(P.seriesPlan('mcv', B, '2026-12-17').length, 1);
});
t('scheduleId / 标题 / 备注：paid:<疫苗>-<n>，RSV 为 paid:rsv；标题「五联疫苗 第1剂」；备注含本剂和免责', () => {
  const p = P.seriesPlan('penta', B, '2026-11-17');
  assert.deepEqual(p.map((x) => x.scheduleId), ['paid:penta-1', 'paid:penta-2', 'paid:penta-3', 'paid:penta-4']);
  assert.equal(p[0].title, '五联疫苗 第1剂'); assert.equal(p[3].title, '五联疫苗 第4剂（加强）');
  assert.match(p[1].note, /^自费·共4剂，本剂为第2剂 · .*百白破第1～4剂.* · 是否接种、品牌和时间以接种门诊建议为准$/);
  assert.match(p[1].windowNote, /最短间隔/);
  const r = P.seriesPlan('rsv', B, '2026-10-17')[0];
  assert.equal(r.scheduleId, 'paid:rsv'); assert.equal(r.title, 'RSV单抗（尼塞韦单抗）'); assert.match(r.note, /50mg/);
  assert.deepEqual(P.seriesOfSid('paid:penta-3'), { family: 'penta', n: 3 }); assert.deepEqual(P.seriesOfSid('paid:rsv'), { family: 'rsv', n: 1 });
  assert.equal(P.seriesOfSid('paid:penta-9'), null); assert.equal(P.seriesOfSid('nip:dtap-1'), null);
});
t('顺延 reflowSeries：顺延后续未完成剂次、已完成不动；keepDates 只重算最早', () => {
  const evs = P.seriesPlan('penta', B, '2026-11-17').map((x, i) => ({ id: 'e' + i, scheduleId: x.scheduleId, date: x.date, earliest: x.earliest, latest: x.latest, done: false }));
  const ch = P.reflowSeries('penta', B, evs, 1, '2026-11-21');
  assert.deepEqual(ch.map((c) => [c.n, c.date, c.earliest, c.dateChanged]), [[2, '2026-12-21', '2026-12-19', true], [3, '2027-01-21', '2027-01-18', true]]);
  evs[1].done = true; evs[1].date = '2026-12-25';
  const ch2 = P.reflowSeries('penta', B, evs, 1, '2026-11-21');
  assert.deepEqual(ch2.map((c) => [c.n, c.date]), [[3, '2027-01-25']]); // 第2剂已完成：不动，第3剂从它起算
  evs[1].done = false; evs[1].date = '2026-12-17';
  const keep = P.reflowSeries('penta', B, evs, 1, '2026-11-21', { keepDates: true });
  assert.deepEqual(keep.map((c) => [c.n, c.date, c.earliest, c.dateChanged]), [[2, '2026-12-17', '2026-12-19', false]]);
});
t('免费剂次替代提示：计划五联 → 百白破1～4、脊灰1～4；未计划不提示', () => {
  const m = P.replacementHints([{ scheduleId: 'paid:penta-2' }]);
  assert.equal(m.size, 8); assert.equal(m.get('nip:dtap-1'), '已计划五联，可不打此剂（以门诊为准）'); assert.ok(!m.has('nip:dtap-5'));
  assert.equal(P.replacementHints([{ scheduleId: 'paid:rsv' }]).size, 0);
});
t('目录条目：已计划/已完成/下一剂', () => {
  const evs = [{ scheduleId: 'paid:rsv', date: '2026-10-17', done: false }, { scheduleId: 'paid:rota5-1', date: '2026-10-29', done: true }];
  const c = Object.fromEntries(P.catalogEntries(B, '2026-09-29', evs).map((x) => [x.family, x]));
  assert.ok(c.rsv.inPlan); assert.equal(c.rsv.next.date, '2026-10-17');
  assert.ok(!c.rota5.inPlan); assert.equal(c.rota5.doneN, 1); assert.ok(!c.penta.inPlan && !c.penta.doses.length);
});
console.log(`\n${pass} passed`);
