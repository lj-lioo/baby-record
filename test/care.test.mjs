import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { summarizeCare, validateCare } from '../site/js/care.js';
import { newSyncKey } from '../site/js/sync-core.js';
import worker from '../sync/worker/src/index.js';

test('实测奶量和用药分开统计，日期范围两端都包含', () => {
  const base = { kind: 'bottle', date: '2024-02-29', time: '15:30', ml: 80.5 };
  assert.equal(validateCare(base), '');
  assert.ok(validateCare({ ...base, date: '2025-02-29' }));
  assert.ok(validateCare({ ...base, time: '24:00' }));
  assert.ok(validateCare({ ...base, ml: '' }));
  assert.ok(validateCare(base, '2024-02-29T15:29'));
  assert.equal(validateCare({ ...base, kind: 'nursing', ml: '', minutes: '' }), '');
  assert.ok(validateCare({ ...base, kind: 'nursing', minutes: '0.5' }));
  assert.ok(validateCare({ ...base, kind: 'dose', name: '' }));
  assert.equal(validateCare({ ...base, kind: 'dose', name: '示例补充剂', time: '' }), '');
  assert.ok(validateCare({ ...base, kind: 'dose', name: '示例补充剂', time: '' }, '2024-02-28T23:59'));
  const report = summarizeCare([
    base, { ...base, ml: 0.1, date: '2024-02-24' },
    { ...base, kind: 'nursing' }, { ...base, kind: 'stool', date: '2024-03-01' },
    { ...base, kind: 'urine', date: '2024-03-01' }, { ...base, kind: 'urine', date: '2024-02-28' },
    { ...base, kind: 'dose', date: '2024-03-01', name: '示例补充剂' },
    { ...base, ml: 900, date: '2024-02-23' }, { ...base, ml: 900, deleted: true },
  ], [{ date: '2024-02-29' }], '2024-03-01', 7);
  assert.equal(report.daily[0].date, '2024-02-24');
  assert.equal(report.recordedDays, 4);
  assert.equal(report.totals.bottleMl, 80.6);
  assert.equal(report.totals.nursing, 1);
  assert.equal(report.totals.nursingMl, 80.5);
  assert.equal(report.totals.nursingMeasured, 1);
  assert.equal(report.totals.stool, 1);
  assert.equal(report.totals.urine, 2);
  assert.equal(report.totals.dose, 1);
  assert.equal(report.totals.legacyDose, 1);
  assert.deepEqual(report.milkByType, [['未标注', 80.6]]);
  assert.deepEqual(report.dosesByName, [['示例补充剂', 1]]);
});

test('纸本页以早上八点换日，普通记录仍按实际日期归入统计', () => {
  const base = { kind: 'bottle', date: '2024-03-01', ml: 50 };
  const report = summarizeCare([
    { ...base, time: '07:59', paper: true },
    { ...base, time: '08:00', paper: true },
    { ...base, time: '01:30' },
    { kind: 'dose', date: '2024-02-29', time: '', name: '示例补充剂', paper: true },
  ], [], '2024-03-01', 2);
  assert.deepEqual(report.daily.map((day) => [day.bottle, day.bottleMl, day.dose]), [[1, 50, 1], [2, 100, 0]]);
});

