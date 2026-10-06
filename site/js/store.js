// 数据层：所有数据保存在本机 localStorage，无需登录。
// 结构可扩展：以后可加入 growth（生长记录）、feeding（喂养记录）等集合。
import { fillWindow } from './windows.js';
const KEY = 'babyrecord.v1';
const SCHEMA_VERSION = 1;
export const CATEGORY_KEYS = ['vaccine', 'paidvax', 'checkup', 'other'];

function defaults() {
  return {
    version: SCHEMA_VERSION,
    events: [],          // 日程：疫苗 / 体检 / 其他重要事项
    snoozes: [],         // 稍后提醒记录 {id, eventId, fireAt, label}
    fired: {},           // 已响铃/已确认的提醒 id -> 时间戳
    settings: {
      babyName: '',
      babyBirthday: '', // 宝宝生日 YYYY-MM-DD（用于一键生成疫苗计划）
      shortcutName: '宝宝闹钟',
      pushApi: '',       // 为空时使用 config.js 中的默认推送服务地址
      sound: true,
      profileUpdatedAt: 0, // 宝宝资料的修改时间（云同步用）
    },
    // growth: [], feeding: []   // 预留：以后的功能
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('读取数据失败，使用空数据', e);
    return defaults();
  }
}

function migrate(data) {
  const d = defaults();
  const out = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
  // 注意：这里在模块加载时（state 还没赋值）就会运行，只能用传进来的 data，不能访问 state
  const bday = out.settings.babyBirthday;
  out.events = (out.events || []).map((e) => normalizeEvent(fillWindow(e, bday)));
  out.version = SCHEMA_VERSION;
  return out;
}

// 旧版本（v1.4.x 及更早）不认识「自费疫苗」，会把云端同步来的 paidvax 事项存成 other；
// 这里按 scheduleId（paid: 开头）自动改回来。（CATEGORY_KEYS 定义在文件开头：load() 在模块加载时就会用到）
export function normCategory(e) {
  const c = CATEGORY_KEYS.includes(e.category) ? e.category : 'other';
  if (c === 'other' && String(e.scheduleId || '').startsWith('paid:')) return 'paidvax';
  return c;
}

export function normalizeEvent(e) {
  return {
    id: e.id || uid(),
    date: e.date,
    time: e.time || '',
    title: (e.title || '').trim() || '未命名事项',
    category: normCategory(e),
    note: e.note || '',
    done: !!e.done,
    reminders: Array.isArray(e.reminders) ? e.reminders : [],
    alarmAdded: !!e.alarmAdded,     // 是否已通过快捷指令设为 iPhone 闹钟提醒（避免重复添加）
    alarmSig: e.alarmSig || '',     // 设置时的提醒时间签名；之后改了时间会提示重新设置
    alarmTagged: !!e.alarmTagged,   // v1.7.1：闹钟是带事项标记 <宝宝#id> 建的（可用「宝宝闹钟删除」自动删除）；旧闹钟没有标记
    scheduleId: e.scheduleId || '', // 由「一键生成疫苗计划」生成的剂次编号（如 nip:hepb-2），用于去重
    // v1.6.0：接种/体检窗口（YYYY-MM-DD，可为空）。date/time 是「计划日期/时间」，提醒和闹钟都按它。
    earliest: validYmd(e.earliest),
    latest: validYmd(e.latest),
    windowNote: e.windowNote || '',
    createdAt: e.createdAt || Date.now(),
    updatedAt: e.updatedAt || Date.now(),
  };
}

