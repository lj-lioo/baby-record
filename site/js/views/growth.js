// v1.9.0 生长记录页：列表 + 身高/体重/头围曲线
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import { openBabyProfile } from './settings.js';
import { todayStr } from '../dates.js';
import {
  ageOnDate, growthSorted, medsSorted, medPeriod, medDoses, deltaTip, validateGrowth, chartSvg, seriesFor,
  HEIGHT_MIN, HEIGHT_MAX, WEIGHT_MIN, WEIGHT_MAX, HEAD_MIN, HEAD_MAX,
} from '../growth.js';

const TABS = [
  { id: 'height', label: '身高曲线' },
  { id: 'weight', label: '体重曲线' },
  { id: 'head', label: '头围曲线' },
  { id: 'list', label: '记录列表' },
];

let activeTab = 'height'; // v1.12.3 默认第一个标签

export function renderGrowth(root) {
  const bday = store.state.settings.babyBirthday || '';
  const list = growthSorted();
  root.innerHTML = `
    <header class="topbar">
      <h1>生长记录</h1>
      <button class="btn" id="btnAddGrowth" style="padding:8px 14px">添加</button>
    </header>
    ${!bday ? `<div class="banner"><div class="bt"><b>还没填宝宝生日</b>设置里填生日后，列表会显示日龄/月龄。</div>
      <button class="btn secondary" id="btnGoSetBday" style="flex:none">去设置</button></div>` : ''}
    <div class="gr-tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" role="tab" class="gr-tab${activeTab === t.id ? ' on' : ''}" data-tab="${t.id}" aria-selected="${activeTab === t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="grBody">${activeTab === 'list' ? renderList(list, bday) : renderChart(activeTab)}</div>
    ${renderMeds()}
    <p class="small muted" style="text-align:center;margin:8px 0 24px">数据本机保存并可云同步 · 曲线与增减仅供参考，非医疗建议</p>
  `;

  const q = (s) => root.querySelector(s);
  q('#btnGoSetBday') && (q('#btnGoSetBday').onclick = () => openBabyProfile({ onSaved: () => renderGrowth(root) }));
  q('#btnAddGrowth').onclick = () => openEditor(null, root);
  root.querySelectorAll('.gr-tab').forEach((btn) => {
    btn.onclick = () => { activeTab = btn.dataset.tab; renderGrowth(root); };
  });
  root.querySelectorAll('[data-gid]').forEach((el) => {
    el.onclick = () => openEditor(el.dataset.gid, root);
  });
  q('#btnAddMed').onclick = () => openMedEditor(null, root);
  root.querySelectorAll('[data-mid]').forEach((el) => {
    el.onclick = () => openMedEditor(el.dataset.mid, root);
  });
}

function renderList(list, bday) {
  if (!list.length) {
    return `<section class="card album-empty">
      <div style="font-size:48px;text-align:center">📏</div>
      <p style="text-align:center;margin:8px 0 4px;font-weight:700">还没有生长记录</p>
      <p class="small muted" style="text-align:center;margin:0">点右上角「添加」，记下身高、体重、头围。</p>
    </section>`;
  }
  return list.map((g) => {
    const age = ageOnDate(bday, g.date);
    const tip = deltaTip(g, list);
    return `<section class="card gr-card" data-gid="${esc(g.id)}" role="button" tabindex="0">
      <div class="gr-date">${esc(g.date)}${age ? ` <span class="gr-age">${esc(age)}</span>` : ''}</div>
      <div class="gr-tip">${esc(tip)}</div>
      <div class="gr-metrics">
        <div class="gr-m"><span class="gr-ml">身高</span><span class="gr-mv">${g.height != null ? esc(g.height) + ' cm' : '—'}</span></div>
        <div class="gr-m"><span class="gr-ml">体重</span><span class="gr-mv">${g.weight != null ? esc(g.weight) + ' kg' : '—'}</span></div>
        <div class="gr-m"><span class="gr-ml">头围</span><span class="gr-mv">${g.head != null ? esc(g.head) + ' cm' : '—'}</span></div>
      </div>
      ${g.note ? `<p class="gr-note">${esc(g.note)}</p>` : ''}
    </section>`;
  }).join('');
}

