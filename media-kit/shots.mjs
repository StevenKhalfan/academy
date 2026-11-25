// node shots.mjs <CODE> <OUT_DIR>
// يدخل المختبر كطالب بالرمز (بإذن صاحب المختبر) ويصوّر شاشات حقيقية بمقاس جوال 1170×2532.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [CODE, OUT = './shots'] = process.argv.slice(2);
const URL0 = 'https://steven-khalfan-trading-lab.vercel.app/app';
fs.mkdirSync(OUT, { recursive: true });

// ملف تعريف دائم حتى يبقى الجهاز نفسه بين التشغيلات (الرمز مربوط بجهاز واحد)
const ctx = await chromium.launchPersistentContext('/vercel/profile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'ar', isMobile: true, hasTouch: true });
const b = { close: () => ctx.close() };
const p = ctx.pages()[0] ?? await ctx.newPage();
const log = (...a) => console.log('[shots]', ...a);
const wait = (ms) => p.waitForTimeout(ms);
const clickText = async (re) => { const l = p.getByText(re).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded().catch(() => {}); await l.click({ timeout: 4000 }).catch(() => {}); await wait(600); return true; } return false; };
const dump = async (name) => fs.writeFileSync(`${OUT}/${name}.txt`, (await p.innerText('body').catch(() => '')).slice(0, 3000));

await p.goto(URL0, { waitUntil: 'networkidle' });
await wait(2000);
if ((await p.getByText(/أنا طالب|الدخول برمز الطالب/).count()) > 0) {
  if (await p.getByText(/أنا طالب/).count()) await clickText(/أنا طالب/);
  await p.locator('input').first().fill(CODE);
  await p.locator('button:has-text("دخول")').first().click();
  await wait(3000);
}
await dump('after-login');

// الإعداد الأول
for (let i = 0; i < 10; i++) {
  for (const cb of await p.$$('input[type=checkbox]')) { if (!(await cb.isChecked())) await cb.check().catch(() => {}); }
  const nx = p.locator('button:has-text("التالي"), button:has-text("ابدأ"), button:has-text("إنهاء")');
  if ((await nx.count()) === 0) break;
  await nx.last().click().catch(() => {});
  await wait(600);
}
await dump('after-onboarding');

const nav = async (label) => {
  const btn = p.locator('nav button, nav a').filter({ hasText: label }).first();
  if (await btn.count()) { await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click().catch(() => {}); }
  await wait(2500);
  await p.evaluate(() => window.scrollTo(0, 0));
};
const setMarket = async (v) => { const s = p.locator('#mkt'); if (await s.count()) { await s.selectOption(v).catch(() => {}); await wait(1500); } };
const focus = async (sel, offset = 90) => { const el = p.locator(sel).first(); if (await el.count()) { const y = await el.evaluate((e) => e.getBoundingClientRect().top + window.scrollY); await p.evaluate((t) => window.scrollTo(0, t), Math.max(0, y - offset)); await wait(800); } };
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); await dump(name); log('saved', name); };

// التداول: بورصة مسقط مع شارت، ونحاول فتح صفقة تدريبية حتى تكون اللوحة حيّة
await setMarket('msx');
await nav('التداول التجريبي');
const buy = p.locator('main button').filter({ hasText: /شراء|اشترِ/ }).first();
if (await buy.count()) { await buy.click().catch(() => {}); await wait(1200); const conf = p.locator('button').filter({ hasText: /تأكيد|نفّذ|إرسال/ }).first(); if (await conf.count()) { await conf.click().catch(() => {}); await wait(1200); } }
await focus('canvas', 160);
await shot('trade');

// الدرس والاختبار
await setMarket('stocks');
await nav('المسار التعليمي');
await shot('lesson-top');
await focus('main h2, main h3', 70);
await shot('lesson');

// الحاسبات
await setMarket('forex');
await nav('الحاسبات');
await shot('calc');

// لوحة المعلومات
await setMarket('msx');
await nav('لوحة المعلومات');
await shot('dashboard');

// المسارات: الذهب والفضة
await setMarket('metals');
await nav('التداول التجريبي');
await focus('canvas', 160);
await shot('tracks');

await b.close();
log('done');
