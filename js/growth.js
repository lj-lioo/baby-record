// v1.9.0 生长记录：日龄文案、校验、相对上次提示、SVG 曲线（无外部依赖）
import { daysBetween, todayStr } from './dates.js';
import { addMonths } from './vaccines.js';
import { store } from './store.js';

export const HEIGHT_MIN = 30, HEIGHT_MAX = 150;
export const WEIGHT_MIN = 1, WEIGHT_MAX = 50;
export const HEAD_MIN = 25, HEAD_MAX = 60;

/** 测量日相对生日的日龄文案（出生当天＝第1天；满月后为「X个月Y天」） */
export function ageOnDate(birthday, dateStr) {
  if (!birthday || !dateStr || dateStr < birthday) return '';
  const days = daysBetween(birthday, dateStr);
  if (days === 0) return '第1天';
  let m = 0;
  while (addMonths(birthday, m + 1) <= dateStr) m++;
  if (m === 0) return `第${days + 1}天`;
  const rem = daysBetween(addMonths(birthday, m), dateStr);
  if (m < 12) return rem ? `${m}个月${rem}天` : `${m}个月`;
  const y = Math.floor(m / 12);
  const mo = m % 12;
  const head = mo ? `${y}岁${mo}个月` : `${y}岁`;
  return rem ? `${head}${rem}天` : head;
}

function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''; }
function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** @returns {string|null} 错误文案；通过返回 null */
export function validateGrowth({ date, height, weight, head }, birthday) {
  if (!validYmd(date)) return '请选择日期';
  if (birthday && date < birthday) return '日期不能早于宝宝生日';
  if (date > todayStr()) return '日期不能是未来';
  const h = numOrNull(height), w = numOrNull(weight), hd = numOrNull(head);
  if (h == null && w == null) return '身高、体重至少填一项';
  if (h != null && (h < HEIGHT_MIN || h > HEIGHT_MAX)) return `身高请在 ${HEIGHT_MIN}–${HEIGHT_MAX} cm`;
  if (w != null && w < WEIGHT_MIN || w != null && w > WEIGHT_MAX) return `体重请在 ${WEIGHT_MIN}–${WEIGHT_MAX} kg`;
  if (hd != null && (hd < HEAD_MIN || hd > HEAD_MAX)) return `头围请在 ${HEAD_MIN}–${HEAD_MAX} cm（可不填）`;
  return null;
}

export function growthSorted() {
  return [...store.growth()].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
}

/** 相对上一次（更早那条）的增减文案；非医疗建议 */
export function deltaTip(rec, allSortedDesc) {
  // 取日期严格更早，或同日但不是自己的上一条
  const prev = allSortedDesc.find((x) => x.id !== rec.id && (x.date < rec.date || (x.date === rec.date && x.updatedAt < rec.updatedAt)));
  if (!prev) return '已记录 · 非医疗建议';
  const parts = [];
  if (rec.height != null && prev.height != null) {
    const d = Math.round((rec.height - prev.height) * 100) / 100;
    parts.push(`身高 ${d >= 0 ? '+' : ''}${d} cm`);
  }
  if (rec.weight != null && prev.weight != null) {
    const d = Math.round((rec.weight - prev.weight) * 100) / 100;
    parts.push(`体重 ${d >= 0 ? '+' : ''}${d} kg`);
  }
  if (rec.head != null && prev.head != null) {
    const d = Math.round((rec.head - prev.head) * 100) / 100;
    parts.push(`头围 ${d >= 0 ? '+' : ''}${d} cm`);
  }
  if (!parts.length) return '已记录 · 非医疗建议';
  return `相对上次：${parts.join('，')} · 非医疗建议`;
}

/**
 * 画折线 SVG。metric: 'height'|'weight'|'head'
 * points: [{date, value}] 按日期升序
 */
