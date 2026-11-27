import { CARE_LABELS, careDay, careDetail, normalizeCare, validateCare } from '../care.js';
import { toLocalInput } from '../dates.js';
import { requireEditEvents } from '../roles.js';
import { store } from '../store.js';
import { closeSheet, esc, openSheet, toast } from '../ui.js';

function parseRecords(text) {
  const data = JSON.parse(text);
  if (data?.format !== 'baby-record-care-v1' || !Array.isArray(data.records) || !data.records.length) {
    throw new Error('请选择喂养补录文件');
  }
  const seen = new Set();
  const latest = toLocalInput(Date.now());
  return data.records.map((input, i) => {
    const error = input && typeof input.date === 'string' && typeof input.time === 'string'
      ? validateCare(input, latest) : '请选择日期和时间';
    if (error) throw new Error(`第 ${i + 1} 条：${error}`);
    if (typeof input.id !== 'string' || !/^[a-z0-9_-]{1,53}$/i.test(input.id) || seen.has(input.id)) {
      throw new Error(`第 ${i + 1} 条的编号无效或重复`);
    }
    seen.add(input.id);
    return normalizeCare({ ...input, id: 'import-' + input.id, updatedAt: 1, deleted: false });
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function preview(records) {
  const existing = store.careForSync();
  const existingIds = new Set(existing.map((item) => item.id));
  return records.filter((record) => !existingIds.has(record.id)).map((record) => ({
    record,
    possibleDuplicate: existing.some((item) => {
      if (item.deleted || item.kind !== record.kind || item.date !== record.date) return false;
      if (record.kind !== 'dose') return item.time === record.time;
      return item.name === record.name && (!item.time || !record.time || item.time === record.time);
    }),
  }));
}

function review(records, onSaved, message = '') {
  const rows = preview(records);
  const skipped = records.length - rows.length;
  const duplicates = rows.filter((row) => row.possibleDuplicate).length;
  const paperDays = [...new Set(rows.filter(({ record }) => record.paper).map(({ record }) => careDay(record)))];
  openSheet(`<h3>核对补录记录</h3>
    <p class="small" aria-live="polite" id="care-import-summary"></p>
    ${paperDays.length ? `<p class="small muted">纸本共 ${paperDays.length} 页，每页 08:00 至次日 08:00。</p>` : ''}
    ${skipped ? `<p class="small muted">已处理的 ${skipped} 条已跳过。</p>` : ''}
    ${duplicates ? `<p class="small muted">有 ${duplicates} 条可能重复，默认跳过。确认是不同记录时可勾选。</p>` : ''}
    <p class="small care-error" id="care-import-error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
    <div class="btn-row">
      <button type="button" class="btn ghost" id="care-import-cancel">${rows.length ? '取消' : '关闭'}</button>
      ${rows.length ? '<button type="button" class="btn" id="care-import-save">确认补录</button>' : ''}
    </div>
    <ul class="care-import-list">${rows.map(({ record, possibleDuplicate }) => {
      const title = record.kind === 'dose' ? record.name : CARE_LABELS[record.kind];
      const day = careDay(record);
      const time = record.time || '时间未记';
      const detail = [careDetail(record), record.note, possibleDuplicate && '可能重复'].filter(Boolean);
      return `<li><label><input type="checkbox" value="${esc(record.id)}" ${possibleDuplicate ? '' : 'checked'}>
        <span>${[day, day !== record.date ? '次日 ' + time : time, title, ...detail].map(esc).join(' · ')}</span></label></li>`;
    }).join('')}</ul>`, (sheet) => {
    sheet.querySelector('#care-import-cancel').onclick = closeSheet;
    const save = sheet.querySelector('#care-import-save');
    const summary = sheet.querySelector('#care-import-summary');
    const inputs = [...sheet.querySelectorAll('input[type="checkbox"]')];
    const selected = () => new Set(inputs.filter((input) => input.checked).map((input) => input.value));
    const refresh = () => {
      const count = selected().size;
      summary.textContent = rows.length ? `已选 ${count} / ${rows.length} 条记录` : '没有需要补录的新记录。';
      if (save) save.disabled = !count;
    };
    refresh();
    if (!save) return;
    sheet.querySelector('.care-import-list').onchange = refresh;
    save.onclick = () => {
      if (!requireEditEvents()) return;
      const ids = selected();
      const previouslyMarked = new Set(rows.filter((row) => row.possibleDuplicate).map((row) => row.record.id));
      const current = preview(records).filter((row) => ids.has(row.record.id));
      if (current.some((row) => row.possibleDuplicate && !previouslyMarked.has(row.record.id))) {
        review(records, onSaved, '刚收到其他设备的新记录，请重新核对可能重复的条目。');
        return;
      }
      let added;
      try { added = store.appendImportedCare(current.map((row) => row.record)); }
      catch {
        const error = sheet.querySelector('#care-import-error');
        error.textContent = '本机保存失败，请重试。';
        error.hidden = false;
        return;
      }
      closeSheet();
      if (added.length) onSaved(added);
      toast(added.length ? `已补录 ${added.length} 条` : '没有需要补录的新记录。');
    };
  });
}

export function openCareImport(onSaved) {
  if (!requireEditEvents('当前身份可以查看喂养记录')) return;
  openSheet(`<h3>批量补录</h3>
    <p class="small muted">先选取喂养补录文件，核对并确认后写入记录。</p>
    <input type="file" id="care-import-file" accept=".json,application/json" aria-label="选择喂养补录文件" hidden>
    <p class="small care-error" id="care-import-error" role="alert" hidden></p>
    <div class="btn-row">
      <button type="button" class="btn ghost" id="care-import-cancel">取消</button>
      <button type="button" class="btn" id="care-import-pick">选择文件</button>
    </div>`, (sheet) => {
    const input = sheet.querySelector('#care-import-file');
    const pick = sheet.querySelector('#care-import-pick');
    sheet.querySelector('#care-import-cancel').onclick = closeSheet;
    pick.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      input.value = '';
      pick.disabled = true;
      try {
        if (file.size > 512 * 1024) throw new Error('文件超过 512 KB，请分批补录');
        const records = parseRecords(await file.text());
        if (input.isConnected) review(records, onSaved);
      } catch (err) {
        if (!input.isConnected) return;
        const error = sheet.querySelector('#care-import-error');
        error.textContent = err instanceof SyntaxError ? '文件格式无效，请选择喂养补录文件。' : err.message;
        error.hidden = false;
      } finally { pick.disabled = false; }
    };
  });
}
