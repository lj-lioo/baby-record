// Service Worker：离线缓存 + Web Push + 通知点击 + 生成 .ics（真实 URL，text/calendar）
// 缓存策略（v1.4.1 起）：
// - 安装时每个文件都用 cache:'reload' 直接从网络取（绕过浏览器 HTTP 缓存，GitHub Pages 是 max-age=600），
//   任何一个失败则安装失败、继续用旧版本，避免新旧文件混在一个缓存里；
// - 页面、JS、CSS、config.js、manifest：网络优先（cache:'no-cache' 让浏览器向服务器确认），断网或 4 秒无响应时用缓存；
// - 图标等其他静态文件：缓存优先。
const VERSION = 'v1.7.1';
const CACHE = `baby-record-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.json', './config.js', './css/app.css', './css/vaxplan.css',
  './js/app.js', './js/store.js', './js/dates.js', './js/categories.js', './js/reminders.js', './js/ics.js',
  './js/push.js', './js/shortcuts.js', './js/ui.js', './js/sound.js', './js/vaccines.js', './js/checkups.js', './js/paidvax.js', './js/windows.js', './js/sync-core.js', './js/sync.js',
  './js/views/home.js', './js/views/editor.js', './js/views/actions.js', './js/views/alarm.js', './js/views/settings.js', './js/views/help.js', './js/views/vaxplan.js', './js/views/planned.js', './js/views/paidcat.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-72.png',
];
const NETWORK_TIMEOUT = 4000;

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
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
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

// 网络优先：成功则更新缓存；失败或超时用缓存（离线可用）
async function networkFirst(request, isNav) {
  const url = new URL(request.url);
  const cacheKey = isNav ? new Request(url.origin + url.pathname) : request;
  const net = fetch(isNav ? url.href : request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (r) => {
    if (r.ok && r.type === 'basic') { const c = await caches.open(CACHE); await c.put(cacheKey, r.clone()); }
    // 页面请求不能用“重定向过的”响应作答（Safari/Chrome 会报错），重新包一层
    if (isNav && r.redirected) return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
    return r;
  });
  const fallback = async () => {
    const hit = await caches.match(cacheKey, { ignoreSearch: true }) || (isNav ? await caches.match('./index.html') : null);
    if (hit) return hit;
    return net;
  };
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), NETWORK_TIMEOUT); });
  try {
    return await Promise.race([net.then((r) => { clearTimeout(timer); return r; }), timeout]);
  } catch (err) {
    clearTimeout(timer);
    return fallback();
  }
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
  if (url.pathname.endsWith('/sw.js')) return;
  const isNav = e.request.mode === 'navigate';
  if (isNav || /\.(?:js|mjs|css|html|json)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(networkFirst(e.request, isNav));
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
