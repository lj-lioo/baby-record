// 0～6岁儿童健康管理（儿保体检）计划。纯函数，不依赖 localStorage，便于测试。
// 依据：《国家基本公共卫生服务规范（第三版）》0～6岁儿童健康管理服务规范（国卫基层发〔2017〕13号）；
// 眼保健：《0～6岁儿童眼保健及视力检查服务规范（试行）》（国卫办妇幼发〔2021〕11号，13次，随儿保体检进行）；
// 屈光筛查：教育部办公厅等《关于科学保护儿童远视储备量的通知》（2025年，24、36月龄和4、5、6岁）；
// 听力复筛：《新生儿疾病筛查技术规范（2010年版）》（初筛未通过或漏筛者 42 天内双耳复筛）。
// 孤独症初筛：《0～6岁儿童孤独症筛查干预服务规范（试行）》（国卫办妇幼发〔2022〕12号，3、6、8、12、18、24、30、36月龄和4、5、6岁共11次，用预警征象筛查表）；
// 中医药健康管理：《国家基本公共卫生服务规范（第三版）》0～36月龄儿童中医药健康管理（6、12、18、24、30、36月龄）；
// 髋关节：《0～6岁儿童健康管理技术规范》（WS/T 479—2015）体格检查含髋关节；涂氟：儿童口腔疾病综合干预项目（项目地区3～6岁每半年1次）。
import { addDays } from './dates.js';
import { addMonths } from './vaccines.js';

const BASE = '体格测量、生长发育和心理行为发育评估（含孤独症初筛：预警征象）、眼保健和视力检查、口腔保健指导';
const HIP = '体格检查含髋关节（发育性髋关节发育不良筛查）';
const TEETH = '出牙和龋齿检查';
const FLUORIDE = '涂氟：不属于基本公卫体检，开展「儿童口腔疾病综合干预项目」的地区3～6岁每半年免费涂氟1次（多在幼儿园或口腔门诊），其他地区可自费，按当地通知';
const tcm = (x) => `中医药健康管理：饮食起居指导，教家长${x}`;
const PRE = '体格测量、心理行为发育评估（含孤独症初筛）、血常规（或血红蛋白）、视力及屈光筛查、口腔检查和保健指导';

// d = 出生后天数；m = 月龄。id 固定，用于去重（事项 scheduleId = 'chk:' + id）
export const CHECKUP_SCHEDULE = [
  { id: 'home-visit', d: 7, title: '新生儿家庭访视', age: '出院后1周内',
    what: '医生上门：测体温、体重身长、体格检查，观察喂养/黄疸/脐部/口腔，眼外观检查，髋关节检查，询问新生儿疾病筛查（足跟血）和听力筛查结果，建立《母子健康手册》',
    pastLabel: '已过（出院后1周内，通常已上门访视）' },
  { id: 'nbs-result', d: 21, title: '新生儿疾病筛查（足跟血）结果查询', age: '出生后约3周', optional: true,
    what: '查询足跟血筛查（先天性甲减、苯丙酮尿症等）结果；如接到阳性/可疑召回通知，尽快按要求复查',
    hint: '可选：结果一般由筛查中心通知或可在线查询，默认不添加', where: '以出生医院/新生儿疾病筛查中心通知为准' },
  { id: 'm1', d: 30, title: '满月体检', age: '出生后28～30天', alt42: true,
    what: '体重、身长、头围测量，体格检查（含髋关节；有臀位、家族史等高危因素的按医嘱4～6周做髋关节超声），眼保健；可结合接种乙肝疫苗第2剂' },
  { id: 'hearing-rescreen', d: 42, title: '新生儿听力复筛', age: '出生42天内', optional: true,
    what: '仅在出生时听力初筛未通过或漏筛时需要：双耳复筛',
    hint: '仅初筛未通过/漏筛时需要，默认不添加', where: '以出生医院/筛查机构通知为准' },
  { id: 'm3',  m: 3,  title: '3月龄儿保体检',  what: `${BASE}；${HIP}` },
  { id: 'm6',  m: 6,  title: '6月龄儿保体检',  what: `${BASE}；${HIP}；血常规（或血红蛋白，6～8月龄查1次）；听力筛查（行为测听）；${tcm('摩腹和捏脊')}` },
  { id: 'm8',  m: 8,  title: '8月龄儿保体检',  what: `${BASE}；6月龄未查血常规的在此时查` },
  { id: 'm12', m: 12, title: '12月龄儿保体检', what: `${BASE}；${TEETH}；听力筛查（行为测听）；${tcm('摩腹和捏脊')}` },
  { id: 'm18', m: 18, title: '18月龄儿保体检', what: `${BASE}；${TEETH}；血常规（或血红蛋白）；${tcm('按揉迎香穴、足三里穴')}` },
  { id: 'm24', m: 24, title: '2岁儿保体检',    what: `${BASE}；${TEETH}；听力筛查（行为测听）；屈光筛查；${tcm('按揉迎香穴、足三里穴')}` },
  { id: 'm30', m: 30, title: '30月龄儿保体检', what: `${BASE}；${TEETH}；血常规（或血红蛋白）；${tcm('按揉四神聪穴')}` },
  { id: 'm36', m: 36, title: '3岁儿保体检',    what: `${BASE}；${TEETH}；听力筛查（行为测听）；屈光筛查；${tcm('按揉四神聪穴')}；${FLUORIDE}` },
  { id: 'y4',  m: 48, title: '4岁儿保体检',    what: `${PRE}；${FLUORIDE}` },
  { id: 'y5',  m: 60, title: '5岁儿保体检',    what: `${PRE}；${FLUORIDE}` },
  { id: 'y6',  m: 72, title: '6岁儿保体检',    what: `${PRE}；${FLUORIDE}` },
];