function renderChart(metric) {
  const meta = {
    height: { title: '身高曲线', unit: 'cm', color: '#20A98B' },
    weight: { title: '体重曲线', unit: 'kg', color: '#1F8FE5' },
    head: { title: '头围曲线', unit: 'cm', color: '#7B61FF' },
  }[metric];
  const pts = seriesFor(metric);
  return `<section class="card gr-chart-card">
    <h2 style="margin-top:0">${esc(meta.title)}</h2>
    <div class="gr-chart">${chartSvg(pts, { unit: meta.unit, color: meta.color })}</div>
    <p class="small muted" style="margin:8px 0 0">${pts.length ? `共 ${pts.length} 次测量` : '暂无数据'} · 非医疗建议</p>
  </section>`;
}

function openEditor(id, growthRoot) {
  const existing = id ? store.getGrowth(id) : null;
  const bday = store.state.settings.babyBirthday || '';
  const g = existing || { date: todayStr(), height: '', weight: '', head: '', note: '' };
  openSheet(`
    <h3>${existing ? '编辑记录' : '添加记录'}</h3>
    <div class="field"><label for="gr-date">日期</label>
      <input id="gr-date" type="date" class="input" value="${esc(g.date)}" ${bday ? `min="${esc(bday)}"` : ''} max="${esc(todayStr())}"></div>
    <div class="field"><label for="gr-h">身高（cm）</label>
      <input id="gr-h" type="number" class="input" inputmode="decimal" step="0.1" min="${HEIGHT_MIN}" max="${HEIGHT_MAX}"
        value="${g.height != null && g.height !== '' ? esc(g.height) : ''}" placeholder="例如 53.5"></div>
    <div class="field"><label for="gr-w">体重（kg）</label>
      <input id="gr-w" type="number" class="input" inputmode="decimal" step="0.01" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}"
        value="${g.weight != null && g.weight !== '' ? esc(g.weight) : ''}" placeholder="例如 4.2"></div>
    <div class="field"><label for="gr-hd">头围（cm，可不填）</label>
      <input id="gr-hd" type="number" class="input" inputmode="decimal" step="0.1" min="${HEAD_MIN}" max="${HEAD_MAX}"
        value="${g.head != null && g.head !== '' ? esc(g.head) : ''}" placeholder="可选"></div>
    <div class="field"><label for="gr-note">备注（可不填）</label>
      <input id="gr-note" class="input" maxlength="200" value="${esc(g.note || '')}" placeholder="可选：测量地点等"></div>
    <p class="small muted" id="grErr" hidden style="color:var(--danger);font-weight:700"></p>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn ghost" id="grCancel">取消</button>
      <button class="btn" id="grSave">保存</button>
    </div>
    ${existing ? `<div class="btn-row" style="margin-top:8px"><button class="btn danger" id="grDel">删除</button></div>` : ''}
  `, (sh) => {
    sh.querySelector('#grCancel').onclick = closeSheet;
    sh.querySelector('#grSave').onclick = () => {
      const payload = {
        id: existing?.id,
        date: sh.querySelector('#gr-date').value,
        height: sh.querySelector('#gr-h').value,
        weight: sh.querySelector('#gr-w').value,
        head: sh.querySelector('#gr-hd').value,
        note: sh.querySelector('#gr-note').value,
        createdAt: existing?.createdAt,
      };
      const err = validateGrowth(payload, bday);
      const errEl = sh.querySelector('#grErr');
      if (err) { errEl.hidden = false; errEl.textContent = err; return; }
      store.upsertGrowth(payload);
      toast(existing ? '已保存' : '已添加');
      closeSheet();
      renderGrowth(growthRoot);
    };
    const del = sh.querySelector('#grDel');
    if (del) del.onclick = async () => {
      const ok = await confirmSheet('确定删除这条生长记录吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      store.deleteGrowth(existing.id);
      toast('已删除');
      closeSheet();
      renderGrowth(growthRoot);
    };
  });
}

// v1.12.0 用药记录（放在生长记录下方）：在用排上面，已停用在下
function medRow(m, on) {
  return `<div class="md-row${on ? ' on' : ''}" data-mid="${esc(m.id)}" role="button" tabindex="0">
    <div class="md-top"><span class="md-name">${esc(m.name)}</span>${on ? '<span class="md-tag">在用</span>' : ''}</div>
    ${m.dose ? `<div class="md-dose">${esc(m.dose)}</div>` : ''}
    <div class="md-period">${esc(medPeriod(m))}</div>
    ${pillsHtml(m)}
    ${m.note ? `<div class="md-note">${esc(m.note)}</div>` : ''}
  </div>`;
}
function pillsHtml(m) {
  const d = medDoses(m);
  if (!d) return '';
  return `<div class="md-pills" aria-label="已用 ${d.done}/共 ${d.total} 次">
    <span class="md-pill-row">${d.list.map((e) => `<span class="md-pill${e.done ? ' on' : ''}" title="${esc(e.date)}${e.done ? ' 已用' : ''}"></span>`).join('')}</span>
    <span class="md-pill-txt">已用 ${d.done}/共 ${d.total} 次</span></div>`;
}
function renderMeds() {
  const { active, past } = medsSorted();
  return `<section class="card md-card" id="medsCard">
    <div class="md-head"><h2 style="margin:0">💊 用药记录</h2>
      <button class="btn secondary" id="btnAddMed" style="padding:6px 12px;flex:none">添加</button></div>
    ${!active.length && !past.length ? '<p class="small muted" style="margin:8px 0 0">还没有用药记录，点「添加」记下药品、剂量和开始日期。</p>' : ''}
    ${active.length ? `<div class="md-sec">在用 · ${active.length}</div>${active.map((m) => medRow(m, true)).join('')}` : ''}
    ${past.length ? `<div class="md-sec">已停用 / 单次 · ${past.length}</div>${past.map((m) => medRow(m, false)).join('')}` : ''}
  </section>`;
}

function openMedEditor(id, growthRoot) {
  const existing = id ? store.getMed(id) : null;
  const m = existing || { name: '', dose: '', start: todayStr(), end: '', note: '' };
  openSheet(`
    <h3>${existing ? '编辑用药' : '添加用药'}</h3>
    <div class="field"><label for="md-name">药品</label>
      <input id="md-name" class="input" maxlength="60" value="${esc(m.name)}" placeholder="例如 维生素AD"></div>
    <div class="field"><label for="md-dose">剂量 / 用法</label>
      <input id="md-dose" class="input" maxlength="80" value="${esc(m.dose)}" placeholder="例如 一天一粒"></div>
    <div class="field"><label for="md-start">开始日期</label>
      <input id="md-start" type="date" class="input" value="${esc(m.start)}"></div>
    <div class="field"><label for="md-end">结束日期（还在吃就不填）</label>
      <input id="md-end" type="date" class="input" value="${esc(m.end)}"></div>
    <div class="field"><label for="md-note">备注（可不填）</label>
      <input id="md-note" class="input" maxlength="200" value="${esc(m.note || '')}" placeholder="可选"></div>
    <p class="small muted" id="mdErr" hidden style="color:var(--danger);font-weight:700"></p>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn ghost" id="mdCancel">取消</button>
      ${existing && !existing.end ? '<button class="btn secondary" id="mdStop">今天停用</button>' : ''}
      <button class="btn" id="mdSave">保存</button>
    </div>
    ${existing ? '<div class="btn-row" style="margin-top:8px"><button class="btn danger" id="mdDel">删除</button></div>' : ''}
  `, (sh) => {
    const v = (s) => sh.querySelector(s).value;
    const save = (patch = {}) => {
      const p = { id: existing?.id, createdAt: existing?.createdAt, series: existing?.series || '', name: v('#md-name'), dose: v('#md-dose'), start: v('#md-start'), end: v('#md-end'), note: v('#md-note'), ...patch };
      const errEl = sh.querySelector('#mdErr');
      const err = !p.name.trim() ? '请填写药品' : !/^\d{4}-\d{2}-\d{2}$/.test(p.start) ? '请选择开始日期' : (p.end && p.end < p.start ? '结束日期不能早于开始日期' : '');
      if (err) { errEl.hidden = false; errEl.textContent = err; return; }
      store.upsertMed(p);
      toast(existing ? '已保存' : '已添加');
      closeSheet();
      renderGrowth(growthRoot);
    };
    sh.querySelector('#mdCancel').onclick = closeSheet;
    sh.querySelector('#mdSave').onclick = () => save();
    const stop = sh.querySelector('#mdStop');
    if (stop) stop.onclick = () => save({ end: todayStr() });
    const del = sh.querySelector('#mdDel');
    if (del) del.onclick = async () => {
      const ok = await confirmSheet('确定删除这条用药记录吗？其他家人同步后也会删掉。', '删除', true);
      if (!ok) return;
      store.deleteMed(existing.id);
      toast('已删除');
      closeSheet();
      renderGrowth(growthRoot);
    };
  });
}
