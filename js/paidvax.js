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

// 接种窗口（最早 / 最迟），依据各产品说明书；「参考」表示说明书没有给出确切日期、按流行季或通用做法估算。
// 最早：首剂用说明书的最小年龄；后续剂次用程序推荐月龄（实际还要与上一剂间隔足够）。未列出的只有最早日期。
const beforeM = (b, m) => addDaysP(addMonthsP(b, m), -1);   // 满 m 月龄的前一天（「小于 m 月龄」）
export function rsvSeasonEnd(b) { const { y, m } = parts(b); return `${m >= 4 ? y + 1 : y}-03-31`; }
const WIN = {
  rsv: (b) => ({ earliest: b, latest: rsvSeasonEnd(b), windowNote: '说明书：出生后即可注射，用于即将进入或出生在第一个RSV流行季的婴儿；最迟为参考：首个流行季结束前（北方多为11月～次年3月，南方流行期更长）' }),
  'pcv13-1': (b) => ({ earliest: addDaysP(b, 42), latest: beforeM(b, 7), windowNote: '说明书：首剂最早6周龄，6月龄内起种按3+1程序；7月龄后起种剂次减少' }),
  'pcv13-3': (b) => ({ latest: beforeM(b, 12), windowNote: '参考：基础3剂在12月龄前完成；各剂间隔≥28天' }),
  'pcv13-4': (b) => ({ latest: beforeM(b, 16), windowNote: '说明书：加强剂12～15月龄，与第3剂间隔≥8周' }),
  'rota5-1': (b) => ({ earliest: addDaysP(b, 42), latest: addDaysP(b, 84), windowNote: '说明书：第1剂6～12周龄' }),
  'rota5-2': (b) => ({ latest: addDaysP(b, 154), windowNote: '参考：与第1剂间隔4～10周（约22周龄前）' }),
  'rota5-3': (b) => ({ latest: addDaysP(b, 224), windowNote: '说明书：第3剂不晚于32周龄；超龄的剂次不再补种' }),
  'ev71-1': (b) => ({ earliest: addMonthsP(b, 6), latest: beforeM(b, 72), windowNote: '说明书：6～71月龄（部分产品到35月龄），鼓励12月龄前完成2剂' }),
  'ev71-2': (b) => ({ latest: beforeM(b, 72), windowNote: '说明书：与第1剂间隔1个月，6～71月龄内完成' }),
  'flu-1': (b) => ({ earliest: addMonthsP(b, 6), windowNote: '说明书：6月龄起；每年流感季（9～10月起）接种，未规定最迟' }),
  'hepai-1': (b) => ({ latest: beforeM(b, 24), windowNote: '国家免疫规划：甲肝灭活疫苗第1剂小于24月龄完成' }),
  'hepai-2': (b) => ({ latest: beforeM(b, 36), windowNote: '国家免疫规划：甲肝灭活疫苗第2剂小于3周岁完成' }),
  'jei-2': (b) => ({ latest: beforeM(b, 12), windowNote: '国家免疫规划：乙脑灭活疫苗第2剂小于12月龄完成' }),
  'jei-3': (b) => ({ latest: beforeM(b, 36), windowNote: '国家免疫规划：乙脑灭活疫苗第3剂小于3周岁完成' }),
  'jei-4': (b) => ({ latest: beforeM(b, 84), windowNote: '国家免疫规划：乙脑灭活疫苗第4剂小于7周岁完成' }),
};
export function paidWindow(birthday, p) {
  const w = WIN[p.id] ? WIN[p.id](birthday) : {};
  return { earliest: w.earliest || paidDate(birthday, p), latest: w.latest || '', windowNote: w.windowNote || '未规定最迟；按说明书与上一剂的间隔，以接种门诊为准' };
}

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

// 返回每一项 { ...item, scheduleId, date（默认计划日）, earliest, latest, windowNote, note, age, past, existing, optional, hint }
export function planPaid(birthday, today, events = []) {
  const byId = new Map(events.filter((e) => e && e.scheduleId).map((e) => [e.scheduleId, e]));
  return PAID_SCHEDULE.map((p) => {
    const scheduleId = PAID_PREFIX + p.id;
    const date = paidDate(birthday, p);
    const f = PAID_FAMILIES[p.family] || {};
    const { at, ...rest } = p;
    return { ...rest, ...paidWindow(birthday, p), scheduleId, date, note: paidNote(p), familyName: f.name || '', hint: p.optional ? (f.hint || '备选方案，默认不添加') : '',
      optional: !!p.optional, past: date < today, existing: byId.get(scheduleId) || null };
  });
}

