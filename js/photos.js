// v1.15.0 相册：缩略图在 IndexedDB，缩略图/中图/原图分块存照片服务，元数据走云同步。
// v1.14.0 起原图/视频明文分块传到 /v1/file（极空间存成普通照片，按 年/年-月 分文件夹）；
// 旧的 AES 密文（storage='chunks' 或整文件 /v1/photo）仍可读取，不自动转换旧原图。
import { store, uid } from './store.js';
import * as core from './sync-core.js';
import { syncStatus } from './sync.js';
import { readThumb, writeThumb } from './thumbs.js';
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

// GET 查询鉴权供原生 img/video Range 使用；写请求仍只接受 Bearer。
export function mediaUrl(id) {
  const base = photoApiBase();
  if (!base) return '';
  const url = new URL(`${base}/v1/file/${encodeURIComponent(id)}`);
  const token = String(store.state.settings.photoToken || '').trim();
  if (token) url.searchParams.set('access_token', token);
  return url.href;
}
async function photoFetch(url, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const token = String(store.state.settings.photoToken || '').trim();
  if (token && String(url).startsWith(photoApiBase() + '/')) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...opts, headers });
}
export async function photoThumb(meta) {
  if (meta.thumbData) return meta.thumbData;
  const local = await readThumb(meta.id).catch(() => '');
  if (local) return local;
  if (!meta.thumbRemote || !photoApiBase()) return '';
  const r = await photoFetch(mediaUrl(`${meta.id}-t`));
  if (!r.ok) return '';
  const blob = await r.blob();
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
  });
  await writeThumb(meta.id, src).catch(() => {});
  const cur = store.getPhoto(meta.id);
  if (cur) cur.thumbData = src;
  return src;
}
const thumbUploads = new Map();
const deletedIds = new Set();
export async function ensureRemoteThumb(meta) {
  if (meta.thumbRemote || !photoApiBase()) return meta;
  if (thumbUploads.has(meta.id)) return thumbUploads.get(meta.id);
  const task = (async () => {
    const src = await photoThumb(meta);
    if (!src) return meta;
    const blob = await (await fetch(src)).blob();
    await putRawChunks(`${meta.id}-t`, blob, { taken: meta.takenAt, ext: 'jpg', mime: 'image/jpeg' });
    const cur = store.getPhoto(meta.id);
    return cur ? store.upsertPhoto({ ...cur, thumbRemote: true }) : meta;
  })().finally(() => thumbUploads.delete(meta.id));
  thumbUploads.set(meta.id, task);
  return task;
}
function patchPhoto(id, patch) {
  const cur = store.getPhoto(id);
  return cur ? store.upsertPhoto({ ...cur, ...patch }) : null;
}
async function uploadDerivatives(id, plain, meta) {
  await ensureRemoteThumb(store.getPhoto(id) || meta);
  if (meta.kind === 'video' || meta.mediumReady) return;
  let medium = await idbGet(`m:${id}`).catch(() => null);
  if (!medium) {
    const blob = plain instanceof Blob ? plain : new Blob([plain], { type: meta.mime });
    let result;
    try { result = await makeThumb(blob, 1280); } catch { result = await makeThumbViaImg(blob, 1280); }
    medium = await (await fetch(result.dataUrl)).blob();
    if (deletedIds.has(id)) throw new Error('记录已删除');
    await idbPut(`m:${id}`, medium);
  }
  await putRawChunks(`${id}-m`, medium, { taken: meta.takenAt, ext: 'jpg', mime: 'image/jpeg' });
  if (store.getPhoto(id)) store.upsertPhoto({ ...store.getPhoto(id), mediumReady: true });
}
/** 返回原生媒体 URL；仅旧密文走解密并创建临时 URL（调用方必须 release）。 */
export async function viewerSource(meta, original = false) {
  if (meta.kind !== 'video' && !original) {
    const local = await idbGet(`m:${meta.id}`).catch(() => null);
    if (local) return { url: URL.createObjectURL(local), temporary: true };
    if (meta.mediumReady && photoApiBase()) return { url: mediaUrl(`${meta.id}-m`) };
  }
  if (meta.remoteReady && meta.storage === 'file' && photoApiBase()) return { url: mediaUrl(meta.id) };
  const { blob } = meta.kind === 'video' ? await loadVideoBlob(meta.id) : await loadPhotoBlob(meta.id);
  return { url: URL.createObjectURL(blob), temporary: true };
}

