// Contract for the separate, opt-in iPhone Shortcuts workflow.
import { toLocalInput } from './dates.js';
import { alarmLines, alarmSig, alarmTag, futureAlarms, shortcutName } from './shortcuts.js';

export const ALARM_BATCH_PROTOCOL = 'babyrecord-alarm-batch-v1';

function oldMinutes(signature) {
  const separator = String(signature || '').indexOf('|');
  if (separator < 1) return [];
  const times = signature.slice(0, separator).split(',');
  if (times.some((time) => !/^\d{12,13}$/.test(time) || Number(time) % 60000)) return [];
  return [...new Set(times.map(Number))].sort((a, b) => a - b);
}

export function buildAlarmBatch(events, allEvents, now = Date.now()) {
  const groups = [];
  const issues = [];
  const tagCounts = new Map();
  for (const ev of allEvents) {
    const tag = alarmTag(ev);
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const seen = new Set();
  for (const ev of events) {
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const tag = alarmTag(ev);
    const old = oldMinutes(ev.alarmSig).filter((time) => time > now);
    if (!ev.alarmAdded || !ev.alarmTagged || !old.length || tagCounts.get(tag) !== 1) {
      issues.push({ title: ev.title, message: '缺少可确认的旧时间或唯一事项编号' });
      continue;
    }

    const upcoming = futureAlarms(ev, now);
    if (!upcoming.length) {
      issues.push({ title: ev.title, message: '没有未来的新响铃时间，需单独核对旧提醒' });
      continue;
    }
    const newTimes = new Set(upcoming.map(({ fireAt }) => fireAt));
    const oldTimes = new Set(old);
    const remove = old.filter((time) => !newTimes.has(time)).map(toLocalInput);
    const keep = old.filter((time) => newTimes.has(time)).map(toLocalInput);
    const create = alarmLines(ev, upcoming.filter(({ fireAt }) => !oldTimes.has(fireAt))).map((line) => {
      const [stamp, title, notes] = line.split('|');
      return { minute: stamp.replace(' ', 'T'), title, notes };
    });
    if (!remove.length && !create.length) {
      issues.push({ title: ev.title, message: '时刻未变，暂不自动改动提醒' });
      continue;
    }
    groups.push({ id: ev.id, title: ev.title, tag, remove, keep, create, previous: ev.alarmSig, next: alarmSig(ev) });
  }
  return { groups, issues };
}

export function alarmBatchShortcutName() { return shortcutName() + '批量更新'; }

export function alarmBatchUrl(plan, successUrl) {
  if (!plan.groups.length || plan.issues.length) return '';
  const data = JSON.stringify({
    protocol: ALARM_BATCH_PROTOCOL,
    list: '宝宝',
    groups: plan.groups.map(({ title, tag, remove, keep, create }) => ({ title, tag, remove, keep, create })),
  });
  const path = successUrl ? 'x-callback-url/run-shortcut' : 'run-shortcut';
  const callback = successUrl ? '&x-success=' + encodeURIComponent(successUrl) : '';
  return 'shortcuts://' + path + '?name=' + encodeURIComponent(alarmBatchShortcutName()) +
    '&input=text&text=' + encodeURIComponent(data) + callback;
}
