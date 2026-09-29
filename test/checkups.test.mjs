// 单元测试：体检计划日期生成（node test/checkups.test.mjs）
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'));
for (const f of ['checkups.js', 'vaccines.js', 'dates.js']) fs.copyFileSync(path.join(here, '../site/js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const { planCheckups } = await import(pathToFileURL(path.join(tmp, 'checkups.js')).href);

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('✅', name); };

const EXPECTED = [
  ['2026-09-24', '新生儿家庭访视', true, false],
  ['2026-10-08', '新生儿疾病筛查（足跟血）结果查询', false, true],
  ['2026-10-17', '满月体检', false, false],
  ['2026-10-29', '新生儿听力复筛', false, true],
  ['2026-12-17', '3月龄儿保体检', false, false],
  ['2027-03-17', '6月龄儿保体检', false, false],
  ['2027-05-17', '8月龄儿保体检', false, false],
  ['2027-09-17', '12月龄儿保体检', false, false],
  ['2028-03-17', '18月龄儿保体检', false, false],
  ['2028-09-17', '2岁儿保体检', false, false],
  ['2029-03-17', '30月龄儿保体检', false, false],
  ['2029-09-17', '3岁儿保体检', false, false],
  ['2030-09-17', '4岁儿保体检', false, false],
  ['2031-09-17', '5岁儿保体检', false, false],
  ['2032-09-17', '6岁儿保体检', false, false],
];
const plan = planCheckups('2026-09-17', '2026-09-29');
t('生日 2026-09-17 生成 15 项，日期/名称/已过/可选 全部正确', () => {
  assert.deepEqual(plan.map((d) => [d.date, d.title, d.past, !!d.optional]), EXPECTED);
});
t('日期按先后排列', () => {
  const ds = plan.map((d) => d.date); assert.deepEqual(ds, [...ds].sort());
});
t('备注：检查内容 + 以社区卫生服务中心预约为准', () => {
  for (const d of plan.filter((x) => !x.optional)) assert.match(d.note, /以社区卫生服务中心预约为准$/);
  assert.match(plan.find((d) => d.id === 'm1').note, /满42天（10月29日）/);
  assert.match(plan.find((d) => d.id === 'm6').note, /血常规/);
  assert.match(plan.find((d) => d.id === 'm6').note, /听力筛查/);
  assert.match(plan.find((d) => d.id === 'm18').note, /血常规/);
  assert.match(plan.find((d) => d.id === 'm30').note, /血常规/);
  for (const id of ['m12', 'm24', 'm36']) assert.match(plan.find((d) => d.id === id).note, /听力筛查/);
  for (const id of ['y4', 'y5', 'y6']) assert.match(plan.find((d) => d.id === id).note, /血常规.*视力/);
  assert.match(plan.find((d) => d.id === 'hearing-rescreen').note, /初筛未通过/);
});
t('审核补充：孤独症初筛11次、髋关节、中医药6次、出牙龋齿、涂氟、足跟血结果', () => {
  const n = (id) => plan.find((d) => d.id === id).note;
  for (const id of ['m3', 'm6', 'm8', 'm12', 'm18', 'm24', 'm30', 'm36', 'y4', 'y5', 'y6']) assert.match(n(id), /孤独症初筛/, id);
  for (const id of ['home-visit', 'm1', 'm3', 'm6']) assert.match(n(id), /髋关节/, id);
  for (const id of ['m6', 'm12', 'm18', 'm24', 'm30', 'm36']) assert.match(n(id), /中医药健康管理/, id);
  assert.match(n('m6'), /摩腹和捏脊/); assert.match(n('m18'), /迎香穴、足三里穴/); assert.match(n('m36'), /四神聪穴/);
  for (const id of ['m12', 'm18', 'm24', 'm30', 'm36']) assert.match(n(id), /出牙和龋齿检查/, id);
  for (const id of ['m36', 'y4', 'y5', 'y6']) assert.match(n(id), /涂氟/, id);
  assert.match(n('nbs-result'), /足跟血.*阳性/);
});
t('scheduleId 唯一且以 chk: 开头', () => {
  assert.equal(new Set(plan.map((d) => d.scheduleId)).size, plan.length);
  assert.ok(plan.every((d) => d.scheduleId.startsWith('chk:')));
});
t('已添加的标记 existing', () => {
  const p2 = planCheckups('2026-09-17', '2026-09-29', [{ scheduleId: 'chk:m3' }]);
  assert.deepEqual(p2.filter((d) => d.existing).map((d) => d.id), ['m3']);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed`);
