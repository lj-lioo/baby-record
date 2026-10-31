// Web Push（iOS 16.4+，需先“添加到主屏幕”并允许通知）
import { store } from './store.js';
import { pushPayloads } from './reminders.js';

const DEV_KEY = 'babyrecord.device';
export function deviceId() {
  let id = localStorage.getItem(DEV_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(DEV_KEY, id);
  }
  return id;
}
export function apiBase() {
  const b = (store.state.settings.pushApi || (window.BABY_CONFIG && window.BABY_CONFIG.pushApi) || '').trim();
  return b.includes('__PUSH_API__') ? '' : b.replace(/\/+$/, '');
}
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const appBaseUrl = () => new URL('./', location.href).href;

async function api(path, body) {
  const base = apiBase();
  if (!base) throw new Error('未配置推送服务地址');
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`推送服务返回 ${res.status}`);
  return res.json();
}

function urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushStatus() {
  const s = { supported: pushSupported(), standalone: isStandalone(), ios: isIOS(), permission: 'Notification' in window ? Notification.permission : 'unsupported', subscribed: false, server: null, api: apiBase() };
  try { s.subscribed = !!(await getSubscription()); } catch (e) { /* ignore */ }
  try { s.server = await api('/api/health'); } catch (e) { s.server = null; }
  return s;
}

// 必须在用户点击按钮时调用（iOS 要求用户手势）
export async function enablePush() {
  if (!pushSupported()) {
    if (isIOS() && !isStandalone()) throw new Error('请先把本App“添加到主屏幕”，再从主屏幕图标打开后开启通知。');
    throw new Error('当前浏览器不支持推送通知（iPhone 需 iOS 16.4 及以上，并从主屏幕打开）。');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('没有获得通知权限。请到 iPhone「设置 → 通知 → 宝宝记录」中允许通知。');
  const { publicKey } = await api('/api/vapid-public-key');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
  await api('/api/subscribe', { deviceId: deviceId(), subscription: sub.toJSON(), appUrl: appBaseUrl() });
  await syncReminders(true);
  return true;
}

export async function disablePush() {
  const sub = await getSubscription();
  if (sub) await sub.unsubscribe();
  try { await api('/api/unsubscribe', { deviceId: deviceId() }); } catch (e) { /* ignore */ }
}

let timer = null;
export function syncReminders(immediate = false) {
  clearTimeout(timer);
  return new Promise((resolve) => {
    timer = setTimeout(async () => {
      try {
        const sub = await getSubscription();
        if (!sub || !apiBase()) return resolve(false);
        await api('/api/sync', { deviceId: deviceId(), reminders: pushPayloads(appBaseUrl()) });
        resolve(true);
      } catch (e) { console.warn('同步提醒失败', e); resolve(false); }
    }, immediate ? 0 : 800);
  });
}

// App 每次启动时：若已订阅，重新登记订阅（推送服务地址变化后也能自动恢复）并同步
export async function refreshOnLaunch() {
  try {
    const sub = await getSubscription();
    if (!sub || !apiBase()) return;
    await api('/api/subscribe', { deviceId: deviceId(), subscription: sub.toJSON(), appUrl: appBaseUrl() });
    await syncReminders(true);
  } catch (e) { console.warn(e); }
}

export async function sendTestPush(delaySec = 0) {
  await syncReminders(true);
  return api('/api/test', { deviceId: deviceId(), delaySec, appUrl: appBaseUrl() });
}