let blobsDb;
function openDb() {
  if (blobsDb) return blobsDb;
  blobsDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('本机照片数据库被占用'));
  }).catch((e) => { blobsDb = null; throw e; });
  return blobsDb;
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

/** 隧道慢链路上单次 PUT 易超时；小图仍可走整文件，失败由调用方改分块 */
export async function putEncryptedPhoto(id, packedBytes, { timeoutMs = 90000 } = {}) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  let lastErr;
  for (let tryN = 0; tryN < 3; tryN++) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await photoFetch(`${base}/v1/photo/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...corsHeaders() },
        body: packedBytes,
        signal: ctrl?.signal,
      });
      if (res.ok) return true;
      lastErr = new Error(`照片服务返回 ${res.status}`);
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? new Error('上传超时（隧道链路较慢，将改用分块）') : e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error('照片上传失败');
}

export async function fetchEncryptedPhoto(id) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  const res = await photoFetch(`${base}/v1/photo/${encodeURIComponent(id)}`, { method: 'GET' });
  if (res.status === 404) throw new Error('照片服务上找不到这张原图');
  if (!res.ok) throw new Error(`照片服务返回 ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteRemotePhoto(id) {
  const base = photoApiBase();
  if (!base) return false;
  try {
    const res = await photoFetch(`${base}/v1/photo/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    const res = await photoFetch(`${base}/health`, { method: 'GET', cache: 'no-store' });
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

/** 本机「上传中」状态（不同步）：缩略图先入库后角标用；切页不丢 */
const uploadingIds = new Set();
/** 本批/补传队列：remoteReady 前一直算未传完，切日程再回相册仍显示「上传中」 */
const uploadSession = {
  active: false,
  total: 0,
  done: 0,
  fail: 0,
  text: '',
  pendingIds: new Set(),
};
const uploadListeners = new Set();
function notifyUpload() {
  for (const fn of [...uploadListeners]) {
    try { fn(getUploadSession()); } catch { /* ignore */ }
  }
}
export function isUploading(id) { return uploadingIds.has(id); }
/** 正在传、或仍在本批待传队列且尚未 remoteReady */
export function isUploadPending(id) {
  if (uploadingIds.has(id)) return true;
  if (uploadSession.pendingIds.has(id)) {
    const p = typeof store !== 'undefined' && store.getPhoto?.(id);
    if (p && p.remoteReady) {
      uploadSession.pendingIds.delete(id);
      return false;
    }
    return true;
  }
  return false;
}
export function getUploadSession() {
  return {
    active: uploadSession.active,
    total: uploadSession.total,
    done: uploadSession.done,
    fail: uploadSession.fail,
    text: uploadSession.text,
    pending: uploadSession.pendingIds.size,
    pendingIds: [...uploadSession.pendingIds],
  };
}
export function onUploadSession(fn) {
  uploadListeners.add(fn);
  return () => uploadListeners.delete(fn);
}
export function beginUploadBatch(total, text = '') {
  uploadSession.active = true;
  uploadSession.total = total;
  uploadSession.done = 0;
  uploadSession.fail = 0;
  uploadSession.text = text || `准备上传 0/${total}…`;
  notifyUpload();
}
export function setUploadBatchText(text) {
  uploadSession.text = text || '';
  notifyUpload();
}
export function endUploadBatch() {
  uploadSession.active = false;
  // 失败项仍留在 pendingIds，角标继续「上传中/待补传」直到 remoteReady 或删掉
  if (uploadSession.pendingIds.size) {
    uploadSession.text = `还有 ${uploadSession.pendingIds.size} 项未传到照片服务，可点「一键补传」`;
  } else {
    uploadSession.text = '';
  }
  notifyUpload();
}
function trackPending(id, on) {
  if (on) uploadSession.pendingIds.add(id);
  else uploadSession.pendingIds.delete(id);
  notifyUpload();
}
function markUploading(id, on) {
  if (on) {
    uploadingIds.add(id);
    uploadSession.pendingIds.add(id);
  } else {
    uploadingIds.delete(id);
  }
  notifyUpload();
}
export const BATCH_SOFT_LIMIT = 12; // 建议单次张数；超过只提示，不硬拦
export const UPLOAD_CONCURRENCY = 1; // 隧道串行，避免挤垮慢上行

/** 选图/拍照后入库：先写缩略图+本机缓存立刻可见，再后台分块上传原图 */
/** @param {{ upload?: boolean }} opts upload=false 时只写缩略图+本机缓存，原图留给调用方排队上传 */
export async function addPhotoFromFile(file, { note = '', takenAt, onLocalReady, onProgress, upload = true } = {}) {
  const isImg = String(file?.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|gif|webp)$/i.test(file?.name || '');
  if (!file || !isImg) throw new Error('请选择图片文件');
  const id = uid();
  const taken = takenAt || (file.lastModified ? Number(file.lastModified) : Date.now());
  let thumb;
  try { thumb = await makeThumb(file); }
  catch { thumb = await makeThumbViaImg(file).catch(() => { throw new Error('这张图片格式无法读取（可在 iPhone 设置→相机→格式 选「兼容性最佳」）'); }); }
  const { dataUrl, width, height } = thumb;
  await writeThumb(id, dataUrl).catch(() => {}); // 失败时 store 保留旧式副本，避免丢图

  // 先入库缩略图（remoteReady=false），相册立刻可见；原图缓存/上传稍后
  const willUpload = !!photoApiBase();
  if (willUpload) markUploading(id, true);
  let photo = store.upsertPhoto({
    id,
    takenAt: taken,
    uploadedAt: Date.now(),
    note,
    mime: file.type || 'image/jpeg',
    size: file.size || 0,
    width,
    height,
    thumbData: dataUrl,
    remoteReady: false,
    ext: extOf(file),
  });
  onLocalReady?.(photo);
  onProgress?.({ phase: (!upload || !willUpload) ? 'local' : 'upload', id });

  // 缩略图已进相册后再读原图进本机缓存（供补传）
  const buf = file.slice(0, file.size, file.type || 'image/jpeg');
  await idbPut(id, { plain: buf, mime: file.type || 'image/jpeg', savedAt: Date.now() });
  if ((store.getPhoto(id)?.size || 0) !== buf.size) {
    photo = patchPhoto(id, { size: buf.size });
  }

  // 只入库：缩略图已可见；原图由相册页统一排队上传（隧道串行）
  if (!upload || !willUpload) {
    return { photo: store.getPhoto(id) || photo, uploadError: '', needsPhotoApi: !photoApiBase(), deferred: !!willUpload };
  }

  let uploadError = '';
  try {
    await uploadDerivatives(id, buf, store.getPhoto(id));
    const patch = await uploadOriginal(id, buf, { taken, ext: extOf(file), mime: file.type || 'image/jpeg' }, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
    photo = patchPhoto(id, { ...patch, remoteReady: true });
    trackPending(id, false);
    onProgress?.({ phase: 'done', id });
  } catch (e) {
    uploadError = e.message || String(e);
    console.warn('原图上传失败（元数据仍会同步）', core.keyFingerprint?.(syncStatus().key), e);
    onProgress?.({ phase: 'error', id, error: uploadError });
  } finally {
    markUploading(id, false);
  }
  return { photo: store.getPhoto(id) || photo, uploadError, needsPhotoApi: !photoApiBase(), deferred: false };
}

// ───────── v1.10.0 视频 ─────────
/** 明文分块大小。Cloudflare Tunnel 慢上行时 ≥512KB 易超时；256KB 实测稳定 */
export const UPLOAD_CHUNK = 256 * 1024;
export const VIDEO_CHUNK = UPLOAD_CHUNK; // 与照片同块大小，兼容旧 meta.chunkSize
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

/** 把明文（Uint8Array 或 Blob）按 UPLOAD_CHUNK 分块加密 PUT 到 /v1/video/:id/:n */
async function putPlainChunks(id, plainOrBlob, onProgress) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  if (photoApiBlockedByMixedContent(base)) {
    throw new Error('照片地址是局域网 http，HTTPS 的 App 连不上。请改成 https://photo.jiayouzhaozhao.cn');
  }
  const enc = await getEncKey();
  const isU8 = plainOrBlob instanceof Uint8Array;
  const size = isU8 ? plainOrBlob.byteLength : plainOrBlob.size;
  const chunkSize = UPLOAD_CHUNK;
  const chunks = Math.max(1, Math.ceil(size / chunkSize));
  for (let n = 0; n < chunks; n++) {
    let part;
    if (isU8) {
      part = plainOrBlob.subarray(n * chunkSize, Math.min(size, (n + 1) * chunkSize));
    } else {
      part = new Uint8Array(await plainOrBlob.slice(n * chunkSize, (n + 1) * chunkSize).arrayBuffer());
    }
    const packed = await core.sealBytes(enc, `${id}:${n}`, part);
    let res;
    let lastErr;
    for (let tryN = 0; tryN < 3; tryN++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 90000) : null;
      try {
        res = await photoFetch(`${base}/v1/video/${encodeURIComponent(id)}/${n}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: packed,
          signal: ctrl?.signal,
        });
        if (res.ok) break;
        lastErr = new Error(`照片服务返回 ${res.status}`);
      } catch (e) {
        lastErr = e?.name === 'AbortError' ? new Error('分块上传超时，请检查隧道或稍后再补传') : e;
        if (tryN === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 800 * (tryN + 1)));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!res?.ok) throw lastErr || new Error(`照片服务返回 ${res?.status}（旧版服务不支持分块？请在极空间重建容器）`);
    onProgress?.((n + 1) / chunks);
  }
  return chunks;
}
async function putVideoChunks(id, blob, onProgress) {
  return putPlainChunks(id, blob, onProgress);
}

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-m4v': 'm4v' };
export function extOf(fileOrMeta) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(fileOrMeta?.name || '');
  if (m) return m[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  return EXT_BY_MIME[String(fileOrMeta?.type || fileOrMeta?.mime || '').toLowerCase()] || '';
}

