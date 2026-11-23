import { validateCare } from './care.js';
import { addDays, pad, parseYmd, toLocalInput, ymd } from './dates.js';

const DIGITS = '零〇一二两三四五六七八九';
const VALUE = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const INTEGER = '[\\d' + DIGITS + '十百千]+';
const NUMBER = INTEGER + '(?:[.点][\\d' + DIGITS + ']+)?';
const BOTTLE_COUNT = '(?:' + INTEGER + '|半)\\s*瓶\\s*奶';
const FEEDING_HOMOPHONE = new RegExp('为了(?=(?:' + BOTTLE_COUNT + '|奶)(?:$|[\\s,，。.!！；;？?]))', 'g');
const COUNTED_BOTTLE_FEEDING = new RegExp('(?:喝|喂)了\\s*' + BOTTLE_COUNT);
const UNSAVED = /[?？]|还没|没有|不是|没(?:喝|吃|喂|拉|用|服|尿|小便|排尿)|未(?:喝|吃|喂|拉|用|服|尿|小便|排尿)|别记|不要|不用|打算|计划|准备|想喂|想给|想吃|还要|如果|等会|待会|稍后|晚点|稍晚|过一会|过会|提醒|应该|建议|需要|怎么|能不能|要不要|是不是|有没有|吃不吃|喂不喂|能吃|能喝|可以(?:吗|喂|吃|给|用)|多少|吧$|吗$|呢$|还是|大约|大概|好像|可能|改成|删除|取消|冲了|泡了|倒了|装了|挤了|兑了|剩下|剩了|吐了|吐奶/;
const NURSING = /亲喂|直接(?:喂)?母乳|吸(?:了|过)?母乳|吃(?:了|过)?胸|吸(?:了|过)?奶|(?:吸|嘬|含)(?:了|过|着)?(?:妈妈的)?(?:奶头|乳头)/;
const BOTTLE = /瓶喂|用奶瓶|奶瓶喂|奶瓶喝|喝奶瓶|半瓶|喝了[一1]瓶/;
const BOTTLE_REFERENCE = /(?:用|拿|从)(?:了|着)?\s*(?:[这那]个)?\s*(?:小)?(?:奶瓶|瓶子|瓶)\s*(?:里\s*)?(?:喂|喝|味的(?=\s*(?:喝|喂)))|瓶子\s*(?:喂|喝)|^(?:是)?(?:用|拿)?\s*(?:[这那]个)?\s*(?:小)?(?:奶瓶|瓶子|瓶)(?:的)?$/;
const DIRECT_FEEDING_REFERENCE = /直接\s*(?:吸|嘬)(?:奶|了|着|的|$)|贴着妈妈(?:身上)?(?:吸|嘬)/;
const MILK_CONTEXT = /母乳|妈妈的奶|配方奶|奶粉|(?:喝|喂)(?:了|过)?奶|(?:毫升|m\s*l|cc)\s*(?:的)?奶/i;
const OTHER_DRINK = /奶茶|果汁|饮料|药水|药液|口服液|(?:温|白|凉)?开水|矿泉水|纯净水|(?:喝|喂|毫升|m\s*l|cc|装的是)(?:了|过|下)?\s*(?:一点|一口|点|的)?\s*(?:[温凉热糖盐]?水(?!样)|茶|汤|药)/i;
const STOOL = /排便|大便|便便|粑粑|臭臭|软便|稀便|硬便|水样便|拉了|拉稀/;
const URINE = /小便|排尿|尿(?:了|过|尿|湿)|撒(?:了|过)?尿|拉(?:了|过)?尿/;
const ACTION = /亲喂|瓶喂|吸了|喝|喂|排便|大便|拉|便便|粑粑|臭臭|小便|排尿|尿(?:了|过|尿|湿)|撒(?:了|过)?尿|用了|用药|吃了|服了|补了|滴了/;
const DOSE_ACTION = /用药|服(?:了|用)|(?:吃|喂)(?:了|过).*药|滴了|补了|打了/;
const FEED = /母乳|配方奶|奶粉|奶瓶|喂奶|喝奶|喝了|喂了|亲喂|瓶喂/;
const PART_OF_DAY = '凌晨|半夜|早上|早晨|上午|中午|下午|傍晚|晚上|夜里';
const CLOCK = new RegExp('(?:(' + PART_OF_DAY + ')\\s*)?(?<!\\d)(\\d{1,2})(?:\\s*:\\s*(\\d{1,2})(?!\\d)|\\s*[点时]\\s*(?:(半|一刻|三刻)|(\\d{1,2})(?!\\d)(?:\\s*分)?)?)', 'g');
const RELATIVE = new RegExp('(' + NUMBER + '|半)\\s*(?:个)?\\s*(小时|钟头|分钟|分)\\s*前', 'g');
const MILK_AMOUNT = new RegExp('(' + NUMBER + ')\\s*(毫升|m\\s*l|cc)', 'gi');
const AMOUNT_ANSWER = new RegExp('^(?:(?:实际|一共|总共|就)?\\s*喝(?:了|下|下了)?\\s*)?(' + NUMBER + ')$');
const MINUTES = new RegExp('(' + INTEGER + ')\\s*分钟(?!\\s*前)', 'g');
const DOSE_AMOUNT = new RegExp('(' + NUMBER + '|半)\\s*(毫升|毫克|微克|国际单位|单位|mg|m\\s*l|滴|粒|颗|片|袋|支)(?!剂)', 'gi');
const MULTIPLE = new RegExp('(' + INTEGER + ')\\s*次', 'g');

