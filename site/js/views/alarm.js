// 全屏“闹钟”页：清楚显示为什么响、什么事、几点，支持「知道了」「稍后提醒(10分钟)」
import { store, uid } from '../store.js';
import { CATEGORIES } from '../categories.js';
import { allReminderInstances, eventWhenText, whyText, eventStart } from '../reminders.js';
import { pad, fmtDateTime } from '../dates.js';
import { esc, toast } from '../ui.js';
import { startAlarmSound, stopAlarmSound, unlockAudio } from '../sound.js';
import { syncReminders } from '../push.js';

let current = null, clockTimer = null;
export const alarmShowing = () => !!current;

export function showAlarm({ rid, eventId, fireAt, label, ev: evOverride }) {
  const ev = evOverride || store.getEvent(eventId);
  if (!ev) { toast('这个事项已被删除'); return; }
  if (current && current.rid === rid) return;
  const inst = allReminderInstances().find((x) => x.rid === rid);
  fireAt = fireAt || inst?.fireAt || Date.now();
  label = label || inst?.label || '提醒';
  current = { rid, eventId };
  const c = CATEGORIES[ev.category];
  const el = document.getElementById('alarm');
  el.className = `alarm ${c.cls}`;
  el.innerHTML = `
    <div class="a-top">宝宝提醒 · ${c.icon} ${c.label}</div>
    <div class="bell">${ev.category === 'vaccine' ? '💉' : ev.category === 'paidvax' ? '💰' : ev.category === 'checkup' ? '🩺' : '⏰'}</div>
    <div class="a-clock" id="aClock"></div>
    <div class="a-title">${esc(ev.title)}</div>
    <div class="a-when">📅 ${esc(eventWhenText(ev))}</div>
    <div class="a-why">
      <div class="lab">为什么现在提醒你</div>
      <div class="val">${esc(whyText(ev, fireAt, label))}</div>
      <div class="lab" style="margin-top:8px">提醒时间</div>
      <div class="val">${esc(fmtDateTime(fireAt))}</div>
      ${ev.note ? `<div class="lab" style="margin-top:8px">备注</div><div class="a-note">${esc(ev.note)}</div>` : ''}
    </div>
    <div class="sound-hint" id="aSound"></div>
    <div class="a-actions">
      <button class="btn block" id="aOk">知道了</button>
      <button class="btn secondary block" id="aSnooze">稍后提醒（10分钟）</button>
      ${ev.category !== 'other' && eventStart(ev) <= Date.now() + 864e5 ? '<button class="btn ghost block" id="aDone">✅ 已经完成了</button>' : ''}
    </div>`;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  const tick = () => { const d = new Date(); el.querySelector('#aClock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  tick(); clockTimer = setInterval(tick, 10000);
  if (store.state.settings.sound) {
    const ok = startAlarmSound();
    if (!ok) {
      const hint = el.querySelector('#aSound');
      hint.innerHTML = '<button class="chip-btn">🔊 点此播放提醒铃声</button>';
      hint.querySelector('button').onclick = () => { unlockAudio(); startAlarmSound(); hint.innerHTML = ''; };
    }
  }
  el.querySelector('#aOk').onclick = () => { store.markFired(rid); closeAlarm(); };
  el.querySelector('#aSnooze').onclick = () => {
    store.markFired(rid);
    store.addSnooze({ id: `snz-${uid()}`, eventId, fireAt: Date.now() + 10 * 60000, label: '稍后提醒（10分钟）' });
    syncReminders(true);
    closeAlarm();
    toast('好的，10分钟后再提醒你 ⏰');
  };
  const done = el.querySelector('#aDone');
  if (done) done.onclick = () => { store.markFired(rid); store.setDone(eventId, true); closeAlarm(); toast('已标记为已完成 ✅'); };
}

export function closeAlarm() {
  stopAlarmSound();
  clearInterval(clockTimer);
  current = null;
  const el = document.getElementById('alarm');
  el.hidden = true; el.innerHTML = '';
  document.body.style.overflow = '';
  if (location.hash.startsWith('#/alarm')) history.replaceState(null, '', '#/');
  window.dispatchEvent(new CustomEvent('rerender'));
}

// App 打开时：到点（15分钟内）且未确认的提醒，直接弹出全屏闹钟
export function checkDueAlarms() {
  if (current) return;
  const now = Date.now();
  const due = allReminderInstances().find((x) => x.fireAt <= now && now - x.fireAt < 15 * 60000 && !store.isFired(x.rid));
  if (due) showAlarm(due);
}