export const CHECKUP_SOURCE = '国家基本公共卫生服务规范（第三版）· 0～6岁儿童健康管理';

export function checkupAge(c) {
  if (c.age) return c.age;
  if (c.m < 24) return `满${c.m}月龄`;
  return c.m % 12 ? `满${c.m}月龄` : `满${c.m / 12}周岁`;
}

// 体检窗口（参考）：规范只规定了体检的月龄/年龄，没有给出日期范围。这里按儿保常用的年龄口径：
// 「X月龄」= 满X月龄至下个月龄前一天；「X岁」= 满X周岁至下一个生日前一天；满月体检 28～42 天（不少地区做「42天体检」）。
export function checkupWindow(birthday, c) {
  if (c.id === 'home-visit') return { earliest: birthday, latest: addDays(birthday, 7), windowNote: '参考：出院后1周内（医生上门）' };
  if (c.id === 'm1') return { earliest: addDays(birthday, 28), latest: addDays(birthday, 42), windowNote: '参考：满28天～42天（各地安排在满月或42天）' };
  if (c.id === 'hearing-rescreen') return { earliest: birthday, latest: addDays(birthday, 42), windowNote: '新生儿听力筛查规范：初筛未通过者42天内复筛' };
  if (c.d != null) return { earliest: checkupDate(birthday, c), latest: '', windowNote: '' };
  const earliest = addMonths(birthday, c.m);
  if (c.m < 48) return { earliest, latest: addDays(addMonths(birthday, c.m + 1), -1), windowNote: `参考：${c.m}月龄～${c.m}月龄的最后一天（儿保常用年龄口径）` };
  return { earliest, latest: addDays(addMonths(birthday, c.m + 12), -1), windowNote: `参考：${c.m / 12}岁＝满${c.m / 12}周岁至${c.m / 12 + 1}周岁生日前` };
}

export function checkupDate(birthday, c) { return c.d != null ? addDays(birthday, c.d) : addMonths(birthday, c.m); }

export function checkupNote(c, birthday) {
  const parts = ['儿童健康管理', checkupAge(c), c.what];
  if (c.alt42) {
    const d42 = addDays(birthday, 42);
    parts.push(`不少地区安排在满42天（${Number(d42.slice(5, 7))}月${Number(d42.slice(8))}日）做「42天体检」，按社区通知`);
  }
  parts.push(c.where || '以社区卫生服务中心预约为准');
  return parts.join(' · ');
}

// 返回每一项 { ...item, scheduleId, date, note, age, past, existing }
export function planCheckups(birthday, today, events = []) {
  const byId = new Map(events.filter((e) => e.scheduleId).map((e) => [e.scheduleId, e]));
  return CHECKUP_SCHEDULE.map((c) => {
    const scheduleId = `chk:${c.id}`;
    const date = checkupDate(birthday, c);
    return { ...c, ...checkupWindow(birthday, c), scheduleId, date, note: checkupNote(c, birthday), age: checkupAge(c), past: date < today, existing: byId.get(scheduleId) || null };
  });
}
