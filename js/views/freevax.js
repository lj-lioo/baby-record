// v1.12.7 免费疫苗合集：首页自费疫苗卡上方，按国家免疫规划分组汇总展示；只读，不改云端。
import { store } from '../store.js';
import { esc, openSheet, closeSheet } from '../ui.js';
import { todayStr, cnDate, weekday } from '../dates.js';
import { NIP_SCHEDULE, planVaccines, doseTitle, ageLabel } from '../vaccines.js';
import { replacementHints, seriesOfSid, SERIES } from '../paidvax.js';

let cardOpen = false;
let openGrp = null;

const BDAY_DEFAULT = '2026-09-17';
const bday = () => store.state.settings.babyBirthday || BDAY_DEFAULT;
const yr = (d) => d && d.slice(0, 4) !== todayStr().slice(0, 4);
const fmt = (d) => (d ? `${cnDate(d, yr(d))} ${weekday(d)}` : '');

/** 哪个自费系列替代了该免费剂次（已计划的系列才算） */
function replacerName(nipId, events) {
  const planned = new Set();
  for (const e of events) {
    const s = seriesOfSid(e.scheduleId);
    if (s) planned.add(s.family);
  }
  for (const fam of planned) {
    const S = SERIES[fam];
    if ((S.replaceIds || []).includes(nipId)) return S.hintName || S.short || S.title;
  }
  return '';
}

/** 按疫苗名分组的剂次列表（不含默认不添加的 optional，除非已有事项） */
export function freeVaxGroups(birthday = bday(), today = todayStr(), events = store.events()) {
  const plan = planVaccines(birthday, today, events);
  const hints = replacementHints(events);
  const byName = new Map();
  for (const d of plan) {
    if (d.optional && !d.existing) continue;
    const rep = replacerName(d.id, events) || '';
    const hint = hints.get(d.scheduleId) || '';
    const ev = d.existing;
    let status = 'pending';
    if (ev?.done) status = 'done';
    else if (rep) status = 'replaced';
    else if (!ev) status = 'missing';
    const row = {
      id: d.id,
      scheduleId: d.scheduleId,
      name: d.name,
      dose: d.dose || '',
      title: d.title || doseTitle(d),
      age: d.age || ageLabel(d.m),
      date: ev?.date || d.date,
      earliest: d.earliest,
      latest: d.latest,
      status,
      rep,
      hint,
      event: ev || null,
    };
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(row);
  }
  // 保持 NIP_SCHEDULE 出现顺序
  const order = [];
  for (const d of NIP_SCHEDULE) {
    if (byName.has(d.name) && !order.includes(d.name)) order.push(d.name);
  }
  return order.map((name) => {
    const doses = byName.get(name);
    return {
      name,
      doses,
      doneN: doses.filter((x) => x.status === 'done').length,
      replacedN: doses.filter((x) => x.status === 'replaced').length,
      pendingN: doses.filter((x) => x.status === 'pending' || x.status === 'missing').length,
    };
  });
}

export function freeVaxCounts(groups = freeVaxGroups()) {
  let total = 0, done = 0, replaced = 0;
  for (const g of groups) {
    total += g.doses.length;
    done += g.doneN;
    replaced += g.replacedN;
  }
  return { total, done, replaced, pending: total - done - replaced };
}

function statusHtml(row) {
  if (row.status === 'done') return '<span class="fv-st done">已打 ✅</span>';
  if (row.status === 'replaced') return `<span class="fv-st replaced">已被${esc(row.rep)}替代 ✕</span>`;
  if (row.status === 'missing') return '<span class="fv-st miss">未加入计划</span>';
  return '<span class="fv-st pend">待打</span>';
}

function doseHtml(row) {
  const cls = row.status === 'done' ? 'done' : row.status === 'replaced' ? 'replaced' : row.status === 'missing' ? 'miss' : 'pend';
  const title = row.status === 'replaced'
    ? `<s>${esc(row.dose ? row.dose : row.title)}</s>`
    : esc(row.dose ? row.dose : '单剂');
  const when = row.event
    ? `计划 ${fmt(row.date)}`
    : `程序 ${fmt(row.earliest)}${row.latest ? ` · 最迟 ${cnDate(row.latest, yr(row.latest))}` : ''}`;
  return `<button type="button" class="fv-dose ${cls}" data-sid="${esc(row.scheduleId)}">
    <span class="fv-dose-main"><b>${title}</b>${statusHtml(row)}</span>
    <span class="fv-dose-sub">${esc(row.age)} · ${esc(when)}</span>
  </button>`;
}

