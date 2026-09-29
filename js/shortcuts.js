// iOS 快捷指令「宝宝闹钟」：把一个事项的全部提醒时间一次性交给快捷指令，
// 由快捷指令在 iCloud 列表「宝宝」里为每个时间新建一条「紧急」提醒事项（iOS 26.2+ 会像闹钟一样全屏响铃）。
//
// 传入文本格式（每行一个提醒，字段用 | 分隔）：
//   2026-09-30 20:00|【宝宝】明天 10:00 打疫苗|💉疫苗 · 10月1日 10:00 · 前一天 20:00提醒 · 备注：带疫苗本
import { store } from './store.js';
import { ymd, pad, daysBetween, cnDate } from './dates.js';
import { allReminderInstances } from './reminders.js';
import { CATEGORIES } from './categories.js';

const clean = (s) => String(s || '').replace(/[|\r\n]+/g, ' ').trim();
const stamp = (ms) => { const d = new Date(ms); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function relToFire(evDate, fireAt) {
  const n = daysBetween(ymd(new Date(fireAt)), evDate);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  return cnDate(evDate);
}

// 该事项所有“未来的”提醒（已去重）
export function futureAlarms(ev, now = Date.now()) {
  return allReminderInstances().filter((x) => x.eventId === ev.id && x.fireAt > now && !x.rid.startsWith('snz-'));
}
export function alarmTitle(ev, fireAt) {
  return `【宝宝】${relToFire(ev.date, fireAt)}${ev.time ? ' ' + ev.time : ''} ${clean(ev.title)}`;
}
export function alarmLines(ev, list = futureAlarms(ev)) {
  const c = CATEGORIES[ev.category];
  return list.map((x) => {
    const note = [`${c.icon}${c.label}`, `${cnDate(ev.date)}${ev.time ? ' ' + ev.time : '（全天）'}`, clean(x.label), ev.note ? `备注：${clean(ev.note)}` : ''].filter(Boolean).join(' · ');
    return `${stamp(x.fireAt)}|${alarmTitle(ev, x.fireAt)}|${note}`;
  });
}
// 提醒时间“签名”：用于判断设置闹钟后是否又改过时间
export function alarmSig(ev) { return futureAlarms(ev, 0).map((x) => x.fireAt).join(',') + '|' + ev.title; }

export function shortcutName() { return store.state.settings.shortcutName || '宝宝闹钟'; }
export function runShortcutUrl(text) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName())}&input=text&text=${encodeURIComponent(text)}`;
}
export function alarmUrl(ev) { return runShortcutUrl(alarmLines(ev).join('\n')); }
export function testAlarmUrl() {
  const t = Date.now() + 2 * 60000;
  return runShortcutUrl(`${stamp(t)}|【宝宝】测试闹钟（2分钟后响）|宝宝记录 · 测试紧急提醒是否会像闹钟一样响`);
}
