// 设置：推送提醒、快捷指令名称、数据备份（导出/导入 JSON）
import { store, uid } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import { pushStatus, enablePush, disablePush, sendTestPush, isIOS, isStandalone, apiBase } from '../push.js';
import { showAlarm } from './alarm.js';
import { unlockAudio } from '../sound.js';
import { todayStr, cnDate } from '../dates.js';
import { testAlarmUrl } from '../shortcuts.js';
import { openVaxPlan, openCheckupPlan, planCounts } from './vaxplan.js';
import { openPaidCatalog, catalogCounts } from './paidcat.js';
import { syncAvailable, syncStatus, enableSync, disableSync, syncNow } from '../sync.js';
import { extractSyncKey } from '../sync-core.js';
import { pingPhotoServer, videoCacheInfo, clearVideoCache } from '../photos.js';
// 本组 JS 文件的版本（每次发布与 config.js 的 appVersion、sw.js 的 VERSION 一起改）；两者不一致说明 JS 还是旧缓存
export const APP_BUILD = '1.12.1';

/** 编辑宝宝名字 + 生日（云同步 profile）；保存后触发 rerender */
export function openBabyProfile({ onSaved } = {}) {
  const st = store.state.settings;
  openSheet(`
    <h3>宝宝资料</h3>
    <p class="small muted" style="margin-top:0">名字和生日会加密同步给全家；日龄与生长记录一致（出生当天＝第1天）。</p>
    <div class="field"><label for="bp-name">宝宝名字 / 小名</label>
      <input id="bp-name" class="input" maxlength="20" placeholder="例如：豆豆" value="${esc(st.babyName || '')}"></div>
    <div class="field"><label for="bp-bday">出生日期</label>
      <input id="bp-bday" type="date" class="input" value="${esc(st.babyBirthday || '')}" max="${todayStr()}"></div>
    <div class="btn-row"><button class="btn ghost" data-a="cancel">取消</button><button class="btn" data-a="save">保存</button></div>
  `, (sheet) => {
    sheet.querySelector('[data-a=cancel]').onclick = () => closeSheet();
    sheet.querySelector('[data-a=save]').onclick = () => {
      const name = sheet.querySelector('#bp-name').value.trim().slice(0, 20);
      const bday = sheet.querySelector('#bp-bday').value;
      if (bday && !/^\d{4}-\d{2}-\d{2}$/.test(bday)) { toast('请选择正确的出生日期'); return; }
      if (bday && bday > todayStr()) { toast('出生日期不能是未来'); return; }
      store.updateSettings({ babyName: name, babyBirthday: bday || '' });
      closeSheet();
      toast(name ? `已保存「${name}」` : '已保存宝宝资料');
      window.dispatchEvent(new CustomEvent('rerender'));
      if (onSaved) onSaved();
    };
    setTimeout(() => sheet.querySelector('#bp-name')?.focus(), 50);
  });
}

