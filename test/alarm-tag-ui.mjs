// v1.7.1 端到端（iPhone 尺寸）：闹钟事项标记 <宝宝#id>、重设替换旧闹钟、「🗑 删除旧闹钟」、帮助页「新增」步骤；截图 27～31。BASE=... 可指定地址
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = '/workspace/baby-app/screenshots/';
const APP_V = /APP_BUILD = '([^']+)'/.exec(fs.readFileSync(new URL('../site/js/views/settings.js', import.meta.url), 'utf8'))[1];
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };
// 快捷指令「宝宝闹钟删除」里「匹配文本」用的正则（帮助页原样写给用户）
const SHORTCUT_RE = '宝宝#[0-9a-z]+>';

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-10-06T17:00:00+08:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push/i.test(m.text())) errors.push(m.text()); });
await page.goto(BASE);
await page.evaluate(() => { localStorage.setItem('babyrecord.hideBanner', '1'); localStorage.setItem('babyrecord.hideChkCta', '1'); });
await page.reload(); await page.waitForTimeout(800);
const sheetKind = () => page.evaluate(() => { const s = document.getElementById('sheet'); return s.hidden ? '' : (s.dataset.kind || 'other'); });
const hideToast = () => page.evaluate(() => { document.activeElement?.blur(); const t = document.getElementById('toast'); if (t) t.hidden = true; });
const getEv = (id) => page.evaluate(async (id) => (await import('./js/store.js')).store.getEvent(id), id);
const preventNav = (sel) => page.evaluate((sel) => document.querySelector(sel).addEventListener('click', (e) => e.preventDefault()), sel);
const params = (href) => { const u = new URL(href); return { name: u.searchParams.get('name'), input: u.searchParams.get('input'), text: u.searchParams.get('text') }; };

// 两个事项（10-20 疫苗、10-21 体检），各 2 个提醒（前一天 20:00、当天 08:00）
await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const r = (p) => ({ id: 'r-' + p + Math.random().toString(36).slice(2, 5), kind: 'preset', preset: p });
  store.upsertEvent({ id: 'mga1b2c3d4e5f', title: '打乙肝疫苗第2针', date: '2026-10-20', time: '10:00', category: 'vaccine', note: '带疫苗本', reminders: [r('eve20'), r('morning8')], done: false });
  store.upsertEvent({ id: 'mgz9y8x7w6v5u', title: '满月体检', date: '2026-10-21', time: '09:00', category: 'checkup', note: '', reminders: [r('eve20'), r('morning8')], done: false });
  store.upsertEvent({ id: 'Imported_ID-7', title: '导入的事项', date: '2026-10-22', time: '', category: 'other', note: 'x', reminders: [r('morning8')], done: false });
});

