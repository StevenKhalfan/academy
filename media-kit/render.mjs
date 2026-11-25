// node render.mjs <CHROME_PATH|""> <FONT_DIR> <SHOTS_DIR> <OUT_DIR>
// يصيّر شرائح الكاروسيل (1080×1350) + contact.jpg. يقرأ copy.json وcarousel.html من مجلد هذا السكربت.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [chrome = '', fontDir, shotsDir, outDir] = process.argv.slice(2);
if (!fontDir || !shotsDir || !outDir) {
  console.error('usage: node render.mjs <CHROME_PATH|""> <FONT_DIR> <SHOTS_DIR> <OUT_DIR>');
  process.exit(1);
}
const t0 = Date.now();
const copy = JSON.parse(fs.readFileSync(path.join(HERE, 'copy.json'), 'utf8'));
const dirUrl = d => pathToFileURL(path.resolve(d)).href.replace(/\/?$/, '/');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([c, f, s]) => { window.__COPY = c; window.__FONT_URL = f; window.__SHOTS_URL = s; }, [copy, dirUrl(fontDir), dirUrl(shotsDir)]);
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e.message));

const pageUrl = pathToFileURL(path.join(HERE, 'carousel.html')).href;
const n = (copy.carousel || []).length || 7;
const files = [];
for (let i = 1; i <= n; i++) {
  await page.goto(`${pageUrl}?n=${i}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  if (!(await page.evaluate(() => window.__fontsOk))) console.warn(`! slide ${i}: Tajawal not loaded from ${fontDir}`);
  const f = path.join(outDir, `slide-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  console.log('✓', path.basename(f));
}

// contact sheet (4 أعمدة)
const cols = 4, tw = 270, th = 338, gap = 16, rows = Math.ceil(n / cols);
const W = cols * tw + (cols + 1) * gap, H = rows * th + (rows + 1) * gap;
await page.setViewportSize({ width: W, height: H });
const imgs = files.map(f => `<img src="${pathToFileURL(f).href}?v=${Date.now()}">`).join('');
await page.goto(pathToFileURL(path.join(HERE, 'carousel.html')).href + '?n=1'); // file:// origin for local images
await page.evaluate(([html, W, H, tw, th, gap]) => {
  document.documentElement.innerHTML = `<body style="margin:0;box-sizing:border-box;width:${W}px;height:${H}px;background:#05071a;display:grid;grid-template-columns:repeat(4,${tw}px);gap:${gap}px;padding:${gap}px;direction:rtl">${html}</body>`;
  document.querySelectorAll('img').forEach(i => { i.style.cssText = `width:${tw}px;height:${th}px;border-radius:10px;display:block`; });
  return Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
}, [imgs, W, H, tw, th, gap]);
await page.screenshot({ path: path.join(outDir, 'contact.jpg'), type: 'jpeg', quality: 85 });
console.log('✓ contact.jpg');
await browser.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outDir}`);
