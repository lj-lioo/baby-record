// v1.8.0 相册：缩略图、本机缓存、加密上传到极空间照片服务
// 原图 AES-GCM 加密后 PUT；元数据（含缩略图 data URL）走现有云同步。
import { store, uid } from './store.js';
import * as core from './sync-core.js';
import { syncStatus } from './sync.js';
import { daysBetween } from './dates.js';

const IDB_NAME = 'babyrecord.photos';
const IDB_STORE = 'blobs';
const THUMB_MAX = 400;
const THUMB_QUALITY = 0.72;

export function photoApiBase() {
  const fromSettings = String(store.state.settings.photoApi || '').trim();
  const fromConfig = String(typeof window !== 'undefined' && window.BABY_CONFIG?.photoApi || '').trim();
  return (fromSettings || fromConfig).replace(/\/+$/, '');
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

async function makeThumbViaImg(file, max = THUMB_MAX) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return { dataUrl: c.toDataURL('image/jpeg', THUMB_QUALITY), width: img.naturalWidth, height: img.naturalHeight, tw: w, th: h };
  } finally { URL.revokeObjectURL(url); }
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

/** HTTPS 页面（如 GitHub Pages）禁止 fetch 局域网 http，会直接 Load failed；Safari 顶栏打开 http 不受此限 */
export function photoApiBlockedByMixedContent(baseUrl, pageProtocol) {
  const base = String(baseUrl || photoApiBase() || '').trim();
  const proto = pageProtocol != null ? pageProtocol : (typeof location !== 'undefined' ? location.protocol : '');
  return proto === 'https:' && /^http:\/\//i.test(base);
}

