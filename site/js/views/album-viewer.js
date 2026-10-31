import { store } from '../store.js';
import { esc, toast, confirmSheet } from '../ui.js';
import { canDeleteAlbum } from '../roles.js';
import { photosByDay, fmtAlbumDayTitle, photoThumb, viewerSource, removePhoto, retryUpload, photoApiBase } from '../photos.js';

let disposeViewer = null;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isHeic = (p) => /hei[cf]/i.test(`${p.mime} ${p.ext}`);
export function openAlbumViewer(id, albumRoot, helpers) {
  disposeViewer?.(false);
  let items = photosByDay().flatMap((g) => g.items);
  let index = items.findIndex((p) => p.id === id);
  if (index < 0) return;
  const oldFocus = document.activeElement;
  const oldOverflow = document.body.style.overflow;
  const overlay = document.createElement('div');
  overlay.className = 'album-fullscreen'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '相册全屏查看器'); overlay.tabIndex = -1;
  overlay.innerHTML = `<header class="av-header"><button id="avClose" aria-label="关闭">‹</button><h2 id="avTitle"></h2><button id="avMenu" aria-label="更多操作">•••</button></header>
    <div id="avImg" class="av-stage"></div><p id="avTip" class="av-tip" hidden></p>
    <nav class="av-nav"><button id="avPrev" aria-label="上一张">‹</button><span id="avCount"></span><button id="avNext" aria-label="下一张">›</button></nav>
    <div id="avActions" class="av-actions" hidden></div>`;
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden'; overlay.focus();
  const q = (s) => overlay.querySelector(s);
  const box = q('#avImg'); const menu = q('#avActions');
  const cache = new Map(); const originals = new Set();
  let closed = false, revision = 0, scale = 1, px = 0, py = 0, downY = 0, downX = 0, activeImage = null;
  let flight, touchZoomAt = 0;
  let longTimer, lastTap = 0, pinching = false, baseDistance = 0, baseScale = 1, basePX = 0, basePY = 0, moved = false;
  const pointers = new Map();
  const current = () => items[index];
  const sourceCell = () => [...albumRoot.querySelectorAll('.album-cell')].find((c) => c.dataset.id === current()?.id);
  const fitRect = (meta) => {
    const r = box.getBoundingClientRect(); const ratio = (meta.width || 1) / (meta.height || 1);
    const w = Math.min(r.width, r.height * ratio), h = w / ratio;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  };
  function fly(opening) {
    const cell = sourceCell(); const img = box.querySelector('img');
    if (!cell || !img?.src || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const from = opening ? cell.getBoundingClientRect() : fitRect(current());
    const to = opening ? fitRect(current()) : cell.getBoundingClientRect();
    if (!from.width || !to.width || to.top + to.height < 0 || to.top > innerHeight) return Promise.resolve();
    const ghost = document.createElement('img'); ghost.src = img.src; ghost.alt = '';
    Object.assign(ghost.style, { position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, objectFit: 'cover', zIndex: '49', pointerEvents: 'none', transformOrigin: '0 0' });
    document.body.appendChild(ghost);
    box.style.visibility = 'hidden';
    const anim = ghost.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: opening ? '12px' : '0' }, { transform: 'none', borderRadius: opening ? '0' : '12px' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    flight = anim;
    return anim.finished.catch(() => {}).finally(() => { ghost.remove(); if (flight === anim) { flight = null; box.style.visibility = ''; } });
  }
  function release(entry) {
    entry.discarded = true;
    if (entry.source?.temporary) URL.revokeObjectURL(entry.source.url);
    entry.image?.removeAttribute('src');
  }
  function getSource(p) {
    if (cache.has(p.id)) return cache.get(p.id).promise;
    const entry = {};
    entry.promise = viewerSource(p).then((source) => {
      if (closed || entry.discarded) { if (source.temporary) URL.revokeObjectURL(source.url); return null; }
      entry.source = source;
      if (p.kind !== 'video') { entry.image = new Image(); entry.image.src = source.url; }
      return source;
    }).catch((e) => { if (cache.get(p.id) === entry) cache.delete(p.id); throw e; });
    cache.set(p.id, entry); return entry.promise;
  }
  function preload() {
    const keep = new Set(items.slice(Math.max(0, index - 2), index + 3).map((p) => p.id));
    for (const [key, entry] of cache) if (!keep.has(key)) { release(entry); cache.delete(key); }
    for (let i = Math.max(0, index - 2); i <= Math.min(items.length - 1, index + 2); i++) {
      // 相邻视频只预热封面，避免同时播放和下载多段视频。
      if (items[i].kind !== 'video') getSource(items[i]).catch(() => {});
      photoThumb(items[i]).catch(() => {});
    }
  }
  function paint() {
    if (!activeImage) return;
    const r = fitRect(current());
    px = clamp(px, -r.width * (scale - 1) / 2, r.width * (scale - 1) / 2);
    py = clamp(py, -r.height * (scale - 1) / 2, r.height * (scale - 1) / 2);
    activeImage.style.transform = `translate(${px}px, ${py}px) scale(${scale})`;
    box.dataset.scale = String(scale);
  }
  async function original() {
    const p = current(); const rev = revision;
    if (isHeic(p) || p.kind === 'video' || box.dataset.original === p.id) return;
    box.dataset.original = p.id;
    try {
      const src = await viewerSource(p, true);
      if (closed || rev !== revision) { if (src.temporary) URL.revokeObjectURL(src.url); return; }
      if (src.temporary) originals.add(src.url);
      const im = new Image(); im.onload = () => { if (!closed && rev === revision && activeImage) { activeImage.dataset.quality = 'original'; activeImage.dataset.clear = '1'; activeImage.src = src.url; } }; im.src = src.url;
    } catch { box.dataset.original = ''; }
  }
  function zoom() {
    scale = scale > 1 ? 1 : 2.5; px = py = 0; paint(); if (scale > 1) original();
  }
  function actions() {
    const p = current();
    menu.innerHTML = `<button id="avDl" class="btn">📥 保存到相册</button><button id="avShare" class="btn secondary">分享</button>
      ${!p.remoteReady && photoApiBase() ? '<button id="avRetry" class="btn secondary">补传原图/视频</button>' : ''}
      ${canDeleteAlbum() ? '<button id="avDel" class="btn danger">删除</button>' : ''}
      <label for="avNote">说明</label><input id="avNote" class="input" value="${esc(p.note)}"><button id="avSave" class="btn secondary">保存说明</button>
      <p id="avDlState" class="small" hidden></p><button id="avActionsClose" class="btn ghost">收起菜单</button>`;
    helpers.wireDownload(menu, p);
    q('#avActionsClose').onclick = () => { menu.hidden = true; };
    q('#avSave').onclick = () => { const latest = store.getPhoto(p.id); if (latest) store.upsertPhoto({ ...latest, note: q('#avNote').value.trim() }); toast('已保存'); };
    let shareBlob;
    helpers.thumbToBlob(p).then((blob) => { if (!closed) shareBlob = blob; }).catch(() => {});
    q('#avShare').onclick = async () => {
      const btn = q('#avShare');
      if (!shareBlob) { btn.textContent = '准备中…'; try { shareBlob = await helpers.thumbToBlob(p); btn.textContent = '已就绪，点此分享'; } catch (e) { toast(e.message); btn.textContent = '分享'; } return; }
      try {
        const file = new File([shareBlob], helpers.originalFileName(p), { type: 'image/jpeg' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
        else { await helpers.saveBlobToDevice(shareBlob, file.name); toast('已保存缩略图，可从系统相册分享'); }
      } catch (e) { if (e.name !== 'AbortError') toast(helpers.friendlyDlError(e)); }
    };
    const retry = q('#avRetry'); if (retry) retry.onclick = async () => {
      retry.disabled = true; retry.textContent = '补传中…';
      try { await retryUpload(p.id); toast('已补传'); show(index); } catch (e) { toast(e.message); retry.disabled = false; retry.textContent = '重试补传'; }
    };
    const del = q('#avDel'); if (del) del.onclick = async () => {
      if (!canDeleteAlbum()) return;
      const ok = await confirmSheet('确定删除这条记录吗？其他家人同步后也会删掉。', '删除', true);
      document.body.style.overflow = 'hidden';
      if (!ok || closed || !canDeleteAlbum()) return;
      del.disabled = true;
      try { await removePhoto(p.id); toast('已删除'); close(false); } catch (e) { toast(e.message); del.disabled = false; }
    };
  }
  async function show(next, opening = false) {
    if (closed) return;
    flight?.cancel(); flight = null; box.style.visibility = '';
    items = photosByDay().flatMap((g) => g.items);
    index = clamp(next, 0, items.length - 1);
    const p = current(); if (!p) return close(false);
    const rev = ++revision;
    for (const url of originals) URL.revokeObjectURL(url); originals.clear();
    box.querySelector('video')?.pause(); box.replaceChildren();
    scale = 1; px = py = 0; box.style.transform = ''; box.dataset.scale = '1'; box.dataset.original = '';
    overlay.style.backgroundColor = ''; menu.hidden = true;
    const day = photosByDay([p])[0].day;
    q('#avTitle').textContent = fmtAlbumDayTitle(day, store.state.settings.babyBirthday);
    q('#avCount').textContent = `${index + 1} / ${items.length}`;
    q('#avPrev').disabled = index === 0; q('#avNext').disabled = index === items.length - 1;
    q('#avTip').hidden = true;
    const img = new Image(); img.alt = p.kind === 'video' ? '视频封面' : '宝宝照片'; img.draggable = false;
    if (p.thumbData) img.src = p.thumbData;
    box.appendChild(img); activeImage = img;
    photoThumb(p).then((src) => { if (src && !closed && rev === revision && !img.dataset.clear) img.src = src; }).catch(() => {});
    actions(); if (opening) fly(true);
    try {
      const src = await getSource(p);
      if (!src || closed || rev !== revision) return;
      if (p.kind === 'video') {
        const video = document.createElement('video');
        video.controls = true; video.muted = true; video.autoplay = true; video.playsInline = true; video.preload = 'metadata';
        video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.poster = img.src; video.src = src.url;
        video.addEventListener('error', () => { q('#avTip').hidden = false; q('#avTip').textContent = '视频暂时无法播放，请检查照片服务或视频格式'; });
        video.addEventListener('loadeddata', () => { if (!closed && rev === revision) img.hidden = true; });
        box.appendChild(video); activeImage = null;
        const fs = document.createElement('button'); fs.id = 'avFullscreen'; fs.className = 'av-fullscreen-btn'; fs.textContent = '⛶ 横屏 / 全屏';
        fs.onclick = async () => {
          try { if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); else await video.requestFullscreen?.(); await screen.orientation?.lock?.('landscape').catch(() => {}); } catch { toast('可旋转手机横屏观看'); }
        }; box.appendChild(fs);
        video.play().catch(() => {});
      } else {
        const clear = new Image();
        clear.onload = () => { if (!closed && rev === revision) { if (img.dataset.quality === 'original') return; img.dataset.clear = '1'; img.src = src.url; } };
        clear.onerror = () => { if (!closed && rev === revision) { q('#avTip').hidden = false; q('#avTip').textContent = '清晰图暂不可用，保留缩略图'; } };
        clear.src = src.url;
      }
    } catch (e) {
      if (!closed && rev === revision) { q('#avTip').hidden = false; q('#avTip').textContent = e.message || '清晰图暂不可用，保留缩略图'; }
    }
    if (!closed && rev === revision) preload();
  }
  async function close(animated = true) {
    if (closed) return; closed = true; revision++; clearTimeout(longTimer);
    flight?.cancel(); flight = null; box.style.visibility = '';
    box.querySelector('video')?.pause();
    window.removeEventListener('hashchange', onRoute); window.removeEventListener('pagehide', onRoute); document.removeEventListener('keydown', keydown);
    if (disposeViewer === close) disposeViewer = null;
    if (animated) { const flying = fly(false); overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' }); await flying; }
    for (const entry of cache.values()) release(entry); cache.clear();
    for (const url of originals) URL.revokeObjectURL(url); originals.clear();
    overlay.remove(); document.body.style.overflow = oldOverflow;
    if (oldFocus?.isConnected) oldFocus.focus({ preventScroll: true });
  }
  const onRoute = () => close(false);
  function keydown(e) {
    if (e.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else close(); }
    if (e.target.matches('input')) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll('button,input,video')].filter((n) => !n.disabled && n.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === overlay)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }
  q('#avClose').onclick = () => close(); q('#avMenu').onclick = () => { menu.hidden = !menu.hidden; };
  q('#avPrev').onclick = () => show(index - 1); q('#avNext').onclick = () => show(index + 1);
  box.oncontextmenu = (e) => { e.preventDefault(); menu.hidden = false; };
  box.ondblclick = (e) => { if (Date.now() - touchZoomAt < 400) return; if (current().kind !== 'video') { e.preventDefault(); zoom(); } };
  box.onpointerdown = (e) => {
    if (e.target.closest('button')) return;
    if (e.target.tagName === 'VIDEO' && e.clientY > box.getBoundingClientRect().bottom - 70) return;
    box.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(longTimer);
    if (pointers.size === 1) {
      downX = e.clientX; downY = e.clientY; basePX = px; basePY = py; moved = false; pinching = false;
      longTimer = setTimeout(() => { menu.hidden = false; moved = true; }, 550);
    } else if (pointers.size === 2) {
      pinching = true; const [a, b] = [...pointers.values()]; baseDistance = Math.hypot(a.x - b.x, a.y - b.y); baseScale = scale;
    }
  };
  box.onpointermove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (Math.abs(dx) + Math.abs(dy) > 8) { clearTimeout(longTimer); moved = true; }
    if (pointers.size === 2 && current().kind !== 'video') {
      const [a, b] = [...pointers.values()]; scale = clamp(baseScale * Math.hypot(a.x - b.x, a.y - b.y) / (baseDistance || 1), 1, 5); paint(); if (scale > 1.2) original();
    } else if (pinching) return;
    else if (scale > 1) { px = basePX + dx; py = basePY + dy; paint(); }
    else if (dy > 0 && dy > Math.abs(dx)) {
      const shrink = clamp(1 - dy / innerHeight, .5, 1);
      box.style.transform = `translate(${dx}px, ${dy}px) scale(${shrink})`;
      overlay.style.backgroundColor = `rgba(0,0,0,${clamp(1 - dy / 350, .1, 1)})`;
    } else box.style.transform = `translateX(${dx}px)`;
  };
  function endPointer(e, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    clearTimeout(longTimer); pointers.delete(e.pointerId);
    if (pointers.size) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (!cancelled && !pinching && scale === 1 && menu.hidden) {
      if (dy > 110 && dy > Math.abs(dx)) { close(); return; }
      if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
      else if (!moved && e.pointerType === 'touch') { const now = Date.now(); if (now - lastTap < 300 && current().kind !== 'video') { touchZoomAt = now; zoom(); lastTap = 0; } else lastTap = now; }
    }
    box.style.transform = ''; overlay.style.backgroundColor = ''; pinching = false;
  }
  box.onpointerup = (e) => endPointer(e); box.onpointercancel = (e) => endPointer(e, true);
  window.addEventListener('hashchange', onRoute); window.addEventListener('pagehide', onRoute); document.addEventListener('keydown', keydown);
  disposeViewer = close; show(index, true);
}
