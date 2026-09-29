import { chromium } from 'playwright';
import fs from 'fs';
const out = '/workspace/baby-app/site/icons/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto('file:///workspace/baby-app/tools/icon.html');
async function shot(size, name, { scale = 1, badge = false } = {}) {
  await page.evaluate(({ size, scale, badge }) => {
    const s = document.getElementById('s');
    s.setAttribute('width', size); s.setAttribute('height', size);
    document.getElementById('art').setAttribute('transform', `translate(256 ${badge ? 256 : 270}) scale(${scale})`);
    document.getElementById('bgrect').style.display = badge ? 'none' : '';
    if (badge) { s.querySelectorAll('#art *').forEach((n) => { if (n.getAttribute('fill') && n.getAttribute('fill') !== 'none') n.setAttribute('fill', '#FFFFFF'); if (n.getAttribute('stroke')) n.setAttribute('stroke', '#FFFFFF'); }); }
  }, { size, scale, badge });
  await page.setViewportSize({ width: size, height: size });
  await page.locator('#s').screenshot({ path: out + name, omitBackground: true });
}
await shot(180, 'apple-touch-icon.png');
await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'icon-maskable-512.png', { scale: 0.78 });
await shot(72, 'badge-72.png', { scale: 1.2, badge: true });
await browser.close();
console.log(fs.readdirSync(out));
