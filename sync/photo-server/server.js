#!/usr/bin/env node
// 宝宝记录 · 极空间照片服务（只存 AES-GCM 密文，不碰明文）
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
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
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
      if (n > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
    res.end(JSON.stringify({ ok: true, service: 'baby-record-photo', version: '1.8.0' }));
    return;
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
    if (req.method === 'GET') {
      if (!fs.existsSync(fp)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const buf = fs.readFileSync(fp);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buf.length,
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(buf);
      return;
    }
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
