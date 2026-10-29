// 照片服务协议单测：node --test test.mjs（会起临时端口）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-photo-'));
const port = 18789 + Math.floor(Math.random() * 1000);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

const child = spawn(process.execPath, ['server.js'], {
  cwd: here,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, PHOTO_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await wait(400);

async function req(method, p, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, body, headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, json: () => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } } };
}

try {
  await test('health', async () => {
    const r = await req('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.json().service, 'baby-record-photo');
  });

  await test('PUT/GET/DELETE 密文往返', async () => {
    const id = 'abc123xyz';
    const payload = Buffer.from([1, 2, 3, 4, 5, 9, 8, 7]);
    const put = await req('PUT', `/v1/photo/${id}`, payload, { 'Content-Type': 'application/octet-stream' });
    assert.equal(put.status, 200);
    assert.equal(put.json().bytes, payload.length);
    const get = await req('GET', `/v1/photo/${id}`);
    assert.equal(get.status, 200);
    assert.deepEqual([...get.buf], [...payload]);
    const del = await req('DELETE', `/v1/photo/${id}`);
    assert.equal(del.status, 200);
    const miss = await req('GET', `/v1/photo/${id}`);
    assert.equal(miss.status, 404);
  });

  await test('非法 id 拒绝', async () => {
    const r = await req('PUT', '/v1/photo/ab', Buffer.from('x')); // 太短
    assert.equal(r.status, 400);
    const r2 = await req('PUT', '/v1/photo/bad.id!', Buffer.from('x'));
    assert.equal(r2.status, 400);
  });

  await test('CORS 预检允许 GitHub Pages', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/photo/abc123xy`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://lj-lioo.github.io', 'Access-Control-Request-Method': 'PUT' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://lj-lioo.github.io');
  });
} finally {
  child.kill('SIGTERM');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
