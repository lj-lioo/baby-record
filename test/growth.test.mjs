// 生长记录单元：日龄、校验、相对上次、曲线点数
import assert from 'assert';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

// 浏览器模块依赖 localStorage：用极简 stub
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const { ageOnDate, validateGrowth, deltaTip, chartSvg } = await import(pathToFileURL(path.join(here, '../site/js/growth.js')).href);

const B = '2026-09-17';
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('✅', name); }
  else { fail++; console.log('❌', name); }
}

check('出生当天第1天', ageOnDate(B, '2026-09-17') === '第1天');
check('出生后3天第4天', ageOnDate(B, '2026-09-20') === '第4天');
check('1个月1天', ageOnDate(B, '2026-10-18') === '1个月1天');
check('整月', ageOnDate(B, '2026-10-17') === '1个月');
check('早于生日空', ageOnDate(B, '2026-09-16') === '');

check('缺身高失败', !!validateGrowth({ date: B, height: '', weight: '3', head: '' }, B));
check('合法通过', validateGrowth({ date: B, height: '49', weight: '2.8', head: '' }, B) === null);
check('头围可选', validateGrowth({ date: '2026-10-18', height: '53.5', weight: '4.2', head: '37.6' }, B) === null);
check('身高超范围', !!validateGrowth({ date: B, height: '200', weight: '3', head: '' }, B));
check('未来日期', !!validateGrowth({ date: '2099-01-01', height: '50', weight: '3', head: '' }, B));

const list = [
  { id: 'a', date: '2026-10-18', height: 53.5, weight: 4.2, head: 37.6, updatedAt: 2 },
  { id: 'b', date: '2026-09-17', height: 49, weight: 2.8, head: null, updatedAt: 1 },
];
const tip = deltaTip(list[0], list);
check('相对上次含增高', tip.includes('身高 +4.5') && tip.includes('体重 +1.4') && tip.includes('非医疗建议'));
check('首条无对比', deltaTip(list[1], list) === '已记录 · 非医疗建议');

const svg = chartSvg([{ date: '2026-09-17', value: 49 }, { date: '2026-10-18', value: 53.5 }], { unit: 'cm' });
check('曲线含 polyline', svg.includes('<polyline'));
check('空曲线提示', chartSvg([], {}).includes('暂无数据'));

console.log(`\ngrowth.test ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