// —— 1. 载荷格式：时间|标题|备注，备注末尾带 <宝宝#事项id> ——
const pay = await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const S = await import('./js/shortcuts.js');
  const a = store.getEvent('mga1b2c3d4e5f'), b = store.getEvent('mgz9y8x7w6v5u'), c = store.getEvent('Imported_ID-7');
  return { a: S.alarmLines(a), b: S.alarmLines(b), c: S.alarmLines(c), tagC: S.alarmTag(c), tagC2: S.alarmTag({ id: 'Imported_ID-7' }), test: decodeURIComponent(S.testAlarmUrl()), url: S.alarmUrl(a), del: S.deleteAlarmUrl([a, b, a]), delName: S.deleteShortcutName() };
});
console.log('payload:\n' + pay.a.join('\n'));
ok('每行仍是 3 个字段（时间|标题|备注），旧快捷指令照常工作', [...pay.a, ...pay.b].every((l) => l.split('|').length === 3 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|【宝宝】.+\|.+$/.test(l)));
ok('备注（最后一个字段）末尾是「 · <宝宝#事项id>」', pay.a.every((l) => l.endsWith(' · <宝宝#mga1b2c3d4e5f>')) && pay.b.every((l) => l.endsWith(' · <宝宝#mgz9y8x7w6v5u>')), pay.a[0].split('|')[2]);
ok('原来的备注内容不变（类别 · 日期时间 · 提醒说明 · 备注：…）', pay.a[0].split('|')[2] === '💉疫苗 · 10月20日 10:00 · 前一天 20:00提醒 · 备注：带疫苗本 · <宝宝#mga1b2c3d4e5f>', pay.a[0].split('|')[2]);
const re = new RegExp(SHORTCUT_RE, 'g');
ok(`快捷指令的正则 ${SHORTCUT_RE} 每行正好取出本事项的标记`, pay.a.every((l) => JSON.stringify(l.match(re)) === JSON.stringify(['宝宝#mga1b2c3d4e5f>'])));
ok('非常规 id（导入的）用稳定的短哈希，正则同样能取出', /^<宝宝#x[0-9a-z]+>$/.test(pay.tagC) && pay.tagC === pay.tagC2 && pay.c[0].match(re).length === 1, pay.tagC);
ok('测试闹钟带固定标记 <宝宝#test>（再测一次会替换上一次）', pay.test.endsWith('|宝宝记录 · 测试紧急提醒是否会像闹钟一样响 · <宝宝#test>'));
const pd = params(pay.del);
ok('删除快捷指令 URL：name=宝宝闹钟删除、input=text、每行一个标记（去重）', pay.delName === '宝宝闹钟删除' && pd.name === '宝宝闹钟删除' && pd.input === 'text' && pd.text === '<宝宝#mga1b2c3d4e5f>\n<宝宝#mgz9y8x7w6v5u>', JSON.stringify(pd));

// —— 2. 模拟两个快捷指令在「提醒事项 · 宝宝」上的效果 ——
// 宝宝闹钟 =「运行快捷指令 宝宝闹钟删除（输入=快捷指令输入）」+ 原来的循环；宝宝闹钟删除 = 匹配文本 → 重复每一项 → 查找（列表 是 宝宝 且 备注 包含 重复项目）→ 如果有任何值 → 移除
const box = [];
const delShortcut = (input) => { for (const m of (input.match(new RegExp(SHORTCUT_RE, 'g')) || [])) { const hit = box.filter((x) => x.list === '宝宝' && x.notes.includes(m)); if (hit.length) hit.forEach((h) => box.splice(box.indexOf(h), 1)); } };
const alarmShortcut = (input, updated = true) => { if (updated) delShortcut(input); for (const line of input.split('\n')) { const f = line.split('|'); box.push({ list: '宝宝', due: f[0], title: f[1], notes: f[f.length - 1] }); } };
box.push({ list: '宝宝', due: '2026-10-19 20:00', title: '【宝宝】明天 10:00 打乙肝疫苗第2针', notes: '💉疫苗 · 10月20日 10:00 · 前一天 20:00 · 备注：带疫苗本' }); // v1.7.1 之前建的（无标记）
box.push({ list: '其他', due: '2026-10-19 20:00', title: '别的列表', notes: '<宝宝#mga1b2c3d4e5f>' });
alarmShortcut(pay.a.join('\n')); alarmShortcut(pay.b.join('\n'));
const nA = () => box.filter((x) => x.notes.includes('<宝宝#mga1b2c3d4e5f>') && x.list === '宝宝').length;
ok('第一次设闹钟：A 2 条 + B 2 条（旧的无标记 1 条、别的列表 1 条不受影响）', box.length === 6 && nA() === 2);
const a2 = await page.evaluate(async () => { const { store } = await import('./js/store.js'); const S = await import('./js/shortcuts.js'); const orig = store.getEvent('mga1b2c3d4e5f'); store.upsertEvent({ ...orig, date: '2026-10-24' }); const lines = S.alarmLines(store.getEvent(orig.id)); store.upsertEvent(orig); return lines; });
alarmShortcut(a2.join('\n'));
ok('改计划日后重设 A：A 的旧 2 条被删除、换成新的 2 条（10-23 20:00 / 10-24 08:00），B 不变', nA() === 2 && box.filter((x) => x.notes.includes('mga1b2c3d4e5f') && x.list === '宝宝').every((x) => x.due.startsWith('2026-10-23') || x.due.startsWith('2026-10-24'))
  && box.filter((x) => x.notes.includes('mgz9y8x7w6v5u')).length === 2 && box.length === 6, box.map((x) => x.due).join(','));
ok('v1.7.1 之前的无标记旧提醒不会被自动删除（需手动删一次）', box.some((x) => !x.notes.includes('<宝宝#') && x.list === '宝宝'));
delShortcut(params(pay.del).text);
ok('「🗑 删除旧闹钟」A+B：宝宝列表里 A、B 的提醒全部删除；别的列表、无标记的保留', box.length === 2 && !box.some((x) => x.list === '宝宝' && x.notes.includes('<宝宝#')));
const beforeEmpty = box.length; delShortcut('没有标记的文本'); delShortcut('');
ok('输入里没有标记时什么都不删（「重复每一项」0 次）', box.length === beforeEmpty);
const oldShortcutBox = []; for (const line of pay.a) { const f = line.split('|'); oldShortcutBox.push({ due: f[0], title: f[1], notes: f.at(-1) }); }
ok('没更新的旧快捷指令：照常建 2 条，标题不含标记（全屏闹钟显示不受影响）', oldShortcutBox.length === 2 && oldShortcutBox.every((x) => !x.title.includes('<宝宝#')));

// —— 3. 闹钟面板 ——
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-20' }))); await page.waitForTimeout(400);
await page.click('.item[data-id="mga1b2c3d4e5f"] [data-act=alarm]'); await page.waitForSelector('#al-go');
ok('第一次设闹钟：没有「删除旧闹钟」按钮；按钮「创建 2 个闹钟提醒」', (await page.locator('#al-del').count()) === 0 && (await page.textContent('#al-go')).includes('创建 2 个闹钟提醒'));
const goP = params(await page.getAttribute('#al-go', 'href'));
ok('闹钟 URL 的文本带标记', goP.name === '宝宝闹钟' && goP.text.split('\n').every((l) => l.endsWith('<宝宝#mga1b2c3d4e5f>')));
await preventNav('#al-go'); await page.click('#al-go'); await page.waitForTimeout(300);
let A = await getEv('mga1b2c3d4e5f');
ok('点击后：已设闹钟 + alarmTagged（带标记建的）', A.alarmAdded && A.alarmTagged && A.alarmSig);
await page.click('#al-close'); await page.waitForTimeout(200);
await page.click('.item[data-id="mga1b2c3d4e5f"] [data-act=alarm]'); await page.waitForSelector('#al-go');
let txt = await page.locator('#sheet').innerText();
ok('再打开：说明「再点一次会先删除旧的再新建」，按钮「替换为 2 个新闹钟提醒」+「🗑 删除旧闹钟」', txt.includes('先删除旧的') && (await page.textContent('#al-go')).includes('替换为 2 个新闹钟提醒') && (await page.textContent('#al-del')).trim() === '🗑 删除旧闹钟');
const delP = params(await page.getAttribute('#al-del', 'href'));
ok('「🗑 删除旧闹钟」运行「宝宝闹钟删除」，输入 = <宝宝#事项id>', delP.name === '宝宝闹钟删除' && delP.input === 'text' && delP.text === '<宝宝#mga1b2c3d4e5f>', JSON.stringify(delP));
await page.click('#al-close');
// 改计划日 → 需重设闹钟
await page.click('.item[data-id="mga1b2c3d4e5f"] [data-act=plan]'); await page.waitForSelector('#pd-date');
await page.fill('#pd-date', '2026-10-24'); await page.dispatchEvent('#pd-date', 'input'); await page.waitForTimeout(100); await page.click('#pd-save'); await page.waitForTimeout(500);
ok('改计划日后卡片显示「重设闹钟」', (await page.locator('.item[data-id="mga1b2c3d4e5f"] .alarm-btn').innerText()).includes('重设'));
await page.click('.item[data-id="mga1b2c3d4e5f"] [data-act=alarm]'); await page.waitForSelector('#al-go');
txt = await page.locator('#sheet').innerText();
ok('需重设：说明「先自动删除旧的，再按新时间创建」，新 URL 带同一个标记、新时间', txt.includes('先自动删除旧的') && params(await page.getAttribute('#al-go', 'href')).text.startsWith('2026-10-23 20:00|') && params(await page.getAttribute('#al-go', 'href')).text.includes('<宝宝#mga1b2c3d4e5f>'));
await hideToast(); await page.waitForTimeout(200);
await page.screenshot({ path: SHOTS + '30-alarm-sheet-replace.png' });
await preventNav('#al-del'); await page.click('#al-del'); await page.waitForTimeout(300);
A = await getEv('mga1b2c3d4e5f');
ok('点「🗑 删除旧闹钟」后取消「已设闹钟」标记', !A.alarmAdded && !A.alarmTagged && !(await page.isChecked('#al-added')));
await page.click('#al-close');

// —— 4. v1.7.1 之前的旧闹钟（无标记）——
await page.evaluate(async () => { const { store } = await import('./js/store.js'); const { alarmSig } = await import('./js/shortcuts.js'); const e = store.getEvent('mgz9y8x7w6v5u'); store.setAlarmAdded(e.id, true, alarmSig(e)); });
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-21' }))); await page.waitForTimeout(400);
await page.click('.item[data-id="mgz9y8x7w6v5u"] [data-act=alarm]'); await page.waitForSelector('#al-go');
txt = await page.locator('#sheet').innerText();
ok('旧闹钟（无标记）：说明会重复添加、需手动删除（提醒事项 → 宝宝 → 左滑 → 删除），没有「删除旧闹钟」', txt.includes('v1.7.1 之前设置的') && txt.includes('向左轻扫') && (await page.locator('#al-del').count()) === 0);
await page.click('#al-close');

// —— 5. 删除事项 → 「🗑 删除旧闹钟？」——
await page.evaluate(async () => { const { store } = await import('./js/store.js'); const { alarmSig } = await import('./js/shortcuts.js'); const e = store.getEvent('mga1b2c3d4e5f'); store.setAlarmAdded(e.id, true, alarmSig(e), true); });
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-24' }))); await page.waitForTimeout(400);
await page.click('.item[data-id="mga1b2c3d4e5f"] [data-act=edit]'); await page.waitForSelector('#f-del');
await page.click('#f-del'); await page.waitForTimeout(200); await page.click('#sheet [data-a=yes]'); await page.waitForTimeout(400);
txt = await page.locator('#sheet').innerText();
ok('删除设过闹钟的事项 → 弹出「🗑 删除旧闹钟？」，说明到点还会响', (await sheetKind()) === 'alarmclean' && txt.includes('「打乙肝疫苗第2针」已删除') && txt.includes('到点还会响'));
const ocP = params(await page.getAttribute('#oc-go', 'href'));
ok('「🗑 删除旧闹钟（1 个事项）」运行「宝宝闹钟删除」，输入 = 标记', (await page.textContent('#oc-go')).includes('删除旧闹钟（1 个事项）') && ocP.name === '宝宝闹钟删除' && ocP.text === '<宝宝#mga1b2c3d4e5f>');
ok('事项已删除', !(await getEv('mga1b2c3d4e5f')));
await hideToast(); await page.waitForTimeout(200);
await page.screenshot({ path: SHOTS + '31-delete-old-alarm-prompt.png' });
await page.click('#oc-no'); await page.waitForTimeout(200);
ok('点「不用了」关闭', (await sheetKind()) === '');
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-21' }))); await page.waitForTimeout(400);
await page.click('.item[data-id="mgz9y8x7w6v5u"] [data-act=edit]'); await page.waitForSelector('#f-del');
await page.click('#f-del'); await page.waitForTimeout(200); await page.click('#sheet [data-a=yes]'); await page.waitForTimeout(400);
txt = await page.locator('#sheet').innerText();
ok('删除旧闹钟（无标记）的事项 → 只给手动删除说明，按钮「知道了」', (await sheetKind()) === 'alarmclean' && (await page.locator('#oc-go').count()) === 0 && txt.includes('向左轻扫') && (await page.textContent('#oc-no')).trim() === '知道了');
await page.click('#oc-no');
await page.evaluate(() => window.dispatchEvent(new CustomEvent('select-date', { detail: '2026-10-22' }))); await page.waitForTimeout(300);
await page.click('.item[data-id="Imported_ID-7"] [data-act=edit]'); await page.waitForSelector('#f-del');
await page.click('#f-del'); await page.waitForTimeout(200); await page.click('#sheet [data-a=yes]'); await page.waitForTimeout(400);
ok('删除没设过闹钟的事项：不弹提示', (await sheetKind()) === '');

// —— 6. 设置页 + 帮助页「新增」——
await page.goto(BASE + '#/settings'); await page.waitForTimeout(400);
ok(`设置页版本 v${APP_V}`, (await page.textContent('#appVer')).includes(`宝宝记录 v${APP_V}`));
ok('设置页说明删除用的快捷指令名称「宝宝闹钟删除」', (await page.locator('#lnkReplace').locator('..').innerText()).includes('宝宝闹钟删除'));
await page.fill('#scName', '宝宝提醒'); await page.dispatchEvent('#scName', 'change'); await page.waitForTimeout(200);
const nm = await page.evaluate(async () => { const S = await import('./js/shortcuts.js'); return [S.shortcutName(), S.deleteShortcutName()]; });
ok('改了快捷指令名称 → 删除快捷指令名称跟着变（名称 + 删除）', nm[0] === '宝宝提醒' && nm[1] === '宝宝提醒删除');
await page.fill('#scName', '宝宝闹钟'); await page.dispatchEvent('#scName', 'change'); await page.waitForTimeout(200);
await page.click('#lnkReplace'); await page.waitForTimeout(800);
ok('设置页链接跳到帮助页「新增」', page.url().endsWith('#/help') && (await page.evaluate(() => Math.abs(document.getElementById('h-replace').getBoundingClientRect().top) < 120)));
const help = await page.locator('#h-shortcut').innerText();
ok('帮助页保留原来已验证的步骤（拆分文本 / 重复每一项 / 添加新提醒事项 / 紧急）', help.includes('按 新行 拆分 快捷指令输入') && help.includes('重复每一项') && help.includes('添加新提醒事项') && help.includes('紧急') && help.includes('第5、7、8步'));
const nNew = await page.locator('#h-shortcut .newtag').count();
ok('「新增」部分：A 允许不确认直接删除、B 新建「宝宝闹钟删除」、C「运行快捷指令」放最上面、测试；都标「新增」', nNew >= 5 && help.includes('允许不确认直接删除') && help.includes('新建快捷指令「宝宝闹钟删除」') && help.includes('匹配文本')
  && help.includes(SHORTCUT_RE) && help.includes('查找提醒事项') && help.includes('备注 · 包含') && help.includes('列表 · 是 · 宝宝') && help.includes('有任何值') && help.includes('移除提醒事项') && help.includes('运行快捷指令') && help.includes('按住它拖到最上面'), `newtag=${nNew}`);
ok('帮助页写明 v1.7.1 之前的旧提醒要手动删一次', help.includes('v1.7.1 之前建的闹钟提醒') && help.includes('手动删一次'));
ok('帮助页示例载荷带标记', help.includes('备注：带疫苗本 · <宝宝#mg3k2x9a1b2c3>'));
await hideToast();
await page.evaluate(() => { document.getElementById('h-replace').scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '27-help-new-replace-alarm.png' });
const shotAt = async (js, file) => { await page.evaluate(js); await page.waitForTimeout(300); await page.screenshot({ path: SHOTS + file }); };
await shotAt(() => { const li = [...document.querySelectorAll('#h-shortcut li')].find((x) => x.textContent.includes('重复 匹配项')); li.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }, '28-help-new-delete-shortcut.png');
await shotAt(() => { [...document.querySelectorAll('#h-shortcut .h4new')][2].scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }, '29-help-new-run-shortcut-top.png');
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
