// 设置：推送提醒、快捷指令名称、数据备份（导出/导入 JSON）
import { store, uid } from '../store.js';
import { esc, toast, confirmSheet } from '../ui.js';
import { pushStatus, enablePush, disablePush, sendTestPush, isIOS, isStandalone, apiBase } from '../push.js';
import { showAlarm } from './alarm.js';
import { unlockAudio } from '../sound.js';
import { todayStr } from '../dates.js';
import { testAlarmUrl } from '../shortcuts.js';

export function renderSettings(root) {
  const st = store.state.settings;
  root.innerHTML = `
    <header class="topbar"><h1>设置</h1></header>

    <section class="card">
      <h2>⏰ iPhone 闹钟提醒（推荐）</h2>
      <p class="small muted" style="margin-top:0">通过「快捷指令」在「提醒事项」的「宝宝」列表中创建<b>紧急</b>提醒：到点全屏响铃，静音也会响。需要 iOS 26.2+，并按 <a href="#/help">帮助页</a> 创建一次快捷指令。</p>
      <div class="field"><label for="scName">快捷指令名称（需与「快捷指令」App 里的名称完全一致）</label>
        <input id="scName" class="input" value="${esc(st.shortcutName)}"></div>
      <button class="btn block" id="btnTestAlarm">测试闹钟（2分钟后响）</button>
      <p class="small muted">会在「宝宝」列表新建一条「【宝宝】测试闹钟」紧急提醒，2 分钟后响铃。测试后可在「提醒事项」里删除它。</p>
      <button class="btn secondary block" id="btnPreview">预览App内全屏提醒页（含铃声）</button>
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

    <section class="card">
      <h2>💾 数据备份</h2>
      <p class="small muted" style="margin-top:0">数据只保存在这台手机的本App里（无需登录）。建议定期导出备份，换手机或清理Safari数据前一定要导出。</p>
      <div class="btn-row"><button class="btn secondary" id="btnExport">导出备份</button><button class="btn secondary" id="btnImport">导入备份</button></div>
      <input type="file" id="fileImport" accept="application/json,.json,text/plain" hidden>
      <p class="small muted">当前共有 <b>${store.events().length}</b> 个事项。</p>
    </section>

    <section class="card">
      <h2>🔧 其他</h2>
      <div class="kv"><span>提醒页铃声</span><label><input type="checkbox" id="soundOn" ${st.sound ? 'checked' : ''}> 开启</label></div>
      <details><summary class="small">高级：推送服务地址</summary>
        <div class="field" style="margin-top:8px"><input id="pushApi" class="input" placeholder="留空使用默认" value="${esc(st.pushApi)}">
        <div class="small muted">当前使用：${esc(apiBase() || '未配置')}</div></div>
      </details>
      <button class="btn danger block" id="btnReset" style="margin-top:12px">清空所有数据</button>
      <p class="small muted" style="text-align:center">宝宝记录 v${esc(window.BABY_CONFIG?.appVersion || '1.0.0')}</p>
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
  q('#btnTestAlarm').onclick = () => { location.href = testAlarmUrl(); };
  q('#btnPreview').onclick = () => {
    unlockAudio();
    const now = new Date(); now.setHours(now.getHours() + 2, 0, 0, 0);
    const demo = { id: 'demo', date: todayStr(), time: `${String(now.getHours()).padStart(2, '0')}:00`, title: '打疫苗（示例）', category: 'vaccine', note: '带上疫苗本和医保卡', reminders: [] };
    if (now.getDate() !== new Date().getDate()) demo.time = '23:30';
    showAlarm({ rid: `demo-${uid()}`, eventId: 'demo', ev: demo, fireAt: Date.now(), label: '提前2小时提醒' });
  };
  q('#btnDisable').onclick = async () => { await disablePush(); toast('已关闭推送'); refreshStatus(q('#pushStatus')); };
  q('#scName').onchange = (e) => { store.updateSettings({ shortcutName: e.target.value.trim() || '宝宝闹钟' }); toast('已保存'); };
  q('#soundOn').onchange = (e) => store.updateSettings({ sound: e.target.checked });
  q('#pushApi').onchange = (e) => { store.updateSettings({ pushApi: e.target.value.trim() }); toast('已保存'); refreshStatus(q('#pushStatus')); };

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
