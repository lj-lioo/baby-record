// 添加 / 编辑事项面板（含多提醒设置）
import { store, uid } from '../store.js';
import { CATEGORIES } from '../categories.js';
import { PRESETS, fireAtOf, reminderLabel, defaultReminders } from '../reminders.js';
import { fmtDateTime, toLocalInput, addDays, cnDate, weekday } from '../dates.js';
import { esc, openSheet, closeSheet, toast, confirmSheet } from '../ui.js';
import { openICS } from '../ics.js';
import { openAlarmSheet, offerOldAlarmCleanup } from './actions.js';
import { alarmSig } from '../shortcuts.js';
import { windowOf } from '../windows.js';
import { maybeCascade } from './paidcat.js';

const QUICK = {
  vaccine: ['打疫苗', '乙肝疫苗', '卡介苗', '脊灰疫苗', '百白破疫苗', '麻腮风疫苗', '流感疫苗'],
  paidvax: ['13价肺炎', '五联疫苗', '五价轮状', 'EV71手足口', '流感疫苗', '水痘疫苗', 'RSV单抗'],
  checkup: ['儿保体检', '满月体检', '42天体检', '3月龄体检', '6月龄体检', '听力复查'],
  other: ['办出生证明', '上户口', '办医保', '剪头发'],
};

