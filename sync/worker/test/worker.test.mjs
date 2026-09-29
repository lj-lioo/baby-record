// Worker 协议测试：先在 sync/worker 里运行 `npx wrangler dev --port 8788`，再 node test/worker.test.mjs
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(here, '../../../site/js/sync-core.js'))).toString('base64'));
const BASE = process.env.SYNC_BASE || 'http://127.0.0.1:8788';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.log('❌', name, '—', e.message); }
}
const post = (token, body, headers = {}) => fetch(`${BASE}/v1/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });

const keyA = core.newSyncKey();
const keyB = core.newSyncKey();
const A = await core.deriveKeys(keyA);
const B = await core.deriveKeys(keyB);
const T0 = Date.now();

await t('密钥格式 brs1_ + 43 位；可从整段文本中提取', async () => {
  assert.match(keyA, /^brs1_[A-Za-z0-9_-]{43}$/);
  assert.equal(core.extractSyncKey(`我的密钥：\n ${keyA} \n`), keyA);
  assert.equal(core.extractSyncKey('brs1_short'), '');
  assert.notEqual(A.token, B.token);
  assert.equal((await core.deriveKeys(keyA)).token, A.token);
});
await t('健康检查', async () => {
  const r = await fetch(`${BASE}/v1/health`); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
});
await t('CORS：允许 GitHub Pages 来源，拒绝其他来源', async () => {
  const ok = await fetch(`${BASE}/v1/sync`, { method: 'OPTIONS', headers: { Origin: 'https://lj-lioo.github.io' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://lj-lioo.github.io');
  const bad = await fetch(`${BASE}/v1/sync`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
await t('没有令牌 / 令牌格式错误 → 401', async () => {
  assert.equal((await post('', { since: 0 })).status, 401);
  assert.equal((await post('abc', { since: 0 })).status, 401);
});
await t('空空间：拉取为空，游标 0', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: 0, changes: [] });
  assert.deepEqual([r.cursor, r.changes.length, r.more], [0, 0, false]);
});

const ev1 = { id: 'e1', date: '2026-10-17', time: '09:00', title: '满月体检', category: 'checkup', updatedAt: T0 };
const ev2 = { id: 'e2', date: '2026-10-01', time: '', title: '🛒 买尿不湿', category: 'other', updatedAt: T0 };
const rec = async (K, ev, t = ev.updatedAt) => ({ id: 'ev:' + ev.id, updatedAt: t, deleted: false, data: await core.seal(K.enc, 'ev:' + ev.id, t, { type: 'event', event: { ...ev, updatedAt: t } }) });
let cursor1;
await t('提交 2 条（加密），全部接受并回传，游标递增', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: 0, changes: [await rec(A, ev1), await rec(A, ev2)] });
  assert.deepEqual(r.accepted.sort(), ['ev:e1', 'ev:e2']);
  assert.equal(r.changes.length, 2);
  assert.equal(r.cursor, 2);
  cursor1 = r.cursor;
  const back = await core.unseal(A.enc, r.changes[0].id, r.changes[0].updatedAt, r.changes[0].data);
  assert.equal(back.type, 'event');
  assert.ok(!r.changes[0].data.includes('体检') && !r.changes[0].data.includes('checkup'), '服务端只存密文');
});
await t('另一个密钥看不到这些数据（空间隔离），也解不开密文', async () => {
  const r = await core.syncRequest(BASE, B.token, { since: 0, changes: [] });
  assert.equal(r.changes.length, 0);
  const a = await core.syncRequest(BASE, A.token, { since: 0, changes: [] });
  await assert.rejects(core.unseal(B.enc, a.changes[0].id, a.changes[0].updatedAt, a.changes[0].data));
});
await t('篡改 updatedAt 后密文无法解密（附加认证数据）', async () => {
  const a = await core.syncRequest(BASE, A.token, { since: 0, changes: [] });
  await assert.rejects(core.unseal(A.enc, a.changes[0].id, a.changes[0].updatedAt + 1, a.changes[0].data));
});
await t('最后写入者胜：更旧的修改被拒绝，并返回服务端当前版本', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: cursor1, changes: [await rec(A, { ...ev1, title: '旧的' }, T0 - 1000)] });
  assert.deepEqual(r.accepted, []);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].updatedAt, T0);
  assert.equal(r.changes.length, 0, '没有新变更');
});
await t('相同 updatedAt 的重复提交不产生新变更', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: cursor1, changes: [await rec(A, ev1)] });
  assert.deepEqual([r.accepted.length, r.conflicts.length, r.changes.length], [0, 1, 0]);
});
let cursor2;
await t('更新的修改被接受；增量拉取只返回这一条', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: cursor1, changes: [await rec(A, { ...ev1, title: '满月体检（改到42天）' }, T0 + 1000)] });
  assert.deepEqual(r.accepted, ['ev:e1']);
  assert.equal(r.changes.length, 1);
  assert.equal(r.cursor, 3);
  cursor2 = r.cursor;
  const back = await core.unseal(A.enc, 'ev:e1', T0 + 1000, r.changes[0].data);
  assert.equal(back.event.title, '满月体检（改到42天）');
});
await t('删除用 tombstone 同步：data 为空，其他设备能收到', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: cursor2, changes: [{ id: 'ev:e2', updatedAt: T0 + 2000, deleted: true, data: null }] });
  assert.deepEqual(r.accepted, ['ev:e2']);
  const other = await core.syncRequest(BASE, A.token, { since: cursor2, changes: [] });
  assert.deepEqual(other.changes.map((c) => [c.id, c.deleted, c.data]), [['ev:e2', true, null]]);
  const full = await core.syncRequest(BASE, A.token, { since: 0, changes: [] });
  assert.equal(full.changes.length, 2, '全量拉取：1 条事项 + 1 条删除标记');
});
await t('旧设备的离线修改不会复活已删除的事项', async () => {
  const r = await core.syncRequest(BASE, A.token, { since: 0, changes: [await rec(A, ev2, T0 + 500)] });
  assert.deepEqual(r.accepted, []);
  assert.equal(r.conflicts[0].deleted, true);
});
await t('参数校验：非法 id / 删除带数据 / 超过 500 条', async () => {
  assert.equal((await post(A.token, { changes: [{ id: 'bad id!', updatedAt: 1, data: 'x' }] })).status, 400);
  assert.equal((await post(A.token, { changes: [{ id: 'ev:x', updatedAt: 1, deleted: true, data: 'x' }] })).status, 400);
  const many = Array.from({ length: 501 }, (_, i) => ({ id: `ev:m${i}`, updatedAt: 1, data: 'x' }));
  assert.equal((await post(A.token, { changes: many })).status, 413);
  assert.equal((await post(A.token, 'not json')).status, 400);
});
await t('分页：超过 500 条变更时 more=true，按游标继续拉取', async () => {
  const P = await core.deriveKeys(core.newSyncKey());
  const ch = Array.from({ length: 500 }, (_, i) => ({ id: `ev:p${i}`, updatedAt: T0, data: 'v1.x.y' }));
  await core.syncRequest(BASE, P.token, { changes: ch });
  await core.syncRequest(BASE, P.token, { changes: ch.slice(0, 20).map((c) => ({ ...c, id: c.id + 'b' })) });
  const r1 = await core.syncRequest(BASE, P.token, { since: 0 });
  assert.deepEqual([r1.changes.length, r1.more, r1.cursor], [500, true, 500]);
  const r2 = await core.syncRequest(BASE, P.token, { since: r1.cursor });
  assert.deepEqual([r2.changes.length, r2.more, r2.cursor], [20, false, 520]);
});
console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
