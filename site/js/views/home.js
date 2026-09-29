// 首页：醒目的近期提醒卡片 + 月历（含接种窗口）+ 本月全部事项（按计划日期分组）
import { store } from '../store.js';
import { CATEGORIES } from '../categories.js';
import { todayStr, addDays, ymd, parseYmd, cnDate, weekday, countdown, pad } from '../dates.js';
import { fireAtOf, reminderLabel } from '../reminders.js';
import { esc, toast } from '../ui.js';
import { openEditor } from './editor.js';
import { openAlarmSheet, alarmState } from './actions.js';
import { openICS } from '../ics.js';
import { isStandalone, isIOS } from '../push.js';
import { openVaxPlan, openCheckupPlan, planCounts } from './vaxplan.js';
import { openPlannedSheet } from './planned.js';
import { windowOf, windowStatus, planOutside } from '../windows.js';

const ui = { month: null, selected: null, focus: null, scrollTo: null };

export function renderHome(root) {
  const today = todayStr();
  if (!ui.selected) ui.selected = today;
  if (!ui.month) ui.month = ui.selected.slice(0, 7);

  root.innerHTML = `
    <header class="topbar">
      <div class="logo"><img src="icons/icon-192.png" alt=""><div><h1>宝宝记录</h1><div class="sub">${cnDate(today, true)} ${weekday(today)}</div></div></div>
    </header>
    <div id="pushBanner"></div>
    <div id="vaxCta"></div>
    <section class="card remind-card" id="remindCard"></section>
    <section class="card" id="calCard"></section>
    <section class="card" id="dayCard"></section>
    <button class="fab" id="fab" aria-label="添加事项">＋</button>`;

  renderReminderCard(root.querySelector('#remindCard'));
  renderCalendar(root.querySelector('#calCard'));
  renderMonthList(root.querySelector('#dayCard'));
  renderPushBanner(root.querySelector('#pushBanner'));
  renderVaxCta(root.querySelector('#vaxCta'));
  root.querySelector('#fab').onclick = () => openEditor({ date: ui.selected });
  if (ui.scrollTo) {
    const g = root.querySelector(`#g-${ui.scrollTo}`);
    ui.scrollTo = null;
    if (g) { g.classList.add('flash'); requestAnimationFrame(() => g.scrollIntoView({ behavior: 'smooth', block: 'start' })); setTimeout(() => g.classList.remove('flash'), 1600); }
  }
}

export function selectDate(d) { ui.selected = d; ui.month = d.slice(0, 7); }

function renderReminderCard(el) {
  const today = todayStr();
  const end = addDays(today, 7);
  const overdueFrom = addDays(today, -30);
  const items = store.events()
    .filter((e) => (e.date >= today && e.date <= end && !e.done) || (e.date < today && e.date >= overdueFrom && !e.done && e.category !== 'other'))
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  const urgent = items.some((e) => e.date <= today);
  el.classList.toggle('has-urgent', urgent);
  el.innerHTML = `
    <h2>🔔 近期提醒 <span class="muted small" style="font-weight:500">今天 ~ 未来7天</span></h2>
    ${items.length ? `<ul class="rlist">${items.map((e) => {
      const c = CATEGORIES[e.category], cd = countdown(e.date);
      const past = e.date < today;
      return `<li class="ritem lvl-${cd.level}" data-id="${e.id}">
        <div class="ricon" style="background:var(--${e.category}-soft)">${c.icon}</div>
        <div class="rbody"><div class="rtitle">${esc(e.title)}</div>
          <div class="rmeta">${cnDate(e.date)} ${weekday(e.date)}${e.time ? ' ' + e.time : ''} · ${c.label}${nextRemText(e)}${!past ? alarmMini(e) : ''}</div></div>
        ${past || cd.level === 'today' ? `<button class="mini-btn" data-done="${e.id}">${past ? '已完成?' : '完成'}</button>` : ''}
        <span class="pill lvl-${cd.level}">${cd.text}</span>
      </li>`;
    }).join('')}</ul>` : '<div class="empty">🎈 未来7天没有安排，好好陪宝宝玩吧～</div>'}`;
  el.querySelectorAll('.ritem').forEach((li) => {
    li.onclick = (ev) => {
      if (ev.target.closest('[data-done]')) return;
      const e = store.getEvent(li.dataset.id);
      selectDate(e.date);
      window.dispatchEvent(new CustomEvent('rerender'));
      openEditor({ id: e.id });
    };
  });
  el.querySelectorAll('[data-done]').forEach((b) => {
    b.onclick = () => { store.setDone(b.dataset.done, true); toast('已标记为已完成 ✅'); };
  });
}

