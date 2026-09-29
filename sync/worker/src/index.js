// 宝宝记录 · 云同步 Worker
// 协议：POST /v1/sync  Authorization: Bearer <token>
//   请求 { since: <游标>, changes: [{ id, updatedAt, deleted, data }] }
//   响应 { cursor, more, accepted: [id], conflicts: [记录], changes: [记录] }
// - token 由客户端从同步密钥派生（HKDF），服务端只保存 sha256(token) 作为空间 id；
// - data 是客户端加密后的密文（AES-GCM），服务端只看 id / updatedAt / deleted 做合并；
// - 合并规则：同一 id 取 updatedAt 更大者（最后写入者胜）；删除用 tombstone（deleted=1）保留，以便同步到其他设备。

const MAX_BODY = 1024 * 1024;       // 单次请求最大 1MB
const MAX_CHANGES = 500;            // 单次最多提交 500 条
const MAX_DATA = 32 * 1024;         // 单条密文最大 32KB
const MAX_RECORDS = 20000;          // 每个空间最多 20000 条记录
const PAGE = 500;                   // 每次最多返回 500 条变更
const ID_RE = /^[A-Za-z0-9_:.-]{1,80}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/' || url.pathname === '/v1/health') {
        return json({ ok: true, service: 'baby-record-sync', version: 1 }, 200, cors);
      }
      if (url.pathname === '/v1/sync' && req.method === 'POST') return await handleSync(req, env, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status, cors);
      console.error(e);
      return json({ error: 'server_error' }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function spaceOf(req, env) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') || '');
  if (!m || !TOKEN_RE.test(m[1])) throw new HttpError(401, 'unauthorized', '缺少或无效的同步令牌');
  const space = await sha256Hex(m[1]);
  const allow = String(env.SPACE_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(space)) throw new HttpError(403, 'forbidden', '此同步空间未被允许');
  return space;
}

function validChange(c) {
  return c && typeof c === 'object' && typeof c.id === 'string' && ID_RE.test(c.id)
    && Number.isSafeInteger(c.updatedAt) && c.updatedAt > 0
    && (c.deleted ? (c.data == null) : (typeof c.data === 'string' && c.data.length > 0 && c.data.length <= MAX_DATA));
}

const rowOut = (r) => ({ id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.data ?? null, seq: r.seq });

async function handleSync(req, env, cors) {
  const space = await spaceOf(req, env);
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large');
  let body;
  try { body = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'bad_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json');
  if (body.changes != null && !Array.isArray(body.changes)) throw new HttpError(400, 'bad_change');
  const since = Number.isSafeInteger(body.since) && body.since > 0 ? body.since : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) throw new HttpError(413, 'too_many_changes');
  if (!changes.every(validChange)) throw new HttpError(400, 'bad_change');
  // 同一请求内同一 id 只保留最新的一条
  const byId = new Map();
  for (const c of changes) if (!byId.has(c.id) || byId.get(c.id).updatedAt < c.updatedAt) byId.set(c.id, c);
  const list = [...byId.values()];

  const accepted = [];
  const conflicts = [];
  if (list.length) {
    const db = env.DB;
    const cnt = await db.prepare('SELECT COUNT(*) AS n FROM records WHERE space = ?1').bind(space).first();
    if ((cnt?.n || 0) + list.length > MAX_RECORDS) throw new HttpError(507, 'quota_exceeded', '同步空间已满');
    // 一个 batch = 一个事务：逐条「更新时间更新才覆盖」，并分配递增的 seq
    const upsert = db.prepare(`INSERT INTO records (space, id, updated_at, deleted, data, seq)
      VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE space = ?1))
      ON CONFLICT (space, id) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted,
        data = excluded.data, seq = excluded.seq
      WHERE excluded.updated_at > records.updated_at`);
    const results = await db.batch(list.map((c) => upsert.bind(space, c.id, c.updatedAt, c.deleted ? 1 : 0, c.deleted ? null : c.data)));
    const lost = [];
    results.forEach((r, i) => { if (r.meta && r.meta.changes > 0) accepted.push(list[i].id); else lost.push(list[i].id); });
    // 被拒绝的（服务端已有更新或相同的版本）：把服务端当前版本回给客户端
    for (let i = 0; i < lost.length; i += 50) {
      const ids = lost.slice(i, i + 50);
      const q = `SELECT id, updated_at, deleted, data, seq FROM records WHERE space = ?1 AND id IN (${ids.map((_, k) => `?${k + 2}`).join(',')})`;
      const { results: rows } = await db.prepare(q).bind(space, ...ids).all();
      conflicts.push(...rows.map(rowOut));
    }
  }

  const { results: rows } = await env.DB.prepare(
    'SELECT id, updated_at, deleted, data, seq FROM records WHERE space = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3',
  ).bind(space, since, PAGE + 1).all();
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE).map(rowOut);
  let cursor = since;
  if (page.length) cursor = page[page.length - 1].seq;
  return json({ cursor, more, accepted, conflicts, changes: page, serverTime: Date.now() }, 200, cors);
}