function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''; }
function bdayNow() { try { return state?.settings?.babyBirthday || ''; } catch (e) { return ''; } } // 加载期间 state 尚未赋值时也安全

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const store = {
  get state() { return state; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  events() { return state.events; },
  eventsOn(date) {
    return state.events.filter((e) => e.date === date)
      .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  },
  getEvent(id) { return state.events.find((e) => e.id === id); },
  upsertEvent(ev) {
    const e = normalizeEvent(fillWindow({ ...ev, updatedAt: Date.now() }, bdayNow()));
    const i = state.events.findIndex((x) => x.id === e.id);
    if (i >= 0) state.events[i] = e; else state.events.push(e);
    save();
    return e;
  },
  // 批量添加（只保存/刷新一次）；已存在相同 scheduleId 的跳过，返回实际添加的事项
  addEvents(list) {
    const have = new Set(state.events.map((e) => e.scheduleId).filter(Boolean));
    const added = [];
    for (const ev of list) {
      if (ev.scheduleId && have.has(ev.scheduleId)) continue;
      const e = normalizeEvent(fillWindow({ ...ev, createdAt: Date.now(), updatedAt: Date.now() }, bdayNow()));
      state.events.push(e); added.push(e);
      if (e.scheduleId) have.add(e.scheduleId);
    }
    if (added.length) save();
    return added;
  },
  // v1.7.0：批量修改（顺延后续剂次等），只保存/刷新一次
  upsertEvents(list) {
    for (const ev of list) {
      const e = normalizeEvent(fillWindow({ ...ev, updatedAt: Date.now() }, bdayNow()));
      const i = state.events.findIndex((x) => x.id === e.id);
      if (i >= 0) state.events[i] = e; else state.events.push(e);
    }
    if (list.length) save();
  },
  // v1.7.0：批量删除（把自费疫苗系列移出计划），云同步会发删除标记
  deleteEvents(ids) {
    const del = new Set(ids);
    state.events = state.events.filter((e) => !del.has(e.id));
    state.snoozes = state.snoozes.filter((s) => !del.has(s.eventId));
    if (del.size) save();
  },
  deleteEvent(id) {
    state.events = state.events.filter((e) => e.id !== id);
    state.snoozes = state.snoozes.filter((s) => s.eventId !== id);
    save();
  },
  // tagged：true = 这次是 v1.7.1 起带标记建的闹钟；不传 = 保持原值（取消勾选时清掉）
  setAlarmAdded(id, added, sig = '', tagged) {
    const e = this.getEvent(id);
    if (e) { e.alarmAdded = added; e.alarmSig = added ? sig : ''; e.alarmTagged = added ? (tagged === undefined ? !!e.alarmTagged : !!tagged) : false; e.updatedAt = Date.now(); save(); }
  },
  setDone(id, done) {
    const e = this.getEvent(id);
    if (e) { e.done = done; e.updatedAt = Date.now(); save(); }
  },
  addSnooze(s) { state.snoozes.push(s); save(); },
  markFired(rid) {
    state.fired[rid] = Date.now();
    // 清理 60 天前的记录
    const cutoff = Date.now() - 60 * 864e5;
    for (const k of Object.keys(state.fired)) if (state.fired[k] < cutoff) delete state.fired[k];
    state.snoozes = state.snoozes.filter((s) => s.fireAt > Date.now() - 864e5 || !state.fired[s.id]);
    save();
  },
  isFired(rid) { return !!state.fired[rid]; },
  updateSettings(patch) {
    // 宝宝资料（姓名/生日）变化时记录修改时间，供云同步合并
    if (('babyName' in patch || 'babyBirthday' in patch) && !('profileUpdatedAt' in patch)) patch = { ...patch, profileUpdatedAt: Date.now() };
    state.settings = { ...state.settings, ...patch }; save();
  },
  // 云同步：应用其他设备的修改（保留对方的 updatedAt，只保存一次）
  applyRemote({ upserts = [], deletes = [], profile = null } = {}) {
    if (!upserts.length && !deletes.length && !profile) return;
    const del = new Set(deletes);
    state.events = state.events.filter((e) => !del.has(e.id));
    state.snoozes = state.snoozes.filter((x) => !del.has(x.eventId));
    const bday = profile?.babyBirthday || bdayNow();
    for (const ev of upserts) {
      const e = normalizeEvent(fillWindow(ev, bday)); // 旧版本同步来的事项没有窗口字段：本机按 scheduleId 补上（不改 updatedAt）
      const i = state.events.findIndex((x) => x.id === e.id);
      if (i >= 0) state.events[i] = e; else state.events.push(e);
    }
    if (profile) state.settings = { ...state.settings, babyName: profile.babyName || '', babyBirthday: profile.babyBirthday || '', profileUpdatedAt: profile.updatedAt };
    save();
  },
  exportJSON() {
    return JSON.stringify({ app: 'baby-record', exportedAt: new Date().toISOString(), data: state }, null, 2);
  },
  importJSON(text) {
    const parsed = JSON.parse(text);
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.events)) throw new Error('文件格式不正确');
    state = migrate(data);
    save();
    return state.events.length;
  },
  resetAll() { state = defaults(); save(); },
};
