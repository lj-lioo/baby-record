// 提醒规则：每个事项可设置多个提醒（预设 + 自定义具体时间）。
// 同一套规则同时用于：App 内全屏闹钟、Web 推送、.ics 日历提醒、快捷指令。
import { atLocal, addDays, fmtDateTime, humanDuration, cnDate, pad } from './dates.js';
import { CATEGORIES } from './categories.js';
import { store, uid } from './store.js';

// needsTime: 只有设置了具体时间的事项才可用
export const PRESETS = [
  { key: 'eve20',    label: '前一天 20:00', needsTime: false },
  { key: 'morning8', label: '当天 08:00',   needsTime: false },
  { key: 'd1',       label: '提前1天',      needsTime: true, offsetMin: 1440 },
  { key: 'h2',       label: '提前2小时',    needsTime: true, offsetMin: 120 },
  { key: 'h1',       label: '提前1小时',    needsTime: true, offsetMin: 60 },
  { key: 'm30',      label: '提前30分钟',   needsTime: true, offsetMin: 30 },
  { key: 'm0',       label: '准时提醒',     needsTime: true, offsetMin: 0 },
];
export const presetByKey = Object.fromEntries(PRESETS.map((p) => [p.key, p]));

export function defaultReminders(hasTime) {
  const r = [{ id: uid(), kind: 'preset', preset: 'eve20' }, { id: uid(), kind: 'preset', preset: 'morning8' }];
  if (hasTime) r.push({ id: uid(), kind: 'preset', preset: 'h1' });
  return r;
}

// 事项开始时间（无具体时间时视为当天 00:00 的全天事项）
export function eventStart(ev) { return atLocal(ev.date, ev.time || '00:00').getTime(); }

export function fireAtOf(ev, r) {
  if (r.kind === 'abs') {
    if (!r.at) return null;
    const [d, t] = r.at.split('T');
    return atLocal(d, t).getTime();
  }
  const p = presetByKey[r.preset];
  if (!p) return null;
  if (p.key === 'eve20') return atLocal(addDays(ev.date, -1), '20:00').getTime();
  if (p.key === 'morning8') return atLocal(ev.date, '08:00').getTime();
  if (!ev.time) return null; // 需要时间但没有设置
  return eventStart(ev) - p.offsetMin * 60000;
}

export function reminderLabel(r) {
  if (r.kind === 'abs') return r.at ? `自定义：${fmtDateTime(atLocal(...r.at.split('T')).getTime())}` : '自定义时间';
  return presetByKey[r.preset]?.label || '提醒';
}

export function eventWhenText(ev) {
  return `${cnDate(ev.date)}${ev.time ? ' ' + ev.time : '（全天）'}`;
}

// 通知标题：「宝宝提醒：今天 10:00 打疫苗」
export function notifyTitle(ev) {
  const start = eventStart(ev);
  const when = ev.time ? fmtDateTime(start) : fmtDateTime(start).split(' ')[0];
  return `宝宝提醒：${when} ${ev.title}`;
}
export function whyText(ev, fireAt, label) {
  const start = eventStart(ev);
  const diff = start - fireAt;
  let rel;
  if (!ev.time) rel = diff > 0 ? `${cnDate(ev.date)}有「${ev.title}」` : `今天有「${ev.title}」`;
  else if (Math.abs(diff) < 60000) rel = `「${ev.title}」现在开始`;
  else if (diff > 0) rel = `距离「${ev.title}」还有${humanDuration(diff)}`;
  else rel = `「${ev.title}」已开始${humanDuration(diff)}`;
  return `${label} · ${rel}`;
}
export function notifyBody(ev, fireAt, label) {
  const cat = CATEGORIES[ev.category];
  let s = `${cat.icon} ${cat.label} · ${eventWhenText(ev)}\n${whyText(ev, fireAt, label)}`;
  if (ev.note) s += `\n备注：${ev.note}`;
  return s;
}

// 列出所有提醒实例（含稍后提醒）
export function allReminderInstances() {
  const st = store.state;
  const out = [];
  for (const ev of st.events) {
    if (ev.done) continue;
    for (const r of ev.reminders || []) {
      const fireAt = fireAtOf(ev, r);
      if (fireAt == null) continue;
      out.push({ rid: `${ev.id}:${r.id}:${fireAt}`, eventId: ev.id, fireAt, label: r.kind === 'abs' ? '自定义时间提醒' : reminderLabel(r) + '提醒' });
    }
  }
  for (const s of st.snoozes) {
    const ev = st.events.find((e) => e.id === s.eventId);
    if (!ev || ev.done) continue;
    out.push({ rid: s.id, eventId: ev.id, fireAt: s.fireAt, label: s.label || '稍后提醒' });
  }
  // 同一事项同一时刻只响一次
  const seen = new Set();
  return out.sort((a, b) => a.fireAt - b.fireAt).filter((x) => {
    const k = `${x.eventId}@${x.fireAt}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// 给推送服务端的待发送列表
export function pushPayloads(baseUrl) {
  const now = Date.now();
  return allReminderInstances()
    .filter((x) => x.fireAt > now - 60000 && !store.isFired(x.rid))
    .slice(0, 300)
    .map((x) => {
      const ev = store.getEvent(x.eventId);
      return {
        id: x.rid,
        fireAt: x.fireAt,
        title: notifyTitle(ev), // 备用文本；服务器发送时会按当时日期重新生成「今天/明天」
        body: notifyBody(ev, x.fireAt, x.label),
        url: `${baseUrl}#/alarm?rid=${encodeURIComponent(x.rid)}&e=${encodeURIComponent(ev.id)}`,
        eventId: ev.id,
        // 服务器按事项日期+时间重新生成相对日期词（今天/明天），避免同步时与发送时日期不同
        ev: { title: ev.title, date: ev.date, time: ev.time, note: ev.note, category: ev.category, label: x.label },
      };
    });
}

export function describeFire(fireAt) { return fmtDateTime(fireAt); }
export { pad };
