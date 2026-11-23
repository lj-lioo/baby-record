// iPhone 闹钟由苹果「提醒事项」管理。网页只生成创建指令和供家人核对的时间。
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { requireAlarm } from '../roles.js';
import { toLocalInput, weekday } from '../dates.js';
import { futureAlarms, alarmTitle, alarmUrl, alarmSig, alarmTag, createShortcutName } from '../shortcuts.js';
import { store } from '../store.js';

const PENDING = 'babyrecord.alarmPending.';
const FIND_REMINDER = '在「提醒事项」的「宝宝」列表中，按名称、旧的响铃时间和备注里的事项编号核对。';

function pendingAlarm(id) {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING + id) || 'null');
    return typeof pending?.sig === 'string' ? pending : null;
  } catch { return null; }
}

function alarmSnapshot(ev) {
  return pendingAlarm(ev.id) || (ev.alarmAdded ? { sig: ev.alarmSig, tagged: ev.alarmTagged } : null);
}

export function alarmState(ev) {
  const snapshot = alarmSnapshot(ev);
  if (!snapshot) return 'none';
  if (snapshot.sig !== alarmSig(ev)) return 'changed';
  return pendingAlarm(ev.id) ? 'pending' : 'added';
}

function alarmTime(ms) {
  const [date, time] = toLocalInput(ms).split('T');
  return `${date} ${weekday(date)} ${time}`;
}

function snapshotHtml(ev, snapshot) {
  const signature = snapshot.sig || '';
  const separator = signature.indexOf('|');
  const title = separator < 0 ? ev.title : signature.slice(separator + 1) || ev.title;
  const times = separator < 0 ? [] : signature.slice(0, separator).split(',')
    .filter((time) => /^\d{12,13}$/.test(time)).map((time) => alarmTime(Number(time)));
  return `<div class="preview"><b>${esc(title)}</b>
    ${times.length ? `<ul>${times.map((time) => `<li>${esc(time)}</li>`).join('')}</ul>` : '<p class="small muted">旧响铃时间未记录，请在「提醒事项」里核对。</p>'}
    ${snapshot.tagged ? `<div class="small">备注编号 <code>${esc(alarmTag(ev))}</code></div>` : ''}</div>`;
}

