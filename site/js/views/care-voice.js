import { CARE_LABELS, careDetail } from '../care.js';
import { interpretCareSpeech } from '../care-voice.js';
import { cnDate } from '../dates.js';
import { requireEditEvents } from '../roles.js';
import { store } from '../store.js';
import { closeSheet, openSheet } from '../ui.js';
import { setupTap, speechSupported } from './voice.js';

const EXAMPLE = '例如「今天早上八点瓶喂了九十毫升配方奶，然后九点拉了一次软便」。';

export function openCareVoice({ day, onSaved }) {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  let pending = [];
  let lastSaved = [];
  openSheet(`<h3>喂养语音记录</h3>
    <div class="care-voice-thread" id="care-voice-thread" role="log" aria-label="喂养记录对话"></div>
    <form id="care-voice-form">
      <label class="small muted" for="care-voice-text">也可以用键盘话筒或文字输入</label>
      <textarea class="input" id="care-voice-text" rows="2" maxlength="500" placeholder="说一件刚发生的事"></textarea>
      <button class="btn secondary v-hold" id="care-voice-mic" type="button" hidden>🎙️ 点一下说话</button>
      <p class="care-voice-note small muted">${speechSupported() ? '说完会自动识别并记录。' : '用键盘话筒转成文字后，点「识别并记录」。'}</p>
      <div class="btn-row">
        <button class="btn ghost" id="care-voice-close" type="button">完成</button>
        <button class="btn" type="submit">识别并记录</button>
      </div>
      <div class="care-voice-actions">
        <button class="care-link" type="button" id="care-voice-reset" hidden>重新开始</button>
        <button class="care-link" type="button" id="care-voice-undo" hidden>撤销本次记录</button>
      </div>
    </form>`, (sheet) => {
    const q = (query) => sheet.querySelector(query);
    const thread = q('#care-voice-thread');
    const input = q('#care-voice-text');
    const undo = q('#care-voice-undo');
    const reset = q('#care-voice-reset');
    const message = (text, user = false) => {
      const item = document.createElement('p');
      item.className = user ? 'care-voice-user' : 'care-voice-reply';
      item.textContent = text;
      thread.append(item);
      thread.scrollTop = thread.scrollHeight;
    };
    message(EXAMPLE);
    const receive = (raw) => {
      const text = raw.trim();
      if (!text || !requireEditEvents()) return;
      if (text.length > 500) { message('请把内容分成几句，每次说短一点。'); return; }
      const result = interpretCareSpeech(text, { day, now: Date.now(), medicines: store.meds().map((m) => m.name), pending });
      message(text, true);
      if (result.question) {
        pending = result.pending;
        input.value = '';
        reset.hidden = !pending.length;
        message(result.question);
        return;
      }
      try {
        lastSaved = store.addCare(result.records);
      } catch {
        message('本机保存失败，请保留这句话后重试。');
        return;
      }
      pending = [];
      day = lastSaved[0].date;
      input.value = '';
      reset.hidden = true;
      undo.hidden = false;
      const lines = lastSaved.map((record) => {
        const title = record.kind === 'dose' ? record.name : CARE_LABELS[record.kind];
        return [cnDate(record.date), record.time, title, careDetail(record)].filter(Boolean).join(' · ');
      });
      message(`已记录 ${lines.length} 条\n${lines.join('\n')}`);
      onSaved(lastSaved);
    };
    q('#care-voice-form').onsubmit = (event) => { event.preventDefault(); receive(input.value); };
    q('#care-voice-close').onclick = closeSheet;
    reset.onclick = () => {
      pending = [];
      input.value = '';
      reset.hidden = true;
      message('已清除待补充的内容，可以重新说。');
    };
    undo.onclick = () => {
      if (!lastSaved.length || !requireEditEvents()) return;
      if (lastSaved.some((record) => store.getCare(record.id)?.updatedAt !== record.updatedAt)) {
        message('本次记录已有变化，请在记录页逐条查看。');
        return;
      }
      try { store.deleteCareBatch(lastSaved.map((record) => record.id)); }
      catch { message('撤销未保存，请重试。'); return; }
      message(`已撤销 ${lastSaved.length} 条记录。`);
      lastSaved = [];
      undo.hidden = true;
    };
    setupTap(q('#care-voice-mic'), input, { append: false, onFinal: receive });
  });
}
