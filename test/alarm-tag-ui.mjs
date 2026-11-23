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
  upsertEvent(ev) { const copy = { ...ev }; events.set(copy.id, copy); return copy; },
  setAlarmAdded(id, added, sig = '', tagged = false) {
    Object.assign(events.get(id), { alarmAdded: added, alarmSig: sig, alarmTagged: tagged });
  },
};
const context = createContext({
  Date: TestDate,
  localStorage: {
    getItem: (key) => pieces.get(key) ?? null,
    setItem: (key, value) => pieces.set(key, value),
    removeItem: (key) => pieces.delete(key),
  },
  location: { set href(value) { launched.push(value); } },
  CustomEvent: class {},
  window: { dispatchEvent() {} },
});
const esc = (x) => String(x ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const mock = new Map([
  ['js/store.js', { store, uid: () => String(++idCounter) }],
  ['js/roles.js', { requireAlarm: () => true, requireEditEvents: () => true }],
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
console.log('Alarm regressions passed: creation, pending, exact locator, edit, reschedule, cleanup.');
