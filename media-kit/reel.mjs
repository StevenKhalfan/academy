// node reel.mjs <CHROME_PATH|""> <FONT_DIR> <SHOTS_DIR> <OUT_DIR>
// يصيّر الريلز 1080×1920 بـ30fps إطارًا إطارًا (حتمي عبر window.seek) ثم يجمعه بـffmpeg إلى reel.mp4 بدون صوت.
// اختياري: PREVIEW="0.5,5,12" لتصوير لقطات ثابتة فقط (preview-<t>.png) دون فيديو.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [chrome = '', fontDir, shotsDir, outDir] = process.argv.slice(2);
if (!fontDir || !shotsDir || !outDir) {
  console.error('usage: node reel.mjs <CHROME_PATH|""> <FONT_DIR> <SHOTS_DIR> <OUT_DIR>');
  process.exit(1);
}
const FPS = 30;
const t0 = Date.now();
const copy = JSON.parse(fs.readFileSync(path.join(HERE, 'copy.json'), 'utf8'));
const dirUrl = d => pathToFileURL(path.resolve(d)).href.replace(/\/?$/, '/');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([c, f, s]) => { window.__COPY = c; window.__FONT_URL = f; window.__SHOTS_URL = s; }, [copy, dirUrl(fontDir), dirUrl(shotsDir)]);
const page = await ctx.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(pathToFileURL(path.join(HERE, 'reel.html')).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
if (!(await page.evaluate(() => window.__fontsOk))) console.warn(`! Tajawal not loaded from ${fontDir}`);
const DUR = await page.evaluate(() => window.DURATION);

const shoot = async (t, file, type = 'jpeg') => {
  await page.evaluate(t => window.seek(t), t);
  await page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality: 92 } : {}) });
};

if (process.env.PREVIEW) {
  for (const t of process.env.PREVIEW.split(',').map(Number)) {
    await shoot(t, path.join(outDir, `preview-${t}.png`), 'png');
    console.log('✓ preview', t);
  }
  await browser.close();
  process.exit(0);
}

const frames = path.join(outDir, 'reel-frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const N = Math.round(DUR * FPS);
for (let i = 0; i < N; i++) {
  await shoot(i / FPS, path.join(frames, `f${String(i).padStart(4, '0')}.jpg`));
  if (i % 60 === 0) console.log(`frame ${i}/${N}`);
}
await browser.close();
console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const out = path.join(outDir, 'reel.mp4');
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'),
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
if (ff.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }
console.log(`✓ ${out} (${N} frames) — total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