function numberFromSpeech(raw) {
  const text = String(raw).replace('点', '.');
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const [whole, decimal] = text.split('.');
  const digits = (part) => [...part].map((digit) => VALUE[digit] ?? digit).join('');
  let value = 0;
  let digit = 0;
  for (const char of whole) {
    const scale = { 十: 10, 百: 100, 千: 1000 }[char];
    if (scale) { value += (digit || 1) * scale; digit = 0; }
    else digit = VALUE[char] ?? Number(char);
  }
  const integer = /[十百千]/.test(whole) ? value + digit : Number(digits(whole));
  return decimal ? Number(String(integer) + '.' + digits(decimal)) : integer;
}

function normalize(text) {
  return text.normalize('NFKC').trim().replace(/k\s*[一壹1](?![a-z0-9])/gi, 'K1')
    .replace(FEEDING_HOMOPHONE, '喂了')
    .replace(/昨晚/g, '昨天晚上').replace(/昨早/g, '昨天早上')
    .replace(/今早/g, '今天早上').replace(/今晚/g, '今天晚上')
    .replace(/明早/g, '明天早上').replace(/明晚/g, '明天晚上');
}

function calendarDate(year, month, day) {
  const candidate = String(year) + '-' + pad(month) + '-' + pad(day);
  return ymd(parseYmd(candidate)) === candidate ? candidate : '';
}

