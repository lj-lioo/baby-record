import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretCareSpeech } from '../site/js/care-voice.js';

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
