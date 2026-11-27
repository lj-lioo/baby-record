import { CARE_LABELS as LABEL, FEEDING_DAY_START, STOOL_TYPES, activeSleep, careCalendarDate, careDay, careDetail, careNewest, feedingCycleDate, formatSleepMinutes, sleepOnDay, summarizeCare, validateCare } from '../care.js';
import { addDays, atLocal, cnDate, toLocalInput } from '../dates.js';
import { medDoses } from '../growth.js';
import { canEditGrowth, requireEditEvents } from '../roles.js';
import { store } from '../store.js';
import { closeSheet, confirmSheet, esc, openSheet, toast } from '../ui.js';
import { openCareVoice } from './care-voice.js';
import { openCareImport } from './care-import.js';
import { careTrend } from './care-trend.js';

const DOSE_SUGGESTIONS = ['维生素AD', '维生素K1'];
const TREND = { bottleMl: '瓶喂奶量', nursing: '母乳次数', stool: '大便次数', urine: '小便次数', dose: '用药次数', sleepMinutes: '睡眠时长' };
const DAILY_COUNT = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const DAILY_VOLUME = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const FEED_CHOICES = { nursing: '母乳', bottle: '瓶喂' };
const TOILET_CHOICES = { stool: '大便', urine: '小便' };
let selectedDate = '';
let statsEndDate = '';
let section = 'log';
let period = 7;
let metric = 'bottleMl';
let undoRecords = [];
let cycleRefresh;

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

function summaryTiles(day, daysWithValues) {
  const averaging = !!daysWithValues;
  const display = (key, formatter = DAILY_COUNT) => {
    if (!averaging) return day[key];
    const days = daysWithValues[key];
    return days ? formatter.format(day[key] / days) : '—';
  };
  const withUnit = (value, unit) => value === '—' ? value : `${value} ${unit}`;
  const unit = averaging ? '次/天' : '次';
  const stool = display('stool'), urine = display('urine');
  const stoolUrine = stool === '—' && urine === '—' ? '—' : `${stool} / ${urine} ${unit}`;
  const doseNote = day.legacyDose
    ? (averaging ? `原用药记录 ${display('legacyDose')} 次/天` : `另有 ${day.legacyDose} 条旧记录`) : '已记录';
  const tiles = [
    [averaging ? '日均母乳次数' : '母乳', withUnit(display('nursing'), unit), averaging ? `母乳亲喂 · ${daysWithValues.nursing} 天` : '母乳亲喂次数'],
    [averaging ? '日均瓶喂奶量' : '瓶喂奶量', withUnit(display('bottleMl', DAILY_VOLUME), averaging ? 'mL/天' : 'mL'),
      averaging ? `有奶量记录 · ${daysWithValues.bottleMl} 天` : '已记录的实际奶量'],
    [averaging ? '日均大小便次数' : '大小便', stoolUrine, averaging ? `大便 ${daysWithValues.stool} 天 / 小便 ${daysWithValues.urine} 天` : '大便 / 小便'],
    [averaging ? '日均实际用药次数' : '实际用药', withUnit(display('dose'), unit), averaging ? `${daysWithValues.dose} 天有记录${day.legacyDose ? ' · ' + doseNote : ''}` : doseNote],
  ];
  return `<div class="care-tiles">${tiles.map(([label, value, sub]) => `<div>
    <span>${label}</span><strong>${value}</strong><small>${sub}</small>
  </div>`).join('')}</div>`;
}

function quickActions(today, canUndo) {
  return `<section class="card care-quick">
    <div class="care-heading"><h2>${today ? '快捷记录' : '补记当天'}</h2>
      ${canUndo ? '<button type="button" class="care-link" id="care-undo">撤销刚才记录</button>' : ''}</div>
    <button type="button" class="btn block care-voice-button" id="care-voice">🎙️ 语音听写</button>
    <div class="care-quick-grid">
      <button type="button" data-care-kind="feed">喂奶</button>
      <button type="button" data-care-kind="toilet">大小便</button>
      <button type="button" data-care-kind="dose">用药</button>
    </div>
    <button type="button" class="care-link care-import-link" id="care-import">批量补录</button>
  </section>`;
}