function readWhen(text, now) {
  const [today] = toLocalInput(now).split('T');
  const clockText = text.replace(MILK_AMOUNT, ' ').replace(DOSE_AMOUNT, ' ')
    .replace(new RegExp('([' + DIGITS + '十百千]+)(?=\\s*[年月日号点时分])', 'g'), (number) => String(numberFromSpeech(number)));
  const relative = [...text.matchAll(RELATIVE)];
  const dates = [...clockText.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})|(?:(\d{4})年|去年)?\s*(\d{1,2})月\s*(\d{1,2})(?:日|号)/g)];
  const dayWords = [...text.matchAll(/大前天|前天|昨天|昨日|今天|今日|当天|明天|后天/g)];
  const current = /刚刚|刚才|现在|刚(?:喂|喝|吃|拉|用|亲喂|尿)/.test(text);
  if (/\d+\s*[点时]\s*(?:左右|多)/.test(clockText)) return { problem: '请再说具体是几点几分。' };
  const clocks = [...clockText.matchAll(CLOCK)];
  if (relative.length > 1 || dates.length + dayWords.length > 1 || clocks.length > 1 ||
    (relative.length && (clocks.length || dates.length || dayWords.length))) return { problem: '请把不同时间的记录分开说。' };
  if (relative.length) {
    const [, number, unit] = relative[0];
    const minutes = (number === '半' ? 0.5 : numberFromSpeech(number)) * (/小时|钟头/.test(unit) ? 60 : 1);
    const [date, time] = toLocalInput(now - minutes * 60000).split('T');
    return { date, time };
  }
  let date;
  if (dates.length) {
    const m = dates[0];
    const year = m[1] || m[4] || Number(today.slice(0, 4)) - (m[0].includes('去年') ? 1 : 0);
    date = calendarDate(year, +(m[2] || m[5]), +(m[3] || m[6]));
    if (!date) return { problem: '这个日期无效，请重新说日期和时间。' };
  } else if (dayWords.length) {
    const offset = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 今天: 0, 今日: 0, 当天: 0, 明天: 1, 后天: 2 };
    date = addDays(today, offset[dayWords[0][0]]);
  } else if (current) date = today;
  if (!date && /周[一二三四五六日天末]|星期|上个月|上周|下周|去年|前几天|(?:[一二两三四五六七八九十\d]+|几)\s*天前/.test(text)) {
    return { problem: '请说实际发生的具体日期和时间。' };
  }
  if (!clocks.length) return { date, vague: new RegExp(PART_OF_DAY).test(text) };
  const [, period, hour, colon, fraction, minute] = clocks[0];
  let h = Number(hour);
  const min = Number(colon || minute || ({ 半: 30, 一刻: 15, 三刻: 45 })[fraction] || 0);
  if (h < 12 && /下午|傍晚|晚上|中午|夜里/.test(period || '') && (period !== '中午' || h < 11)) h += 12;
  if (h === 12 && /凌晨|半夜/.test(period || '')) h = 0;
  if (h > 23 || min > 59) return { problem: '这个时间无效，请重新说几点几分。' };
  return { date, time: pad(h) + ':' + pad(min) };
}

function doseNames(text, medicines) {
  const spoken = /(?:吃了|服了|用了|补了|喂了|服用了?)\s*([\p{L}\p{N}·\-]{1,24}(?:滴剂|口服液|颗粒|益生菌|鱼肝油))/u.exec(text)?.[1];
  const names = [
    /(?:维生素|维他命)\s*AD|(?<![a-z])AD(?![a-z])/i.test(text) ? '维生素AD' : '',
    /(?:维生素|维他命)\s*K\s*1|(?<![a-z])K\s*1(?![a-z0-9])/i.test(text) ? '维生素K1' : '',
    ...medicines.filter((name) => name && text.includes(name)),
    spoken,
  ].filter(Boolean);
  return [...new Set(names)].filter((name, _, all) => !all.some((longer) => longer !== name && longer.includes(name)));
}

