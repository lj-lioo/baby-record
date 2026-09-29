// 自费（非免疫规划）疫苗 + RSV 单抗 计划。纯函数、不依赖任何其他模块（命令行 add-item.js 通过 data: URL 直接加载）。
// 依据（程序以各疫苗说明书为准）：
//   · 《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》：含免疫规划疫苗成分的非免疫规划疫苗按说明书接种，可视为完成相应剂次；
//     各疫苗可同时在不同部位接种；两种注射类减毒活疫苗未同时接种时间隔≥28天。
//   · 《非免疫规划疫苗使用指导原则（2020年版）》（中国疾控中心）；《中国流感疫苗预防接种技术指南》；
//   · RSV：《中国热带亚热带地区婴幼儿RSV单抗免疫预防专家共识》及尼塞韦单抗（乐唯初/Beyfortus）说明书。
// 事项 scheduleId = 'paid:' + id；optional: true 表示「备选方案」，默认不勾选、不写入云端。

export const PAID_SOURCE = '非免疫规划疫苗使用指导原则（2020年版）、各疫苗说明书；RSV单抗：尼塞韦单抗说明书及专家共识';
export const PAID_PREFIX = 'paid:';
export const PAID_CATEGORY = 'paidvax';
export const PAID_DISCLAIMER = '是否接种、品牌和时间以接种门诊建议为准';

