// v1.8.0 相册页：按拍摄/上传时间分组的时间轴（v1.9.1：上传可选相册或拍照）
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import {
  photosByDay, fmtDayTitle, addPhotoFromFile, loadPhotoBlob, removePhoto,
  retryUpload, photoApiBase, pingPhotoServer,
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
    <input type="file" id="filePhotoAlbum" accept="image/*,video/*" multiple hidden>
    <input type="file" id="filePhotoCamera" accept="image/*" capture="environment" hidden>
    <input type="file" id="fileVideoCamera" accept="video/*" capture="environment" hidden>
    <div class="banner album-progress" id="albumProgress" hidden><div class="bt" id="albumProgressText">上传中…</div></div>
    ${groups.length === 0 ? `
      <section class="card album-empty">
        <div style="font-size:48px;text-align:center">📷</div>
        <p style="text-align:center;margin:8px 0 4px;font-weight:700">还没有照片或视频</p>
        <p class="small muted" style="text-align:center;margin:0">点右上角「＋ 上传」，可选「从相册选择」（照片/视频）、「拍照」或「录视频」。</p>
      </section>` : groups.map((g) => `
      <section class="card album-day">
        <h2 class="album-day-title">${esc(fmtDayTitle(g.day))}<span class="muted small" style="font-weight:600;margin-left:8px">${esc(g.day)} · ${g.items.length} 项</span></h2>
        <div class="album-grid">
          ${g.items.map((p) => `
            <button type="button" class="album-cell" data-id="${esc(p.id)}" aria-label="${p.kind === 'video' ? '查看视频' : '查看照片'}">
              <img src="${esc(p.thumbData || '')}" alt="" loading="lazy">
              ${p.kind === 'video' ? `<span class="album-play">▶ ${esc(fmtDur(p.duration))}</span>` : ''}
              ${p.remoteReady ? '' : '<span class="album-badge" title="原图尚未上传到照片服务">本地</span>'}
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
    let ok = 0, fail = 0;
    const prog = q('#albumProgress'), progT = q('#albumProgressText');
    for (const [i, f] of files.entries()) {
      try {
        const isVid = String(f.type || '').startsWith('video/');
        if (isVid) { prog.hidden = false; progT.textContent = `视频 ${i + 1}/${files.length}：准备中（约 ${fmtSize(f.size)}）…`; }
        const r = isVid
          ? await addVideoFromFile(f, { onProgress: (x) => { progT.textContent = `视频 ${i + 1}/${files.length}：加密上传 ${Math.round(x * 100)}%（约 ${fmtSize(f.size)}）`; } })
          : await addPhotoFromFile(f);
        ok++;
        if (r.needsPhotoApi) toast('已保存到本机；填照片服务地址后全家才能看原图', 3500);
        else if (r.uploadError) toast(`已添加，原图上传失败：${r.uploadError}`, 4000);
      } catch (err) {
        fail++;
        toast(err.message || '上传失败', 3500);
      }
    }
    prog.hidden = true;
    if (ok && !fail) toast(ok === 1 ? '已添加 1 项' : `已添加 ${ok} 项`);
    renderAlbum(root);
  };
  q('#filePhotoAlbum').onchange = onFiles;
  q('#filePhotoCamera').onchange = onFiles;
  q('#fileVideoCamera').onchange = onFiles;
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
      setTimeout(() => albumRoot.querySelector('#filePhotoAlbum')?.click(), 80);
    };
    sh.querySelector('#pickVideo').onclick = () => {
      closeSheet();
      setTimeout(() => albumRoot.querySelector('#fileVideoCamera')?.click(), 80);
    };
    sh.querySelector('#pickCamera').onclick = () => {
      closeSheet();
      setTimeout(() => albumRoot.querySelector('#filePhotoCamera')?.click(), 80);
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
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost" id="avClose">关闭</button>
        <button class="btn secondary" id="avSave">保存说明</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        ${!meta.remoteReady && photoApiBase() ? '<button class="btn secondary" id="avRetry">补传原图</button>' : ''}
        <button class="btn danger" id="avDel">删除</button>
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
      retry.disabled = true;
      try { await retryUpload(id); toast('原图已补传'); closeSheet(); renderAlbum(albumRoot); }
      catch (e) { toast(e.message, 4000); retry.disabled = false; }
    };
    sh.querySelector('#avDel').onclick = async () => {
      const ok = await confirmSheet('确定删除这张照片吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      await removePhoto(id);
      toast('已删除');
      closeSheet();
      renderAlbum(albumRoot);
    };
    try {
      const { blob, source, tip } = await loadPhotoBlob(id);
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
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost" id="avClose">关闭</button>
        <button class="btn secondary" id="avSave">保存说明</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        ${!meta.remoteReady && photoApiBase() ? '<button class="btn secondary" id="avRetry">补传视频</button>' : ''}
        <button class="btn danger" id="avDel">删除</button>
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
      try { await retryUpload(id); toast('视频已补传'); cleanup(); closeSheet(); renderAlbum(albumRoot); }
      catch (e) { toast(e.message, 4000); retry.disabled = false; retry.textContent = '补传视频'; }
    };
    sh.querySelector('#avDel').onclick = async () => {
      const ok = await confirmSheet('确定删除这个视频吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      await removePhoto(id); cleanup(); toast('已删除'); closeSheet(); renderAlbum(albumRoot);
    };
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