export function chartSvg(points, { unit = '', color = '#20A98B', w = 340, h = 220 } = {}) {
  const padL = 40, padR = 14, padT = 16, padB = 36;
  const iw = w - padL - padR, ih = h - padT - padB;
  if (!points.length) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="暂无数据">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#8E8190" font-size="14">暂无数据，点右上角添加</text>
    </svg>`;
  }
  const vals = points.map((p) => p.value);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const span = vmax - vmin;
  vmin -= span * 0.08; vmax += span * 0.08;
  const xAt = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const yAt = (v) => padT + ih - ((v - vmin) / (vmax - vmin)) * ih;
  const poly = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');
  const showLbl = (i) => points.length <= 12 || i === 0 || i === points.length - 1; // v1.12.0 点多时只标首尾
  const dots = points.map((p, i) => {
    const cx = xAt(i), cy = yAt(p.value);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${points.length > 12 ? 3 : 4.5}" fill="${color}" stroke="#fff" stroke-width="2"/>
      ${showLbl(i) ? '' : '<!--'}<text x="${cx.toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${color}">${fmtVal(p.value)}${unit ? '' : ''}</text>${showLbl(i) ? '' : '-->'}`;
  }).join('');
  // y 轴刻度 4 档
  const ticks = [0, 1, 2, 3].map((i) => {
    const v = vmax - (i / 3) * (vmax - vmin);
    const y = yAt(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#F1E4DA" stroke-width="1"/>
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#8E8190">${fmtVal(v)}</text>`;
  }).join('');
  // x 轴标签：首尾 + 中间（最多 4 个）
  const labelIdx = labelIndexes(points.length);
  const xlabels = labelIdx.map((i) => {
    const p = points[i];
    const short = p.date.slice(5); // MM-DD
    return `<text x="${xAt(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="11" fill="#8E8190">${short}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="生长曲线">
    <rect x="0" y="0" width="${w}" height="${h}" fill="#fff" rx="12"/>
    ${ticks}
    <polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${poly}"/>
    ${dots}
    ${xlabels}
    ${unit ? `<text x="${padL}" y="12" font-size="11" fill="#8E8190">${unit}</text>` : ''}
  </svg>`;
}

function fmtVal(n) {
  const x = Math.round(n * 100) / 100;
  return Number.isInteger(x) ? String(x) : String(x);
}
function labelIndexes(n) {
  if (n <= 1) return [0];
  if (n === 2) return [0, 1];
  if (n === 3) return [0, 1, 2];
  return [0, Math.floor((n - 1) / 3), Math.floor(2 * (n - 1) / 3), n - 1];
}

export function seriesFor(metric) {
  const key = metric === 'height' ? 'height' : metric === 'weight' ? 'weight' : 'head';
  return growthSorted()
    .filter((g) => g[key] != null)
    .slice()
    .reverse() // 升序画线
    .map((g) => ({ date: g.date, value: g[key], id: g.id }));
}

// v1.12.0 用药记录：在用（无结束日或结束日≥今天）排上面，按开始日倒序
export function medActive(m, today = todayStr()) { return !m.end || m.end >= today; }
// v1.12.3 频次：每日 0 → 未知 1 → 每周 2 → 每月 3；在用列表按频次排，同频次按开始日先后
export function medFreqRank(m) {
  const f = String(m.freq || '');
  const t = f || `${m.dose || ''} ${m.name || ''}`;
  if (/月/.test(f) || (!f && /(一|每|1)\s*个?月|月\s*[一1]\s*次|每月/.test(t))) return 3;
  if (/周/.test(f) || (!f && /(一|每|1)\s*(周|星期|礼拜)|周\s*[一1]\s*次|每周/.test(t))) return 2;
  if (/[日天]/.test(f) || (!f && /(一|每|1)\s*[天日]|每[天日]|[天日]\s*[一二两三1-9]/.test(t))) return 0;
  return 1;
}
export function medsSorted(list = store.meds(), today = todayStr()) {
  const by = (a, b) => b.start.localeCompare(a.start) || b.updatedAt - a.updatedAt;
  const byFreq = (a, b) => medFreqRank(a) - medFreqRank(b) || a.start.localeCompare(b.start) || b.updatedAt - a.updatedAt;
  const all = [...list];
  return { active: all.filter((m) => medActive(m, today)).sort(byFreq), past: all.filter((m) => !medActive(m, today)).sort(by) };
}
// v1.12.3 药丸进度：药品 series 关联日历里 scheduleId 为「series:序号」的事项；总数＝事项数，已用＝已完成数
export function medDoses(m, events = store.events()) {
  if (!m || !m.series) return null;
  const pre = m.series + ':';
  const list = events.filter((e) => String(e.scheduleId || '').startsWith(pre))
    .sort((a, b) => (Number(a.scheduleId.slice(pre.length)) || 0) - (Number(b.scheduleId.slice(pre.length)) || 0) || a.date.localeCompare(b.date));
  if (!list.length) return null;
  return { total: list.length, done: list.filter((e) => e.done).length, list };
}
export function medPeriod(m, today = todayStr()) {
  const md = (d) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
  if (!m.start) return '';
  if (m.end && m.end === m.start) return `${md(m.start)} · 单次`;
  const days = daysBetween(m.start, m.end && m.end < today ? m.end : today) + 1;
  if (!m.end) return `${md(m.start)} 起 · 至今（第${days}天）`;
  return `${md(m.start)} – ${md(m.end)}${m.end >= today ? `（第${days}天）` : ` · 共${days}天`}`;
}
