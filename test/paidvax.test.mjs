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
console.log(`\n${pass} passed`);