// ———————————————————————————————— v1.7.0：自费疫苗「待定」目录 + 按系列加入计划 ————————————————————————————————
// 自费疫苗默认「待定」：不写入日程。用户在目录里点「➕ 加入计划」、选第1剂日期后，按下面的程序自动生成全部剂次。
// 每剂：minAge 最小月龄/天龄；recAge 推荐月龄（计划日不早于它）；minInt 与上一剂最短间隔（→ 最早日期）；recInt 推荐间隔（→ 计划日）；
//       maxInt 与上一剂最长间隔（→ 最迟日期）；latest(b) 按年龄的最迟日期。
// 计划日 = max(推荐月龄日, 上一剂计划日 + 推荐间隔)；最早 = max(最小月龄日, 上一剂计划日 + 最短间隔)；最迟 = min(按年龄最迟, 上一剂 + 最长间隔)。
// 事项 scheduleId = 'paid:<family>-<n>'（RSV 为 'paid:rsv'），与旧版本一致，旧版本同步来/同步去都兼容。
const A = (m, d = 0) => ({ m, d });
const plusA = (s, a) => (a ? addDaysP(addMonthsP(s, a.m || 0), a.d || 0) : '');
const maxD = (...xs) => xs.filter(Boolean).sort().pop() || '';
const minD = (...xs) => xs.filter(Boolean).sort()[0] || '';
export function intText(a) {
  if (!a) return '';
  if (a.m && a.m % 12 === 0 && a.m >= 24) return `${a.m / 12}年`;
  if (a.m) return `${a.m}个月`;
  return a.d > 28 && a.d % 7 === 0 ? `${a.d / 7}周` : `${a.d}天`;
}

