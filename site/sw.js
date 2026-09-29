// Service Worker：离线缓存 + Web Push + 通知点击 + 生成 .ics（真实 URL，text/calendar）
const VERSION = 'v1.1.0';
const CACHE = `baby-record-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.json', './config.js', './css/app.css',
  './js/app.js', './js/store.js', './js/dates.js', './js/categories.js', './js/reminders.js', './js/ics.js',
  './js/push.js', './js/shortcuts.js', './js/ui.js', './js/sound.js',
  './js/views/home.js', './js/views/editor.js', './js/views/actions.js', './js/views/alarm.js', './js/views/settings.js', './js/views/help.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function b64urlDecodeUtf8(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // /ics/xxx.ics?d=<base64url>：返回 text/calendar，iOS Safari 会弹出“添加到日历”
  if (url.pathname.includes('/ics/') && url.pathname.endsWith('.ics') && url.searchParams.get('d')) {
    try {
      const body = b64urlDecodeUtf8(url.searchParams.get('d'));
      const name = url.pathname.split('/').pop();
      e.respondWith(new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'no-store' } }));
    } catch (err) { /* 交给网络 */ }
    return;
  }
  // config.js 优先网络（推送服务地址可能更新），其余缓存优先
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  })));
});

// ===== Web Push =====
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '宝宝提醒', body: e.data ? e.data.text() : '' }; }
  const title = d.title || '宝宝提醒';
  const opts = {
    body: d.body || '',
    tag: d.id || undefined,
    renotify: true,
    requireInteraction: true,
    icon: './icons/icon-192.png',
    badge: './icons/badge-72.png',
    data: { url: d.url || './', rid: d.id, eventId: d.eventId },
    timestamp: d.fireAt || Date.now(),
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    // App 正在前台时，同时弹出全屏提醒页
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) c.postMessage({ type: 'alarm', rid: d.id, eventId: d.eventId });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.focus(); } catch (err) { /* ignore */ }
        c.postMessage({ type: 'open-url', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
