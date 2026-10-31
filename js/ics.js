// 生成符合 RFC 5545 的 .ics（CRLF 换行、75 字节折行、TZID=Asia/Shanghai、UID、DTSTAMP、多个 VALARM）
import { eventStart, fireAtOf, reminderLabel } from './reminders.js';
import { addDays, pad } from './dates.js';
import { CATEGORIES } from './categories.js';

const CRLF = '\r\n';

export function escapeText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// 按 UTF-8 字节折行（每行 ≤ 75 字节），不拆开多字节字符
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', curBytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { parts.push(cur); cur = ''; curBytes = 0; limit = 74; }
    cur += ch; curBytes += b;
  }
  parts.push(cur);
  return parts.join(CRLF + ' ');
}

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const localStamp = (dateStr, timeStr) => dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';

// 把相对事项开始的毫秒差写成 ICS DURATION，例如 -PT2H、-P1D、PT8H
export function toDuration(deltaMs) {
  const neg = deltaMs < 0;
  let s = Math.round(Math.abs(deltaMs) / 1000);
  if (s === 0) return 'PT0S';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  let out = (neg ? '-' : '') + 'P';
  if (d && !h && !m && !s) return out + d + 'D';
  if (d) out += d + 'D';
  if (h || m || s) { out += 'T'; if (h) out += h + 'H'; if (m) out += m + 'M'; if (s) out += s + 'S'; }
  return out;
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Asia/Shanghai', 'X-LIC-LOCATION:Asia/Shanghai',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:CST', 'DTSTART:19700101T000000', 'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildICS(ev, now = Date.now()) {
  const cat = CATEGORIES[ev.category] || CATEGORIES.other;
  const start = eventStart(ev);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BabyRecord//宝宝记录 1.0//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${ev.id}@baby-record`,
    `DTSTAMP:${utcStamp(now)}`,
  ];
  if (ev.time) {
    const [hh, mm] = ev.time.split(':').map(Number);
    const endMin = hh * 60 + mm + 60;
    const endDate = endMin >= 1440 ? addDays(ev.date, 1) : ev.date;
    const endTime = `${pad(Math.floor((endMin % 1440) / 60))}:${pad(endMin % 60)}`;
    lines.push(`DTSTART;TZID=Asia/Shanghai:${localStamp(ev.date, ev.time)}`);
    lines.push(`DTEND;TZID=Asia/Shanghai:${localStamp(endDate, endTime)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(ev.date, 1).replace(/-/g, '')}`);
  }
  const summary = `${cat.icon} ${ev.title}`;
  lines.push(`SUMMARY:${escapeText(summary)}`);
  lines.push(`CATEGORIES:${escapeText(cat.label)}`);
  const desc = [`宝宝记录 · ${cat.label}`, ev.note ? `备注：${ev.note}` : ''].filter(Boolean).join('\n');
  lines.push(`DESCRIPTION:${escapeText(desc)}`);
  lines.push('TRANSP:OPAQUE');
  // 按用户在 App 里设置的提醒时间生成多个 VALARM；若未设置，则使用默认的三档提醒
  let rems = (ev.reminders || []).map((r) => ({ at: fireAtOf(ev, r), label: reminderLabel(r) })).filter((x) => x.at != null);
  if (!rems.length) {
    rems = [{ at: start - 864e5 + (ev.time ? 0 : 20 * 3600e3), label: '提前1天' }, { at: start + (ev.time ? 0 : 8 * 3600e3), label: '当天' }];
  }
  const seen = new Set();
  for (const r of rems) {
    const trig = toDuration(r.at - start);
    if (seen.has(trig)) continue;
    seen.add(trig);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(`宝宝提醒：${ev.title}（${r.label}）`)}`, `TRIGGER:${trig}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// base64url(UTF-8)
export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 在 iOS Safari 中打开 .ics：优先使用“真实 URL”（由 Service Worker 以 text/calendar 返回），
// 否则退回 Blob（type 必须是 text/calendar，不带 charset，iOS 才会识别）
export function openICS(ev) {
  const ics = buildICS(ev);
  const name = `baby-${ev.date}.ics`;
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    location.href = `./ics/${name}?d=${b64urlEncode(ics)}`;
    return 'sw';
  }
  downloadICSBlob(ev, ics);
  return 'blob';
}
export function downloadICSBlob(ev, ics = buildICS(ev)) {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `baby-${ev.date}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
