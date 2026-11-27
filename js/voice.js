// v1.11.0 一句话记事：本地规则解析中文（不调用任何外部 API）
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (!s.includes('十')) return Number([...s].map((c) => CN[c]).join(''));
  const [a, b] = s.split('十');
  return (a ? CN[a] : 1) * 10 + (b ? CN[b] : 0);
}
const p2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const mk = (y, m, d) => new Date(y, m - 1, d);
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return mk(y, m, d); };
const plus = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymdOf(d); };
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };

function normalize(t) {
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').replace(/．/g, '.');
  // 中文数字（后面跟 月/号/日/点/天/时/分/个 时）→ 阿拉伯数字
  return t.replace(/[零〇一二两三四五六七八九十]+(?=[月号日点天时分个])/g, (m) => String(cnToNum(m)));
}

export function splitSentences(text) {
  return String(text || '').split(/[。！？!?\n；;]+/).map((s) => s.trim()).filter(Boolean);
}

export function parseOne(text, today) {
  let t = normalize(String(text || '').trim());
  const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7)), td = Number(today.slice(8, 10));
  let date = null, time = '', m;
  const cut = (re) => { const r = t.match(re); if (r) t = t.replace(re, ' '); return r; };

  // —— 日期 ——
  if ((m = cut(/(\d{4})年(\d{1,2})月(\d{1,2})[号日]?/)) && valid(+m[1], +m[2], +m[3])) date = ymdOf(mk(+m[1], +m[2], +m[3]));
  if (!date && (m = cut(/(\d{1,2})月(底|末)/))) {
    let y = ty; date = ymdOf(mk(y, +m[1] + 1, 0)); if (date < today) date = ymdOf(mk(y + 1, +m[1] + 1, 0));
  }
  if (!date && (m = cut(/(\d{1,2})月(\d{1,2})[号日]?/)) && valid(ty, +m[1], +m[2])) {
    date = ymdOf(mk(ty, +m[1], +m[2])); if (date < today) date = ymdOf(mk(ty + 1, +m[1], +m[2]));
  }
  if (!date && (m = cut(/(?<![\d:])(\d{1,2})[./](\d{1,2})(?![\d点时:])/)) && valid(ty, +m[1], +m[2])) {
    date = ymdOf(mk(ty, +m[1], +m[2])); if (date < today) date = ymdOf(mk(ty + 1, +m[1], +m[2]));
  }
  if (!date && cut(/(这个?|本)?月(底|末)/)) date = ymdOf(mk(ty, tm + 1, 0));
  if (!date && (m = cut(/大后天/))) date = plus(today, 3);
  if (!date && cut(/后天/)) date = plus(today, 2);
  if (!date && cut(/明天|明日|明早|明晚/)) { date = plus(today, 1); if (/明晚/.test(text)) t = '晚上 ' + t; }
  if (!date && cut(/今天|今日|今早/)) date = today;
  if (!date && /今晚/.test(t)) { t = t.replace(/今晚/, ' 晚上 '); date = today; }
  if (!date && (m = cut(/(\d{1,3})天(后|以后|之后)/))) date = plus(today, +m[1]);
  if (!date && (m = cut(/(下下|下个?|这个?|本)?(周|星期|礼拜)([一二三四五六日天1-7])/))) {
    const w = WD[m[3]], cur = parse(today).getDay() || 7;
    const monday = plus(today, 1 - cur);
    if (!m[1]) { let n = w - cur; if (n < 0) n += 7; date = plus(today, n); }
    else date = plus(monday, w - 1 + (m[1] === '下下' ? 14 : m[1].startsWith('下') ? 7 : 0));
  }
  if (!date && (m = cut(/(?<!\d)(\d{1,2})[号日](?!\d)/))) {
    let y = ty, mo = tm; if (+m[1] < td) { mo++; if (mo > 12) { mo = 1; y++; } }
    if (valid(y, mo, +m[1])) date = ymdOf(mk(y, mo, +m[1]));
  }

  // —— 时间 ——
  const PER = '(早上|早晨|上午|中午|下午|傍晚|晚上|夜里|凌晨)?';
  m = cut(new RegExp(PER + '\\s*(\\d{1,2}):(\\d{2})')) || cut(new RegExp(PER + '\\s*(\\d{1,2})[点时](半|一刻|三刻|(\\d{1,2})分?)?'));
  if (m) {
    let h = +m[2], mi = 0;
    if (m[3] === '半') mi = 30; else if (m[3] === '一刻') mi = 15; else if (m[3] === '三刻') mi = 45;
    else if (m[4] !== undefined && m[4] !== null) mi = +m[4]; else if (/^\d{2}$/.test(m[3] || '')) mi = +m[3];
    const per = m[1] || '';
    if (/下午|傍晚|晚上|夜里/.test(per) && h < 12) h += 12;
    if (per === '中午' && h < 11) h += 12;
    if (h <= 23 && mi <= 59) time = `${p2(h)}:${p2(mi)}`;
  } else {
    const per = cut(/早上|早晨|上午|中午|下午|傍晚|晚上/);
    if (per && date == null) { /* 只有时段无日期：保留默认今天 */ }
  }

  // —— 标题 ——
  let title = t.replace(/(帮我|给我)?(记一下|记下|记个|记录一下|记得|别忘了|提醒我|提醒一下|提醒)/g, ' ')
    .replace(/(我们|我)?(需要|要|得|准备)/g, ' ')
    .replace(/[，,、\s]+/g, ' ').trim()
    .replace(/^(在|于|到|的|是)\s*/, '').replace(/\s*(的|了|吧|啊|哦|呢)$/, '')
    .replace(/\s+/g, '').trim();
  if (!title) title = '未命名事项';
  const category = /疫苗|打针|接种|针/.test(title) ? 'vaccine' : /体检|儿保|检查|复查/.test(title) ? 'checkup' : 'other';
  return { title, date: date || today, time, category };
}

export function parseVoice(text, today) {
  return splitSentences(text).map((s) => parseOne(s, today));
}
