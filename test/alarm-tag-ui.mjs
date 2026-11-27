// Run with node --experimental-vm-modules test/alarm-tag-ui.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const events = new Map();
const pieces = new Map();
const launched = [];
let idCounter = 0;
let sheet;
const now = new Date(2026, 10, 23, 9).getTime();
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const store = {
  state: { settings: {}, events: [], snoozes: [] },
  getEvent(id) { return events.get(id); },
  upsertEvent(ev) {
    const copy = { ...ev };
    events.set(copy.id, copy);
    this.state.events = [...events.values()];
    return copy;
  },
  setAlarmAdded(id, added, sig = '', tagged = false) {
    Object.assign(events.get(id), { alarmAdded: added, alarmSig: sig, alarmTagged: tagged });
  },
};
const context = createContext({
  Date: TestDate,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  localStorage: {
    getItem: (key) => pieces.get(key) ?? null,
    setItem: (key, value) => pieces.set(key, value),
    removeItem: (key) => pieces.delete(key),
  },
  crypto: globalThis.crypto,
  btoa,
  location: { get href() { return 'https://example.test/baby-record/'; }, set href(value) { launched.push(value); } },
  CustomEvent: class {},
  document: { querySelector: () => sheet },
  window: { BABY_CONFIG: { syncApi: 'https://relay.example' }, dispatchEvent() {} },
});
const esc = (x) => String(x ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const mock = new Map([
  ['js/store.js', { store, uid: () => String(++idCounter) }],
  ['js/roles.js', { canSetAlarm: () => true, requireAlarm: () => true, requireEditEvents: () => true }],
  ['js/ics.js', { openICS() {} }],
  ['js/windows.js', { windowOf: () => null, planOutside: () => '' }],
  ['js/views/paidcat.js', { maybeCascade: () => false }],
  ['js/ui.js', {
    esc,
    toast() {},
    closeSheet() { sheet = null; },
    async confirmSheet() { return true; },
    openSheet(html, onMount) {
      const nodes = new Map([...html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
        const value = /value="([^"]*)"/.exec(tag)?.[1] || '';
        return ['#' + id, { value, querySelectorAll: () => [] }];
      }));
      sheet = { html, dataset: {}, querySelector: (selector) => nodes.get(selector), querySelectorAll: () => [] };
      onMount(sheet);
    },
  }],
]);
const root = new URL('../site/', import.meta.url);
const modules = new Map();
async function loadModule(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const name = url.href.slice(root.href.length);
  const mockExports = mock.get(name);
  const mod = mockExports
    ? new SyntheticModule(Object.keys(mockExports), function () {
      for (const [key, value] of Object.entries(mockExports)) this.setExport(key, value);
    }, { context, identifier: url.href })
    : new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
  modules.set(url.href, mod);
  return mod;
}
async function main(path) {
  const mod = await loadModule(new URL(path, root));
  if (mod.status === 'unlinked') await mod.link((spec, source) => loadModule(new URL(spec, source.identifier)));
  if (mod.status === 'linked') await mod.evaluate();
  return mod.namespace;
}
const shortcuts = await main('js/shortcuts.js');
const actions = await main('js/views/actions.js');
const editor = await main('js/views/editor.js');
const planned = await main('js/views/planned.js');
const click = (selector) => sheet.querySelector(selector).onclick();
const k1 = store.upsertEvent({
  id: 'k1this', title: '维生素K1', category: 'other', date: '2026-11-27', time: '09:00',
  reminders: [{ id: 'r1', kind: 'preset', preset: 'm0' }],
});
const other = store.upsertEvent({ ...k1, id: 'k1other', date: '2026-12-04' });

