#!/usr/bin/env node
// 宝宝记录 · 云同步命令行（在盒子上运行）：用与手机相同的同步密钥添加 / 查看 / 完成 / 删除事项。
// 密钥与服务地址保存在 ~/.config/baby-record/sync.env（权限 600，不在仓库里）。
//
//   node add-item.js init [--url https://…]      生成同步密钥（已有则保留）并保存
//   node add-item.js use-key                      采用环境变量 $BABY_SYNC_KEY 里的密钥（例如手机生成的）写入配置文件（同 init --key-from-env）
//   node add-item.js set-url https://…            设置 Worker 地址
//   node add-item.js status                       查看配置和云端事项数
//   node add-item.js pair [--qr 文件.png] [--text] 给手机的配对二维码：默认内容是 App 配对链接 …/#pair=<密钥>（--text 只放密钥）；不加 --qr 则打印
//   node add-item.js add --title 标题 --date 2026-10-01 [--time 10:00] [--category vaccine|paidvax|checkup|other]
//                        [--note 备注] [--remind eve20,morning8,h1|none] [--schedule-id paid:xxx]（同 scheduleId 已存在则不重复添加）
//                        [--earliest 日期] [--latest 日期]（接种窗口，可不填；--date 是计划日期）
//   node add-item.js plan paid|vaccine|checkup [--dry-run] [--birthday 2026-09-17] [--include-optional]
//                        按 App 同一个生成器写入云端（09:00，提醒前一天20:00+当天08:00；跳过已过的和云端已有同 scheduleId 的）；plan-paid 同 plan paid
//   node add-item.js refresh-notes checkup|vaccine|paid [--dry-run] [--birthday …]
//                        用最新生成器的备注原地更新云端已有的计划事项（按 scheduleId 匹配；只改备注和 updatedAt，
//                        id/日期/时间/提醒/已完成/已设闹钟都保留；备注被手动改过（不是生成器格式）的跳过；不新增事项）
//   node add-item.js refresh-windows [all|vaccine|paid|checkup] [--dry-run] [--birthday …]
//                        v1.6.0：给云端已有的计划事项补上/更新接种窗口（最早 earliest、最迟 latest、说明 windowNote），按 scheduleId 匹配；
//                        只改这三个字段和 updatedAt，计划日期/时间/备注/提醒/已完成/已设闹钟都不动；不新增事项
//   node add-item.js shop 尿不湿NB码 湿巾 [--date 2026-10-01] [--time 10:00]   添加一条「🛒 购物清单」事项
//   node add-item.js list [--from 日期] [--to 日期] [--all] [--json]
//   node add-item.js done <id>     |  undone <id>  |  delete <id>
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = fs.readFileSync(path.join(here, '../site/js/sync-core.js'), 'utf8');
const core = await import('data:text/javascript;base64,' + Buffer.from(coreSrc).toString('base64'));

const ENV_FILE = process.env.BABY_SYNC_ENV || path.join(os.homedir(), '.config/baby-record/sync.env');
const PRESETS = ['eve20', 'morning8', 'd1', 'h2', 'h1', 'm30', 'm0'];
const CAT = { vaccine: '💉疫苗', paidvax: '💰自费疫苗', checkup: '🩺体检', other: '📌其他' };

// App 的计划生成器：paidvax.js 不依赖其他模块，和 sync-core 一样用 data: URL 加载；疫苗/体检计划从 site/js 按文件导入。
const quietImport = async (file) => {
  const ew = process.emitWarning;
  process.emitWarning = (w, ...a) => { if (/MODULE_TYPELESS|Reparsing as ES module/.test(String(w?.message || w) + JSON.stringify(a))) return; return ew.call(process, w, ...a); };
  try { return await import(pathToFileURL(path.join(here, '../site/js', file)).href); } finally { process.emitWarning = ew; }
};
async function loadPlanner(kind) {
  if (kind === 'paid') {
    const src = fs.readFileSync(path.join(here, '../site/js/paidvax.js'), 'utf8');
    const m = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    return { category: 'paidvax', prefix: 'paid:', plan: m.planPaid };
  }
  if (kind === 'vaccine') return { category: 'vaccine', prefix: 'nip:', plan: (await quietImport('vaccines.js')).planVaccines };
  if (kind === 'checkup') return { category: 'checkup', prefix: 'chk:', plan: (await quietImport('checkups.js')).planCheckups };
  throw new Error('用法：plan paid|vaccine|checkup [--dry-run]');
}

function readFile() {
  const out = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { url: out.BABY_SYNC_URL || '', key: out.BABY_SYNC_KEY || '' };
}
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

