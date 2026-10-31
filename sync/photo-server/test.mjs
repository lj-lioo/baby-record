// 照片服务协议单测：node --test test.mjs（会起临时端口）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-photo-'));
// 直接测试 HTTP handler/真实文件流，不占本机端口，受限环境也能执行。
process.env.DATA_DIR = dataDir;
process.env.PHOTO_TOKEN = '';
const { handleRequest } = await import('./server.js?test');
async function req(method, p, body, headers = {}, handler = handleRequest) {
  const input = new PassThrough();
  input.method = method; input.url = p;
  input.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = []; const outHeaders = {};
  const output = new Writable({ write(chunk, _, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  output.setHeader = (key, value) => { outHeaders[key.toLowerCase()] = String(value); };
  output.writeHead = (status, hdr = {}) => { output.statusCode = status; for (const [k, v] of Object.entries(hdr)) output.setHeader(k, v); };
  const done = new Promise((resolve, reject) => { output.on('finish', resolve); output.on('error', reject); });
  const handling = handler(input, output);
  input.end(body);
  await handling; await done;
  const buf = Buffer.concat(chunks);
  return { status: output.statusCode, buf, headers: outHeaders, json: () => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } } };
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
    const res = await req('OPTIONS', '/v1/photo/abc123xy', undefined, { Origin: 'https://lj-lioo.github.io', 'Access-Control-Request-Method': 'PUT' });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://lj-lioo.github.io');
  });
  await test('照片 Range 读取', async () => {
    const id = 'rng123xyz';
    await req('PUT', `/v1/photo/${id}`, Buffer.from([0,1,2,3,4,5,6,7,8,9]));
    const r = await req('GET', `/v1/photo/${id}`, undefined, { Range: 'bytes=2-5' });
    assert.equal(r.status, 206);
    assert.deepEqual([...r.buf], [2,3,4,5]);
  });

  await test('视频分块 PUT/GET/列出/DELETE', async () => {
    const id = 'vid123xyz';
    for (let n = 0; n < 3; n++) {
      const put = await req('PUT', `/v1/video/${id}/${n}`, Buffer.alloc(1000 + n, n));
      assert.equal(put.status, 200);
    }
    assert.equal((await req('GET', `/v1/video/${id}`)).json().chunks, 3);
    const g = await req('GET', `/v1/video/${id}/2`);
    assert.equal(g.buf.length, 1002); assert.equal(g.buf[0], 2);
    assert.equal((await req('DELETE', `/v1/video/${id}`)).status, 200);
    assert.equal((await req('GET', `/v1/video/${id}/0`)).status, 404);
  });

  await test('视频块过大 413', async () => {
    const r = await req('PUT', '/v1/video/big123xyz/0', Buffer.alloc(10 * 1024 * 1024));
    assert.equal(r.status, 413);
  });
  await test('明文分块拼接 / Range / 中图缩略图独立 / 删除', async () => {
    const id = 'plain123xyz';
    const payload = Buffer.alloc(600 * 1024, 7);
    for (const [suffix, body] of [['', payload], ['-m', Buffer.from('medium')], ['-t', Buffer.from('thumb')]]) {
      const total = Math.ceil(body.length / (256 * 1024));
      for (let n = 0; n < total; n++) {
        const r = await req('PUT', `/v1/file/${id}${suffix}/${n}?total=${total}&ext=jpg&mime=image/jpeg&taken=1793239200000`, body.subarray(n * 256 * 1024, (n + 1) * 256 * 1024));
        assert.equal(r.status, 200); assert.equal(r.json().complete, n === total - 1);
      }
    }
    assert.deepEqual((await req('GET', `/v1/file/${id}`)).buf, payload);
    const range = await req('GET', `/v1/file/${id}`, undefined, { Range: 'bytes=10-19' });
    assert.equal(range.status, 206); assert.equal(range.buf.length, 10);
    assert.equal(range.headers['content-range'], `bytes 10-19/${payload.length}`);
    assert.equal((await req('GET', `/v1/file/${id}`, undefined, { Range: 'bytes=-8' })).buf.length, 8);
    assert.equal((await req('GET', `/v1/file/${id}`, undefined, { Range: 'bytes=9999999-' })).status, 416);
    assert.equal((await req('GET', `/v1/file/${id}-m`)).buf.toString(), 'medium');
    assert.equal((await req('GET', `/v1/file/${id}-t`)).buf.toString(), 'thumb');
    assert.equal((await req('DELETE', `/v1/file/${id}`)).status, 200);
    assert.equal((await req('GET', `/v1/file/${id}`)).status, 404);
  });
  await test('鉴权：旧 Bearer + GET 查询；查询不能写入/删除', async () => {
    process.env.PHOTO_TOKEN = 'test-only-token';
    const { handleRequest: auth } = await import('./server.js?auth-test');
    const call = (method, p, body, headers) => req(method, p, body, headers, auth);
    assert.equal((await call('PUT', '/v1/file/auth123xyz/0?total=1&ext=jpg', Buffer.from('abc'))).status, 401);
    assert.equal((await call('PUT', '/v1/file/auth123xyz/0?total=1&ext=jpg', Buffer.from('abc'), { Authorization: 'Bearer test-only-token' })).status, 200);
    assert.equal((await call('GET', '/v1/file/auth123xyz?access_token=wrong')).status, 401);
    const r = await call('GET', '/v1/file/auth123xyz?access_token=test-only-token', undefined, { Range: 'bytes=1-2' });
    assert.equal(r.status, 206); assert.equal(r.buf.toString(), 'bc');
    assert.equal((await call('DELETE', '/v1/file/auth123xyz?access_token=test-only-token')).status, 401);
    assert.equal((await call('PUT', '/v1/file/auth123xyz/0?total=1&access_token=test-only-token', Buffer.from('x'))).status, 401);
    assert.equal((await call('GET', '/v1/file/auth123xyz', undefined, { Authorization: 'Bearer test-only-token' })).status, 200);
  });

} finally {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
