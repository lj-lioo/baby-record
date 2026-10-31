// v1.15.0：照片/视频保存均为缩略图，不下载原图。覆盖安卓下载、iPhone 两次手势、老人权限。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { albumHarness, addPhoto } from './support/album-harness.mjs';
const app = await albumHarness();
try {
  const page = await app.phone(); const photo = await addPhoto(page);
  await page.click('.album-cell'); await page.click('#avMenu');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#avDl')]);
  assert.match(dl.suggestedFilename(), /^朝朝_\d{8}_\d{6}_\w{4}\.jpg$/);
  const bytes = fs.readFileSync(await dl.path());
  const thumb = Buffer.from(photo.thumbData.split(',')[1], 'base64'); assert.deepEqual(bytes, thumb);
  assert.match(await page.locator('#avDlState').innerText(), /保存成功/);
  const ios = await app.phone({ role: '奶奶', photos: [{ ...photo, kind: 'video' }], share: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
  // 原视频地址故意不存在；即使无法播放，封面也能离线保存。
  await ios.route(`**/v1/file/${photo.id}?*`, (route) => route.abort());
  await ios.click('.album-cell'); await ios.click('#avMenu');
  assert.equal(await ios.locator('#avDel').count(), 0, '老人不能删除');
  await ios.click('#avDl'); assert.match(await ios.locator('#avDlState').innerText(), /再点一次/);
  await ios.click('#avDl');
  const shared = await ios.evaluate(() => window.__shared); assert.equal(shared.length, 1);
  assert.equal(shared[0].type, 'image/jpeg'); assert.deepEqual(Buffer.from(shared[0].bytes), thumb);
  assert.match(await ios.locator('#avDlState').innerText(), /保存成功/);
  await ios.click('#avShare'); assert.equal(await ios.evaluate(() => window.__shared.length), 2);
  assert.deepEqual(app.errors, []);
  console.log('download-ui：安卓与 iPhone 仅保存缩略图、视频封面、分享、老人权限通过');
} finally { await app.close(); }