export function openEditor({ id = null, date = null } = {}) {
  const existing = id ? store.getEvent(id) : null;
  const ev = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), date, time: '', title: '', category: 'vaccine', note: '', done: false, reminders: defaultReminders(false),
  };
  let touchedReminders = !!existing;

  const win = existing ? windowOf(ev, store.state.settings.babyBirthday) : null;
  const html = `
    <h3>${existing ? '编辑事项' : '添加事项'}</h3>
    <div class="field">
      <label for="f-title">标题</label>
      <input id="f-title" class="input" maxlength="60" placeholder="例如：打疫苗" value="${esc(ev.title)}">
      <div class="quick" id="f-quick"></div>
    </div>
    <div class="field">
      <div class="flabel">类别</div>
      <div class="seg" id="f-cat">
        ${Object.entries(CATEGORIES).map(([k, c]) => `<button type="button" data-cat="${k}" class="cat-${k}">${c.icon} ${k === 'other' ? '其他重要事项' : c.label}</button>`).join('')}
      </div>
    </div>
    <div class="row2">
      <div class="field"><label for="f-date">${win ? '计划日期' : '日期'}</label><input id="f-date" type="date" class="input" value="${esc(ev.date)}"></div>
      <div class="field"><label for="f-time">时间（可不填）</label><input id="f-time" type="time" class="input" value="${esc(ev.time)}"></div>
    </div>
    ${win ? `<p class="small muted" style="margin:-8px 0 12px">🪟 窗口${win.ref ? '（参考）' : ''}：最早 ${cnDate(win.earliest, true)}${win.latest ? ` – 最迟 ${cnDate(win.latest, true)}` : ' 起（未规定最迟）'}</p>` : ''}
    <div class="field">
      <label for="f-note">备注（可不填）</label>
      <textarea id="f-note" class="input" maxlength="500" placeholder="例如：带上疫苗本和医保卡">${esc(ev.note)}</textarea>
    </div>
    <div class="field">
      <div class="flabel">⏰ 提醒时间（可多选）</div>
      <div class="chips" id="f-presets"></div>
      <div id="f-customs"></div>
      <button type="button" class="link-btn" id="f-addcustom">＋ 添加自定义提醒时间</button>
      <div class="preview" id="f-preview"></div>
    </div>
    ${existing ? `<div class="field"><div class="btn-row">
        <button type="button" class="btn" id="f-sc">⏰ 设为闹钟提醒</button>
        <button type="button" class="btn dark" id="f-ics">📅 苹果日历</button>
      </div>
      <label class="kv" style="margin-top:8px"><span>已设为 iPhone 闹钟（避免重复添加）</span><input type="checkbox" id="f-added" ${ev.alarmAdded ? 'checked' : ''}></label>
      </div>` : ''}
    <div class="btn-row" style="margin-top:6px">
      ${existing ? '<button type="button" class="btn danger" id="f-del">删除</button>' : '<button type="button" class="btn ghost" id="f-cancel">取消</button>'}
      <button type="button" class="btn" id="f-save">保存</button>
    </div>`;

  openSheet(html, (s) => {
    const q = (sel) => s.querySelector(sel);
    const readForm = () => {
      ev.title = q('#f-title').value.trim();
      ev.date = q('#f-date').value || ev.date;
      ev.time = q('#f-time').value || '';
      ev.note = q('#f-note').value.trim();
    };
    const renderCat = () => {
      s.querySelectorAll('#f-cat button').forEach((b) => b.classList.toggle('on', b.dataset.cat === ev.category));
      q('#f-quick').innerHTML = QUICK[ev.category].map((t) => `<button type="button">${esc(t)}</button>`).join('');
      q('#f-quick').querySelectorAll('button').forEach((b) => { b.onclick = () => { q('#f-title').value = b.textContent; }; });
    };
    const renderReminders = () => {
      readForm();
      const hasTime = !!ev.time;
      q('#f-presets').innerHTML = PRESETS.map((p) => {
        const on = ev.reminders.some((r) => r.kind === 'preset' && r.preset === p.key);
        const dis = p.needsTime && !hasTime;
        return `<button type="button" data-p="${p.key}" class="${on && !dis ? 'on' : ''}" ${dis ? 'disabled title="需要先填写时间"' : ''}>${p.label}</button>`;
      }).join('');
      q('#f-presets').querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          touchedReminders = true;
          const k = b.dataset.p;
          const i = ev.reminders.findIndex((r) => r.kind === 'preset' && r.preset === k);
          if (i >= 0) ev.reminders.splice(i, 1); else ev.reminders.push({ id: uid(), kind: 'preset', preset: k });
          renderReminders();
        };
      });
      const customs = ev.reminders.filter((r) => r.kind === 'abs');
      q('#f-customs').innerHTML = customs.map((r) => `
        <div class="custom-row" data-id="${r.id}">
          <input type="datetime-local" class="input" value="${esc(r.at)}" aria-label="自定义提醒时间">
          <button type="button" class="x-btn" aria-label="删除">✕</button>
        </div>`).join('');
      q('#f-customs').querySelectorAll('.custom-row').forEach((row) => {
        const r = ev.reminders.find((x) => x.id === row.dataset.id);
        row.querySelector('input').onchange = (e) => { r.at = e.target.value; touchedReminders = true; renderPreview(); };
        row.querySelector('.x-btn').onclick = () => { ev.reminders = ev.reminders.filter((x) => x !== r); renderReminders(); };
      });
      renderPreview();
    };
    const renderPreview = () => {
      const list = ev.reminders.map((r) => ({ r, at: fireAtOf(ev, r) })).filter((x) => x.at != null).sort((a, b) => a.at - b.at);
      q('#f-preview').innerHTML = list.length
        ? list.map((x) => `<div class="${x.at < Date.now() ? 'past' : ''}">🔔 ${esc(fmtDateTime(x.at))} · ${esc(reminderLabel(x.r))}${x.at < Date.now() ? '（已过）' : ''}</div>`).join('')
        : '<div>未设置提醒（不会响铃）</div>';
    };

    renderCat();
    renderReminders();
    s.querySelectorAll('#f-cat button').forEach((b) => { b.onclick = () => { ev.category = b.dataset.cat; renderCat(); }; });
    q('#f-time').onchange = () => {
      const hadTime = !!ev.time;
      readForm();
      // 新建事项首次填写时间时，自动加上“提前1小时”
      if (!touchedReminders && !hadTime && ev.time && !ev.reminders.some((r) => r.preset === 'h1')) ev.reminders.push({ id: uid(), kind: 'preset', preset: 'h1' });
      renderReminders();
    };
    q('#f-date').onchange = renderReminders;
    q('#f-addcustom').onclick = () => {
      readForm();
      const base = new Date(); base.setMinutes(0, 0, 0); base.setHours(base.getHours() + 1);
      ev.reminders.push({ id: uid(), kind: 'abs', at: toLocalInput(base.getTime()) });
      touchedReminders = true;
      renderReminders();
    };
    q('#f-save').onclick = () => {
      readForm();
      if (!ev.title) { toast('请填写标题'); q('#f-title').focus(); return; }
      if (!ev.date) { toast('请选择日期'); return; }
      // 去掉无效的提醒（需要时间但未填时间、或自定义时间为空）
      ev.reminders = ev.reminders.filter((r) => fireAtOf(ev, r) != null);
      store.upsertEvent(ev);
      if (ev.alarmAdded && !ev.alarmSig) store.setAlarmAdded(ev.id, true, alarmSig(store.getEvent(ev.id)));
      closeSheet();
      toast(existing ? '已保存修改' : `已添加到 ${cnDate(ev.date)}${weekday(ev.date)}`);
      window.dispatchEvent(new CustomEvent('select-date', { detail: ev.date }));
      if (existing && existing.date !== ev.date) maybeCascade(ev.id); // v1.7.0：自费疫苗系列：后续剂次一起顺延
    };
    if (existing) {
      q('#f-del').onclick = async () => {
        const ok = await confirmSheet(`确定删除「${ev.title}」吗？`, '删除', true);
        if (ok) {
          const old = store.getEvent(ev.id);
          store.deleteEvent(ev.id); toast('已删除');
          offerOldAlarmCleanup([old], `「${ev.title}」已删除`); // v1.7.1：设过闹钟的，提示删除「提醒事项」里的旧闹钟
        }
      };
      q('#f-ics').onclick = () => { readForm(); openICS(ev); };
      q('#f-sc').onclick = () => { readForm(); ev.reminders = ev.reminders.filter((r) => fireAtOf(ev, r) != null); store.upsertEvent(ev); openAlarmSheet(store.getEvent(ev.id)); };
      q('#f-added').onchange = (e2) => { ev.alarmAdded = e2.target.checked; if (!ev.alarmAdded) { ev.alarmSig = ''; ev.alarmTagged = false; } };
    } else {
      q('#f-cancel').onclick = closeSheet;
    }
  });
}
export { addDays };
