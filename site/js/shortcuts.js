// iOS 快捷指令「宝宝闹钟」：把一个事项的全部提醒时间一次性交给快捷指令，
// 由快捷指令在 iCloud 列表「宝宝」里为每个时间新建一条「紧急」提醒事项（iOS 26.2+ 会像闹钟一样全屏响铃）。
//
// 传入文本格式（每行一个提醒，字段用 | 分隔）：
//   2026-09-30 20:00|【宝宝】明天 10:00 打疫苗|💉疫苗 · 10月1日 10:00 · 前一天 20:00提醒 · 备注：带疫苗本 · <宝宝#mg3k2x9a1b2c3>
// v1.7.1：备注（最后一个字段）末尾加上事项标记 <宝宝#事项id>，同一事项的每条提醒都带同一个标记。
// 「宝宝闹钟」开头运行「宝宝闹钟删除」：用「匹配文本」找出标记，再「查找提醒事项」（列表 是 宝宝、备注 包含 标记）→「移除提醒事项」，
// 所以重设闹钟会先删掉旧的再新建。字段数不变（仍是 时间|标题|备注），没更新的旧快捷指令照常工作（备注里多一个标记）。
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
// 事项标记：<宝宝#id>。id 只用 0-9a-z，快捷指令里用正则 宝宝#[0-9a-z]+> 取出（尖括号不是正则特殊字符，不用转义；
// 末尾的 > 保证不会把 宝宝#abc> 误当成 宝宝#abcd> 的一部分）
export function tagId(id) {
  const s = String(id || '');
  if (/^[0-9a-z]+$/.test(s)) return s;
  let h = 5381; for (const ch of s) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; // 非常规 id（导入的备份等）：稳定的短哈希
  return 'x' + h.toString(36);
}
export function alarmTag(ev) { return `<宝宝#${tagId(ev.id)}>`; }
export function alarmLines(ev, list = futureAlarms(ev)) {
  const c = CATEGORIES[ev.category];
  const tag = alarmTag(ev);
  return list.map((x) => {
    const note = [`${c.icon}${c.label}`, `${cnDate(ev.date)}${ev.time ? ' ' + ev.time : '（全天）'}`, clean(x.label), ev.note ? `备注：${clean(ev.note)}` : '', tag].filter(Boolean).join(' · ');
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
  // 测试提醒也带固定标记 <宝宝#test>：更新快捷指令后，再测一次会替换上一次的测试提醒
  return runShortcutUrl(`${stamp(t)}|【宝宝】测试闹钟（2分钟后响）|宝宝记录 · 测试紧急提醒是否会像闹钟一样响 · <宝宝#test>`);
}
// v1.7.1：第二个快捷指令「宝宝闹钟删除」（名称 = 闹钟快捷指令名称 + 删除）：传入含标记的文本，删除「宝宝」列表里备注带这些标记的提醒
export function deleteShortcutName() { return `${shortcutName()}删除`; }
export function deleteAlarmText(evs) { return [...new Set(evs.map(alarmTag))].join('\n'); }
export function deleteAlarmUrl(evs) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(deleteShortcutName())}&input=text&text=${encodeURIComponent(deleteAlarmText(evs))}`;
}