function alarmBtn(e) {
  const st = alarmState(e);
  if (st === 'added') return '<button class="chip-btn alarm-btn added" data-act="alarm">✅ 已设闹钟</button>';
  if (st === 'changed') return '<button class="chip-btn alarm-btn warn" data-act="alarm">⚠️ 时间已改，重设闹钟</button>';
  return '<button class="chip-btn alarm-btn" data-act="alarm">⏰ 设为闹钟提醒</button>';
}
function alarmMini(e) {
  const st = alarmState(e);
  return st === 'added' ? ' · <span class="ok">已设闹钟</span>' : st === 'changed' ? ' · <span class="bad">需重设闹钟</span>' : ' · <span class="bad">未设闹钟</span>';
}

function nextRemText(e) {
  const now = Date.now();
  const next = (e.reminders || []).map((r) => fireAtOf(e, r)).filter((t) => t != null && t > now).sort((a, b) => a - b)[0];
  if (!next) return '';
  const d = new Date(next);
  return ` · ⏰${ymd(d) === todayStr() ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 日历：● 实心圆点 = 计划日；○ 空心圆点 = 最早可接种日（与计划日不同时）；
// 选中的事项（点某天或点卡片上的「🪟 窗口」）：窗口天数淡色底、最早日虚线圈、计划日实心、最迟日「止」。
function renderCalendar(el) {
  const [y, m] = ui.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(y, m - 1, 1 - startOffset);
  const today = todayStr();
  const bday = store.state.settings.babyBirthday;
  const byDate = {}, byEarly = {};
  for (const e of store.events()) {
    (byDate[e.date] ||= []).push(e);
    if (e.done) continue;
    const w = windowOf(e, bday);
    if (w && w.earliest !== e.date) (byEarly[w.earliest] ||= []).push(e);
  }
  const fe = ui.focus ? store.getEvent(ui.focus) : null;
  const fw = fe ? windowOf(fe, bday) : null;
  if (fe && !fw) ui.focus = null;
  const fcat = fe ? fe.category : '';
  const fEnd = fw ? (fw.latest || fw.earliest) : '';
  let cells = '';
  const rows = Math.ceil((startOffset + new Date(y, m, 0).getDate()) / 7);
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
    const ds = ymd(d);
    const evs = byDate[ds] || [];
    const early = byEarly[ds] || [];
    const hasV = evs.some((e) => e.category === 'vaccine' && !e.done);
    const hasP = !hasV && evs.some((e) => e.category === 'paidvax' && !e.done);
    const inWin = fw && ds >= fw.earliest && ds <= fEnd;
    const cls = ['day', d.getMonth() !== m - 1 ? 'other-month' : '', ds === today ? 'today' : '', ds === ui.selected ? 'selected' : '', hasV ? 'has-vaccine' : '', hasP ? 'has-paidvax' : '',
      inWin ? `win win-${fcat}` : '', inWin && (ds === fw.earliest || d.getDay() === 0) ? 'win-s' : '', inWin && (ds === fEnd || d.getDay() === 6) ? 'win-e' : '',
      fw && ds === fw.earliest && ds !== fe.date ? `early-focus ef-${fcat}` : '', fe && ds === fe.date ? `plan-focus pf-${fcat}` : '', fw && fw.latest && ds === fw.latest ? 'late-focus' : ''].filter(Boolean).join(' ');
    const marks = [...evs.map((e) => `<i class="dot ${CATEGORIES[e.category].cls} ${e.done ? 'done' : ''}"></i>`), ...early.map((e) => `<i class="ring ${CATEGORIES[e.category].cls}" title="最早可接种"></i>`)].slice(0, 4).join('');
    const label = `${cnDate(ds)}${evs.length ? `，${evs.length}个事项` : ''}${early.length ? `，${early.length}个最早可接种` : ''}`;
    cells += `<button class="${cls}" data-date="${ds}" aria-label="${label}">
      ${hasV ? '<span class="vbadge">💉</span>' : hasP ? '<span class="vbadge paid">💰</span>' : ''}${fw && fw.latest && ds === fw.latest ? '<span class="lbadge">止</span>' : ''}<span class="num">${d.getDate()}</span><span class="dots">${marks}</span></button>`;
  }
  el.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" id="prevM" aria-label="上个月">‹</button>
      <div style="text-align:center"><div class="month">${y}年${m}月</div>${ui.month !== today.slice(0, 7) ? '<button class="today-btn" id="toToday">回到今天</button>' : ''}</div>
      <button class="icon-btn" id="nextM" aria-label="下个月">›</button>
    </div>
    <div class="weekdays">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div>${w}</div>`).join('')}</div>
    <div class="days">${cells}</div>
    <div class="legend"><span><i class="dot cat-vaccine"></i>疫苗</span><span><i class="dot cat-paidvax"></i>自费疫苗</span><span><i class="dot cat-checkup"></i>体检</span><span><i class="dot cat-other"></i>其他</span></div>
    <div class="legend2"><span><i class="dot" style="background:var(--muted)"></i>计划日</span><span><i class="ring" style="border-color:var(--muted)"></i>最早可接种</span><span><i class="band"></i>窗口</span><span><b class="lb-mini">止</b>最迟</span></div>
    ${fe ? `<div class="focus-bar ${CATEGORIES[fcat].cls}"><span class="fb-txt">🪟 <b>${esc(fe.title)}</b>：${esc(winText(fw))}</span><button class="fb-x" id="fbX" aria-label="取消显示窗口">✕</button></div>` : '<div class="focus-hint">点日期或卡片上的「🪟 窗口」，在日历上看窗口</div>'}`;
  el.querySelector('#prevM').onclick = () => shiftMonth(-1);
  el.querySelector('#nextM').onclick = () => shiftMonth(1);
  el.querySelector('#fbX')?.addEventListener('click', () => { ui.focus = null; rerender(); });
  const tt = el.querySelector('#toToday');
  if (tt) tt.onclick = () => { selectDate(todayStr()); rerender(); };
  el.querySelectorAll('.day').forEach((b) => {
    b.onclick = () => {
      const ds = b.dataset.date;
      if (ds === ui.selected && !store.eventsOn(ds).length && !(byEarly[ds] || []).length) { openEditor({ date: ds }); return; }
      ui.selected = ds;
      if (ds.slice(0, 7) !== ui.month) ui.month = ds.slice(0, 7);
      ui.focus = pickFocus(ds, byEarly[ds] || []);
      ui.scrollTo = ds;
      rerender();
    };
  });
}

// 点某天时选中显示窗口的事项：当天计划的第一个有窗口、未完成的事项；否则当天是其最早日的事项
function pickFocus(ds, early) {
  const bday = store.state.settings.babyBirthday;
  const cands = [...store.eventsOn(ds).filter((e) => !e.done), ...early]
    .map((e) => ({ e, w: windowOf(e, bday) })).filter((x) => x.w);
  if (!cands.length) return null;
  // 优先显示有「最迟日期」、且最迟日期最近的事项（窗口最有参考价值）
  cands.sort((a, b) => (a.w.latest || '9999').localeCompare(b.w.latest || '9999'));
  return cands[0].e.id;
}

const yr = (d) => d.slice(0, 4) !== todayStr().slice(0, 4);
const fmtD = (d) => `${cnDate(d, yr(d))} ${weekday(d)}`;
function winText(w) {
  return w.latest ? `${cnDate(w.earliest, yr(w.earliest))} – ${cnDate(w.latest, yr(w.latest) || w.latest.slice(0, 4) !== w.earliest.slice(0, 4))}（最迟）` : `${cnDate(w.earliest, yr(w.earliest))} 起（未规定最迟）`;
}

function shiftMonth(n) {
  const [y, m] = ui.month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  rerender();
}
const rerender = () => window.dispatchEvent(new CustomEvent('rerender'));

function itemCard(e, today, bday) {
  const c = CATEGORIES[e.category];
  const w = windowOf(e, bday);
  const noun = e.category === 'checkup' ? '体检' : e.category === 'other' ? '' : '接种';
  const st = w ? windowStatus(e, w, today) : null;
  const out = w ? planOutside(e.date, w) : '';
  const overdue = !e.done && e.date < today;
  const rems = (e.reminders || []).map((r) => ({ at: fireAtOf(e, r), label: reminderLabel(r) })).filter((x) => x.at != null).sort((a, b) => a.at - b.at);
  const time = e.time || '全天';
  const plan = w
    ? (w.earliest === e.date ? `📅 计划 ${fmtD(e.date)} ${time}<span class="muted">（最早可${noun || '安排'}日）</span>` : `📅 最早 ${fmtD(w.earliest)} · <b>计划 ${fmtD(e.date)} ${time}</b>`)
    : `🕒 ${time}`;
  return `<div class="item ${c.cls} ${e.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${ui.focus === e.id ? 'is-focus' : ''}" data-id="${e.id}">
    <div class="irow"><span style="font-size:20px">${c.icon}</span><span class="ititle">${esc(e.title)}</span>
      ${e.done ? '<span class="tag done">已完成</span>' : overdue ? '<span class="tag overdue">已过期未完成</span>' : `<span class="tag ${c.cls}">${c.label}</span>`}</div>
    <div class="iplan">${plan}</div>
    ${w ? `<button type="button" class="iwin st-${st.key}" data-act="focus">🪟 ${noun}窗口${w.ref ? '（参考）' : ''}：${esc(winText(w))} · <b>${esc(st.text)}</b></button>` : ''}
    ${w && ui.focus === e.id && w.note ? `<div class="inote">ℹ️ ${esc(w.note)}</div>` : ''}
    ${out === 'early' ? `<div class="iwarn">⚠️ 计划日早于最早${noun}日，请改计划日</div>` : out === 'late' ? `<div class="iwarn">⚠️ 计划日晚于最迟日期（逾期补种）</div>` : ''}
    <div class="imeta">${e.note ? `📝 ${esc(e.note)}\n` : ''}${rems.length ? `⏰ ${rems.map((x) => esc(x.label)).join('、')}` : '⏰ 未设置提醒'}</div>
    <div class="iactions">
      ${e.done ? '' : alarmBtn(e)}
      ${!e.done && (w || e.category !== 'other') ? `<button class="chip-btn" data-act="plan">📆 改计划日</button>` : ''}
      <button class="chip-btn" data-act="edit">✏️ 编辑</button>
      <button class="chip-btn" data-act="ics">📅 苹果日历</button>
      ${e.done ? '<button class="chip-btn" data-act="undone">↩︎ 取消完成</button>' : '<button class="chip-btn done-btn" data-act="done">✅ 已完成</button>'}
    </div>
  </div>`;
}

// 日历下方：当前月份的全部事项，按计划日期分组；本月还会在最上面列出之前没完成的事项
function renderMonthList(el) {
  const today = todayStr();
  const bday = store.state.settings.babyBirthday;
  const [y, m] = ui.month.split('-').map(Number);
  const monthStart = `${ui.month}-01`, monthEnd = ymd(new Date(y, m, 0));
  const inMonth = store.events().filter((e) => e.date >= monthStart && e.date <= monthEnd);
  const byDate = {};
  for (const e of inMonth) (byDate[e.date] ||= []).push(e);
  const dates = Object.keys(byDate);
  if (ui.selected >= monthStart && ui.selected <= monthEnd && !byDate[ui.selected]) dates.push(ui.selected);
  dates.sort();
  const sortT = (a, b) => (a.time || '99').localeCompare(b.time || '99');
  const earlier = today.slice(0, 7) === ui.month
    ? store.events().filter((e) => !e.done && e.date < monthStart && (e.category !== 'other' || e.date >= addDays(today, -30))).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  el.innerHTML = `
    <div class="day-panel-head">
      <h2 style="margin:0">📋 ${m}月的事项 <span class="muted small" style="font-weight:500">共 ${inMonth.length} 个</span></h2>
      <button class="btn secondary" id="addHere" style="padding:8px 14px;font-size:15px">＋ 添加</button>
    </div>
    ${earlier.length ? `<div class="grp grp-overdue" id="g-earlier"><div class="grp-head"><h2>⚠️ 之前未完成 <span class="pill lvl-overdue" style="animation:none">${earlier.length} 个</span></h2></div>
      ${earlier.map((e) => `<div class="grp-sub">${esc(fmtD(e.date))}</div>${itemCard(e, today, bday)}`).join('')}</div>` : ''}
    ${dates.length ? dates.map((ds) => {
      const cd = countdown(ds);
      const list = (byDate[ds] || []).sort(sortT);
      return `<div class="grp ${ds === ui.selected ? 'sel' : ''}" id="g-${ds}" data-date="${ds}">
        <div class="grp-head"><h2>${cnDate(ds)} ${weekday(ds)} <span class="pill lvl-${cd.level}" style="animation:none">${cd.text}</span></h2>
          ${list.length ? '' : `<button class="link-btn" data-add="${ds}">＋ 添加</button>`}</div>
        ${list.length ? list.map((e) => itemCard(e, today, bday)).join('') : '<p class="muted small" style="margin:4px 0 2px">这一天还没有安排。</p>'}
      </div>`;
    }).join('') : `<p class="muted" style="margin:12px 0 2px">这个月还没有安排。点「＋ 添加」记录疫苗、体检等事项。</p>`}`;
  el.querySelector('#addHere').onclick = () => openEditor({ date: ui.selected >= monthStart && ui.selected <= monthEnd ? ui.selected : (today.slice(0, 7) === ui.month ? today : monthStart) });
  el.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => openEditor({ date: b.dataset.add }); });
  el.querySelectorAll('.item').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const e = store.getEvent(id);
        const act = b.dataset.act;
        if (act === 'edit') openEditor({ id });
        else if (act === 'ics') openICS(e);
        else if (act === 'alarm') openAlarmSheet(e);
        else if (act === 'plan') openPlannedSheet(e);
        else if (act === 'focus') {
          ui.focus = ui.focus === id ? null : id;
          rerender();
          if (ui.focus) document.getElementById('calCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        else if (act === 'done') { store.setDone(id, true); toast('已标记为已完成 ✅'); }
        else if (act === 'undone') store.setDone(id, false);
      };
    });
  });
}

async function renderPushBanner(el) {
  if (localStorage.getItem('babyrecord.hideBanner') === '1') { el.innerHTML = ''; return; }
  const msg = isIOS() && !isStandalone()
    ? '<b>第一步：添加到主屏幕</b>Safari 分享按钮 → 添加到主屏幕；然后设置一次「宝宝闹钟」快捷指令'
    : '<b>设置一次「宝宝闹钟」快捷指令</b>之后每个事项点「⏰ 设为闹钟提醒」，到点像闹钟一样响';
  el.innerHTML = `<div class="banner"><span style="font-size:28px">🔔</span><div class="bt">${msg}</div>
    <a class="btn" style="padding:8px 12px;font-size:14px;text-decoration:none" href="#/help">看步骤</a>
    <button class="x-btn" style="width:30px;height:30px;font-size:14px;background:transparent" aria-label="关闭">✕</button></div>`;
  el.querySelector('.x-btn').onclick = () => { localStorage.setItem('babyrecord.hideBanner', '1'); el.innerHTML = ''; };
}
// 还没有生成疫苗/体检计划时，在首页提示「一键生成」
function renderVaxCta(el) {
  const needV = !planCounts('vaccine') && localStorage.getItem('babyrecord.hideVaxCta') !== '1';
  const needC = !planCounts('checkup') && localStorage.getItem('babyrecord.hideChkCta') !== '1';
  if (!needV && !needC) { el.innerHTML = ''; return; }
  const head = needV && needC ? '<b>一键生成疫苗/体检计划</b>输入宝宝生日，按国家规范自动添加全部免费疫苗和儿保体检日程'
    : needV ? '<b>一键生成疫苗计划</b>输入宝宝生日，按国家免疫程序自动添加全部免费疫苗日程'
      : '<b>一键生成体检计划</b>输入宝宝生日，按国家儿童健康管理规范自动添加儿保体检日程';
  el.innerHTML = `<div class="banner" style="border-color:#C9BDFF"><span style="font-size:28px">${needV ? '💉' : '🩺'}</span><div class="bt">${head}
    <div class="cta-btns">${needV ? '<button class="btn" id="vaxGo" style="background:var(--vaccine)">💉 疫苗计划</button>' : ''}${needC ? '<button class="btn" id="chkGo" style="background:var(--checkup)">🩺 体检计划</button>' : ''}</div></div>
    <button class="x-btn" style="width:30px;height:30px;font-size:14px;background:transparent;align-self:flex-start" aria-label="关闭">✕</button></div>`;
  el.querySelector('#vaxGo')?.addEventListener('click', () => openVaxPlan());
  el.querySelector('#chkGo')?.addEventListener('click', () => openCheckupPlan());
  el.querySelector('.x-btn').onclick = () => {
    if (needV) localStorage.setItem('babyrecord.hideVaxCta', '1');
    if (needC) localStorage.setItem('babyrecord.hideChkCta', '1');
    el.innerHTML = ''; toast('可在「设置 → 一键生成日程」里生成');
  };
}
export { parseYmd };
