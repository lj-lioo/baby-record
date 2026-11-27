import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAlarmCallback, deliverAlarmCallback, listenForAlarmCallbacks, alarmCallbackReady, alarmCallbackStatus } from '../site/js/alarm-callback.js';

test('test receipt travels between browser and home-screen storage without event data', async (t) => {
  const slots = new Map();
  const requests = [];
  const local = new Map();
  const isolated = new Map();
  const use = (map) => { globalThis.localStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }; };
  globalThis.window = new EventTarget();
  window.BABY_CONFIG = { syncApi: 'https://relay.example' };
  globalThis.document = new EventTarget();
  globalThis.location = new URL('https://example.test/baby-record/#/settings');
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, request) => {
    assert.equal(url, 'https://relay.example/v1/sync');
    const token = request.headers.Authorization;
    const { changes } = JSON.parse(request.body);
    requests.push(changes);
    const change = changes[0];
    const previous = slots.get(token);
    const accepted = change && (!previous || previous.updatedAt < change.updatedAt);
    if (accepted) slots.set(token, change);
    return Response.json({ accepted: accepted ? [change.id] : [], changes: slots.has(token) ? [slots.get(token)] : [] });
  };

  const name = '宝宝闹钟仅创建';
  use(local);
  assert.equal(alarmCallbackReady(name), false);
  const probe = startAlarmCallback({ name });
  assert.equal(alarmCallbackStatus(name), '等待测试回执');
  use(isolated);
  const cbUrl = new URL(probe.url);
  cbUrl.searchParams.set('result', 'BABY_ALARM_OK');
  assert.deepEqual(await deliverAlarmCallback(cbUrl), { test: true });
  assert.equal(isolated.size, 0);
  use(local);
  const probeResult = await new Promise((resolve) => listenForAlarmCallbacks((attempt, safe) => resolve({ attempt, safe })));
  assert.equal(probeResult.safe, true);
  assert.equal(probeResult.attempt.nonce, probe.nonce);
  assert.equal(alarmCallbackReady(name), true);
  assert.equal(alarmCallbackReady('另一条指令'), false);

  const arm = startAlarmCallback({ name, id: 'local-item', sig: 'local-signature' });
  assert.doesNotMatch(arm.url, /local-item|local-signature/);
  use(isolated);
  const resultUrl = new URL(arm.url + '?result=' + encodeURIComponent('宝宝真实提醒会出现在这里'));
  await deliverAlarmCallback(resultUrl);
  use(local);
  const result = await new Promise((resolve) => listenForAlarmCallbacks((attempt, safe) => resolve({ attempt, safe })));
  assert.equal(result.attempt.id, 'local-item');
  assert.equal(result.safe, false);
  assert.equal(alarmCallbackReady(name), false);
  assert.doesNotMatch(JSON.stringify(requests), /local-item|local-signature|宝宝真实提醒/);
  assert.equal(slots.size, 1);
  await assert.rejects(deliverAlarmCallback(new URL('https://example.test/baby-record/alarm-callback.html')), /过期或无效/);
});
