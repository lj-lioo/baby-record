// 入口：路由、渲染、提醒检查、Service Worker
import { store } from './store.js';
import { $$, closeSheet } from './ui.js';
import { renderHome, selectDate } from './views/home.js';
import { renderSettings } from './views/settings.js';
import { renderHelp } from './views/help.js';
import { showAlarm, checkDueAlarms, alarmShowing } from './views/alarm.js';
import { syncReminders, refreshOnLaunch } from './push.js';
import { unlockAudio } from './sound.js';
import { initSync, syncAvailable, takePendingPairKey } from './sync.js';
import { openPairSheet } from './views/settings.js';

const view = document.getElementById('view');
const routes = { home: renderHome, settings: renderSettings, help: renderHelp };

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || 'home', params: new URLSearchParams(qs || '') };
}

function render() {
  const { path, params } = parseHash();
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
  if (p === 'home' || p === 'alarm' || p === 'settings') render();
  syncReminders();
});

// iOS：首次触摸时解锁声音
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

// 每 5 秒检查是否到了提醒时间（App 打开时弹出全屏闹钟）
setInterval(checkDueAlarms, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDueAlarms(); render(); } });

// 跨天时刷新“今天/明天”
let lastDay = new Date().getDate();
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

render();
setTimeout(checkDueAlarms, 800);
initSync(); // 仅当 config.js 配置了 syncApi 时启用
const pairKey = takePendingPairKey();
if (pairKey && syncAvailable()) openPairSheet(pairKey);
