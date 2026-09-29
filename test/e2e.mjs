// 端到端测试：iPhone 尺寸；增删改查、提醒卡片、导出导入、ICS、推送（真实 FCM 推送经 Google Chrome）
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = '/workspace/baby-app/screenshots/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };

fs.rmSync('/tmp/pw-profile', { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext('/tmp/pw-profile', { executablePath: '/opt/google/chrome/chrome', headless: true,
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  acceptDownloads: true,
});
await ctx.grantPermissions(['notifications'], { origin: new URL(BASE).origin });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForTimeout(800);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date(Date.now() + 0);
const shanghai = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
const d0 = ymd(shanghai), d2 = ymd(new Date(shanghai.getTime() + 2 * 864e5)), d5 = ymd(new Date(shanghai.getTime() + 5 * 864e5));

async function addItem({ title, cat, date, time, note, customAbs }) {
  await page.click('#fab');
  await page.waitForSelector('#f-title');
  await page.fill('#f-title', title);
  await page.click(`#f-cat [data-cat=${cat}]`);
  await page.fill('#f-date', date); await page.dispatchEvent('#f-date', 'change');
  if (time) { await page.fill('#f-time', time); await page.dispatchEvent('#f-time', 'change'); }
  if (note) await page.fill('#f-note', note);
  if (customAbs) {
    await page.click('#f-addcustom');
    const inp = page.locator('#f-customs input').last();
    await inp.fill(customAbs); await inp.dispatchEvent('change');
  }
  await page.click('#f-save');
  await page.waitForTimeout(300);
}

// 1) 添加
await addItem({ title: '打疫苗', cat: 'vaccine', date: d2, time: '10:00', note: '带上疫苗本' });
await addItem({ title: '儿保体检', cat: 'checkup', date: d0, time: '23:50', note: '空腹' });
await addItem({ title: '办医保', cat: 'other', date: d5 });
let card = await page.locator('#remindCard').innerText();
ok('提醒卡片显示新增事项', card.includes('打疫苗') && card.includes('儿保体检') && card.includes('办医保'));
ok('倒计时文字（今天/后天/还有5天）', card.includes('今天') && card.includes('后天') && card.includes('还有5天'), card.replace(/\n/g, ' | '));
ok('今天事项醒目（红色强调）', await page.locator('.ritem.lvl-today').count() >= 1);
const calCell = page.locator(`.day[data-date="${d2}"]`);
ok('日历上疫苗日有圆点和💉标记', (await calCell.locator('.dot.cat-vaccine').count()) === 1 && (await calCell.locator('.vbadge').count()) === 1);
ok('日历上其他事项有圆点', (await page.locator(`.day[data-date="${d5}"] .dot.cat-other`).count()) === 1);

// 截图：首页（含提醒卡片）
await page.evaluate(() => localStorage.setItem('babyrecord.hideBanner', '1'));
await page.evaluate(() => window.scrollTo(0, 0));
await page.reload(); await page.waitForTimeout(600);
await page.waitForTimeout(2400); await page.screenshot({ path: SHOTS + '01-home-reminders.png' });

// 截图：日历（选中疫苗日）
await calCell.click(); await page.waitForTimeout(300);
await page.locator('#calCard').scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollTo(0, document.getElementById('calCard').offsetTop - 60));
await page.waitForTimeout(300);
await page.waitForTimeout(2400); await page.screenshot({ path: SHOTS + '03-calendar-day.png' });

// 2) 编辑
await page.locator(`.item:has-text("打疫苗") [data-act=edit]`).click();
await page.waitForSelector('#f-title');
await page.fill('#f-title', '打乙肝疫苗第2针');
await page.click('#f-presets [data-p=h2]');
await page.click('#f-presets [data-p=m30]');
await page.waitForTimeout(200);
const preview = await page.locator('#f-preview').innerText();
ok('编辑面板多提醒预览', preview.includes('提前2小时') && preview.includes('提前30分钟') && preview.includes('前一天 20:00'), preview.replace(/\n/g, ' | '));
await page.evaluate(() => { document.getElementById('sheet').scrollTop = 0; });
await page.waitForTimeout(2600); await page.screenshot({ path: SHOTS + '02-edit-dialog.png' });
await page.click('#f-save'); await page.waitForTimeout(300);
card = await page.locator('#remindCard').innerText();
ok('编辑后标题已更新', card.includes('打乙肝疫苗第2针'));

// 2b) 设为闹钟提醒（快捷指令）
await page.locator(`.day[data-date="${d2}"]`).click();
await page.locator('.item:has-text("打乙肝疫苗第2针") [data-act=alarm]').click();
await page.waitForSelector('#al-go');
const href = await page.getAttribute('#al-go', 'href');
const u = new URL(href);
const text = u.searchParams.get('text');
const lines = text.split('\n');
console.log('shortcut url:', href.slice(0, 120) + '…');
console.log('payload:\n' + text);
ok('快捷指令 URL 格式正确', href.startsWith('shortcuts://run-shortcut?name=') && u.searchParams.get('name') === '宝宝闹钟' && u.searchParams.get('input') === 'text');
ok('每个提醒时间一行（时间|标题|备注）', lines.length === 4 && lines.every((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|【宝宝】.+\|.+$/.test(l)), `lines=${lines.length}`);
ok('标题形如「【宝宝】明天 10:00 打乙肝疫苗第2针」', lines[0].includes('|【宝宝】明天 10:00 打乙肝疫苗第2针|') && lines[1].includes('|【宝宝】今天 10:00 打乙肝疫苗第2针|'));
fs.writeFileSync('/workspace/baby-app/test/out-shortcut-payload.txt', href + '\n\n' + text + '\n');
await page.waitForTimeout(2600); await page.screenshot({ path: SHOTS + '05-alarm-shortcut-sheet.png' });
await page.evaluate(() => document.getElementById('al-go').addEventListener('click', (e) => e.preventDefault()));
await page.click('#al-go');
await page.waitForTimeout(300);
ok('点击后自动标记「已设闹钟」', await page.isChecked('#al-added'));
await page.click('#al-close');
ok('事项显示「✅ 已设闹钟」', (await page.locator('.item:has-text("打乙肝疫苗第2针") .alarm-btn').innerText()).includes('已设闹钟'));
await page.locator('.item:has-text("打乙肝疫苗第2针") [data-act=edit]').click();
await page.click('#f-presets [data-p=m0]');
await page.click('#f-save'); await page.waitForTimeout(300);
ok('修改提醒时间后提示重设闹钟', (await page.locator('.item:has-text("打乙肝疫苗第2针") .alarm-btn').innerText()).includes('重设'));
await page.locator('.item:has-text("打乙肝疫苗第2针") [data-act=edit]').click();
await page.click('#f-presets [data-p=m0]');
await page.click('#f-save'); await page.waitForTimeout(300);
ok('改回后恢复「已设闹钟」', (await page.locator('.item:has-text("打乙肝疫苗第2针") .alarm-btn').innerText()).includes('已设闹钟'));

// 3) ICS
const ics = await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const { buildICS, b64urlEncode } = await import('./js/ics.js');
  const ev = store.events().find((e) => e.category === 'vaccine');
  const allDay = store.events().find((e) => e.category === 'other');
  const text = buildICS(ev);
  const r = await fetch(`./ics/test.ics?d=${b64urlEncode(text)}`);
  return { text, allDay: buildICS(allDay), ct: r.headers.get('content-type'), same: (await r.text()) === text };
});
fs.writeFileSync('/workspace/baby-app/test/out-vaccine.ics', ics.text);
fs.writeFileSync('/workspace/baby-app/test/out-allday.ics', ics.allDay);
ok('Service Worker 以 text/calendar 返回 .ics 真实 URL', ics.ct.startsWith('text/calendar') && ics.same, ics.ct);
ok('ICS 含多个 VALARM', (ics.text.match(/BEGIN:VALARM/g) || []).length >= 4, `count=${(ics.text.match(/BEGIN:VALARM/g) || []).length}`);

