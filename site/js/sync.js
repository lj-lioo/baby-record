// 云同步（可选）：多台设备、以及助手在盒子上用命令行添加的事项，双向同步。
// 只有 config.js 里配置了 syncApi（同步服务地址）才会显示/启用；数据在本机加密后再上传（见 sync-core.js）。
// 合并：每个事项按 updatedAt「最后写入者胜」；删除用 tombstone 同步；一键生成的计划按 scheduleId 去重。
import { store } from './store.js';
import * as core from './sync-core.js';

const LS = 'babyrecord.sync';
const EV = core.EVENT_PREFIX;
let meta = loadMeta();

// 配对链接 https://…/baby-record/#pair=<密钥>：# 后面的内容浏览器不会发给服务器。
// 模块加载时（首页渲染前）读取并立刻从地址栏/历史记录里去掉。
let pendingPairKey = '';
try {
  const m = /^#pair=([^&]+)/.exec(location.hash || '');
  if (m) {
    pendingPairKey = core.extractSyncKey(decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search + '#/settings');
  }
} catch { /* ignore */ }
export function takePendingPairKey() { const k = pendingPairKey; pendingPairKey = ''; return k; }
let keysCache = null;
let running = null;
let again = false;
let timer = null;
let applying = false;

function loadMeta() {
  try { return { acked: {}, dels: {}, cursor: 0, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { acked: {}, dels: {}, cursor: 0 }; }
}
function saveMeta() { localStorage.setItem(LS, JSON.stringify(meta)); }
function emit() { window.dispatchEvent(new CustomEvent('sync-status', { detail: syncStatus() })); }

export function syncApiBase() { return String(meta.url || window.BABY_CONFIG?.syncApi || '').replace(/\/+$/, ''); }
export function syncAvailable() { return !!syncApiBase(); }
export function syncStatus() {
  return { available: syncAvailable(), enabled: !!(meta.enabled && meta.key), key: meta.key || '', lastSyncAt: meta.lastSyncAt || 0, lastError: meta.lastError || '', running: !!running };
}

async function keys() {
  if (!keysCache || keysCache.key !== meta.key) keysCache = { key: meta.key, ...(await core.deriveKeys(meta.key)) };
  return keysCache;
}

// 开启同步：没有密钥就生成一个；key 参数 = 在另一台设备上粘贴的密钥
export async function enableSync(key) {
  const k = key ? core.extractSyncKey(key) : (meta.key || core.newSyncKey());
  if (!k) throw new Error('同步密钥格式不正确（应以 brs1_ 开头）');
  if (k !== meta.key) meta = { enabled: true, key: k, url: meta.url, acked: {}, dels: {}, cursor: 0 };
  meta.enabled = true;
  saveMeta();
  await syncNow('enable');
  if (meta.lastError) throw new Error(meta.lastError);
  return syncStatus();
}
export function disableSync() { meta.enabled = false; saveMeta(); emit(); }

// 宝宝资料的修改时间；旧版本存下的生日没有时间 → 视为 1（会上传，但任何真正的修改都比它新）
function profileTime() {
  const st = store.state.settings;
  return st.profileUpdatedAt || (st.babyBirthday || st.babyName ? 1 : 0);
}

// 本机需要上传的变更
async function collectChanges(enc) {
  const changes = [];
  const now = Date.now();
  const present = new Set();
  for (const e of store.events()) {
    const rid = EV + e.id;
    present.add(rid);
    if (meta.acked[rid] !== e.updatedAt) changes.push({ id: rid, updatedAt: e.updatedAt, deleted: false, data: await core.seal(enc, rid, e.updatedAt, { type: 'event', event: e }) });
  }
  // 之前同步过、现在本机没有了 → 本机删除了，发送删除标记
  for (const rid of Object.keys(meta.acked)) {
    if (!rid.startsWith(EV) || present.has(rid)) continue;
    if (!meta.dels[rid]) meta.dels[rid] = Math.max(now, meta.acked[rid] + 1);
    if (meta.acked[rid] !== meta.dels[rid]) changes.push({ id: rid, updatedAt: meta.dels[rid], deleted: true, data: null });
  }
  const st = store.state.settings;
  const pt = profileTime();
  if (pt && meta.acked[core.PROFILE_ID] !== pt) {
    changes.push({ id: core.PROFILE_ID, updatedAt: pt, deleted: false,
      data: await core.seal(enc, core.PROFILE_ID, pt, { type: 'profile', profile: { babyName: st.babyName, babyBirthday: st.babyBirthday } }) });
  }
  return changes.slice(0, 500);
}

// 应用服务器返回的记录（其他设备 / 盒子命令行的修改）
async function applyRemote(records, enc) {
  const upserts = [], deletes = [];
  let profile = null;
  const local = new Map(store.events().map((e) => [EV + e.id, e]));
  for (const r of records) {
    if (r.id.startsWith(EV)) {
      const cur = local.get(r.id);
      const localT = cur ? cur.updatedAt : (meta.dels[r.id] || 0);
      if (r.updatedAt <= localT) { if (r.updatedAt === localT) meta.acked[r.id] = r.updatedAt; continue; }
      if (r.deleted) {
        if (cur) deletes.push(cur.id);
        meta.dels[r.id] = r.updatedAt;
      } else {
        let obj;
        try { obj = await core.unseal(enc, r.id, r.updatedAt, r.data); } catch (e) { console.warn('无法解密', r.id, e); continue; }
        if (obj?.type !== 'event' || !obj.event) continue;
        upserts.push({ ...obj.event, id: r.id.slice(EV.length), updatedAt: r.updatedAt });
        delete meta.dels[r.id];
      }
      meta.acked[r.id] = r.updatedAt;
    } else if (r.id === core.PROFILE_ID && !r.deleted) {
      if (r.updatedAt <= profileTime()) { meta.acked[r.id] = Math.max(meta.acked[r.id] || 0, r.updatedAt); continue; }
      try {
        const obj = await core.unseal(enc, r.id, r.updatedAt, r.data);
        profile = { ...obj.profile, updatedAt: r.updatedAt };
        meta.acked[r.id] = r.updatedAt;
      } catch (e) { console.warn('无法解密资料', e); }
    }
  }
  applying = true;
  try { store.applyRemote({ upserts, deletes, profile }); } finally { applying = false; }
  return upserts.length + deletes.length + (profile ? 1 : 0);
}

// 两台设备各自「一键生成」了同一剂疫苗/同一次体检：只保留一条，其余删除（会同步到所有设备）。
// 优先保留：已设 iPhone 闹钟的 > 已完成的 > 最近修改的 > id 较小的（各设备数据一致时结果相同）
const rank = (e) => (e.alarmAdded ? 2 : 0) + (e.done ? 1 : 0);
function dedupeSchedules() {
  const keep = new Map();
  const drop = [];
  const order = [...store.events()].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  for (const e of order) {
    if (!e.scheduleId) continue;
    if (keep.has(e.scheduleId)) drop.push(e.id); else keep.set(e.scheduleId, e.id);
  }
  drop.forEach((id) => store.deleteEvent(id));
  return drop.length;
}

export function syncNow(reason = '') {
  if (!syncAvailable() || !meta.enabled || !meta.key) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    emit();
    try {
      for (let round = 0; round < 10; round++) {
        again = false;
        const { token, enc } = await keys();
        const changes = await collectChanges(enc);
        const res = await core.syncRequest(syncApiBase(), token, { since: meta.cursor || 0, changes });
        const sent = new Map(changes.map((c) => [c.id, c.updatedAt]));
        for (const id of res.accepted || []) meta.acked[id] = sent.get(id);
        await applyRemote([...(res.conflicts || []), ...(res.changes || [])], enc);
        meta.cursor = res.cursor;
        if (dedupeSchedules()) again = true;
        saveMeta();
        if (!res.more && !again) break;
      }
      meta.lastSyncAt = Date.now();
      meta.lastError = '';
    } catch (e) {
      meta.lastError = e.message || String(e);
      console.warn('云同步失败', reason, e);
    }
    saveMeta();
    running = null;
    emit();
  })();
  return running;
}

// 打开时、每次修改后（1.5 秒防抖）、切回前台时、恢复联网时、前台每 2 分钟 同步一次
export function initSync() {
  if (!syncAvailable()) return;
  store.subscribe(() => {
    if (applying || !meta.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow('change'), 1500);
  });
  document.addEventListener('visibilitychange', () => { if (meta.enabled) syncNow(document.hidden ? 'hidden' : 'visible'); });
  window.addEventListener('online', () => syncNow('online'));
  setInterval(() => { if (!document.hidden) syncNow('interval'); }, 120000);
  syncNow('open');
}