function groupHtml(g) {
  const st = g.doneN === g.doses.length
    ? `<span class="pc-st done">已打齐</span>`
    : g.replacedN && !g.pendingN
      ? `<span class="pc-st replaced">可被替代</span>`
      : g.pendingN
        ? `<span class="pc-st">待打 ${g.pendingN}</span>`
        : '';
  const sub = `${g.doses.length} 剂${g.doneN ? ` · 已打 ${g.doneN}` : ''}${g.replacedN ? ` · 被替代 ${g.replacedN}` : ''}`;
  return `<details class="pc-item fv-item" data-grp="${esc(g.name)}" ${openGrp === g.name ? 'open' : ''}>
    <summary><span class="pc-name">💉 ${esc(g.name)}</span>${st}<span class="pc-sub">${esc(sub)}</span></summary>
    <div class="pc-body fv-doses">${g.doses.map(doseHtml).join('')}</div>
  </details>`;
}

function openMissingSheet(row) {
  openSheet(`<div class="ev-detail">
    <h3>💉 ${esc(row.title)}</h3>
    <div class="evd-row"><span class="tag cat-vaccine">免费疫苗</span> <span class="tag">未加入计划</span></div>
    <div class="evd-row">📅 程序日 ${fmt(row.earliest)}（${esc(row.age)}）</div>
    ${row.latest ? `<div class="evd-row">🪟 最迟 ${fmt(row.latest)}</div>` : '<div class="evd-row">🪟 国家免疫规划未规定最迟完成年龄</div>'}
    ${row.rep ? `<div class="evd-small">💡 已计划${esc(row.rep)}，可不打此剂（以门诊为准）</div>` : ''}
    <p class="small muted">这只是国家免疫规划汇总。要排进日程，请到设置 → 一键生成疫苗计划。</p>
    <button type="button" class="btn ghost block" id="fvClose">关闭</button>
  </div>`, (sh) => { sh.querySelector('#fvClose').onclick = closeSheet; });
}

function bind(el, groups) {
  el.querySelectorAll('.fv-item').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) openGrp = d.dataset.grp;
      else if (openGrp === d.dataset.grp) openGrp = null;
    });
  });
  const bySid = new Map();
  for (const g of groups) for (const r of g.doses) bySid.set(r.scheduleId, r);
  el.querySelectorAll('.fv-dose').forEach((b) => {
    b.onclick = async (ev) => {
      ev.preventDefault();
      const row = bySid.get(b.dataset.sid);
      if (!row) return;
      if (row.event) {
        const { openEventDetail } = await import('./home.js');
        openEventDetail(row.event);
      } else openMissingSheet(row);
    };
  });
}

export function renderFreeVaxCard(el) {
  if (!el) return;
  const groups = freeVaxGroups();
  const c = freeVaxCounts(groups);
  const countTxt = `${c.total} 针 · 已打 ${c.done}${c.replaced ? ` · 被替代 ${c.replaced}` : ''}`;
  el.innerHTML = `
    <button type="button" class="pc-toggle" id="fvToggle" aria-expanded="${cardOpen}">
      <span class="pc-t">💉 免费疫苗</span>
      <span class="pc-count">${esc(countTxt)}</span>
      <span class="pc-chev">${cardOpen ? '▴' : '▾'}</span>
    </button>
    ${cardOpen ? `<div class="pc-wrap">
      <p class="small muted" style="margin:8px 0 4px">国家免疫规划（一类）免费疫苗汇总。点某一剂看详情；被自费替代的会划线并标红叉。<b>只展示，不会改云端数据</b>。</p>
      <div class="pc-list">${groups.map(groupHtml).join('')}</div>
    </div>` : ''}`;
  el.querySelector('#fvToggle').onclick = () => {
    cardOpen = !cardOpen;
    renderFreeVaxCard(el);
    if (cardOpen) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (cardOpen) bind(el, groups);
}
