// 一键生成疫苗计划：按国家免疫规划疫苗儿童免疫程序，根据宝宝生日批量添加疫苗事项
import { store, uid } from '../store.js';
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { todayStr, cnDate, weekday } from '../dates.js';
import { defaultReminders } from '../reminders.js';
import { planVaccines, NIP_SOURCE } from '../vaccines.js';

const TIME = '09:00';

export function openVaxPlan() {
  const st = store.state.settings;
  openSheet(`
    <h3>💉 一键生成疫苗计划</h3>
    <p class="small muted" style="margin-top:0">按《${esc(NIP_SOURCE)}》生成宝宝到 6 周岁的<b>免费（国家免疫规划）</b>疫苗日程，加到日程里的「疫苗」类别。</p>
    <div class="field"><label for="vp-bday">宝宝生日</label>
      <input id="vp-bday" type="date" class="input" value="${esc(st.babyBirthday || '')}" max="${todayStr()}"></div>
    <div id="vp-body"></div>
    <p class="note small">⚠️ 日期是按生日推算的<b>最早可接种日期</b>，实际接种日期以当地接种门诊（社区医院）预约和接种本为准；免疫程序如有调整，以门诊通知为准。</p>
    <div class="btn-row" style="margin-top:6px">
      <button type="button" class="btn ghost" id="vp-cancel">取消</button>
      <button type="button" class="btn" id="vp-ok" disabled>添加</button>
    </div>`, (s) => {
    const q = (sel) => s.querySelector(sel);
    let plan = [];
    const picked = new Set();

    const updateBtn = () => {
      const n = plan.filter((d) => picked.has(d.scheduleId)).length;
      q('#vp-ok').disabled = n === 0;
      q('#vp-ok').textContent = n ? `添加 ${n} 个疫苗事项` : '添加';
    };
    const render = () => {
      const bday = q('#vp-bday').value;
      if (!bday) { plan = []; q('#vp-body').innerHTML = '<p class="muted small">请先选择宝宝生日。</p>'; updateBtn(); return; }
      plan = planVaccines(bday, todayStr(), store.events());
      picked.clear();
      for (const d of plan) if (!d.past && !d.existing) picked.add(d.scheduleId);
      const nNew = plan.filter((d) => !d.past && !d.existing).length;
      const nHave = plan.filter((d) => d.existing).length;
      q('#vp-body').innerHTML = `
        <p class="small" style="margin:0 0 6px">共 ${plan.length} 剂：将添加 <b>${nNew}</b> 个未来的疫苗事项${nHave ? `，${nHave} 个已添加过（不会重复添加）` : ''}。每个事项时间 ${TIME}，提醒：前一天 20:00、当天 08:00（之后可在事项里修改）。</p>
        <ul class="vp-list">${plan.map((d) => {
          const status = d.existing ? '<span class="vp-st ok">已添加</span>'
            : d.past ? `<span class="vp-st">${d.m === 0 ? '已过（出生时通常已在医院接种）' : '已过'}</span>` : '';
          return `<li class="vp-item ${d.past ? 'is-past' : ''} ${d.existing ? 'is-have' : ''}">
            <label>
              <input type="checkbox" data-sid="${esc(d.scheduleId)}" ${picked.has(d.scheduleId) ? 'checked' : ''} ${d.existing ? 'disabled' : ''}>
              <span class="vp-main"><span class="vp-title">${esc(d.title)}</span>
                <span class="vp-meta">${cnDate(d.date, true)} ${weekday(d.date)} · ${esc(d.age)}${d.extra ? ` · ${esc(d.extra)}` : ''}</span>
                ${status}${d.past && !d.existing ? '<span class="vp-hint">勾选可作为「已完成」的接种记录添加</span>' : ''}</span>
            </label></li>`;
        }).join('')}</ul>`;
      q('#vp-body').querySelectorAll('input[data-sid]').forEach((cb) => {
        cb.onchange = () => { if (cb.checked) picked.add(cb.dataset.sid); else picked.delete(cb.dataset.sid); updateBtn(); };
      });
      updateBtn();
    };
    q('#vp-bday').onchange = render;
    q('#vp-cancel').onclick = closeSheet;
    q('#vp-ok').onclick = () => {
      const bday = q('#vp-bday').value;
      const list = plan.filter((d) => picked.has(d.scheduleId) && !d.existing).map((d) => ({
        id: uid(), date: d.date, time: TIME, title: d.title, category: 'vaccine', note: d.note,
        done: d.past, // 已过的剂次作为「已完成」的历史记录，不再提醒
        reminders: d.past ? [] : defaultReminders(false),
        scheduleId: d.scheduleId,
      }));
      if (bday !== store.state.settings.babyBirthday) store.updateSettings({ babyBirthday: bday });
      const added = store.addEvents(list);
      closeSheet();
      const next = added.filter((e) => !e.done).sort((a, b) => a.date.localeCompare(b.date))[0];
      toast(`已添加 ${added.length} 个疫苗事项${next ? `，下一针：${cnDate(next.date)} ${next.title}` : ''}`, 3500);
      if (next) window.dispatchEvent(new CustomEvent('select-date', { detail: next.date }));
      if (!/^#\/?(home)?$/.test(location.hash)) location.hash = '#/';
    };
    render();
  });
}
