// v1.8.0 相册：缩略图、本机缓存、加密上传到极空间照片服务
// 原图 AES-GCM 加密后 PUT；元数据（含缩略图 data URL）走现有云同步。
import { store, uid } from './store.js';
import * as core from './sync-core.js';
import { syncStatus } from './sync.js';

const IDB_NAME = 'babyrecord.photos';
const IDB_STORE = 'blobs';
const THUMB_MAX = 400;
const THUMB_QUALITY = 0.72;

export function photoApiBase() {
  return String(store.state.settings.photoApi || '').trim().replace(/\/+$/, '');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
}

async function idbPut(id, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbDel(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function makeThumb(fileOrBlob, max = THUMB_MAX) {
  const bmp = await createImageBitmap(fileOrBlob);
  try {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
    return { dataUrl, width: bmp.width, height: bmp.height, tw: w, th: h };
  } finally {
    bmp.close?.();
  }
}

async function getEncKey() {
  const st = syncStatus();
  if (!st.enabled || !st.key) throw new Error('请先开启云同步（相册原图用同步密钥加密）');
  const { enc } = await core.deriveKeys(st.key);
  return enc;
}

function corsHeaders() {
  // 仅客户端；服务端决定 CORS。这里不附带敏感头。
  return {};
}

export async function putEncryptedPhoto(id, packedBytes) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  const res = await fetch(`${base}/v1/photo/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...corsHeaders() },
    body: packedBytes,
  });
  if (!res.ok) throw new Error(`照片服务返回 ${res.status}`);
  return true;
}

export async function fetchEncryptedPhoto(id) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  const res = await fetch(`${base}/v1/photo/${encodeURIComponent(id)}`, { method: 'GET' });
  if (res.status === 404) throw new Error('照片服务上找不到这张原图');
  if (!res.ok) throw new Error(`照片服务返回 ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteRemotePhoto(id) {
  const base = photoApiBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/v1/photo/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function pingPhotoServer(baseUrl) {
  const base = String(baseUrl || photoApiBase()).replace(/\/+$/, '');
  if (!base) return { ok: false, message: '地址为空' };
  try {
    const res = await fetch(`${base}/health`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    let j = null;
    try { j = await res.json(); } catch { /* ignore */ }
    return { ok: true, message: (j && j.service) || 'ok' };
  } catch (e) {
    return { ok: false, message: e.message || '连不上' };
  }
}

/** 选图/拍照后入库：写元数据+缩略图，本机缓存原图，有照片服务则加密上传 */
export async function addPhotoFromFile(file, { note = '', takenAt } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('请选择图片文件');
  const id = uid();
  const taken = takenAt || (file.lastModified ? Number(file.lastModified) : Date.now());
  const { dataUrl, width, height } = await makeThumb(file);
  const buf = new Uint8Array(await file.arrayBuffer());
  await idbPut(id, { plain: buf, mime: file.type || 'image/jpeg', savedAt: Date.now() });

  let remoteReady = false;
  let uploadError = '';
  if (photoApiBase()) {
    try {
      const enc = await getEncKey();
      const packed = await core.sealBytes(enc, id, buf);
      await putEncryptedPhoto(id, packed);
      remoteReady = true;
    } catch (e) {
      uploadError = e.message || String(e);
      console.warn('原图上传失败（元数据仍会同步）', core.keyFingerprint?.(syncStatus().key), e);
    }
  }

  const photo = store.upsertPhoto({
    id,
    takenAt: taken,
    uploadedAt: Date.now(),
    note,
    mime: file.type || 'image/jpeg',
    size: buf.byteLength,
    width,
    height,
    thumbData: dataUrl,
    remoteReady,
  });
  return { photo, uploadError, needsPhotoApi: !photoApiBase() };
}

/** 打开大图：优先本机明文缓存 → 从照片服务拉密文解密 → 仅缩略图 */
export async function loadPhotoBlob(id) {
  const meta = store.getPhoto(id);
  if (!meta) throw new Error('照片不存在');

  const cached = await idbGet(id);
  if (cached?.plain) {
    return { blob: new Blob([cached.plain], { type: cached.mime || meta.mime }), source: 'local' };
  }

  if (!photoApiBase()) {
    if (meta.thumbData) {
      const r = await fetch(meta.thumbData);
      return { blob: await r.blob(), source: 'thumb', tip: '未配置照片服务，只能看缩略图。在设置里填极空间照片服务地址后才能看原图。' };
    }
    throw new Error('本机没有这张图的缓存，且未配置照片服务');
  }

  const enc = await getEncKey();
  const packed = await fetchEncryptedPhoto(id);
  const plain = await core.unsealBytes(enc, id, packed);
  await idbPut(id, { plain, mime: meta.mime, savedAt: Date.now() });
  return { blob: new Blob([plain], { type: meta.mime }), source: 'remote' };
}

/** 删除：元数据 tombstone（同步层）、本机缓存、尽量删远程密文 */
export async function removePhoto(id) {
  await idbDel(id).catch(() => {});
  await deleteRemotePhoto(id);
  store.deletePhoto(id);
}

/** 有地址但 remoteReady=false 时，用本机缓存补传 */
export async function retryUpload(id) {
  const meta = store.getPhoto(id);
  if (!meta) throw new Error('照片不存在');
  if (!photoApiBase()) throw new Error('请先填写照片服务地址');
  const cached = await idbGet(id);
  if (!cached?.plain) throw new Error('本机没有原图缓存，无法补传（需在拍照的那台设备上操作）');
  const enc = await getEncKey();
  const packed = await core.sealBytes(enc, id, cached.plain);
  await putEncryptedPhoto(id, packed);
  store.upsertPhoto({ ...meta, remoteReady: true });
}

export function photosByDay(list = store.photos()) {
  const alive = [...list].sort((a, b) => b.takenAt - a.takenAt);
  const groups = [];
  const map = new Map();
  for (const p of alive) {
    const d = new Date(p.takenAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) {
      const g = { day: key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    map.get(key).items.push(p);
  }
  return groups;
}

export function fmtDayTitle(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const ymdY = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  if (ymd === today) return '今天';
  if (ymd === ymdY) return '昨天';
  if (y === now.getFullYear()) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}
