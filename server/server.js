// 宝宝记录 · 推送服务（极简）：保存订阅与提醒计划，到点发送 Web Push。
// 运行：node server.js  （环境变量 PORT，默认 8787）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(DIR, 'data', 'db.json');
const VAPID_FILE = path.join(DIR, 'data', 'vapid.json');
const PORT = Number(process.env.PORT || 8787);
const SUBJECT = process.env.VAPID_SUBJECT || 'https://lj-lioo.github.io/baby-record/';
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

let vapid;
if (fs.existsSync(VAPID_FILE)) vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
else { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 }); }
webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);

// db: { devices: { [deviceId]: { subscription, appUrl, reminders: [{id, fireAt, title, body, url, eventId, ev, sentAt}], updatedAt } } }
let db = { devices: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* new */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  }, 200);
}
const log = (...a) => console.log(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), ...a);

// ---- 文案：按发送时的日期生成「今天/明天」（Asia/Shanghai, UTC+8 无夏令时）----
const TZ_MS = 8 * 3600e3;
const dayNum = (ms) => Math.floor((ms + TZ_MS) / 864e5);
const dayNumOfYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
function relWord(dateStr, now) {
  const n = dayNumOfYmd(dateStr) - dayNum(now);
  if (n === 0) return '今天'; if (n === 1) return '明天'; if (n === 2) return '后天'; if (n === -1) return '昨天';
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}
const CAT = { vaccine: '💉 疫苗', checkup: '🩺 体检', other: '⭐ 其他重要事项' };
function humanDur(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}小时${r}分钟` : `${h}小时`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}天${rh}小时` : `${d}天`;
}
function buildText(r, now) {
  const ev = r.ev;
  if (!ev || !ev.date) return { title: r.title || '宝宝提醒', body: r.body || '' };
  const title = `宝宝提醒：${relWord(ev.date, now)}${ev.time ? ' ' + ev.time : ''} ${ev.title}`;
  const [y, mo, d] = ev.date.split('-').map(Number);
  const [hh, mm] = (ev.time || '00:00').split(':').map(Number);
  const start = Date.UTC(y, mo - 1, d, hh, mm) - TZ_MS;
  let why;
  if (!ev.time) why = `${relWord(ev.date, now)}有「${ev.title}」`;
  else if (start - now > 60000) why = `距离「${ev.title}」还有${humanDur(start - now)}`;
  else if (start - now > -60000) why = `「${ev.title}」现在开始`;
  else why = `「${ev.title}」已开始${humanDur(start - now)}`;
  let body = `${CAT[ev.category] || ''} · ${mo}月${d}日${ev.time ? ' ' + ev.time : '（全天）'}\n${ev.label || '提醒'} · ${why}`;
  if (ev.note) body += `\n备注：${ev.note}`;
  return { title, body };
}

async function sendTo(deviceId, r) {
  const dev = db.devices[deviceId];
  if (!dev || !dev.subscription) return { ok: false, error: 'no-subscription' };
  const now = Date.now();
  const { title, body } = buildText(r, now);
  const payload = JSON.stringify({ id: r.id, eventId: r.eventId, title, body, url: r.url || dev.appUrl, fireAt: r.fireAt });
  try {
    const res = await webpush.sendNotification(dev.subscription, payload, { TTL: 6 * 3600, urgency: 'high', topic: undefined });
    log('push ok', deviceId.slice(0, 8), res.statusCode, title);
    return { ok: true, status: res.statusCode, title, body };
  } catch (e) {
    log('push fail', deviceId.slice(0, 8), e.statusCode, e.body || e.message);
    if (e.statusCode === 404 || e.statusCode === 410) { dev.subscription = null; save(); }
    return { ok: false, status: e.statusCode, error: String(e.body || e.message) };
  }
}

