import { MILK_TYPES, STOOL_TYPES, careNewest, summarizeCare, validateCare } from '../care.js';
import { addDays, cnDate, todayStr, toLocalInput } from '../dates.js';
import { medDoses } from '../growth.js';
import { canEditGrowth, requireEditEvents } from '../roles.js';
import { store } from '../store.js';
import { closeSheet, confirmSheet, esc, openSheet, toast } from '../ui.js';

const LABEL = { nursing: '母乳亲喂', bottle: '瓶喂', stool: '排便', dose: '用药' };
const DOSE_SUGGESTIONS = ['维生素AD', '维生素K1'];
const TREND = { bottleMl: '瓶喂奶量', feeds: '喂奶次数', stool: '排便次数', dose: '用药次数' };
let selectedDate = '';
let section = 'log';
let period = 7;
let metric = 'bottleMl';
let undoRecord;
let lastQuickTap;

function oldDoseEntries() {
  const entries = new Map();
  for (const med of store.meds()) {
    if (!med.series && med.start && med.start === med.end) {
      entries.set('med:' + med.id, { date: med.start, time: '', updatedAt: med.updatedAt, title: med.name, detail: med.dose, legacy: '原用药记录' });
    }
    for (const event of medDoses(med)?.list || []) {
      if (!event.done) continue;
      entries.set('event:' + event.id, { date: event.date, time: '', updatedAt: event.updatedAt, title: med.name, legacy: '日程已完成' });
    }
  }
  return [...entries.values()];
}

function detail(record) {
  if (record.kind === 'bottle') return `${record.ml} mL · ${MILK_TYPES[record.milk]}`;
  if (record.kind === 'nursing') {
    return [record.minutes && `${record.minutes} 分钟`, record.ml != null && `实测 ${record.ml} mL`].filter(Boolean).join(' · ');
  }
  if (record.kind === 'stool') return STOOL_TYPES[record.stool] || '';
  return record.dose;
}

function summaryTiles(day) {
  const tiles = [
    ['喂奶', `${day.nursing + day.bottle} 次`, `亲喂 ${day.nursing} · 瓶喂 ${day.bottle}`],
    ['瓶喂奶量', `${day.bottleMl} mL`, '已记录的实际奶量'],
    ['排便', `${day.stool} 次`, '已记录'],
    ['实际用药', `${day.dose} 次`, day.legacyDose ? `另有 ${day.legacyDose} 条旧记录` : '已记录'],
  ];
  return `<div class="care-tiles">${tiles.map(([label, value, sub]) => `<div>
    <span>${label}</span><strong>${value}</strong><small>${sub}</small>
  </div>`).join('')}</div>`;
}

function quickActions(today, lastBottle, canUndo) {
  const bottle = today && lastBottle
    ? [`瓶喂 ${lastBottle.ml} mL`, MILK_TYPES[lastBottle.milk], 'bottle', true]
    : ['瓶喂', '填写实际奶量', 'bottle', false];
  const actions = [
    ['母乳亲喂', today ? '一键记录当前时间' : '补记亲喂时间', 'nursing', today],
    bottle,
    ['记录排便', today ? '一键记录当前时间' : '补记时间和性状', 'stool', today],
    ['记录用药', '记录实际服用', 'dose', false],
  ];
  return `<section class="card care-quick">
    <div class="care-heading"><h2>${today ? '快捷记录' : '补记当天'}</h2>
      ${canUndo ? '<button type="button" class="care-link" id="care-undo">撤销刚才记录</button>' : ''}</div>
    <div class="care-quick-grid">${actions.map(([label, hint, kind, quick]) =>
      `<button type="button" data-care-kind="${kind}" data-care-quick="${quick}">
        <strong>${label}</strong><small>${hint}</small></button>`).join('')}</div>
    ${today && lastBottle ? '<button type="button" class="care-link care-other" data-care-kind="bottle">输入其他奶量</button>' : ''}
  </section>`;
}

