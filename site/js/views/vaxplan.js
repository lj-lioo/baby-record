// 一键生成计划（疫苗 / 体检共用）：根据宝宝生日生成预览列表，勾选后批量添加事项。
// 疫苗：国家免疫规划疫苗儿童免疫程序（vaccines.js）；体检：0～6岁儿童健康管理（checkups.js）；自费疫苗 + RSV单抗（paidvax.js）。
import { store, uid } from '../store.js';
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { todayStr, cnDate, weekday } from '../dates.js';
import { defaultReminders } from '../reminders.js';
import { planVaccines, NIP_SOURCE } from '../vaccines.js';
import { planCheckups, CHECKUP_SOURCE } from '../checkups.js';
import { planPaid } from '../paidvax.js';

const TIME = '09:00';
export const DEFAULT_BIRTHDAY = '2026-09-17';

const KINDS = {
  vaccine: {
    icon: '💉', title: '一键生成疫苗计划', unit: '剂', noun: '疫苗事项', category: 'vaccine', prefix: 'nip:',
    intro: `按《${NIP_SOURCE}》生成宝宝到 6 周岁的<b>免费（国家免疫规划）</b>疫苗日程，加到日程里的「疫苗」类别。13 周岁女孩的双价HPV疫苗（2026年版新纳入）列在最后，默认不勾选。`,
    disclaimer: '⚠️ 日期是按生日推算的<b>最早可接种日期</b>，实际接种日期以当地接种门诊（社区医院）预约和接种本为准；免疫程序如有调整，以门诊通知为准。',
    plan: (bday, events) => planVaccines(bday, todayStr(), events),
    pastLabel: (d) => (d.m === 0 ? '已过（出生时通常已在医院接种）' : '已过'),
    meta: (d) => [d.age, d.extra],
    next: '下一针',
  },
  checkup: {
    icon: '🩺', title: '一键生成体检计划', unit: '次', noun: '体检事项', category: 'checkup', prefix: 'chk:',
    intro: `按《${CHECKUP_SOURCE}》生成宝宝到 6 周岁的<b>免费儿保体检</b>（新生儿访视、满月、3～36月龄 8 次、4～6岁每年 1 次），加到日程里的「体检」类别。`,
    disclaimer: '⚠️ 日期是按生日推算的建议时间，实际体检日期以社区卫生服务中心（或妇幼保健院）预约为准；各地安排可能不同（如满月体检在 42 天做）。',
    plan: (bday, events) => planCheckups(bday, todayStr(), events),
    pastLabel: (d) => d.pastLabel || '已过',
    meta: (d) => [d.age],
    next: '下一次',
  },
  paid: {
    icon: '💰', title: '自费疫苗（可选）', unit: '项', noun: '自费疫苗事项', category: 'paidvax', prefix: 'paid:',
    intro: '常见<b>自费（非免疫规划）疫苗</b>的建议日程，加到日程里的「自费疫苗」类别（蓝色）。默认只勾选每类疫苗的常用方案；备选方案默认不勾选。<b>RSV单抗</b>已和乙肝第2剂安排在同一天。',
    disclaimer: '⚠️ 自费疫苗自愿接种，<b>是否接种、品牌和时间以接种门诊建议为准</b>。含免费疫苗成分的（如五联含百白破、脊灰）按说明书接种后可替代相应免费剂次，到时可删掉对应的免费事项。不同疫苗可同一天在不同部位接种；两种注射类活疫苗（如麻腮风、水痘）不同天接种须间隔≥28天。',
    plan: (bday, events) => planPaid(bday, todayStr(), events),
    pastLabel: () => '已过',
    meta: (d) => [d.age],
    next: '下一个',
    groupLabel: '备选方案（默认不添加，按需勾选）',
  },
};

export function planCounts(kind) {
  return store.events().filter((e) => (e.scheduleId || '').startsWith(KINDS[kind].prefix)).length;
}

export function openVaxPlan() { openPlan('vaccine'); }
export function openCheckupPlan() { openPlan('checkup'); }
export function openPaidPlan() { openPlan('paid'); }