// 4) 删除
await page.locator(`.day[data-date="${d5}"]`).click();
await page.locator(`.item:has-text("办医保") [data-act=edit]`).click();
await page.click('#f-del');
await page.locator('#sheet [data-a=yes]').click();
await page.waitForTimeout(300);
ok('删除后日历与卡片不再显示', !(await page.locator('#remindCard').innerText()).includes('办医保') && (await page.locator(`.day[data-date="${d5}"] .dot`).count()) === 0);

// 5) 标记已完成
await page.locator('.ritem:has-text("儿保体检") [data-done]').click();
await page.waitForTimeout(200);
ok('标记已完成后从提醒卡片移除', !(await page.locator('#remindCard').innerText()).includes('儿保体检'));

// 6) 导出 / 导入
await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
const bpath = '/workspace/baby-app/test/backup.json';
await dl.saveAs(bpath);
const backup = JSON.parse(fs.readFileSync(bpath, 'utf8'));
ok('导出 JSON 备份', backup.app === 'baby-record' && backup.data.events.length === 2, dl.suggestedFilename());
await page.click('#btnReset'); await page.locator('#sheet [data-a=yes]').click(); await page.waitForTimeout(300);
const afterReset = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events.length);
await page.setInputFiles('#fileImport', bpath);
await page.locator('#sheet [data-a=yes]').click(); await page.waitForTimeout(300);
const afterImport = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events.length);
ok('清空后导入恢复数据', afterReset === 0 && afterImport === 2, `reset=${afterReset} import=${afterImport}`);

