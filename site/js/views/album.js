// v1.8.0 相册页：按拍摄/上传时间分组的时间轴（v1.9.1 上传可选；v1.12.14 第X天；v1.12.15 第X天次要字号、去掉 N 项）
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import { canDeleteAlbum } from '../roles.js';
import {
  photosByDay, fmtDayTitle, dayNumberOnDate, addPhotoFromFile, loadPhotoBlob, removePhoto,
  retryUpload, photoApiBase, pingPhotoServer, isUploading,
  addVideoFromFile, loadVideoBlob, hasLocalVideo,
} from '../photos.js';
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
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// v1.12.6 下载原片：取回极空间密文 → 解密 → iPhone 走分享面板「存储图像/视频」，安卓/鸿蒙走 <a download>
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
export function originalFileName(meta) {
  const d = new Date(meta.takenAt || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  const ext = EXT[String(meta.mime || '').toLowerCase()] || (meta.kind === 'video' ? 'mp4' : 'jpg');
  return `朝朝_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${String(meta.id).slice(-4)}.${ext}`;
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
/** 把已解密的原件交给系统保存；返回采用的方式 */
export async function saveBlobToDevice(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (isIOS() && navigator.canShare && navigator.share) {
    let can = false; try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try { await navigator.share({ files: [file] }); return 'share'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
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
function wireDownload(sh, meta, getBlob) {
  const btn = sh.querySelector('#avDl');
  const st = sh.querySelector('#avDlState');
  if (!btn) return;
  const label = meta.kind === 'video' ? '⬇ 下载原视频' : '⬇ 下载原图';
  let confirmed = false;
  let ready = null; // iPhone：取回后需再点一次（分享面板必须由点击直接触发）
  const say = (t, bad) => { st.hidden = !t; st.textContent = t || ''; st.className = `small ${bad ? 'bad' : 'muted'}`; };
  btn.onclick = async () => {
    const name = originalFileName(meta);
    if (ready) {
      const how = await saveBlobToDevice(ready, name);
      if (how === 'share') say('已打开分享面板：选「存储图像 / 存储视频」即可存到相册');
      else if (how === 'open') say('已在新页面打开原件：点分享按钮或长按保存');
      else if (how === 'cancel') say('已取消，可再点一次保存');
      return;
    }
    if (meta.kind === 'video') {
      const local = await hasLocalVideo(meta.id);
      if (!local && !confirmed) {
        confirmed = true;
        btn.textContent = `确认下载（约 ${fmtSize(meta.size)}）`;
        say(`原视频约 ${fmtSize(meta.size)}，将从极空间下载；用手机流量时请注意流量消耗。确认后再点一次按钮。`);
        return;
      }
    }
    btn.disabled = true; btn.textContent = '准备中…'; say('正在从极空间取回并解密原件…');
    try {
      let blob;
      if (meta.kind === 'video') {
        ({ blob } = await loadVideoBlob(meta.id, { onProgress: (x) => { btn.textContent = `下载中 ${Math.round(x * 100)}%`; } }));
      } else {
        const r = await getBlob();
        if (r.source === 'thumb') throw new Error('还取不到原图（只有缩略图）：请在设置里配置照片服务，并连家里 Wi‑Fi 或开 VPN');
        blob = r.blob;
      }
      if (meta.mime && !blob.type) blob = new Blob([blob], { type: meta.mime });
      btn.disabled = false;
      if (isIOS()) {
        ready = blob;
        btn.textContent = meta.kind === 'video' ? '📥 保存到手机相册' : '📥 保存到手机相册';
        say(`原件已就绪（${fmtSize(blob.size)}），再点一次按钮，在分享面板选「存储${meta.kind === 'video' ? '视频' : '图像'}」`);
      } else {
        await saveBlobToDevice(blob, name);
        btn.textContent = label;
        say(`已下载 ${name}（${fmtSize(blob.size)}），可在「文件 / 下载」里找到`);
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      say(friendlyDlError(e), true);
    }
  };
}

export function renderAlbum(root) {
  const groups = photosByDay();
  const api = photoApiBase();
  const syncOn = !!syncStatus().enabled;
  root.innerHTML = `
    <header class="topbar">
      <h1>相册</h1>
      <button class="btn" id="btnAddPhoto" style="padding:8px 14px">＋ 上传</button>
    </header>
    ${!api ? `<div class="banner album-tip"><div class="bt"><b>还没填照片服务地址</b>缩略图和说明可以先同步；填极空间照片服务地址后，全家才能看到原图。家里 Wi‑Fi 填局域网地址即可。</div>
      <button class="btn secondary" id="btnGoPhotoSet" style="flex:none">去设置</button></div>` : ''}
    ${api && !syncOn ? `<div class="banner album-tip"><div class="bt"><b>建议开启云同步</b>原图用同步密钥加密后上传；元数据也靠云同步共享给家人。</div></div>` : ''}
    <div class="banner album-progress" id="albumProgress" hidden><div class="bt" id="albumProgressText">上传中…</div></div>
    ${groups.length === 0 ? `
      <section class="card album-empty">
        <div style="font-size:48px;text-align:center">📷</div>
        <p style="text-align:center;margin:8px 0 4px;font-weight:700">还没有照片或视频</p>
        <p class="small muted" style="text-align:center;margin:0">点右上角「＋ 上传」，可选「从相册选择」（照片/视频）、「拍照」或「录视频」。</p>
      </section>` : groups.map((g) => `
      <section class="card album-day">
        <h2 class="album-day-title">${esc(fmtDayTitle(g.day))}${(() => { const n = dayNumberOnDate(store.state.settings.babyBirthday, g.day); return n != null ? `<span class="muted small album-day-age" style="font-weight:600;margin-left:8px">第${n}天</span>` : ''; })()}</h2>
        <div class="album-grid">
          ${g.items.map((p) => `
            <button type="button" class="album-cell" data-id="${esc(p.id)}" aria-label="${p.kind === 'video' ? '查看视频' : '查看照片'}">
              <img src="${esc(p.thumbData || '')}" alt="" loading="lazy">
              ${p.kind === 'video' ? `<span class="album-play">▶ ${esc(fmtDur(p.duration))}</span>` : ''}
              ${isUploading(p.id) ? '<span class="album-badge uploading" title="正在上传到照片服务">上传中</span>' : (p.remoteReady ? '' : '<span class="album-badge" title="原图尚未上传到照片服务">本地</span>')}
              ${p.note ? `<span class="album-note-dot" title="${esc(p.note)}">📝</span>` : ''}
            </button>`).join('')}
        </div>
      </section>`).join('')}
    <p class="small muted" style="text-align:center;margin:8px 0 24px">共 ${store.photos().length} 项 · 原图/视频加密存极空间 · 视频不自动下载 · 元数据云同步</p>
  `;

  const q = (s) => root.querySelector(s);
  q('#btnGoPhotoSet') && (q('#btnGoPhotoSet').onclick = () => { location.hash = '#/settings'; });
  q('#btnAddPhoto').onclick = () => openAddPhotoSheet(root);
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const total = files.length;
    let ok = 0, fail = 0, uploadFail = 0;
    const lastErr = [];
    const progressEls = () => {
      const rootEl = albumRootRef || root;
      return [rootEl.querySelector('#albumProgress'), rootEl.querySelector('#albumProgressText')];
    };
    const setProg = (t) => {
      const [prog, progT] = progressEls();
      if (!prog || !progT) return;
      prog.hidden = false;
      progT.textContent = t;
    };
    const refresh = () => {
      if (location.hash.startsWith('#/album')) renderAlbum(albumRootRef || root);
    };
    setProg(`正在处理 0/${total}…`);
    for (const [i, f] of files.entries()) {
      const n = i + 1;
      try {
        const isVid = String(f.type || '').startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(f.name || '');
        setProg(isVid
          ? `已处理 ${i}/${total}，准备视频 ${n}/${total}（约 ${fmtSize(f.size)}）…`
          : `已处理 ${i}/${total}，处理中 ${n}/${total}…`);
        const opts = {
          onLocalReady: () => {
            // 缩略图已入库：立刻刷新时间轴，角标显示「上传中」
            refresh();
            setProg(`已处理 ${n}/${total}，上传中…`);
          },
          onProgress: (ev) => {
            if (ev?.phase === 'upload') {
              const pct = ev.ratio != null ? ` ${Math.round(ev.ratio * 100)}%` : '';
              setProg(isVid
                ? `上传中 ${n}/${total}${pct}（约 ${fmtSize(f.size)}）`
                : `上传中 ${n}/${total}…`);
            } else if (ev?.phase === 'done') {
              setProg(`已处理 ${n}/${total}` + (n < total ? '，继续…' : '，完成'));
            }
          },
        };
        const r = isVid ? await addVideoFromFile(f, opts) : await addPhotoFromFile(f, opts);
        ok++;
        if (r.needsPhotoApi) lastErr.push('已保存到本机；填照片服务地址后全家才能看原图');
        else if (r.uploadError) { uploadFail++; lastErr.push(r.uploadError); }
        refresh();
      } catch (err) {
        fail++;
        lastErr.push(err.message || '上传失败');
        refresh();
      }
    }
    const [pEnd] = progressEls();
    if (pEnd) pEnd.hidden = true;
    if (fail && !ok) toast(lastErr[0] || '上传失败', 4500);
    else if (uploadFail) toast(`已添加 ${ok} 项，其中 ${uploadFail} 项原图上传失败：${lastErr[lastErr.length - 1]}。可点开后点「补传原图」`, 5500);
    else if (ok && lastErr.length && !uploadFail) toast(lastErr[0], 4000);
    else if (ok && !fail) toast(ok === 1 ? '已添加并上传 1 项' : `已添加并上传 ${ok} 项`);
  };
  // v1.13.2：file input 放在 body 上常驻。iOS 从相册返回会触发 visibilitychange/同步重渲染，
  // 之前 input 在相册 DOM 里会被替换掉，change 事件丢失 → 选完照片什么都不出现
  ensureFileInputs();
  albumRootRef = root; onFilesRef = onFiles;
  root.querySelectorAll('.album-cell').forEach((btn) => {
    btn.onclick = () => openViewer(btn.dataset.id, root);
  });
}

/** 「＋ 上传」：选从相册（可多选）或拍照（带 capture，走相机） */
function openAddPhotoSheet(albumRoot) {
  openSheet(`
    <h3>添加照片 / 视频</h3>
    <p class="small muted" style="margin-top:0">从手机相册选照片或视频，或直接拍照、录视频。视频上限 ${Math.round((Number(store.state.settings.videoMaxMB) || 200))}MB，可在设置里改。</p>
    <div class="btn-row" style="flex-direction:column;gap:10px">
      <button type="button" class="btn" id="pickAlbum">🖼 从相册选择</button>
      <button type="button" class="btn secondary" id="pickCamera">📷 拍照</button>
      <button type="button" class="btn secondary" id="pickVideo">🎬 录视频</button>
      <button type="button" class="btn ghost" id="pickCancel">取消</button>
    </div>
  `, (sh) => {
    sh.querySelector('#pickCancel').onclick = closeSheet;
    sh.querySelector('#pickAlbum').onclick = () => {
      closeSheet();
      // 等面板关掉后再点 file input，避免 iOS 手势链被打断
      setTimeout(() => document.getElementById('filePhotoAlbum')?.click(), 80);
    };
    sh.querySelector('#pickVideo').onclick = () => {
      closeSheet();
      setTimeout(() => document.getElementById('fileVideoCamera')?.click(), 80);
    };
    sh.querySelector('#pickCamera').onclick = () => {
      closeSheet();
      setTimeout(() => document.getElementById('filePhotoCamera')?.click(), 80);
    };
  });
}

async function openViewer(id, albumRoot) {
  const meta = store.getPhoto(id);
  if (!meta) return;
  if (meta.kind === 'video') return openVideoViewer(id, albumRoot);
  openSheet(`
    <h3>照片</h3>
    <div class="album-viewer">
      <div class="album-viewer-img" id="avImg"><div class="muted small" style="padding:40px;text-align:center">加载中…</div></div>
      <div class="kv"><span>拍摄/时间</span><span>${esc(fmtDayTitle((() => { const d = new Date(meta.takenAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()))} ${esc(fmtTime(meta.takenAt))}</span></div>
      <div class="kv"><span>大小</span><span>${esc(fmtSize(meta.size))}${meta.width ? ` · ${meta.width}×${meta.height}` : ''}</span></div>
      <div class="kv"><span>原图</span><span>${meta.remoteReady ? '<span class="ok">已上传到照片服务</span>' : '<span class="bad">仅本机 / 未上传</span>'}</span></div>
      <div class="field"><label for="avNote">说明</label>
        <input id="avNote" class="input" value="${esc(meta.note)}" placeholder="可选：一句话说明"></div>
      <p class="small muted" id="avTip" hidden></p>
      <p class="small muted" id="avDlState" hidden></p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost" id="avClose">关闭</button>
        <button class="btn secondary" id="avSave">保存说明</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn" id="avDl">⬇ 下载原图</button>
        ${!meta.remoteReady && photoApiBase() ? '<button class="btn secondary" id="avRetry">补传原图</button>' : ''}
        ${canDeleteAlbum() ? '<button class="btn danger" id="avDel">删除</button>' : ''}
      </div>
    </div>
  `, async (sh) => {
    sh.querySelector('#avClose').onclick = closeSheet;
    sh.querySelector('#avSave').onclick = () => {
      const note = sh.querySelector('#avNote').value.trim();
      store.upsertPhoto({ ...meta, note });
      toast('已保存');
      closeSheet();
      renderAlbum(albumRoot);
    };
    const retry = sh.querySelector('#avRetry');
    if (retry) retry.onclick = async () => {
      retry.disabled = true; retry.textContent = '补传中…';
      try {
        await retryUpload(id, { onProgress: (ev) => {
          if (ev?.phase === 'upload') retry.textContent = '补传中…';
        }});
        toast('原图已补传'); closeSheet(); renderAlbum(albumRoot);
      } catch (e) {
        toast(`补传失败：${e.message || e}`, 4500);
        retry.disabled = false; retry.textContent = '补传原图';
      }
    };
    const delBtn = sh.querySelector('#avDel');
    if (delBtn) delBtn.onclick = async () => {
      if (!canDeleteAlbum()) return;
      const ok = await confirmSheet('确定删除这张照片吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      await removePhoto(id);
      toast('已删除');
      closeSheet();
      renderAlbum(albumRoot);
    };
    let loading = null;
    const getBlob = () => (loading ||= loadPhotoBlob(id).catch((e) => { loading = null; throw e; }));
    wireDownload(sh, meta, getBlob);
    try {
      const { blob, source, tip } = await getBlob();
      const url = URL.createObjectURL(blob);
      const box = sh.querySelector('#avImg');
      box.innerHTML = `<img src="${url}" alt="宝宝照片">`;
      const tipEl = sh.querySelector('#avTip');
      if (tip) { tipEl.hidden = false; tipEl.textContent = tip; }
      else if (source === 'thumb') { tipEl.hidden = false; tipEl.textContent = '当前为缩略图'; }
    } catch (e) {
      sh.querySelector('#avImg').innerHTML = `<div class="muted small" style="padding:24px;text-align:center">${esc(e.message || '加载失败')}</div>`;
    }
  });
}

/** 视频：先只显示封面 + 大小，用户点「播放」才下载（省流量） */
async function openVideoViewer(id, albumRoot) {
  const meta = store.getPhoto(id);
  const local = await hasLocalVideo(id);
  const d = new Date(meta.takenAt);
  const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  openSheet(`
    <h3>视频</h3>
    <div class="album-viewer">
      <div class="album-viewer-img album-video-box" id="avImg">
        <img src="${esc(meta.thumbData || '')}" alt="视频封面">
        <button type="button" class="btn album-play-btn" id="avPlay">▶ ${local ? '播放（已在本机）' : `播放（约 ${esc(fmtSize(meta.size))}）`}</button>
      </div>
      <p class="small muted" style="margin:0 0 8px">${local ? '本机已缓存，播放不耗流量。' : '为省流量不会自动下载；用手机流量时请留意大小。'}</p>
      <div class="kv"><span>拍摄/时间</span><span>${esc(fmtDayTitle(ymd))} ${esc(fmtTime(meta.takenAt))}</span></div>
      <div class="kv"><span>时长 / 大小</span><span>${esc(fmtDur(meta.duration))} · ${esc(fmtSize(meta.size))}${meta.width ? ` · ${meta.width}×${meta.height}` : ''}</span></div>
      <div class="kv"><span>原视频</span><span>${meta.remoteReady ? '<span class="ok">已上传到照片服务</span>' : '<span class="bad">仅本机 / 未上传</span>'}</span></div>
      <div class="field"><label for="avNote">说明</label>
        <input id="avNote" class="input" value="${esc(meta.note)}" placeholder="可选：一句话说明"></div>
      <p class="small muted" id="avTip" hidden></p>
      <p class="small muted" id="avDlState" hidden></p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost" id="avClose">关闭</button>
        <button class="btn secondary" id="avSave">保存说明</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn" id="avDl">⬇ 下载原视频</button>
        ${!meta.remoteReady && photoApiBase() ? '<button class="btn secondary" id="avRetry">补传视频</button>' : ''}
        ${canDeleteAlbum() ? '<button class="btn danger" id="avDel">删除</button>' : ''}
      </div>
    </div>
  `, (sh) => {
    let url = '';
    const cleanup = () => { if (url) URL.revokeObjectURL(url); };
    sh.querySelector('#avClose').onclick = () => { cleanup(); closeSheet(); };
    sh.querySelector('#avSave').onclick = () => {
      store.upsertPhoto({ ...meta, note: sh.querySelector('#avNote').value.trim() });
      toast('已保存'); cleanup(); closeSheet(); renderAlbum(albumRoot);
    };
    const retry = sh.querySelector('#avRetry');
    if (retry) retry.onclick = async () => {
      retry.disabled = true; retry.textContent = '补传中…';
      try {
        await retryUpload(id, { onProgress: (ev) => {
          if (ev?.phase === 'upload' && ev.ratio != null) retry.textContent = `补传中 ${Math.round(ev.ratio * 100)}%`;
          else if (ev?.phase === 'upload') retry.textContent = '补传中…';
        }});
        toast('视频已补传'); cleanup(); closeSheet(); renderAlbum(albumRoot);
      } catch (e) {
        toast(`补传失败：${e.message || e}`, 4500);
        retry.disabled = false; retry.textContent = '补传视频';
      }
    };
    const delBtn = sh.querySelector('#avDel');
    if (delBtn) delBtn.onclick = async () => {
      if (!canDeleteAlbum()) return;
      const ok = await confirmSheet('确定删除这个视频吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      await removePhoto(id); cleanup(); toast('已删除'); closeSheet(); renderAlbum(albumRoot);
    };
    wireDownload(sh, meta, null);
    const play = sh.querySelector('#avPlay');
    play.onclick = async () => {
      play.disabled = true; play.textContent = '下载中…';
      try {
        const { blob } = await loadVideoBlob(id, { onProgress: (x) => { play.textContent = `下载中 ${Math.round(x * 100)}%`; } });
        url = URL.createObjectURL(blob);
        const box = sh.querySelector('#avImg');
        box.innerHTML = `<video src="${url}" controls playsinline autoplay style="max-width:100%;max-height:70vh;display:block"></video>`;
      } catch (e) {
        play.disabled = false; play.textContent = '▶ 重试播放';
        const tip = sh.querySelector('#avTip'); tip.hidden = false; tip.textContent = e.message || '加载失败';
      }
    };
  });
}

// 设置页可调用：测试照片服务
export { pingPhotoServer, photoApiBase };

let albumRootRef = null, onFilesRef = null;
function ensureFileInputs() {
  const defs = [['filePhotoAlbum', 'image/*,video/*', true, false], ['filePhotoCamera', 'image/*', false, 'environment'], ['fileVideoCamera', 'video/*', false, 'environment']];
  for (const [id, accept, multi, cap] of defs) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('input');
    el.type = 'file'; el.id = id; el.accept = accept; el.hidden = true;
    if (multi) el.multiple = true;
    if (cap) el.setAttribute('capture', cap);
    el.addEventListener('change', (e) => onFilesRef && onFilesRef(e));
    document.body.appendChild(el);
  }
}
