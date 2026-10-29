// v1.9.0 生长记录页：列表 + 身高/体重/头围曲线
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import { openBabyProfile } from './settings.js';
import { todayStr } from '../dates.js';
import {
  ageOnDate, growthSorted, deltaTip, validateGrowth, chartSvg, seriesFor,
  HEIGHT_MIN, HEIGHT_MAX, WEIGHT_MIN, WEIGHT_MAX, HEAD_MIN, HEAD_MAX,
} from '../growth.js';

const TABS = [
  { id: 'list', label: '记录列表' },
  { id: 'height', label: '身高曲线' },
  { id: 'weight', label: '体重曲线' },
  { id: 'head', label: '头围曲线' },
];

let activeTab = 'list';

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