// 7) 推送（真实推送服务）
let pushOk = false;
await page.click('#btnEnable');
await page.waitForTimeout(6000);
const status = await page.locator('#pushStatus').innerText();
console.log(status.replace(/\n/g, ' | '));
const subscribed = await page.evaluate(async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()));
ok('推送订阅成功（pushManager.subscribe + 服务端登记）', subscribed, status.replace(/\n/g, ' | '));
if (subscribed) {
  const endpoint = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription()).endpoint);
  console.log('endpoint host', new URL(endpoint).host);
  const res = await page.evaluate(async () => { const { sendTestPush } = await import('./js/push.js'); try { return await sendTestPush(0); } catch (e) { return { err: e.message }; } });
  console.log('test push result', JSON.stringify(res));
  await page.waitForTimeout(5000);
  const notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })));
  console.log('notifications', JSON.stringify(notes));
  pushOk = notes.some((n) => n.title.startsWith('宝宝提醒：'));
  ok('立即测试推送：服务端发送并在 SW 中显示通知', res.ok && pushOk, notes[0]?.title || '');

  // 定时提醒：1 分钟后
  const t = new Date(Date.now() + 70 * 1000);
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  await page.goto(BASE); await page.waitForTimeout(500);
  await addItem({ title: '喂维生素D', cat: 'other', date: ymd(t), customAbs: `${ymd(t)}T${hm}`, note: '一滴就够' });
  await page.evaluate(async () => { const { syncReminders } = await import('./js/push.js'); await syncReminders(true); });
  await page.waitForTimeout(800);
  const db1 = JSON.parse(fs.readFileSync('/workspace/baby-app/server/data/db.json', 'utf8'));
  const pend = Object.values(db1.devices).flatMap((d) => d.reminders).filter((r) => !r.sentAt);
  ok('提醒计划已同步到推送服务', pend.some((r) => r.ev && r.ev.title === '喂维生素D'), `pending=${pend.length}`);
  await page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close(); });
  const fireAt = new Date(`${ymd(t)}T${hm}:00+08:00`).getTime();
  const waitMs = Math.max(0, fireAt - Date.now()) + 25000;
  console.log('waiting', Math.round(waitMs / 1000), 's for scheduled push…');
  await page.waitForSelector('#alarm:not([hidden])', { timeout: waitMs + 20000 });
  let notes2 = [];
  for (let i = 0; i < 40 && !notes2.length; i++) {
    await page.waitForTimeout(1000);
    notes2 = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })));
  }
  console.log('notifications2', JSON.stringify(notes2));
  ok('定时推送到点送达，通知标题说明事项', notes2.some((n) => n.title.includes('喂维生素D')), notes2[0] ? `${notes2[0].title} / ${notes2[0].body.replace(/\n/g, ' ⏎ ')}` : '');
  const alarmText = await page.locator('#alarm').innerText();
  ok('App 打开时到点弹出全屏提醒页（含原因/时间/备注）', alarmText.includes('喂维生素D') && alarmText.includes('为什么现在提醒你') && alarmText.includes('一滴就够'), alarmText.replace(/\n/g, ' | '));
  await page.screenshot({ path: SHOTS + '04-alarm-fullscreen.png' });
  // 稍后提醒
  await page.click('#aSnooze'); await page.waitForTimeout(2500);
  const db2 = JSON.parse(fs.readFileSync('/workspace/baby-app/server/data/db.json', 'utf8'));
  const myId = await page.evaluate(() => localStorage.getItem('babyrecord.device'));
  const snz = (db2.devices[myId]?.reminders || []).find((r) => r.id.startsWith('snz-') && !r.sentAt);
  ok('稍后提醒(10分钟)已重新安排推送', snz && Math.abs(snz.fireAt - Date.now() - 10 * 60000) < 30000, snz ? new Date(snz.fireAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '');
  ok('全屏提醒页已关闭', await page.locator('#alarm').isHidden());
  // 通知点击 -> 打开提醒页
  const clickRes = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data.type === 'open-url') setTimeout(() => resolve(e.data.url), 300); });
      reg.active.postMessage({ type: 'noop' });
      resolve('skip');
    });
  });
  // 模拟通知点击的深链：#/alarm?rid=..&e=..
  const ev = await page.evaluate(async () => { const { store } = await import('./js/store.js'); return store.events().find((e) => e.title === '打乙肝疫苗第2针'); });
  await page.goto(BASE + `#/alarm?rid=${encodeURIComponent(ev.id + ':x:1')}&e=${ev.id}`);
  await page.waitForSelector('#alarm:not([hidden])', { timeout: 5000 });
  const t2 = await page.locator('#alarm').innerText();
  ok('通知深链 #/alarm 打开全屏提醒页', t2.includes('打乙肝疫苗第2针'));
  await page.click('#aOk');
}
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
fs.writeFileSync('/workspace/baby-app/test/results.json', JSON.stringify(results, null, 2));
await ctx.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
