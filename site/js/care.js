import { addDays, parseYmd, ymd } from './dates.js';

export const MILK_TYPES = { breast: '母乳', formula: '配方奶', mixed: '混合', unknown: '未标注' };
export const STOOL_TYPES = { soft: '软便', loose: '稀便', formed: '成形', hard: '偏硬' };
export const CARE_LABELS = { nursing: '母乳亲喂', bottle: '瓶喂', stool: '大便', urine: '小便', dose: '用药' };

function dateValid(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && ymd(parseYmd(date)) === date;
}

const numberInRange = (value, limit) => {
  if (!/^\d+(\.\d)?$/.test(String(value))) return null;
  const n = Number(value);
  return n > 0 && n <= limit ? n : null;
};

export function validateCare(record, latest) {
  if (!Object.hasOwn(CARE_LABELS, record.kind)) return '请选择记录类型';
  const dateOnlyDose = record.kind === 'dose' && record.time === '';
  if (!dateValid(record.date) || (!dateOnlyDose && !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time))) return '请选择日期和时间';
  if (latest && `${record.date}T${record.time}` > latest) return '记录时间不能在未来';
  const hasMl = record.ml != null && record.ml !== '';
  if ((record.kind === 'bottle' || record.kind === 'nursing' && hasMl) && numberInRange(record.ml, 2000) == null) {
    return '请填写有效的奶量（mL，最多一位小数）';
  }
  if (record.kind === 'nursing' && record.minutes != null && record.minutes !== '' &&
    (!Number.isInteger(numberInRange(record.minutes, 1440)) || Number(record.minutes) <= 0)) return '请填写有效的亲喂时长（整数分钟）';
  if (record.kind === 'dose' && !String(record.name || '').trim()) return '请填写药品或补充剂名称';
  return '';
}

export function normalizeCare(record) {
  if (!record || !/^[a-z0-9_-]{1,60}$/i.test(record.id || '') ||
    !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 1) return null;
  const { id, updatedAt } = record;
  if (record.deleted === true) return { id, updatedAt, deleted: true };
  if (validateCare(record)) return null;
  const { kind, date, time } = record;
  const entry = { id, kind, date, time, updatedAt, note: String(record.note || '').trim().slice(0, 160) };
  if (kind === 'nursing') {
    entry.ml = numberInRange(record.ml, 2000);
    entry.minutes = numberInRange(record.minutes, 1440);
  }
  if (kind === 'bottle') {
    entry.ml = numberInRange(record.ml, 2000);
    entry.milk = Object.hasOwn(MILK_TYPES, record.milk) ? record.milk : 'unknown';
  }
  if (kind === 'stool') entry.stool = Object.hasOwn(STOOL_TYPES, record.stool) ? record.stool : '';
  if (kind === 'dose') {
    entry.name = String(record.name).trim().slice(0, 60);
    entry.dose = String(record.dose || '').trim().slice(0, 80);
  }
  return entry;
}

export function careNewest(a, b) {
  return b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt - a.updatedAt;
}

export function careDetail(record) {
  if (record.kind === 'bottle') return [`${record.ml} mL`, record.milk !== 'unknown' && MILK_TYPES[record.milk]].filter(Boolean).join(' · ');
  if (record.kind === 'nursing') {
    return [record.minutes && `${record.minutes} 分钟`, record.ml != null && `实测 ${record.ml} mL`].filter(Boolean).join(' · ');
  }
  if (record.kind === 'stool') return STOOL_TYPES[record.stool] || '';
  return record.dose || '';
}

function emptyDay(date) {
  return { date, nursing: 0, nursingMl: 0, nursingMeasured: 0, bottle: 0, bottleMl: 0, stool: 0, urine: 0, dose: 0, legacyDose: 0 };
}

export function summarizeCare(records, legacyDoses, lastDay, days) {
  const daily = Array.from({ length: days }, (_, i) => emptyDay(addDays(lastDay, i + 1 - days)));
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const totals = emptyDay(lastDay);
  const names = new Map();
  const milk = new Map();
  for (const r of records) {
    const day = byDate.get(r.date);
    if (!day || r.deleted) continue;
    day[r.kind]++;
    totals[r.kind]++;
    if (r.kind === 'bottle') {
      const units = Math.round(r.ml * 10);
      day.bottleMl += units;
      totals.bottleMl += units;
      const type = r.milk || 'unknown';
      milk.set(type, (milk.get(type) || 0) + units);
    }
    if (r.kind === 'nursing' && r.ml != null) {
      const units = Math.round(r.ml * 10);
      day.nursingMl += units;
      day.nursingMeasured++;
      totals.nursingMl += units;
      totals.nursingMeasured++;
    }
    if (r.kind === 'dose') names.set(r.name, (names.get(r.name) || 0) + 1);
  }
  for (const r of legacyDoses) {
    const day = byDate.get(r.date);
    if (!day) continue;
    day.legacyDose++;
    totals.legacyDose++;
  }
  for (const row of [...daily, totals]) {
    row.bottleMl /= 10;
    row.nursingMl /= 10;
  }
  return {
    daily, totals,
    recordedDays: daily.filter((d) => d.nursing + d.bottle + d.stool + d.urine + d.dose + d.legacyDose > 0).length,
    milkByType: Object.keys(MILK_TYPES).filter((type) => milk.has(type)).map((type) => [MILK_TYPES[type], milk.get(type) / 10]),
    dosesByName: [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')),
  };
}
