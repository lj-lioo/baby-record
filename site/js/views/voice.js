// v1.11.0「🎤 说一句话记事」弹层（v1.11.2：点按说话）
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
    <button type="button" class="btn secondary v-hold" id="v-hold" hidden>🎙️ 点一下说话</button>
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
    setupTap(q('#v-hold'), ta);
    setTimeout(() => ta.focus(), 50);
  });
}

// v1.11.2 点按说话：点一下开始听，再点一下结束；每次启动前 abort 解绑旧实例；15s 看门狗；结束后 1.5s 强制复位；连续失败 2 次降级
const HOLD_IDLE = '🎙️ 点一下说话';
const HOLD_ON = '🔴 正在听…再点一下结束';
export const HOLD_WATCHDOG_MS = 15000;
const TAP_DEBOUNCE_MS = 350;

function setupTap(btn, ta) {
  if (!speechSupported()) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  btn.hidden = false;
  let rec = null, listening = false, gotText = false, fails = 0, watchdog = 0, endTimer = 0, base = '', lastTap = 0;
  const tip = document.createElement('div');
  tip.className = 'small v-hold-tip'; tip.id = 'v-hold-tip'; tip.hidden = true;
  btn.after(tip);
  const detach = (r) => { if (!r) return; r.onresult = r.onerror = r.onend = r.onstart = r.onspeechend = null; };
  const reset = () => {
    clearTimeout(watchdog); clearTimeout(endTimer);
    const r = rec; rec = null;
    if (r) { detach(r); try { r.abort(); } catch {} }
    listening = false;
    btn.classList.remove('on'); btn.textContent = HOLD_IDLE;
    if (ta.value.trim()) ta.dispatchEvent(new Event('input'));
  };
  const fail = () => {
    fails++;
    if (fails >= 2) {
      tip.hidden = false; tip.textContent = '这台手机按钮识别不稳定，请用键盘上的 🎤';
      setTimeout(() => ta.focus(), 0);
    }
  };
  const finish = (ok) => { if (ok) { fails = 0; } else fail(); reset(); };
  const start = () => {
    reset(); // 不论之前状态如何，先彻底清掉旧实例
    let r;
    try {
      r = new SR(); rec = r; r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false;
      gotText = false;
      base = ta.value ? ta.value.replace(/[\s。]*$/, '') : '';
      r.onresult = (ev) => {
        if (r !== rec) return;
        let s = ''; for (const x of ev.results) s += x[0].transcript;
        s = s.trim();
        if (s) { gotText = true; ta.value = (base ? base + '。' : '') + s; ta.dispatchEvent(new Event('input')); }
      };
      r.onerror = (ev) => { if (r !== rec) return; finish(gotText && ev.error !== 'not-allowed' && ev.error !== 'service-not-allowed'); };
      r.onend = () => { if (r !== rec) return; finish(gotText || !listening); };
      r.start();
      listening = true;
      btn.classList.add('on'); btn.textContent = HOLD_ON;
      watchdog = setTimeout(() => { if (r === rec) finish(gotText); }, HOLD_WATCHDOG_MS);
    } catch { rec = null; detach(r); finish(false); }
  };
  const stop = () => {
    if (!rec) return;
    listening = false;
    const r = rec;
    try { r.stop(); } catch { finish(gotText); return; }
    // 等最终结果；onend 不来则 1.5 秒后强制复位
    clearTimeout(endTimer); endTimer = setTimeout(() => { if (r === rec) finish(gotText); }, 1500);
  };
  const onTap = (e) => {
    if (e) {
      if (e.cancelable) e.preventDefault();
      // 防误触双击 / iOS 上 click 前可能先到 pointerup，去重
      const now = Date.now();
      if (now - lastTap < TAP_DEBOUNCE_MS) return;
      lastTap = now;
    }
    if (listening && rec) stop();
    else start();
  };
  // 优先 click（点按制）；pointerup 仅作兜底且与 click 去重；不再用 press-and-hold
  btn.addEventListener('click', onTap);
  btn.addEventListener('pointerup', (e) => {
    // 桌面鼠标会先 pointerup 再 click，都走 onTap 时靠 debounce 去重
    if (e.pointerType === 'touch' || e.pointerType === 'pen') onTap(e);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  new MutationObserver((_, o) => { if (!btn.isConnected) { reset(); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
}