function facts(text, context, draft) {
  const when = readWhen(text, context.now);
  if (when.problem) return when;
  if ([...text.matchAll(MULTIPLE)].some((m) => numberFromSpeech(m[1]) > 1)) return { problem: '请把每一次的时间分别说一下。' };
  const names = doseNames(text, context.medicines);
  if (names.length > 1) return { problem: '一次用药请说一个药名和对应用量，不同药品分开说。' };
  const formula = /配方奶|奶粉/.test(text);
  const breast = /母乳|妈妈的奶/.test(text);
  const milk = /混合/.test(text) || (formula && breast) ? 'mixed' : formula ? 'formula' : breast ? 'breast' : '';
  const amounts = [...text.matchAll(MILK_AMOUNT)].map((m) => numberFromSpeech(m[1]));
  const durations = [...text.matchAll(MINUTES)].map((m) => numberFromSpeech(m[1]));
  const feedingContext = draft && (!draft.kind || draft.kind === 'bottle' || draft.kind === 'nursing');
  const feedingEvidence = feedingContext || MILK_CONTEXT.test(text);
  const bottleReference = BOTTLE_REFERENCE.test(text);
  const bottleMention = BOTTLE.test(text) || COUNTED_BOTTLE_FEEDING.test(text) || (bottleReference && feedingEvidence);
  const nursing = NURSING.test(text) || (breast && !bottleMention && durations.length === 1) ||
    (feedingEvidence && DIRECT_FEEDING_REFERENCE.test(text));
  const bottle = bottleMention || (!nursing && formula && (amounts.length || /喝|喂/.test(text)));
  const isDose = names.length > 0 || DOSE_ACTION.test(text) || (!bottleReference && /用了/.test(text));
  if ((feedingContext || bottle || nursing || (!isDose && FEED.test(text))) && OTHER_DRINK.test(text)) {
    return { problem: '我听到了其他饮品或用药。如果这次喝的是奶，请再说一下。' };
  }
  const urine = URINE.test(text);
  const stoolRecord = STOOL.test(urine ? text.replace(/拉(?:了|过)?尿/g, '') : text);
  const kinds = [nursing && 'nursing', bottle && 'bottle', stoolRecord && 'stool', urine && 'urine', isDose && 'dose'].filter(Boolean);
  const kind = kinds[0] || '';
  if (kinds.length > 1 || ((kind === 'stool' || kind === 'urine') && FEED.test(text)) || (kind === 'dose' && /母乳|奶瓶|奶粉|配方奶|喂奶|喝奶/.test(text))) {
    return { problem: '一句里有不同类型的记录，请用「然后」或分句隔开。' };
  }
  const doseText = names.reduce((value, name) => value.replaceAll(name, ' '), text).replace(/(?:维生素|维他命)?\s*K\s*1(?![a-z])/gi, ' ');
  const doseMatches = kind === 'dose' ? [...doseText.matchAll(DOSE_AMOUNT)] : [];
  if (doseMatches.length > 1) return { problem: '听到了多个用量，请再说一次本次实际用量。' };
  const stool = /水样|稀便|拉稀/.test(text) ? 'loose' : /偏硬|硬便|干便/.test(text) ? 'hard' : /软便|软软/.test(text) ? 'soft' : /成形/.test(text) ? 'formed' : '';
  return {
    ...when, kind, milk, stool, name: names[0],
    ml: amounts.length === 1 ? amounts[0] : undefined,
    ambiguousMl: amounts.length > 1,
    minutes: durations.length === 1 ? durations[0] : undefined,
    dose: doseMatches.length ? (doseMatches[0][1] === '半' ? '半' : numberFromSpeech(doseMatches[0][1])) + doseMatches[0][2] : '',
  };
}

function fieldToAsk(record, latest) {
  if (!record.kind) return ['kind', '这次是母乳亲喂，还是用奶瓶喂？'];
  if (!record.time) return ['time', '这条记录是几点几分？'];
  if (record.date + 'T' + record.time > latest) return ['time', '这个时间还没到，请说实际发生的日期和时间。'];
  if (record.kind === 'bottle' && !record.ml) return ['ml', '奶瓶里实际喝下了多少毫升？'];
  if (record.kind === 'dose' && !record.name) return ['name', '请补充这次实际用的药品或补充剂名称。'];
  const error = validateCare(record, latest);
  return error ? ['invalid', error + '，请再说一次这条记录。'] : null;
}

function splitRecords(text) {
  const lines = text.split(/[。！!；;\n]+/).map((line) => line.trim()).filter(Boolean);
  return lines.flatMap((line) => {
    const parts = line.split(/[，,]|然后|接着|另外|后来|并且|又|[还也](?=(?:拉|排便|尿了|小便|排尿|吃了|服了|用了|喝了|喂了))/).map((part) => part.trim()).filter(Boolean);
    const clauses = [];
    for (const part of parts) {
      const last = clauses.at(-1);
      const addsAmount = last && (BOTTLE.test(last) || BOTTLE_REFERENCE.test(last)) && ![...last.matchAll(MILK_AMOUNT)].length &&
        /^(?:实际|一共|总共|喝(?:下|了))/.test(part) && [...part.matchAll(MILK_AMOUNT)].length;
      if (last && (addsAmount || !(ACTION.test(last) && ACTION.test(part)))) clauses[clauses.length - 1] += '，' + part;
      else clauses.push(part);
    }
    return clauses;
  });
}