function dailyLog(date, records, historical, editable) {
  const rows = [...records, ...historical].filter((record) => record.date === date).sort(careNewest);
  return `<section class="card care-timeline"><h2>当天记录</h2>
    ${rows.length ? `<ul>${rows.map((record) => {
      const content = `<span class="care-time">${esc(record.time || '—')}</span><span class="care-row-content">
        <strong>${esc(record.title || (record.kind === 'dose' ? record.name : LABEL[record.kind]))}</strong>
        <small>${[record.legacy, record.legacy ? record.detail : detail(record), record.note].filter(Boolean).map(esc).join(' · ')}</small></span>`;
      return `<li>${editable && !record.legacy
        ? `<button type="button" class="care-row" data-care-id="${esc(record.id)}">${content}<span class="care-edit">编辑</span></button>`
        : `<div class="care-row">${content}</div>`}</li>`;
    }).join('')}</ul>` : '<p class="small muted">这一天还没有记录。</p>'}
    <a class="care-link" href="#/growth">查看原用药记录</a>
  </section>`;
}

function renderStats(records, historical, date) {
  const { daily, totals, recordedDays, dosesByName, milkByType } = summarizeCare(records, historical, date, period);
  const values = daily.map((d) => metric === 'feeds' ? d.nursing + d.bottle : d[metric]);
  const max = Math.max(1, ...values);
  const buttons = (list, attr, active) => list.map(([id, label]) =>
    `<button type="button" ${attr}="${id}" aria-pressed="${id === active}">${label}</button>`).join('');
  const average = totals.bottle ? `${Math.round(totals.bottleMl * 10 / totals.bottle) / 10} mL` : '—';
  return `
    <section class="card care-stats">
      <div class="care-pills" aria-label="统计区间">${buttons([7, 30, 90].map((n) => [n, `近 ${n} 天`]), 'data-care-period', period)}</div>
      <p class="small muted">${cnDate(daily[0].date, true)} — ${cnDate(date, true)} · ${recordedDays} 天有记录</p>
      ${summaryTiles(totals)}
      <p class="small care-average">瓶喂平均每次 <b>${average}</b></p>
      ${milkByType.length ? `<p class="small muted care-average">${milkByType.map(([label, ml]) => `${label} ${ml} mL`).join(' · ')}</p>` : ''}
      ${totals.nursingMeasured ? `<p class="small muted care-average">亲喂实测 ${totals.nursingMl} mL · 共 ${totals.nursingMeasured} 次测量</p>` : ''}
      ${dosesByName.length ? `<ul class="care-dose-totals" aria-label="按药品统计">${dosesByName.map(([name, n]) =>
        `<li><span>${esc(name)}</span><b>${n} 次</b></li>`).join('')}</ul>` : ''}
    </section>
    <section class="card care-stats">
      <h2>每日趋势</h2>
      <div class="care-pills care-trend-pills" aria-label="趋势指标">${buttons(Object.entries(TREND), 'data-care-metric', metric)}</div>
      <div class="care-chart" style="--care-days:${period}" role="img" aria-label="${TREND[metric]}每日趋势，详细数值见每日明细">
        ${values.map((value) => `<span style="--care-bar:${100 * value / max}%"></span>`).join('')}
      </div>
      <div class="care-axis small muted"><span>${cnDate(daily[0].date)}</span><span>${cnDate(date)}</span></div>
      <details class="care-breakdown">
        <summary>查看每日明细</summary>
        <table>
          <thead><tr><th>日期</th><th>亲喂</th><th>瓶喂</th><th>瓶喂 mL</th><th>排便</th><th>用药</th></tr></thead>
          <tbody>${[...daily].reverse().map((d) => `<tr><th scope="row">${cnDate(d.date)}</th>
            <td>${d.nursing}</td><td>${d.bottle}</td><td>${d.bottleMl}</td><td>${d.stool}</td><td>${d.dose}</td></tr>`).join('')}</tbody>
        </table>
      </details>
      <p class="small muted care-caption">按实际录入汇总。无记录的日期不代表未喂养或未用药。</p>
    </section>`;
}

