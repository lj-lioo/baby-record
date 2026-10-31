// v1.15.0：明文视频直接 Range URL，静音自动播放、进度条/全屏；保存只存封面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { albumHarness, expandMonths } from './support/album-harness.mjs';
const app = await albumHarness();
try {
  const page = await app.phone();
  const file = process.env.VIDEO || '/tmp/bv.webm'; assert.ok(fs.existsSync(file), '需要 VIDEO 视频样本');
  await page.setInputFiles('#filePhotoAlbum', file);
  await page.waitForFunction(async () => { const { store } = await import('/js/store.js'); return store.photos()[0]?.remoteReady; }, null, { timeout: 90000 });
  await expandMonths(page);
  assert.match(await page.locator('.album-play').innerText(), /▶ \d+:\d{2}/);
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).photos[0]);
  assert.equal(meta.storage, 'file'); assert.equal(meta.thumbData, ''); assert.equal(meta.thumbRemote, true);
  await page.evaluate(async () => { await (await import('/js/photos.js')).clearVideoCache(); });
  const reqs = []; page.on('request', (r) => { if (r.url().includes('/v1/')) reqs.push({ url: r.url(), method: r.method(), headers: r.headers() }); });
  await page.click('.album-cell'); await page.waitForSelector('#avImg video');
  const v = await page.locator('#avImg video').evaluate((v) => ({ src: v.src, muted: v.muted, autoplay: v.autoplay, controls: v.controls, inline: v.playsInline }));
  assert.match(v.src, new RegExp(`/v1/file/${meta.id}\\?access_token=`));
  assert.ok(v.muted && v.autoplay && v.controls && v.inline);
  await page.waitForFunction(() => document.querySelector('#avImg video')?.videoWidth > 0);
  assert.ok(!reqs.some((r) => r.url.includes('/v1/video/')));
  assert.ok(reqs.some((r) => r.headers.range), '浏览器以 Range 读取视频');
  assert.equal(await page.locator('#avFullscreen').count(), 1);
  await page.click('#avMenu'); assert.equal(await page.locator('#avDl').innerText(), '📥 保存到相册');
  await page.click('#avDel'); await page.click('#sheet [data-a=yes]');
  await page.waitForSelector('.album-fullscreen', { state: 'detached' });
  const missing = await page.evaluate(async (id) => { const { mediaUrl } = await import('/js/photos.js'); return (await fetch(mediaUrl(id))).status; }, meta.id);
  assert.equal(missing, 404);
  assert.deepEqual(app.errors, []);
  console.log('video-ui：Range 直连、静音自动播放、原生进度条、全屏入口、封面保存入口、删除通过');
} finally { await app.close(); }
