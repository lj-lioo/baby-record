// v1.7.0 自费疫苗「待定」目录：自费疫苗默认不排进日程；「➕ 加入计划」选第1剂日期后按说明书间隔自动生成全部剂次；
// 改了前面剂次的计划日/实际接种日时提示「后续剂次一起顺延」；可把整个系列移出计划（回到待定，已完成的剂次不动）。
import { store, uid } from '../store.js';
import { esc, openSheet, closeSheet, toast, confirmSheet } from '../ui.js';
import { todayStr, cnDate, weekday, addDays, parseYmd } from '../dates.js';
import { defaultReminders } from '../reminders.js';
import { SERIES, catalogEntries, seriesPlan, seriesStartInfo, seriesOfSid, reflowSeries, PAID_CATEGORY, PAID_DISCLAIMER } from '../paidvax.js';

const TIME = '09:00';
const BDAY_DEFAULT = '2026-09-17';
const bday = () => store.state.settings.babyBirthday || BDAY_DEFAULT;
const yr = (d) => d.slice(0, 4) !== todayStr().slice(0, 4);
const fmt = (d) => `${cnDate(d, yr(d))} ${weekday(d)}`;
const fmtS = (d) => cnDate(d, yr(d));
const doseLabel = (fam, n) => SERIES[fam].doses[n - 1].label || '单剂';
const famEvents = (fam) => store.events().filter((e) => { const s = seriesOfSid(e.scheduleId); return s && s.family === fam; });
const nOf = (e) => seriesOfSid(e.scheduleId)?.n || 0;
const rerender = () => window.dispatchEvent(new CustomEvent('rerender'));

// 从 from 之后（不含）的 n 个周末
function nextWeekend(from, n) {
  const out = [];
  for (let i = 1; i < 40 && out.length < n; i++) {
    const d = addDays(from, i), wd = parseYmd(d).getDay();
    if (wd === 6 || wd === 0) out.push(d);
  }
  return out;
}

// ———————————————— 目录 ————————————————
let cardOpen = false;        // 首页卡片是否展开
let openFam = null;          // 展开的条目

function entryHtml(x, all) {
  const { family: fam, S, f, info } = x;
  const nd = S.doses.length;
  const conflict = S.conflict && all.find((y) => y.family === S.conflict && y.inPlan) ? S.conflictText : '';
  const status = x.inPlan ? `<span class="pc-st in">已计划</span>` : x.doneN ? `<span class="pc-st done">已接种</span>` : '<span class="pc-st">待定</span>';
  const sub = x.inPlan ? `下一剂 ${fmtS(x.next.date)}${x.doneN ? ` · 已完成 ${x.doneN} 剂` : ''}`
    : x.doneN ? `已完成 ${x.doneN}/${nd} 剂` : `${nd > 1 ? `${nd}剂` : '单剂'} · 最早 ${fmtS(info.earliest)}`;
  const late = !x.inPlan && !x.doneN && info.latest && info.latest < todayStr();
  const body = x.doses.length
    ? `<ol class="pc-doses">${x.doses.map((e) => `<li class="${e.done ? 'done' : ''}"><b>${esc(doseLabel(fam, nOf(e)))}</b> ${esc(fmt(e.date))}${e.done ? ' ✅ 已完成' : ''}</li>`).join('')}</ol>
       ${x.inPlan ? `<button type="button" class="btn danger pc-rm" data-rm="${fam}">🗑 移出计划（回到待定）</button>` : '<p class="small muted" style="margin:6px 0 0">其余剂次已移出计划。需要时可用「＋ 添加」手动记录，或咨询接种门诊。</p>'}`
    : `<button type="button" class="btn pc-add" data-add="${fam}" ${late ? 'disabled' : ''}>➕ 加入计划</button>`;
  return `<details class="pc-item ${x.inPlan ? 'in' : ''}" data-fam="${fam}" ${openFam === fam ? 'open' : ''}>
    <summary><span class="pc-name">${esc(S.short || S.title)}</span>${status}<span class="pc-sub">${esc(sub)}</span></summary>
    <div class="pc-body">
      <div class="pc-row"><span class="pc-k">🛡 预防</span><span>${esc(S.prevents)}</span></div>
      <div class="pc-row"><span class="pc-k">💉 程序</span><span>${esc(S.schedule)}</span></div>
      <div class="pc-row"><span class="pc-k">🪟 第1剂</span><span>最早 <b>${esc(fmt(info.earliest))}</b>${info.latest ? ` · 最迟 <b>${esc(fmt(info.latest))}</b>` : ' · 未规定最迟'}${info.latestNote ? `<br><span class="muted">${esc(info.latestNote)}</span>` : ''}</span></div>
      <div class="pc-row"><span class="pc-k">🔁 可替代</span><span>${esc(S.replaces || '不替代免费疫苗')}</span></div>
      ${conflict ? `<p class="pd-warn" style="margin:6px 0">⚠️ ${esc(conflict)}</p>` : ''}
      ${late ? `<p class="pd-warn" style="margin:6px 0">⚠️ 已过第1剂最迟日期（${esc(fmtS(info.latest))}），请咨询接种门诊</p>` : ''}
      ${f.note ? `<details class="pc-more"><summary>详细说明</summary><p>${esc(f.note)}</p></details>` : ''}
      <p class="pc-disc">🏷 ${esc(PAID_DISCLAIMER)}（品牌/产品不同程序略有差异）</p>
      ${body}
    </div></details>`;
}

