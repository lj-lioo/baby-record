import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretCareSpeech } from '../site/js/care-voice.js';
import { careDay } from '../site/js/care.js';

const now = new Date(2026, 10, 23, 16, 10).getTime();
const say = (text, options = {}) => interpretCareSpeech(text, { now, ...options });
const fields = ({ kind, date, time, ml, milk, minutes, stool, name, dose }) =>
  [kind, date, time, ml, milk, minutes, stool, name, dose];

test('自然语言识别时间、奶量、亲喂时长和用药用量', () => {
  const first = say('今天上午八点半瓶喂一百二十毫升配方奶，九点拉了一次软便，又在十点吃了维生素K1一滴');
  assert.equal(first.question, '');
  assert.deepEqual(first.records.map(fields), [
    ['bottle', '2026-11-23', '08:30', 120, 'formula', undefined, '', undefined, ''],
    ['stool', '2026-11-23', '09:00', undefined, '', undefined, 'soft', undefined, ''],
    ['dose', '2026-11-23', '10:00', undefined, '', undefined, '', '维生素K1', '1滴'],
  ]);
  const second = say('半个小时前母乳亲喂了十五分钟').records[0];
  assert.equal(second.kind, 'nursing');
  assert.equal(second.time, '15:40');
  assert.equal(second.minutes, 15);
  assert.equal(say('刚才喝了七十点五毫升配方奶').records[0].ml, 70.5);
  assert.equal(say('上午八点瓶喂了，喝了九十毫升').records[0].ml, 90);
  assert.equal(say('九点喂了一滴维生素AD').records[0].name, '维生素AD');
  assert.equal(say('服用了铁滴剂一滴', { medicines: ['铁滴剂'] }).records[0].dose, '1滴');
  assert.deepEqual(say('昨天八点拉了大便，九点拉了尿').records.map((r) => [r.kind, r.date, r.time]), [
    ['stool', '2026-11-22', '08:00'],
    ['urine', '2026-11-22', '09:00'],
  ]);
});

test('语音补记凌晨时按所选周期换算实际日期', () => {
  const when = (result) => result.records.map((record) => [record.date, record.time, careDay(record)]);
  const day = '2026-11-22';
  assert.deepEqual(when(say('凌晨三点瓶喂了五十毫升', { day })), [['2026-11-23', '03:00', day]]);
  assert.deepEqual(when(say('早上八点瓶喂了五十毫升', { day })), [[day, '08:00', day]]);
  assert.deepEqual(when(say('昨天凌晨三点瓶喂了五十毫升', { day })), [[day, '03:00', '2026-11-21']]);
  const { pending } = say('瓶喂了五十毫升', { day });
  assert.deepEqual(when(say('凌晨三点', { day, pending })), [['2026-11-23', '03:00', day]]);
  const overnight = new Date(2026, 10, 23, 3, 15).getTime();
  assert.deepEqual(when(say('晚上十点亲喂了', { now: overnight })), [[day, '22:00', day]]);
  assert.deepEqual(when(say('凌晨三点拉了软便', { now: overnight })), [['2026-11-23', '03:00', day]]);
});

test('对话补充瓶喂奶量、喂养方式和补记时间', () => {
  const bottle = say('昨晚八点用奶瓶喂了');
  assert.match(bottle.question, /多少毫升/);
  assert.deepEqual(bottle.records, []);
  const complete = say('九十五毫升母乳', { pending: bottle.pending }).records[0];
  assert.equal(complete.date, '2026-11-22');
  assert.equal(complete.time, '20:00');
  assert.equal(complete.ml, 95);
  assert.equal(complete.milk, 'breast');
  const unspecified = say('上午八点喂了九十毫升母乳');
  assert.match(unspecified.question, /亲喂.*奶瓶/);
  assert.equal(say('用奶瓶喂的', { pending: unspecified.pending }).records[0].kind, 'bottle');
  const stool = say('昨天拉了软便');
  assert.match(stool.question, /几点/);
  assert.equal(say('晚上八点半', { pending: stool.pending }).records[0].time, '20:30');
  const two = say('昨天八点瓶喂90毫升还拉了软便');
  assert.match(two.question, /几点/);
  assert.equal(say('九点', { pending: two.pending }).records[1].date, '2026-11-22');
});