/** v1.14.0：明文按 UPLOAD_CHUNK 分块 PUT /v1/file/:id/:n，服务端收齐后存成普通照片/视频。旧服务（无 /v1/file）抛 code=old_server */
async function putRawChunks(id, plainOrBlob, { taken, ext, mime } = {}, onProgress) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  if (photoApiBlockedByMixedContent(base)) {
    const e = new Error('照片地址是局域网 http，HTTPS 的 App 连不上。请改成 https://photo.jiayouzhaozhao.cn');
    e.code = 'mixed_content';
    throw e;
  }
  const originalId = store.getPhoto(id) ? id : id.replace(/-[tm]$/, '');
  const cancelled = () => deletedIds.has(id) || deletedIds.has(originalId) || !store.getPhoto(originalId);
  const isU8 = plainOrBlob instanceof Uint8Array;
  const size = isU8 ? plainOrBlob.byteLength : plainOrBlob.size;
  const chunkSize = UPLOAD_CHUNK;
  const chunks = Math.max(1, Math.ceil(size / chunkSize));
  const qs = new URLSearchParams({ total: String(chunks), taken: String(Number(taken) || Date.now()), ext: ext || '', mime: mime || '' }).toString();
  for (let n = 0; n < chunks; n++) {
    if (cancelled()) throw new Error('记录已删除');
    const part = isU8
      ? plainOrBlob.subarray(n * chunkSize, Math.min(size, (n + 1) * chunkSize))
      : new Uint8Array(await plainOrBlob.slice(n * chunkSize, (n + 1) * chunkSize).arrayBuffer());
    let res, lastErr;
    for (let tryN = 0; tryN < 3; tryN++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      // 首块用短超时，尽快判断旧服务/连不上；后续块仍 90s
      const timer = ctrl ? setTimeout(() => ctrl.abort(), n === 0 && tryN === 0 ? 15000 : 90000) : null;
      try {
        res = await photoFetch(`${base}/v1/file/${encodeURIComponent(id)}/${n}?${qs}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: part, signal: ctrl?.signal,
        });
        if (cancelled()) {
          await photoFetch(`${base}/v1/file/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
          throw new Error('记录已删除');
        }
        if (res.ok) break;
        if (n === 0 && (res.status === 404 || res.status === 405)) {
          const e = new Error('照片服务是旧版（不支持存普通照片），请在极空间更新 server.js 并重启容器');
          e.code = 'old_server';
          throw e;
        }
        lastErr = new Error(`照片服务返回 ${res.status}`);
      } catch (e) {
        if (e.code === 'old_server' || cancelled()) throw e;
        lastErr = e?.name === 'AbortError' ? new Error('分块上传超时，请检查隧道或稍后再补传') : e;
        if (tryN === 2) throw lastErr;
        await new Promise((r) => setTimeout(r, 800 * (tryN + 1)));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!res?.ok) throw lastErr || new Error(`照片服务返回 ${res?.status}`);
    onProgress?.((n + 1) / chunks);
  }
  return chunks;
}

