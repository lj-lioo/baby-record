#!/usr/bin/env node
// 宝宝记录 · 极空间照片服务
// v1.14.0 起：新上传存成普通照片/视频（/v1/file，按 年/年-月 分文件夹，极空间相册可直接识别）；
// 旧的 AES 密文（/v1/photo、/v1/video）仍可读写删，供旧版 App 和迁移使用。
// 环境变量：PORT（默认 8789）、DATA_DIR（默认 ./data）、PHOTO_TOKEN（可选，非空则要求 Bearer）、CORS_ORIGINS（逗号分隔，额外允许的源）
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8789);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const TOKEN = String(process.env.PHOTO_TOKEN || '').trim();
const EXTRA_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULT_ORIGINS = [
  'https://lj-lioo.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8093',
  'http://127.0.0.1:8093',
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function allowOrigin(origin) {
  if (!origin) return '';
  if (DEFAULT_ORIGINS.includes(origin) || EXTRA_ORIGINS.includes(origin)) return origin;
  // 局域网调试：http://192.168.x.x:任意端口、http://10.x、http://172.16-31.x
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const h = u.hostname;
      if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return origin;
      if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return origin;
      if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return origin;
      if (h === 'localhost' || h === '127.0.0.1') return origin;
    }
  } catch { /* ignore */ }
  return '';
}

function setCors(req, res) {
  const origin = allowOrigin(req.headers.origin || '');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  }
}

function safeId(id) {
  return /^[0-9a-zA-Z_-]{6,64}$/.test(id || '') ? id : '';
}

function filePath(id) {
  return path.join(DATA_DIR, `${id}.bin`);
}

function checkAuth(req, res) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m && m[1] === TOKEN) return true;
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'unauthorized', message: '需要 PHOTO_TOKEN' }));
  return false;
}