// ---- 调度：每 5 秒检查到点的提醒 ----
let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  try {
    const now = Date.now();
    for (const [id, dev] of Object.entries(db.devices)) {
      if (!dev.subscription) continue;
      for (const r of dev.reminders || []) {
        if (r.sentAt || r.fireAt > now) continue;
        if (now - r.fireAt > 6 * 3600e3) { r.sentAt = -1; continue; } // 太久以前的不补发
        r.sentAt = now; save();
        const res = await sendTo(id, r);
        r.result = res.ok ? 'ok' : `fail:${res.status || ''}`;
      }
      // 清理 2 天前已发送的
      dev.reminders = (dev.reminders || []).filter((r) => !r.sentAt || now - r.fireAt < 2 * 864e5);
    }
    save();
  } finally { ticking = false; }
}
setInterval(tick, 5000);

// ---- HTTP API ----
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; req.setEncoding('utf8');
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s);
const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys && s.keys.p256dh && s.keys.auth;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, time: Date.now(), devices: Object.keys(db.devices).length });
    if (url.pathname === '/api/vapid-public-key') return send(res, 200, { publicKey: vapid.publicKey });
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (!validId(body.deviceId)) return send(res, 400, { error: 'bad deviceId' });
    const dev = (db.devices[body.deviceId] ||= { reminders: [], subscription: null });
    if (url.pathname === '/api/subscribe') {
      if (!validSub(body.subscription)) return send(res, 400, { error: 'bad subscription' });
      dev.subscription = { endpoint: body.subscription.endpoint, keys: body.subscription.keys };
      if (typeof body.appUrl === 'string' && /^https?:\/\//.test(body.appUrl)) dev.appUrl = body.appUrl;
      dev.updatedAt = Date.now(); save();
      log('subscribe', body.deviceId.slice(0, 8), new URL(dev.subscription.endpoint).host);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/unsubscribe') { dev.subscription = null; dev.reminders = []; save(); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/sync') {
      const incoming = Array.isArray(body.reminders) ? body.reminders.slice(0, 500) : [];
      const prev = new Map((dev.reminders || []).map((r) => [r.id, r]));
      dev.reminders = incoming.filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.fireAt)).map((r) => {
        const old = prev.get(r.id);
        return {
          id: r.id.slice(0, 200), fireAt: r.fireAt, eventId: String(r.eventId || '').slice(0, 64),
          title: String(r.title || '').slice(0, 200), body: String(r.body || '').slice(0, 1000), url: String(r.url || '').slice(0, 600),
          ev: r.ev && typeof r.ev === 'object' ? { title: String(r.ev.title || '').slice(0, 100), date: String(r.ev.date || ''), time: String(r.ev.time || ''), note: String(r.ev.note || '').slice(0, 500), category: String(r.ev.category || ''), label: String(r.ev.label || '').slice(0, 60) } : null,
          sentAt: old && old.fireAt === r.fireAt ? old.sentAt : undefined,
        };
      });
      // 保留测试提醒
      for (const r of prev.values()) if (r.id.startsWith('test-') && !r.sentAt) dev.reminders.push(r);
      dev.updatedAt = Date.now(); save();
      const pending = dev.reminders.filter((r) => !r.sentAt).length;
      return send(res, 200, { ok: true, pending, next: dev.reminders.filter((r) => !r.sentAt).sort((a, b) => a.fireAt - b.fireAt)[0]?.fireAt || null });
    }
    if (url.pathname === '/api/test') {
      const delay = Math.min(Math.max(Number(body.delaySec) || 0, 0), 3600);
      const fireAt = Date.now() + delay * 1000;
      const d = new Date(fireAt + TZ_MS);
      const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const ymd = d.toISOString().slice(0, 10);
      const r = {
        id: `test-${Date.now()}`, fireAt, eventId: 'demo',
        url: (dev.appUrl || body.appUrl || '') + '#/settings',
        ev: { title: '测试提醒（推送正常 🎉）', date: ymd, time: hhmm, note: '收到这条通知说明推送提醒已经可以用了', category: 'other', label: '测试' },
      };
      if (delay === 0) { r.sentAt = Date.now(); const out = await sendTo(body.deviceId, r); return send(res, out.ok ? 200 : 502, out); }
      dev.reminders.push(r); save();
      return send(res, 200, { ok: true, scheduledAt: fireAt });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', e.message);
    return send(res, 500, { error: 'server error' });
  }
});
server.listen(PORT, () => log(`推送服务已启动 :${PORT}`));