export function catalogHtml() {
  const all = catalogEntries(bday(), todayStr(), store.events());
  const planned = all.filter((x) => x.doses.length);
  const main = all.filter((x) => !x.doses.length && x.S.group === 'main');
  const alt = all.filter((x) => !x.doses.length && x.S.group === 'alt');
  return `<div class="pc-list">
    ${planned.length ? `<div class="pc-group">✅ 已加入计划</div>${planned.map((x) => entryHtml(x, all)).join('')}` : ''}
    ${main.length ? `<div class="pc-group">常用自费疫苗</div>${main.map((x) => entryHtml(x, all)).join('')}` : ''}
    ${alt.length ? `<div class="pc-group">备选（替代免费疫苗，或不打五联时）</div>${alt.map((x) => entryHtml(x, all)).join('')}` : ''}
  </div>`;
}
export function catalogCounts() {
  const all = catalogEntries(bday(), todayStr(), store.events());
  return { undecided: all.filter((x) => !x.doses.length).length, planned: all.filter((x) => x.inPlan).length, doses: all.reduce((n, x) => n + x.pendingN, 0) };
}

function bindCatalog(root, again) {
  root.querySelectorAll('.pc-item').forEach((d) => {
    d.addEventListener('toggle', () => { if (d.open) openFam = d.dataset.fam; else if (openFam === d.dataset.fam) openFam = null; });
  });
  root.querySelectorAll('[data-add]').forEach((b) => { b.onclick = (ev) => { ev.preventDefault(); openSeriesPicker(b.dataset.add, again); }; });
  root.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = (ev) => { ev.preventDefault(); removeSeries(b.dataset.rm, again); }; });
}