export async function pingPhotoServer(baseUrl) {
  const base = String(baseUrl || photoApiBase()).replace(/\/+$/, '');
  if (!base) return { ok: false, message: '地址为空' };
  if (photoApiBlockedByMixedContent(base)) {
    return {
      ok: false,
      code: 'mixed_content',
      message: '浏览器安全限制：HTTPS 的 App 不能连接局域网 http（Safari 直接打开可以，App 里不行）。照片服务需 HTTPS 地址（域名 + Cloudflare Tunnel 指到极空间），不能只用 http://192.168.x.x',
    };
  }
  try {
    const res = await fetch(`${base}/health`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    let j = null;
    try { j = await res.json(); } catch { /* ignore */ }
    return { ok: true, message: (j && j.service) || 'ok' };
  } catch (e) {
    const m = e && e.message ? String(e.message) : '连不上';
    if (/failed to fetch|load failed|networkerror|network error/i.test(m) && /^http:\/\//i.test(base)
        && typeof location !== 'undefined' && location.protocol === 'https:') {
      return {
        ok: false,
        code: 'mixed_content',
        message: '连不上（多半是 HTTPS→HTTP 被浏览器拦截）。请给照片服务配 HTTPS（域名 + Tunnel），不要只用局域网 http',
      };
    }
    return { ok: false, message: m };
  }
}

/** 本机「上传中」状态（不同步）：缩略图先入库后角标用 */
const uploadingIds = new Set();
export function isUploading(id) { return uploadingIds.has(id); }
function markUploading(id, on) {
  if (on) uploadingIds.add(id); else uploadingIds.delete(id);
}

/** 选图/拍照后入库：先写缩略图+本机缓存立刻可见，再后台加密上传原图 */
export async function addPhotoFromFile(file, { note = '', takenAt, onLocalReady, onProgress } = {}) {
  const isImg = String(file?.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|gif|webp)$/i.test(file?.name || '');
  if (!file || !isImg) throw new Error('请选择图片文件');
  const id = uid();
  const taken = takenAt || (file.lastModified ? Number(file.lastModified) : Date.now());
  let thumb;
  try { thumb = await makeThumb(file); }
  catch { thumb = await makeThumbViaImg(file).catch(() => { throw new Error('这张图片格式无法读取（可在 iPhone 设置→相机→格式 选「兼容性最佳」）'); }); }
  const { dataUrl, width, height } = thumb;
  const buf = new Uint8Array(await file.arrayBuffer());
  await idbPut(id, { plain: buf, mime: file.type || 'image/jpeg', savedAt: Date.now() });

  // 先入库（remoteReady=false），时间轴立刻能看到缩略图；有照片服务则先标「上传中」
  const willUpload = !!photoApiBase();
  if (willUpload) markUploading(id, true);
  let photo = store.upsertPhoto({
    id,
    takenAt: taken,
    uploadedAt: Date.now(),
    note,
    mime: file.type || 'image/jpeg',
    size: buf.byteLength,
    width,
    height,
    thumbData: dataUrl,
    remoteReady: false,
  });
  onLocalReady?.(photo);
  onProgress?.({ phase: willUpload ? 'upload' : 'local', id });

  let remoteReady = false;
  let uploadError = '';
  if (willUpload) {
    try {
      const enc = await getEncKey();
      const packed = await core.sealBytes(enc, id, buf);
      await putEncryptedPhoto(id, packed);
      remoteReady = true;
      photo = store.upsertPhoto({ ...store.getPhoto(id), remoteReady: true });
      onProgress?.({ phase: 'done', id });
    } catch (e) {
      uploadError = e.message || String(e);
      console.warn('原图上传失败（元数据仍会同步）', core.keyFingerprint?.(syncStatus().key), e);
      onProgress?.({ phase: 'error', id, error: uploadError });
    } finally {
      markUploading(id, false);
    }
  }
  return { photo: store.getPhoto(id) || photo, uploadError, needsPhotoApi: !photoApiBase() };
}

// ───────── v1.10.0 视频 ─────────
export const VIDEO_CHUNK = 4 * 1024 * 1024; // 每块明文 4MB，单独 AES-GCM（AAD = id:n），iPhone 不用整段读进内存
export function videoMaxBytes() { return Math.max(10, Number(store.state.settings.videoMaxMB) || 200) * 1024 * 1024; }
export function videoCacheBytes() { return Math.max(50, Number(store.state.settings.videoCacheMB) || 500) * 1024 * 1024; }
const vkey = (id) => `v:${id}`;

/** 用 <video>+canvas 取首帧做封面；失败则给一张深色占位图 */
export function makeVideoThumb(file, max = THUMB_MAX) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); v.load?.(); resolve(r); };
    const fallback = () => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 320;
      const x = c.getContext('2d'); x.fillStyle = '#2a1f24'; x.fillRect(0, 0, 320, 320);
      x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('▶', 165, 165);
      finish({ dataUrl: c.toDataURL('image/jpeg', THUMB_QUALITY), width: v.videoWidth || 0, height: v.videoHeight || 0, duration: Number.isFinite(v.duration) ? v.duration : 0 });
    };
    const timer = setTimeout(fallback, 10000);
    v.onerror = fallback;
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { /* ignore */ } };
    v.onseeked = () => {
      try {
        const w0 = v.videoWidth, h0 = v.videoHeight;
        if (!w0 || !h0) return fallback();
        const scale = Math.min(1, max / Math.max(w0, h0));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        finish({ dataUrl: c.toDataURL('image/jpeg', THUMB_QUALITY), width: w0, height: h0, duration: Number.isFinite(v.duration) ? v.duration : 0 });
      } catch { fallback(); }
    };
    v.src = url;
  });
}

async function idbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).openCursor();
    r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
    r.onerror = () => reject(r.error);
  });
}

