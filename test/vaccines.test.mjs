// 单元测试：疫苗计划日期生成（node test/vaccines.test.mjs）
// site/js 是浏览器 ES 模块，这里复制到临时目录（type: module）后导入，兼容任意 Node 版本。
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vax-'));
for (const f of ['vaccines.js', 'dates.js']) fs.copyFileSync(path.join(here, '../site/js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const { planVaccines, addMonths, NIP_SCHEDULE } = await import(pathToFileURL(path.join(tmp, 'vaccines.js')).href);

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('✅', name); };

const EXPECTED = [
  ['2026-09-17', '乙肝疫苗 第1剂', true],
  ['2026-09-17', '卡介苗', true],
  ['2026-10-17', '乙肝疫苗 第2剂', false],
  ['2026-11-17', '脊灰疫苗 第1剂', false],
  ['2026-11-17', '百白破疫苗 第1剂', false],
  ['2026-12-17', '脊灰疫苗 第2剂', false],
  ['2027-01-17', '脊灰疫苗 第3剂', false],
  ['2027-01-17', '百白破疫苗 第2剂', false],
  ['2027-03-17', '乙肝疫苗 第3剂', false],
  ['2027-03-17', '百白破疫苗 第3剂', false],
  ['2027-03-17', 'A群流脑多糖疫苗 第1剂', false],
  ['2027-05-17', '麻腮风疫苗 第1剂', false],
  ['2027-05-17', '乙脑减毒活疫苗 第1剂', false],
  ['2027-06-17', 'A群流脑多糖疫苗 第2剂', false],
  ['2028-03-17', '百白破疫苗 第4剂', false],
  ['2028-03-17', '麻腮风疫苗 第2剂', false],
  ['2028-03-17', '甲肝减毒活疫苗', false],
  ['2028-09-17', '乙脑减毒活疫苗 第2剂', false],
  ['2029-09-17', 'A群C群流脑多糖疫苗 第3剂', false],
  ['2030-09-17', '脊灰疫苗 第4剂', false],
  ['2032-09-17', '百白破疫苗 第5剂', false],
  ['2032-09-17', 'A群C群流脑多糖疫苗 第4剂', false],
  ['2039-09-17', '双价HPV疫苗 第1剂', false],
  ['2040-03-17', '双价HPV疫苗 第2剂', false],
];

const plan = planVaccines('2026-09-17', '2026-09-29');
t('生日 2026-09-17 生成 24 剂（含可选HPV 2剂），日期/名称/是否已过 全部正确', () => {
  assert.deepEqual(plan.map((d) => [d.date, d.title, d.past]), EXPECTED);
});
t('备注含剂次月龄与免责声明', () => {
  assert.equal(plan[2].note, '国家免疫规划 · 满1月龄 · 以社区医院/接种本实际预约为准');
  assert.match(plan[0].note, /出生时通常已在医院接种/);
  assert.match(plan.find((d) => d.id === 'je-1').note, /灭活疫苗共4剂/);
});
t('百白破为 2、4、6、18月龄和6周岁（2025年起的新程序），不再有白破', () => {
  assert.deepEqual(NIP_SCHEDULE.filter((d) => d.id.startsWith('dtap')).map((d) => d.m), [2, 4, 6, 18, 72]);
  assert.ok(!NIP_SCHEDULE.some((d) => d.name.includes('白破') && !d.name.includes('百白破')));
});
t('2026年版新增双价HPV：仅女孩、13周岁、间隔6个月，可选默认不勾选；其余 22 剂都不是可选', () => {
  const hpv = plan.filter((d) => d.id.startsWith('hpv'));
  assert.deepEqual(hpv.map((d) => [d.m, d.optional, d.age]), [[156, true, '满13周岁'], [162, true, '满13周岁6个月']]);
  assert.ok(hpv.every((d) => /仅女孩/.test(d.note) && /仅女孩/.test(d.hint)));
  assert.equal(plan.filter((d) => !d.optional).length, 22);
});
t('scheduleId 唯一', () => {
  assert.equal(new Set(plan.map((d) => d.scheduleId)).size, plan.length);
});
t('月底对齐', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2026-03-31', 72), '2032-03-31');
  assert.equal(addMonths('2026-12-17', 1), '2027-01-17');
});
t('已添加的剂次会标记 existing（用于去重）', () => {
  const p2 = planVaccines('2026-09-17', '2026-09-29', [{ scheduleId: 'nip:hepb-2', id: 'x' }]);
  assert.equal(p2.filter((d) => d.existing).length, 1);
  assert.equal(p2.find((d) => d.existing).id, 'hepb-2');
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed`);