test('原 Worker 可用原配对协议同步照护记录，重复拉取和旧备份保留历史', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'care-sync-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec(fs.readFileSync(new URL('../sync/worker/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(query) {
      const statement = db.prepare(query);
      return { bind: (...args) => ({
        first: () => statement.get(...args),
        all: () => ({ results: statement.all(...args) }),
        run: () => ({ meta: { changes: statement.run(...args).changes } }),
      }) };
    },
    batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const key = newSyncKey();
  const history = {
    events: [{ id: 'history-event', title: '旧事项', date: '2024-02-29', category: 'other', done: true, updatedAt: 100 }],
    growth: [{ id: 'history-growth', date: '2024-02-29', height: 55, updatedAt: 101 }],
    meds: [{ id: 'history-med', name: '旧用药', start: '2024-02-29', updatedAt: 102 }],
    settings: { memberRole: '爸爸' },
  };
  const api = 'https://care.test';
  globalThis.window = { BABY_CONFIG: { syncApi: api }, dispatchEvent() {} };
  let beforeDelivery = null;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, api + '/v1/sync');
    assert.notEqual(options.headers.Authorization, 'Bearer ' + key);
    if (beforeDelivery) beforeDelivery(JSON.parse(options.body));
    return worker.fetch(new Request(url, options), { DB });
  };
  async function phone(name, initialData) {
    const source = path.join(dir, name);
    fs.cpSync(new URL('../site/js/', import.meta.url), source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{"type":"module"}');
    const data = new Map([
      ['babyrecord.v1', JSON.stringify(initialData)],
      ['babyrecord.sync', JSON.stringify({ enabled: true, key, cursor: 0, acked: {}, dels: {} })],
    ]);
    const storage = {
      getItem: (id) => data.get(id) ?? null,
      setItem: (id, value) => data.set(id, value),
    };
    globalThis.localStorage = storage;
    const { store } = await import(pathToFileURL(path.join(source, 'store.js')).href);
    const sync = await import(pathToFileURL(path.join(source, 'sync.js')).href);
    return {
      store,
      async run() {
        globalThis.localStorage = storage;
        await sync.syncNow('care-test');
        assert.equal(sync.syncStatus().lastError, '');
      },
      sync,
    };
  }
  const a = await phone('a', history);
  const first = a.store.upsertCare({ date: '2024-03-01', time: '09:30', kind: 'bottle', ml: 92.5, milk: 'breast', note: '示例备注' });
  const removedDuringUpload = a.store.upsertCare({ date: '2024-03-01', time: '10:00', kind: 'stool' });
  beforeDelivery = ({ changes }) => {
    if (!changes.some((record) => record.id === 'care:' + removedDuringUpload.id)) return;
    beforeDelivery = null;
    a.store.deleteCare(removedDuringUpload.id);
  };
  await a.run();
  assert.equal(a.store.getCare(removedDuringUpload.id), undefined);
  await a.run();
  const b = await phone('b', { events: [] });
  await b.run();
  const originalBackup = JSON.parse(a.store.exportJSON()).data;
  assert.equal(b.store.events()[0].id, 'history-event');
  assert.equal(b.store.events()[0].done, true);
  assert.equal(b.store.growth()[0].id, 'history-growth');
  assert.equal(b.store.meds()[0].id, 'history-med');
  assert.deepEqual(b.store.getCare(first.id), first);
  assert.deepEqual(b.store.care().map((record) => record.id), [first.id]);
  const cloud = db.prepare("SELECT id, data, deleted FROM records WHERE id LIKE 'care:%' ORDER BY seq").all();
  assert.match(cloud[0].data, /^v1\./);
  assert.ok(!cloud[0].data.includes(first.note));
  assert.equal(cloud[1].deleted, 1);

  const dose = { id: 'import-dose-test', date: first.date, time: '', kind: 'dose', name: '示例补充剂', paper: true };
  const [second] = b.store.appendImportedCare([dose]);
  assert.deepEqual(b.store.appendImportedCare([{ ...dose, name: '重复导入不应修改记录' }]), []);
  const toilet = b.store.addCare(['stool', 'urine'].map((kind) => ({ date: first.date, time: first.time, kind })));
  b.store.deleteCare(first.id);
  await b.run();
  await a.run();
  assert.equal(a.store.getCare(first.id), undefined);
  assert.deepEqual(a.store.getCare(second.id), second);
  assert.equal(a.store.getCare(second.id).time, '');
  for (const record of toilet) assert.deepEqual(a.store.getCare(record.id), record);
  a.store.deleteCareBatch(toilet.map((record) => record.id));
  await a.run();
  await b.run();
  for (const record of toilet) assert.equal(b.store.getCare(record.id), undefined);
  b.store.deleteCare(second.id);
  assert.deepEqual(b.store.appendImportedCare([dose]), []);
  // 已删除的记录不能被迟到的旧响应或旧备份复活。
  a.store.applyRemoteCare([first]);
  a.store.importJSON(JSON.stringify(originalBackup));
  assert.equal(a.store.getCare(first.id), undefined);
  const current = a.store.upsertCare({ date: '2024-03-01', time: '12:10', kind: 'nursing' });
  a.store.importJSON(JSON.stringify(history));
  assert.equal(a.store.getCare(current.id).ml, null);
  assert.equal(a.store.events()[0].id, 'history-event');
  assert.equal(a.store.meds()[0].id, 'history-med');
  assert.equal(a.sync.syncStatus().key, key);
});
