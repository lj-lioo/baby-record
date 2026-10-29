// 相册协议/工具单测：node test/photos.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import { webcrypto } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-ph-'));
for (const f of ['sync-core.js']) fs.copyFileSync(path.join(here, '../site/js', f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const core = await import(pathToFileURL(path.join(tmp, 'sync-core.js')).href);

let pass = 0;
const t = (name, fn) => { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { pass++; console.log('✅', name); }); pass++; console.log('✅', name); };

await t('PHOTO_PREFIX / keyFingerprint', () => {
  assert.equal(core.PHOTO_PREFIX, 'ph:');
  const k = core.newSyncKey();
  assert.match(k, /^brs1_/);
  const fp = core.keyFingerprint(k);
  assert.ok(fp.includes('…'));
  assert.ok(!fp.includes(k.slice(10, 20))); // 不泄露中间段
});

await t('sealBytes / unsealBytes 往返', async () => {
  const key = core.newSyncKey();
  const { enc } = await core.deriveKeys(key);
  const id = 'photoTest1';
  const plain = new Uint8Array([0, 1, 2, 3, 250, 255, 10, 11]);
  const packed = await core.sealBytes(enc, id, plain);
  assert.ok(packed.byteLength > plain.byteLength);
  const out = await core.unsealBytes(enc, id, packed);
  assert.deepEqual([...out], [...plain]);
});

await t('错误 id 的 AAD 解不开', async () => {
  const key = core.newSyncKey();
  const { enc } = await core.deriveKeys(key);
  const packed = await core.sealBytes(enc, 'id-a', new Uint8Array([9, 9, 9]));
  let failed = false;
  try { await core.unsealBytes(enc, 'id-b', packed); } catch { failed = true; }
  assert.equal(failed, true);
});

await t('照片元数据 seal 进同步记录', async () => {
  const key = core.newSyncKey();
  const { enc } = await core.deriveKeys(key);
  const rid = core.PHOTO_PREFIX + 'abc';
  const photo = { id: 'abc', takenAt: 1, uploadedAt: 2, note: '笑', mime: 'image/jpeg', size: 12, thumbData: 'data:image/jpeg;base64,xx', remoteReady: true, updatedAt: 99 };
  const data = await core.seal(enc, rid, photo.updatedAt, { type: 'photo', photo });
  const obj = await core.unseal(enc, rid, photo.updatedAt, data);
  assert.equal(obj.type, 'photo');
  assert.equal(obj.photo.note, '笑');
  assert.equal(obj.photo.remoteReady, true);
});

console.log(`\nphotos.test ${pass}/4`);