/** 本机视频缓存占用 */
export async function videoCacheInfo() {
  const all = (await idbAll()).filter(([k]) => String(k).startsWith('v:'));
  return { count: all.length, bytes: all.reduce((s, [, v]) => s + (v?.size || 0), 0) };
}
export async function clearVideoCache() {
  // 还没上传成功的视频（只有本机有）不删，免得丢失
  for (const [k] of (await idbAll()).filter(([k]) => String(k).startsWith('v:'))) {
    if (store.getPhoto(String(k).slice(2))?.remoteReady === false) continue;
    await idbDel(k);
  }
}
/** 超上限时按最早缓存先删（keepId 不删） */
async function evictVideoCache(keepId) {
  const cap = videoCacheBytes();
  const all = (await idbAll()).filter(([k]) => String(k).startsWith('v:')).sort((a, b) => (a[1]?.savedAt || 0) - (b[1]?.savedAt || 0));
  let total = all.reduce((s, [, v]) => s + (v?.size || 0), 0);
  for (const [k, v] of all) {
    if (total <= cap) break;
    if (k === vkey(keepId) || store.getPhoto(String(k).slice(2))?.remoteReady === false) continue;
    await idbDel(k); total -= v?.size || 0;
  }
}
export async function hasLocalVideo(id) { return !!(await idbGet(vkey(id)).catch(() => null))?.blob; }

