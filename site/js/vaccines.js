// 国家免疫规划疫苗儿童免疫程序（2026年版，国疾控卫免发〔2026〕16号；含2025年1月1日起的百白破程序调整）
// 只含免费的国家免疫规划（一类）疫苗，6周岁及以下。纯函数，不依赖 localStorage，便于测试。
import { parseYmd, ymd } from './dates.js';

// 剂次编号与官方免疫程序表一致（脊灰 1–4、流脑 1–4：A群为第1、2剂，A群C群为第3、4剂）。
// m = 月龄（周岁 × 12）。id 为每一剂的固定编号，用于去重（事项里保存为 scheduleId = 'nip:' + id）。
// 乙脑按减毒活疫苗（2剂）、甲肝按减毒活疫苗（1剂）排；选灭活疫苗时剂次不同，以接种门诊安排为准。
export const NIP_SCHEDULE = [
  { id: 'hepb-1',  m: 0,  name: '乙肝疫苗',   dose: '第1剂' },
  { id: 'bcg-1',   m: 0,  name: '卡介苗',     dose: '' },
  { id: 'hepb-2',  m: 1,  name: '乙肝疫苗',   dose: '第2剂' },
  { id: 'polio-1', m: 2,  name: '脊灰疫苗',   dose: '第1剂', extra: '灭活疫苗IPV，注射' },
  { id: 'dtap-1',  m: 2,  name: '百白破疫苗', dose: '第1剂' },
  { id: 'polio-2', m: 3,  name: '脊灰疫苗',   dose: '第2剂', extra: '灭活疫苗IPV，注射' },
  { id: 'polio-3', m: 4,  name: '脊灰疫苗',   dose: '第3剂', extra: '减毒活疫苗bOPV，口服' },
  { id: 'dtap-2',  m: 4,  name: '百白破疫苗', dose: '第2剂' },
  { id: 'hepb-3',  m: 6,  name: '乙肝疫苗',   dose: '第3剂' },
  { id: 'dtap-3',  m: 6,  name: '百白破疫苗', dose: '第3剂' },
  { id: 'mpsva-1', m: 6,  name: 'A群流脑多糖疫苗', dose: '第1剂' },
  { id: 'mmr-1',   m: 8,  name: '麻腮风疫苗', dose: '第1剂' },
  { id: 'je-1',    m: 8,  name: '乙脑减毒活疫苗', dose: '第1剂', extra: '如选乙脑灭活疫苗共4剂' },
  { id: 'mpsva-2', m: 9,  name: 'A群流脑多糖疫苗', dose: '第2剂' },
  { id: 'dtap-4',  m: 18, name: '百白破疫苗', dose: '第4剂' },
  { id: 'mmr-2',   m: 18, name: '麻腮风疫苗', dose: '第2剂' },
  { id: 'hepa-1',  m: 18, name: '甲肝减毒活疫苗', dose: '', extra: '如选甲肝灭活疫苗共2剂（18月龄、2周岁）' },
  { id: 'je-2',    m: 24, name: '乙脑减毒活疫苗', dose: '第2剂' },
  { id: 'mpsvac-1', m: 36, name: 'A群C群流脑多糖疫苗', dose: '第3剂', extra: '流脑疫苗共4剂，A群C群的第1剂' },
  { id: 'polio-4', m: 48, name: '脊灰疫苗',   dose: '第4剂', extra: '减毒活疫苗bOPV，口服' },
  { id: 'dtap-5',  m: 72, name: '百白破疫苗', dose: '第5剂' },
  { id: 'mpsvac-2', m: 72, name: 'A群C群流脑多糖疫苗', dose: '第4剂', extra: '流脑疫苗共4剂，A群C群的第2剂' },
];

export const NIP_SOURCE = '国家免疫规划疫苗儿童免疫程序及说明（2026年版）';

// 按月加，月底对齐（1月31日 + 1个月 = 2月28/29日）
export function addMonths(dateStr, n) {
  const d = parseYmd(dateStr);
  const y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
  const last = new Date(y, m + 1, 0).getDate();
  return ymd(new Date(y, m, Math.min(day, last)));
}

export function ageLabel(m) {
  if (m === 0) return '出生时';
  if (m < 24) return `满${m}月龄`;
  return `满${m / 12}周岁`;
}

export function doseTitle(d) { return d.dose ? `${d.name} ${d.dose}` : d.name; }

export function doseNote(d) {
  const parts = ['国家免疫规划', ageLabel(d.m)];
  if (d.extra) parts.push(d.extra);
  if (d.m === 0) parts.push('出生时通常已在医院接种');
  parts.push('以社区医院/接种本实际预约为准');
  return parts.join(' · ');
}

// 生成计划：返回每一剂 { ...dose, scheduleId, title, note, date, past, existing }
// existing：已有同一 scheduleId 的事项（再次生成时跳过，避免重复）
export function planVaccines(birthday, today, events = []) {
  const byId = new Map(events.filter((e) => e.scheduleId).map((e) => [e.scheduleId, e]));
  return NIP_SCHEDULE.map((d) => {
    const scheduleId = `nip:${d.id}`;
    const date = addMonths(birthday, d.m);
    return { ...d, scheduleId, title: doseTitle(d), note: doseNote(d), age: ageLabel(d.m), date, past: date < today, existing: byId.get(scheduleId) || null };
  });
}