function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { chunks.length = 0; return; } // 丢弃剩余数据，读完再回 413
      chunks.push(c);
    });
    req.on('end', () => (n > limit ? reject(new Error('body too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// ───────── v1.14.0 明文文件 ─────────
const STAGE_DIR = path.join(DATA_DIR, '.staging');
const INDEX_DIR = path.join(DATA_DIR, '.index');
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/3gpp': '3gp', 'video/x-m4v': 'm4v',
};
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', m4v: 'video/x-m4v' };
function pickExt(ext, mime) {
  const e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^jpeg$/, 'jpg');
  if (e && EXT_MIME[e]) return e;
  return MIME_EXT[String(mime || '').toLowerCase()] || 'bin';
}
// 拍摄时间（毫秒）→ 北京时间各字段
function shanghaiParts(ms) {
  const d = new Date(Number.isFinite(ms) && ms > 0 ? ms + 8 * 3600e3 : Date.now() + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return { y: String(d.getUTCFullYear()), m: p(d.getUTCMonth() + 1), d: p(d.getUTCDate()), H: p(d.getUTCHours()), M: p(d.getUTCMinutes()), S: p(d.getUTCSeconds()) };
}
function indexPath(id) { return path.join(INDEX_DIR, `${id}.json`); }
function readIndex(id) {
  try { return JSON.parse(fs.readFileSync(indexPath(id), 'utf8')); } catch { return null; }
}
function finalizeFile(id, total, info) {
  const sdir = path.join(STAGE_DIR, id);
  const old = readIndex(id);
  const t = shanghaiParts(Number(info.taken));
  const ext = pickExt(info.ext, info.mime);
  const rel = path.join(t.y, `${t.y}-${t.m}`, `${t.y}${t.m}${t.d}_${t.H}${t.M}${t.S}_${id.slice(-6)}.${ext}`);
  const fp = path.join(DATA_DIR, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  let size = 0;
  try {
    for (let n = 0; n < total; n++) {
      const b = fs.readFileSync(path.join(sdir, `${n}.part`));
      fs.writeSync(fd, b); size += b.length;
    }
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, fp);
  const taken = Number(info.taken);
  if (Number.isFinite(taken) && taken > 0) { try { fs.utimesSync(fp, taken / 1000, taken / 1000); } catch { /* ignore */ } }
  if (old?.path && old.path !== rel) { try { fs.unlinkSync(path.join(DATA_DIR, old.path)); } catch { /* ignore */ } }
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const idx = { id, path: rel, mime: EXT_MIME[ext] || info.mime || 'application/octet-stream', size, taken: taken || null, savedAt: Date.now() };
  fs.writeFileSync(indexPath(id), JSON.stringify(idx));
  fs.rmSync(sdir, { recursive: true, force: true });
  return idx;
}
function deletePlain(id) {
  const idx = readIndex(id);
  if (idx?.path) { try { fs.unlinkSync(path.join(DATA_DIR, idx.path)); } catch { /* ignore */ } }
  try { fs.unlinkSync(indexPath(id)); } catch { /* ignore */ }
  fs.rmSync(path.join(STAGE_DIR, id), { recursive: true, force: true });
}
function deleteLegacy(id) {
  try { fs.unlinkSync(filePath(id)); } catch { /* ignore */ }
  fs.rmSync(path.join(DATA_DIR, `v_${id}`), { recursive: true, force: true });
}

const CHUNK_LIMIT = 9 * 1024 * 1024; // 客户端每块明文 4MB，留余量
const MAX_CHUNKS = 2000;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 流式返回文件，支持 Range（bytes=a-b），不把大文件读进内存
function sendFile(req, res, fp, mime = 'application/octet-stream') {
  let st;
  try { st = fs.statSync(fp); } catch { return sendJson(res, 404, { error: 'not_found' }); }
  const size = st.size;
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && (r[1] || r[2])) {
    let start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
    let end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'baby-record-photo', version: '1.14.0', features: ['photo', 'video-chunks', 'range', 'plain-file'] }));
    return;
  }

  // v1.14.0 明文：PUT /v1/file/:id/:n?total=N&taken=ms&ext=jpg&mime=…（256KB 分块，收齐自动拼成普通文件）
  //   GET /v1/file/:id（原样文件，支持 Range）；GET /v1/file/:id?info=1 → 索引；DELETE /v1/file/:id（明文+旧密文都删）
  //   DELETE /v1/legacy/:id → 只删旧密文（迁移完成后用）
  const lm = /^\/v1\/legacy\/([^/]+)\/?$/.exec(url.pathname);
  if (lm) {
    const lid = safeId(decodeURIComponent(lm[1]));
    if (!lid) return sendJson(res, 400, { error: 'bad_id' });
    if (!checkAuth(req, res)) return;
    if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'method_not_allowed' });
    deleteLegacy(lid);
    return sendJson(res, 200, { ok: true, id: lid });
  }
  const fm = /^\/v1\/file\/([^/]+)(?:\/(\d{1,5}))?\/?$/.exec(url.pathname);
  if (fm) {
    const fid = safeId(decodeURIComponent(fm[1]));
    if (!fid) return sendJson(res, 400, { error: 'bad_id' });
    if (!checkAuth(req, res)) return;
    try {
      if (fm[2] == null) {
        if (req.method === 'DELETE') { deletePlain(fid); deleteLegacy(fid); return sendJson(res, 200, { ok: true, id: fid }); }
        if (req.method === 'GET') {
          const idx = readIndex(fid);
          if (!idx) return sendJson(res, 404, { error: 'not_found' });
          if (url.searchParams.get('info')) return sendJson(res, 200, idx);
          return sendFile(req, res, path.join(DATA_DIR, idx.path), idx.mime);
        }
        return sendJson(res, 405, { error: 'method_not_allowed' });
      }
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'method_not_allowed' });
      const n = Number(fm[2]);
      const total = Number(url.searchParams.get('total'));
      if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || n >= total) return sendJson(res, 400, { error: 'bad_total' });
      const sdir = path.join(STAGE_DIR, fid);
      fs.mkdirSync(sdir, { recursive: true });
      const body = await readBody(req, CHUNK_LIMIT);
      if (!body.length) return sendJson(res, 400, { error: 'empty' });
      const fp = path.join(sdir, `${n}.part`);
      fs.writeFileSync(fp + '.tmp', body);
      fs.renameSync(fp + '.tmp', fp);
      let done = true;
      for (let i = 0; i < total; i++) if (!fs.existsSync(path.join(sdir, `${i}.part`))) { done = false; break; }
      if (!done) return sendJson(res, 200, { ok: true, id: fid, n, bytes: body.length, complete: false });
      const idx = finalizeFile(fid, total, {
        taken: url.searchParams.get('taken'), ext: url.searchParams.get('ext'), mime: url.searchParams.get('mime'),
      });
      return sendJson(res, 200, { ok: true, id: fid, n, bytes: body.length, complete: true, path: idx.path, size: idx.size });
    } catch (e) {
      console.error(e);
      if (e.message === 'body too large') return sendJson(res, 413, { error: 'too_large' });
      return sendJson(res, 500, { error: 'server_error', message: String(e.message || e) });
    }
  }

  // v1.10.0 视频：分块密文 /v1/video/:id/:n（每块单独 AES-GCM），DELETE /v1/video/:id 删整段
  const vm = /^\/v1\/video\/([^/]+)(?:\/(\d{1,5}))?\/?$/.exec(url.pathname);
  if (vm) {
    const vid = safeId(decodeURIComponent(vm[1]));
    if (!vid) return sendJson(res, 400, { error: 'bad_id' });
    if (!checkAuth(req, res)) return;
    const dir = path.join(DATA_DIR, `v_${vid}`);
    try {
      if (vm[2] == null) {
        if (req.method === 'DELETE') { fs.rmSync(dir, { recursive: true, force: true }); return sendJson(res, 200, { ok: true, id: vid }); }
        if (req.method === 'GET') {
          const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.bin$/.test(f)).length : 0;
          return sendJson(res, n ? 200 : 404, { id: vid, chunks: n });
        }
        return sendJson(res, 405, { error: 'method_not_allowed' });
      }
      const n = Number(vm[2]);
      if (n > MAX_CHUNKS) return sendJson(res, 400, { error: 'too_many_chunks' });
      const fp = path.join(dir, `${n}.bin`);
      if (req.method === 'PUT') {
        fs.mkdirSync(dir, { recursive: true });
        const body = await readBody(req, CHUNK_LIMIT);
        if (!body.length) return sendJson(res, 400, { error: 'empty' });
        fs.writeFileSync(fp + '.tmp', body);
        fs.renameSync(fp + '.tmp', fp);
        return sendJson(res, 200, { ok: true, id: vid, n, bytes: body.length });
      }
      if (req.method === 'GET') return sendFile(req, res, fp);
      return sendJson(res, 405, { error: 'method_not_allowed' });
    } catch (e) {
      console.error(e);
      if (e.message === 'body too large') return sendJson(res, 413, { error: 'too_large' });
      return sendJson(res, 500, { error: 'server_error', message: String(e.message || e) });
    }
  }

  const m = /^\/v1\/photo\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  const id = safeId(decodeURIComponent(m[1]));
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'bad_id' }));
    return;
  }
  if (!checkAuth(req, res)) return;

  const fp = filePath(id);

  try {
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'empty' }));
        return;
      }
      fs.writeFileSync(fp, body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, id, bytes: body.length }));
      return;
    }
    if (req.method === 'GET') return sendFile(req, res, fp);
    if (req.method === 'DELETE') {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, id }));
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'server_error', message: String(e.message || e) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[baby-record-photo] http://0.0.0.0:${PORT}  DATA_DIR=${DATA_DIR}  TOKEN=${TOKEN ? 'on' : 'off'}`);
});
