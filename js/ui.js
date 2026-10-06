// 通用 UI 工具
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
export function openSheet(html, onMount) {
  const sheet = $('#sheet'), bd = $('#sheetBackdrop');
  sheet.innerHTML = `<div class="grab"></div>${html}`;
  sheet.hidden = false; bd.hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.scrollTop = 0;
  bd.onclick = closeSheet;
  if (onMount) onMount(sheet);
  return sheet;
}
export function closeSheet() {
  $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
}
export function confirmSheet(message, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    openSheet(`<h3>${esc(message)}</h3><div class="btn-row"><button class="btn ghost" data-a="no">取消</button><button class="btn ${danger ? 'danger' : ''}" data-a="yes">${esc(okText)}</button></div>`, (s) => {
      s.querySelector('[data-a=no]').onclick = () => { closeSheet(); resolve(false); };
      s.querySelector('[data-a=yes]').onclick = () => { closeSheet(); resolve(true); };
    });
  });
}
