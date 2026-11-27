// v1.8.0 相册页：按拍摄/上传时间分组的时间轴（v1.9.1 上传可选；v1.12.14 第X天；v1.12.15 第X天次要字号、去掉 N 项）
import { store } from '../store.js';
import { esc, toast, openSheet, closeSheet } from '../ui.js';
import {
  photosByDay, fmtDayTitle, dayNumberOnDate, addPhotoFromFile,
  retryUpload, photoApiBase, pingPhotoServer, isUploadPending, addVideoFromFile,
  getUploadSession, onUploadSession, beginUploadBatch, setUploadBatchText, endUploadBatch,
  retryAllPendingUploads, BATCH_SOFT_LIMIT, photoThumb,
} from '../photos.js';
import { openAlbumViewer } from './album-viewer.js';
import { syncStatus } from '../sync.js';

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function fmtDur(sec) {
  sec = Math.round(Number(sec) || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
// 保存到系统相册只保存缩略图，视频也只保存封面。
export function originalFileName(meta) {
  const d = new Date(meta.takenAt || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  // 一律存缩略图 JPG（视频也只存封面）
  return `朝朝_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${String(meta.id).slice(-4)}.jpg`;
}
/** dataURL / blobURL → Blob（缩略图） */
async function thumbToBlob(meta) {
  const src = await photoThumb(meta);
  if (!src) throw new Error('没有缩略图可保存');
  if (String(src).startsWith('data:')) {
    const r = await fetch(src);
    return await r.blob();
  }
  // 少数情况可能是 http(s) 或 blob:
  const r = await fetch(src);
  const b = await r.blob();
  return b.type ? b : new Blob([b], { type: 'image/jpeg' });
}
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
export function friendlyDlError(e) {
  const m = String(e?.message || e || '');
  if (/mixed_content|HTTPS→HTTP|HTTPS 的 App 不能连接局域网/i.test(m)) return m;
  if (/failed to fetch|load failed|networkerror|network error|fetch/i.test(m) && !/照片服务/.test(m)) {
    if (typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(String(photoApiBase() || ''))) {
      return '连不上极空间照片服务：HTTPS 的 App 不能访问局域网 http，请改用 https:// 照片地址（域名 + Tunnel）';
    }
    return '连不上极空间照片服务：请连家里 Wi‑Fi 或打开 VPN 后重试';
  }
  return m || '下载失败，请稍后重试';
}
function triggerAnchor(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** 把缩略图 Blob 交给系统保存；返回：share|download|open|cancel */
export async function saveBlobToDevice(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (isIOS() && navigator.canShare && navigator.share) {
    let can = false; try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try {
        await navigator.share({ files: [file] });
        return 'share'; // 用户在分享面板完成操作（含「存储图像/视频」）后 resolve
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        throw new Error(e?.message || '分享保存失败，请重试');
      }
    }
    // iOS 不支持分享文件：新标签打开，长按/分享按钮保存
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) triggerAnchor(blob, name);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return 'open';
  }
  triggerAnchor(blob, name);
  return 'download';
}
/** 保存缩略图到系统相册（不再拉原片）；getBlob 保留兼容调用方，已不用 */
function wireDownload(sh, meta, _getBlob) {
  const btn = sh.querySelector('#avDl');
  const st = sh.querySelector('#avDlState');
  if (!btn) return;
  const label = '📥 保存到相册';
  btn.textContent = label;
  let ready = null; // iPhone：缩略图就绪后需再点一次（分享面板必须由用户手势直接触发）
  const say = (t, bad) => { st.hidden = !t; st.textContent = t || ''; st.className = `small ${bad ? 'bad' : 'muted'}`; };
  btn.onclick = async () => {
    const name = originalFileName(meta);
    if (ready) {
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const how = await saveBlobToDevice(ready, name);
        btn.disabled = false; btn.textContent = label;
        if (how === 'share') {
          say('保存成功 · 已保存缩略图到系统相册（或你在分享面板里选的位置）');
          toast('已保存到相册', 2500);
        } else if (how === 'open') {
          say('已在新页面打开缩略图：点分享或长按，选「存储到照片」');
          toast('请在新页面里长按保存', 3500);
        } else if (how === 'cancel') {
          say('已取消，可再点一次保存');
          toast('已取消保存', 2000);
        } else if (how === 'download') {
          say(`保存成功 · 已保存缩略图 ${name}`);
          toast('已保存到相册', 2500);
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = label;
        const msg = friendlyDlError(e);
        say(`保存失败：${msg}`, true);
        toast(`保存失败：${msg}`, 4500);
      }
      return;
    }
    btn.disabled = true; btn.textContent = '保存中…'; say('保存中…');
    try {
      let blob = await thumbToBlob(meta);
      if (!blob.type || !String(blob.type).startsWith('image/')) blob = new Blob([blob], { type: 'image/jpeg' });
      btn.disabled = false;
      if (isIOS()) {
        ready = blob;
        btn.textContent = label;
        say(`缩略图已就绪（${fmtSize(blob.size)}），再点一次，在分享面板选「存储图像」`);
      } else {
        try {
          await saveBlobToDevice(blob, name);
          btn.textContent = label;
          say(`保存成功 · 已保存缩略图 ${name}（${fmtSize(blob.size)}）`);
          toast('已保存到相册', 2500);
        } catch (e2) {
          btn.textContent = label;
          const msg = friendlyDlError(e2);
          say(`保存失败：${msg}`, true);
          toast(`保存失败：${msg}`, 4500);
        }
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      const msg = friendlyDlError(e);
      say(msg, true);
      toast(`保存失败：${msg}`, 4500);
    }
  };
}

export function renderAlbum(root) {
  if (root.querySelector('#albumList')) { updateAlbum(root); return; }
  const api = photoApiBase();
  const syncOn = !!syncStatus().enabled;
  root.innerHTML = `
    <header class="topbar">
      <h1>相册</h1>
      <button class="btn" id="btnAddPhoto" style="padding:8px 14px">＋ 上传</button>
    </header>
    ${!api ? `<div class="banner album-tip"><div class="bt"><b>还没填照片服务地址</b>缩略图和说明可以先同步；填极空间照片服务地址后，全家才能看到原图。家里 Wi‑Fi 填局域网地址即可。</div>
      <button class="btn secondary" id="btnGoPhotoSet" style="flex:none">去设置</button></div>` : ''}
    ${api && !syncOn ? `<div class="banner album-tip"><div class="bt"><b>建议开启云同步</b>原图和视频存照片服务；开启云同步可把相册共享给家人。</div></div>` : ''}
    <div class="banner album-progress" id="albumProgress" hidden>
      <div class="bt" id="albumProgressText">上传中…</div>
      <button type="button" class="btn secondary" id="btnRetryPending" hidden style="flex:none">一键补传</button>
    </div>
    <div id="albumList"></div>
    <p class="small muted" id="albumCount" style="text-align:center;margin:8px 0 24px"></p>
  `;

  const q = (s) => root.querySelector(s);
  q('#btnGoPhotoSet') && (q('#btnGoPhotoSet').onclick = () => { location.hash = '#/settings'; });
  q('#btnAddPhoto').onclick = () => openAddPhotoSheet(root);
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    try { e.target.value = ''; } catch { /* ignore */ }
    if (!files.length) { toast('没有选到照片'); return; }
    const total = files.length;
    toast(total === 1 ? '正在加入相册…' : `正在生成 ${total} 张缩略图并写入相册…`, 2800);
    if (total > BATCH_SOFT_LIMIT) {
      toast(`一次选了 ${total} 张，建议每次 ${BATCH_SOFT_LIMIT} 张左右分批传（原图会排队上传）。本次仍继续，请保持屏幕常亮。`, 5500);
    }
    let localOk = 0, fail = 0, uploadFail = 0;
    const lastErr = [];
    const pendingUpload = []; // { id, isVid, size }
    const setProg = (t) => {
      setUploadBatchText(t);
      syncAlbumProgressUi(albumRootRef || root);
    };
    const refresh = () => {
      if (location.hash.startsWith('#/album')) updateAlbum(albumRootRef || root);
    };
    beginUploadBatch(total, `正在加入相册 0/${total}…`);
    syncAlbumProgressUi(albumRootRef || root);
    const wake = await requestAlbumWakeLock();
    try {
      // 阶段 1：尽快全部生成缩略图并入库（可小并发），用户几乎立刻看到整批
      const LOCAL_CONCURRENCY = 8; // 缩略图优先齐：本地并发高一点；原图仍串行
      let cursor = 0;
      const runLocalOne = async (f) => {
        const isVid = String(f.type || '').startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(f.name || '');
        const r = isVid
          ? await addVideoFromFile(f, { upload: false, onLocalReady: () => refresh() })
          : await addPhotoFromFile(f, { upload: false, onLocalReady: () => refresh() });
        localOk++;
        setProg(`已进相册 ${localOk}/${total}` + (r.deferred ? '，接着传原图…' : ''));
        if (r.needsPhotoApi) lastErr.push('已保存到本机；填照片服务地址后全家才能看原图');
        if (r.deferred && r.photo?.id) pendingUpload.push({ id: r.photo.id, isVid, size: f.size || r.photo.size || 0 });
        refresh();
      };
      const workers = Array.from({ length: Math.min(LOCAL_CONCURRENCY, total) }, async () => {
        while (cursor < files.length) {
          const i = cursor++;
          try {
            await runLocalOne(files[i]);
          } catch (err) {
            fail++;
            lastErr.push(err.message || '处理失败');
            refresh();
          }
        }
      });
      await Promise.all(workers);

      // 阶段 2：原图串行上传（隧道限速）
      const upTotal = pendingUpload.length;
      if (upTotal) {
        setProg(`已进相册 ${localOk}/${total}，原图上传中 0/${upTotal}…`);
        for (const [ui, item] of pendingUpload.entries()) {
          const n = ui + 1;
          try {
            await retryUpload(item.id, {
              onProgress: (ev) => {
                if (ev?.phase === 'upload') {
                  const pct = ev.ratio != null ? ` ${Math.round(ev.ratio * 100)}%` : '';
                  setProg(`已进相册 ${localOk}/${total}，原图上传中 ${n}/${upTotal}${pct}`
                    + (item.isVid ? `（约 ${fmtSize(item.size)}）` : ''));
                }
              },
            });
            setProg(`已进相册 ${localOk}/${total}，原图上传中 ${n}/${upTotal}`);
            refresh();
          } catch (err) {
            uploadFail++;
            lastErr.push(err.message || '原图上传失败');
            refresh();
          }
        }
      }
    } finally {
      endUploadBatch();
      releaseAlbumWakeLock(wake);
      syncAlbumProgressUi(albumRootRef || root);
    }
    if (fail && !localOk) toast(lastErr[0] || '添加失败', 4500);
    else if (uploadFail) toast(`已进相册 ${localOk} 项，其中 ${uploadFail} 项原图上传失败：${lastErr[lastErr.length - 1]}。可点「一键补传」`, 5500);
    else if (localOk && lastErr.length && !uploadFail) toast(lastErr[0], 4000);
    else if (localOk && !fail && !uploadFail) {
      toast(upTotalMsg(localOk, pendingUpload.length));
    }
  };
  function upTotalMsg(localOk, uploaded) {
    if (!uploaded) return localOk === 1 ? '已添加 1 项' : `已添加 ${localOk} 项`;
    return localOk === 1 ? '已添加并上传 1 项' : `已进相册 ${localOk} 项，原图已传完`;
  }
  // v1.13.2：file input 放在 body 上常驻。iOS 从相册返回会触发 visibilitychange/同步重渲染，
  // 之前 input 在相册 DOM 里会被替换掉，change 事件丢失 → 选完照片什么都不出现
  ensureFileInputs();
  albumRootRef = root; onFilesRef = onFiles;
  root.querySelector('#albumList').onclick = (e) => { const cell = e.target.closest('.album-cell'); if (cell) openViewer(cell.dataset.id, root); };
  updateAlbum(root);
  // 切页回来：进度条/角标跟 uploadSession + remoteReady 对齐
  syncAlbumProgressUi(root);
  wireRetryPending(root);
  if (uploadUnsub) { try { uploadUnsub(); } catch { /* ignore */ } }
  uploadUnsub = onUploadSession(() => {
    if (!location.hash.startsWith('#/album')) return;
    const r = albumRootRef;
    if (!r) return;
    // 只更新进度条，避免整页重绘打断滚动；角标在下次 render / 单项刷新时对齐
    syncAlbumProgressUi(r);
    updateAlbum(r);
  });
}

/** 「＋ 上传」：选从相册（可多选）或拍照（带 capture，走相机） */
function openAddPhotoSheet(albumRoot) {
  ensureFileInputs();
  openSheet(`
    <h3>添加照片 / 视频</h3>
    <p class="small muted" style="margin-top:0">从手机相册选照片或视频，或直接拍照、录视频。视频上限 ${Math.round((Number(store.state.settings.videoMaxMB) || 200))}MB，可在设置里改。大批量建议每次约 ${BATCH_SOFT_LIMIT} 张，原图会分块串行上传，请保持屏幕常亮。</p>
    <div class="btn-row" style="flex-direction:column;gap:10px">
      <button type="button" class="btn" id="pickAlbum">🖼 从相册选择</button>
      <button type="button" class="btn secondary" id="pickCamera">📷 拍照</button>
      <button type="button" class="btn secondary" id="pickVideo">🎬 录视频</button>
      <button type="button" class="btn ghost" id="pickCancel">取消</button>
    </div>
  `, (sh) => {
    sh.querySelector('#pickCancel').onclick = closeSheet;
    // 必须在用户手势里同步触发 input.click；先关面板再延时点，iOS 会丢 change → 选完勾选没反应
    sh.querySelector('#pickAlbum').onclick = () => {
      document.getElementById('filePhotoAlbum')?.click();
      closeSheet();
    };
    sh.querySelector('#pickVideo').onclick = () => {
      document.getElementById('fileVideoCamera')?.click();
      closeSheet();
    };
    sh.querySelector('#pickCamera').onclick = () => {
      document.getElementById('filePhotoCamera')?.click();
      closeSheet();
    };
  });
}

function openViewer(id, root) {
  openAlbumViewer(id, root, { wireDownload, thumbToBlob, originalFileName, saveBlobToDevice, friendlyDlError });
}

// 以月份、日期、照片 ID 复用节点；折叠月份只建立拼图，不建立全部格子。
function place(parent, nodes) {
  const keep = new Set(nodes);
  for (const n of [...parent.children]) if (!keep.has(n)) n.remove();
  nodes.forEach((n, i) => { if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] || null); });
}
function setThumb(img, p) {
  const key = p.thumbData || `${p.id}:${p.thumbRemote}`;
  if (img._thumbKey === key) return;
  img._thumbKey = key;
  if (p.thumbData) img.src = p.thumbData;
  else photoThumb(p).then((src) => { if (src && img._thumbKey === key) img.src = src; }).catch(() => {});
}
function dayNode(g, old) {
  const section = old || document.createElement('section');
  section.className = 'card album-day'; section.dataset.day = g.day;
  if (!old) section.innerHTML = '<h2 class="album-day-title"></h2><div class="album-grid"></div>';
  const age = dayNumberOnDate(store.state.settings.babyBirthday, g.day);
  const title = `${esc(fmtDayTitle(g.day))}${age != null ? `<span class="muted small album-day-age" style="font-weight:600;margin-left:8px">第${age}天</span>` : ''}`;
  const h = section.querySelector('h2'); if (h.innerHTML !== title) h.innerHTML = title;
  const grid = section.querySelector('.album-grid');
  const cells = new Map([...grid.children].map((c) => [c.dataset.id, c]));
  place(grid, g.items.map((p) => {
    let cell = cells.get(p.id);
    if (!cell) {
      cell = document.createElement('button'); cell.type = 'button'; cell.className = 'album-cell'; cell.dataset.id = p.id;
      cell.innerHTML = '<img alt="" loading="lazy"><span class="album-overlays"></span>';
    }
    cell.setAttribute('aria-label', p.kind === 'video' ? '查看视频' : '查看照片');
    setThumb(cell.querySelector('img'), p);
    const up = !p.remoteReady && isUploadPending(p.id);
    const overlays = `${p.kind === 'video' ? `<span class="album-play">▶ ${esc(fmtDur(p.duration))}</span>` : ''}${!p.remoteReady ? `<span class="album-badge ${up ? 'uploading' : ''}">${up ? '上传中' : '本地'}</span>` : ''}${p.note ? `<span class="album-note-dot" title="${esc(p.note)}">📝</span>` : ''}`;
    const ov = cell.querySelector('.album-overlays'); if (ov.innerHTML !== overlays) ov.innerHTML = overlays;
    return cell;
  }));
  return section;
}
export function updateAlbum(root) {
  const list = root.querySelector('#albumList'); if (!list) return;
  const groups = photosByDay();
  const now = new Date(); const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = new Map();
  for (const g of groups) { const m = g.day.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(g); }
  const oldMonths = new Map([...list.children].map((n) => [n.dataset.month, n]));
  const nodes = [];
  for (const [month, days] of months) {
    const collapsed = month < current;
    let node = oldMonths.get(month);
    if (!node || (node.tagName === 'DETAILS') !== collapsed) {
      node = document.createElement(collapsed ? 'details' : 'div'); node.dataset.month = month;
      if (collapsed) {
        node.className = 'card album-month';
        node.innerHTML = '<summary><b></b><span class="album-collage"></span><span class="small muted album-month-count"></span></summary><div class="album-month-days"></div>';
        node.ontoggle = () => { if (node.isConnected) updateAlbum(root); };
      }
    }
    const items = days.flatMap((g) => g.items);
    if (collapsed) {
      node.querySelector('b').textContent = `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
      node.querySelector('.album-month-count').textContent = `${items.length}条记录 · ${node.open ? '收起' : '点开展开'}`;
      const collage = node.querySelector('.album-collage');
      const imgs = new Map([...collage.children].map((img) => [img.dataset.id, img]));
      place(collage, items.slice(0, 4).map((p) => { const img = imgs.get(p.id) || document.createElement('img'); img.alt = ''; img.dataset.id = p.id; setThumb(img, p); return img; }));
    }
    const container = collapsed ? node.querySelector('.album-month-days') : node;
    if (!collapsed || node.open) {
      const oldDays = new Map([...container.children].map((n) => [n.dataset.day, n]));
      place(container, days.map((g) => dayNode(g, oldDays.get(g.day))));
    } else container.replaceChildren();
    nodes.push(node);
  }
  if (!nodes.length) {
    const empty = list.querySelector('.album-empty') || document.createElement('section');
    empty.className = 'card album-empty';
    empty.innerHTML = '<p style="text-align:center">📷 还没有照片或视频</p><p class="small muted">点右上角「＋ 上传」，可从相册选择、拍照或录视频。</p>';
    nodes.push(empty);
  }
  place(list, nodes);
  root.querySelector('#albumCount').textContent = `共 ${store.photos().length} 项 · 原图/视频存极空间 · 元数据云同步`;
  syncAlbumProgressUi(root);
}

// 设置页可调用：测试照片服务
export { pingPhotoServer, photoApiBase };

let albumRootRef = null, onFilesRef = null, uploadUnsub = null, retryBusy = false;

async function requestAlbumWakeLock() {
  try {
    if (navigator.wakeLock?.request) return await navigator.wakeLock.request('screen');
  } catch { /* 不支持或被拒就忽略 */ }
  return null;
}
function releaseAlbumWakeLock(lock) {
  try { lock?.release?.(); } catch { /* ignore */ }
}

function syncAlbumProgressUi(rootEl) {
  if (!rootEl) return;
  const prog = rootEl.querySelector('#albumProgress');
  const progT = rootEl.querySelector('#albumProgressText');
  const btn = rootEl.querySelector('#btnRetryPending');
  if (!prog || !progT) return;
  const sess = getUploadSession();
  const pendingNotReady = store.photos().filter((p) => !p.remoteReady).length;
  if (sess.active) {
    prog.hidden = false;
    progT.textContent = sess.text || `上传中…（${sess.done}/${sess.total}）`;
    if (btn) btn.hidden = true;
  } else if (sess.pending || pendingNotReady) {
    prog.hidden = false;
    progT.textContent = sess.text || (sess.pending
      ? `还有 ${sess.pending} 项未传到照片服务`
      : `有 ${pendingNotReady} 项仅本机 / 未上传`);
    if (btn) btn.hidden = !photoApiBase();
  } else {
    prog.hidden = true;
    if (btn) btn.hidden = true;
  }
}

function wireRetryPending(rootEl) {
  const btn = rootEl?.querySelector('#btnRetryPending');
  if (!btn) return;
  btn.onclick = async () => {
    if (retryBusy) return;
    retryBusy = true;
    btn.disabled = true;
    btn.textContent = '补传中…';
    const wake = await requestAlbumWakeLock();
    try {
      const r = await retryAllPendingUploads({
        onProgress: () => syncAlbumProgressUi(albumRootRef || rootEl),
      });
      if (location.hash.startsWith('#/album')) renderAlbum(albumRootRef || rootEl);
      if (r.ok && !r.fail) toast(r.ok === 1 ? '已补传 1 项' : `已补传 ${r.ok} 项`);
      else if (r.ok || r.fail) toast(`补传完成：成功 ${r.ok}，失败 ${r.fail}${r.skipped ? `，跳过 ${r.skipped}（无本机缓存）` : ''}`, 5000);
      else toast(r.skipped ? '这些项本机没有原图缓存，需重新选图上传' : '没有需要补传的项', 4000);
    } catch (e) {
      toast(`补传失败：${e.message || e}`, 4500);
    } finally {
      releaseAlbumWakeLock(wake);
      retryBusy = false;
      btn.disabled = false;
      btn.textContent = '一键补传';
      syncAlbumProgressUi(albumRootRef || rootEl);
    }
  };
}

function ensureFileInputs() {
  const defs = [['filePhotoAlbum', 'image/*,video/*', true, false], ['filePhotoCamera', 'image/*', false, 'environment'], ['fileVideoCamera', 'video/*', false, 'environment']];
  for (const [id, accept, multi, cap] of defs) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('input');
    el.type = 'file'; el.id = id; el.accept = accept; el.hidden = true;
    if (multi) el.multiple = true;
    if (cap) el.setAttribute('capture', cap);
    document.body.appendChild(el);
  }
  // 委托一次即可：避免 render 重建/重复绑定，也避免个别 input 监听丢了
  if (!document.body.dataset.albumFileBound) {
    document.body.dataset.albumFileBound = '1';
    document.body.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.id || !/^file(Photo|Video)/.test(t.id)) return;
      if (typeof onFilesRef === 'function') onFilesRef(e);
      else toast('相册页还没就绪，请再选一次');
    });
  }
}
