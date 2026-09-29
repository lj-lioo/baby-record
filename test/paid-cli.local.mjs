// v1.7.0 命令行测试（本地 Worker：cd sync/worker && npx wrangler dev --port 8788 --ip 127.0.0.1）：
// 模拟线上 v1.6.0 云端（RSV + 旧版 plan paid 写入的 17 个待定自费事项，其中几个被用户动过），
// 检查 prune-undecided 预演/备份/删除标记、RSV 一字不变、plan paid 不再写入待定项、paid-series / paid-remove、refresh-* 不覆盖系列剂次。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../sync/add-item.js');
const load = (f) => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(here, '../site/js', f), 'utf8')).toString('base64'));
const core = await load('sync-core.js');
const P = await load('paidvax.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
const ENV = path.join(dir, 'sync.env');
const URL_ = process.env.WORKER || 'http://localhost:8788';
const key = core.newSyncKey();
fs.writeFileSync(ENV, `BABY_SYNC_URL=${URL_}\nBABY_SYNC_KEY=${key}\n`, { mode: 0o600 });
const env = { ...process.env, BABY_SYNC_ENV: ENV }; delete env.BABY_SYNC_KEY; delete env.BABY_SYNC_URL;
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const runErr = (...a) => { try { run(...a); return ''; } catch (e) { return String(e.stderr || e.message); } };
const keys = await core.deriveKeys(key);
const cfg = { url: URL_ };
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(c ? '✅' : '❌', n, x); };
const B = ['--birthday', '2026-09-17'];

async function pullRaw() {
  const recs = new Map(); let since = 0, more = true;
  while (more) {
    const res = await core.syncRequest(cfg.url, keys.token, { since, changes: [] });
    for (const r of res.changes) recs.set(r.id, r);
    since = res.cursor; more = res.more;
  }
  return recs;
}
async function pull() {
  const m = new Map();
  for (const [id, r] of await pullRaw()) if (id.startsWith(core.EVENT_PREFIX) && !r.deleted) m.set(id.slice(core.EVENT_PREFIX.length), { rec: r, event: (await core.unseal(keys.enc, r.id, r.updatedAt, r.data)).event });
  return m;
}
async function push(evs) {
  const changes = [];
  for (const e of evs) { const rid = core.EVENT_PREFIX + e.id; changes.push({ id: rid, updatedAt: e.updatedAt, deleted: false, data: await core.seal(keys.enc, rid, e.updatedAt, { type: 'event', event: e }) }); }
  await core.syncRequest(cfg.url, keys.token, { since: 0, changes });
}
const paidOf = (m) => [...m.values()].filter((x) => String(x.event.scheduleId).startsWith('paid:'));

