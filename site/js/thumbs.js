// 缩略图独立存储。只有事务提交后才允许从 localStorage 删除旧副本。
const confirmed = new Map();
const pending = new Map();
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('babyrecord.thumbs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('thumbs');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('缩略图数据库被占用'));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}
export function hasStoredThumb(id, src) { return confirmed.get(id) === src; }
export async function readThumb(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('thumbs');
    const r = tx.objectStore('thumbs').get(id);
    r.onsuccess = () => { if (r.result) confirmed.set(id, r.result); resolve(r.result || ''); };
    r.onerror = () => reject(r.error);
  });
}
export function writeThumb(id, src) {
  if (!src || hasStoredThumb(id, src)) return Promise.resolve();
  const prev = pending.get(id);
  if (prev?.src === src) return prev.promise;
  const promise = (async () => {
    if (prev) await prev.promise.catch(() => {});
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('thumbs', 'readwrite');
      tx.objectStore('thumbs').put(src, id);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('缩略图写入失败'));
    });
    confirmed.set(id, src);
  })().finally(() => { if (pending.get(id)?.promise === promise) pending.delete(id); });
  pending.set(id, { src, promise });
  return promise;
}
export async function deleteThumb(id) {
  await pending.get(id)?.promise.catch(() => {});
  confirmed.delete(id);
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('thumbs', 'readwrite');
    tx.objectStore('thumbs').delete(id);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
