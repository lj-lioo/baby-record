import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { fakeIndexedDB } from './support/idb.mjs';
const dirs = [];
const tick = () => new Promise((r) => setTimeout(r, 25));
async function setup(photos = [], failWrites = false, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-storage-')); dirs.push(dir);
  fs.cpSync(new URL('../site/js/', import.meta.url), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const values = new Map([['babyrecord.v1', JSON.stringify({ events: [], photos, settings })]]);
  globalThis.localStorage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
  globalThis.indexedDB = fakeIndexedDB({ failWrites });
  globalThis.crypto ||= webcrypto;
  globalThis.window = { BABY_CONFIG: { syncApi: 'https://sync.test', photoApi: 'https://photo.test' }, dispatchEvent() {} };
  globalThis.CustomEvent ||= class { constructor(type, data) { this.type = type; this.detail = data?.detail; } };
  const mod = (name) => import(pathToFileURL(path.join(dir, name)).href);
  const { store } = await mod('store.js'); await tick();
  return { store, mod, values, saved: () => JSON.parse(values.get('babyrecord.v1')), db: indexedDB };
}
const thumb = 'data:image/jpeg;base64,' + Buffer.alloc(48000, 7).toString('base64');
try {
  await test('旧 base64 事务提交后迁入 IDB，元数据和导出仍保留图片', async () => {
    const x = await setup([{ id: 'old123xyz', thumbData: thumb, takenAt: 1 }]);
    assert.equal(x.saved().photos[0].thumbData, '');
    assert.equal(await (await x.mod('thumbs.js')).readThumb('old123xyz'), thumb);
    assert.equal(x.store.getPhoto('old123xyz').thumbData, thumb);
    assert.equal(JSON.parse(x.store.exportJSON()).data.photos[0].thumbData, thumb);
    x.store.updateSettings({ sound: false }); await tick();
    assert.ok(x.values.get('babyrecord.v1').length < 2000);
    x.store.applyRemote({ photosUpserts: [{ ...x.store.getPhoto('old123xyz'), thumbData: '', note: '来自家人', updatedAt: 99 }] });
    assert.equal(x.store.getPhoto('old123xyz').thumbData, thumb);
    x.store.deletePhoto('old123xyz'); await tick();
    assert.equal(await (await x.mod('thumbs.js')).readThumb('old123xyz'), '');
  });
  await test('IDB 迁移失败保留 localStorage 完整缩略图；后续修改不丢失', async () => {
    const x = await setup([{ id: 'fail123xyz', thumbData: thumb, takenAt: 1 }], true);
    assert.equal(x.saved().photos[0].thumbData, thumb);
    x.store.updateSettings({ sound: false }); await tick();
    assert.equal(x.saved().photos[0].thumbData, thumb);
  });
  await test('刷新后从 IDB 还原缩略图，不改变记录 updatedAt', async () => {
    const x = await setup([], false);
    await (await x.mod('thumbs.js')).writeThumb('reload123', thumb);
    x.store.importJSON(JSON.stringify({ events: [], photos: [{ id: 'reload123', thumbData: '', takenAt: 1, updatedAt: 42 }] }));
    await tick();
    assert.equal(x.store.getPhoto('reload123').thumbData, thumb);
    assert.equal(x.store.getPhoto('reload123').updatedAt, 42);
  });
  await test('原生媒体优先中图/Range URL，放大用原图；HEIC 用 JPEG 中图；令牌仅用于照片服务', async () => {
    const x = await setup([], false, { photoToken: 'only-test-token' });
    const P = await x.mod('photos.js');
    const p = { id: 'source123', remoteReady: true, storage: 'file', mediumReady: true, kind: 'photo', mime: 'image/heic' };
    assert.match((await P.viewerSource(p)).url, /source123-m\?access_token=only-test-token$/);
    assert.match((await P.viewerSource(p, true)).url, /source123\?access_token=only-test-token$/);
    assert.match((await P.viewerSource({ ...p, kind: 'video' })).url, /source123\?access_token=/);
    assert.equal(P.UPLOAD_CHUNK, 256 * 1024);
  });
  await test('先入库缩略图，后台才生成 1280 中图并分块传原图，不读原图整文件 arrayBuffer', async () => {
    const x = await setup([]); const P = await x.mod('photos.js');
    const sizes = [], canvases = [];
    const realFetch = globalThis.fetch;
    globalThis.createImageBitmap = async () => ({ width: 3200, height: 2400, close() {} });
    globalThis.document = { createElement() { const c = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL() { canvases.push([c.width, c.height]); return 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64'); } }; return c; } };
    globalThis.fetch = (url, opts = {}) => { if (String(url).startsWith('data:')) return realFetch(url, opts); sizes.push(opts.body.byteLength); return Promise.resolve(Response.json({ ok: true })); };
    try {
      const file = new Blob([Buffer.alloc(700000, 9)], { type: 'image/jpeg' });
      file.name = 'sample.jpg'; file.lastModified = 123;
      file.arrayBuffer = () => { throw new Error('不得整文件读取'); };
      let seenLocal = false;
      const { photo } = await P.addPhotoFromFile(file, { upload: false, onLocalReady(p) { seenLocal = true; assert.equal(p.remoteReady, false); assert.ok(p.thumbData); assert.equal(sizes.length, 0); } });
      assert.ok(seenLocal); assert.deepEqual(canvases, [[400, 300]]); assert.equal(sizes.length, 0);
      await P.retryUpload(photo.id); await tick();
      assert.deepEqual(canvases, [[400, 300], [1280, 960]]);
      assert.equal(x.store.getPhoto(photo.id).storage, 'file'); assert.ok(x.store.getPhoto(photo.id).mediumReady);
      assert.deepEqual(sizes, [100, 100, 262144, 262144, 175712]);
    } finally { globalThis.fetch = realFetch; delete globalThis.document; delete globalThis.createImageBitmap; }
  });
  await test('后台上传时删除：停止后续分块，已删除的记录不会被异步回调复活', async () => {
    const x = await setup([]); const P = await x.mod('photos.js'); const realFetch = globalThis.fetch;
    globalThis.createImageBitmap = async () => ({ width: 1600, height: 1200, close() {} });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,YWJj' }) };
    let release, started;
    const began = new Promise((r) => { started = r; });
    const wait = new Promise((r) => { release = r; });
    let puts = 0;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('data:')) return realFetch(url, opts);
      if (opts.method === 'PUT') { puts++; started(); await wait; }
      return Response.json({ ok: true });
    };
    try {
      const file = new Blob([Buffer.alloc(700000)], { type: 'image/jpeg' }); file.name = 'sample.jpg';
      const { photo } = await P.addPhotoFromFile(file, { upload: false });
      const uploading = P.retryUpload(photo.id); const rejected = assert.rejects(uploading, /已删除/);
      await began;
      const removal = P.removePhoto(photo.id);
      assert.equal(x.store.getPhoto(photo.id), undefined);
      release(); await rejected; await removal; await tick();
      assert.equal(x.store.photos().length, 0); assert.equal(puts, 1);
    } finally { release(); globalThis.fetch = realFetch; delete globalThis.document; delete globalThis.createImageBitmap; }
  });
  await test('亲友硬约束：四种老人可上传/下载，不可新增修改事项或删除照片', async () => {
    const x = await setup([]); const R = await x.mod('roles.js');
    for (const role of ['爷爷', '奶奶', '姥姥', '姥爷']) {
      x.store.updateSettings({ memberRole: role });
      assert.equal(R.canEditEvents(), false); assert.equal(R.canEditPlans(), false); assert.equal(R.canDeleteAlbum(), false);
      assert.equal(R.canUploadAlbum(), true); assert.equal(R.canDownloadAlbum(), true);
    }
    await tick();
  });
  await test('大缩略图原质量单独分块上传；Worker 密文小于 32KB，失败不降低画质', async () => {
    const x = await setup([{ id: 'sync123xyz', thumbData: thumb, takenAt: 1 }], false, { photoToken: 'only-test-token' });
    const originalFetch = globalThis.fetch; const puts = []; const records = [];
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('data:')) return originalFetch(url, opts);
      if (String(url).startsWith('https://photo.test/')) { puts.push({ url, size: opts.body.length, auth: new Headers(opts.headers).get('authorization') }); return Response.json({ ok: true }); }
      const body = JSON.parse(opts.body); records.push(...body.changes);
      return Response.json({ accepted: body.changes.map((c) => c.id), cursor: records.length, changes: [] });
    };
    try {
      const S = await x.mod('sync.js'); await S.enableSync(); await tick();
      assert.equal(puts.length, 1); assert.equal(puts[0].size, 48000);
      assert.match(puts[0].url, /sync123xyz-t\/0\?/); assert.equal(puts[0].auth, 'Bearer only-test-token');
      const ph = records.find((r) => r.id === 'ph:sync123xyz');
      assert.ok(ph.data.length < 32 * 1024);
      const core = await x.mod('sync-core.js'); const { enc } = await core.deriveKeys(S.syncStatus().key);
      const obj = await core.unseal(enc, ph.id, ph.updatedAt, ph.data);
      assert.equal(obj.photo.thumbData, ''); assert.equal(obj.photo.thumbRemote, true);
      assert.equal(x.store.getPhoto('sync123xyz').thumbData, thumb);
      await S.syncNow(); assert.equal(puts.length, 1);
      const larger = 'data:image/jpeg;base64,' + Buffer.alloc(700000, 6).toString('base64');
      x.store.upsertPhoto({ id: 'chunk123xyz', thumbData: larger }); await tick();
      await (await x.mod('photos.js')).ensureRemoteThumb(x.store.getPhoto('chunk123xyz'));
      assert.equal(puts.length, 4); assert.ok(puts.every((p) => p.size <= 512 * 1024));
      globalThis.fetch = async () => { throw new Error('offline'); };
      x.store.upsertPhoto({ id: 'offline123', thumbData: thumb }); await tick();
      await assert.rejects((await x.mod('photos.js')).ensureRemoteThumb(x.store.getPhoto('offline123')));
      assert.equal(x.store.getPhoto('offline123').thumbData, thumb);
      assert.equal(x.store.getPhoto('offline123').thumbRemote, false);
    } finally { globalThis.fetch = originalFetch; }
  });
} finally { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); }