export const SERIES_ORDER = ['rsv', 'pcv13', 'penta', 'rota5', 'ev71', 'flu', 'var', 'hib', 'mcv', 'hepai', 'jei'];
export const SERIES = {
  rsv: { title: 'RSV单抗（尼塞韦单抗）', short: 'RSV单抗', group: 'main',
    prevents: '呼吸道合胞病毒（RSV）引起的毛细支气管炎、肺炎', schedule: '单剂肌内注射；出生后第一个RSV流行季前或季内',
    source: '尼塞韦单抗（乐唯初）说明书；婴幼儿RSV单抗免疫预防专家共识',
    doses: [{ label: '', minAge: A(0), latest: (b) => rsvSeasonEnd(b), latestNote: '参考：首个RSV流行季结束前' }] },
  pcv13: { title: '13价肺炎', group: 'main',
    prevents: '肺炎球菌引起的肺炎、脑膜炎、败血症、中耳炎', schedule: '共4剂：2、4、6月龄基础（首剂最早6周龄，间隔1～2个月、最少28天）＋12～15月龄加强（与第3剂间隔≥8周）',
    source: '沛儿13（13价肺炎球菌多糖结合疫苗）说明书',
    doses: [
      { label: '第1剂', minAge: A(0, 42), latest: (b) => beforeM(b, 7), latestNote: '说明书：6月龄内起种按3+1程序，7月龄后起种剂次减少' },
      { label: '第2剂', minInt: A(0, 28), recInt: A(2) },
      { label: '第3剂', minInt: A(0, 28), recInt: A(2), latest: (b) => beforeM(b, 12), latestNote: '参考：基础3剂在12月龄前完成' },
      { label: '第4剂（加强）', minAge: A(12), minInt: A(0, 56), recInt: A(0, 56), latest: (b) => beforeM(b, 16), latestNote: '说明书：加强剂12～15月龄' }] },
  penta: { title: '五联疫苗', hintName: '五联', group: 'main',
    prevents: '白喉、破伤风、百日咳、脊髓灰质炎、b型流感嗜血杆菌（Hib）', schedule: '共4剂：2、3、4月龄（或3、4、5月龄）基础，相邻间隔≥28天（推荐1个月）＋18月龄加强（与第3剂间隔≥6个月）',
    source: '潘太欣（DTaP-IPV/Hib）说明书；《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》百白破/脊灰间隔',
    replaces: '免费百白破第1～4剂、脊灰第1～4剂（6岁百白破第5剂仍要打）', replaceIds: ['dtap-1', 'dtap-2', 'dtap-3', 'dtap-4', 'polio-1', 'polio-2', 'polio-3', 'polio-4'],
    doses: [
      { label: '第1剂', minAge: A(2) },
      { label: '第2剂', minInt: A(0, 28), recInt: A(1) },
      { label: '第3剂', minInt: A(0, 28), recInt: A(1) },
      { label: '第4剂（加强）', minAge: A(18), minInt: A(6), recInt: A(6) }] },
  rota5: { title: '五价轮状', group: 'main',
    prevents: '轮状病毒肠炎（秋冬季婴幼儿腹泻主因），口服', schedule: '共3剂：第1剂6～12周龄，每剂间隔4～10周，第3剂不晚于32周龄',
    source: '乐儿德（口服五价重配轮状病毒减毒活疫苗）说明书',
    doses: [
      { label: '第1剂（口服）', minAge: A(0, 42), latest: (b) => addDaysP(b, 84), latestNote: '说明书：第1剂6～12周龄' },
      { label: '第2剂（口服）', minInt: A(0, 28), recInt: A(1), maxInt: A(0, 70), latestNote: '说明书：与上一剂间隔4～10周' },
      { label: '第3剂（口服）', minInt: A(0, 28), recInt: A(1), maxInt: A(0, 70), latest: (b) => addDaysP(b, 224), latestNote: '说明书：间隔4～10周，第3剂不晚于32周龄（超龄不再补种）' }] },
  ev71: { title: 'EV71手足口', group: 'main',
    prevents: 'EV71引起的重症手足口病（不预防其他型别）', schedule: '共2剂：6月龄起，间隔1个月，鼓励12月龄前完成',
    source: 'EV71灭活疫苗说明书（各厂家：6～71月龄或6～35月龄）',
    doses: [
      { label: '第1剂', minAge: A(6), latest: (b) => beforeM(b, 72), latestNote: '说明书：6～71月龄（部分产品到35月龄）' },
      { label: '第2剂', minInt: A(1), recInt: A(1), latest: (b) => beforeM(b, 72), latestNote: '说明书：与第1剂间隔1个月' }] },
  flu: { title: '流感疫苗', group: 'main', seasonStart: true,
    prevents: '流行性感冒', schedule: '首次接种2剂，间隔≥4周（6月龄～8岁）；以后每年秋季1剂',
    source: '《中国流感疫苗预防接种技术指南》、流感疫苗说明书',
    doses: [
      { label: '第1剂', minAge: A(6), latestNote: '6月龄起；每年流感季（9～10月起）接种，未规定最迟' },
      { label: '第2剂', minInt: A(0, 28), recInt: A(0, 28), latestNote: '首次接种的儿童与第1剂间隔≥4周' }] },
  var: { title: '水痘疫苗', group: 'main',
    prevents: '水痘', schedule: '共2剂：12月龄起第1剂，4周岁第2剂（两剂间隔≥3个月）',
    source: '《水痘疫苗预防接种专家共识》（中国疾控中心，2023）、说明书',
    doses: [
      { label: '第1剂', minAge: A(12) },
      { label: '第2剂', minInt: A(3), recAge: A(48), latestNote: '两剂间隔≥3个月；常规4周岁接种' }] },
  hib: { title: 'Hib疫苗', group: 'alt',
    prevents: 'b型流感嗜血杆菌引起的脑膜炎、肺炎', schedule: '2～5月龄起：3剂基础（间隔≥28天，推荐1个月）＋18月龄加强；起种晚则剂次减少',
    source: 'Hib结合疫苗说明书（各厂家程序略有不同）', conflict: 'penta', conflictText: '已计划五联（含Hib），不要再打Hib疫苗',
    doses: [
      { label: '第1剂', minAge: A(2) },
      { label: '第2剂', minInt: A(0, 28), recInt: A(1) },
      { label: '第3剂', minInt: A(0, 28), recInt: A(1) },
      { label: '第4剂（加强）', minAge: A(18), minInt: A(6), recInt: A(6) }] },
  mcv: { title: '流脑结合疫苗（AC结合/MCV4）', short: '流脑结合疫苗', group: 'alt',
    prevents: '流行性脑脊髓膜炎', schedule: '3月龄起；各产品剂次和间隔不同，这里只排第1剂，后续剂次按说明书/门诊安排',
    source: '流脑结合疫苗说明书（AC结合、ACYW135结合等）',
    replaces: '免费A群流脑多糖第1、2剂', replaceIds: ['mpsva-1', 'mpsva-2'],
    doses: [{ label: '第1剂', minAge: A(3) }] },
  hepai: { title: '甲肝灭活疫苗', group: 'alt',
    prevents: '甲型肝炎', schedule: '共2剂：18月龄、2周岁（间隔≥6个月）',
    source: '《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》甲肝灭活疫苗',
    replaces: '免费甲肝减毒活疫苗（1剂）', replaceIds: ['hepa-1'],
    doses: [
      { label: '第1剂', minAge: A(18), latest: (b) => beforeM(b, 24), latestNote: '国家免疫规划：第1剂小于24月龄完成' },
      { label: '第2剂', minInt: A(6), recAge: A(24), latest: (b) => beforeM(b, 36), latestNote: '国家免疫规划：与第1剂间隔≥6个月，小于3周岁完成' }] },
  jei: { title: '乙脑灭活疫苗', group: 'alt',
    prevents: '流行性乙型脑炎', schedule: '共4剂：8月龄2剂（间隔7～10天），2周岁、6周岁各1剂',
    source: '《国家免疫规划疫苗儿童免疫程序及说明（2026年版）》乙脑灭活疫苗（补种：第2、3剂间隔1～12个月，第3、4剂间隔≥3年）',
    replaces: '免费乙脑减毒活疫苗第1、2剂', replaceIds: ['je-1', 'je-2'],
    doses: [
      { label: '第1剂', minAge: A(8) },
      { label: '第2剂', minInt: A(0, 7), recInt: A(0, 7), maxInt: A(0, 10), latest: (b) => beforeM(b, 12), latestNote: '国家免疫规划：与第1剂间隔7～10天，小于12月龄完成' },
      { label: '第3剂', minInt: A(1), recAge: A(24), latest: (b) => beforeM(b, 36), latestNote: '国家免疫规划：2周岁；与第2剂间隔≥1个月，小于3周岁完成' },
      { label: '第4剂', minInt: A(36), recAge: A(72), latest: (b) => beforeM(b, 84), latestNote: '国家免疫规划：6周岁；与第3剂间隔≥3年，小于7周岁完成' }] },
};

