// v1.11.0「🎤 说一句话记事」弹层
import { store } from '../store.js';
import { CATEGORIES } from '../categories.js';
import { todayStr, cnDate, weekday } from '../dates.js';
import { defaultReminders } from '../reminders.js';
import { esc, toast, openSheet, closeSheet } from '../ui.js';
import { parseVoice } from '../voice.js';

export function speechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function openVoice() {
  let items = [];
  const html = `
    <h3>🎤 说一句话记事</h3>
    <textarea id="v-text" class="input v-text" rows="3" placeholder="例如：11月5号买奶粉&#10;下周六上午10点打疫苗"></textarea>
    <div class="muted small v-tip">👉 点键盘上的 <b>🎤 话筒</b> 说话；一次说几件事，中间说「句号」或换行即可。</div>
    <button type="button" class="btn secondary v-hold" id="v-hold" hidden>🎙️ 按住说话</button>
    <div id="v-cards"></div>
    <div class="btn-row"><button class="btn ghost" id="v-cancel">取消</button><button class="btn" id="v-save" disabled>记上</button></div>`;
  openSheet(html, (s) => {
    const q = (x) => s.querySelector(x);
    const ta = q('#v-text');
    const render = () => {
      const cards = q('#v-cards');
      cards.innerHTML = items.map((it, i) => `
        <div class="v-card" data-i="${i}">
          <div class="v-row"><input class="input v-title" value="${esc(it.title)}" aria-label="标题"><button type="button" class="x-btn v-del" aria-label="删除">✕</button></div>
          <div class="v-row">
            <input type="date" class="input v-date" value="${esc(it.date)}" aria-label="日期">
            <input type="time" class="input v-time" value="${esc(it.time)}" aria-label="时间">
          </div>
          <div class="v-row v-meta">
            <select class="input v-cat" aria-label="类别">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}"${k === it.category ? ' selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select>
            <span class="muted small v-when">${esc(cnDate(it.date) + weekday(it.date))}${it.time ? ' ' + esc(it.time) : ' 全天'}</span>
          </div>
        </div>`).join('');
      cards.querySelectorAll('.v-card').forEach((el) => {
        const it = items[+el.dataset.i];
        el.querySelector('.v-title').oninput = (e) => { it.title = e.target.value; };
        el.querySelector('.v-date').onchange = (e) => { it.date = e.target.value; render(); };
        el.querySelector('.v-time').onchange = (e) => { it.time = e.target.value; render(); };
        el.querySelector('.v-cat').onchange = (e) => { it.category = e.target.value; };
        el.querySelector('.v-del').onclick = () => { items.splice(+el.dataset.i, 1); render(); };
      });
      const btn = q('#v-save');
      btn.disabled = !items.length;
      btn.textContent = items.length > 1 ? `记上（${items.length}条）` : '记上';
    };
    let timer;
    ta.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { items = parseVoice(ta.value, todayStr()); render(); }, 250); };
    q('#v-cancel').onclick = closeSheet;
    q('#v-save').onclick = () => {
      const list = items.filter((it) => it.title.trim() && it.date)
        .map((it) => ({ title: it.title.trim(), date: it.date, time: it.time || '', category: it.category, note: '语音记事', reminders: defaultReminders(!!it.time) }));
      if (!list.length) { toast('请先说一句话'); return; }
      const added = store.addEvents(list);
      closeSheet();
      toast(added.length === 1 ? `已记上 ${cnDate(added[0].date)}${weekday(added[0].date)}「${added[0].title}」` : `已记上 ${added.length} 条`);
      window.dispatchEvent(new CustomEvent('select-date', { detail: added[0].date }));
    };
    setupHold(q('#v-hold'), ta);
    setTimeout(() => ta.focus(), 50);
  });
}

// 增强：浏览器自带语音识别（部分手机支持；失败则隐藏按钮，仍用键盘听写）
function setupHold(btn, ta) {
  if (!speechSupported()) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, base = '';
  btn.hidden = false;
  const stop = () => { try { rec && rec.stop(); } catch {} btn.classList.remove('on'); btn.textContent = '🎙️ 按住说话'; };
  btn.onpointerdown = (e) => {
    e.preventDefault();
    try {
      rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = true;
      base = ta.value ? ta.value.replace(/\s*$/, '') + '\n' : '';
      rec.onresult = (ev) => { let s = ''; for (const r of ev.results) s += r[0].transcript; ta.value = base + s; ta.dispatchEvent(new Event('input')); };
      rec.onerror = (ev) => { stop(); if (ev.error !== 'aborted' && ev.error !== 'no-speech') { btn.hidden = true; toast('这台手机不支持按住说话，请用键盘上的 🎤'); } };
      rec.start(); btn.classList.add('on'); btn.textContent = '🔴 正在听…松开结束';
    } catch { btn.hidden = true; toast('请用键盘上的 🎤 说话'); }
  };
  btn.onpointerup = btn.onpointerleave = btn.onpointercancel = () => { if (btn.classList.contains('on')) stop(); };
}
