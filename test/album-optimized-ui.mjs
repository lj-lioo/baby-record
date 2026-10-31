// v1.15.0：增量节点、月份折叠、先缩略图后中图、放大原图、滑动/下拉、资源释放。
import assert from 'node:assert/strict';
import { albumHarness, addPhoto } from './support/album-harness.mjs';
const app = await albumHarness();
try {
  const page = await app.phone();
  const photo = await addPhoto(page);
  await page.locator('.album-cell').evaluate((el) => { window.__cell = el; window.__input = document.querySelector('#filePhotoAlbum'); });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const second = await addPhoto(page, { takenAt: yesterday.getTime() });
  assert.ok(await page.evaluate(() => window.__cell.isConnected && window.__input === document.querySelector('#filePhotoAlbum')), '上传保留已有格子和 input');
  await page.evaluate(async (photo) => {
    const { store } = await import('/js/store.js');
    store.applyRemote({ photosUpserts: [{ ...photo, note: '同步后的说明', updatedAt: Date.now() + 10 }] });
  }, photo);
  assert.ok(await page.evaluate(() => window.__cell.isConnected), '同步保留原节点');
  const old = new Date(); old.setMonth(old.getMonth() - 2, 10);
  await page.evaluate(async ({ photo, takenAt }) => {
    const { store } = await import('/js/store.js');
    store.applyRemote({ photosUpserts: Array.from({ length: 30 }, (_, i) => ({ ...photo, id: 'oldmonth' + i, takenAt: takenAt + i, remoteReady: false, mediumReady: false, thumbRemote: false })) });
  }, { photo, takenAt: old.getTime() });
  assert.equal(await page.locator('.album-month').count(), 1);
  assert.equal(await page.locator('.album-month .album-cell').count(), 0, '折叠时不创建历史格子');
  assert.equal(await page.locator('.album-collage img').count(), 4);
  assert.match(await page.locator('.album-month summary').innerText(), /30条记录/);
  await page.click('.album-month summary'); await page.waitForSelector('.album-month .album-cell');
  assert.equal(await page.locator('.album-month .album-cell').count(), 30);
  await page.click('.album-month summary');
  assert.equal(await page.locator('.album-month .album-cell').count(), 0);
  const family = await app.phone({ photos: [photo, second] });
  let release;
  const gate = new Promise((r) => { release = r; });
  await family.route('**/v1/file/*-m?*', async (r) => { await gate; await r.continue(); });
  await family.locator(`.album-cell[data-id="${photo.id}"]`).click();
  assert.match(await family.locator('#avImg img').getAttribute('src'), /^data:image/);
  assert.ok(!(await family.locator('.album-fullscreen').innerText()).includes('加载中'));
  assert.match(await family.locator('#avTitle').innerText(), /今天.*第\d+天/);
  release();
  await family.waitForFunction((id) => document.querySelector('#avImg img')?.src.includes(id + '-m'), photo.id);
  await family.locator('#avImg').dblclick();
  await family.waitForFunction((id) => document.querySelector('#avImg img')?.src.includes('/' + id + '?'), photo.id);
  assert.ok(Number(await family.locator('#avImg').getAttribute('data-scale')) > 1);
  await family.locator('#avImg').dblclick();
  const box = await family.locator('#avImg').boundingBox(); const cy = box.y + box.height / 2;
  const cdp = await family.context().newCDPSession(family);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: cy }, { x: 230, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: cy }, { x: 280, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(Number(await family.locator('#avImg').getAttribute('data-scale')) > 1, '双指捏合放大');
  await family.locator('#avImg').dblclick();
  await family.mouse.move(190, cy); await family.mouse.down(); await family.waitForTimeout(650); await family.mouse.up();
  assert.equal(await family.locator('#avActions').isVisible(), true, '长按打开底部菜单');
  await family.click('#avActionsClose');
  await family.mouse.move(310, cy); await family.mouse.down(); await family.mouse.move(70, cy, { steps: 8 }); await family.mouse.up();
  assert.match(await family.locator('#avTitle').innerText(), /昨天|月\d+日/);
  await family.click('#avClose'); await family.waitForSelector('.album-fullscreen', { state: 'detached' });
  // 本机尚未上传的原图仍需临时 blob URL；切换、关闭都必须释放。
  await page.evaluate(() => {
    window.__urls = []; window.__revoked = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = create(b); window.__urls.push(u); return u; };
    URL.revokeObjectURL = (u) => { window.__revoked.push(u); revoke(u); };
  });
  const local = await addPhoto(page, { upload: false, takenAt: Date.now() + 1000 });
  await page.locator(`.album-cell[data-id="${local.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#avImg img')?.src.startsWith('blob:'));
  await page.mouse.move(190, 220); await page.mouse.down(); await page.mouse.move(190, 390, { steps: 7 });
  assert.ok(await page.locator('.album-fullscreen').evaluate((el) => el.style.backgroundColor.startsWith('rgba')));
  await page.mouse.up(); await page.waitForSelector('.album-fullscreen', { state: 'detached' });
  assert.ok(await page.evaluate(() => window.__urls.every((u) => window.__revoked.includes(u))), '关闭释放全部临时 URL');
  assert.deepEqual(app.errors, []);
  console.log('album-optimized-ui：增量、月份卡片、中图/原图、标题/滑动、下拉、URL 释放通过');
} finally { await app.close(); }