export function renderCare(root) {
  const today = todayStr();
  const date = selectedDate || today;
  const editable = canEditGrowth();
  const records = store.care();
  const historical = oldDoseEntries();
  const lastBottle = records.filter((record) => record.kind === 'bottle').sort(careNewest)[0];
  const canUndo = undoRecord && store.getCare(undoRecord.id)?.updatedAt === undoRecord.updatedAt;
  const daily = summarizeCare(records, historical, date, 1).totals;
  root.innerHTML = `<div class="care-page">
    <header class="topbar"><h1>喂养记录</h1></header>
    <div class="care-switch care-pills" aria-label="喂养页面">
      <button type="button" data-care-section="log" aria-pressed="${section === 'log'}">记录</button>
      <button type="button" data-care-section="stats" aria-pressed="${section === 'stats'}">统计</button>
    </div>
    <div class="care-date-nav">
      <button type="button" id="care-back" aria-label="前一天">‹</button>
      <input type="date" class="input" id="care-day" aria-label="${section === 'stats' ? '统计截止日期' : '记录日期'}" value="${esc(date)}" max="${today}">
      <button type="button" id="care-next" aria-label="后一天" ${date >= today ? 'disabled' : ''}>›</button>
      ${date !== today ? '<button type="button" class="care-link" id="care-today">今天</button>' : ''}
    </div>
    ${section === 'log' ? `${editable ? quickActions(date === today, lastBottle, canUndo && undoRecord.date === date) : ''}
      <section class="card"><h2>${date === today ? '今天' : cnDate(date)}汇总</h2>${summaryTiles(daily)}</section>
      ${dailyLog(date, records, historical, editable)}` : renderStats(records, historical, date)}
  </div>`;

  const setDate = (next) => {
    if (!next || next > today) return;
    selectedDate = next === today ? '' : next;
    renderCare(root);
  };
  root.querySelector('#care-day').onchange = (event) => setDate(event.target.value);
  root.querySelector('#care-back').onclick = () => setDate(addDays(date, -1));
  root.querySelector('#care-next').onclick = () => setDate(addDays(date, 1));
  const todayButton = root.querySelector('#care-today');
  if (todayButton) todayButton.onclick = () => setDate(today);
  root.querySelectorAll('[data-care-section]').forEach((button) => {
    button.onclick = () => { section = button.dataset.careSection; renderCare(root); };
  });
  root.querySelectorAll('[data-care-period]').forEach((button) => {
    button.onclick = () => { period = Number(button.dataset.carePeriod); renderCare(root); };
  });
  root.querySelectorAll('[data-care-metric]').forEach((button) => {
    button.onclick = () => { metric = button.dataset.careMetric; renderCare(root); };
  });
  root.querySelectorAll('[data-care-kind]').forEach((button) => {
    button.onclick = () => {
      if (!requireEditEvents('当前身份可以查看喂养记录')) return;
      const kind = button.dataset.careKind;
      if (button.dataset.careQuick !== 'true') { openEditor(kind, date, null, lastBottle?.milk); return; }
      if (lastQuickTap?.kind === kind && Date.now() - lastQuickTap.at < 1000) return;
      const [dateNow, time] = toLocalInput(Date.now()).split('T');
      const input = { kind, date: dateNow, time, ml: kind === 'bottle' ? lastBottle.ml : null, milk: lastBottle?.milk };
      try {
        undoRecord = store.upsertCare(input);
        lastQuickTap = { kind, at: Date.now() };
        renderCare(root);
        toast(`已记录 ${time} ${LABEL[kind]}`);
      } catch { toast('本机保存失败，请稍后重试'); }
    };
  });
  root.querySelectorAll('[data-care-id]').forEach((button) => {
    button.onclick = () => {
      const existing = store.getCare(button.dataset.careId);
      if (existing) openEditor(existing.kind, existing.date, existing);
    };
  });
  const undo = root.querySelector('#care-undo');
  if (undo) undo.onclick = () => {
    if (!requireEditEvents() || store.getCare(undoRecord.id)?.updatedAt !== undoRecord.updatedAt) return;
    try { store.deleteCare(undoRecord.id); undoRecord = null; renderCare(root); toast('已撤销'); }
    catch { toast('撤销未保存，请重试'); }
  };
}

