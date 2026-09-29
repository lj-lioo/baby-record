// 数据层：所有数据保存在本机 localStorage，无需登录。
// 结构可扩展：以后可加入 growth（生长记录）、feeding（喂养记录）等集合。
const KEY = 'babyrecord.v1';
const SCHEMA_VERSION = 1;

function defaults() {
  return {
    version: SCHEMA_VERSION,
    events: [],          // 日程：疫苗 / 体检 / 其他重要事项
    snoozes: [],         // 稍后提醒记录 {id, eventId, fireAt, label}
    fired: {},           // 已响铃/已确认的提醒 id -> 时间戳
    settings: {
      babyName: '',
      shortcutName: '宝宝闹钟',
      pushApi: '',       // 为空时使用 config.js 中的默认推送服务地址
      sound: true,
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
  out.events = (out.events || []).map(normalizeEvent);
  out.version = SCHEMA_VERSION;
  return out;
}

export function normalizeEvent(e) {
  return {
    id: e.id || uid(),
    date: e.date,
    time: e.time || '',
    title: (e.title || '').trim() || '未命名事项',
    category: ['vaccine', 'checkup', 'other'].includes(e.category) ? e.category : 'other',
    note: e.note || '',
    done: !!e.done,
    reminders: Array.isArray(e.reminders) ? e.reminders : [],
    alarmAdded: !!e.alarmAdded,     // 是否已通过快捷指令设为 iPhone 闹钟提醒（避免重复添加）
    alarmSig: e.alarmSig || '',     // 设置时的提醒时间签名；之后改了时间会提示重新设置
    createdAt: e.createdAt || Date.now(),
    updatedAt: e.updatedAt || Date.now(),
  };
}

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
    const e = normalizeEvent({ ...ev, updatedAt: Date.now() });
    const i = state.events.findIndex((x) => x.id === e.id);
    if (i >= 0) state.events[i] = e; else state.events.push(e);
    save();
    return e;
  },
  deleteEvent(id) {
    state.events = state.events.filter((e) => e.id !== id);
    state.snoozes = state.snoozes.filter((s) => s.eventId !== id);
    save();
  },
  setAlarmAdded(id, added, sig = '') {
    const e = this.getEvent(id);
    if (e) { e.alarmAdded = added; e.alarmSig = added ? sig : ''; e.updatedAt = Date.now(); save(); }
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
  updateSettings(patch) { state.settings = { ...state.settings, ...patch }; save(); },
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
