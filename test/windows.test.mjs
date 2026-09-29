// 单元测试：接种/体检窗口（最早/最迟）与计划日（node test/windows.test.mjs）
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'win-'));
for (const f of ['windows.js', 'vaccines.js', 'checkups.js', 'paidvax.js', 'dates.js']) fs.copyFileSync(path.join(here, '../site/js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const imp = (f) => import(pathToFileURL(path.join(tmp, f)).href);
const { planVaccines } = await imp('vaccines.js');
const { planCheckups } = await imp('checkups.js');
const { planPaid } = await imp('paidvax.js');
const W = await imp('windows.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('✅', name); };
const B = '2026-09-17';
const nip = Object.fromEntries(planVaccines(B, '2026-09-29', []).map((d) => [d.id, d]));
const paid = Object.fromEntries(planPaid(B, '2026-09-29', []).map((d) => [d.scheduleId, d]));
const chk = Object.fromEntries(planCheckups(B, '2026-09-29', []).map((d) => [d.scheduleId, d]));

t('免费疫苗：最早 = 推荐日期（计划日默认 = 最早）', () => {
  for (const d of Object.values(nip)) assert.equal(d.earliest, d.date, d.id);
});
t('免费疫苗最迟（2026年版「一般原则 一、接种年龄（二）」）', () => {
  const L = { 'hepb-1': '2026-09-18', bcg: '2026-12-16', 'hepb-2': '', 'hepb-3': '2027-09-16', 'polio-1': '', 'polio-3': '2027-09-16', 'polio-4': '2031-09-16',
    'dtap-3': '2027-09-16', 'dtap-4': '2028-09-16', 'dtap-5': '2033-09-16', 'mmr-1': '2027-09-16', 'mmr-2': '2028-09-16', 'je-1': '2027-09-16', 'je-2': '2029-09-16',
    'mpsva-1': '2027-09-16', 'mpsva-2': '2028-09-16', 'mpsvac-1': '2030-09-16', 'mpsvac-2': '2033-09-16', 'hepa-1': '2028-09-16' };
  for (const [id, want] of Object.entries(L)) {
    const d = Object.values(nip).find((x) => x.id === id || x.id === id + '-1' || x.scheduleId === 'nip:' + id);
    assert.ok(d, id);
    assert.equal(d.latest, want, id);
  }
  assert.match(Object.values(nip).find((x) => x.scheduleId.startsWith('nip:bcg')).windowNote, /PPD|结核/);
});
t('自费：RSV 出生即可、计划 10-17、最迟为第一个流行季结束（参考）', () => {
  const r = paid['paid:rsv'];
  assert.equal(r.earliest, '2026-09-17'); assert.equal(r.date, '2026-10-17'); assert.equal(r.latest, '2027-03-31');
});
t('自费：13价首剂 6周~、五价轮状 6~12周 / 第3剂 ≤32周、EV71 6月龄~', () => {
  assert.equal(paid['paid:pcv13-1'].earliest, '2026-10-29'); assert.equal(paid['paid:pcv13-1'].date, '2026-11-17');
  assert.equal(paid['paid:rota5-1'].earliest, '2026-10-29'); assert.equal(paid['paid:rota5-1'].latest, '2026-12-10');
  assert.equal(paid['paid:rota5-3'].latest, '2027-04-29');
  assert.equal(paid['paid:ev71-1'].earliest, '2027-03-17');
});
t('体检：满月 28~42天（参考），计划日不变', () => {
  const m1 = chk['chk:m1'];
  assert.equal(m1.date, '2026-10-17'); assert.equal(m1.earliest, '2026-10-15'); assert.equal(m1.latest, '2026-10-29');
  for (const d of Object.values(chk)) { assert.ok(d.earliest <= d.date, d.scheduleId); assert.ok(!d.latest || d.latest >= d.date, d.scheduleId); }
});
t('fillWindow：旧事项（无窗口字段）按 scheduleId+生日补上；已有的/无 scheduleId 的不动', () => {
  const old = { id: 'a', scheduleId: 'nip:hepb-3', date: '2027-03-20', category: 'vaccine' };
  const f = W.fillWindow(old, B);
  assert.equal(f.earliest, nip[Object.keys(nip).find((k) => nip[k].scheduleId === 'nip:hepb-3')].earliest);
  assert.equal(f.latest, '2027-09-16'); assert.equal(f.date, '2027-03-20');
  const has = { ...old, earliest: '2027-01-01', latest: '' };
  assert.equal(W.fillWindow(has, B), has);
  const manual = { id: 'b', date: '2026-10-01' };
  assert.equal(W.fillWindow(manual, B), manual);
  assert.equal(W.fillWindow(old, ''), old);
});
t('windowStatus：未到窗口 / 窗口中（还剩N天）/ 已过最迟 / 已完成', () => {
  const w = { earliest: '2026-10-15', latest: '2026-10-29' };
  assert.deepEqual(W.windowStatus({}, w, '2026-09-29'), { key: 'before', text: '未到窗口（还有16天）' });
  assert.deepEqual(W.windowStatus({}, w, '2026-10-20'), { key: 'in', text: '窗口中（还剩9天）' });
  assert.equal(W.windowStatus({}, w, '2026-10-29').text, '窗口中（今天是最后一天）');
  assert.deepEqual(W.windowStatus({}, w, '2026-11-01'), { key: 'late', text: '已过最迟（超过3天）' });
  assert.equal(W.windowStatus({ done: true }, w, '2026-11-01').key, 'done');
  assert.equal(W.windowStatus({}, { earliest: '2026-10-15', latest: '' }, '2027-10-20').text, '窗口中');
});
t('planOutside / windowOf（体检标「参考」）', () => {
  const w = { earliest: '2026-10-17', latest: '2027-09-16' };
  assert.equal(W.planOutside('2026-10-16', w), 'early'); assert.equal(W.planOutside('2026-10-20', w), ''); assert.equal(W.planOutside('2027-09-17', w), 'late');
  assert.equal(W.planOutside('2020-01-01', null), '');
  assert.equal(W.windowOf({ scheduleId: 'chk:m1', category: 'checkup' }, B).ref, true);
  assert.equal(W.windowOf({ scheduleId: 'nip:hepb-2', category: 'vaccine' }, B).ref, false);
  assert.equal(W.windowOf({ category: 'other', date: '2026-10-01' }, B), null);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed`);
