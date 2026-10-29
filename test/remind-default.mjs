import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage();
await p.goto('http://localhost:8080/');
const r = await p.evaluate(async () => { const m = await import('./js/reminders.js'); return [m.defaultReminders(false).map(x=>x.preset), m.defaultReminders(true).map(x=>x.preset)]; });
const v = await p.evaluate(async () => (await import('./config.js')).default?.appVersion || window.APP_CONFIG?.appVersion || '');
let ok = JSON.stringify(r) === '[["eve20"],["eve20"]]';
console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(r), v); await b.close(); process.exit(ok ? 0 : 1);
