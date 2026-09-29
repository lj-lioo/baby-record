// 端到端：一键生成疫苗计划（iPhone 尺寸），生成截图 07/08。BASE=... 可指定地址
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = '/workspace/baby-app/screenshots/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, extra); };

const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-09-29T13:30:00+08:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push/i.test(m.text())) errors.push(m.text()); });
await page.goto(BASE);
await page.evaluate(() => localStorage.setItem('babyrecord.hideBanner', '1'));
await page.reload(); await page.waitForTimeout(800);

ok('首页显示「一键生成疫苗计划」提示', await page.locator('#vaxGo').isVisible());
await page.click('#vaxGo');
await page.waitForSelector('#vp-bday');
ok('未设置生日时默认填 2026-09-17', (await page.inputValue('#vp-bday')) === '2026-09-17');
await page.fill('#vp-bday', '2026-09-17'); await page.dispatchEvent('#vp-bday', 'change');
await page.waitForSelector('.vp-item');
const items = page.locator('.vp-item');
ok('预览 22 剂', (await items.count()) === 22, `count=${await items.count()}`);
const checked = await page.locator('.vp-item input:checked').count();
ok('默认勾选 20 个未来剂次', checked === 20, `checked=${checked}`);
const pastTxt = await page.locator('.vp-item.is-past').allInnerTexts();
ok('出生时 2 剂显示「已过（出生时通常已在医院接种）」且未勾选', pastTxt.length === 2 && pastTxt.every((t) => t.includes('已过（出生时通常已在医院接种）')) && (await page.locator('.vp-item.is-past input:checked').count()) === 0, pastTxt.map((t) => t.split('\n')[0]).join(','));
ok('按钮「添加 20 个疫苗事项」', (await page.textContent('#vp-ok')).includes('添加 20 个'));
const firstFuture = await page.locator('.vp-item').nth(2).innerText();
ok('乙肝第2剂 2026年10月17日', firstFuture.includes('乙肝疫苗 第2剂') && firstFuture.includes('2026年10月17日'), firstFuture.replace(/\n/g, ' | '));
ok('预览含免责声明', (await page.locator('#sheet').innerText()).includes('以当地接种门诊'));
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(600);
await page.screenshot({ path: SHOTS + '07-vaccine-plan-preview.png' });

// 勾选乙肝第1剂作为历史记录
await page.locator('.vp-item.is-past input').first().check();
ok('勾选历史后变为 21 个', (await page.textContent('#vp-ok')).includes('添加 21 个'));
await page.click('#vp-ok');
await page.waitForTimeout(600);
const evs = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events);
const nip = evs.filter((e) => (e.scheduleId || '').startsWith('nip:'));
ok('已添加 21 个疫苗事项（类别=疫苗，09:00）', nip.length === 21 && nip.every((e) => e.category === 'vaccine' && e.time === '09:00'), `n=${nip.length}`);
const hb2 = nip.find((e) => e.scheduleId === 'nip:hepb-2');
ok('乙肝第2剂：日期/备注/提醒（前一天20:00+当天08:00）', hb2 && hb2.date === '2026-10-17' && hb2.note === '国家免疫规划 · 满1月龄 · 以社区医院/接种本实际预约为准'
  && hb2.reminders.map((r) => r.preset).join(',') === 'eve20,morning8', JSON.stringify(hb2 && { d: hb2.date, n: hb2.note, r: hb2.reminders.map((r) => r.preset) }));
const hb1 = nip.find((e) => e.scheduleId === 'nip:hepb-1');
ok('乙肝第1剂作为已完成历史记录，无提醒', hb1 && hb1.done && hb1.reminders.length === 0);
ok('卡介苗未添加（未勾选）', !nip.some((e) => e.scheduleId === 'nip:bcg-1'));
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).settings.babyBirthday);
ok('生日已保存到设置', saved === '2026-09-17');
ok('首页疫苗提示已消失（只剩体检提示）', (await page.locator('#vaxGo').count()) === 0 && (await page.locator('#chkGo').count()) === 1);
const dayTxt = await page.locator('#dayCard').innerText();
ok('首页选中下一针日期（10月17日 乙肝第2剂）', dayTxt.includes('10月17日') && dayTxt.includes('乙肝疫苗 第2剂'), dayTxt.split('\n')[0]);
ok('日历 10月17日 有 💉 标记', (await page.locator('.day[data-date="2026-10-17"] .vbadge').count()) === 1);
await page.waitForTimeout(3800); // 等提示消失
await page.evaluate(() => { document.getElementById('calCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); });
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + '08-vaccine-home-calendar.png' });

// 再次生成：不重复
await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
const card = await page.locator('#vaxCard').innerText();
ok('设置页疫苗计划卡片显示生日和已生成数量', card.includes('2026年9月17日') && card.includes('21 个'), card.replace(/\n/g, ' | '));
await page.click('#btnVax');
await page.waitForSelector('.vp-item');
ok('再次打开时预填生日', (await page.inputValue('#vp-bday')) === '2026-09-17');
ok('21 个显示「已添加」，按钮禁用', (await page.locator('.vp-item.is-have').count()) === 21 && await page.isDisabled('#vp-ok'));
const again = await page.evaluate(async () => {
  const { store } = await import('./js/store.js');
  const added = store.addEvents([{ id: 'dup1', date: '2026-10-17', time: '09:00', title: '乙肝疫苗 第2剂', category: 'vaccine', scheduleId: 'nip:hepb-2' }]);
  return { added: added.length, total: store.events().filter((e) => e.scheduleId === 'nip:hepb-2').length };
});
ok('重复添加同一剂次被跳过', again.added === 0 && again.total === 1, JSON.stringify(again));
await page.click('#vp-cancel');
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
fs.writeFileSync('/workspace/baby-app/test/results-vaccine.json', JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