/** 上传原图/视频：新上传只存普通文件；旧服务需更新，不回退为密文。返回要写进元数据的字段 */
async function uploadOriginal(id, plainOrBlob, info, onProgress) {
  const chunks = await putRawChunks(id, plainOrBlob, info, onProgress);
  return { storage: 'file', chunks: 0, chunkSize: UPLOAD_CHUNK, ext: info.ext || '', fileChunks: chunks };
}

/** 下载普通文件（原样字节） */
async function fetchPlainFile(id, mime, onProgress) {
  const base = photoApiBase();
  if (!base) throw new Error('未配置照片服务地址');
  const res = await photoFetch(`${base}/v1/file/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('照片服务上找不到这个原文件');
  if (!res.ok) throw new Error(`照片服务返回 ${res.status}`);
  const blob = await res.blob();
  onProgress?.(1);
  return blob;
}

/** 需要转换的旧加密原图（已上传、但不是普通文件） */
export function legacyEncryptedPhotos() {
  return store.photos().filter((p) => p.remoteReady && p.storage !== 'file');
}

/** v1.14.0 迁移：逐个 拉密文→本机解密→明文回传 /v1/file→删旧密文。需在有同步密钥的手机前台运行 */
export async function migrateLegacyToPlain({ onProgress } = {}) {
  const base = photoApiBase();
  if (!base) throw new Error('请先填写照片服务地址');
  await getEncKey();
  const list = legacyEncryptedPhotos();
  let ok = 0, fail = 0;
  const errors = [];
  for (const [i, p] of list.entries()) {
    onProgress?.({ index: i, total: list.length, ok, fail });
    try {
      let data;
      if (p.kind === 'video') {
        const cached = await idbGet(vkey(p.id)).catch(() => null);
        if (cached?.blob) data = cached.blob;
        else {
          const enc = await getEncKey();
          const parts = [];
          for (let n = 0; n < p.chunks; n++) {
            const res = await photoFetch(`${base}/v1/video/${encodeURIComponent(p.id)}/${n}`);
            if (!res.ok) throw new Error(res.status === 404 ? '服务上找不到这个视频' : `照片服务返回 ${res.status}`);
            parts.push(await core.unsealBytes(enc, `${p.id}:${n}`, new Uint8Array(await res.arrayBuffer())));
          }
          data = new Blob(parts, { type: p.mime || 'video/mp4' });
        }
      } else {
        const cached = await idbGet(p.id).catch(() => null);
        data = cached?.plain || await fetchLegacyPlain(p.id, p);
      }
      const ext = p.ext || EXT_BY_MIME[String(p.mime || '').toLowerCase()] || (p.kind === 'video' ? 'mp4' : 'jpg');
      const patch = await uploadOriginal(p.id, data, { taken: p.takenAt, ext, mime: p.mime }, null);
      if (patch.storage !== 'file') throw new Error('照片服务是旧版，请先在极空间更新');
      store.upsertPhoto({ ...store.getPhoto(p.id), ...patch, remoteReady: true });
      await photoFetch(`${base}/v1/legacy/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => {});
      ok++;
    } catch (e) {
      fail++;
      errors.push(e.message || String(e));
      if (e.code === 'old_server' || /旧版/.test(e.message || '')) break;
    }
  }
  onProgress?.({ index: list.length, total: list.length, ok, fail });
  return { total: list.length, ok, fail, errors };
}

