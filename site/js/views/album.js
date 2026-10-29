// v1.8.0 相册页：按拍摄/上传时间分组的时间轴
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import {
  photosByDay, fmtDayTitle, addPhotoFromFile, loadPhotoBlob, removePhoto,
  retryUpload, photoApiBase, pingPhotoServer,
} from '../photos.js';
import { syncStatus } from '../sync.js';

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
    <input type="file" id="filePhoto" accept="image/*" capture="environment" multiple hidden>
    ${groups.length === 0 ? `
      <section class="card album-empty">
        <div style="font-size:48px;text-align:center">📷</div>
        <p style="text-align:center;margin:8px 0 4px;font-weight:700">还没有照片</p>
        <p class="small muted" style="text-align:center;margin:0">点右上角「＋ 上传」，从相册选图或拍照。</p>
      </section>` : groups.map((g) => `
      <section class="card album-day">
        <h2 class="album-day-title">${esc(fmtDayTitle(g.day))}<span class="muted small" style="font-weight:600;margin-left:8px">${esc(g.day)} · ${g.items.length} 张</span></h2>
        <div class="album-grid">
          ${g.items.map((p) => `
            <button type="button" class="album-cell" data-id="${esc(p.id)}" aria-label="查看照片">
              <img src="${esc(p.thumbData || '')}" alt="" loading="lazy">
              ${p.remoteReady ? '' : '<span class="album-badge" title="原图尚未上传到照片服务">本地</span>'}
              ${p.note ? `<span class="album-note-dot" title="${esc(p.note)}">📝</span>` : ''}
            </button>`).join('')}
        </div>
      </section>`).join('')}
    <p class="small muted" style="text-align:center;margin:8px 0 24px">共 ${store.photos().length} 张 · 原图加密存极空间 · 元数据云同步</p>
  `;

  const q = (s) => root.querySelector(s);
  q('#btnGoPhotoSet') && (q('#btnGoPhotoSet').onclick = () => { location.hash = '#/settings'; });
  q('#btnAddPhoto').onclick = () => q('#filePhoto').click();
  q('#filePhoto').onchange = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    let ok = 0, fail = 0;
    for (const f of files) {
      try {
        const r = await addPhotoFromFile(f);
        ok++;
        if (r.needsPhotoApi) toast('已保存到本机；填照片服务地址后全家才能看原图', 3500);
        else if (r.uploadError) toast(`已添加，原图上传失败：${r.uploadError}`, 4000);
      } catch (err) {
        fail++;
        toast(err.message || '上传失败', 3500);
      }
    }
    if (ok && !fail) toast(ok === 1 ? '已添加 1 张照片' : `已添加 ${ok} 张照片`);
    renderAlbum(root);
  };
  root.querySelectorAll('.album-cell').forEach((btn) => {
    btn.onclick = () => openViewer(btn.dataset.id, root);
  });
}

async function openViewer(id, albumRoot) {
  const meta = store.getPhoto(id);
  if (!meta) return;
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

// 设置页可调用：测试照片服务
export { pingPhotoServer, photoApiBase };
