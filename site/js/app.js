// 入口：路由、渲染、提醒检查、Service Worker
import { store } from './store.js';
import { $$, closeSheet, toast } from './ui.js';
import { renderHome, selectDate } from './views/home.js';
import { renderSettings } from './views/settings.js';
import { renderHelp } from './views/help.js';
import { renderAlbum } from './views/album.js';
import { renderGrowth } from './views/growth.js';
import { showAlarm, checkDueAlarms, alarmShowing } from './views/alarm.js';
import { syncReminders, refreshOnLaunch } from './push.js';
import { unlockAudio } from './sound.js';
import { initSync, syncAvailable, takePendingPairKey } from './sync.js';
import { openPairSheet } from './views/settings.js';
import { applyInviteFromParams, hasRole, openRolePicker, roleLabel } from './roles.js';

const view = document.getElementById('view');
const routes = { home: renderHome, album: renderAlbum, growth: renderGrowth, settings: renderSettings, help: renderHelp };

// 邀请链接 #/join?role=…：模块加载时取出参数并立刻从地址栏去掉（不含同步密钥）
let pendingJoinParams = null;
try {
  const raw = location.hash || '';
  const m = /^#\/?join\?(.*)/.exec(raw);
  if (m) {
    pendingJoinParams = new URLSearchParams(m[1]);
    history.replaceState(null, '', location.pathname + location.search + '#/settings');
  }
} catch { /* ignore */ }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || 'home', params: new URLSearchParams(qs || '') };
}

async function consumePendingJoin() {
  if (!pendingJoinParams) return false;
  const params = pendingJoinParams;
  pendingJoinParams = null;
  try {
    const { role, soft } = await applyInviteFromParams(params);
    toast(soft
      ? `已加入为「${role}」（请向爸妈另行配置同步密钥；邀请不含密钥）`
      : `已加入为「${roleLabel(role)}」`, 4000);
  } catch (e) {
    toast(e.message || '邀请无效', 4500);
  }
  return true;
}

function render() {
  const { path, params } = parseHash();
  if (path === 'join') {
    // 晚到的 hash（例如站内再点邀请）：记下并清地址栏，异步应用后重绘设置
    pendingJoinParams = params;
    try { history.replaceState(null, '', location.pathname + location.search + '#/settings'); } catch { /* ignore */ }
    consumePendingJoin().then(() => { renderSettings(view); setTab('settings'); });
    return;
  }
  if (path === 'alarm') {
    const rid = params.get('rid'), e = params.get('e');
    if (!routes.home.rendered) { renderHome(view); routes.home.rendered = true; setTab('home'); }
    if (rid && e) showAlarm({ rid, eventId: e });
    return;
  }
  const fn = routes[path] || renderHome;
  fn(view);
  routes.home.rendered = fn === renderHome;
  setTab(routes[path] ? path : 'home');
}
function setTab(name) { $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name)); }

window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('rerender', () => { if (parseHash().path === 'home' || parseHash().path === 'alarm') { renderHome(view); } });
window.addEventListener('select-date', (e) => { selectDate(e.detail); if (parseHash().path === 'home') renderHome(view); });
store.subscribe(() => {
  const p = parseHash().path;
  if (p === 'home' || p === 'alarm' || p === 'album' || p === 'growth' || p === 'settings') render();
  syncReminders();
});

// iOS：首次触摸时解锁声音
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

// 每 5 秒检查是否到了提醒时间（App 打开时弹出全屏闹钟）
setInterval(checkDueAlarms, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDueAlarms(); render(); } });

// 跨天时刷新“今天/明天”
let lastDay = new Date().getDate();
// v1.10.1：定时到次日 0 点重算（天数/月龄），再加每分钟兜底
function scheduleMidnight() {
  const n = new Date(); const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
  setTimeout(() => { lastDay = new Date().getDate(); render(); scheduleMidnight(); }, next - n);
}
scheduleMidnight();
setInterval(() => { if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); render(); } }, 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(() => refreshOnLaunch()).catch((e) => console.warn('SW 注册失败', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'alarm' && d.rid && d.eventId && !store.isFired(d.rid) && !alarmShowing()) showAlarm({ rid: d.rid, eventId: d.eventId });
    if (d.type === 'open-url' && d.url) {
      const u = new URL(d.url);
      const qs = new URLSearchParams((u.hash.split('?')[1]) || '');
      if (u.hash.startsWith('#/alarm') && qs.get('rid') && qs.get('e')) showAlarm({ rid: qs.get('rid'), eventId: qs.get('e') });
      else location.href = d.url;
    }
  });
}

initSync(); // 仅当 config.js 配置了 syncApi 时启用

// 先消化邀请，再首屏渲染，避免与「选身份」引导抢弹层
const bootedWithJoin = !!pendingJoinParams;
consumePendingJoin().then((joined) => {
  if (joined) {
    renderSettings(view);
    setTab('settings');
  } else {
    render();
  }
  setTimeout(checkDueAlarms, 800);
  const pairKey = takePendingPairKey();
  if (pairKey && syncAvailable()) openPairSheet(pairKey);
  if (!hasRole() && !bootedWithJoin && !joined) {
    setTimeout(() => openRolePicker(), 400);
  }
});