export function openAlarmSheet(ev) {
  if (!ev || !requireAlarm()) return;
  const list = futureAlarms(ev);
  const signature = alarmSig(ev);
  const snapshot = alarmSnapshot(ev);
  const state = alarmState(ev);
  const canCreate = state === 'none' && list.length > 0;
  openSheet(`
    <h3>⏰ iPhone 闹钟提醒</h3>
    <p style="margin:0 0 8px;font-weight:700">${esc(ev.title)}</p>
    ${state === 'changed' ? `<p class="note">日程已改，苹果「提醒事项」里的旧闹钟仍可能响。先核对旧提醒，再对照下面的新时间修改原条目。</p>`
      : state === 'pending' ? '<p class="note">已发起快捷指令，等你在「提醒事项」确认是否创建成功。</p>'
      : state === 'added' ? '<p class="note">本事项有已标记的闹钟。可以在「提醒事项」核对时间。</p>' : ''}
    ${snapshot ? `<h4>已设或待核对的提醒</h4>${snapshotHtml(ev, snapshot)}
      <p class="small muted">${FIND_REMINDER} 如果同一事项原本有多个提醒，逐条核对。找不到或无法确认时，先保留现有提醒。</p>` : ''}
    ${list.length ? `<h4>${snapshot ? '当前计划的响铃时间' : '将创建的响铃时间'}</h4>
      <div class="preview">${list.map((x) => `<div>🔔 <b>${esc(alarmTime(x.fireAt))}</b> · ${esc(x.label)}<br><span class="muted">${esc(alarmTitle(ev, x.fireAt))}</span></div>`).join('')}</div>`
      : '<p class="note">当前计划没有未来的响铃时间。若还有旧提醒，请在「提醒事项」核对并按需关闭或移除那一条。</p>'}
    ${canCreate ? `<button type="button" class="btn block" id="al-go" style="margin-top:8px">打开「${esc(createShortcutName())}」</button>
      <p class="small muted">首次使用请按帮助配置仅创建快捷指令。返回后核对是否创建成功。</p>` : ''}
    ${list.length && state !== 'added' ? `<button type="button" class="btn secondary block" id="al-confirm" style="margin-top:8px">${state === 'changed' ? '我已在提醒事项改好' : '我已确认提醒已设好'}</button>` : ''}
    ${snapshot ? '<button type="button" class="btn ghost block" id="al-cleared" style="margin-top:8px">我已确认没有旧提醒</button>' : ''}
    <p class="small"><a href="#/help" id="al-help">闹钟设置帮助</a></p>
    <button class="btn ghost block" id="al-close">关闭</button>`, (s) => {
    s.dataset.kind = 'alarm';
    const currentEvent = () => {
      const current = store.getEvent(ev.id);
      if (!current) { closeSheet(); return null; }
      if (alarmSig(current) !== signature) {
        toast('提醒时间刚有变化，请核对新时间');
        openAlarmSheet(current);
        return null;
      }
      return current;
    };
    const go = s.querySelector('#al-go');
    if (go) go.onclick = () => {
      const current = currentEvent();
      if (!current || alarmSnapshot(current)) return;
      if (!futureAlarms(current).length) { openAlarmSheet(current); return; }
      const target = alarmUrl(current);
      try { localStorage.setItem(PENDING + ev.id, JSON.stringify({ sig: signature, tagged: true })); }
      catch { toast('无法保存本次闹钟状态，请在提醒事项里手动设置'); return; }
      openAlarmSheet(current);
      window.dispatchEvent(new CustomEvent('rerender'));
      location.href = target;
    };
    const confirm = s.querySelector('#al-confirm');
    if (confirm) confirm.onclick = () => {
      const current = currentEvent();
      if (!current) return;
      store.setAlarmAdded(ev.id, true, signature, !!alarmSnapshot(current)?.tagged);
      localStorage.removeItem(PENDING + ev.id);
      openAlarmSheet(store.getEvent(ev.id));
      window.dispatchEvent(new CustomEvent('rerender'));
    };
    const cleared = s.querySelector('#al-cleared');
    if (cleared) cleared.onclick = () => {
      const current = currentEvent();
      if (!current) return;
      localStorage.removeItem(PENDING + ev.id);
      if (current.alarmAdded) store.setAlarmAdded(ev.id, false);
      openAlarmSheet(store.getEvent(ev.id));
      window.dispatchEvent(new CustomEvent('rerender'));
    };
    s.querySelector('#al-close').onclick = closeSheet;
    s.querySelector('#al-help').onclick = () => { closeSheet(); setTimeout(() => document.getElementById('h-shortcut')?.scrollIntoView(), 300); };
  });
}

export function offerOldAlarmCleanup(evs, what = '事项已删除', after = null) {
  const reminders = evs.filter(Boolean).map((ev) => ({ ev, snapshot: alarmSnapshot(ev) })).filter(({ snapshot }) => snapshot);
  if (!reminders.length) return false;
  openSheet(`
    <h3>核对旧闹钟</h3>
    <p class="note">${esc(what)}。如果以下对应条目还在苹果「提醒事项」里，仍可能到点响铃。</p>
    <p class="small">${FIND_REMINDER} 只处理能确认对应的条目。</p>
    ${reminders.map(({ ev, snapshot }) => snapshotHtml(ev, snapshot)).join('')}
    <button class="btn ghost block" id="oc-no" style="margin-top:8px">知道了</button>`, (s) => {
    s.dataset.kind = 'alarmclean';
    s.querySelector('#oc-no').onclick = () => { closeSheet(); if (after) after(); };
  });
  return true;
}