function sleepCard(minutes, active, editable, onCurrentCycle) {
  return `<section class="card care-sleep">
    <div class="care-heading"><h2>睡眠</h2><strong>${minutes ? formatSleepMinutes(minutes) : '暂无时长'}</strong></div>
    ${active ? `<p class="small muted">睡眠中 · ${cnDate(active.date)} ${active.time} 入睡</p>`
      : onCurrentCycle ? '<p class="small muted">清醒</p>' : ''}
    ${editable && onCurrentCycle ? `<div class="care-sleep-actions">
      <button type="button" class="btn" id="care-sleep-start" ${active ? 'disabled' : ''}>睡觉</button>
      <button type="button" class="btn" id="care-sleep-end" ${active ? '' : 'disabled'}>醒来</button>
    </div>` : ''}
  </section>`;
}

function dailyLog(date, records, historical, editable) {
  const rows = [...records, ...historical].filter((record) => record.kind === 'sleep' ? sleepOnDay(record, date) : careDay(record) === date).sort(careNewest);
  const paper = rows.filter((record) => record.paper);
  const renderRow = (record) => {
    const continued = record.kind === 'sleep' && careDay(record) !== date;
    const time = continued ? '续睡' : record.time || (record.kind === 'dose' ? '时间未记' : '—');
    const content = `<span class="care-time">${record.date > date ? '次日<br>' : ''}${esc(time)}</span><span class="care-row-content">
      <strong>${esc(record.title || (record.kind === 'dose' ? record.name : LABEL[record.kind]))}</strong>
      <small>${[record.legacy, record.legacy ? record.detail : careDetail(record), record.note].filter(Boolean).map(esc).join(' · ')}</small></span>`;
    return `<li>${editable && !record.legacy
      ? `<button type="button" class="care-row" data-care-id="${esc(record.id)}">${content}<span class="care-edit">编辑</span></button>`
      : `<div class="care-row">${content}</div>`}</li>`;
  };
  return `<section class="card care-timeline"><h2>当天记录</h2>
    ${rows.length ? `<ul>${rows.filter((record) => !record.paper).map(renderRow).join('')}
      ${paper.length ? `<li><details class="care-paper-page">
        <summary>纸本记录 <span class="small muted">08:00 至次日 08:00 · ${paper.length} 项</span></summary>
        <ul>${paper.map(renderRow).join('')}</ul>
      </details></li>` : ''}</ul>` : '<p class="small muted">这一天还没有记录。</p>'}
    <a class="care-link" href="#/growth">查看原用药记录</a>
  </section>`;
}

function renderStats({ daily, totals, daysWithValues, recordedDays, dosesByName, milkByType }, chart) {
  const buttons = (list, attr, active) => list.map(([id, label]) =>
    `<button type="button" ${attr}="${id}" aria-pressed="${id === active}">${label}</button>`).join('');
  const dailyVolume = (ml, days) => DAILY_VOLUME.format(ml / days);
  const dailyCount = (count, days) => DAILY_COUNT.format(count / days);
  return `
    <section class="card care-stats">
      <div class="care-pills" aria-label="统计区间">${buttons([7, 30, 90].map((n) => [n, `近 ${n} 天`]), 'data-care-period', period)}</div>
      <h2 class="care-average-heading">近 ${period} 天日均汇总</h2>
      <p class="small muted">${cnDate(daily[0].date, true)} — ${cnDate(daily.at(-1).date, true)} · ${recordedDays
        ? '各项日均只计该项大于 0 的日期' : '这段时间还没有记录'}</p>
      ${summaryTiles(totals, daysWithValues)}
      <p class="small care-sleep-average"><strong>日均睡眠</strong> · ${daysWithValues.sleepMinutes
        ? formatSleepMinutes(totals.sleepMinutes / daysWithValues.sleepMinutes) + ' · ' + daysWithValues.sleepMinutes + ' 天有记录'
        : '暂无时长'}</p>
      ${milkByType.length ? `<p class="small muted care-average">各奶类日均 · ${milkByType.map(([label, ml, days]) => `${label} ${dailyVolume(ml, days)} mL/天`).join(' · ')}</p>` : ''}
      ${daysWithValues.nursingMl ? `<p class="small muted care-average">亲喂实测日均 ${dailyVolume(totals.nursingMl, daysWithValues.nursingMl)} mL/天 · ${dailyCount(totals.nursingMeasured, daysWithValues.nursingMeasured)} 次测量/天</p>` : ''}
      ${dosesByName.length ? `<ul class="care-dose-totals" aria-label="按药品统计">${dosesByName.map(([name, n, days]) =>
        `<li><span>${esc(name)}</span><b>${dailyCount(n, days)} 次/天</b></li>`).join('')}</ul>` : ''}
    </section>
    <section class="card care-stats">
      <h2>每日趋势</h2>
      <div class="care-pills care-trend-pills" aria-label="趋势指标">${buttons(Object.entries(TREND), 'data-care-metric', metric)}</div>
      ${chart}
      <details class="care-breakdown">
        <summary>查看每日明细</summary>
        <table>
          <thead><tr><th>日期</th><th>母乳次数</th><th>瓶喂 mL</th><th>大便</th><th>小便</th><th>用药</th><th>睡眠</th></tr></thead>
          <tbody>${[...daily].reverse().map((d) => `<tr><th scope="row">${cnDate(d.date)}</th>
            <td>${d.nursing}</td><td>${d.bottleMl}</td><td>${d.stool}</td><td>${d.urine}</td><td>${d.dose}</td><td>${d.sleepMinutes ? formatSleepMinutes(d.sleepMinutes) : '—'}</td></tr>`).join('')}</tbody>
        </table>
      </details>
      <p class="small muted care-caption">按实际录入汇总。无记录的日期不代表未喂养或未用药。</p>
    </section>`;
}

