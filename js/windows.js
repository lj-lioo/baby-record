// 接种/体检窗口：最早日期、最迟日期、状态。
// 事项里保存 earliest / latest / windowNote（v1.6.0 起）；没有保存的（旧版本同步来的、旧数据）按 scheduleId + 宝宝生日从生成器推算。
// 事项的 date / time 就是「计划日期/时间」：提醒、闹钟、苹果日历都按它；默认计划日 = 生成器的推荐日（疫苗 = 最早日）。
import { planVaccines } from './vaccines.js';
import { planCheckups } from './checkups.js';
import { planPaid } from './paidvax.js';

const cache = new Map();
function planMap(birthday) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday || '')) return null;
  if (!cache.has(birthday)) {
    const m = new Map();
    for (const f of [planVaccines, planPaid, planCheckups]) {
      try { for (const d of f(birthday, '0000-00-00', [])) m.set(d.scheduleId, { earliest: d.earliest || '', latest: d.latest || '', windowNote: d.windowNote || '' }); } catch (e) { console.warn('窗口推算失败', e); }
    }
    cache.set(birthday, m);
  }
  return cache.get(birthday);
}

// 生成器里的窗口（按 scheduleId）；没有则 null
export function derivedWindow(scheduleId, birthday) {
  if (!scheduleId) return null;
  const m = planMap(birthday);
  return (m && m.get(scheduleId)) || null;
}

// 给缺少窗口字段的计划事项补上（不改 updatedAt，不影响同步）；出错时原样返回
export function fillWindow(ev, birthday) {
  try {
    if (!ev || ev.earliest || !ev.scheduleId) return ev;
    const w = derivedWindow(ev.scheduleId, birthday);
    return w ? { ...ev, ...w } : ev;
  } catch (e) { return ev; }
}

// 事项的窗口 { earliest, latest, note, ref }；没有窗口返回 null
export function windowOf(ev, birthday) {
  const w = ev.earliest ? { earliest: ev.earliest, latest: ev.latest || '', windowNote: ev.windowNote || '' } : derivedWindow(ev.scheduleId, birthday);
  if (!w || !w.earliest) return null;
  return { earliest: w.earliest, latest: w.latest || '', note: w.windowNote || '', ref: ev.category === 'checkup' || /参考/.test(w.windowNote || '') };
}

const dayDiff = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);

// 状态：done 已完成 / before 未到窗口 / in 窗口中 / late 已过最迟
export function windowStatus(ev, w, today) {
  if (ev.done) return { key: 'done', text: '已完成' };
  if (today < w.earliest) return { key: 'before', text: `未到窗口（还有${dayDiff(today, w.earliest)}天）` };
  if (w.latest && today > w.latest) return { key: 'late', text: `已过最迟（超过${dayDiff(w.latest, today)}天）` };
  if (w.latest) { const n = dayDiff(today, w.latest); return { key: 'in', text: n === 0 ? '窗口中（今天是最后一天）' : `窗口中（还剩${n}天）` }; }
  return { key: 'in', text: '窗口中' };
}

// 计划日是否在窗口外：'early' 早于最早 / 'late' 晚于最迟 / ''
export function planOutside(date, w) {
  if (!w) return '';
  if (date < w.earliest) return 'early';
  if (w.latest && date > w.latest) return 'late';
  return '';
}
export { dayDiff };
