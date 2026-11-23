import { CARE_LABELS, careDetail } from '../care.js';
import { interpretCareSpeech } from '../care-voice.js';
import { cnDate } from '../dates.js';
import { requireEditEvents } from '../roles.js';
import { store } from '../store.js';
import { closeSheet, openSheet } from '../ui.js';
import { careListener } from './care-listen.js';

const EXAMPLE = '例如「今天早上八点瓶喂了九十毫升配方奶，然后九点拉了一次软便」。';
const DICTATION_PAUSE_MS = 2300;
const LISTEN_ERRORS = new Map([
  ['not-allowed', '麦克风权限受限，请检查此网站的权限'],
  ['service-not-allowed', '当前打开方式无法使用语音识别服务'],
  ['audio-capture', '无法录音，请检查麦克风是否被占用'],
  ['network', '语音识别连接失败，请检查网络'],
  ['language-not-supported', '当前语音识别服务不支持普通话'],
]);

export function openCareVoice({ day, onSaved }) {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let pending = [];
  let lastSaved = [];
  openSheet(`<h3>喂养语音记录</h3>
    <div class="care-voice-thread" id="care-voice-thread" role="log" aria-label="喂养记录对话"></div>
    <div class="care-listen-bar" id="care-listen-bar">
      <button class="btn secondary" id="care-voice-mic" type="button">🎙️ 开始听写</button>
      <div class="care-listen-feedback">
        <p id="care-voice-status" class="small" role="status">说完自动记录</p>
        <p id="care-voice-draft" class="small" hidden></p>
      </div>
      <button class="btn secondary" id="care-voice-stop" type="button" hidden>结束</button>
      <button class="care-link" id="care-voice-abort" type="button" hidden>取消听写</button>
    </div>
    <form id="care-voice-form" hidden>
      <label class="small muted" id="care-voice-label" for="care-voice-text"></label>
      <textarea class="input" id="care-voice-text" rows="2" maxlength="500" placeholder="说一件刚发生的事"></textarea>
      <button class="btn block" id="care-voice-send" type="submit">发送</button>
    </form>
    <div class="care-voice-footer">
      <div class="care-voice-actions">
        <button class="care-link" type="button" id="care-voice-keyboard">键盘听写</button>
        <button class="care-link" type="button" id="care-voice-type">打字</button>
        <button class="care-link" type="button" id="care-voice-close">完成</button>
      </div>
      <div class="care-voice-actions">
        <button class="care-link" type="button" id="care-voice-reset" hidden>重新开始</button>
        <button class="care-link" type="button" id="care-voice-undo" hidden>撤销本次记录</button>
      </div>
    </div>`, (sheet) => {
    const q = (query) => sheet.querySelector(query);
    const thread = q('#care-voice-thread');
    const input = q('#care-voice-text');
    const undo = q('#care-voice-undo');
    const reset = q('#care-voice-reset');
    const form = q('#care-voice-form');
    const mic = q('#care-voice-mic');
    const stop = q('#care-voice-stop');
    const abort = q('#care-voice-abort');
    const status = q('#care-voice-status');
    const draft = q('#care-voice-draft');
    let inputMode = '';
    let dictationTimer;
    let composing = false;
    const message = (text, user = false) => {
      const item = document.createElement('p');
      item.className = user ? 'care-voice-user' : 'care-voice-reply';
      item.textContent = text;
      thread.append(item);
      thread.scrollTop = thread.scrollHeight;
    };
    message(EXAMPLE);
    const receive = (raw) => {
      clearTimeout(dictationTimer);
      const text = raw.trim();
      if (!text || !thread.isConnected || document.hidden || !requireEditEvents()) return;
      if (text.length > 500) { message('请把内容分成几句，每次说短一点。'); return; }
      const result = interpretCareSpeech(text, { day, now: Date.now(), medicines: store.meds().map((m) => m.name), pending });
      message(text, true);
      if (result.question) {
        pending = result.pending;
        input.value = '';
        reset.hidden = !pending.length;
        message(result.question);
        mic.textContent = '🎙️ 继续听写';
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
      mic.textContent = '🎙️ 再记一条';
      onSaved(lastSaved);
    };
    const listener = careListener(Recognition, {
      onState: (state) => {
        const idle = state === 'idle';
        mic.hidden = !idle;
        stop.hidden = idle;
        stop.disabled = state === 'finishing';
        abort.hidden = idle;
        status.textContent = { idle: '说完自动记录', listening: '正在听写…', finishing: '正在转换成文字…' }[state];
        q('#care-listen-bar').classList.toggle('listening', !idle);
      },
      onText: (text) => { draft.textContent = text; draft.hidden = !text; },
      onFinal: (text) => {
        draft.hidden = true;
        receive(text);
      },
      onError: (error) => {
        draft.hidden = true;
        if (error === 'no-speech' || error === 'aborted') {
          status.textContent = error === 'no-speech' ? '没听清，可以再说一次' : '听写已中断，可以重试';
          return;
        }
        status.textContent = LISTEN_ERRORS.get(error) || '直接听写启动失败，可以用键盘听写';
        mic.textContent = '🎙️ 重试听写';
        // A fresh tap is needed to bring up the system keyboard on iPhone after an async error.
        openInput('dictation', { focus: false });
      },
    });
    const start = () => {
      clearTimeout(dictationTimer);
      composing = false;
      inputMode = '';
      input.blur();
      form.hidden = true;
      listener.start();
    };
    const openInput = (mode, { focus = true } = {}) => {
      listener.cancel();
      clearTimeout(dictationTimer);
      composing = false;
      inputMode = mode;
      draft.hidden = true;
      form.hidden = false;
      q('#care-voice-send').hidden = mode === 'dictation';
      q('#care-voice-label').textContent = mode === 'dictation' ? '轻点输入框，再点键盘上的话筒，转成文字后会自动处理' : '输入要记录的内容';
      if (focus) input.focus();
    };
    const awaitDictation = () => {
      clearTimeout(dictationTimer);
      if (inputMode !== 'dictation' || composing || !input.value.trim()) return;
      dictationTimer = setTimeout(() => {
        if (form.isConnected && inputMode === 'dictation' && !composing && !document.hidden) receive(input.value);
      }, DICTATION_PAUSE_MS);
    };
    input.oncompositionstart = () => { composing = true; clearTimeout(dictationTimer); };
    input.oncompositionend = () => { composing = false; awaitDictation(); };
    input.oninput = (event) => { if (!event.isComposing) awaitDictation(); };
    form.onsubmit = (event) => {
      event.preventDefault();
      if (inputMode === 'typing' && !composing) receive(input.value);
    };
    mic.onclick = start;
    stop.onclick = listener.stop;
    abort.onclick = () => { listener.cancel(); draft.hidden = true; };
    q('#care-voice-keyboard').onclick = () => openInput('dictation');
    q('#care-voice-type').onclick = () => openInput('typing');
    q('#care-voice-close').onclick = closeSheet;
    reset.onclick = () => {
      pending = [];
      clearTimeout(dictationTimer);
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
    const cancelInBackground = () => {
      if (!document.hidden) return;
      listener.cancel();
      clearTimeout(dictationTimer);
      draft.hidden = true;
    };
    document.addEventListener('visibilitychange', cancelInBackground);
    const observer = new MutationObserver(() => {
      if (thread.isConnected) return;
      listener.cancel();
      clearTimeout(dictationTimer);
      document.removeEventListener('visibilitychange', cancelInBackground);
      observer.disconnect();
    });
    observer.observe(sheet, { childList: true });
    if (Recognition) start();
    else {
      q('#care-listen-bar').hidden = true;
      openInput('dictation');
    }
  });
}