export function renderCare(root) {
  const now = Date.now();
  const [today, time] = toLocalInput(now).split('T');
  const currentCycle = feedingCycleDate(today, time);
  const isStats = section === 'stats';
  const defaultDate = isStats ? addDays(currentCycle, -1) : currentCycle;
  const latestDate = isStats ? defaultDate : currentCycle;
  const chosenDate = isStats ? statsEndDate : selectedDate;
  const date = chosenDate && chosenDate <= latestDate ? chosenDate : defaultDate;
  const editable = canEditGrowth();
  const records = store.care();
  const historical = oldDoseEntries();
  const onCurrentCycle = date === currentCycle;
  const sleepingNow = isStats ? null : activeSleep(records);
  const canUndo = () => undoRecords.length > 0 &&
    undoRecords.every((record) => careDay(record) === date && store.getCare(record.id)?.updatedAt === record.updatedAt);
  const report = summarizeCare(records, historical, date, isStats ? period : 1);
  const trend = isStats ? careTrend(report.daily, metric, TREND[metric]) : null;
  clearTimeout(cycleRefresh);
  cycleRefresh = setTimeout(() => {
    if (root.querySelector('.care-page')) renderCare(root);
  }, atLocal(addDays(currentCycle, 1), FEEDING_DAY_START).getTime() - now);
  root.innerHTML = `<div class="care-page">
    <header class="topbar"><h1>喂养记录</h1></header>
    <div class="care-switch care-pills" aria-label="喂养页面">
      <button type="button" data-care-section="log" aria-pressed="${section === 'log'}">记录</button>
      <button type="button" data-care-section="stats" aria-pressed="${section === 'stats'}">统计</button>
    </div>
    <div class="care-date-nav">
      <button type="button" id="care-back" aria-label="前一天">‹</button>
      <input type="date" class="input" id="care-day" aria-label="${isStats ? '统计截止日期' : '记录周期日期'}" value="${esc(date)}" max="${latestDate}">
      <button type="button" id="care-next" aria-label="后一天" ${date >= latestDate ? 'disabled' : ''}>›</button>
      ${date !== defaultDate ? `<button type="button" class="care-link" id="care-today">${isStats ? '最近一期' : currentCycle === today ? '今天' : '当前周期'}</button>` : ''}
    </div>
    <p class="small muted">${isStats ? `每天 ${FEEDING_DAY_START} 纳入刚结束的喂养周期` : `${cnDate(date)} ${FEEDING_DAY_START} 至次日 ${FEEDING_DAY_START}（次日凌晨归入本周期）`}</p>
    ${section === 'log' ? `${editable ? quickActions(onCurrentCycle, canUndo()) : ''}
      ${sleepCard(report.totals.sleepMinutes, sleepingNow && (onCurrentCycle || careDay(sleepingNow) === date) ? sleepingNow : null, editable, onCurrentCycle)}
      <section class="card"><h2>${date === today ? '今天' : cnDate(date)}汇总</h2>${summaryTiles(report.totals)}</section>
      ${dailyLog(date, records, historical, editable)}` : renderStats(report, trend.html)}
  </div>`;
  trend?.bind(root);

  const setDate = (next) => {
    if (isStats) {
      if (next && next <= latestDate) statsEndDate = next === defaultDate ? '' : next;
    } else {
      const [today, time] = toLocalInput(Date.now()).split('T');
      const currentCycle = feedingCycleDate(today, time);
      if (next && next <= currentCycle) selectedDate = next === currentCycle ? '' : next;
    }
    renderCare(root);
  };
  root.querySelector('#care-day').onchange = (event) => setDate(event.target.value);
  root.querySelector('#care-back').onclick = () => setDate(addDays(date, -1));
  root.querySelector('#care-next').onclick = () => setDate(addDays(date, 1));
  const resetDate = root.querySelector('#care-today');
  if (resetDate) resetDate.onclick = () => {
    if (isStats) statsEndDate = '';
    else selectedDate = '';
    renderCare(root);
  };
  root.querySelectorAll('[data-care-section]').forEach((button) => {
    button.onclick = () => { section = button.dataset.careSection; renderCare(root); };
  });
  root.querySelectorAll('[data-care-period]').forEach((button) => {
    button.onclick = () => { period = Number(button.dataset.carePeriod); renderCare(root); };
  });
  root.querySelectorAll('[data-care-metric]').forEach((button) => {
    button.onclick = () => { metric = button.dataset.careMetric; renderCare(root); };
  });
  const showSleep = (saved) => {
    undoRecords = [];
    setDate(sleepOnDay(saved[0], date) ? date : careDay(saved[0]));
  };
  const sleepStart = root.querySelector('#care-sleep-start');
  if (sleepStart) sleepStart.onclick = () => openEditor('sleep', date, null, showSleep, 'start');
  const sleepEnd = root.querySelector('#care-sleep-end');
  if (sleepEnd) sleepEnd.onclick = () => {
    const active = activeSleep(store.care());
    if (active) openEditor('sleep', date, active, showSleep, 'wake');
    else toast('请先记录入睡');
  };
  const voice = root.querySelector('#care-voice');
  if (voice) voice.onclick = () => openCareVoice({ day: selectedDate, onSaved: (records) => {
    undoRecords = [];
    setDate(careDay(records[0]));
  } });
  const importButton = root.querySelector('#care-import');
  if (importButton) importButton.onclick = () => openCareImport((records) => {
    undoRecords = [];
    setDate(careDay(records[0]));
  });
  root.querySelectorAll('[data-care-kind]').forEach((button) => {
    button.onclick = () => openEditor(button.dataset.careKind, date, null, (saved) => {
      undoRecords = saved;
      setDate(careDay(saved[0]));
    });
  });
  root.querySelectorAll('[data-care-id]').forEach((button) => {
    button.onclick = () => {
      const existing = store.getCare(button.dataset.careId);
      if (existing) openEditor(existing.kind, careDay(existing), existing, (saved) => setDate(careDay(saved[0])));
    };
  });
  const undo = root.querySelector('#care-undo');
  if (undo) undo.onclick = () => {
    if (!requireEditEvents() || !canUndo()) return;
    try { store.deleteCareBatch(undoRecords.map((record) => record.id)); undoRecords = []; renderCare(root); toast('已撤销'); }
    catch { toast('撤销未保存，请重试'); }
  };
}