const pad = (n) => String(n).padStart(2, '0');
function parts(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
function fmt(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
// 按月加，月底对齐（1月31日 + 1个月 = 2月28/29日）
export function addMonthsP(s, n) {
  const { y, m, d } = parts(s);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return fmt(new Date(y, m - 1 + n, Math.min(d, last)));
}
export function addDaysP(s, n) { const { y, m, d } = parts(s); return fmt(new Date(y, m - 1, d + n)); }

// 流感：首次接种需2剂（间隔≥4周）。满6月龄若落在3～8月（流行季末/疫苗通常不供应），第1剂排在当年9月20日前后（新疫苗上市）。
export function fluStart(birthday) {
  const six = addMonthsP(birthday, 6);
  const mon = parts(six).m;
  return mon >= 3 && mon <= 8 ? `${six.slice(0, 4)}-09-20` : six;
}

const T = (name, dose) => `(可选·自费) ${name}${dose ? ' ' + dose : ''}`;
const PENTA_ALT = '选五联则可替代免费的百白破第1～4剂和脊灰第1～4剂（6岁百白破第5剂仍需打）';

// m = 月龄；d = 在该月龄基础上再加天数；at(birthday) = 自定义日期
export const PAID_SCHEDULE = [
  { id: 'rsv', m: 1, family: 'rsv', required: true, title: 'RSV单抗（尼塞韦单抗）', age: '满1月龄（与乙肝第2剂同一天）',
    note: '与乙肝疫苗第2剂同一天安排；预防呼吸道合胞病毒（RSV）引起的下呼吸道感染（毛细支气管炎、肺炎）；单剂肌内注射，体重<5kg 用50mg、≥5kg 用100mg（按接种当天体重）；是单克隆抗体，可与乙肝等疫苗同一天在不同部位接种，互不影响；适用于出生后第一个RSV流行季（约11月～次年4月）的婴儿；国内品牌名「乐唯初」（Beyfortus）' },

  { id: 'pcv13-1', m: 2,  family: 'pcv13', title: T('13价肺炎', '第1剂'), age: '满2月龄' },
  { id: 'pcv13-2', m: 4,  family: 'pcv13', title: T('13价肺炎', '第2剂'), age: '满4月龄' },
  { id: 'pcv13-3', m: 6,  family: 'pcv13', title: T('13价肺炎', '第3剂'), age: '满6月龄' },
  { id: 'pcv13-4', m: 12, family: 'pcv13', title: T('13价肺炎', '第4剂（加强）'), age: '12～15月龄' },

  { id: 'penta-1', m: 2,  family: 'penta', title: T('五联疫苗', '第1剂'), age: '满2月龄' },
  { id: 'penta-2', m: 3,  family: 'penta', title: T('五联疫苗', '第2剂'), age: '满3月龄' },
  { id: 'penta-3', m: 4,  family: 'penta', title: T('五联疫苗', '第3剂'), age: '满4月龄' },
  { id: 'penta-4', m: 18, family: 'penta', title: T('五联疫苗', '第4剂（加强）'), age: '满18月龄' },

  { id: 'rota5-1', m: 2, family: 'rota5', title: T('五价轮状', '第1剂（口服）'), age: '6～12周龄' },
  { id: 'rota5-2', m: 3, family: 'rota5', title: T('五价轮状', '第2剂（口服）'), age: '与上剂间隔4～10周' },
  { id: 'rota5-3', m: 4, family: 'rota5', title: T('五价轮状', '第3剂（口服）'), age: '不晚于32周龄' },

  { id: 'ev71-1', m: 7, family: 'ev71', title: T('EV71手足口', '第1剂'), age: '6月龄起' },
  { id: 'ev71-2', m: 8, family: 'ev71', title: T('EV71手足口', '第2剂'), age: '间隔1个月，最好1岁前完成' },

  { id: 'flu-1', at: (b) => fluStart(b), family: 'flu', title: T('流感疫苗', '第1剂'), age: '满6月龄后的流感季（9～10月）' },
  { id: 'flu-2', at: (b) => addDaysP(fluStart(b), 28), family: 'flu', title: T('流感疫苗', '第2剂'), age: '与第1剂间隔≥4周' },

  { id: 'var-1', m: 12, family: 'var', title: T('水痘疫苗', '第1剂'), age: '满12月龄' },
  { id: 'var-2', m: 48, family: 'var', title: T('水痘疫苗', '第2剂'), age: '满4周岁' },

  // —— 备选方案（默认不勾选，按需选择）——
  { id: 'hib-1', m: 2,  family: 'hib', optional: true, title: T('Hib疫苗', '第1剂'), age: '满2月龄' },
  { id: 'hib-2', m: 3,  family: 'hib', optional: true, title: T('Hib疫苗', '第2剂'), age: '满3月龄' },
  { id: 'hib-3', m: 4,  family: 'hib', optional: true, title: T('Hib疫苗', '第3剂'), age: '满4月龄' },
  { id: 'hib-4', m: 18, family: 'hib', optional: true, title: T('Hib疫苗', '第4剂（加强）'), age: '满18月龄' },
  { id: 'mcv-1', m: 3, family: 'mcv', optional: true, title: T('流脑结合疫苗（AC结合/MCV4）', '第1剂'), age: '3月龄起' },
  { id: 'hepai-1', m: 18, family: 'hepai', optional: true, title: T('甲肝灭活疫苗', '第1剂'), age: '满18月龄' },
  { id: 'hepai-2', m: 24, family: 'hepai', optional: true, title: T('甲肝灭活疫苗', '第2剂'), age: '满2周岁' },
  { id: 'jei-1', m: 8,  family: 'jei', optional: true, title: T('乙脑灭活疫苗', '第1剂'), age: '满8月龄' },
  { id: 'jei-2', m: 8, d: 7, family: 'jei', optional: true, title: T('乙脑灭活疫苗', '第2剂'), age: '与第1剂间隔7～10天' },
  { id: 'jei-3', m: 24, family: 'jei', optional: true, title: T('乙脑灭活疫苗', '第3剂'), age: '满2周岁' },
  { id: 'jei-4', m: 72, family: 'jei', optional: true, title: T('乙脑灭活疫苗', '第4剂'), age: '满6周岁' },
];

// 每个疫苗家族的说明（写入事项备注）
export const PAID_FAMILIES = {
  rsv:   { name: 'RSV单抗', hint: '已安排，与乙肝第2剂同一天' },
  pcv13: { name: '13价肺炎球菌结合疫苗', note: '预防肺炎球菌引起的肺炎、脑膜炎、败血症、中耳炎等；6周龄～6月龄起种按「3+1」共4剂（2、4、6月龄基础，12～15月龄加强）；晚开始则剂次减少（7～11月龄起3剂、12～23月龄2剂、2～5岁1剂）；进口或国产13价选一种按同一程序完成即可' },
  penta: { name: '五联疫苗（DTaP-IPV/Hib）', note: `一针预防白喉、破伤风、百日咳、脊髓灰质炎和b型流感嗜血杆菌（Hib）感染；共4剂（2、3、4月龄基础，18月龄加强，也可3、4、5月龄起）；${PENTA_ALT}；选五联就不必再打Hib疫苗` },
  rota5: { name: '五价轮状病毒疫苗', note: '口服，预防轮状病毒肠炎（秋冬季婴幼儿腹泻主因）；共3剂，第1剂6～12周龄，每剂间隔4～10周，第3剂不晚于32周龄；备选：国产三价轮状（3剂）或兰州单价羊轮状（2月龄～3岁每年1剂），选一种即可' },
  ev71:  { name: 'EV71疫苗（肠道病毒71型灭活疫苗）', note: '预防EV71引起的重症手足口病（不预防其他型别）；6月龄～5岁，共2剂间隔1个月，鼓励1岁前完成' },
  flu:   { name: '流感疫苗', note: '预防流感；6月龄～8岁首次接种需2剂、间隔≥4周，以后每年秋季（9～10月）接种1剂；如当地流行季仍有疫苗，满6月龄后可提前接种' },
  var:   { name: '水痘减毒活疫苗', note: '预防水痘；共2剂（1岁起第1剂、4岁第2剂）；部分省份已纳入免费接种，当地免费就不用自费；与麻腮风等注射类活疫苗不同天接种时须间隔≥28天' },
  hib:   { name: 'b型流感嗜血杆菌（Hib）结合疫苗', hint: '仅在不打五联时需要', note: '预防Hib引起的脑膜炎、肺炎等；2～5月龄起共4剂（3剂基础+18月龄加强，剂次随起种月龄减少）；已选五联（或含Hib的其他联合疫苗）就不要再打' },
  mcv:   { name: '流脑结合疫苗', hint: '替代免费A群流脑多糖，按需选择', note: '预防流行性脑脊髓膜炎；AC结合疫苗、ACYW135（MCV4）等产品剂次和间隔不同（3月龄起通常3剂基础，6月龄后起种剂次减少），后续剂次以说明书/门诊为准；按说明书完成可替代免费A群流脑多糖第1、2剂；AC-Hib三联含Hib，已选五联时不要选' },
  hepai: { name: '甲肝灭活疫苗', hint: '替代免费甲肝减毒活疫苗，部分地区免费', note: '预防甲型肝炎；共2剂（18月龄、2周岁，间隔≥6个月）；接种2剂可视为完成甲肝免疫程序，不用再打免费的甲肝减毒活疫苗；国家免疫规划表也列有甲肝灭活疫苗，当地免费提供时无需自费' },
  jei:   { name: '乙脑灭活疫苗', hint: '替代免费乙脑减毒活疫苗，部分地区免费', note: '预防流行性乙型脑炎；共4剂（8月龄2剂间隔7～10天，2周岁、6周岁各1剂）；选灭活就不打免费的乙脑减毒活疫苗（共2剂）；国家免疫规划表也列有乙脑灭活疫苗，当地免费提供时无需自费' },
};

export function paidDate(birthday, p) {
  if (p.at) return p.at(birthday);
  const base = addMonthsP(birthday, p.m);
  return p.d ? addDaysP(base, p.d) : base;
}

export function paidNote(p) {
  if (p.note) return `${p.note} · ${PAID_DISCLAIMER}`;
  const f = PAID_FAMILIES[p.family];
  return [p.optional ? '备选方案' : '可选·自费', p.age, f.note, PAID_DISCLAIMER].filter(Boolean).join(' · ');
}

// 返回每一项 { ...item, scheduleId, date, note, age, past, existing, optional, hint }
export function planPaid(birthday, today, events = []) {
  const byId = new Map(events.filter((e) => e && e.scheduleId).map((e) => [e.scheduleId, e]));
  return PAID_SCHEDULE.map((p) => {
    const scheduleId = PAID_PREFIX + p.id;
    const date = paidDate(birthday, p);
    const f = PAID_FAMILIES[p.family] || {};
    const { at, ...rest } = p;
    return { ...rest, scheduleId, date, note: paidNote(p), familyName: f.name || '', hint: p.optional ? (f.hint || '备选方案，默认不添加') : '',
      optional: !!p.optional, past: date < today, existing: byId.get(scheduleId) || null };
  });
}
