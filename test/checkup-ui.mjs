// 端到端：一键生成体检计划（iPhone 尺寸），截图 09/10/11。BASE=... 可指定地址
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
await page.clock.setFixedTime(new Date('2026-09-29T16:30:00+08:00'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push/i.test(m.text())) errors.push(m.text()); });
await page.goto(BASE);
await page.evaluate(() => localStorage.setItem('babyrecord.hideBanner', '1'));
await page.reload(); await page.waitForTimeout(800);

ok('首页入口同时显示「疫苗计划」「体检计划」', await page.locator('#vaxGo').isVisible() && await page.locator('#chkGo').isVisible());
ok('版本号 ≥ 1.3.0', /^1\.([3-9]|\d{2,})\./.test(await page.evaluate(() => window.BABY_CONFIG.appVersion)));
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + '10-home-plan-entry.png' });

await page.click('#chkGo');
await page.waitForSelector('.vp-item');
ok('默认生日 2026-09-17', (await page.inputValue('#vp-bday')) === '2026-09-17');
ok('预览 14 项', (await page.locator('.vp-item').count()) === 14);
ok('默认勾选 12 项（已过的家庭访视、可选的听力复筛不勾选）', (await page.locator('.vp-item input:checked').count()) === 12);
const first = await page.locator('.vp-item').first().innerText();
ok('家庭访视显示已过', first.includes('新生儿家庭访视') && first.includes('已过'), first.replace(/\n/g, ' | '));
const opt = await page.locator('.vp-item.is-opt').innerText();
ok('听力复筛为可选（仅初筛未通过）', opt.includes('新生儿听力复筛') && opt.includes('仅初筛未通过'), opt.replace(/\n/g, ' | '));
ok('按钮「添加 12 个体检事项」', (await page.textContent('#vp-ok')).includes('添加 12 个体检事项'));
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(500);
await page.screenshot({ path: SHOTS + '09-checkup-plan-preview.png' });

await page.click('#vp-ok');
await page.waitForTimeout(600);
const evs = await page.evaluate(() => JSON.parse(localStorage.getItem('babyrecord.v1')).events);
const chk = evs.filter((e) => (e.scheduleId || '').startsWith('chk:'));
ok('已添加 12 个体检事项（类别=体检，09:00，前一天20:00+当天08:00）', chk.length === 12 && chk.every((e) => e.category === 'checkup' && e.time === '09:00' && e.reminders.map((r) => r.preset).join(',') === 'eve20,morning8'), `n=${chk.length}`);
const m1 = chk.find((e) => e.scheduleId === 'chk:m1');
ok('满月体检 2026-10-17，备注含 42 天说明', m1 && m1.date === '2026-10-17' && m1.note.includes('42天'), m1 && m1.note);
ok('首页体检提示消失、疫苗提示保留', (await page.locator('#chkGo').count()) === 0 && (await page.locator('#vaxGo').count()) === 1);
const day = await page.locator('#dayCard').innerText();
ok('首页选中下一次体检（10月17日 满月体检）', day.includes('10月17日') && day.includes('满月体检'));
await page.waitForTimeout(3800);
await page.evaluate(() => { document.getElementById('calCard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); });
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + '11-checkup-home-calendar.png' });

// 再次生成：不重复
await page.goto(BASE + '#/settings'); await page.waitForTimeout(500);
const card = await page.locator('#vaxCard').innerText();
ok('设置页「一键生成日程」显示体检 12 个', card.includes('体检事项') && card.includes('12 个'), card.replace(/\n/g, ' | '));
await page.click('#btnChk');
await page.waitForSelector('.vp-item');
ok('再次打开：12 个已添加，按钮禁用', (await page.locator('.vp-item.is-have').count()) === 12 && await page.isDisabled('#vp-ok'));
await page.click('#vp-cancel');
ok('无 JS 报错', errors.length === 0, errors.join(' || '));
await browser.close();
fs.writeFileSync('/workspace/baby-app/test/results-checkup.json', JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
