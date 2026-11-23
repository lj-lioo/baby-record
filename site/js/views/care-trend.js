import { hasCareRecords } from '../care.js';
import { cnDate } from '../dates.js';
import { esc } from '../ui.js';

const LEFT = 2;
const WIDTH = 96;
const TOP = 8;
const BOTTOM = 94;

export function careTrend(daily, metric, title) {
  const unit = metric === 'bottleMl' ? 'mL' : '次';
  const last = daily.length - 1;
  const values = daily.map((day) => hasCareRecords(day) ? day[metric] : null);
  const max = Math.max(1, ...values);
  const points = daily.map((day, i) => ({
    date: cnDate(day.date),
    value: values[i],
    x: LEFT + i / last * WIDTH,
    y: BOTTOM - values[i] / max * (BOTTOM - TOP),
  }));
  const path = points.map((point, i) => {
    if (point.value === null) return '';
    return (i && values[i - 1] !== null ? 'L' : 'M') + `${point.x},${point.y}`;
  }).filter(Boolean).join(' ');
  const isolated = points.filter((point, i) =>
    point.value !== null && values[i - 1] == null && values[i + 1] == null);
  const html = `
    <p class="care-chart-readout small" id="care-chart-readout" aria-hidden="true"></p>
    <div class="care-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="care-chart-grid" d="M0 ${TOP}H100 M0 ${(TOP + BOTTOM) / 2}H100 M0 ${BOTTOM}H100"/>
        <path class="care-chart-line" d="${path}"/>
      </svg>
      ${isolated.map(({ x, y }) => `<span class="care-chart-dot" style="left:${x}%;top:${y}%" aria-hidden="true"></span>`).join('')}
      <span class="care-chart-guide" aria-hidden="true"></span>
      <span class="care-chart-dot care-chart-active" aria-hidden="true"></span>
      <input class="care-chart-picker" type="range" min="0" max="${last}" step="1" aria-label="${esc(title)}每日数据">
    </div>
    <div class="care-axis small muted"><span>${points[0].date}</span><span>${points[last].date}</span></div>`;

  function bind(root) {
    const input = root.querySelector('.care-chart-picker');
    const chart = input.parentElement;
    const readout = root.querySelector('#care-chart-readout');
    const dot = chart.querySelector('.care-chart-active');
    const guide = chart.querySelector('.care-chart-guide');
    const select = (index) => {
      const { date, value, x, y } = points[index];
      const label = `${date} · ${value === null ? '无记录' : `${value} ${unit}`}`;
      input.value = index;
      input.setAttribute('aria-valuetext', label);
      readout.textContent = label;
      guide.style.left = dot.style.left = `${x}%`;
      dot.style.top = `${y}%`;
      dot.hidden = value === null;
    };
    const selectAt = (event) => {
      const box = chart.getBoundingClientRect();
      const ratio = ((event.clientX - box.left) / box.width * 100 - LEFT) / WIDTH;
      select(Math.max(0, Math.min(last, Math.round(ratio * last))));
    };
    input.oninput = () => select(input.valueAsNumber);
    input.onpointerdown = (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      input.setPointerCapture(event.pointerId);
      selectAt(event);
    };
    input.onpointermove = (event) => {
      if (event.isPrimary && (event.pointerType === 'mouse' || input.hasPointerCapture(event.pointerId))) selectAt(event);
    };
    select(last);
  }

  return { html, bind };
}
