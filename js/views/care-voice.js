import { CARE_LABELS, careDay, careDetail } from '../care.js';
import { interpretCareSpeech } from '../care-voice.js';
import { cnDate } from '../dates.js';
import { isIOS } from '../push.js';
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
  ['start-timeout', '麦克风未开始收音，可以用键盘听写'],
  ['no-transcript', '麦克风已开启，但识别服务没有返回文字，可以用键盘听写'],
  ['no-speech', '没听清，可以再说一次或用键盘听写'],
  ['aborted', '听写已中断，可以重试或用键盘听写'],
]);

export function openCareVoice({ day, onSaved }) {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const preferSystemKeyboard = isIOS();
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
      <p class="small" id="care-voice-notice" role="status" hidden></p>
      <label class="small muted" id="care-voice-label" for="care-voice-text"></label>
      <textarea class="input" id="care-voice-text" rows="2" maxlength="500" placeholder="说一件刚发生的事"></textarea>
      <button class="btn block" id="care-voice-send" type="submit">发送</button>
    </form>
    <div class="care-voice-footer">
      <div class="care-voice-actions">
        <button class="care-link" type="button" id="care-voice-keyboard">键盘听写</button>
        <button class="care-link" type="button" id="care-voice-web" hidden>网页麦克风</button>
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
    const listenBar = q('#care-listen-bar');
    const mic = q('#care-voice-mic');
    const stop = q('#care-voice-stop');
    const abort = q('#care-voice-abort');
    const status = q('#care-voice-status');
    const draft = q('#care-voice-draft');
    const notice = q('#care-voice-notice');
    const label = q('#care-voice-label');
    const send = q('#care-voice-send');
    const keyboard = q('#care-voice-keyboard');
    const webMic = q('#care-voice-web');
    const type = q('#care-voice-type');
    const viewport = preferSystemKeyboard ? window.visualViewport : null;
    let inputMode = '';
    let dictationTimer;
    let composing = false;
    const fitKeyboard = () => {
      if (!thread.isConnected || viewport.scale !== 1) return;
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      sheet.style.setProperty('--care-keyboard-inset', `${inset}px`);
      sheet.style.setProperty('--care-viewport-height', `${viewport.height}px`);
    };
    const showNotice = (message) => {
      notice.textContent = message;
      notice.hidden = !message;
    };
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
      showNotice('');
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
        const day = careDay(record);
        const time = day === record.date ? record.time : '次日 ' + record.time;
        return [(cnDate(day) + '周期'), time, title, careDetail(record)].filter(Boolean).join(' · ');
      });
      message(`已记录 ${lines.length} 条\n${lines.join('\n')}`);
      mic.textContent = '🎙️ 再记一条';
      onSaved(lastSaved);
    };
    const listener = careListener(Recognition, {
      onState: (state) => {
        const idle = state === 'idle';
        mic.hidden = !idle;
        stop.hidden = idle || state === 'starting';
        stop.disabled = state === 'finishing';
        abort.hidden = idle;
        status.textContent = { idle: '说完自动记录', starting: '正在打开麦克风…', listening: '正在听写…', finishing: '正在转换成文字…' }[state];
        listenBar.classList.toggle('listening', !idle);
      },
      onText: (text) => { draft.textContent = text; draft.hidden = !text; },
      onFinal: (text) => {
        draft.hidden = true;
        receive(text);
      },
      onError: (error) => {
        draft.hidden = true;
        mic.textContent = '🎙️ 重试听写';
        // A fresh tap is needed to bring up the system keyboard on iPhone after an async error.
        openInput('dictation', { focus: false, reason: LISTEN_ERRORS.get(error) || '网页听写启动失败' });
      },
    });
    const start = () => {
      clearTimeout(dictationTimer);
      composing = false;
      inputMode = '';
      input.blur();
      form.hidden = true;
      listenBar.hidden = false;
      keyboard.textContent = '键盘听写';
      webMic.hidden = true;
      type.hidden = false;
      listener.start();
    };
    const openInput = (mode, { focus = true, reason = '' } = {}) => {
      listener.cancel();
      clearTimeout(dictationTimer);
      composing = false;
      inputMode = mode;
      draft.hidden = true;
      listenBar.hidden = true;
      form.hidden = false;
      const dictating = mode === 'dictation';
      send.textContent = dictating ? '处理文字' : '发送';
      label.textContent = dictating ? '点键盘上的 🎤 说话，文字出现后会自动处理。' : '输入要记录的内容';
      keyboard.textContent = dictating ? '打开系统键盘' : '键盘听写';
      webMic.hidden = !Recognition;
      type.hidden = !dictating;
      showNotice(reason);
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
    input.onchange = awaitDictation;
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!inputMode) return;
      composing = false;
      if (input.value.trim()) receive(input.value);
      else {
        showNotice(inputMode === 'dictation' ? '还没有文字。请点系统键盘上的 🎤，或直接打字。' : '请先输入要记录的内容。');
        input.focus();
      }
    };
    mic.onclick = start;
    webMic.onclick = start;
    stop.onclick = listener.stop;
    abort.onclick = () => { listener.cancel(); draft.hidden = true; };
    keyboard.onclick = () => {
      if (inputMode === 'dictation') input.focus();
      else openInput('dictation');
    };
    type.onclick = () => openInput('typing');
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
    if (viewport) {
      fitKeyboard();
      viewport.addEventListener('resize', fitKeyboard);
      viewport.addEventListener('scroll', fitKeyboard);
    }
    const observer = new MutationObserver(() => {
      if (thread.isConnected) return;
      listener.cancel();
      clearTimeout(dictationTimer);
      document.removeEventListener('visibilitychange', cancelInBackground);
      if (viewport) {
        viewport.removeEventListener('resize', fitKeyboard);
        viewport.removeEventListener('scroll', fitKeyboard);
        sheet.style.removeProperty('--care-keyboard-inset');
        sheet.style.removeProperty('--care-viewport-height');
      }
      observer.disconnect();
    });
    observer.observe(sheet, { childList: true });
    if (preferSystemKeyboard || !Recognition) openInput('dictation');
    else start();
  });
}