export const seriesSid = (fam, n) => (fam === 'rsv' ? PAID_PREFIX + 'rsv' : `${PAID_PREFIX}${fam}-${n}`);
// scheduleId → { family, n }（不是系列剂次的返回 null）
export function seriesOfSid(sid) {
  if (!sid || !sid.startsWith(PAID_PREFIX)) return null;
  const k = sid.slice(PAID_PREFIX.length);
  if (k === 'rsv') return { family: 'rsv', n: 1 };
  const m = /^([a-z0-9]+)-(\d+)$/.exec(k);
  if (!m || !SERIES[m[1]] || +m[2] < 1 || +m[2] > SERIES[m[1]].doses.length) return null;
  return { family: m[1], n: +m[2] };
}
export function seriesTitle(fam, n) {
  const S = SERIES[fam], d = S.doses[n - 1];
  return fam === 'rsv' ? S.title : `${S.title} ${d.label}`; // 卡片上有蓝色「自费疫苗」标签
}

// 第1剂：最早、最迟、默认计划日（不早于 today；流感默认按流感季）
export function seriesStartInfo(fam, birthday, today = '') {
  const S = SERIES[fam], d1 = S.doses[0];
  const earliest = plusA(birthday, d1.minAge || A(0));
  const latest = d1.latest ? d1.latest(birthday) : '';
  let def = S.seasonStart ? maxD(earliest, fluStart(birthday)) : earliest;
  if (today && def < today) def = today; // 最早日期已过：默认从今天起
  return { earliest, latest, latestNote: d1.latestNote || '', def };
}

// 从第 fromN 剂（日期 fromDate）往后计算第 fromN+1… 剂：返回 [{ n, earliest, latest, date, windowNote }]
function nextDoses(fam, birthday, fromN, fromDate, count = Infinity) {
  const S = SERIES[fam], out = [];
  let prev = fromDate;
  for (let n = fromN + 1; n <= S.doses.length && out.length < count; n++) {
    const d = S.doses[n - 1];
    const earliest = maxD(d.minAge ? plusA(birthday, d.minAge) : '', plusA(prev, d.minInt || A(0)));
    const date = maxD(plusA(birthday, d.recAge || d.minAge || A(0)), plusA(prev, d.recInt || d.minInt || A(0)), earliest);
    const latest = minD(d.latest ? d.latest(birthday) : '', d.maxInt ? plusA(prev, d.maxInt) : '');
    out.push({ n, earliest, latest, date, windowNote: doseWinNote(d) });
    prev = date;
  }
  return out;
}
function doseWinNote(d) {
  const parts = [];
  if (d.minInt) parts.push(`最早＝上一剂计划日＋${intText(d.minInt)}（最短间隔）${d.minAge ? '且不早于最小月龄' : ''}`);
  else if (d.minAge) parts.push('最早＝最小接种年龄');
  if (d.latestNote) parts.push(d.latestNote);
  if (!d.latest && !d.maxInt && !/最迟/.test(d.latestNote || '')) parts.push('未规定最迟');
  return parts.join('；');
}

