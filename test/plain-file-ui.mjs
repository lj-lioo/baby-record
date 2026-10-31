// v1.15.0：原片明文、400/1280 两档派生图、256KB 分块；旧密文仅解密读取，不转换。
import assert from 'node:assert/strict';
import { albumHarness } from './support/album-harness.mjs';
const app = await albumHarness();
try {
  const page = await app.phone();
  const r = await page.evaluate(async () => {
    const P = await import('/js/photos.js'); const { store } = await import('/js/store.js');
    const c = document.createElement('canvas'); c.width = 1800; c.height = 1400;
    const x = c.getContext('2d'), pixels = x.createImageData(c.width, c.height);
    for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = (Math.random() * 255) | 0; pixels.data[i + 1] = (Math.random() * 255) | 0; pixels.data[i + 2] = 80; pixels.data[i + 3] = 255; }
    x.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    const original = new Uint8Array(await blob.arrayBuffer());
    const putSizes = [];
    const realFetch = window.fetch;
    window.fetch = (url, opts = {}) => { if (opts.method === 'PUT') putSizes.push(opts.body.byteLength || opts.body.size); return realFetch(url, opts); };
    const { photo, uploadError } = await P.addPhotoFromFile(new File([blob], 'photo.png', { type: 'image/png' }));
    if (uploadError) throw new Error(uploadError);
    const back = new Uint8Array(await (await fetch(P.mediaUrl(photo.id))).arrayBuffer());
    const medium = await createImageBitmap(await (await fetch(P.mediaUrl(photo.id + '-m'))).blob());
    const thumb = await createImageBitmap(await (await fetch(P.mediaUrl(photo.id + '-t'))).blob());
    const dimensions = { medium: Math.max(medium.width, medium.height), thumb: Math.max(thumb.width, thumb.height) }; medium.close(); thumb.close();
    const core = await import('/js/sync-core.js'); const S = await import('/js/sync.js');
    await S.enableSync(); const { enc } = await core.deriveKeys(S.syncStatus().key);
    const lid = 'legacy123xyz', count = Math.ceil(original.length / P.UPLOAD_CHUNK);
    for (let n = 0; n < count; n++) {
      const packed = await core.sealBytes(enc, `${lid}:${n}`, original.subarray(n * P.UPLOAD_CHUNK, (n + 1) * P.UPLOAD_CHUNK));
      await fetch(`${P.photoApiBase()}/v1/video/${lid}/${n}`, { method: 'PUT', headers: { Authorization: 'Bearer ui-test-token' }, body: packed });
    }
    store.upsertPhoto({ id: lid, mime: 'image/png', storage: 'chunks', remoteReady: true, chunks: count, thumbData: photo.thumbData });
    const legacy = new Uint8Array(await (await P.loadPhotoBlob(lid)).blob.arrayBuffer());
    const legacyStorage = store.getPhoto(lid).storage;
    const notConverted = (await fetch(P.mediaUrl(lid))).status;
    await P.removePhoto(photo.id);
    const gone = await Promise.all(['', '-m', '-t'].map(async (suffix) => (await fetch(P.mediaUrl(photo.id + suffix))).status));
    window.fetch = realFetch;
    return { storage: photo.storage, same: original.length === back.length && original.every((v, i) => v === back[i]), dimensions, putSizes, legacySame: original.length === legacy.length && original.every((v, i) => v === legacy[i]), legacyStorage, notConverted, gone };
  });
  assert.equal(r.storage, 'file'); assert.ok(r.same);
  assert.deepEqual(r.dimensions, { medium: 1280, thumb: 400 });
  assert.ok(r.putSizes.length > 3 && r.putSizes.every((n) => n <= 512 * 1024));
  assert.ok(r.legacySame); assert.equal(r.legacyStorage, 'chunks'); assert.equal(r.notConverted, 404);
  assert.deepEqual(r.gone, [404, 404, 404]); assert.deepEqual(app.errors, []);
  console.log('plain-file-ui：明文原片逐字节一致、1280/400、分块上限、旧密文不转换、派生图删除通过');
} finally { await app.close(); }