function makeEvent({ title, date, time = '', category = 'other', note = '', remind, scheduleId = '', earliest = '', latest = '', windowNote = '' }) {
  if (!title) throw new Error('缺少 --title');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日期格式应为 YYYY-MM-DD');
  for (const [k, v] of [['earliest', earliest], ['latest', latest]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--${k} 格式应为 YYYY-MM-DD`);
  if (latest && !earliest) throw new Error('有 --latest 时也要给 --earliest');
  if (earliest && latest && latest < earliest) throw new Error('--latest 不能早于 --earliest');
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error('时间格式应为 HH:MM');
  if (!CAT[category]) throw new Error(`类别只能是 ${Object.keys(CAT).join(' / ')}`);
  if (scheduleId && !/^[a-z]+:[a-z0-9-]+$/.test(scheduleId)) throw new Error('scheduleId 格式应为 前缀:编号（如 paid:rsv）');
  let presets;
  if (remind === undefined || remind === true) presets = time ? ['eve20', 'morning8', 'h1'] : ['eve20', 'morning8'];
  else if (remind === 'none') presets = [];
  else presets = String(remind).split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of presets) if (!PRESETS.includes(p)) throw new Error(`未知提醒：${p}（可用 ${PRESETS.join(',')} 或 none）`);
  const now = Date.now();
  return {
    id: uid(), date, time, title: String(title).trim(), category, note: String(note || ''), done: false,
    reminders: presets.map((p) => ({ id: uid(), kind: 'preset', preset: p })),
    alarmAdded: false, alarmSig: '', scheduleId: String(scheduleId || ''), createdAt: now, updatedAt: now, source: 'box-cli',
    ...(earliest ? { earliest, latest: latest || '', windowNote: String(windowNote || '') } : {}),
  };
}

function fmt(e) {
  const win = e.earliest ? `  〔最早 ${e.earliest}${e.latest ? ` · 最迟 ${e.latest}` : ''}〕` : '';
  return `${e.done ? '✅' : '⬜'} ${e.date}${e.time ? ' ' + e.time : ''}  ${CAT[e.category] || e.category}  ${e.title}${win}${e.note ? `  — ${e.note.replace(/\n/g, ' / ')}` : ''}  [${e.id}]`;
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const cfg = readEnv();

  if (cmd === 'use-key' || (cmd === 'init' && opt['key-from-env'])) {
    const raw = process.env.BABY_SYNC_KEY || '';
    const key = core.extractSyncKey(raw);
    if (!raw) throw new Error('环境变量 BABY_SYNC_KEY 是空的（需要在新开的 shell 里运行）');
    if (!key) throw new Error('BABY_SYNC_KEY 不是有效的同步密钥（应为 brs1_ 开头、共 48 位）');
    const file = readFile();
    const url = typeof opt.url === 'string' ? opt.url.replace(/\/+$/, '') : (file.url || cfg.url);
    if (file.key === key) {
      console.log(`配置文件里已经是这个密钥（${fingerprint(key)}）`);
    } else {
      if (file.key) {
        fs.copyFileSync(ENV_FILE, ENV_FILE + '.bak');
        fs.chmodSync(ENV_FILE + '.bak', 0o600);
      }
      writeEnv({ url, key });
      console.log(`已采用新的同步密钥（${fingerprint(key)}），保存在 ${ENV_FILE}${file.key ? `；旧密钥（${fingerprint(file.key)}）备份在 ${ENV_FILE}.bak` : ''}`);
    }
    if (url) {
      const keys = await core.deriveKeys(key);
      const { events, profile } = await pullAll({ url, key }, keys);
      console.log(`云端事项：${events.size} 个；宝宝生日：${profile?.babyBirthday || '未设置'}`);
    }
    return;
  }
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
    const fk = readFile().key;
    console.log(`同步密钥：${cfg.key ? fingerprint(cfg.key) : '（未生成）'}${process.env.BABY_SYNC_KEY ? (fk === cfg.key ? '（环境变量与配置文件一致）' : '（来自环境变量 BABY_SYNC_KEY，与配置文件不同：运行 use-key 写入）') : ''}`);
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
      ev = makeEvent({ title: opt.title, date: opt.date || today(), time: opt.time || '', category: opt.category || 'other', note: opt.note || '', remind: opt.remind,
        scheduleId: typeof opt['schedule-id'] === 'string' ? opt['schedule-id'] : '',
        earliest: typeof opt.earliest === 'string' ? opt.earliest : '', latest: typeof opt.latest === 'string' ? opt.latest : '' });
      if (ev.scheduleId) {
        const { events } = await pullAll(cfg, keys);
        const dup = [...events.values()].find((x) => x.event.scheduleId === ev.scheduleId);
        if (dup) { console.log(`云端已有 ${ev.scheduleId}，未重复添加：${fmt(dup.event)}`); return; }
      }
    }
    await pushEvents(cfg, keys, [{ event: ev }]);
    console.log(`已添加：${fmt(ev)}`);
    return;
  }

  const { events, profile } = await pullAll(cfg, keys);
  const all = [...events.values()].map((x) => x.event).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));

  if (cmd === 'plan' || cmd === 'plan-paid') {
    const kind = cmd === 'plan-paid' ? 'paid' : pos[0];
    const P = await loadPlanner(kind);
    const bday = typeof opt.birthday === 'string' ? opt.birthday : (profile?.babyBirthday || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) throw new Error('云端没有宝宝生日：加 --birthday YYYY-MM-DD');
    const plan = P.plan(bday, today(), all);
    const pick = plan.filter((d) => !d.existing && !d.past && (opt['include-optional'] || !d.optional));
    const skipped = { existing: plan.filter((d) => d.existing).length, past: plan.filter((d) => !d.existing && d.past).length, optional: plan.filter((d) => !d.existing && !d.past && d.optional && !opt['include-optional']).length };
    const list = pick.map((d) => makeEvent({ title: d.title, date: d.date, time: '09:00', category: P.category, note: d.note, remind: 'eve20,morning8', scheduleId: d.scheduleId,
      earliest: d.earliest || '', latest: d.latest || '', windowNote: d.windowNote || '' }));
    list.forEach((e) => console.log(`${opt['dry-run'] ? '（预演）' : '＋'} ${fmt(e).replace(/  — .*  \[/, '  [')}  ${e.scheduleId}`));
    console.log(`生日 ${bday}：计划 ${plan.length} 项；${opt['dry-run'] ? '将' : '已'}写入 ${list.length} 项；跳过 云端已有 ${skipped.existing}、已过 ${skipped.past}、备选/可选 ${skipped.optional}`);
    if (!opt['dry-run'] && list.length) await pushEvents(cfg, keys, list.map((event) => ({ event })));
    return;
  }
  if (cmd === 'refresh-notes') {
    const P = await loadPlanner(pos[0]);
    const bday = typeof opt.birthday === 'string' ? opt.birthday : (profile?.babyBirthday || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) throw new Error('云端没有宝宝生日：加 --birthday YYYY-MM-DD');
    const byId = new Map(P.plan(bday, today(), []).map((d) => [d.scheduleId, d]));
    const GEN = { checkup: '儿童健康管理 · ', vaccine: '国家免疫规划 · ', paid: '' }[pos[0]];
    const out = [], stat = { same: 0, manual: 0, unknown: 0 };
    for (const { rec, event } of events.values()) {
      if (!String(event.scheduleId || '').startsWith(P.prefix)) continue;
      const d = byId.get(event.scheduleId);
      if (!d) { stat.unknown++; continue; }
      if (event.note === d.note) { stat.same++; continue; }
      if (event.note && GEN && !event.note.startsWith(GEN)) { stat.manual++; console.log(`跳过（备注被手动改过）：${event.title}`); continue; }
      out.push({ event: { ...event, note: d.note, updatedAt: Math.max(Date.now(), rec.updatedAt + 1) } });
      console.log(`${opt['dry-run'] ? '（预演）' : '✎'} ${event.date} ${event.title}  ${event.scheduleId}`);
    }
    console.log(`生日 ${bday}：${opt['dry-run'] ? '将' : '已'}更新备注 ${out.length} 项；已是最新 ${stat.same}、手动改过跳过 ${stat.manual}、生成器里没有 ${stat.unknown}`);
    if (!opt['dry-run'] && out.length) await pushEvents(cfg, keys, out);
    return;
  }
  if (cmd === 'refresh-windows') {
    const kinds = !pos[0] || pos[0] === 'all' ? ['vaccine', 'paid', 'checkup'] : [pos[0]];
    const bday = typeof opt.birthday === 'string' ? opt.birthday : (profile?.babyBirthday || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) throw new Error('云端没有宝宝生日：加 --birthday YYYY-MM-DD');
    const out = [], stat = { same: 0, unknown: 0, other: 0, add: 0, change: 0 };
    const planners = [];
    for (const k of kinds) { const P = await loadPlanner(k); planners.push({ P, byId: new Map(P.plan(bday, today(), []).map((d) => [d.scheduleId, d])) }); }
    for (const { rec, event } of events.values()) {
      const hit = planners.find(({ P }) => String(event.scheduleId || '').startsWith(P.prefix));
      if (!hit) { stat.other++; continue; }
      const d = hit.byId.get(event.scheduleId);
      if (!d || !d.earliest) { stat.unknown++; continue; }
      const w = { earliest: d.earliest, latest: d.latest || '', windowNote: d.windowNote || '' };
      if (event.earliest === w.earliest && (event.latest || '') === w.latest && (event.windowNote || '') === w.windowNote) { stat.same++; continue; }
      const isNew = !event.earliest;
      isNew ? stat.add++ : stat.change++;
      out.push({ event: { ...event, ...w, updatedAt: Math.max(Date.now(), rec.updatedAt + 1) } });
      const warn = event.date < w.earliest ? '  ⚠️计划日早于最早' : (w.latest && event.date > w.latest ? '  ⚠️计划日晚于最迟' : '');
      console.log(`${opt['dry-run'] ? '（预演）' : '✎'} ${isNew ? '补' : '改'} ${event.scheduleId.padEnd(16)} 计划 ${event.date}  最早 ${w.earliest}  最迟 ${w.latest || '—'}  ${event.title}${warn}`);
    }
    console.log(`生日 ${bday}：${opt['dry-run'] ? '将' : '已'}写入窗口 ${out.length} 项（新补 ${stat.add}、更新 ${stat.change}）；已是最新 ${stat.same}、生成器里没有 ${stat.unknown}、非计划事项 ${stat.other}`);
    if (!opt['dry-run'] && out.length) await pushEvents(cfg, keys, out);
    return;
  }
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
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
