// 日期工具：全部使用手机本地时间（用户在 Asia/Shanghai）。
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function atLocal(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
export function addDays(dateStr, n) { const d = parseYmd(dateStr); d.setDate(d.getDate() + n); return ymd(d); }
export function daysBetween(fromStr, toStr) { return Math.round((parseYmd(toStr) - parseYmd(fromStr)) / 864e5); }
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const weekday = (dateStr) => '周' + WEEK[parseYmd(dateStr).getDay()];
export function cnDate(dateStr, withYear = false) {
  const d = parseYmd(dateStr);
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日`;
}
export function countdown(dateStr) {
  const n = daysBetween(todayStr(), dateStr);
  if (n === 0) return { text: '今天', level: 'today', n };
  if (n === 1) return { text: '明天', level: 'soon', n };
  if (n === 2) return { text: '后天', level: 'soon', n };
  if (n > 0) return { text: `还有${n}天`, level: 'later', n };
  return { text: `已过${-n}天`, level: 'overdue', n };
}
export function relDayWord(dateStr) {
  const n = daysBetween(todayStr(), dateStr);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  if (n === -1) return '昨天';
  return `${cnDate(dateStr)}${weekday(dateStr)}`;
}
export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${relDayWord(ymd(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function toLocalInput(ms) { const d = new Date(ms); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function humanDuration(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}小时${r}分钟` : `${h}小时`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}天${rh}小时` : `${d}天`;
}
