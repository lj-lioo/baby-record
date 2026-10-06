// 事项操作：设为 iPhone 闹钟提醒（快捷指令 → 紧急提醒事项）
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { fmtDateTime } from '../dates.js';
import { futureAlarms, alarmTitle, alarmUrl, alarmSig, shortcutName, deleteShortcutName, deleteAlarmUrl } from '../shortcuts.js';
import { store } from '../store.js';

export function alarmState(ev) {
  if (!ev.alarmAdded) return 'none';
  return ev.alarmSig && ev.alarmSig !== alarmSig(ev) ? 'changed' : 'added';
}

const MANUAL_DEL = '打开「提醒事项」→ 点「宝宝」列表 → 在旧提醒上向左轻扫 → 点「删除」';

export function openAlarmSheet(ev) {
  const list = futureAlarms(ev);
  const st = alarmState(ev);
  const tagged = ev.alarmAdded && ev.alarmTagged;
  const dn = esc(deleteShortcutName());
  openSheet(`
    <h3>⏰ 设为 iPhone 闹钟提醒</h3>
    <p class="small" style="margin-top:0">将打开「快捷指令」运行「<b>${esc(shortcutName())}</b>」，在「提醒事项」的 <b>宝宝</b> 列表里为下面每个时间新建一条 <b>紧急</b> 提醒。到点时 iPhone 会像闹钟一样全屏响铃（静音和专注模式下也会响），并显示标题。</p>
    ${st === 'added' ? `<p class="note">✅ 这个事项已经设置过闹钟了。${tagged ? `再点一次会<b>先删除旧的</b>再新建（需要已按帮助页「新增」步骤更新快捷指令；没更新的话会重复）。` : `这个闹钟是 v1.7.1 之前设置的，没有标记：再点一次会<b>重复添加</b>，请先手动删除旧的（${MANUAL_DEL}）。`}</p>` : ''}
    ${st === 'changed' ? `<p class="note">⚠️ 设置闹钟之后你修改过提醒时间或标题，旧的闹钟提醒还在。${tagged ? `点下面的按钮会<b>先自动删除旧的</b>，再按新时间创建（需要已按帮助页「新增」步骤更新快捷指令）。` : `旧闹钟是 v1.7.1 之前设置的，没有标记，不能自动删除：请先手动删除（${MANUAL_DEL}），再重新设置。`}</p>` : ''}
    ${list.length ? `<div class="preview" style="margin-bottom:12px">${list.map((x) => `<div>🔔 <b>${esc(fmtDateTime(x.fireAt))}</b> · ${esc(x.label)}<br><span class="muted">${esc(alarmTitle(ev, x.fireAt))}</span></div>`).join('')}</div>
      <a class="btn block" id="al-go" style="text-decoration:none" href="${esc(alarmUrl(ev))}">${tagged ? `打开快捷指令，替换为 ${list.length} 个新闹钟提醒` : `打开快捷指令，创建 ${list.length} 个闹钟提醒`}</a>`
      : '<p class="note">这个事项没有未来的提醒时间。请先点「编辑」设置提醒时间。</p>'}
    ${tagged ? `<a class="btn secondary block" id="al-del" style="text-decoration:none;margin-top:8px" href="${esc(deleteAlarmUrl([ev]))}">🗑 删除旧闹钟</a>
      <p class="small muted" style="margin:4px 0 0">运行「${dn}」，删除「宝宝」列表里这个事项的全部闹钟提醒（不新建）。</p>` : ''}
    <label class="kv" style="margin-top:12px"><span>已设为闹钟（避免重复添加）</span><input type="checkbox" id="al-added" ${ev.alarmAdded ? 'checked' : ''}></label>
    <p class="small muted">第一次使用？需要 iOS 26.2 以上，并先按 <a href="#/help" id="al-help">帮助页的步骤</a> 创建一次快捷指令。旧版 iOS 可改用「📅 添加到苹果日历」。</p>
    <button class="btn ghost block" id="al-close">关闭</button>`, (s) => {
    s.dataset.kind = 'alarm';
    const go = s.querySelector('#al-go');
    if (go) go.addEventListener('click', () => {
      store.setAlarmAdded(ev.id, true, alarmSig(ev), true);
      s.querySelector('#al-added').checked = true;
      toast('已标记为「已设闹钟」。如果快捷指令没有成功，可以取消勾选', 3500);
    });
    const del = s.querySelector('#al-del');
    if (del) del.addEventListener('click', () => {
      store.setAlarmAdded(ev.id, false);
      s.querySelector('#al-added').checked = false;
      toast('已取消「已设闹钟」标记。如果快捷指令没有成功，请到「提醒事项」手动删除', 3500);
    });
    s.querySelector('#al-added').onchange = (e) => store.setAlarmAdded(ev.id, e.target.checked, alarmSig(store.getEvent(ev.id)));
    s.querySelector('#al-close').onclick = closeSheet;
    s.querySelector('#al-help').onclick = () => { closeSheet(); setTimeout(() => document.getElementById('h-shortcut')?.scrollIntoView(), 300); };
  });
}

// v1.7.1：删除事项 / 移出计划之后，如果这些事项设过闹钟，提醒「提醒事项」里的旧闹钟还在，并提供「🗑 删除旧闹钟」
// evs：删除前的事项副本。没有设过闹钟的不提示，返回 false。
export function offerOldAlarmCleanup(evs, what = '事项已删除', after = null) {
  const list = evs.filter((e) => e && e.alarmAdded);
  if (!list.length) return false;
  const tagged = list.filter((e) => e.alarmTagged), legacy = list.filter((e) => !e.alarmTagged);
  const done = () => { closeSheet(); if (after) after(); };
  openSheet(`
    <h3>🗑 删除旧闹钟？</h3>
    <p class="note">${esc(what)}，但之前用快捷指令建的闹钟提醒还在「提醒事项」→「宝宝」里，<b>到点还会响</b>。</p>
    ${tagged.length ? `<a class="btn block" id="oc-go" style="text-decoration:none" href="${esc(deleteAlarmUrl(tagged))}">🗑 删除旧闹钟（${tagged.length} 个事项）</a>
      <p class="small muted" style="margin:4px 0 8px">运行「${esc(deleteShortcutName())}」（按帮助页「新增」步骤创建），删除这些事项的全部闹钟提醒。</p>` : ''}
    ${legacy.length ? `<p class="small">${tagged.length ? '下面' : ''}这些闹钟是 v1.7.1 之前设置的，没有标记，不能自动删除，请手动删除：${esc(MANUAL_DEL)}。</p>
      <ul class="small">${legacy.map((e) => `<li>${esc(e.title)}</li>`).join('')}</ul>` : ''}
    <button class="btn ghost block" id="oc-no">${tagged.length ? '不用了' : '知道了'}</button>`, (s) => {
    s.dataset.kind = 'alarmclean';
    const go = s.querySelector('#oc-go');
    if (go) go.addEventListener('click', () => setTimeout(done, 300));
    s.querySelector('#oc-no').onclick = done;
  });
  return true;
}