// 首页：月列表下方的可折叠卡片
export function renderPaidCard(el) {
  const c = catalogCounts();
  el.innerHTML = `
    <button type="button" class="pc-toggle" id="pcToggle" aria-expanded="${cardOpen}">
      <span class="pc-t">💰 自费疫苗（待定）</span>
      <span class="pc-count">${c.undecided} 种待定${c.planned ? ` · ${c.planned} 种已计划` : ''}</span><span class="pc-chev">${cardOpen ? '▴' : '▾'}</span></button>
    ${cardOpen ? `<div class="pc-wrap"><p class="small muted" style="margin:8px 0 4px">自费疫苗<b>默认不排进日程</b>。决定要打哪种，点开后「➕ 加入计划」，会按说明书的间隔和月龄排好全部剂次。</p>
      ${catalogHtml()}</div>` : ''}`;
  el.querySelector('#pcToggle').onclick = () => { cardOpen = !cardOpen; renderPaidCard(el); if (cardOpen) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  if (cardOpen) bindCatalog(el, null);
}

// 设置 → 一键生成日程 → 「💰 自费疫苗（待定）」
export function openPaidCatalog() {
  openSheet(`
    <h3>💰 自费疫苗（待定）</h3>
    <p class="small muted" style="margin-top:0">自费疫苗自愿接种，<b>默认不排进日程</b>。决定要打哪种，点开后「➕ 加入计划」，选第1剂日期，后面的剂次按说明书的最短间隔和月龄自动排好。<b>RSV单抗</b>已按你的选择加入计划。</p>
    <div id="pcSheetBody">${catalogHtml()}</div>
    <p class="note small">⚠️ ${esc(PAID_DISCLAIMER)}。含免费疫苗成分的（如五联含百白破、脊灰）按说明书接种后可替代相应免费剂次，免费事项上会提示「可不打此剂」，不会自动删除。不同疫苗可同一天在不同部位接种；两种注射类活疫苗（如麻腮风、水痘）不同天接种须间隔≥28天。</p>
    <button type="button" class="btn ghost block" id="pcClose">关闭</button>`, (s) => {
    s.dataset.kind = 'paidcat';
    bindCatalog(s, openPaidCatalog);
    s.querySelector('#pcClose').onclick = closeSheet;
  });
}

// ———————————————— 加入计划：选第1剂日期 + 预览全部剂次 ————————————————
export function openSeriesPicker(fam, back = null) {
  const S = SERIES[fam];
  const b = bday(), today = todayStr();
  const info = seriesStartInfo(fam, b, today);
  const base = info.def;
  const chips = [...new Set([...(info.earliest >= today ? [info.earliest] : []), ...(info.def !== info.earliest ? [info.def] : []), ...nextWeekend(addDays(base, -1), 4)])]
    .filter((d) => d >= info.earliest).sort().slice(0, 5);
  openSheet(`
    <h3>➕ 加入计划：${esc(S.short || S.title)}</h3>
    <p class="small muted" style="margin:0 0 8px">${esc(S.schedule)}</p>
    <div class="pd-win">🪟 第1剂：<b>最早 ${esc(fmt(info.earliest))}</b>${info.latest ? ` – <b>最迟 ${esc(fmt(info.latest))}</b>` : ' 起（未规定最迟）'}</div>
    <div class="row2" style="margin-top:10px">
      <div class="field"><label for="sp-date">第1剂计划日期</label><input id="sp-date" type="date" class="input" value="${esc(info.def)}" min="${info.earliest}"></div>
      <div class="field"><label for="sp-time">时间</label><input id="sp-time" type="time" class="input" value="${TIME}"></div>
    </div>
    <div class="quick" id="sp-chips" style="margin:-6px 0 10px">${chips.map((d) => `<button type="button" data-d="${d}">${d === info.earliest ? '最早 ' : ''}${esc(fmt(d))}</button>`).join('')}</div>
    <div id="sp-warn"></div>
    <div class="flabel" id="sp-head"></div>
    <ol class="sp-list" id="sp-list"></ol>
    <p class="small muted" style="margin:4px 0 8px">后面剂次：计划日＝max(推荐月龄, 上一剂＋推荐间隔)，最早日＝上一剂＋最短间隔（且不早于最小月龄）。每剂提醒前一天 20:00、当天 08:00；之后可逐剂「📆 改计划日」。</p>
    ${S.replaces ? `<p class="note small" style="margin:0 0 8px">🔁 可替代${esc(S.replaces)}：免费事项上会提示「可不打此剂」，不会自动删除，以门诊为准。</p>` : ''}
    <div class="btn-row">
      <button type="button" class="btn ghost" id="sp-cancel">${back ? '返回' : '取消'}</button>
      <button type="button" class="btn" id="sp-ok">加入计划</button>
    </div>`, (s) => {
    s.dataset.kind = 'series';
    const q = (sel) => s.querySelector(sel);
    let plan = [];
    const render = () => {
      const d = q('#sp-date').value;
      const early = d && d < info.earliest, lateD = d && info.latest && d > info.latest;
      q('#sp-warn').innerHTML = !d ? '<p class="bad small">请选择日期</p>'
        : early ? `<p class="pd-bad">⛔ 早于最早接种日（${esc(fmt(info.earliest))}），门诊不能提前接种。请选 ${esc(fmt(info.earliest))} 或之后。</p>`
          : lateD ? `<p class="pd-warn">⚠️ 晚于第1剂最迟日期（${esc(fmt(info.latest))}）${info.latestNote ? `：${esc(info.latestNote)}` : ''}，请先咨询接种门诊。</p>`
            : '<p class="ok small" style="margin:0 0 8px">✓ 在第1剂窗口内</p>';
      plan = d && !early ? seriesPlan(fam, b, d) : [];
      q('#sp-head').textContent = plan.length ? `将添加 ${plan.length} 剂：` : '';
      q('#sp-list').innerHTML = plan.map((x) => `<li class="sp-dose ${x.latest && x.date > x.latest ? 'is-late' : ''}"><b>${esc(doseLabel(fam, x.n))}</b> ${esc(fmt(x.date))}
        <span class="sp-meta">${x.n > 1 && x.earliest !== x.date ? `最早 ${esc(fmtS(x.earliest))}` : x.n > 1 ? '＝最早可接种日' : ''}${x.latest ? `${x.n > 1 ? ' · ' : ''}最迟 ${esc(fmtS(x.latest))}` : ''}</span>
        ${x.latest && x.date > x.latest ? '<span class="sp-late">⚠️ 晚于最迟</span>' : ''}</li>`).join('');
      q('#sp-ok').disabled = !plan.length;
      q('#sp-ok').textContent = plan.length ? `加入计划（${plan.length}剂）` : '加入计划';
      s.querySelectorAll('#sp-chips button').forEach((c) => c.classList.toggle('on', c.dataset.d === d));
    };
    q('#sp-date').oninput = render; q('#sp-date').onchange = render;
    s.querySelectorAll('#sp-chips button').forEach((c) => { c.onclick = () => { q('#sp-date').value = c.dataset.d; render(); }; });
    q('#sp-cancel').onclick = () => (back ? back() : closeSheet());
    q('#sp-ok').onclick = () => {
      if (!plan.length) return;
      const time = q('#sp-time').value || '';
      const list = plan.map((x) => ({
        id: uid(), date: x.date, time, title: x.title, category: PAID_CATEGORY, note: x.note, done: false,
        reminders: defaultReminders(false), scheduleId: x.scheduleId,
        earliest: x.earliest, latest: x.latest || '', windowNote: x.windowNote || '',
      }));
      if (!store.state.settings.babyBirthday) store.updateSettings({ babyBirthday: b });
      const added = store.addEvents(list);
      closeSheet();
      openFam = fam;
      toast(`已加入计划：${S.short || S.title} ${added.length} 剂，第1剂 ${cnDate(plan[0].date)} ${weekday(plan[0].date)}`, 3500);
      window.dispatchEvent(new CustomEvent('select-date', { detail: plan[0].date }));
      if (!/^#\/?(home)?$/.test(location.hash)) location.hash = '#/';
      setTimeout(() => document.getElementById(`g-${plan[0].date}`)?.scrollIntoView({ block: 'start' }), 80); // 跳到第1剂那天
    };
    render();
  });
}

// ———————————————— 移出计划（回到待定） ————————————————
export async function removeSeries(fam, back = null) {
  const S = SERIES[fam];
  const evs = famEvents(fam);
  const pending = evs.filter((e) => !e.done), doneN = evs.length - pending.length;
  if (!pending.length) return;
  const alarmN = pending.filter((e) => e.alarmAdded).length;
  const ok = await confirmSheet(`把「${S.short || S.title}」移出计划？将删除 ${pending.length} 个未完成的剂次${doneN ? `（已完成的 ${doneN} 剂保留）` : ''}，回到「待定」。${alarmN ? `其中 ${alarmN} 剂设过 iPhone 闹钟，请到「提醒事项」App 删掉。` : ''}`, '移出计划', true);
  if (!ok) { if (back) back(); return; }
  store.deleteEvents(pending.map((e) => e.id));
  toast(`已把${S.short || S.title}移出计划（${pending.length} 剂），回到待定`, 3000);
  if (back) back();
}

// ———————————————— 顺延后续剂次 ————————————————
// 某剂的计划日/实际接种日变了之后调用：后面未完成的剂次需要变时弹出「后续剂次一起顺延」
export function maybeCascade(id) {
  const ev = store.getEvent(id);
  const s = ev && seriesOfSid(ev.scheduleId);
  if (!s || SERIES[s.family].doses.length < 2) return false;
  const changes = reflowSeries(s.family, bday(), famEvents(s.family), s.n, ev.date);
  if (!changes.length) return false;
  // 不顺延时：计划日不变，按实际的上一剂日期重算最早/最迟
  const keep = reflowSeries(s.family, bday(), famEvents(s.family), s.n, ev.date, { keepDates: true });
  const windowOnly = () => keep.map((c) => ({ ...store.getEvent(c.ev.id), earliest: c.earliest, latest: c.latest }));
  const moved = changes.filter((c) => c.dateChanged);
  if (!moved.length) { store.upsertEvents(windowOnly()); return false; } // 只是最早/最迟变了：直接更新窗口
  openSheet(`
    <h3>⏩ 后续剂次一起顺延？</h3>
    <p class="small" style="margin-top:0"><b>${esc(ev.title)}</b>${ev.done ? '实际接种日' : '计划日'}改为 <b>${esc(fmt(ev.date))}</b>。按最短间隔和推荐月龄，后面未完成的剂次建议改为：</p>
    <ul class="cc-list">${moved.map((c) => `<li><b>${esc(doseLabel(s.family, c.n))}</b> <span class="cc-old">${esc(fmtS(c.ev.date))}</span> → <b class="cc-new">${esc(fmt(c.date))}</b>
      <span class="sp-meta">最早 ${esc(fmtS(c.earliest))}${c.latest ? ` · 最迟 ${esc(fmtS(c.latest))}` : ''}</span>
      ${c.latest && c.date > c.latest ? '<span class="sp-late">⚠️ 晚于最迟</span>' : ''}${c.ev.alarmAdded ? '<span class="cc-alarm">⏰ 顺延后需重设闹钟</span>' : ''}</li>`).join('')}</ul>
    <p class="small muted">已完成的剂次不会改动。不顺延也会按新的日期更新后面剂次的「最早」日期。</p>
    <div class="btn-row">
      <button type="button" class="btn ghost" id="cc-no">保持原计划</button>
      <button type="button" class="btn" id="cc-yes">后续剂次一起顺延</button>
    </div>`, (sh) => {
    sh.dataset.kind = 'cascade';
    sh.querySelector('#cc-no').onclick = () => { store.upsertEvents(windowOnly()); closeSheet(); };
    sh.querySelector('#cc-yes').onclick = () => {
      store.upsertEvents(changes.map((c) => ({ ...store.getEvent(c.ev.id), date: c.date, earliest: c.earliest, latest: c.latest })));
      closeSheet();
      const al = moved.filter((c) => c.ev.alarmAdded).length;
      toast(`已顺延 ${moved.length} 剂${al ? `，其中 ${al} 剂需重设闹钟` : ''}`, 3000);
      rerender();
    };
  });
  return true;
}

// ———————————————— 标记已完成（系列剂次可填实际接种日） ————————————————
export function markDone(id) {
  const ev = store.getEvent(id);
  const s = ev && seriesOfSid(ev.scheduleId);
  const later = s ? famEvents(s.family).filter((e) => !e.done && nOf(e) > s.n) : [];
  if (!later.length) { store.setDone(id, true); toast('已标记为已完成 ✅'); return; }
  const today = todayStr();
  openSheet(`
    <h3>✅ 标记已完成</h3>
    <p style="margin:0 0 8px;font-weight:700">${esc(ev.title)}</p>
    <div class="field"><label for="dn-date">实际接种日期</label><input id="dn-date" type="date" class="input" value="${ev.date <= today ? ev.date : today}" max="${today}"></div>
    <p class="small muted" style="margin:-4px 0 10px">计划日是 ${esc(fmt(ev.date))}。实际接种日和计划日不同的话，会提示把后面 ${later.length} 剂一起顺延。</p>
    <div class="btn-row">
      <button type="button" class="btn ghost" id="dn-cancel">取消</button>
      <button type="button" class="btn" id="dn-ok">确认已完成</button>
    </div>`, (sh) => {
    sh.dataset.kind = 'done';
    sh.querySelector('#dn-cancel').onclick = closeSheet;
    sh.querySelector('#dn-ok').onclick = () => {
      const date = sh.querySelector('#dn-date').value || ev.date;
      const cur = store.getEvent(id);
      store.upsertEvent({ ...cur, done: true, date });
      closeSheet();
      toast('已标记为已完成 ✅');
      if (date !== cur.date) maybeCascade(id);
    };
  });
}
