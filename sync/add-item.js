#!/usr/bin/env node
// 宝宝记录 · 云同步命令行（在盒子上运行）：用与手机相同的同步密钥添加 / 查看 / 完成 / 删除事项。
// 密钥与服务地址保存在 ~/.config/baby-record/sync.env（权限 600，不在仓库里）。
//
//   node add-item.js init [--url https://…]      生成同步密钥（已有则保留）并保存
//   node add-item.js set-url https://…            设置 Worker 地址
//   node add-item.js status                       查看配置和云端事项数
//   node add-item.js pair [--qr 文件.png] [--text] 给手机的配对二维码：默认内容是 App 配对链接 …/#pair=<密钥>（--text 只放密钥）；不加 --qr 则打印
//   node add-item.js add --title 标题 --date 2026-10-01 [--time 10:00] [--category vaccine|checkup|other]
//                        [--note 备注] [--remind eve20,morning8,h1|none]
//   node add-item.js shop 尿不湿NB码 湿巾 [--date 2026-10-01] [--time 10:00]   添加一条「🛒 购物清单」事项
//   node add-item.js list [--from 日期] [--to 日期] [--all] [--json]
//   node add-item.js done <id>     |  undone <id>  |  delete <id>
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = fs.readFileSync(path.join(here, '../site/js/sync-core.js'), 'utf8');
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSrc).toString('base64'));

const ENV_FILE = process.env.BABY_SYNC_ENV || path.join(os.homedir(), '.config/baby-record/sync.env');
const PRESETS = ['eve20', 'morning8', 'd1', 'h2', 'h1', 'm30', 'm0'];
const CAT = { vaccine: '💉疫苗', checkup: '🩺体检', other: '📌其他' };

