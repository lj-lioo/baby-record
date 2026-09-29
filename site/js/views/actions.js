// 事项操作：设为 iPhone 闹钟提醒（快捷指令 → 紧急提醒事项）
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { fmtDateTime } from '../dates.js';
import { futureAlarms, alarmTitle, alarmUrl, alarmSig, shortcutName } from '../shortcuts.js';
import { store } from '../store.js';

export function alarmState(ev) {
  if (!ev.alarmAdded) return 'none';
  return ev.alarmSig && ev.alarmSig !== alarmSig(ev) ? 'changed' : 'added';
}

export function openAlarmSheet(ev) {
  const list = futureAlarms(ev);
  const st = alarmState(ev);
  openSheet(`
    <h3>⏰ 设为 iPhone 闹钟提醒</h3>
    <p class="small" style="margin-top:0">将打开「快捷指令」运行「<b>${esc(shortcutName())}</b>」，在「提醒事项」的 <b>宝宝</b> 列表里为下面每个时间新建一条 <b>紧急</b> 提醒。到点时 iPhone 会像闹钟一样全屏响铃（静音和专注模式下也会响），并显示标题。</p>
    ${st === 'added' ? '<p class="note">✅ 这个事项已经设置过闹钟了。再点一次会<b>重复添加</b>。</p>' : ''}
    ${st === 'changed' ? '<p class="note">⚠️ 设置闹钟之后你修改过提醒时间或标题。建议先在「提醒事项」App 里删除旧的，再重新设置。</p>' : ''}
    ${list.length ? `<div class="preview" style="margin-bottom:12px">${list.map((x) => `<div>🔔 <b>${esc(fmtDateTime(x.fireAt))}</b> · ${esc(x.label)}<br><span class="muted">${esc(alarmTitle(ev, x.fireAt))}</span></div>`).join('')}</div>
      <a class="btn block" id="al-go" style="text-decoration:none" href="${esc(alarmUrl(ev))}">打开快捷指令，创建 ${list.length} 个闹钟提醒</a>`
      : '<p class="note">这个事项没有未来的提醒时间。请先点「编辑」设置提醒时间。</p>'}
    <label class="kv" style="margin-top:12px"><span>已设为闹钟（避免重复添加）</span><input type="checkbox" id="al-added" ${ev.alarmAdded ? 'checked' : ''}></label>
    <p class="small muted">第一次使用？需要 iOS 26.4 以上，并先按 <a href="#/help" id="al-help">帮助页的步骤</a> 创建一次快捷指令。旧版 iOS 可改用「📅 添加到苹果日历」。</p>
    <button class="btn ghost block" id="al-close">关闭</button>`, (s) => {
    const go = s.querySelector('#al-go');
    if (go) go.addEventListener('click', () => {
      store.setAlarmAdded(ev.id, true, alarmSig(ev));
      s.querySelector('#al-added').checked = true;
      toast('已标记为「已设闹钟」。如果快捷指令没有成功，可以取消勾选', 3500);
    });
    s.querySelector('#al-added').onchange = (e) => store.setAlarmAdded(ev.id, e.target.checked, alarmSig(store.getEvent(ev.id)));
    s.querySelector('#al-close').onclick = closeSheet;
    s.querySelector('#al-help').onclick = () => { closeSheet(); setTimeout(() => document.getElementById('h-shortcut')?.scrollIntoView(), 300); };
  });
}