function updateDraft(record, info, reply, asking, latest) {
  if (info.kind && (record.kind ? info.kind !== record.kind : !['bottle', 'nursing'].includes(info.kind))) return null;
  const nursingAnswer = asking === 'kind' && /^(?:是)?母乳$/.test(reply);
  const next = {
    ...record,
    kind: info.kind || (nursingAnswer ? 'nursing' : record.kind),
    date: info.date || record.date,
    time: info.time || record.time,
    ml: info.ambiguousMl ? undefined : info.ml ?? record.ml,
    milk: info.milk || record.milk,
    minutes: info.minutes ?? record.minutes,
    stool: info.stool || record.stool,
    name: info.name || record.name,
    dose: info.dose || record.dose,
  };
  const amountAnswer = asking === 'ml' && info.ml == null && AMOUNT_ANSWER.exec(reply);
  if (amountAnswer) next.ml = numberFromSpeech(amountAnswer[1]);
  if (asking === 'name' && !info.name && /^[\p{L}\p{N}·\-]{1,32}$/u.test(reply) &&
    !ACTION.test(reply) && !info.time && ![...reply.matchAll(DOSE_AMOUNT)].length) next.name = reply;
  if (asking === 'time' && /刚刚|刚才|现在/.test(reply) && !info.time) next.time = latest.slice(11);
  return next;
}

export function interpretCareSpeech(raw, { now, day, medicines = [], pending = [] }) {
  const text = normalize(raw);
  const latest = toLocalInput(now);
  const today = latest.slice(0, 10);
  const wait = (question, records = pending) => ({ question, pending: records, records: [] });
  if (!text) return wait('说一句刚发生的事，例如「刚刚亲喂了十五分钟」。');
  if (UNSAVED.test(text.replace(/[。！!]+$/, ''))) return wait('听起来有疑问、否定或计划。请说已经发生的事，我再记录。');
  const context = { now, medicines };
  const chunks = splitRecords(text);
  if (!chunks.length) return wait('没听到可记录的内容，请再说一次。');
  if (chunks.length > 5) return wait('请分开说，每次最多五条记录。');
  let drafts;
  if (pending.length) {
    if (chunks.length !== 1) return wait('先补充刚才那条；新记录可以下一句再说。');
    const index = pending.findIndex((record) => fieldToAsk(record, latest));
    if (index < 0) return wait('请重新说这次记录的日期和时间。', []);
    const record = pending[index];
    const reply = facts(chunks[0], context, record);
    if (reply.problem) return wait(reply.problem);
    const next = updateDraft(record, reply, chunks[0], fieldToAsk(record, latest)[0], latest);
    if (!next) return wait('这像是一条新记录，请先补充刚才那条，或点「重新开始」。');
    drafts = pending.map((entry, i) => i === index ? next : entry);
  } else {
    drafts = [];
    for (const chunk of chunks) {
      const info = facts(chunk, context);
      if (info.problem) return wait(info.problem);
      if (!info.kind && !FEED.test(chunk)) return wait('没听清记录类型。可以说喂奶、大便、小便或实际用药。');
      if (info.kind === 'dose' && !info.dose && !/已用|已服|已吃|服用|吃了|服了|用了|喂了|补了|打了|滴了|滴.{0,20}了|用药/.test(chunk)) {
        return wait('请说这次已经服用的药品，例如「刚才吃了维生素AD」。');
      }
      const previous = drafts.at(-1);
      const date = info.date || previous?.date || day || today;
      const currentTime = latest.slice(11);
      const defaultTime = date === today && !info.vague && (!previous || info.date || previous.time === currentTime) ? currentTime : '';
      drafts.push({
        kind: info.kind, date, time: info.time || defaultTime,
        ml: info.ml, milk: info.milk, minutes: info.minutes, stool: info.stool, name: info.name, dose: info.dose,
      });
    }
  }
  const missing = drafts.map((record) => fieldToAsk(record, latest)).find(Boolean);
  if (missing) return wait(missing[1], drafts);
  return { question: '', pending: [], records: drafts };
}