async function putVideoChunks(id, blob, onProgress) {
  const base = photoApiBase();
  const enc = await getEncKey();
  const chunks = Math.max(1, Math.ceil(blob.size / VIDEO_CHUNK));
  for (let n = 0; n < chunks; n++) {
    const part = new Uint8Array(await blob.slice(n * VIDEO_CHUNK, (n + 1) * VIDEO_CHUNK).arrayBuffer());
    const packed = await core.sealBytes(enc, `${id}:${n}`, part);
    let res;
    for (let tryN = 0; tryN < 3; tryN++) {
      try { res = await fetch(`${base}/v1/video/${encodeURIComponent(id)}/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: packed }); if (res.ok) break; } catch (e) { if (tryN === 2) throw e; }
    }
    if (!res?.ok) throw new Error(`照片服务返回 ${res?.status}（旧版服务不支持视频？请在极空间重建容器）`);
    onProgress?.((n + 1) / chunks);
  }
  return chunks;
}

/** 选视频后入库：先封面+本机缓存立刻可见，再分块加密上传 */
export async function addVideoFromFile(file, { note = '', takenAt, onLocalReady, onProgress } = {}) {
  if (!file || !String(file.type || '').startsWith('video/')) throw new Error('请选择视频文件');
  const max = videoMaxBytes();
  if (file.size > max) {
    throw new Error(`视频约 ${(file.size / 1048576).toFixed(0)}MB，超过上限 ${Math.round(max / 1048576)}MB。请先在 iPhone 相册里「编辑」剪短后再传，或在设置里调高上限。`);
  }
  const id = uid();
  const taken = takenAt || (file.lastModified ? Number(file.lastModified) : Date.now());
  const { dataUrl, width, height, duration } = await makeVideoThumb(file);
  const mime = file.type || 'video/mp4';
  try { await idbPut(vkey(id), { blob: file.slice(0, file.size, mime), mime, size: file.size, savedAt: Date.now(), kind: 'video' }); await evictVideoCache(id); } catch (e) { console.warn('视频本机缓存失败', e); }
  const estChunks = Math.max(1, Math.ceil(file.size / VIDEO_CHUNK));
  const willUpload = !!photoApiBase();
  if (willUpload) markUploading(id, true);
  let photo = store.upsertPhoto({
    id, kind: 'video', takenAt: taken, uploadedAt: Date.now(), note, mime, size: file.size,
    width, height, duration: Math.round((duration || 0) * 10) / 10, chunks: estChunks, chunkSize: VIDEO_CHUNK,
    thumbData: dataUrl, remoteReady: false,
  });
  onLocalReady?.(photo);

  let remoteReady = false, uploadError = '', chunks = 0;
  if (willUpload) {
    try {
      chunks = await putVideoChunks(id, file, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
      remoteReady = true;
      photo = store.upsertPhoto({ ...store.getPhoto(id), chunks, chunkSize: VIDEO_CHUNK, remoteReady: true });
      onProgress?.({ phase: 'done', id });
    } catch (e) {
      uploadError = e.message || String(e);
      onProgress?.({ phase: 'error', id, error: uploadError });
    } finally {
      markUploading(id, false);
    }
  }
  return { photo: store.getPhoto(id) || photo, uploadError, needsPhotoApi: !photoApiBase() };
}

/** 播放：本机缓存 → 用户点了才分块下载解密（绝不自动调用） */
export async function loadVideoBlob(id, { onProgress } = {}) {
  const meta = store.getPhoto(id);
  if (!meta || meta.kind !== 'video') throw new Error('视频不存在');
  const cached = await idbGet(vkey(id)).catch(() => null);
  if (cached?.blob) {
    cached.savedAt = Date.now(); idbPut(vkey(id), cached).catch(() => {});
    return { blob: cached.blob, source: 'local' };
  }
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址，无法下载视频');
  if (!meta.remoteReady) throw new Error('这个视频还没上传到照片服务（需在上传的那台手机上补传）');
  const enc = await getEncKey();
  const parts = [];
  for (let n = 0; n < meta.chunks; n++) {
    const res = await fetch(`${base}/v1/video/${encodeURIComponent(id)}/${n}`);
    if (!res.ok) throw new Error(res.status === 404 ? '照片服务上找不到这个视频' : `照片服务返回 ${res.status}`);
    parts.push(await core.unsealBytes(enc, `${id}:${n}`, new Uint8Array(await res.arrayBuffer())));
    onProgress?.((n + 1) / meta.chunks);
  }
  const blob = new Blob(parts, { type: meta.mime || 'video/mp4' });
  try { await idbPut(vkey(id), { blob, mime: meta.mime, size: blob.size, savedAt: Date.now(), kind: 'video' }); await evictVideoCache(id); } catch { /* 存不下就只播不缓存 */ }
  return { blob, source: 'remote' };
}

async function retryVideoUpload(id, meta, onProgress) {
  const cached = await idbGet(vkey(id));
  if (!cached?.blob) throw new Error('本机没有这个视频的缓存，无法补传（需在上传的那台手机上操作）');
  const chunks = await putVideoChunks(id, cached.blob, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
  store.upsertPhoto({ ...store.getPhoto(id), chunks, chunkSize: VIDEO_CHUNK, remoteReady: true });
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
  const meta = store.getPhoto(id);
  if (meta?.kind === 'video') {
    await idbDel(vkey(id)).catch(() => {});
    const base = photoApiBase();
    if (base) await fetch(`${base}/v1/video/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    store.deletePhoto(id);
    return;
  }
  await idbDel(id).catch(() => {});
  await deleteRemotePhoto(id);
  store.deletePhoto(id);
}

/** 有地址但 remoteReady=false 时，用本机缓存补传（失败抛错，不静默） */
export async function retryUpload(id, { onProgress } = {}) {
  const meta = store.getPhoto(id);
  if (!meta) throw new Error('照片不存在');
  if (!photoApiBase()) throw new Error('请先填写照片服务地址');
  markUploading(id, true);
  onProgress?.({ phase: 'upload', id });
  try {
    if (meta.kind === 'video') {
      await retryVideoUpload(id, meta, onProgress);
    } else {
      const cached = await idbGet(id);
      if (!cached?.plain) throw new Error('本机没有原图缓存，无法补传（需在拍照的那台设备上操作）');
      const enc = await getEncKey();
      const packed = await core.sealBytes(enc, id, cached.plain);
      await putEncryptedPhoto(id, packed);
      store.upsertPhoto({ ...store.getPhoto(id), remoteReady: true });
    }
    onProgress?.({ phase: 'done', id });
  } catch (e) {
    onProgress?.({ phase: 'error', id, error: e.message || String(e) });
    throw e;
  } finally {
    markUploading(id, false);
  }
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

/** 出生当天＝第 1 天；生日未设或日期早于生日返回 null */
export function dayNumberOnDate(birthday, dateStr) {
  if (!birthday || !dateStr || dateStr < birthday) return null;
  return daysBetween(birthday, dateStr) + 1;
}

/** 亲宝宝风格：相对日/日期 +「第X天」，如「昨天 第42天」「10月27日 第41天」 */
export function fmtAlbumDayTitle(ymd, birthday) {
  const base = fmtDayTitle(ymd);
  const n = dayNumberOnDate(birthday, ymd);
  return n != null ? `${base} 第${n}天` : base;
}
