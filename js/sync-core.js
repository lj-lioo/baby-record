// 云同步核心（浏览器与 Node 18+ 共用，无依赖）：同步密钥、端到端加密、请求。
// 同步密钥 = "brs1_" + 32 字节随机数（base64url）。只保存在各设备本地，从不发送给服务器。
// 从密钥用 HKDF 派生：① 访问令牌（发给服务器，服务器只存它的 sha256）② AES-GCM 加密密钥（数据在本地加密）。
const te = new TextEncoder();
const td = new TextDecoder();
const SALT = te.encode('baby-record-sync/v1');
export const KEY_PREFIX = 'brs1_';
const KEY_RE = /brs1_[A-Za-z0-9_-]{43}/;

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function newSyncKey() {
  return KEY_PREFIX + b64u(crypto.getRandomValues(new Uint8Array(32)));
}
// 从粘贴的文本（可带空格、换行或整条链接）里取出密钥；无效返回 ''
export function extractSyncKey(text) {
  const m = KEY_RE.exec(String(text || '').replace(/\s+/g, ''));
  return m ? m[0] : '';
}

export async function deriveKeys(syncKey) {
  const key = extractSyncKey(syncKey);
  if (!key) throw new Error('同步密钥格式不正确');
  const raw = unb64u(key.slice(KEY_PREFIX.length));
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('token') }, base, 256);
  const enc = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('enc') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { token: b64u(new Uint8Array(bits)), enc };
}

// 加密一条记录的内容；id 与 updatedAt 作为附加认证数据，防止密文被挪用或篡改时间
export async function seal(enc, id, updatedAt, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`${id}|${updatedAt}`) }, enc, te.encode(JSON.stringify(obj)));
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(ct))}`;
}
export async function unseal(enc, id, updatedAt, data) {
  const [v, iv, ct] = String(data).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('未知的数据格式');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv), additionalData: te.encode(`${id}|${updatedAt}`) }, enc, unb64u(ct));
  return JSON.parse(td.decode(pt));
}

export async function syncRequest(base, token, body, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(`${String(base).replace(/\/+$/, '')}/v1/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('连不上同步服务（请检查网络；国内网络可能无法访问 workers.dev）');
  }
  let out = null;
  try { out = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error((out && (out.message || out.error)) || `同步服务返回 ${res.status}`);
  return out;
}

// 事项 ↔ 同步记录
export const EVENT_PREFIX = 'ev:';
export const PROFILE_ID = 'profile';