function readEnv() {
  const out = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { url: process.env.BABY_SYNC_URL || out.BABY_SYNC_URL || '', key: process.env.BABY_SYNC_KEY || out.BABY_SYNC_KEY || '' };
}
function writeEnv({ url, key }) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(ENV_FILE, `# 宝宝记录云同步（请勿提交到仓库、请勿发到聊天）\nBABY_SYNC_URL=${url || ''}\nBABY_SYNC_KEY=${key || ''}\n`, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

const pad = (n) => String(n).padStart(2, '0');
function today() {
  // 以 Asia/Shanghai 的日期为准
  const d = new Date(Date.now() + 8 * 3600e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fingerprint = (key) => `${key.slice(0, 9)}…${key.slice(-4)}`;

function need(cfg, withUrl = true) {
  if (!cfg.key) throw new Error(`还没有同步密钥：先运行 node add-item.js init（配置文件 ${ENV_FILE}）`);
  if (withUrl && !cfg.url) throw new Error('还没有设置 Worker 地址：node add-item.js set-url https://…');
}

// 拉取云端全部记录并解密，返回 { events: Map(id -> {rec, event}), profile, cursor }
async function pullAll(cfg, keys) {
  const events = new Map();
  let since = 0, profile = null, more = true;
  while (more) {
    const res = await core.syncRequest(cfg.url, keys.token, { since, changes: [] });
    for (const r of res.changes) {
      if (r.id.startsWith(core.EVENT_PREFIX)) {
        const id = r.id.slice(core.EVENT_PREFIX.length);
        if (r.deleted) { events.delete(id); continue; }
        const obj = await core.unseal(keys.enc, r.id, r.updatedAt, r.data);
        events.set(id, { rec: r, event: obj.event });
      } else if (r.id === core.PROFILE_ID && !r.deleted) {
        profile = (await core.unseal(keys.enc, r.id, r.updatedAt, r.data)).profile;
      }
    }
    since = res.cursor; more = res.more;
  }
  return { events, profile, cursor: since };
}

async function pushEvents(cfg, keys, list) {
  const changes = [];
  for (const { event, deleted } of list) {
    const rid = core.EVENT_PREFIX + event.id;
    if (deleted) changes.push({ id: rid, updatedAt: event.updatedAt, deleted: true, data: null });
    else changes.push({ id: rid, updatedAt: event.updatedAt, deleted: false, data: await core.seal(keys.enc, rid, event.updatedAt, { type: 'event', event }) });
  }
  const res = await core.syncRequest(cfg.url, keys.token, { since: 0, changes });
  const rejected = changes.filter((c) => !res.accepted.includes(c.id));
  if (rejected.length) throw new Error(`云端已有更新的版本，未写入：${rejected.map((c) => c.id).join(', ')}`);
  return res;
}

function makeEvent({ title, date, time = '', category = 'other', note = '', remind }) {
  if (!title) throw new Error('缺少 --title');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日期格式应为 YYYY-MM-DD');
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error('时间格式应为 HH:MM');
  if (!CAT[category]) throw new Error('类别只能是 vaccine / checkup / other');
  let presets;
  if (remind === undefined || remind === true) presets = time ? ['eve20', 'morning8', 'h1'] : ['eve20', 'morning8'];
  else if (remind === 'none') presets = [];
  else presets = String(remind).split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of presets) if (!PRESETS.includes(p)) throw new Error(`未知提醒：${p}（可用 ${PRESETS.join(',')} 或 none）`);
  const now = Date.now();
  return {
    id: uid(), date, time, title: String(title).trim(), category, note: String(note || ''), done: false,
    reminders: presets.map((p) => ({ id: uid(), kind: 'preset', preset: p })),
    alarmAdded: false, alarmSig: '', scheduleId: '', createdAt: now, updatedAt: now, source: 'box-cli',
  };
}

function fmt(e) {
  return `${e.done ? '✅' : '⬜'} ${e.date}${e.time ? ' ' + e.time : ''}  ${CAT[e.category] || e.category}  ${e.title}${e.note ? `  — ${e.note.replace(/\n/g, ' / ')}` : ''}  [${e.id}]`;
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const cfg = readEnv();

  if (cmd === 'init') {
    const next = { url: typeof opt.url === 'string' ? opt.url.replace(/\/+$/, '') : cfg.url, key: cfg.key || core.newSyncKey() };
    writeEnv(next);
    console.log(`${cfg.key ? '已有' : '已生成新的'}同步密钥（${fingerprint(next.key)}），保存在 ${ENV_FILE}`);
    console.log(`Worker 地址：${next.url || '（未设置）'}`);
    return;
  }
  if (cmd === 'set-url') {
    const url = (pos[0] || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('用法：set-url https://…');
    writeEnv({ ...cfg, url });
    console.log(`已保存 Worker 地址：${url}`);
    return;
  }
  if (cmd === 'pair') {
    need(cfg, false);
    const APP = process.env.BABY_APP_URL || 'https://lj-lioo.github.io/baby-record/';
    const payload = opt.text ? cfg.key : `${APP}#pair=${cfg.key}`;  // # 后面的内容不会发给任何服务器
    if (typeof opt.qr === 'string') {
      const QR = (await import('qrcode')).default;
      await QR.toFile(opt.qr, payload, { width: 560, margin: 3, errorCorrectionLevel: 'M' });
      fs.chmodSync(opt.qr, 0o600);
      console.log(`二维码已保存到 ${opt.qr}（含同步密钥，扫完请删除）`);
    } else {
      console.log(payload);
    }
    return;
  }
  if (cmd === 'status') {
    console.log(`配置文件：${ENV_FILE}${fs.existsSync(ENV_FILE) ? '' : '（不存在）'}`);
    console.log(`Worker 地址：${cfg.url || '（未设置）'}`);
    console.log(`同步密钥：${cfg.key ? fingerprint(cfg.key) : '（未生成）'}`);
    if (cfg.url && cfg.key) {
      const keys = await core.deriveKeys(cfg.key);
      const { events, profile, cursor } = await pullAll(cfg, keys);
      console.log(`云端事项：${events.size} 个；宝宝生日：${profile?.babyBirthday || '未设置'}；游标 ${cursor}`);
    }
    return;
  }

  need(cfg);
  const keys = await core.deriveKeys(cfg.key);

  if (cmd === 'add' || cmd === 'shop') {
    let ev;
    if (cmd === 'shop') {
      if (!pos.length) throw new Error('用法：shop 物品1 物品2 … [--date 日期]');
      ev = makeEvent({ title: `🛒 购物清单：${pos.join('、')}`, date: opt.date || today(), time: opt.time || '', category: 'other',
        note: pos.map((p) => `□ ${p}`).join('\n') + (opt.note ? `\n${opt.note}` : ''), remind: opt.remind ?? (opt.time ? undefined : 'none') });
    } else {
      ev = makeEvent({ title: opt.title, date: opt.date || today(), time: opt.time || '', category: opt.category || 'other', note: opt.note || '', remind: opt.remind });
    }
    await pushEvents(cfg, keys, [{ event: ev }]);
    console.log(`已添加：${fmt(ev)}`);
    return;
  }

  const { events } = await pullAll(cfg, keys);
  const all = [...events.values()].map((x) => x.event).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));

  if (cmd === 'list') {
    const from = opt.all ? '' : (opt.from || today());
    const to = opt.to || '9999-12-31';
    const list = all.filter((e) => e.date >= from && e.date <= to);
    if (opt.json) console.log(JSON.stringify(list, null, 2));
    else { list.forEach((e) => console.log(fmt(e))); console.log(`共 ${list.length} 个${opt.all ? '' : `（${from} 起，--all 看全部）`}`); }
    return;
  }
  if (cmd === 'done' || cmd === 'undone' || cmd === 'delete') {
    const id = pos[0];
    const hit = events.get(id);
    if (!hit) throw new Error(`找不到事项 ${id}（先 list 看 id）`);
    const ev = { ...hit.event, updatedAt: Math.max(Date.now(), hit.rec.updatedAt + 1) };
    if (cmd === 'delete') { await pushEvents(cfg, keys, [{ event: ev, deleted: true }]); console.log(`已删除：${hit.event.title}`); return; }
    ev.done = cmd === 'done';
    await pushEvents(cfg, keys, [{ event: ev }]);
    console.log(`已更新：${fmt(ev)}`);
    return;
  }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