function openEditor(kind, date, existing, defaultMilk = 'unknown') {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  const isFeed = kind === 'bottle' || kind === 'nursing';
  const isNursing = kind === 'nursing';
  const time = existing?.time ?? (date === todayStr() ? toLocalInput(Date.now()).slice(11) : '');
  const field = (name, label, attrs) => `<div class="field"><label for="care-${name}">${label}</label>
    <input class="input" id="care-${name}" name="${name}" ${attrs}></div>`;
  const select = (name, label, choices, value) => `<div class="field"><label for="care-${name}">${label}</label>
    <select class="input care-select" id="care-${name}" name="${name}">${Object.entries(choices).map(([id, option]) =>
      `<option value="${id}" ${id === value ? 'selected' : ''}>${option}</option>`).join('')}</select></div>`;
  openSheet(`<h3>${existing ? '编辑' : '记录'}${LABEL[kind]}</h3>
    <form id="care-form" novalidate>
      <div class="care-form-date">${field('date', '日期', `type="date" value="${esc(date)}" max="${todayStr()}"`)}
        ${field('time', '时间', `type="time" value="${esc(time)}"`)}</div>
      ${kind === 'bottle' ? select('milk', '奶瓶里装的是', MILK_TYPES, existing?.milk || defaultMilk) : ''}
      ${isFeed ? field('ml', isNursing ? '实测奶量（mL · 可选）' : '实际喝下的奶量（mL）',
        `type="number" inputmode="decimal" min="0.1" step="0.1" value="${esc(existing?.ml)}"`) : ''}
      ${isNursing ? field('minutes', '亲喂时长（分钟 · 可选）',
        `type="number" inputmode="numeric" min="1" step="1" value="${esc(existing?.minutes)}"`) : ''}
      ${kind === 'stool' ? select('stool', '性状（可选）', { '': '未标注', ...STOOL_TYPES }, existing?.stool || '') : ''}
      ${kind === 'dose' ? `${field('name', '药品或补充剂', `maxlength="60" value="${esc(existing?.name)}"`)}
        <div class="care-pills care-dose-options">${[...new Set([...DOSE_SUGGESTIONS, ...store.meds().map((m) => m.name).filter(Boolean)])].slice(0, 8)
          .map((name) => `<button type="button" data-dose-name="${esc(name)}">${esc(name)}</button>`).join('')}</div>
        ${field('dose', '本次实际用量（可选）', `maxlength="80" value="${esc(existing?.dose)}"`)}` : ''}
      ${field('note', '备注（可选）', `maxlength="160" value="${esc(existing?.note)}"`)}
      <p class="care-error small" role="alert" id="care-error" hidden></p>
      <div class="btn-row"><button type="button" class="btn ghost" id="care-cancel">取消</button>
        <button type="submit" class="btn">保存</button></div>
      ${existing ? '<button type="button" class="btn danger block care-delete" id="care-delete">删除这条记录</button>' : ''}
    </form>`, (sheet) => {
    const form = sheet.querySelector('#care-form');
    const showError = (message) => {
      const error = sheet.querySelector('#care-error');
      error.textContent = message;
      error.hidden = false;
    };
    const outdated = () => existing && store.getCare(existing.id)?.updatedAt !== existing.updatedAt;
    sheet.querySelector('#care-cancel').onclick = closeSheet;
    sheet.querySelectorAll('[data-dose-name]').forEach((button) => {
      button.onclick = () => { form.elements.namedItem('name').value = button.dataset.doseName; };
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!requireEditEvents()) return;
      if (outdated()) { showError('这条记录已更新，请关闭后重新打开'); return; }
      const input = { ...Object.fromEntries(new FormData(form)), id: existing?.id, kind };
      const error = validateCare(input, toLocalInput(Date.now()));
      if (error) { showError(error); return; }
      try {
        store.upsertCare(input);
        closeSheet();
        toast('已保存');
      } catch { showError('本机保存失败，请保留这次输入后重试'); }
    };
    const del = sheet.querySelector('#care-delete');
    if (del) del.onclick = async () => {
      if (!await confirmSheet('确定删除这条记录？已同步的家庭设备也会更新。', '删除', true) || !requireEditEvents()) return;
      if (outdated()) { toast('这条记录已更新，请重新打开'); return; }
      try { store.deleteCare(existing.id); toast('已删除'); }
      catch { toast('删除未保存，请重试'); }
    };
  });
}
