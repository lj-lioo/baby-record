import { addDays, atLocal, cnDate, parseYmd, ymd } from './dates.js';

export const MILK_TYPES = { breast: '母乳', formula: '配方奶', mixed: '混合', unknown: '未标注' };
export const STOOL_TYPES = { soft: '软便', loose: '稀便', formed: '成形', hard: '偏硬' };
export const CARE_LABELS = { nursing: '母乳亲喂', bottle: '瓶喂', stool: '大便', urine: '小便', dose: '用药', sleep: '睡眠' };
export const FEEDING_DAY_START = '08:00';

function dateValid(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && ymd(parseYmd(date)) === date;
}

const clockValid = (time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

const numberInRange = (value, limit) => {
  if (!/^\d+(\.\d)?$/.test(String(value))) return null;
  const n = Number(value);
  return n > 0 && n <= limit ? n : null;
};

export function validateCare(record, latest) {
  if (!Object.hasOwn(CARE_LABELS, record.kind)) return '请选择记录类型';
  const dateOnlyDose = record.kind === 'dose' && record.time === '';
  if (!dateValid(record.date) || (!dateOnlyDose && !clockValid(record.time))) return '请选择日期和时间';
  if (latest && `${record.date}T${record.time}` > latest) return '记录时间不能在未来';
  if (record.kind === 'sleep' && (record.endDate || record.endTime)) {
    if (!dateValid(record.endDate) || !clockValid(record.endTime)) return '请填写醒来的日期和时间';
    const end = record.endDate + 'T' + record.endTime;
    if (end < record.date + 'T' + record.time) return '醒来时间不能早于入睡时间';
    if (latest && end > latest) return '醒来时间不能在未来';
  }
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
  if (kind === 'sleep' && record.endDate) {
    entry.endDate = record.endDate;
    entry.endTime = record.endTime;
  }
  if (record.paper === true) entry.paper = true;
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

export function feedingCycleDate(date, time) {
  return time && time < FEEDING_DAY_START ? addDays(date, -1) : date;
}

export function careDay(record) {
  return feedingCycleDate(record.date, record.time);
}

export function careCalendarDate(cycle, time) {
  return time && time < FEEDING_DAY_START ? addDays(cycle, 1) : cycle;
}

export function careNewest(a, b) {
  return b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt - a.updatedAt;
}

export function activeSleep(records) {
  return records.filter((record) => record.kind === 'sleep' && !record.deleted && !record.endDate).sort(careNewest).at(-1);
}

function sleepBounds(record) {
  return [atLocal(record.date, record.time).getTime(), atLocal(record.endDate, record.endTime).getTime()];
}

export function formatSleepMinutes(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? hours + ' 小时' + (remainder ? ' ' + remainder + ' 分钟' : '') : remainder + ' 分钟';
}

export function sleepOnDay(record, date) {
  const start = careDay(record);
  return start === date || (start < date && !!record.endDate &&
    record.endDate + 'T' + record.endTime > date + 'T' + FEEDING_DAY_START);
}

function completedSleep(records) {
  const intervals = records.filter((record) => record.kind === 'sleep' && !record.deleted && record.endDate)
    .map(sleepBounds).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function careDetail(record) {
  if (record.kind === 'sleep') {
    if (!record.endDate) return '睡眠中';
    const [start, end] = sleepBounds(record);
    const wake = record.endDate === record.date ? record.endTime : cnDate(record.endDate) + ' ' + record.endTime;
    return '醒来 ' + wake + ' · ' + formatSleepMinutes((end - start) / 60000);
  }
  if (record.kind === 'bottle') return [`${record.ml} mL`, record.milk !== 'unknown' && MILK_TYPES[record.milk]].filter(Boolean).join(' · ');
  if (record.kind === 'nursing') {
    return [record.minutes && `${record.minutes} 分钟`, record.ml != null && `实测 ${record.ml} mL`].filter(Boolean).join(' · ');
  }
  if (record.kind === 'stool') return STOOL_TYPES[record.stool] || '';
  return record.dose || '';
}

function emptyDay(date) {
  return { date, nursing: 0, nursingMl: 0, nursingMeasured: 0, bottle: 0, bottleMl: 0, stool: 0, urine: 0, dose: 0, legacyDose: 0, sleepMinutes: 0 };
}

export function hasCareRecords(day) {
  return day.nursing + day.bottle + day.stool + day.urine + day.dose + day.legacyDose + day.sleepMinutes > 0;
}

function addToGroup(groups, key, date, amount) {
  if (amount <= 0) return;
  let group = groups.get(key);
  if (!group) {
    group = { total: 0, dates: new Set() };
    groups.set(key, group);
  }
  group.total += amount;
  group.dates.add(date);
}

export function summarizeCare(records, legacyDoses, lastDay, days) {
  const daily = Array.from({ length: days }, (_, i) => emptyDay(addDays(lastDay, i + 1 - days)));
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const totals = emptyDay(lastDay);
  const names = new Map();
  const milk = new Map();
  for (const r of records) {
    const day = byDate.get(careDay(r));
    if (!day || r.deleted || r.kind === 'sleep') continue;
    day[r.kind]++;
    totals[r.kind]++;
    if (r.kind === 'bottle') {
      const units = Math.round(r.ml * 10);
      day.bottleMl += units;
      totals.bottleMl += units;
      const type = r.milk || 'unknown';
      addToGroup(milk, type, day.date, units);
    }
    if (r.kind === 'nursing' && r.ml != null) {
      const units = Math.round(r.ml * 10);
      day.nursingMl += units;
      day.nursingMeasured++;
      totals.nursingMl += units;
      totals.nursingMeasured++;
    }
    if (r.kind === 'dose') addToGroup(names, r.name, day.date, 1);
  }
  for (const r of legacyDoses) {
    const day = byDate.get(r.date);
    if (!day) continue;
    day.legacyDose++;
    totals.legacyDose++;
  }
  const sleep = completedSleep(records);
  if (sleep.length) {
    for (const day of daily) {
      const from = atLocal(day.date, FEEDING_DAY_START).getTime();
      const to = atLocal(addDays(day.date, 1), FEEDING_DAY_START).getTime();
      day.sleepMinutes = sleep.reduce((sum, [start, end]) =>
        sum + Math.max(0, Math.min(to, end) - Math.max(from, start)), 0) / 60000;
      totals.sleepMinutes += day.sleepMinutes;
    }
  }
  for (const row of [...daily, totals]) {
    row.bottleMl /= 10;
    row.nursingMl /= 10;
  }
  const daysWithValues = {};
  for (const key of Object.keys(totals)) {
    if (key !== 'date') daysWithValues[key] = daily.filter((day) => day[key] > 0).length;
  }
  return {
    daily, totals, daysWithValues,
    recordedDays: daily.filter(hasCareRecords).length,
    milkByType: Object.keys(MILK_TYPES).filter((type) => milk.has(type)).map((type) => {
      const { total, dates } = milk.get(type);
      return [MILK_TYPES[type], total / 10, dates.size];
    }),
    dosesByName: [...names].map(([name, { total, dates }]) => [name, total, dates.size])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')),
  };
}