test('听写把「喂了奶」写成「为了奶」时先确认方式，并保留原时间', () => {
  const first = say('早上8:00为了奶');
  assert.match(first.question, /亲喂.*奶瓶/);
  assert.deepEqual(first.records, []);
  assert.equal(first.pending[0].time, '08:00');
  const second = say('母乳', { pending: first.pending });
  assert.deepEqual(second.records.map(({ kind, time }) => [kind, time]), [['nursing', '08:00']]);
  assert.match(say('母乳90毫升', { pending: first.pending }).question, /亲喂.*奶瓶/);
  assert.equal(say('早上8:00为了奶量做了笔记').pending.length, 0);
  const counted = say('早上8:00为了三瓶奶');
  assert.equal(counted.pending[0].time, '08:00');
  assert.match(counted.question, /实际喝下了多少毫升/);
  assert.deepEqual(counted.records, []);
});

test('结合上一句理解喂养口语，同时沿用日期和时间', () => {
  const { pending } = say('昨天早上八点喂了奶');
  for (const text of [
    '是用瓶子喝了三十毫升', '用瓶子味的喝了30毫升', '用了那个瓶子喂的，喝了30 mL', '用小瓶子喝了30cc',
  ]) {
    const result = say(text, { pending });
    assert.equal(result.question, '', text);
    assert.deepEqual(result.records.map(({ kind, date, time, ml }) => [kind, date, time, ml]), [
      ['bottle', '2026-11-22', '08:00', 30],
    ], text);
  }
  const bottle = say('那个瓶子的', { pending });
  assert.match(bottle.question, /多少毫升/);
  assert.equal(say('实际喝了三十', { pending: bottle.pending }).records[0].ml, 30);
  const nursing = say('直接吸的，吸了十分钟', { pending }).records[0];
  assert.deepEqual([nursing.kind, nursing.time, nursing.minutes], ['nursing', '08:00', 10]);
  const explicitMilk = say('刚才用瓶子喝了三十毫升奶').records[0];
  assert.deepEqual([explicitMilk.kind, explicitMilk.ml], ['bottle', 30]);
  assert.equal(say('刚刚含着奶头吸了十分钟').records[0].kind, 'nursing');
});

test('喂养上下文不会把不相干的量或事件当成奶量', () => {
  const { pending } = say('早上八点喂了奶');
  for (const text of [
    '用瓶子装了三十毫升', '用瓶子喝了三十毫升水', '用奶瓶喝了30毫升奶茶',
    '不是用瓶子喂的', '用瓶子喂三十毫升可以吗', '用瓶子喝了三十还是四十毫升',
    '刚刚拉了个软便', '吃了维生素AD一滴', '喝了30毫升',
  ]) {
    const result = say(text, { pending });
    assert.deepEqual(result.records, [], text);
    assert.ok(result.question, text);
    assert.equal(result.pending[0].time, '08:00', text);
  }
  assert.deepEqual(say('用瓶子喝了30毫升').records, []);
  const bottle = say('用瓶子喂的', { pending });
  assert.deepEqual(say('喝了三十毫升水', { pending: bottle.pending }).records, []);
  assert.equal(say('用了开塞露', { medicines: ['开塞露'] }).records[0].kind, 'dose');
});

test('提问、计划、否定、冲泡量及模糊时间不自动入账', () => {
  for (const phrase of [
    '维生素AD能不能吃一滴', '维生素AD吃不吃', '准备喂120毫升配方奶', '还没吃维生素K1',
    '冲了90毫升奶粉', '昨晚拉了两次软便', '上周五八点瓶喂90毫升', '今天晚上八点瓶喂90毫升',
    '八点瓶喂了90还是95毫升', '维生素AD', '。。。', '晚点喂70毫升配方奶',
    '明早八点瓶喂90毫升', '两天前八点瓶喂90毫升', '八点多瓶喂了90毫升', '还没尿尿',
  ]) {
    const result = say(phrase);
    assert.deepEqual(result.records, [], phrase);
    assert.ok(result.question, phrase);
  }
  const pending = say('用药了');
  assert.match(pending.question, /名称/);
  assert.match(say('一粒', { pending: pending.pending }).question, /名称/);
  assert.equal(say('锌补充剂', { pending: pending.pending }).records[0].name, '锌补充剂');
});