function openEditor(kind, cycle, existing, onSaved, sleepAction = '') {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  const pickingFeed = kind === 'feed';
  const feeding = pickingFeed || Object.hasOwn(FEED_CHOICES, kind);
  const pickingToilet = kind === 'toilet';
  const sleeping = kind === 'sleep';
  const starting = sleepAction === 'start';
  const waking = sleepAction === 'wake';
  const showWake = sleeping && !starting;
  const requireWake = waking || showWake && !!existing?.endDate;
  const initialFeed = feeding ? existing?.kind || '' : '';
  const [today, now] = toLocalInput(Date.now()).split('T');
  const currentCycle = feedingCycleDate(today, now);
  const date = existing?.date ?? (cycle === currentCycle ? today : cycle);
  const time = existing?.time ?? (cycle === currentCycle && (!sleeping || starting) ? now : '');
  const endDate = existing?.endDate ?? (waking ? cycle === currentCycle ? today : cycle : '');
  const endTime = existing?.endTime ?? (waking && cycle === currentCycle ? now : '');
  const title = starting ? '记录入睡' : waking ? '记录醒来'
    : (existing ? '编辑' : '记录') + (feeding ? '喂奶' : pickingToilet ? '大小便' : LABEL[kind]);
  const field = (name, label, attrs) => `<div class="field"><label for="care-${name}">${label}</label>
    <input class="input" id="care-${name}" name="${name}" ${attrs}></div>`;
  const select = (name, label, choices, value) => `<div class="field"><label for="care-${name}">${label}</label>
    <select class="input care-select" id="care-${name}" name="${name}">${Object.entries(choices).map(([id, option]) =>
      `<option value="${id}" ${id === value ? 'selected' : ''}>${option}</option>`).join('')}</select></div>`;
  const options = (name, legend, choices, checked = '') => `<fieldset class="care-options" aria-label="${legend}">
    ${Object.entries(choices).map(([id, label]) => `<label>
      <input type="${name === 'feed' && !pickingFeed ? 'radio' : 'checkbox'}" name="${name}" value="${id}" ${id === checked ? 'checked' : ''}>
      <span>${label}</span></label>`).join('')}
    </fieldset>`;
  openSheet(`<h3>${title}</h3>
    <form id="care-form" novalidate>
      ${!waking ? `<div class="care-form-date">${field('date', sleeping ? '入睡日期' : '实际日期', `type="date" value="${esc(date)}" max="${today}"`)}
        ${field('time', sleeping ? '入睡时间' : kind === 'dose' ? '时间（可选）' : '时间', `type="time" value="${esc(time)}"`)}</div>` : ''}
      ${showWake ? `<div class="care-form-date">
        ${field('endDate', '醒来日期', `type="date" value="${esc(endDate)}" max="${today}"`)}
        ${field('endTime', '醒来时间', `type="time" value="${esc(endTime)}"`)}
      </div>` : ''}
      ${!waking ? '<p class="small muted" id="care-cycle-preview" aria-live="polite"></p>' : ''}
      ${feeding ? `${options('feed', '喂奶方式', FEED_CHOICES, initialFeed)}
        <div id="care-bottle-fields" ${initialFeed !== 'bottle' ? 'hidden' : ''}>${field('ml', '实际喝下的奶量（mL）',
          `type="number" inputmode="decimal" min="0.1" step="0.1" value="${esc(existing?.kind === 'bottle' ? existing.ml : '')}"`)}</div>
        <div id="care-nursing-fields" ${initialFeed !== 'nursing' ? 'hidden' : ''}>${field('minutes', '亲喂时长（分钟 · 可选）',
          `type="number" inputmode="numeric" min="1" step="1" value="${esc(existing?.minutes)}"`)}</div>` : ''}
      ${pickingToilet ? options('toilet', '大小便类型', TOILET_CHOICES) : ''}
      ${pickingToilet || kind === 'stool' ? `<div id="care-stool-fields" ${pickingToilet ? 'hidden' : ''}>
        ${select('stool', '性状（可选）', { '': '未标注', ...STOOL_TYPES }, existing?.stool || '')}</div>` : ''}
      ${kind === 'dose' ? `${field('name', '药品或补充剂', `maxlength="60" value="${esc(existing?.name)}"`)}
        <div class="care-pills care-dose-options">${[...new Set([...DOSE_SUGGESTIONS, ...store.meds().map((m) => m.name).filter(Boolean)])].slice(0, 8)
          .map((name) => `<button type="button" data-dose-name="${esc(name)}">${esc(name)}</button>`).join('')}</div>
        ${field('dose', '本次实际用量（可选）', `maxlength="80" value="${esc(existing?.dose)}"`)}` : ''}
      ${!sleepAction ? field('note', '备注（可选）', `maxlength="160" value="${esc(existing?.note)}"`) : ''}
      <p class="care-error small" role="alert" id="care-error" hidden></p>
      <div class="btn-row"><button type="button" class="btn ghost" id="care-cancel">取消</button>
        <button type="submit" class="btn">${pickingToilet ? '确认记录' : '保存'}</button></div>
      ${existing && !waking ? '<button type="button" class="btn danger block care-delete" id="care-delete">删除这条记录</button>' : ''}
    </form>`, (sheet) => {
    const form = sheet.querySelector('#care-form');
    const dateInput = form.elements.namedItem(waking ? 'endDate' : 'date');
    const timeInput = form.elements.namedItem(waking ? 'endTime' : 'time');
    const cyclePreview = sheet.querySelector('#care-cycle-preview');
    const followCycle = (!existing || waking) && (cycle !== currentCycle || today !== currentCycle);
    let dateEdited = false;
    const updateCycle = () => {
      if (!cyclePreview) return;
      if (!dateInput.value || !timeInput.value && kind !== 'dose') {
        cyclePreview.textContent = '早上 ' + FEEDING_DAY_START + ' 前的记录归入前一天的周期。';
        return;
      }
      const day = feedingCycleDate(dateInput.value, timeInput.value);
      const nextMorning = day !== dateInput.value ? ' · 次日 ' + timeInput.value : '';
      cyclePreview.textContent = (sleeping ? '入睡于 ' : '计入 ') + cnDate(day) + '周期' + nextMorning;
    };
    dateInput.oninput = () => { dateEdited = true; updateCycle(); };
    timeInput.oninput = () => {
      if (followCycle && !dateEdited) dateInput.value = careCalendarDate(cycle, timeInput.value);
      updateCycle();
    };
    updateCycle();
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
    if (feeding) {
      const bottle = sheet.querySelector('#care-bottle-fields');
      const nursing = sheet.querySelector('#care-nursing-fields');
      const bottleChoice = form.querySelector('[name="feed"][value="bottle"]');
      const nursingChoice = form.querySelector('[name="feed"][value="nursing"]');
      const updateFeedFields = () => {
        bottle.hidden = !bottleChoice.checked;
        nursing.hidden = !nursingChoice.checked || bottleChoice.checked;
      };
      bottleChoice.onchange = nursingChoice.onchange = updateFeedFields;
    }
    if (pickingToilet) {
      const stool = form.querySelector('[name="toilet"][value="stool"]');
      stool.onchange = () => { sheet.querySelector('#care-stool-fields').hidden = !stool.checked; };
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!requireEditEvents()) return;
      if (outdated()) { showError('这条记录已更新，请关闭后重新打开'); return; }
      const data = new FormData(form);
      if (requireWake && (!data.get('endDate') || !data.get('endTime'))) {
        showError('请填写醒来的日期和时间');
        return;
      }
      const kinds = pickingToilet ? data.getAll('toilet') : feeding ? data.getAll('feed') : [kind];
      if (!kinds.length) {
        showError(feeding ? '至少选择母乳或瓶喂' : '至少选择大便或小便');
        return;
      }
      const inputs = kinds.map((selected) => ({
        id: existing?.id, kind: selected, date: data.get('date') ?? existing?.date,
        time: data.get('time') ?? existing?.time, note: data.get('note') ?? existing?.note,
        ml: selected === 'bottle' ? data.get('ml') : existing?.kind === 'nursing' ? existing.ml : null,
        milk: existing?.milk, minutes: kinds.includes('bottle') ? null : data.get('minutes'),
        stool: data.get('stool'), name: data.get('name'), dose: data.get('dose'),
        paper: existing?.paper, endDate: data.get('endDate'), endTime: data.get('endTime'),
      }));
      const latest = toLocalInput(Date.now());
      const error = inputs.map((input) => validateCare(input, latest)).find(Boolean);
      if (error) { showError(error); return; }
      let saved;
      try {
        if (starting) {
          const { date, time } = inputs[0];
          const started = store.startSleep(date, time);
          if (!started) { showError('已有一段睡眠正在记录，请先记录醒来'); return; }
          saved = [started];
        } else if (waking) {
          const input = inputs[0];
          saved = store.finishSleep(input.endDate, input.endTime);
          if (!saved.length) { showError('这段睡眠已结束'); return; }
        } else {
          saved = existing ? [store.upsertCare(inputs[0])] : store.addCare(inputs);
        }
      } catch (error) {
        showError(waking && error.message === '醒来时间不能早于入睡时间'
          ? error.message : '本机保存失败，请重试');
        return;
      }
      closeSheet();
      onSaved(saved);
      toast('已保存');
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
