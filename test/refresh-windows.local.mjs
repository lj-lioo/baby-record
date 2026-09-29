// 命令行 refresh-windows 测试（本地 Worker：cd sync/worker && npx wrangler dev --port 8788 --local）。
// 用临时密钥/临时配置：先按旧版（v1.5.0，没有窗口字段）写入计划事项并做一些手动修改，再补窗口，检查只改了窗口字段和 updatedAt。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../sync/add-item.js');
const core = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(here, '../site/js/sync-core.js'), 'utf8')).toString('base64'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-'));
const ENV = path.join(dir, 'sync.env');
const URL_ = process.env.WORKER || 'http://localhost:8788';
const key = core.newSyncKey();
fs.writeFileSync(ENV, `BABY_SYNC_URL=${URL_}\nBABY_SYNC_KEY=${key}\n`, { mode: 0o600 });
const env = { ...process.env, BABY_SYNC_ENV: ENV }; delete env.BABY_SYNC_KEY; delete env.BABY_SYNC_URL;
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' });
const keys = await core.deriveKeys(key);
const cfg = { url: URL_ };
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? '✅' : '❌', n, x); };

async function pull() {
  const m = new Map(); let since = 0, more = true;
  while (more) {
    const res = await core.syncRequest(cfg.url, keys.token, { since, changes: [] });
    for (const r of res.changes) if (r.id.startsWith(core.EVENT_PREFIX) && !r.deleted) m.set(r.id.slice(core.EVENT_PREFIX.length), { rec: r, event: (await core.unseal(keys.enc, r.id, r.updatedAt, r.data)).event });
    since = res.cursor; more = res.more;
  }
  return m;
}
async function push(evs) {
  const changes = [];
  for (const e of evs) { const rid = core.EVENT_PREFIX + e.id; changes.push({ id: rid, updatedAt: e.updatedAt, deleted: false, data: await core.seal(keys.enc, rid, e.updatedAt, { type: 'event', event: e }) }); }
  await core.syncRequest(cfg.url, keys.token, { since: 0, changes });
}

try {
  // 1) 写入计划（和线上一样 52 项：免费 22 + 自费 18 + 体检 12），再去掉窗口字段 = 旧版数据
  const B = ['--birthday', '2026-09-17'];
  run('plan', 'vaccine', ...B); run('plan', 'paid', ...B); run('plan', 'checkup', ...B);
  run('add', '--title', '办医保', '--date', '2026-10-09', '--remind', 'none');
  let m = await pull();
  const bySid = (sid) => [...m.values()].find((x) => x.event.scheduleId === sid).event;
  const old = [...m.values()].map(({ rec, event }) => {
    const e = { ...event }; delete e.earliest; delete e.latest; delete e.windowNote; e.updatedAt = rec.updatedAt + 5;
    if (e.scheduleId === 'nip:hepb-2') { e.date = '2026-10-20'; e.time = '10:30'; e.alarmAdded = true; e.alarmSig = 'sig-old'; }
    if (e.scheduleId === 'paid:rsv') e.done = true;
    if (e.scheduleId === 'chk:m1') { e.note = '手动备注：带上出生证明'; e.reminders = []; }
    return e;
  });
  await push(old);
  m = await pull();
  const withWin0 = [...m.values()].filter((x) => x.event.earliest).length;
  const N = [...m.values()].filter((x) => x.event.scheduleId).length;
  ok(`旧版数据：${m.size} 项（计划事项 ${N}），带窗口 ${withWin0} 项`, N >= 48 && m.size === N + 1 && withWin0 === 0);
  const before = new Map([...m].map(([id, x]) => [id, { u: x.rec.updatedAt, e: x.event }]));

  // 2) 预演：不写入
  const dry = run('refresh-windows', 'all', '--dry-run', ...B);
  console.log(dry.split('\n').slice(0, 4).join('\n') + '\n…\n' + dry.trim().split('\n').at(-1));
  m = await pull();
  ok('预演：云端没有变化', [...m.values()].every((x) => x.rec.updatedAt === before.get(x.event.id).u && !x.event.earliest));
  ok(`预演输出：将写入窗口 ${N} 项`, dry.includes(`将写入窗口 ${N} 项（新补 ${N}、更新 0）`) && /非计划事项 1/.test(dry));
  ok('预演提示计划日与窗口', /nip:hepb-2\s+计划 2026-10-20\s+最早 2026-10-17/.test(dry));

  // 3) 实际写入
  const real = run('refresh-windows', 'all', ...B);
  console.log(real.trim().split('\n').at(-1));
  m = await pull();
  let changed = 0, bad = [];
  for (const [id, x] of m) {
    const b = before.get(id);
    const strip = (e) => { const o = { ...e }; for (const k of ['earliest', 'latest', 'windowNote', 'updatedAt']) delete o[k]; return JSON.stringify(o); };
    if (strip(x.event) !== strip(b.e)) bad.push(id);
    if (x.rec.updatedAt !== b.u) { changed++; if (!(x.rec.updatedAt > b.u) || !x.event.earliest) bad.push(id); }
  }
  ok(`写入 ${N} 项；除 earliest/latest/windowNote/updatedAt 外字段完全不变`, changed === N && bad.length === 0, `changed=${changed} bad=${bad.length}`);
  const hb2 = bySid('nip:hepb-2'), hb2n = [...m.values()].find((x) => x.event.scheduleId === 'nip:hepb-2').event;
  ok('乙肝第2剂：计划日 10-20 10:30、已设闹钟保留；最早 10-17', hb2n.date === '2026-10-20' && hb2n.time === '10:30' && hb2n.alarmAdded && hb2n.alarmSig === 'sig-old' && hb2n.earliest === '2026-10-17' && hb2n.latest === '');
  const rsv = [...m.values()].find((x) => x.event.scheduleId === 'paid:rsv').event;
  ok('RSV：已完成保留；窗口 09-17 ~ 2027-03-31', rsv.done === true && rsv.earliest === '2026-09-17' && rsv.latest === '2027-03-31');
  const m1 = [...m.values()].find((x) => x.event.scheduleId === 'chk:m1').event;
  ok('满月体检：手动备注、空提醒保留；窗口 10-15 ~ 10-29', m1.note === '手动备注：带上出生证明' && m1.reminders.length === 0 && m1.earliest === '2026-10-15' && m1.latest === '2026-10-29');
  ok('手动事项（办医保）没有窗口', ![...m.values()].find((x) => x.event.title === '办医保').event.earliest);
  void hb2;

  // 4) 再运行一次：幂等
  const again = run('refresh-windows', 'all', ...B);
  ok(`再运行：0 项（已是最新 ${N}）`, /已写入窗口 0 项/.test(again) && again.includes(`已是最新 ${N}`), again.trim().split('\n').at(-1));
  // 5) plan 新生成的事项直接带窗口
  const list = JSON.parse(run('list', '--all', '--json'));
  ok('list --json 含窗口字段', list.filter((e) => e.earliest).length === N);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
