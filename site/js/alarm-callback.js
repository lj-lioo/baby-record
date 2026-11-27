import { b64u, syncRequest } from './sync-core.js';

const DEVICE = 'babyrecord.alarmCallbackDevice';
const ATTEMPT = 'babyrecord.alarmCallbackAttempt';
const READY = 'babyrecord.alarmCallbackReady';
const LAST = 'babyrecord.alarmCallbackLastStart';
const RECEIPT = 'alarm-callback';
const TTL = 10 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const SUCCESS_TEXT = 'BABY_ALARM_OK';
const REPLACED_TEXT = 'BABY_ALARM_REPLACED';
const base = () => window.BABY_CONFIG?.syncApi || '';

function currentAttempt() {
  try {
    const attempt = JSON.parse(localStorage.getItem(ATTEMPT));
    if (attempt && Date.now() - attempt.at < TTL) return attempt;
  } catch { /* the normal confirmation flow stays available */ }
  return null;
}

function outputCheck(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(READY));
    if (saved?.name === name) return saved.safeOutput;
  } catch { /* unavailable */ }
  return null;
}

export function alarmCallbackReady(name) {
  return !!base() && outputCheck(name) === true;
}

export function alarmCallbackStatus(name) {
  if (currentAttempt()?.test) return '等待测试回执';
  if (outputCheck(name) === false) return '已收到回执，需按帮助调整快捷指令输出';
  return alarmCallbackReady(name) ? '回传已验证，可自动标记成功' : '自动回传尚未验证';
}

export function startAlarmCallback({ name, id, sig, batch }) {
  if (!base()) return null;
  try {
    // One isolated receipt slot per device, with no family key or event data sent to it.
    let token = localStorage.getItem(DEVICE);
    if (!TOKEN.test(token || '')) {
      token = b64u(crypto.getRandomValues(new Uint8Array(32)));
      localStorage.setItem(DEVICE, token);
    }
    const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const previous = Number(localStorage.getItem(LAST));
    const at = Math.max(Date.now(), (Number.isSafeInteger(previous) ? previous : 0) + 1);
    const test = !id && !batch;
    const url = new URL('alarm-callback.html', location.href);
    url.hash = new URLSearchParams({ token, nonce, at, test: test ? '1' : '0' }).toString();
    if (batch) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      fragment.set('batch', '1');
      url.hash = fragment.toString();
    }
    localStorage.setItem(LAST, String(at));
    localStorage.setItem(ATTEMPT, JSON.stringify({ nonce, at, name, id, sig, test, batch }));
    return { url: url.href, nonce };
  } catch { return null; }
}

export async function deliverAlarmCallback(url) {
  const [fragment, suffix] = url.hash.slice(1).split('?', 2);
  const input = new URLSearchParams(fragment);
  const token = input.get('token'), nonce = input.get('nonce'), at = Number(input.get('at'));
  if (!TOKEN.test(token || '') || !NONCE.test(nonce || '') || !Number.isSafeInteger(at)
    || at < Date.now() - TTL || at > Date.now() + 60000 || !base()) throw new Error('回执链接已过期或无效');
  const output = url.searchParams.get('result') ?? input.get('result') ?? new URLSearchParams(suffix).get('result') ?? '';
  const batch = input.get('batch') === '1';
  const safeOutput = batch
    ? output.trim() === REPLACED_TEXT
    : output === '' || output.trim() === SUCCESS_TEXT;
  const data = JSON.stringify(batch ? { nonce, safeOutput, batch } : { nonce, safeOutput });
  const res = await syncRequest(base(), token, {
    since: 0, changes: [{ id: RECEIPT, updatedAt: at, deleted: false, data }],
  });
  if (!res.accepted?.includes(RECEIPT)
    && !res.changes?.some((row) => row.id === RECEIPT && row.updatedAt === at && row.data === data)) {
    throw new Error('此回执已被较新的测试替代');
  }
  return { test: input.get('test') === '1' };
}

export function listenForAlarmCallbacks(onResult) {
  let checking = false;
  let timer;
  let intervalCount = 0;
  async function check() {
    clearTimeout(timer);
    const attempt = currentAttempt();
    if (!attempt || checking || document.hidden || !base()) return;
    checking = true;
    try {
      const token = localStorage.getItem(DEVICE);
      if (!TOKEN.test(token || '')) return;
      const result = await syncRequest(base(), token, { since: 0, changes: [] });
      const row = result.changes?.find((item) => item.id === RECEIPT && item.updatedAt === attempt.at);
      const receipt = row?.data && JSON.parse(row.data);
      if (receipt?.nonce === attempt.nonce && currentAttempt()?.nonce === attempt.nonce) {
        const safeOutput = receipt.safeOutput === true && !!receipt.batch === !!attempt.batch;
        if (!attempt.batch && (attempt.test || !safeOutput)) localStorage.setItem(READY, JSON.stringify({ name: attempt.name, safeOutput }));
        localStorage.removeItem(ATTEMPT);
        onResult(attempt, safeOutput);
        return;
      }
    } catch { /* keep the attempt for the next foreground check */ }
    finally { checking = false; }
    if (intervalCount++ < 12) timer = setTimeout(check, 1500);
  }
  const resume = () => { intervalCount = 0; check(); };
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  resume();
}