// 整个系列的计划（第1剂日期 start）：[{ n, scheduleId, title, earliest, latest, date, windowNote, note }]
export function seriesPlan(fam, birthday, start) {
  const S = SERIES[fam], info = seriesStartInfo(fam, birthday);
  // RSV 与旧版（v1.5/1.6 生成的 paid:rsv）备注、窗口说明完全一致
  const d1 = { n: 1, earliest: info.earliest, latest: info.latest, date: start, windowNote: fam === 'rsv' ? paidWindow(birthday, PAID_SCHEDULE[0]).windowNote : doseWinNote(S.doses[0]) };
  return [d1, ...nextDoses(fam, birthday, 1, start)].map((x) => ({ ...x, scheduleId: seriesSid(fam, x.n), title: seriesTitle(fam, x.n), note: seriesNote(fam, x.n) }));
}
export function seriesNote(fam, n) {
  const S = SERIES[fam], f = PAID_FAMILIES[fam] || {};
  if (fam === 'rsv') return paidNote(PAID_SCHEDULE[0]);
  return [S.doses.length > 1 ? `自费·共${S.doses.length}剂，本剂为第${n}剂` : '自费', f.note, PAID_DISCLAIMER].filter(Boolean).join(' · ');
}

// 顺延：第 changedN 剂的日期变为 newDate 后，重新计算后面「未完成」的剂次（已完成的不动，只作为下一剂的起点）
// doseEvents：该系列现有事项；返回 [{ ev, n, date, earliest, latest }]，只含日期或最早日期有变化的
// keepDates：不顺延（保持原计划日），只按实际的上一剂日期重算最早/最迟
export function reflowSeries(fam, birthday, doseEvents, changedN, newDate, { keepDates = false } = {}) {
  const S = SERIES[fam];
  const byN = new Map();
  for (const e of doseEvents) { const s = seriesOfSid(e.scheduleId); if (s && s.family === fam) byN.set(s.n, e); }
  const out = [];
  let prevN = changedN, prevDate = newDate;
  for (let n = changedN + 1; n <= S.doses.length; n++) {
    const ev = byN.get(n);
    if (!ev) continue;
    if (ev.done) { prevN = n; prevDate = ev.date; continue; }
    // 与上一剂中间缺了剂次（被删除）时，从上一剂逐剂推算
    const calc = nextDoses(fam, birthday, prevN, prevDate, n - prevN).pop();
    const date = keepDates ? ev.date : calc.date;
    if (date !== ev.date || calc.earliest !== (ev.earliest || '') || calc.latest !== (ev.latest || '')) out.push({ ev, n, date, earliest: calc.earliest, latest: calc.latest, dateChanged: date !== ev.date });
    prevN = n; prevDate = date;
  }
  return out;
}

// 目录条目：{ family, S, info, doses(已在计划的事项), inPlan, doneN, pendingN, replacesHtml... }
export function catalogEntries(birthday, today, events = []) {
  return SERIES_ORDER.map((fam) => {
    const S = SERIES[fam];
    const doses = events.filter((e) => { const s = seriesOfSid(e.scheduleId); return s && s.family === fam; })
      .sort((a, b) => seriesOfSid(a.scheduleId).n - seriesOfSid(b.scheduleId).n);
    const info = seriesStartInfo(fam, birthday, today);
    const pending = doses.filter((e) => !e.done);
    return { family: fam, S, f: PAID_FAMILIES[fam] || {}, info, doses, inPlan: pending.length > 0, doneN: doses.length - pending.length, pendingN: pending.length,
      next: pending.sort((a, b) => a.date.localeCompare(b.date))[0] || null };
  });
}

// 已加入计划的自费疫苗可替代的免费剂次：Map('nip:dtap-1' → '已计划五联，可不打此剂（以门诊为准）')
export function replacementHints(events = []) {
  const planned = new Set();
  for (const e of events) { const s = seriesOfSid(e.scheduleId); if (s) planned.add(s.family); }
  const m = new Map();
  for (const fam of planned) {
    const S = SERIES[fam];
    for (const id of S.replaceIds || []) m.set('nip:' + id, `已计划${S.hintName || S.short || S.title}，可不打此剂（以门诊为准）`);
  }
  return m;
}