export function renderSettings(root) {
  const st = store.state.settings;
  root.innerHTML = `
    <header class="topbar"><h1>设置</h1></header>

    <section class="card" id="babyProfileCard">
      <h2>👶 宝宝资料</h2>
      <p class="small muted" style="margin-top:0">左上角显示的名字和「已出生第几天」；修改后全家云同步可见。</p>
      <div class="kv"><span>名字 / 小名</span><span>${st.babyName ? esc(st.babyName) : '<span class="muted">未设置（显示「宝宝记录」）</span>'}</span></div>
      <div class="kv"><span>出生日期</span><span>${st.babyBirthday ? esc(cnDate(st.babyBirthday, true)) : '<span class="muted">未设置</span>'}</span></div>
      <button class="btn block" id="btnBabyProfile" style="margin-top:10px">编辑名字和生日</button>
    </section>

    <section class="card">
      <h2>⏰ iPhone 闹钟提醒（推荐）</h2>
      <p class="small muted" style="margin-top:0">通过「快捷指令」在「提醒事项」的「宝宝」列表中创建<b>紧急</b>提醒：到点全屏响铃，静音也会响。需要 iOS 26.2+，并按 <a href="#/help">帮助页</a> 创建一次快捷指令。</p>
      <div class="field"><label for="scName">快捷指令名称（需与「快捷指令」App 里的名称完全一致）</label>
        <input id="scName" class="input" value="${esc(st.shortcutName)}"></div>
      <button class="btn block" id="btnTestAlarm">测试闹钟（2分钟后响）</button>
      <p class="small muted">会在「宝宝」列表新建一条「【宝宝】测试闹钟」紧急提醒，2 分钟后响铃。测试后可在「提醒事项」里删除它。</p>
      <p class="small muted">v1.7.1：重设闹钟时自动删除旧的，需要再建一个快捷指令「<b>${esc(st.shortcutName || '宝宝闹钟')}删除</b>」（名称自动 = 上面的名称 + 删除），见 <a href="#/help" id="lnkReplace">帮助页「新增」步骤</a>。完成后再测一次会替换上一次的测试提醒。</p>
      <button class="btn secondary block" id="btnPreview">预览App内全屏提醒页（含铃声）</button>
    </section>

    <section class="card" id="vaxCard">
      <h2>📋 一键生成日程</h2>
      <p class="small muted" style="margin-top:0">输入宝宝生日，按国家规范自动添加到 6 周岁的免费疫苗（国家免疫规划 2026年版）和儿保体检（0～6岁儿童健康管理）日程；重复生成不会重复添加。自费疫苗默认「待定」，在「💰 自费疫苗（待定）」里按需加入计划。</p>
      <div class="kv"><span>宝宝生日</span><span>${st.babyBirthday ? esc(cnDate(st.babyBirthday, true)) : '<span class="muted">未设置</span>'}</span></div>
      <div class="kv"><span>💉 已生成的疫苗事项</span><span>${planCounts('vaccine')} 个</span></div>
      <div class="kv"><span>💰 已加入计划的自费疫苗</span><span>${(() => { const c = catalogCounts(); return `${c.planned} 种（${c.doses} 剂未完成）`; })()}</span></div>
      <div class="kv"><span>🩺 已生成的体检事项</span><span>${planCounts('checkup')} 个</span></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="btnVax" style="background:var(--vaccine)">💉 疫苗计划</button>
        <button class="btn" id="btnChk" style="background:var(--checkup)">🩺 体检计划</button>
      </div>
      <button class="btn block" id="btnPaid" style="background:var(--paidvax);margin-top:10px">💰 自费疫苗（待定）</button>
    </section>

    <section class="card">
      <h2>🔔 网页推送通知（可选·备用）</h2>
      <p class="small muted" style="margin-top:0">到了提醒时间，iPhone 弹出普通通知「宝宝提醒：今天 10:00 打疫苗」，点开是全屏提醒页。推送服务目前为临时服务，可能中断，请以闹钟提醒为主。<br>
      <b>需要：</b>iOS 16.4 及以上 · 先把本App<b>添加到主屏幕</b>并<b>从主屏幕图标打开</b> · 允许通知。</p>
      <ul class="list" id="pushStatus"><li class="kv"><span>检测中…</span></li></ul>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        <button class="btn secondary block" id="btnEnable">开启推送提醒</button>
        <div class="btn-row">
          <button class="btn secondary" id="btnTest">立即测试通知</button>
          <button class="btn secondary" id="btnTest60">1分钟后测试</button>
        </div>
        <button class="btn ghost block" id="btnDisable">关闭推送</button>
      </div>
      <p class="note small">「1分钟后测试」：点完后回到主屏幕或锁屏，1分钟内应收到通知。若收不到，请检查 iPhone「设置 → 通知 → 宝宝记录」是否允许通知，以及专注模式是否屏蔽了通知。</p>
    </section>

    ${syncAvailable() ? syncCardHtml() : ''}

    <section class="card" id="photoCard">
      <h2>📷 照片服务（极空间）</h2>
      <p class="small muted" style="margin-top:0">相册原图加密后存到你家极空间里的小服务；缩略图和说明走云同步。家里 Wi‑Fi 填局域网地址（如 <span class="kbd">http://192.168.1.8:8789</span>）。外出需 VPN，或以后买域名 + Tunnel。</p>
      <div class="field"><label for="photoApi">照片服务地址</label>
        <input id="photoApi" class="input" placeholder="http://192.168.x.x:8789" value="${esc(st.photoApi || '')}"></div>
      <div class="btn-row"><button class="btn secondary" id="btnPhotoTest">测试连接</button><button class="btn ghost" id="btnPhotoSave">保存</button></div>
      <p class="small muted" id="photoTestResult" style="margin-top:8px"></p>
      <h3 style="margin:14px 0 6px;font-size:15px">🎬 视频（省流量）</h3>
      <div class="field"><label for="videoMaxMB">视频大小上限（MB）</label>
        <input id="videoMaxMB" class="input" type="number" inputmode="numeric" min="10" max="2000" value="${esc(String(st.videoMaxMB || 200))}"></div>
      <div class="field"><label for="videoCacheMB">本机视频缓存上限（MB）</label>
        <input id="videoCacheMB" class="input" type="number" inputmode="numeric" min="50" max="5000" value="${esc(String(st.videoCacheMB || 500))}"></div>
      <div class="btn-row"><button class="btn ghost" id="btnVideoCacheClear">清空本机视频缓存</button></div>
      <p class="small muted" id="videoCacheInfo" style="margin-top:6px">本机视频缓存：计算中…</p>
      <p class="note small">视频不会自动下载或播放；点开后显示大小，点「播放」才下载，下载过的存本机（超出缓存上限时先删最早的）。超过大小上限会拒绝，请在 iPhone 相册里剪短后再传。</p>
      <p class="note small">部署说明见仓库 <code>sync/photo-server/README.md</code>（极空间 Docker 挂载文件夹、端口 8789）。未填地址时仍可本机选图预览，元数据可先同步，全家看原图需填地址。</p>
    </section>

    <section class="card">
      <h2>💾 数据备份</h2>
      <p class="small muted" style="margin-top:0">${syncStatus().enabled ? '已开启云同步：数据保存在本机，并加密同步到云端。' : '数据只保存在这台手机的本App里（无需登录）。'}建议定期导出备份，换手机或清理Safari数据前一定要导出。</p>
      <div class="btn-row"><button class="btn secondary" id="btnExport">导出备份</button><button class="btn secondary" id="btnImport">导入备份</button></div>
      <input type="file" id="fileImport" accept="application/json,.json,text/plain" hidden>
      <p class="small muted">当前共有 <b>${store.events().length}</b> 个事项 · <b>${store.photos().length}</b> 张照片。</p>
    </section>

    <section class="card">
      <h2>🔧 其他</h2>
      <div class="kv"><span>提醒页铃声</span><label><input type="checkbox" id="soundOn" ${st.sound ? 'checked' : ''}> 开启</label></div>
      <details><summary class="small">高级：推送服务地址</summary>
        <div class="field" style="margin-top:8px"><input id="pushApi" class="input" placeholder="留空使用默认" value="${esc(st.pushApi)}">
        <div class="small muted">当前使用：${esc(apiBase() || '未配置')}</div></div>
      </details>
      <button class="btn danger block" id="btnReset" style="margin-top:12px">清空所有数据</button>
      <p class="small muted" style="text-align:center" id="appVer">宝宝记录 v${esc(APP_BUILD)}${(window.BABY_CONFIG?.appVersion || APP_BUILD) !== APP_BUILD ? ` · 正在更新到 v${esc(window.BABY_CONFIG.appVersion)}，请关闭后重新打开` : ''}</p>
    </section>`;

  const q = (s) => root.querySelector(s);
  refreshStatus(q('#pushStatus'));

  q('#btnEnable').onclick = async () => {
    unlockAudio();
    q('#btnEnable').disabled = true;
    try { await enablePush(); toast('推送提醒已开启 🎉'); } catch (e) { toast(e.message, 4500); }
    q('#btnEnable').disabled = false;
    refreshStatus(q('#pushStatus'));
  };
  q('#btnTest').onclick = async () => {
    try { await sendTestPush(0); toast('已发送测试通知，请留意通知栏'); } catch (e) { toast('发送失败：' + e.message, 4000); }
  };
  q('#btnTest60').onclick = async () => {
    try { await sendTestPush(60); toast('1分钟后会收到测试通知，现在可以回到主屏幕或锁屏'); } catch (e) { toast('设置失败：' + e.message, 4000); }
  };
  q('#btnBabyProfile').onclick = () => openBabyProfile({ onSaved: () => renderSettings(root) });
  q('#btnVax').onclick = () => openVaxPlan();
  q('#btnChk').onclick = () => openCheckupPlan();
  q('#btnPaid').onclick = () => openPaidCatalog();
  q('#btnTestAlarm').onclick = () => { location.href = testAlarmUrl(); };
  q('#btnPreview').onclick = () => {
    unlockAudio();
    const now = new Date(); now.setHours(now.getHours() + 2, 0, 0, 0);
    const demo = { id: 'demo', date: todayStr(), time: `${String(now.getHours()).padStart(2, '0')}:00`, title: '打疫苗（示例）', category: 'vaccine', note: '带上疫苗本和医保卡', reminders: [] };
    if (now.getDate() !== new Date().getDate()) demo.time = '23:30';
    showAlarm({ rid: `demo-${uid()}`, eventId: 'demo', ev: demo, fireAt: Date.now(), label: '提前2小时提醒' });
  };
  q('#btnDisable').onclick = async () => { await disablePush(); toast('已关闭推送'); refreshStatus(q('#pushStatus')); };
  q('#lnkReplace').onclick = (e) => { e.preventDefault(); location.hash = '#/help'; setTimeout(() => document.getElementById('h-replace')?.scrollIntoView({ block: 'start' }), 300); };
  q('#scName').onchange = (e) => { store.updateSettings({ shortcutName: e.target.value.trim() || '宝宝闹钟' }); toast('已保存'); };
  q('#soundOn').onchange = (e) => store.updateSettings({ sound: e.target.checked });
  q('#pushApi').onchange = (e) => { store.updateSettings({ pushApi: e.target.value.trim() }); toast('已保存'); refreshStatus(q('#pushStatus')); };

  if (syncAvailable()) bindSyncCard(root);

  q('#btnPhotoSave').onclick = () => {
    store.updateSettings({ photoApi: q('#photoApi').value.trim().replace(/\/+$/, '') });
    toast('已保存照片服务地址');
  };
  const clampMB = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d; };
  q('#videoMaxMB').onchange = (e) => { const v = clampMB(e.target.value, 10, 2000, 200); e.target.value = v; store.updateSettings({ videoMaxMB: v }); toast(`视频上限 ${v}MB`); };
  q('#videoCacheMB').onchange = (e) => { const v = clampMB(e.target.value, 50, 5000, 500); e.target.value = v; store.updateSettings({ videoCacheMB: v }); toast(`缓存上限 ${v}MB`); };
  const showVC = async () => {
    let t = '';
    try { const i = await videoCacheInfo(); t = `本机视频缓存：${i.count} 个 · ${(i.bytes / 1048576).toFixed(1)}MB`; } catch { /* ignore */ }
    const el = root.querySelector('#videoCacheInfo'); if (el) el.textContent = t; // 页面可能已切走
  };
  showVC();
  q('#btnVideoCacheClear').onclick = async () => { await clearVideoCache(); toast('已清空本机视频缓存'); showVC(); };
  q('#btnPhotoTest').onclick = async () => {
    const url = q('#photoApi').value.trim().replace(/\/+$/, '');
    store.updateSettings({ photoApi: url });
    const el = q('#photoTestResult');
    el.textContent = '测试中…';
    const r = await pingPhotoServer(url);
    el.innerHTML = r.ok ? `<span class="ok">连接成功：${esc(r.message)}</span>` : `<span class="bad">连不上：${esc(r.message)}</span>`;
  };

  q('#btnExport').onclick = () => exportBackup();
  q('#btnImport').onclick = () => q('#fileImport').click();
  q('#fileImport').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    e.target.value = '';
    const ok = await confirmSheet('导入会用备份文件替换当前所有数据，确定吗？', '导入');
    if (!ok) return;
    try { const n = store.importJSON(text); toast(`导入成功，共 ${n} 个事项`); } catch (err) { toast('导入失败：' + err.message, 4000); }
  };
  q('#btnReset').onclick = async () => {
    const ok = await confirmSheet('确定清空所有事项和设置吗？此操作不可恢复（建议先导出备份）。', '清空', true);
    if (ok) { store.resetAll(); toast('已清空'); }
  };
}

