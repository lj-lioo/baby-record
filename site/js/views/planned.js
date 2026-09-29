// 「📆 改计划日」：计划接种/体检日期与时间（事项的 date/time）。不能早于最早日期；晚于最迟日期会提醒但允许保存（补种）。
import { store } from '../store.js';
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { todayStr, cnDate, weekday, addDays, parseYmd } from '../dates.js';
import { windowOf, planOutside } from '../windows.js';
import { maybeCascade } from './paidcat.js';

const fmt = (d) => `${cnDate(d, d.slice(0, 4) !== todayStr().slice(0, 4))} ${weekday(d)}`;

// from 之后（不含 from）的 n 个周六/周日
function nextWeekend(from, n) {
  const out = [];
  for (let i = 1; i < 40 && out.length < n; i++) {
    const d = addDays(from, i), wd = parseYmd(d).getDay();
    if (wd === 6 || wd === 0) out.push(d);
  }
  return out;
}

export function openPlannedSheet(ev) {
  const w = windowOf(ev, store.state.settings.babyBirthday);
  const noun = ev.category === 'checkup' ? '体检' : ev.category === 'other' ? '' : '接种';
  const base = w && w.earliest > todayStr() ? w.earliest : todayStr();
  const chips = [...new Set([...(w && w.earliest >= todayStr() ? [w.earliest] : []), ...nextWeekend(addDays(base, -1), 4)])].filter((d) => !w || d >= w.earliest).slice(0, 4);
  openSheet(`
    <h3>📆 改计划${noun}日</h3>
    <p style="margin:0 0 8px;font-weight:700">${esc(ev.title)}</p>
    ${w ? `<div class="pd-win">🪟 ${noun || ''}窗口${w.ref ? '（参考）' : ''}：<b>最早 ${esc(fmt(w.earliest))}</b>${w.latest ? ` – <b>最迟 ${esc(fmt(w.latest))}</b>` : '起（未规定最迟）'}</div>` : ''}
    <div class="row2" style="margin-top:10px">
      <div class="field"><label for="pd-date">计划日期</label><input id="pd-date" type="date" class="input" value="${esc(ev.date)}" ${w ? `min="${w.earliest}"` : ''}></div>
      <div class="field"><label for="pd-time">时间</label><input id="pd-time" type="time" class="input" value="${esc(ev.time || '')}"></div>
    </div>
    ${chips.length ? `<div class="quick" id="pd-chips" style="margin:-6px 0 10px">${chips.map((d) => `<button type="button" data-d="${d}">${w && d === w.earliest ? '最早 ' : ''}${esc(fmt(d))}</button>`).join('')}</div>` : ''}
    <div id="pd-warn"></div>
    ${ev.alarmAdded ? '<p class="note small">⏰ 这个事项已设过 iPhone 闹钟。改了计划日后会显示「需重设闹钟」：请到「提醒事项」的「宝宝」列表删掉旧提醒，再点「⏰ 设为闹钟提醒」。</p>' : ''}
    <p class="small muted" style="margin:4px 0 10px">提醒（前一天 20:00、当天 08:00 等）、闹钟和苹果日历都会按计划日期/时间。</p>
    <div class="btn-row">
      <button type="button" class="btn ghost" id="pd-cancel">取消</button>
      <button type="button" class="btn" id="pd-save">保存计划日</button>
    </div>`, (s) => {
    s.dataset.kind = 'planned';
    const q = (sel) => s.querySelector(sel);
    const check = () => {
      const d = q('#pd-date').value;
      const out = d ? planOutside(d, w) : '';
      q('#pd-warn').innerHTML = !d ? '<p class="bad small">请选择日期</p>'
        : out === 'early' ? `<p class="pd-bad">⛔ 早于最早${noun}日（${esc(fmt(w.earliest))}），门诊不能提前${noun || '安排'}。请选 ${esc(fmt(w.earliest))} 或之后。</p>`
          : out === 'late' ? `<p class="pd-warn">⚠️ 晚于最迟日期（${esc(fmt(w.latest))}），属于逾期补种，建议尽量提前。</p>`
            : w ? '<p class="ok small" style="margin:0 0 8px">✓ 在窗口内</p>' : '';
      q('#pd-save').disabled = !d || out === 'early';
      s.querySelectorAll('#pd-chips button').forEach((b) => b.classList.toggle('on', b.dataset.d === d));
    };
    q('#pd-date').oninput = check; q('#pd-date').onchange = check;
    s.querySelectorAll('#pd-chips button').forEach((b) => { b.onclick = () => { q('#pd-date').value = b.dataset.d; check(); }; });
    q('#pd-cancel').onclick = closeSheet;
    q('#pd-save').onclick = () => {
      const date = q('#pd-date').value, time = q('#pd-time').value || '';
      if (!date || planOutside(date, w) === 'early') return;
      const cur = store.getEvent(ev.id);
      if (!cur) { closeSheet(); return; }
      if (cur.date === date && (cur.time || '') === time) { closeSheet(); return; }
      store.upsertEvent({ ...cur, date, time });
      closeSheet();
      toast(`计划日已改为 ${cnDate(date)} ${weekday(date)}${time ? ' ' + time : ''}${cur.alarmAdded ? '，请重设闹钟' : ''}`, 3000);
      window.dispatchEvent(new CustomEvent('select-date', { detail: date }));
      if (cur.date !== date) maybeCascade(cur.id); // v1.7.0：自费疫苗系列：提示后续剂次一起顺延
    };
    check();
  });
}