/** 选视频后入库：先封面+本机缓存立刻可见，再分块上传普通文件 */
export async function addVideoFromFile(file, { note = '', takenAt, onLocalReady, onProgress, upload = true } = {}) {
  if (!file || !String(file.type || '').startsWith('video/')) throw new Error('请选择视频文件');
  const max = videoMaxBytes();
  if (file.size > max) {
    throw new Error(`视频约 ${(file.size / 1048576).toFixed(0)}MB，超过上限 ${Math.round(max / 1048576)}MB。请先在 iPhone 相册里「编辑」剪短后再传，或在设置里调高上限。`);
  }
  const id = uid();
  const taken = takenAt || (file.lastModified ? Number(file.lastModified) : Date.now());
  const { dataUrl, width, height, duration } = await makeVideoThumb(file);
  await writeThumb(id, dataUrl).catch(() => {});
  const mime = file.type || 'video/mp4';
  const estChunks = Math.max(1, Math.ceil(file.size / VIDEO_CHUNK));
  const willUpload = !!photoApiBase();
  if (willUpload) markUploading(id, true);
  // 封面先入库，相册立刻可见；大视频本机缓存稍后
  let photo = store.upsertPhoto({
    id, kind: 'video', takenAt: taken, uploadedAt: Date.now(), note, mime, size: file.size,
    width, height, duration: Math.round((duration || 0) * 10) / 10, chunks: estChunks, chunkSize: VIDEO_CHUNK,
    thumbData: dataUrl, remoteReady: false, ext: extOf(file),
  });
  onLocalReady?.(photo);
  onProgress?.({ phase: (!upload || !willUpload) ? 'local' : 'upload', id });
  try { await idbPut(vkey(id), { blob: file.slice(0, file.size, mime), mime, size: file.size, savedAt: Date.now(), kind: 'video' }); await evictVideoCache(id); } catch (e) { console.warn('视频本机缓存失败', e); }

  if (!upload || !willUpload) {
    return { photo: store.getPhoto(id) || photo, uploadError: '', needsPhotoApi: !photoApiBase(), deferred: !!willUpload };
  }

  let uploadError = '';
  try {
    await uploadDerivatives(id, file, store.getPhoto(id));
    const patch = await uploadOriginal(id, file, { taken, ext: extOf(file), mime }, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
    photo = patchPhoto(id, { ...patch, remoteReady: true });
    trackPending(id, false);
    onProgress?.({ phase: 'done', id });
  } catch (e) {
    uploadError = e.message || String(e);
    onProgress?.({ phase: 'error', id, error: uploadError });
  } finally {
    markUploading(id, false);
  }
  return { photo: store.getPhoto(id) || photo, uploadError, needsPhotoApi: !photoApiBase(), deferred: false };
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
  if (meta.storage === 'file') {
    const blob = await fetchPlainFile(id, meta.mime || 'video/mp4', onProgress);
    try { await idbPut(vkey(id), { blob, mime: meta.mime, size: blob.size, savedAt: Date.now(), kind: 'video' }); await evictVideoCache(id); } catch { /* ignore */ }
    return { blob, source: 'remote' };
  }
  const enc = await getEncKey();
  const parts = [];
  for (let n = 0; n < meta.chunks; n++) {
    const res = await photoFetch(`${base}/v1/video/${encodeURIComponent(id)}/${n}`);
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
  await uploadDerivatives(id, cached.blob, meta);
  const patch = await uploadOriginal(id, cached.blob, { taken: meta.takenAt, ext: meta.ext, mime: meta.mime || cached.mime }, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
  patchPhoto(id, { ...patch, remoteReady: true });
}

/** 本机 IndexedDB 是否还有原图像素（删 App / 清站点数据后会没） */
export async function hasLocalPhoto(id) {
  const cached = await idbGet(id).catch(() => null);
  return !!(cached && cached.plain);
}

/** 打开大图：优先本机明文缓存 →（已上传）从照片服务拉密文解密 → 仅缩略图 */
export async function loadPhotoBlob(id) {
  const meta = store.getPhoto(id);
  if (!meta) throw new Error('照片不存在');

  const cached = await idbGet(id);
  if (cached?.plain) {
    return { blob: new Blob([cached.plain], { type: cached.mime || meta.mime }), source: 'local' };
  }

  // 从未成功上传：别去服务端硬找（会误报「照片服务上找不到这张原图」）
  if (!meta.remoteReady) {
    if (meta.thumbData) {
      const r = await fetch(meta.thumbData);
      return {
        blob: await r.blob(),
        source: 'thumb',
        tip: '原图还没传到照片服务。若刚删过 App，本机原图也没了——请删除这条后，从手机相册重新选图上传。',
      };
    }
    throw new Error('原图未上传，且本机没有缓存。请删除后从手机相册重新上传。');
  }

  if (!photoApiBase()) {
    if (meta.thumbData) {
      const r = await fetch(meta.thumbData);
      return { blob: await r.blob(), source: 'thumb', tip: '未配置照片服务，只能看缩略图。在设置里填极空间照片服务地址后才能看原图。' };
    }
    throw new Error('本机没有这张图的缓存，且未配置照片服务');
  }

  try {
    let plain;
    if (meta.storage === 'file') {
      plain = await fetchPlainFile(id, meta.mime);
    } else {
      plain = await fetchLegacyPlain(id, meta);
    }
    await idbPut(id, { plain, mime: meta.mime, savedAt: Date.now() });
    return { blob: new Blob([plain], { type: meta.mime }), source: 'remote' };
  } catch (e) {
    if (meta.thumbData) {
      const r = await fetch(meta.thumbData);
      return { blob: await r.blob(), source: 'thumb', tip: e.message || '原图加载失败，暂显示缩略图' };
    }
    throw e;
  }
}

/** 旧版密文（分块 /v1/video 或整文件 /v1/photo）→ 明文 Uint8Array */
async function fetchLegacyPlain(id, meta) {
    const enc = await getEncKey();
    let plain;
    if (meta.chunks || meta.storage === 'chunks') {
      const base = photoApiBase();
      const parts = [];
      const nChunks = Number(meta.chunks) || 0;
      if (!nChunks) throw new Error('分块元数据缺失');
      for (let n = 0; n < nChunks; n++) {
        const res = await photoFetch(`${base}/v1/video/${encodeURIComponent(id)}/${n}`);
        if (!res.ok) throw new Error(res.status === 404 ? '照片服务上找不到这张原图' : `照片服务返回 ${res.status}`);
        parts.push(await core.unsealBytes(enc, `${id}:${n}`, new Uint8Array(await res.arrayBuffer())));
      }
      const total = parts.reduce((s, p) => s + p.byteLength, 0);
      plain = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { plain.set(p, off); off += p.byteLength; }
    } else {
      const packed = await fetchEncryptedPhoto(id);
      plain = await core.unsealBytes(enc, id, packed);
    }
    return plain;
}

/** 删除：元数据 tombstone（同步层）、本机缓存、尽量删远程密文 */
export async function removePhoto(id) {
  const meta = store.getPhoto(id);
  deletedIds.add(id);
  uploadSession.pendingIds.delete(id); uploadingIds.delete(id);
  store.deletePhoto(id); notifyUpload();
  for (const suffix of ['-t', '-m']) {
    if (photoApiBase()) await photoFetch(mediaUrl(id + suffix), { method: 'DELETE' }).catch(() => {});
  }
  await idbDel(`m:${id}`).catch(() => {});
  if (meta?.kind === 'video') {
    await idbDel(vkey(id)).catch(() => {});
    const base = photoApiBase();
    if (base) {
      await photoFetch(`${base}/v1/file/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      await photoFetch(`${base}/v1/video/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    return;
  }
  await idbDel(id).catch(() => {});
  if (photoApiBase()) await photoFetch(`${photoApiBase()}/v1/file/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  await deleteRemotePhoto(id);
  // 分块存的照片走 /v1/video 目录
  if (meta?.chunks || meta?.storage === 'chunks') {
    const base = photoApiBase();
    if (base) await photoFetch(`${base}/v1/video/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }
  uploadSession.pendingIds.delete(id);
  uploadingIds.delete(id);
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
      if (!cached?.plain) throw new Error('本机没有原图缓存，无法补传。删过 App 后需删除这条，再从手机相册重新选图上传');
      await uploadDerivatives(id, cached.plain, meta);
      const patch = await uploadOriginal(id, cached.plain, { taken: meta.takenAt, ext: meta.ext, mime: meta.mime || cached.mime }, (x) => onProgress?.({ phase: 'upload', id, ratio: x }));
      patchPhoto(id, { ...patch, remoteReady: true });
    }
    trackPending(id, false);
    onProgress?.({ phase: 'done', id });
  } catch (e) {
    onProgress?.({ phase: 'error', id, error: e.message || String(e) });
    throw e;
  } finally {
    markUploading(id, false);
  }
}

/** 对本机仍有缓存、remoteReady=false 的项串行补传（限并发=1） */
export async function retryAllPendingUploads({ onProgress, onlyIds } = {}) {
  if (!photoApiBase()) throw new Error('请先填写照片服务地址');
  const idSet = onlyIds ? new Set(onlyIds) : null;
  const list = store.photos().filter((p) => {
    if (p.remoteReady) return false;
    if (idSet && !idSet.has(p.id)) return false;
    return true;
  });
  const todo = [];
  for (const p of list) {
    const has = p.kind === 'video' ? await hasLocalVideo(p.id) : await hasLocalPhoto(p.id);
    if (has) todo.push(p);
  }
  if (!todo.length) return { ok: 0, fail: 0, skipped: list.length };
  beginUploadBatch(todo.length, `补传 0/${todo.length}…`);
  let ok = 0, fail = 0;
  for (const [i, p] of todo.entries()) {
    setUploadBatchText(`补传 ${i + 1}/${todo.length}…`);
    onProgress?.({ phase: 'upload', id: p.id, index: i, total: todo.length });
    try {
      await retryUpload(p.id, { onProgress });
      ok++;
      uploadSession.done = ok;
    } catch (e) {
      fail++;
      uploadSession.fail = fail;
      onProgress?.({ phase: 'error', id: p.id, error: e.message || String(e) });
    }
    notifyUpload();
  }
  endUploadBatch();
  return { ok, fail, skipped: list.length - todo.length };
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