// Creating invokes the create-only name, and does not mark success until verified.
actions.openAlarmSheet(k1);
click('#al-go');
assert.equal(actions.alarmState(k1), 'pending');
assert.equal(k1.alarmAdded, undefined);
const shortcut = new URL(launched[0]);
assert.equal(shortcut.searchParams.get('name'), '宝宝闹钟仅创建');
assert.match(shortcut.searchParams.get('text'), /2026-11-27 09:00[|].*<宝宝#k1this>$/);
assert.doesNotMatch(shortcut.searchParams.get('text'), /k1other/);
actions.openAlarmSheet(k1);
assert.equal(sheet.querySelector('#al-go'), undefined);
click('#al-confirm');
assert.equal(actions.alarmState(k1), 'added');
assert.equal(k1.alarmTagged, true);
assert.equal(pieces.size, 0);

// Saving Friday → Tuesday in the regular editor shows both absolute times and the exact tag.
editor.openEditor({ id: k1.id });
sheet.querySelector('#f-date').value = '2026-11-24';
click('#f-save');
assert.equal(sheet.dataset.kind, 'alarm');
assert.match(sheet.html, /2026-11-27 周五 09:00/);
assert.match(sheet.html, /2026-11-24 周二 09:00/);
assert.match(sheet.html, /&lt;宝宝#k1this&gt;/);
assert.doesNotMatch(sheet.html, /k1other|shortcuts:|id="al-go"/);
assert.equal(actions.alarmState(store.getEvent(k1.id)), 'changed');
click('#al-confirm');
assert.equal(actions.alarmState(store.getEvent(k1.id)), 'added');
assert.equal(store.getEvent(other.id).date, '2026-12-04');
assert.equal(launched.length, 1);

// The plan-date editor uses the same review. A second edit while the panel is open is rechecked.
planned.openPlannedSheet(store.getEvent(k1.id));
sheet.querySelector('#pd-date').value = '2026-11-25';
click('#pd-save');
assert.match(sheet.html, /2026-11-25 周三 09:00/);
store.upsertEvent({ ...store.getEvent(k1.id), date: '2026-11-26' });
click('#al-confirm');
assert.match(sheet.html, /2026-11-26 周四 09:00/);
assert.equal(actions.alarmState(store.getEvent(k1.id)), 'changed');

// Deleted events and legacy entries offer a locator only, with no automated deletion.
const current = store.getEvent(k1.id);
assert.equal(actions.offerOldAlarmCleanup([current]), true);
assert.match(sheet.html, /&lt;宝宝#k1this&gt;/);
assert.doesNotMatch(sheet.html, /k1other|shortcuts:/);
actions.openAlarmSheet({ ...other, alarmAdded: true, alarmSig: '', alarmTagged: false });
assert.match(sheet.html, /旧响铃时间未记录/);
assert.equal(sheet.querySelector('#al-go'), undefined);
assert.equal(new URL(shortcuts.testAlarmUrl()).searchParams.get('name'), '宝宝闹钟仅创建');
assert.equal(Object.hasOwn(shortcuts, 'deleteAlarmUrl'), false);
// A missing shortcut leaves the item pending. Resetting lets the same item launch again.
const pentavalent = store.upsertEvent({ ...other, id: 'pentavalent', title: '五联疫苗', category: 'paidvax' });
actions.openAlarmSheet(pentavalent);
assert.match(sheet.html, /找不到「宝宝闹钟仅创建」/);
click('#al-go');
assert.equal(actions.alarmState(pentavalent), 'pending');
assert.match(sheet.html, /确认未创建，返回重试/);
click('#al-cleared');
assert.equal(actions.alarmState(pentavalent), 'none');
assert.equal(pentavalent.alarmAdded, undefined);
click('#al-go');
assert.equal(actions.alarmState(pentavalent), 'pending');
assert.equal(new URL(launched.at(-1)).searchParams.get('name'), '宝宝闹钟仅创建');
assert.equal(store.getEvent(other.id).alarmAdded, undefined);
assert.equal(actions.applyAlarmCallback({ id: pentavalent.id, sig: shortcuts.alarmSig(pentavalent), nonce: 'wrong' }), false);
const callbackSig = shortcuts.alarmSig(pentavalent);
pieces.set('babyrecord.alarmPending.' + pentavalent.id, JSON.stringify({ sig: callbackSig, receipt: 'valid' }));
assert.equal(actions.applyAlarmCallback({ id: pentavalent.id, sig: 'old plan', nonce: 'valid' }), false);
assert.equal(actions.alarmState(pentavalent), 'pending');
assert.equal(actions.applyAlarmCallback({ id: pentavalent.id, sig: callbackSig, nonce: 'valid' }), true);
assert.equal(actions.alarmState(pentavalent), 'added');
assert.equal(actions.applyAlarmCallback({ id: pentavalent.id, sig: callbackSig, nonce: 'valid' }), false);
console.log('Alarm regressions passed: creation, retry, success callback, exact locator, edit, reschedule, cleanup.');

// Batch handoff with seven preset reminders for one event.
const batch = await main('js/alarm-batch.js');
const seven = ['eve20', 'morning8', 'd1', 'h2', 'h1', 'm30', 'm0'];
const friday = store.upsertEvent({
  id: 'k1batch', title: '维生素K1', category: 'other', date: '2026-11-27', time: '11:00',
  reminders: seven.map((preset) => ({ id: preset, preset, kind: 'preset' })),
});
store.setAlarmAdded(friday.id, true, shortcuts.alarmSig(friday), true);
const tuesday = store.upsertEvent({ ...friday, date: '2026-11-24' });
const plan = batch.buildAlarmBatch([tuesday], store.state.events, now);
assert.equal(plan.issues.length, 0);
assert.equal(plan.groups[0].remove.length, 7);
assert.equal(plan.groups[0].create.length, 7);
actions.openAlarmSheet(tuesday);
click('#al-batch-this');
assert.equal(sheet.dataset.kind, 'alarmbatch');
assert.match(sheet.html, /新增 7 条、移除 7 条旧提醒/);
click('#al-batch-go');
assert.equal(actions.alarmState(tuesday), 'changed');
const url = new URL(launched.at(-1));
assert.equal(url.searchParams.get('name'), '宝宝闹钟批量更新');
assert.equal(url.hostname, 'x-callback-url');
const callbackUrl = new URL(url.searchParams.get('x-success'));
assert.match(callbackUrl.hash, /batch=1/);
assert.doesNotMatch(callbackUrl.href, /k1batch|K1/);
const job = JSON.parse(url.searchParams.get('text'));
assert.equal(job.protocol, batch.ALARM_BATCH_PROTOCOL);
assert.equal(job.list, '宝宝');
assert.equal(job.groups.length, 1);
assert.equal(job.groups[0].tag, '<宝宝#k1batch>');
assert.ok(job.groups[0].create.every(({ notes }) => notes.endsWith(job.groups[0].tag)));

// Emulate the native checklist to test the scope of the payload and failure cases.
const group = job.groups[0];
const original = group.remove.map((minute, i) => ({
  id: 'old' + i, list: 'fixed-baby-list', minute, title: '维生素K1', notes: '备注 · ' + group.tag,
}));
const others = [
  { ...original[0], id: 'same-title', notes: '<宝宝#another>' },
  { ...original[0], id: 'other-list', list: 'different-list' },
  { ...original[0], id: 'no-tag', notes: '' },
  { ...original[0], id: 'embedded-tag', notes: group.tag + ' · 备注中提及' },
];
function simulateNative(originalState, failCreation = false) {
  const matching = (tag, minute) => originalState.filter((r) =>
    r.list === 'fixed-baby-list' && !r.completed && r.minute === minute && r.notes.endsWith(tag));
  const old = [];
  const additions = [];
  for (const { tag, remove, keep, create } of job.groups) {
    for (const minute of [...remove, ...keep]) {
      const row = matching(tag, minute);
      if (row.length !== 1) return originalState;
      if (remove.includes(minute)) old.push(row[0].id);
    }
    for (const item of create) {
      const row = matching(tag, item.minute);
      if (!row.length) additions.push(item);
      else if (row.length !== 1 || row[0].notes !== item.notes || row[0].title !== item.title) return originalState;
    }
  }
  if (failCreation) return originalState.concat(additions.slice(0, 2));
  return originalState.filter((r) => !old.includes(r.id)).concat(additions);
}
const populated = [...original, ...others];
assert.deepEqual(simulateNative(populated), [...others, ...group.create]);
const missing = [...original.slice(1), ...others];
assert.equal(simulateNative(missing), missing);
const duplicate = [...populated, { ...original[0], id: 'duplicate' }];
assert.equal(simulateNative(duplicate), duplicate);
const conflict = [...populated, { ...original[0], id: 'conflict', minute: group.create[0].minute }];
assert.equal(simulateNative(conflict), conflict);
assert.deepEqual(simulateNative(populated, true), [...populated, ...group.create.slice(0, 2)]);
const result = JSON.parse(pieces.get('babyrecord.alarmCallbackAttempt'));
assert.equal(result.batch.length, 1);
assert.equal(result.batch[0].id, tuesday.id);
assert.equal(actions.confirmAlarmBatch([{ ...result.batch[0], next: 'an outdated plan' }]), false);
assert.equal(actions.alarmState(tuesday), 'changed');
assert.equal(actions.confirmAlarmBatch(result.batch), true);
assert.equal(actions.alarmState(tuesday), 'added');
assert.equal(store.getEvent(other.id).alarmAdded, undefined);

// Batch across different events and keep unchanged absolute reminders.
const fixed = { id: 'fixed', kind: 'abs', at: '2026-11-29T10:00' };
const event = store.upsertEvent({ ...k1, id: 'k1mixed', reminders: [...k1.reminders, fixed] });
store.setAlarmAdded(event.id, true, shortcuts.alarmSig(event), true);
const moved = store.upsertEvent({ ...event, date: '2026-11-25' });
const multi = batch.buildAlarmBatch([moved, { ...tuesday, alarmSig: friday.alarmSig }], store.state.events, now);
assert.equal(multi.groups.length, 2);
assert.deepEqual(Array.from(multi.groups[0].keep), [fixed.at]);
assert.equal(multi.groups[0].remove.length, 1);
assert.equal(multi.groups[0].create.length, 1);
assert.equal(batch.alarmBatchUrl(batch.buildAlarmBatch([{ ...moved, alarmTagged: false }], store.state.events, now)), '');
assert.equal(batch.alarmBatchUrl(batch.buildAlarmBatch([moved], [...store.state.events, moved], now)), '');
console.log('Batch regressions passed: seven replacements, exact scope, missing/duplicate/conflicting targets, failed creation, unchanged times.');
