// Service Worker：离线缓存 + Web Push + 通知点击 + 生成 .ics（真实 URL，text/calendar）
// 安装时直接从网络取齐同一版本的页面和静态文件，再启用该版本的缓存。
// 已安装的 App 直接从版本缓存启动，Service Worker 更新独立进行。
const VERSION = 'v1.16.13';
// 发布时写入 site 目录的 Git 树哈希，确保只改静态资源的发布也能触发更新。
const REVISION = '';
const CACHE = 'baby-record-' + VERSION + (REVISION ? '-' + REVISION : '');
const ASSETS = [
  './index.html', './manifest.json', './config.js', './css/app.css', './css/vaxplan.css', './css/care.css',
  './js/app.js', './js/store.js', './js/dates.js', './js/categories.js', './js/reminders.js', './js/ics.js',
  './js/care.js', './js/care-voice.js', './js/views/care.js', './js/views/care-import.js', './js/views/care-voice.js', './js/views/care-listen.js', './js/views/freevax.js',
  './js/push.js', './js/shortcuts.js', './js/alarm-batch.js', './js/ui.js', './js/sound.js', './js/vaccines.js', './js/checkups.js', './js/paidvax.js', './js/windows.js', './js/sync-core.js', './js/sync.js', './js/photos.js', './js/thumbs.js', './js/growth.js', './js/voice.js', './js/roles.js',
  './js/views/home.js', './js/views/editor.js', './js/views/actions.js', './js/views/alarm.js', './js/views/settings.js', './js/views/help.js', './js/views/vaxplan.js', './js/views/planned.js', './js/views/paidcat.js', './js/views/album.js', './js/views/album-viewer.js', './js/views/growth.js', './js/views/voice.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-72.png', './icons/icon-maskable-512.png',
];
const scope = new URL(self.registration.scope);
const assetURLs = new Map(ASSETS.map((asset) => {
  const url = new URL(asset, scope);
  return [url.pathname, url.href];
}));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const fresh = await Promise.all(ASSETS.map(async (u) => {
      const req = new Request(u, { cache: 'reload' });
      const res = await fetch(req);
      if (!res.ok) throw new Error(`${u} → ${res.status}`);
      return [req, res];
    }));
    const c = await caches.open(CACHE);
    await Promise.all(fresh.map(([req, res]) => c.put(req, res)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('baby-record-v') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
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
  const isAppNavigation = e.request.mode === 'navigate' && url.pathname === scope.pathname;
  const cacheKey = isAppNavigation ? new URL('index.html', scope).href : assetURLs.get(url.pathname);
  if (!cacheKey) return;
  e.respondWith(caches.match(cacheKey, { cacheName: CACHE }).then((hit) => hit || fetch(e.request)));
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