export function openPlan(kind) {
  const K = KINDS[kind];
  const st = store.state.settings;
  openSheet(`
    <h3>${K.icon} ${K.title}</h3>
    <p class="small muted" style="margin-top:0">${K.intro}</p>
    <div class="field"><label for="vp-bday">宝宝生日</label>
      <input id="vp-bday" type="date" class="input" value="${esc(st.babyBirthday || DEFAULT_BIRTHDAY)}" max="${todayStr()}"></div>
    <div id="vp-body"></div>
    <p class="note small">${K.disclaimer}</p>
    <div class="btn-row" style="margin-top:6px">
      <button type="button" class="btn ghost" id="vp-cancel">取消</button>
      <button type="button" class="btn" id="vp-ok" disabled>添加</button>
    </div>`, (s) => {
    s.dataset.kind = kind;
    const q = (sel) => s.querySelector(sel);
    let plan = [];
    const picked = new Set();

    const updateBtn = () => {
      const n = plan.filter((d) => picked.has(d.scheduleId)).length;
      q('#vp-ok').disabled = n === 0;
      q('#vp-ok').textContent = n ? `添加 ${n} 个${K.noun}` : '添加';
    };
    const render = () => {
      const bday = q('#vp-bday').value;
      if (!bday) { plan = []; q('#vp-body').innerHTML = '<p class="muted small">请先选择宝宝生日。</p>'; updateBtn(); return; }
      plan = K.plan(bday, store.events());
      picked.clear();
      for (const d of plan) if (!d.past && !d.existing && !d.optional) picked.add(d.scheduleId);
      const nNew = picked.size;
      const nHave = plan.filter((d) => d.existing).length;
      q('#vp-body').innerHTML = `
        <p class="small" style="margin:0 0 6px">共 ${plan.length} ${K.unit}：将添加 <b>${nNew}</b> 个未来的${K.noun}${nHave ? `，${nHave} 个已添加过（不会重复添加）` : ''}。每个事项时间 ${TIME}，提醒：前一天 20:00、当天 08:00（之后可在事项里修改）。</p>
        <ul class="vp-list">${plan.map((d, i) => {
          const group = K.groupLabel && d.optional && !plan[i - 1]?.optional ? `<li class="vp-group">${esc(K.groupLabel)}</li>` : '';
          const status = d.existing ? '<span class="vp-st ok">已添加</span>'
            : d.past ? `<span class="vp-st">${esc(K.pastLabel(d))}</span>` : '';
          const hint = d.existing ? '' : d.past ? '勾选可作为「已完成」的记录添加' : d.optional ? (d.hint || '可选，默认不添加') : '';
          return `${group}<li class="vp-item ${d.past ? 'is-past' : ''} ${d.existing ? 'is-have' : ''} ${d.optional ? 'is-opt' : ''} ${d.required ? 'is-req' : ''}">
            <label>
              <input type="checkbox" data-sid="${esc(d.scheduleId)}" ${picked.has(d.scheduleId) ? 'checked' : ''} ${d.existing ? 'disabled' : ''}>
              <span class="vp-main"><span class="vp-title">${esc(d.title)}</span>
                <span class="vp-meta">${[`${cnDate(d.date, true)} ${weekday(d.date)}`, ...K.meta(d)].filter(Boolean).map(esc).join(' · ')}</span>
                ${status}${hint ? `<span class="vp-hint">${esc(hint)}</span>` : ''}</span>
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
        id: uid(), date: d.date, time: TIME, title: d.title, category: K.category, note: d.note,
        done: d.past, // 已过的作为「已完成」的历史记录，不再提醒
        reminders: d.past ? [] : defaultReminders(false),
        scheduleId: d.scheduleId,
      }));
      if (bday !== store.state.settings.babyBirthday) store.updateSettings({ babyBirthday: bday });
      const added = store.addEvents(list);
      closeSheet();
      const next = added.filter((e) => !e.done).sort((a, b) => a.date.localeCompare(b.date))[0];
      toast(`已添加 ${added.length} 个${K.noun}${next ? `，${K.next}：${cnDate(next.date)} ${next.title}` : ''}`, 3500);
      if (next) window.dispatchEvent(new CustomEvent('select-date', { detail: next.date }));
      if (!/^#\/?(home)?$/.test(location.hash)) location.hash = '#/';
    };
    render();
  });
}