try {
  // 1) 模拟 v1.6.0 的云端：旧版 plan paid 的默认 18 项（和 v1.5.0 一样的格式 + v1.6.0 窗口）
  const legacy = P.planPaid('2026-09-17', '2026-09-29').filter((d) => !d.optional);
  let t0 = Date.now() - 3600e3;
  const mk = (d, i) => ({ id: 'L' + i + Math.random().toString(36).slice(2, 6), date: d.date, time: '09:00', title: d.title, category: 'paidvax', note: d.note, done: false,
    reminders: [{ id: 'r1' + i, kind: 'preset', preset: 'eve20' }, { id: 'r2' + i, kind: 'preset', preset: 'morning8' }], alarmAdded: false, alarmSig: '', scheduleId: d.scheduleId,
    createdAt: t0, updatedAt: t0 + i, source: 'box-cli', earliest: d.earliest, latest: d.latest || '', windowNote: d.windowNote || '' });
  const evs = legacy.map(mk);
  const rsv0 = evs.find((e) => e.scheduleId === 'paid:rsv'); rsv0.date = '2026-10-17';
  await push(evs);
  run('add', '--title', '办医保', '--date', '2026-10-09', '--remind', 'none');
  let m = await pull();
  ok('模拟线上：18 个自费事项（RSV + 17 个默认）+ 1 个手动事项', paidOf(m).length === 18 && m.size === 19);
  const rsvRec0 = JSON.stringify((await pullRaw()).get(core.EVENT_PREFIX + rsv0.id));

  // 2) 预演：17 个全部没动过 → 将删除 17，保留 RSV
  const dry = run('prune-undecided', '--dry-run', ...B);
  ok('预演：将删除 17 个、保留 1 个（RSV）；云端不变', /将删除（待定、未改动）17 个；保留 1 个/.test(dry) && /保留 paid:rsv/.test(dry) && (await pull()).size === 19, dry.trim().split('\n').at(-1));

  // 3) 用户在手机上动过其中 4 个：完成 / 设闹钟 / 改计划日 / 改备注 → 这些保留
  m = await pull();
  const bySid = (sid) => paidOf(m).find((x) => x.event.scheduleId === sid);
  const touch = [['paid:pcv13-1', (e) => { e.done = true; }], ['paid:penta-1', (e) => { e.alarmAdded = true; e.alarmSig = 'x'; }], ['paid:ev71-1', (e) => { e.date = '2027-04-20'; }], ['paid:var-2', (e) => { e.note = '手动：幼儿园要求'; }]];
  await push(touch.map(([sid, f]) => { const x = bySid(sid); const e = { ...x.event, updatedAt: x.rec.updatedAt + 10 }; f(e); return e; }));
  const dry2 = run('prune-undecided', '--dry-run', ...B);
  ok('动过的 4 个保留并说明原因（已完成/设过闹钟/计划日改过/备注改过）', /将删除（待定、未改动）13 个；保留 5 个/.test(dry2) && /保留 paid:pcv13-1.*已完成/.test(dry2) && /保留 paid:penta-1.*设过闹钟/.test(dry2)
    && /保留 paid:ev71-1.*计划日改过/.test(dry2) && /保留 paid:var-2.*备注改过/.test(dry2), dry2.trim().split('\n').at(-1));

  // 4) 实际执行：备份 + 删除标记
  const bak = path.join(dir, 'backup.json');
  const real = run('prune-undecided', '--backup', bak, ...B);
  const b = JSON.parse(fs.readFileSync(bak, 'utf8'));
  ok('备份文件：13 个事项（完整事项 + updatedAt），权限 600', b.items.length === 13 && b.items.every((x) => x.event.scheduleId && x.updatedAt) && (fs.statSync(bak).mode & 0o777) === 0o600, real.trim().split('\n').slice(-2).join(' / '));
  const raw = await pullRaw();
  const tomb = b.items.map((x) => raw.get(core.EVENT_PREFIX + x.event.id));
  ok('云端 13 个变成删除标记（deleted:true，updatedAt 更大）', tomb.every((r, i) => r && r.deleted === true && r.updatedAt > b.items[i].updatedAt));
  m = await pull();
  ok('云端剩 5 个自费事项（RSV + 动过的 4 个）+ 手动事项', paidOf(m).length === 5 && m.size === 6);
  ok('RSV 记录一字不变（同一 updatedAt、同一密文）', JSON.stringify(raw.get(core.EVENT_PREFIX + rsv0.id)) === rsvRec0);
  ok('再运行：没有可删的', /已删除（待定、未改动）0 个/.test(run('prune-undecided', ...B)));

  // 5) 手机端（sync-core 合并）：删除标记让本机也删掉
  const localIds = new Set(b.items.map((x) => x.event.id));
  const deletes = [...raw.values()].filter((r) => r.deleted && localIds.has(r.id.slice(core.EVENT_PREFIX.length))).map((r) => r.id);
  ok('删除标记可被手机同步识别（13 个 ev: 记录）', deletes.length === 13);

  // 6) plan paid 不再写入待定项
  const pp = run('plan', 'paid', ...B);
  ok('plan paid：RSV 已有 → 写入 0；待定项不写入', /已写入 0 项/.test(pp) && /自费待定 \d+（不写入/.test(pp) && paidOf(await pull()).length === 5, pp.trim().split('\n').at(-1));

  // 7) paid-series：五价轮状（云端没有）
  ok('paid-series：早于最早日期报错', /不能早于最早日期 2026-10-29/.test(runErr('paid-series', 'rota5', '--start', '2026-10-20', ...B)));
  ok('paid-series：云端已有五联剂次时不重复添加', /云端已有 五联疫苗 的 1 剂/.test(runErr('paid-series', 'penta', '--start', '2026-11-21', ...B)));
  const sd = run('paid-series', 'rota5', '--start', '2026-10-31', '--dry-run', ...B);
  ok('paid-series 预演：3 剂 10-31 / 11-30 / 12-30，云端不变', /将加入计划 3 剂/.test(sd) && /2026-11-30 09:00\s+五价轮状 第2剂（口服）\s+〔最早 2026-11-28 · 最迟 2027-01-09〕/.test(sd) && paidOf(await pull()).length === 5, sd.trim().split('\n').at(-1));
  run('paid-series', 'rota5', '--start', '2026-10-31', ...B);
  m = await pull();
  const r5 = paidOf(m).filter((x) => x.event.scheduleId.startsWith('paid:rota5-')).map((x) => x.event).sort((a, c) => a.scheduleId.localeCompare(c.scheduleId));
  ok('写入 3 剂：09:00、提醒 eve20+morning8、最早/最迟、系列备注', r5.length === 3 && r5.map((e) => e.date).join(',') === '2026-10-31,2026-11-30,2026-12-30' && r5.every((e) => e.time === '09:00' && e.reminders.map((r) => r.preset).join(',') === 'eve20,morning8' && /^自费·共3剂/.test(e.note)) && r5[2].latest === '2027-02-08');
  const late = run('paid-series', 'hepai', '--start', '2028-10-01', '--dry-run', ...B);
  ok('paid-series：晚于第1剂最迟 → ⚠️ 提醒', /第1剂晚于最迟日期 2028-09-16/.test(late));

  // 8) refresh-* 不覆盖系列剂次
  const before = new Map([...(await pull())].map(([id, x]) => [id, x.rec.updatedAt]));
  const rw = run('refresh-windows', 'paid', ...B);
  const rn = run('refresh-notes', 'paid', ...B);
  const after = await pull();
  const changedSeries = [...after].filter(([id, x]) => x.event.scheduleId.startsWith('paid:rota5') && x.rec.updatedAt !== before.get(id)).length;
  ok('refresh-windows / refresh-notes paid 不改系列剂次、不改 RSV', changedSeries === 0 && after.get(rsv0.id).rec.updatedAt === before.get(rsv0.id), `${rw.trim().split('\n').at(-1)} | ${rn.trim().split('\n').at(-1)}`);

  // 9) paid-remove：只删未完成的
  const rmd = run('paid-remove', 'pcv13', '--dry-run');
  ok('paid-remove 预演：13价只有已完成的第1剂 → 移出 0 剂', /将移出计划 0 剂/.test(rmd) && /已完成保留 1 剂/.test(rmd));
  run('paid-remove', 'rota5');
  m = await pull();
  ok('paid-remove rota5：3 剂写删除标记', paidOf(m).filter((x) => x.event.scheduleId.startsWith('paid:rota5')).length === 0 && [...(await pullRaw()).values()].filter((r) => r.deleted).length === 16);

  // 10) 全新云端：plan paid 只写 RSV
  const key2 = core.newSyncKey();
  fs.writeFileSync(ENV, `BABY_SYNC_URL=${URL_}\nBABY_SYNC_KEY=${key2}\n`, { mode: 0o600 });
  const pp2 = run('plan', 'paid', ...B);
  ok('新云端 plan paid：只写入 RSV（1 项），其余 28 剂（默认 17 + 备选 11）待定不写入', /已写入 1 项/.test(pp2) && /自费待定 28（不写入/.test(pp2), pp2.trim().split('\n').at(-1));
  ok('输出不含同步密钥', ![dry, dry2, real, pp, sd, rw, rn, pp2].some((s) => s.includes(key) || s.includes(key2)));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