// ===== 云同步 =====
function fmtTime(t) {
  if (!t) return '还没有同步过';
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function syncStateHtml(s = syncStatus()) {
  if (!s.enabled) return '<span class="muted">未开启</span>';
  if (s.running) return '同步中…';
  if (s.lastError) return `<span class="bad">同步失败：${esc(s.lastError)}</span>`;
  return `<span class="ok">已开启</span> · 上次同步 ${esc(fmtTime(s.lastSyncAt))}`;
}
function syncCardHtml() {
  const s = syncStatus();
  return `<section class="card" id="syncCard">
      <h2>☁️ 云同步</h2>
      <p class="small muted" style="margin-top:0">在多台手机之间同步事项；助手也能帮你把购物清单、记录直接加进来。数据在本机<b>加密</b>后上传，只有持有同步密钥的设备能看到内容。</p>
      <div class="kv"><span>状态</span><span id="syncState">${syncStateHtml(s)}</span></div>
      ${s.enabled ? `
      <div class="field" style="margin-top:8px"><label>同步密钥（在另一台设备上粘贴它即可同步同一份数据）</label>
        <input id="syncKey" class="input" readonly value="${esc(s.key.slice(0, 9) + '••••••••••••' + s.key.slice(-4))}" data-full="${esc(s.key)}"></div>
      <div class="btn-row"><button class="btn secondary" id="btnSyncShow">显示</button><button class="btn secondary" id="btnSyncCopy">复制密钥</button></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="btnSyncNow">立即同步</button><button class="btn ghost" id="btnSyncOff">关闭同步</button></div>
      <p class="note small">⚠️ 密钥就是这份数据的钥匙：拿到它的人可以读写你的宝宝记录。只在自己的设备之间传递，不要发到群里；丢了密钥无法找回（本机数据不受影响）。</p>` : `
      <div class="field" style="margin-top:8px"><label for="syncPaste">同步密钥（从助手或另一台设备得到的，以 brs1_ 开头）</label>
        <textarea id="syncPaste" class="input" rows="2" placeholder="粘贴同步密钥"></textarea></div>
      <div class="btn-row"><button class="btn secondary" id="btnSyncClip">从剪贴板粘贴</button><button class="btn" id="btnSyncJoin">连接并同步</button></div>
      <p class="small muted">本机已有的事项（包括已生成的疫苗、体检计划）会上传并和云端合并，不会被清空。</p>
      <details style="margin-top:6px"><summary class="small">没有密钥？在这台设备上生成新密钥</summary>
        <p class="small muted">只在第一台设备上这样做；其他设备都要粘贴同一个密钥，才能看到同一份数据。</p>
        <button class="btn secondary block" id="btnSyncOn">生成新密钥并开启</button>
      </details>`}
    </section>`;
}
function bindSyncCard(root) {
  const q = (s) => root.querySelector(s);
  const run = async (btn, fn, okMsg) => {
    btn.disabled = true;
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, 4000); }
    btn.disabled = false;
    renderSettings(root);
  };
  q('#btnSyncOn') && (q('#btnSyncOn').onclick = () => run(q('#btnSyncOn'), () => enableSync(), '云同步已开启 ☁️'));
  q('#btnSyncJoin') && (q('#btnSyncJoin').onclick = () => run(q('#btnSyncJoin'), () => enableSync(q('#syncPaste').value), '已连接，数据已合并 ☁️'));
  q('#btnSyncClip') && (q('#btnSyncClip').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      const k = extractSyncKey(t);
      if (!k) { toast('剪贴板里没有同步密钥（应以 brs1_ 开头）', 3500); return; }
      q('#syncPaste').value = k; toast('已粘贴，点「连接并同步」');
    } catch { toast('无法读取剪贴板：请长按输入框选择「粘贴」', 3500); q('#syncPaste').focus(); }
  });
  q('#btnSyncNow') && (q('#btnSyncNow').onclick = () => run(q('#btnSyncNow'), async () => { await syncNow('manual'); if (syncStatus().lastError) throw new Error('同步失败：' + syncStatus().lastError); }, '已同步'));
  q('#btnSyncOff') && (q('#btnSyncOff').onclick = async () => {
    const ok = await confirmSheet('关闭后这台设备不再同步（本机数据保留，密钥也保留，随时可以再开启）。', '关闭同步');
    if (ok) { disableSync(); renderSettings(root); }
  });
  q('#btnSyncShow') && (q('#btnSyncShow').onclick = () => { const i = q('#syncKey'); i.value = i.dataset.full; i.select(); });
  q('#btnSyncCopy') && (q('#btnSyncCopy').onclick = async () => {
    const i = q('#syncKey');
    try { await navigator.clipboard.writeText(i.dataset.full); toast('已复制同步密钥'); } catch { i.value = i.dataset.full; i.select(); toast('请长按选择并复制'); }
  });
}
// 打开配对链接（#pair=密钥）后：主屏幕 App 里直接连接；在 Safari 里则提示复制到 App（iOS 上两者数据分开）
export function openPairSheet(key) {
  const inApp = isStandalone();
  const fp = `${key.slice(0, 9)}…${key.slice(-4)}`;
  openSheet(`
    <h3>☁️ 连接云同步</h3>
    ${inApp || !isIOS() ? `<p>用这个同步密钥（${esc(fp)}）和其他设备、助手共享同一份数据。</p>
      <p class="small muted">本机已有的事项会上传并和云端合并，不会被清空。</p>
      <div class="btn-row"><button class="btn ghost" id="pairCancel">取消</button><button class="btn" id="pairJoin">连接并同步</button></div>
      ${inApp ? '' : '<button class="btn secondary block" id="pairCopy" style="margin-top:10px">复制同步密钥</button>'}`
    : `<p>你现在是在 <b>Safari</b> 里打开的。主屏幕上的「宝宝记录」App 和 Safari 的数据是分开的，请把密钥带到 App 里：</p>
      <ol class="small" style="padding-left:20px;line-height:1.8">
        <li>点下面的「复制同步密钥」</li>
        <li>回到主屏幕，打开「宝宝记录」App</li>
        <li>设置 → ☁️ 云同步 → 「从剪贴板粘贴」 → 「连接并同步」</li>
      </ol>
      <button class="btn block" id="pairCopy">复制同步密钥</button>
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost" id="pairCancel">关闭</button><button class="btn secondary" id="pairJoin">就在 Safari 里使用</button></div>`}
  `, (sh) => {
    sh.querySelector('#pairCancel').onclick = closeSheet;
    const copy = sh.querySelector('#pairCopy');
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(key); toast('已复制，去主屏幕打开「宝宝记录」App 粘贴', 3500); } catch { toast('复制失败，请重新扫码', 3500); }
    };
    sh.querySelector('#pairJoin').onclick = async () => {
      closeSheet();
      try { await enableSync(key); toast('已连接，数据已合并 ☁️'); } catch (e) { toast(e.message, 4000); }
      if (location.hash.startsWith('#/settings')) window.dispatchEvent(new CustomEvent('hashchange'));
    };
  });
}

window.addEventListener('sync-status', (e) => { const el = document.getElementById('syncState'); if (el) el.innerHTML = syncStateHtml(e.detail); });

async function refreshStatus(el) {
  const s = await pushStatus();
  const row = (k, v, good) => `<li class="kv"><span>${k}</span><span class="${good ? 'ok' : 'bad'}">${v}</span></li>`;
  el.innerHTML = [
    isIOS() ? row('已从主屏幕打开', s.standalone ? '是' : '否（请先添加到主屏幕）', s.standalone) : row('主屏幕/独立模式', s.standalone ? '是' : '否', s.standalone),
    row('系统支持推送', s.supported ? '支持' : '不支持', s.supported),
    row('通知权限', { granted: '已允许', denied: '已拒绝（去系统设置开启）', default: '未询问' }[s.permission] || '不支持', s.permission === 'granted'),
    row('推送订阅', s.subscribed ? '已开启' : '未开启', s.subscribed),
    row('推送服务', s.server ? '在线' : '连接不上', !!s.server),
  ].join('');
}

async function exportBackup() {
  const json = store.exportJSON();
  const d = todayStr().replace(/-/g, '');
  const name = `宝宝记录备份-${d}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iPhone：优先用系统分享面板（可“存储到文件”或发给自己）
  if (navigator.canShare && navigator.canShare({ files: [file] }) && isIOS()) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  toast('备份文件已导出');
}
export { isStandalone };
