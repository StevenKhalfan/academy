'use strict';
/* أكاديمية — واجهة SPA بلا أطر. الخادم هو مصدر الحقيقة للأسعار والأرصدة والتقدم. */

const S = { brand: null, user: null, route: '', sim: {} };
const $ = (sel, el = document) => el.querySelector(sel);
const main = () => document.getElementById('main');

// ---------- أدوات ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now() + Math.random().toString(16).slice(2));
const CUR = { USD: { dp: 2, s: '$' }, OMR: { dp: 3, s: 'ر.ع.' }, USDT: { dp: 4, s: 'USDT' } };
function num(v, dp) {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function money(v, cur) {
  const c = CUR[cur] || { dp: 2, s: cur };
  return `<span class="num">${num(v, c.dp)}</span> <span>${esc(c.s)}</span>`;
}
function dpOf(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }

const CFG = window.ACADEMY_CONFIG || { apiBase: '' };
const REMOTE = !!CFG.apiBase; // وضع Supabase: الهوية عبر Supabase Auth والطلبات إلى دالة academy-api
const TOKEN_KEY = 'academy.session';
const session = {
  get() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, JSON.stringify(v)) : localStorage.removeItem(TOKEN_KEY); } catch { /* تخزين غير متاح */ } },
};
async function gotrue(path, body) {
  let res;
  try { res = await fetch(CFG.supabaseUrl + '/auth/v1/' + path, { method: 'POST', headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('تعذر الاتصال بخدمة الحسابات.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = String(data.msg || data.error_description || data.message || '');
    if (/invalid login/i.test(m)) throw Object.assign(new Error('البريد أو كلمة المرور غير صحيحة'), { status: 401 });
    if (/not confirmed/i.test(m)) throw new Error('فعّل حسابك من الرابط المرسل إلى بريدك أولًا.');
    if (/signups not allowed|signup.*disabled/i.test(m)) throw new Error('التسجيل الجديد مغلق حاليًا.');
    if (/already registered/i.test(m)) throw new Error('البريد مسجل مسبقًا');
    throw new Error(m || 'تعذر إكمال الطلب');
  }
  return data;
}
const saveTokens = (d) => session.set({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
async function refreshIfNeeded(force = false) {
  const s = session.get(); if (!s) return null;
  if (!force && s.exp - Date.now() > 60_000) return s.access;
  try { saveTokens(await gotrue('token?grant_type=refresh_token', { refresh_token: s.refresh })); return session.get().access; }
  catch { session.set(null); return null; }
}
const auth = {
  async login(email, password) {
    if (!REMOTE) return (await api('POST', '/api/auth/login', { email, password })).user;
    saveTokens(await gotrue('token?grant_type=password', { email: email.trim(), password }));
    return (await api('GET', '/api/me')).user;
  },
  async register(name, email, password) {
    if (!REMOTE) { await api('POST', '/api/auth/register', { name, email, password }); return 'سجّل الدخول الآن.'; }
    if (String(password).length < 8) throw new Error('كلمة المرور 8 أحرف على الأقل');
    const d = await gotrue('signup?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { email: email.trim(), password, data: { name: name.trim() } });
    if (d.access_token) { saveTokens(d); return 'أُنشئ الحساب وسُجّل دخولك.'; }
    return 'أرسلنا رابط تفعيل إلى بريدك. فعّل الحساب ثم سجّل الدخول.';
  },
  async logout() {
    if (!REMOTE) { await api('POST', '/api/auth/logout', {}); return; }
    const s = session.get();
    if (s) fetch(CFG.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + s.access } }).catch(() => {});
    session.set(null);
  },
};
// بعد الضغط على رابط التفعيل يعود Supabase بالرموز في عنوان الصفحة (#access_token=...)
(function captureAuthRedirect() {
  if (!REMOTE || !location.hash.includes('access_token=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  saveTokens({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in') || 3600) });
  history.replaceState(null, '', location.pathname + '#/dashboard');
})();

async function api(method, path, body, opts = {}, retried = false) {
  const headers = {};
  let url = path;
  if (REMOTE) {
    url = CFG.apiBase + path;
    const tok = await refreshIfNeeded();
    headers.apikey = CFG.anonKey;
    headers.Authorization = 'Bearer ' + (tok || CFG.anonKey);
  } else headers['X-Requested-With'] = 'academy';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  let res;
  try { res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: REMOTE ? 'omit' : 'same-origin' }); }
  catch { throw Object.assign(new Error(REMOTE ? 'تعذر الاتصال بالخادم. تحقق من الإنترنت.' : 'تعذر الاتصال بالخادم المحلي. تأكد أنه يعمل.'), { network: true }); }
  if (res.status === 401 && REMOTE && !retried && session.get()) { await refreshIfNeeded(true); return api(method, path, body, opts, true); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'حدث خطأ'), { status: res.status });
  return data;
}
let toastT;
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 3800);
}
const statusChip = (s) => ({
  published: '<span class="chip green">منشور</span>', draft: '<span class="chip">مسودة</span>', in_review: '<span class="chip amber">قيد المراجعة</span>',
  approved: '<span class="chip gold">معتمد — بانتظار النشر</span>', rejected: '<span class="chip red">مرفوض</span>', archived: '<span class="chip">مؤرشف</span>',
}[s] || `<span class="chip">${esc(s)}</span>`);
const INTEG = { not_configured: ['غير مهيأ', ''], trial: ['تجريبي', 'gold'], configured_untested: ['مهيأ غير مختبر', 'amber'], connected_tested: ['متصل مختبر', 'green'], failed: ['فشل', 'red'] };

// ---------- أيقونات (رسم أصلي) ----------
const I = {
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z"/>',
  book: '<path d="M5 4h9a4 4 0 014 4v12H9a4 4 0 01-4-4z"/><path d="M5 16a3 3 0 013-3h10"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l3-4 3 2 5-6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  local: '<path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-6a3 3 0 016 0v6"/><path d="M4 21h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  fx: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  crypto: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  metals: '<path d="M3 18l3-7h6l3 7z"/><path d="M10 11l2.5-6h6l3 7h-6"/>',
};
const icon = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

// ---------- الهيكل والتنقل ----------
function renderShell() {
  const b = S.brand;
  const items = [
    ['#/', 'home', 'الرئيسية'], ['#/courses', 'book', 'الدورات'], ['#/sim/local', 'chart', 'المحاكي'],
    ['#/dashboard', 'grid', 'لوحتي والتقدم'], ['#/profile', 'user', 'الملف الشخصي'],
  ];
  const extra = [['#/labs', 'spark', 'الذكاء الاصطناعي والمكتبة']];
  const staff = S.user && ['owner', 'editor', 'reviewer'].includes(S.user.role) ? [['#/admin', 'shield', 'إدارة المحتوى'], ['#/admin/integrations', 'plug', 'مركز التكاملات']] : [];
  const link = ([href, ic, label]) => `<a href="${href}" data-href="${href}">${icon(ic)}<span>${label}</span></a>`;
  $('#sidebar').innerHTML = `
    <a class="brand" href="#/"><span class="brand-mark">${esc(b.logoMark)}</span><span><span class="brand-name">${esc(b.nameAr)}</span><br><span class="brand-sub">${esc(b.nameEn)}</span></span></a>
    <nav class="nav" aria-label="التنقل">${items.map(link).join('')}
      <div class="nav-group">توسعات قادمة</div>${extra.map(link).join('')}
      ${staff.length ? '<div class="nav-group">الإدارة</div>' + staff.map(link).join('') : ''}
    </nav>
    <div class="side-foot">
      ${S.user ? `<a class="user-card" href="#/profile"><span class="avatar">${esc(S.user.name.trim()[0] || '؟')}</span><span><b>${esc(S.user.name)}</b><br><span class="small muted">${roleName(S.user.role)}</span></span></a>`
        : `<a class="btn btn-primary" style="width:100%" href="#/login">تسجيل الدخول</a>`}
      <p class="side-note">${esc(b.disclaimerAr)}</p>
    </div>`;
  $('#topBrand').innerHTML = `<span class="brand-mark">${esc(b.logoMark)}</span><span>${esc(b.nameAr)}</span>`;
  markNav();
}
const roleName = (r) => ({ owner: 'مالك', editor: 'محرر', reviewer: 'مراجع', student: 'طالب' }[r] || r);
function markNav() {
  const h = location.hash || '#/';
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = a.dataset.href;
    const on = href === '#/' ? h === '#/' || h === '' : h.startsWith(href) && !(href === '#/admin' && h.startsWith('#/admin/integrations'));
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
function setDrawer(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#overlay').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', String(open));
  if (open) $('#sidebar a')?.focus();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtn')) setDrawer(!$('#sidebar').classList.contains('open'));
  else if (e.target.id === 'overlay' || (e.target.closest('#sidebar a') && window.innerWidth <= 960)) setDrawer(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

// ---------- الموجّه ----------
const ROUTES = [
  [/^#?\/?$/, pageHome], [/^#\/courses$/, pageCourses], [/^#\/course\/(\w+)$/, pageCourse], [/^#\/lesson\/([\w-]+)$/, pageLesson],
  [/^#\/quiz\/([\w-]+)$/, pageQuiz], [/^#\/sim\/(\w+)$/, pageSim], [/^#\/dashboard$/, pageDashboard], [/^#\/profile$/, pageProfile],
  [/^#\/admin$/, pageAdmin], [/^#\/admin\/integrations$/, pageIntegrations], [/^#\/labs$/, pageLabs], [/^#\/login$/, pageLogin],
];
// التنقل متسلسل: كل عرض ينتظر السابق ويعرض العنوان الحالي وقت التنفيذ، فلا يكتب عرض قديم فوق جديد.
let navQueue = Promise.resolve();
function router() { navQueue = navQueue.then(renderRoute, renderRoute); return navQueue; }
async function renderRoute() {
  const h = location.hash || '#/';
  markNav();
  const m = main();
  m.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  for (const [re, fn] of ROUTES) {
    const mm = h.match(re);
    if (mm) {
      try { await fn(...mm.slice(1)); }
      catch (e) {
        if (e.status === 401) { m.innerHTML = needLogin(); }
        else m.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
      }
      m.focus({ preventScroll: true }); window.scrollTo(0, 0);
      return;
    }
  }
  m.innerHTML = '<div class="empty"><h2>الصفحة غير موجودة</h2><a class="btn btn-ghost" href="#/">العودة للرئيسية</a></div>';
}
const needLogin = () => `<div class="card empty"><h2>سجّل الدخول للمتابعة</h2><p>تقدمك ومحفظتك التدريبية محفوظة في حسابك.</p><a class="btn btn-primary" href="#/login">تسجيل الدخول</a></div>`;
window.addEventListener('hashchange', router);

// ---------- الشارت (SVG أصلي) ----------
function candleChart(bars, opts = {}) {
  const W = opts.w || 760, H = opts.h || 300, padR = 64, padL = 8, padT = 12, padB = 22;
  const shown = bars.slice(-(opts.max || 90));
  if (!shown.length) return '';
  const lows = shown.map((b) => +b.l), highs = shown.map((b) => +b.h);
  let lo = Math.min(...lows), hi = Math.max(...highs);
  const pad = (hi - lo) * 0.08 || hi * 0.01; lo -= pad; hi += pad;
  const y = (v) => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const step = (W - padL - padR) / shown.length, bw = Math.max(2, step * 0.62);
  const dp = opts.dp ?? 3;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, yy = y(v);
    g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="#EFE9DC"/><text x="${W - padR + 6}" y="${yy + 4}" font-size="11" fill="#8A92A3">${v.toFixed(dp)}</text>`;
  }
  shown.forEach((b, i) => {
    const x = padL + i * step + step / 2;
    if (b.closed) { g += `<circle cx="${x}" cy="${y(+b.c)}" r="1.6" fill="#C9C2B2"/>`; return; }
    const up = +b.c >= +b.o, col = up ? '#0E7A5F' : '#B4402E';
    const top = y(Math.max(+b.o, +b.c)), bot = y(Math.min(+b.o, +b.c));
    g += `<line x1="${x}" x2="${x}" y1="${y(+b.h)}" y2="${y(+b.l)}" stroke="${col}" stroke-width="1.2"/>`;
    g += `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" fill="${up ? col : col}" rx="1"/>`;
  });
  for (const ln of opts.lines || []) {
    const yy = y(+ln.v); if (yy < padT || yy > H - padB) continue;
    g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${ln.c}" stroke-dasharray="4 4" stroke-width="1"/><rect x="${W - padR + 2}" y="${yy - 9}" width="${padR - 4}" height="18" rx="4" fill="${ln.c}"/><text x="${W - padR + 6}" y="${yy + 4}" font-size="10.5" fill="#fff">${esc(ln.label)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'شارت شموع تدريبي')}">${g}<text x="${padL + 4}" y="${H - 6}" font-size="11" fill="#8A92A3">${esc(opts.foot || '')}</text></svg>`;
}

// ---------- قارئ الدروس (Markdown مبسط وآمن) ----------
function renderLessonBody(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = String(src).split('\n');
  let out = '', list = null, ex = [];
  const flushList = () => { if (list) { out += `</${list}>`; list = null; } };
  const flushEx = () => { if (ex.length) { out += `<div class="example">${ex.map((l) => `<p>${inline(l)}</p>`).join('')}</div>`; ex = []; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith('!! ')) { flushList(); ex.push(l.slice(3)); continue; }
    flushEx();
    if (l.startsWith('## ')) { flushList(); out += `<h2>${inline(l.slice(3))}</h2>`; }
    else if (l.startsWith('- ')) { if (list !== 'ul') { flushList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(l.slice(2))}</li>`; }
    else if (/^\d+\.\s/.test(l)) { if (list !== 'ol') { flushList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(l.replace(/^\d+\.\s/, ''))}</li>`; }
    else if (l.startsWith('> ')) { flushList(); out += `<div class="note">${inline(l.slice(2))}</div>`; }
    else if (!l.trim()) { flushList(); }
    else { flushList(); out += `<p>${inline(l)}</p>`; }
  }
  flushList(); flushEx();
  return out;
}

// ---------- الصفحات ----------
const HERO_ART = `<svg viewBox="0 0 440 340" aria-hidden="true" direction="ltr" style="direction:ltr">
  <defs><pattern id="geo" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M14 0l14 14-14 14L0 14z" fill="none" stroke="#E6DFCF" stroke-width="1"/></pattern></defs>
  <rect x="0" y="0" width="440" height="340" rx="28" fill="#F3EEE2"/>
  <rect x="0" y="0" width="440" height="340" rx="28" fill="url(#geo)" opacity=".8"/>
  <path d="M120 300V150a100 100 0 01200 0v150z" fill="#FAF7F0" stroke="#E6DFCF" stroke-width="2"/>
  <path d="M140 300V156a80 80 0 01160 0v144" fill="none" stroke="#B8913A" stroke-width="1.5" opacity=".6"/>
  <g stroke-linecap="round">
    <line x1="168" y1="250" x2="168" y2="214" stroke="#0E7A5F" stroke-width="2"/><rect x="161" y="222" width="14" height="22" rx="2" fill="#0E7A5F"/>
    <line x1="196" y1="236" x2="196" y2="196" stroke="#B4402E" stroke-width="2"/><rect x="189" y="204" width="14" height="18" rx="2" fill="#B4402E"/>
    <line x1="224" y1="226" x2="224" y2="176" stroke="#0E7A5F" stroke-width="2"/><rect x="217" y="186" width="14" height="30" rx="2" fill="#0E7A5F"/>
    <line x1="252" y1="196" x2="252" y2="150" stroke="#0E7A5F" stroke-width="2"/><rect x="245" y="160" width="14" height="26" rx="2" fill="#0E7A5F"/>
    <line x1="280" y1="176" x2="280" y2="128" stroke="#0E7A5F" stroke-width="2"/><rect x="273" y="136" width="14" height="28" rx="2" fill="#0E7A5F"/>
  </g>
  <path d="M150 262c40-10 70-40 100-80s40-50 60-62" fill="none" stroke="#14233C" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>
  <circle cx="312" cy="118" r="7" fill="#B8913A"/>
  <rect x="40" y="40" width="132" height="58" rx="14" fill="#FFFFFF" stroke="#E6DFCF"/>
  <text x="156" y="64" font-size="12" fill="#5A6478" text-anchor="end" font-family="IBM Plex Sans Arabic, sans-serif">رصيد تدريبي</text>
  <text x="156" y="86" font-size="17" font-weight="700" fill="#14233C" text-anchor="end" font-family="IBM Plex Sans Arabic, sans-serif">1,000 $</text>
  <rect x="300" y="236" width="112" height="58" rx="14" fill="#0E7A5F"/>
  <text x="396" y="260" font-size="12" fill="#E4F1EC" text-anchor="end" font-family="IBM Plex Sans Arabic, sans-serif">اختبار الفهم</text>
  <text x="396" y="282" font-size="16" font-weight="700" fill="#fff" text-anchor="end" font-family="IBM Plex Sans Arabic, sans-serif">✓ 80%</text>
</svg>`;

const JOURNEY = [
  ['اختر دورة', 'خمسة مسارات تبدأ من «كيف أبدأ؟»'], ['خريطة الدروس', 'ترى درسك الحالي وشروط فتح التالي'], ['شرح ومثال', 'مفهوم بسيط ثم مثال محسوب خطوة بخطوة'],
  ['أسئلة بتفسير', 'كل إجابة معها سبب صحتها أو خطئها'], ['إتمام المتطلبات', 'اجتياز الدروس المطلوبة بنسبة 70%'], ['فتح المحاكي', 'تطبيق بأموال وهمية وأسعار تدريبية'], ['تقرير التطبيق', 'أثر الرسوم والحجم والمخاطرة والالتزام بالخطة'],
];

async function pageHome() {
  const [tracks, prev] = await Promise.all([api('GET', '/api/tracks'), api('GET', '/api/preview')]);
  main().innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">${icon('shield')} تعلّم أولًا، ثم طبّق بأموال وهمية</span>
        <h1>افهم الأسواق المالية <span>بوضوح</span>،<br>وطبّق بثقة بلا مخاطرة.</h1>
        <p class="lead">دروس عربية متدرجة من «كيف أبدأ؟» حتى اختبار الفهم، في الأسهم المحلية والأجنبية والفوركس والعملات الرقمية والذهب والفضة — ثم محاكي يطبق فيه الطالب ما تعلمه.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/courses">ابدأ التعلّم</a>
          <a class="btn btn-ghost" href="#/course/local">جولة في أول دورة</a>
        </div>
        <div class="hero-points">
          <span>${icon('check')} شرح بسيط وأمثلة محسوبة</span><span>${icon('check')} اختبارات بتفسير الإجابات</span><span>${icon('check')} محاكي بقواعد كل سوق</span>
        </div>
      </div>
      <div class="hero-art">${HERO_ART}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>المسارات الخمسة</h2><p class="muted">كل مسار دورة متدرجة تنتهي بمحاكي تطبيقي.</p></div><a class="btn btn-ghost btn-sm" href="#/courses">كل الدورات</a></div>
      <div class="grid tracks">${tracks.map(trackCard).join('')}</div>
    </section>

    <section class="section journey-wrap">
      <div class="card"><h2>رحلة الطالب</h2><ol class="journey">${JOURNEY.map(([a, b]) => `<li><div><b>${a}</b><span>${b}</span></div></li>`).join('')}</ol></div>
      <div class="card">
        <div class="section-head" style="margin-bottom:8px"><h2 style="margin:0">معاينة المحاكي</h2><span class="chip gold">أسعار تدريبية — أموال وهمية</span></div>
        <p class="small muted" style="margin:0 0 8px">${esc(prev.nameAr)} · بالريال العُماني</p>
        <div class="chart-wrap">${candleChart(prev.bars, { w: 520, h: 250, dp: 3, foot: 'سيناريو تدريبي مولّد — لا يعكس السوق' })}</div>
        <div class="quote">
          <div><small>رصيد البداية</small><strong>100 أو 1,000 $</strong></div><div><small>الأوامر</small><strong>سوق · محدد</strong></div>
          <div><small>الحماية</small><strong>وقف · هدف</strong></div><div><small>بعد التجربة</small><strong>تقرير</strong></div>
        </div>
        <a class="btn btn-primary" href="#/sim/local">افتح المحاكي</a>
      </div>
    </section>`;
}
function trackCard(t) {
  const pct = t.progress.total ? Math.round((t.progress.done / t.progress.total) * 100) : 0;
  return `<a class="card track-card" href="#/course/${t.id}">
    <span class="track-icon">${icon(t.icon)}</span>
    <h3>${esc(t.title)}</h3><p>${esc(t.subtitle)}</p>
    <div class="bar" aria-label="التقدم ${pct}%"><span style="width:${pct}%"></span></div>
    <div class="track-meta"><span>${t.published} منشور من ${t.lessonsTotal}</span><span>${pct}%</span></div>
  </a>`;
}

async function pageCourses() {
  const tracks = await api('GET', '/api/tracks');
  main().innerHTML = `
    <h1>فهرس الدورات</h1>
    <p class="muted">كل دورة تبدأ بالتأسيس المشترك (الادخار والاستثمار والتداول، العائد والمخاطرة، الأوامر والاحتيال) ثم دروس المسار.</p>
    <div class="notice info" style="margin-bottom:18px">المحتوى المكتمل الآن: الدرس التأسيسي، ودرس عملي في الأسهم المحلية. بقية الدروس مسودات معلنة في خريطة المنهج.</div>
    <div class="grid tracks">${tracks.map(trackCard).join('')}</div>`;
}

async function pageCourse(id) {
  const d = await api('GET', '/api/tracks/' + id);
  let lastModule = '';
  const rows = d.items.map((it, n) => {
    const mod = it.track === 'foundation' ? 'التأسيس المشترك' : 'دروس المسار';
    const head = mod !== lastModule ? `<li class="module-label" style="display:block;border:0">${mod}</li>` : '';
    lastModule = mod;
    const isCur = it.id === d.current;
    const dot = it.passed ? `<span class="step-dot done">${icon('check')}</span>` : it.available ? `<span class="step-dot ${isCur ? 'current' : ''}">${n + 1}</span>` : `<span class="step-dot">${icon('lock')}</span>`;
    const action = it.available ? `<a class="btn ${isCur ? 'btn-primary' : 'btn-ghost'} btn-sm" href="#/lesson/${it.id}">${it.passed ? 'مراجعة' : isCur ? 'تابع الدرس' : 'افتح'}</a>` : `<span class="small muted">${esc(it.lockReason)}</span>`;
    return `${head}<li class="${it.available ? '' : 'locked'}">${dot}<div><div class="title">${esc(it.title)}</div>
      <div class="meta"><span class="chip">${esc(it.kind)}</span>${it.status !== 'published' ? statusChip(it.status) : ''}${it.required ? '<span class="chip green">مطلوب للمحاكي</span>' : ''}${it.minutes ? `<span>${it.minutes} دقيقة</span>` : ''}${it.best !== null ? `<span>أفضل نتيجة ${it.best}%</span>` : ''}${isCur ? '<span class="chip gold">الدرس الحالي</span>' : ''}</div></div>${action}</li>`;
  }).join('');
  const pct = d.progress.total ? Math.round((d.progress.done / d.progress.total) * 100) : 0;
  main().innerHTML = `
    <div class="course-head">
      <div><a class="small" href="#/courses">← الدورات</a><h1>${esc(d.track.title)}</h1><p class="muted" style="margin:0">${esc(d.track.subtitle)} · أصول المحاكي: ${d.instruments.map(esc).join('، ')}</p></div>
      <div class="card" style="min-width:240px"><div class="small muted">تقدم المتطلبات</div><strong style="font-size:24px">${d.progress.done} / ${d.progress.total}</strong><div class="bar" style="margin-top:8px"><span style="width:${pct}%"></span></div></div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);margin-top:22px" id="courseGrid">
      <div class="card"><h2>خريطة الدروس</h2><ul class="lesson-map">${rows}</ul>
        <p class="small muted" style="margin:14px 0 0">شرط الفتح: يُفتح الدرس التالي بعد اجتياز اختبار الدرس المطلوب السابق بنسبة 70% أو أكثر. الدروس المسودة تظهر للعلم ولا تُفتح.</p></div>
      <div class="card"><h2>المحاكي</h2>
        ${d.simUnlocked ? `<div class="notice info">المحاكي مفتوح لهذا المسار.</div><p></p><a class="btn btn-primary" href="#/sim/${d.track.id}">افتح المحاكي</a>`
          : `<p class="muted">يُفتح بعد اجتياز:</p><ul>${d.simRequirement.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><button class="btn btn-ghost" disabled>${icon('lock')} مقفل</button>`}
      </div>
    </div>`;
  if (window.innerWidth < 960) $('#courseGrid').style.gridTemplateColumns = '1fr';
}

async function pageLesson(id) {
  const { lesson: l, progress } = await api('GET', '/api/lessons/' + id);
  const track = l.track === 'foundation' ? 'local' : l.track;
  main().innerHTML = `
    <a class="small" href="#/course/${track}">← خريطة الدروس</a>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 280px;align-items:start;margin-top:8px" id="lessonGrid">
      <article class="card reader">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><span class="chip gold">${esc(l.kind)}</span>${l.minutes ? `<span class="chip">${l.minutes} دقيقة قراءة</span>` : ''}${l.status !== 'published' ? statusChip(l.status) + ' <span class="chip red">معاينة الطاقم</span>' : ''}</div>
        <h1 style="font-size:30px">${esc(l.title)}</h1>
        <p class="muted">${esc(l.summary)}</p>
        <div class="notice" style="margin:8px 0 6px">درس نصي. لا يوجد فيديو منشور لهذا الدرس بعد.</div>
        ${renderLessonBody(l.body)}
        <h2>المراجع</h2>
        <ul class="sources">${l.sources.length ? l.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><br><span class="small muted">آخر مراجعة: ${esc(s.reviewed)} · ${esc(s.rights)}</span> ${s.status !== 'published' ? statusChip(s.status) : ''}</li>`).join('') : '<li class="muted">لا مراجع بعد.</li>'}</ul>
      </article>
      <aside class="card" style="position:sticky;top:20px">
        <h3>بعد القراءة</h3>
        <p class="small muted">اختبار من ${l.questions} أسئلة، النجاح 70%. ستظهر لك الإجابة الصحيحة وتفسيرها.</p>
        ${progress?.best != null ? `<p class="small">أفضل نتيجة: <b>${progress.best}%</b> ${progress.passed ? '<span class="chip green">ناجح</span>' : ''}</p>` : ''}
        <a class="btn btn-primary" style="width:100%" href="#/quiz/${l.id}" id="toQuiz">ابدأ الاختبار</a>
      </aside>
    </div>`;
  if (window.innerWidth < 960) $('#lessonGrid').style.gridTemplateColumns = '1fr';
  api('POST', `/api/lessons/${id}/read`, {}).catch(() => {});
}

async function pageQuiz(id) {
  const q = await api('GET', `/api/lessons/${id}/quiz`);
  main().innerHTML = `
    <a class="small" href="#/lesson/${id}">← العودة للدرس</a>
    <h1 style="font-size:28px">اختبار: ${esc(q.title)}</h1>
    <p class="muted">أجب عن كل الأسئلة. النجاح ${q.passMark}%.</p>
    <form id="quizForm" class="card reader" novalidate>
      ${q.questions.map((x) => `<div class="quiz-q" id="q${x.i}"><fieldset><legend>${x.i + 1}. ${esc(x.q)}</legend>
        ${x.options.map((o, j) => `<label class="opt"><input type="radio" name="q${x.i}" value="${j}" required><span>${esc(o)}</span></label>`).join('')}
        </fieldset><div class="explain" hidden></div></div>`).join('')}
      <div id="quizMsg" role="alert"></div>
      <button class="btn btn-primary" type="submit">إرسال الإجابات</button>
    </form>`;
  $('#quizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = q.questions.map((x) => { const c = document.querySelector(`input[name=q${x.i}]:checked`); return c ? Number(c.value) : null; });
    if (answers.includes(null)) { $('#quizMsg').innerHTML = '<div class="notice err" style="margin-bottom:12px">أجب عن كل الأسئلة قبل الإرسال.</div>'; return; }
    const btn = e.submitter; btn.disabled = true;
    try {
      const r = await api('POST', `/api/lessons/${id}/quiz`, { answers });
      r.results.forEach((res) => {
        const box = $('#q' + res.i);
        box.querySelectorAll('.opt').forEach((lab, j) => { lab.classList.toggle('right', j === res.correct); lab.classList.toggle('wrong', j === res.chosen && !res.ok); lab.querySelector('input').disabled = true; });
        const ex = box.querySelector('.explain'); ex.hidden = false; ex.innerHTML = `<b>${res.ok ? 'صحيح.' : 'غير صحيح.'}</b> ${esc(res.explain)}`;
      });
      const course = q.track === 'foundation' ? 'local' : q.track;
      const d = await api('GET', '/api/tracks/' + course).catch(() => null);
      $('#quizMsg').innerHTML = `<div class="notice ${r.passed ? 'info' : ''}" style="margin-bottom:12px"><b>نتيجتك ${r.score}%</b> — ${r.passed ? 'اجتزت الاختبار.' : 'لم تصل إلى 70% بعد. راجع التفسيرات وأعد المحاولة.'} أفضل نتيجة: ${r.best}%.</div>`;
      btn.outerHTML = r.passed
        ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-primary" href="#/course/${course}">العودة لخريطة الدروس</a>${d?.simUnlocked ? `<a class="btn btn-ghost" href="#/sim/${course}">افتح المحاكي</a>` : ''}${q.track === 'foundation' ? '<a class="btn btn-ghost" href="#/courses">اختر مسارًا آخر</a>' : ''}</div>`
        : '<button class="btn btn-ghost" type="button" id="retry">إعادة المحاولة</button>';
      $('#retry')?.addEventListener('click', () => router());
      $('#quizMsg').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });
}

// ---------- المحاكي ----------
const TRACK_NAMES = { local: 'الأسهم المحلية', foreign: 'الأسهم الأجنبية', forex: 'الفوركس', crypto: 'العملات الرقمية', metals: 'الذهب والفضة' };
async function pageSim(track) {
  const d = await api('GET', '/api/sim/' + track);
  const sel = `<label class="small" for="trackSel">المسار</label> <select id="trackSel" style="width:auto;min-height:38px">${Object.entries(TRACK_NAMES).map(([k, v]) => `<option value="${k}" ${k === track ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const head = `<div class="section-head"><div><h1 style="font-size:30px;margin:0">المحاكي التدريبي</h1><p class="muted" style="margin:0">طبّق ما تعلمته. الهدف تطبيق الدروس، لا مسابقة أرباح.</p></div><div>${sel}</div></div>
    <div class="sim-banner" role="note"><span class="dot"></span>أسعار تدريبية — أموال وهمية. لأغراض التعلم فقط.</div>`;
  if (!d.unlocked) {
    main().innerHTML = `${head}<div class="card empty" style="margin-top:18px"><h2>${icon('lock')} المحاكي مقفل</h2><p>اجتز الدروس المطلوبة أولًا:</p><ul style="display:inline-block;text-align:start">${d.requirement.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p><a class="btn btn-primary" href="#/course/${track}">اذهب إلى الدروس</a></p></div>`;
    bindTrackSel(); return;
  }
  if (!d.state) { renderSimStart(track, head); return; }
  S.sim = { track, state: d.state, active: S.sim.track === track ? S.sim.active : 0, form: { type: 'market', side: 'buy' }, keys: {} };
  renderSim(head);
}
function bindTrackSel() { $('#trackSel')?.addEventListener('change', (e) => (location.hash = '#/sim/' + e.target.value)); }
function renderSimStart(track, head) {
  let bal = '100'; const key = uuid();
  main().innerHTML = `${head}<div class="card" style="margin-top:18px;max-width:720px"><h2>افتح محفظة تدريبية — ${TRACK_NAMES[track]}</h2>
    <p class="muted">اختر رصيد البداية بالدولار الافتراضي. إذا كان الأصل بعملة أخرى (ريال أو USDT) ستحوّل بسعر تدريب معلن ويُسجل التحويل ورسومه.</p>
    <div class="start-choice" role="group" aria-label="رصيد البداية">
      <button type="button" data-bal="100" aria-pressed="true"><span class="small muted">مبتدئ</span><strong class="num">100 $</strong><span class="small muted">يوضح أثر الرسوم والحد الأدنى بقوة</span></button>
      <button type="button" data-bal="1000" aria-pressed="false"><span class="small muted">موسّع</span><strong class="num">1,000 $</strong><span class="small muted">مساحة أكبر لتجربة حجم المركز</span></button>
    </div>
    <button class="btn btn-primary" id="openAcc">فتح المحفظة</button></div>`;
  bindTrackSel();
  main().querySelectorAll('[data-bal]').forEach((b) => b.addEventListener('click', () => { bal = b.dataset.bal; main().querySelectorAll('[data-bal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#openAcc').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('POST', `/api/sim/${track}/open`, { startBalance: bal }, { idem: key }); router(); }
    catch (err) { e.target.disabled = false; toast(err.message, true); }
  });
}

function renderSim(head) {
  const { state: st } = S.sim;
  const ins = st.instruments[S.sim.active] || st.instruments[0];
  const f = S.sim.form;
  const tickDp = dpOf(ins.tick);
  const openProtect = st.orders.filter((o) => o.status === 'open' && o.sym === ins.key);
  const lines = [];
  if (ins.quote) { lines.push({ v: ins.quote.ask, c: '#0E7A5F', label: 'Ask ' + ins.quote.ask }); lines.push({ v: ins.quote.bid, c: '#B4402E', label: 'Bid ' + ins.quote.bid }); }
  openProtect.forEach((o) => { if (o.limit) lines.push({ v: o.limit, c: '#14233C', label: 'حد ' + o.limit }); if (o.stop) lines.push({ v: o.stop, c: '#9A6B12', label: 'وقف' }); if (o.target) lines.push({ v: o.target, c: '#B8913A', label: 'هدف' }); });
  const pos = st.positions.find((p) => p.sym === ins.key);
  const wallets = Object.entries(st.wallets);
  const spread = ins.quote ? (Number(ins.quote.ask) - Number(ins.quote.bid)).toFixed(tickDp + 1) : '—';

  main().innerHTML = `${head}
    <div class="sim-grid" style="margin-top:18px">
      <div class="grid">
        <div class="card">
          ${st.instruments.length > 1 ? `<div class="tabs" role="tablist">${st.instruments.map((x, i) => `<button role="tab" type="button" data-ins="${i}" aria-selected="${i === S.sim.active}">${esc(x.symbol)}</button>`).join('')}</div>` : ''}
          <div class="section-head" style="margin-bottom:6px"><div><h2 style="margin:0">${esc(ins.nameAr)} <span class="small muted num">${esc(ins.symbol)}</span></h2>
            <p class="small muted" style="margin:0">الوحدة: ${esc(ins.unitAr)} · العملة: ${esc(ins.currency)}${ins.product ? ' · ' + esc(ins.product) : ''}</p></div>
            <div style="text-align:end"><span class="chip ${ins.closed ? 'amber' : 'green'}">${ins.closed ? 'خارج الجلسة التدريبية' : ins.session === 'always' ? 'سوق مستمر' : 'الجلسة مفتوحة'}</span><div class="small muted">الفترة <span class="num">${st.cursor + 1} / ${st.barsTotal}</span></div></div></div>
          <div class="chart-wrap">${candleChart(ins.bars, { dp: tickDp, lines, foot: 'آخر 90 فترة · لا تُعرض الفترات القادمة' })}</div>
          <div class="quote">
            <div><small>Bid (تبيع عنده)</small><strong class="num">${ins.quote ? esc(ins.quote.bid) : '—'}</strong></div>
            <div><small>Ask (تشتري عنده)</small><strong class="num">${ins.quote ? esc(ins.quote.ask) : '—'}</strong></div>
            <div><small>الفارق</small><strong class="num">${esc(spread)}</strong></div>
            <div><small>الرسوم</small><strong>${ins.fee.pct === '0' ? 'الفارق فقط' : (Number(ins.fee.pct) * 100).toFixed(2) + '%'}</strong></div>
          </div>
          <p class="small muted" style="margin:0 0 12px">${esc(ins.note)}</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-primary" id="advBtn" ${st.ended ? 'disabled' : ''}>الفترة التالية ←</button>
            <button class="btn btn-ghost" id="repBtn">تقرير التطبيق</button>
            <button class="btn btn-ghost btn-sm" id="resetBtn">محفظة جديدة</button>
            ${st.ended ? '<span class="chip amber">انتهى السيناريو</span>' : ''}
          </div>
        </div>
        <div class="card" id="reportBox" hidden></div>
        <div class="card"><h2>المراكز والأوامر</h2>
          <div class="table-scroll"><table><thead><tr><th>الأصل</th><th>الكمية</th><th>المحجوز</th><th>متوسط التكلفة</th><th>قيمة التصفية الآن</th><th>غير محقق</th></tr></thead><tbody>
          ${st.positions.length ? st.positions.map((p) => `<tr><td>${esc(p.symbol)}</td><td class="num">${fq(p.qty, p.sym)}</td><td class="num">${fq(p.reserved, p.sym)}</td><td class="num">${esc(p.avgCost)}</td><td>${money(p.liquidationValue, p.currency)}</td><td class="${Number(p.unrealized) >= 0 ? 'pos' : 'neg'}">${money(p.unrealized, p.currency)}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">لا توجد مراكز مفتوحة.</td></tr>'}
          </tbody></table></div>
          <p class="small muted">قيمة التصفية = الكمية × Bid ناقص رسوم البيع. متوسط التكلفة يشمل رسوم الشراء.</p>
          <h3>الأوامر المفتوحة</h3>
          ${st.orders.filter((o) => o.status === 'open').length ? `<div class="table-scroll"><table><thead><tr><th>#</th><th>النوع</th><th>الأصل</th><th>الكمية</th><th>السعر</th><th></th></tr></thead><tbody>${st.orders.filter((o) => o.status === 'open').map((o) => `<tr><td>${o.id}</td><td>${o.type === 'limit' ? (o.side === 'buy' ? 'شراء محدد' : 'بيع محدد') : 'حماية (وقف/هدف)'}</td><td>${esc(INSNAME(o.sym))}</td><td>${fq(o.qty, o.sym)}</td><td class="num">${esc(o.limit || [o.stop && 'وقف ' + o.stop, o.target && 'هدف ' + o.target].filter(Boolean).join(' / '))}</td><td><button class="btn btn-ghost btn-sm" data-cancel="${o.id}">إلغاء</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">لا توجد أوامر مفتوحة.</p>'}
        </div>
        <div class="card"><h2>سجل التنفيذ وقراراتك</h2>
          <ul class="ledger" style="list-style:none;padding:0;margin:0">${st.ledger.slice().reverse().map((e) => `<li><span class="chip">${e.cursor + 1}</span> ${esc(e.text)}${e.reason ? `<span class="reason">السبب: ${esc(e.reason)}</span>` : ''}</li>`).join('')}</ul>
        </div>
      </div>

      <div class="grid">
        <form class="card" id="ticket" novalidate>
          <h2>أمر جديد</h2>
          <div class="seg" role="group" aria-label="نوع الأمر" style="margin-bottom:12px">
            ${[['market', 'سوق'], ['limit', 'محدد'], ['protect', 'وقف/هدف']].map(([k, v]) => `<button type="button" data-type="${k}" aria-pressed="${f.type === k}">${v}</button>`).join('')}
          </div>
          ${f.type !== 'protect' ? `<div class="seg" role="group" aria-label="الاتجاه" style="margin-bottom:14px;margin-inline-start:6px">
            <button type="button" class="buy" data-side="buy" aria-pressed="${f.side === 'buy'}">شراء</button><button type="button" class="sell" data-side="sell" aria-pressed="${f.side === 'sell'}">بيع</button></div>` : '<p class="small muted">حماية مركز قائم: وقف خسارة و/أو هدف. ينفذ أحدهما ويُلغى الآخر.</p>'}
          <div class="field"><label for="qty">الكمية (${esc(ins.unitAr)})</label><input id="qty" type="text" inputmode="decimal" dir="ltr" value="${esc(f.qty || '')}" placeholder="${esc(ins.qtyStep)}"><span class="hint">بمضاعفات ${esc(ins.qtyStep)}${pos ? ` · تملك ${fq(pos.qty, pos.sym)} (المحجوز ${fq(pos.reserved, pos.sym)})` : ''}</span></div>
          ${f.type === 'limit' ? `<div class="field"><label for="limit">سعر الحد (${esc(ins.currency)})</label><input id="limit" type="text" inputmode="decimal" dir="ltr" value="${esc(f.limit || '')}" placeholder="${esc(ins.quote?.bid || '')}"><span class="hint">لن يُنفذ ${f.side === 'buy' ? 'بأعلى' : 'بأقل'} من هذا السعر. التيك ${esc(ins.tick)}.</span></div>` : ''}
          ${f.type === 'protect' ? `<div class="field"><label for="stop">سعر الوقف</label><input id="stop" type="text" inputmode="decimal" dir="ltr" value="${esc(f.stop || '')}"></div><div class="field"><label for="target">سعر الهدف</label><input id="target" type="text" inputmode="decimal" dir="ltr" value="${esc(f.target || '')}"></div>` : ''}
          <div class="field"><label for="reason">لماذا تتخذ هذا القرار؟ (إلزامي)</label><textarea id="reason" maxlength="500" placeholder="مثال: أطبق درس عرض السعر — شراء صغير لأرى أثر الفارق والرسوم">${esc(f.reason || '')}</textarea></div>
          <div class="estimate" id="estimate" aria-live="polite"></div>
          <div id="ticketMsg" role="alert"></div>
          <button class="btn btn-primary" style="width:100%" type="submit" id="submitOrder">${f.type === 'protect' ? 'تثبيت الحماية' : f.side === 'buy' ? 'تنفيذ الشراء' : 'تنفيذ البيع'}</button>
          <p class="small muted" style="margin:10px 0 0">التقدير للعرض فقط؛ الخادم يحدد السعر والرسوم عند التنفيذ.</p>
        </form>

        <div class="card"><h2>الأرصدة</h2>
          <div class="wallets">${wallets.map(([c, w]) => `<div class="wallet"><div><b>${esc(c)}</b><div class="small muted">المحجوز: ${money(w.reserved, c)}</div></div><div style="text-align:end"><div class="small muted">المتاح</div><b>${money(w.avail, c)}</b></div></div>`).join('')}</div>
          <p class="small" style="margin:10px 0 0">قيمة المحفظة التقديرية: <b>${money(st.equityUSD, 'USD')}</b> <span class="muted">(من ${money(st.startBalance, 'USD')})</span></p>
          <form id="convForm" style="margin-top:14px" novalidate>
            <h3>تحويل عملة (سعر تدريب معلن)</h3>
            <div class="form-grid" style="grid-template-columns:1fr 1fr"><div class="field"><label for="cFrom">من → إلى</label><select id="cFrom">${Object.keys(st.fx).map((k) => `<option value="${k}" ${k === defaultConv(ins.currency) ? 'selected' : ''}>${k.replace('>', ' ← ')}</option>`).join('')}</select></div>
            <div class="field"><label for="cAmt">المبلغ</label><input id="cAmt" type="text" inputmode="decimal" dir="ltr"></div></div>
            <p class="small muted" id="convInfo"></p>
            <button class="btn btn-ghost" type="submit">تحويل</button>
          </form>
        </div>

        <div class="card"><details class="policy"><summary>سياسات التنفيذ المعلنة</summary><ul>${Object.values(st.policy).map((p) => `<li>${esc(p)}</li>`).join('')}<li>تقييم USDT في التقارير = 1$ (افتراض تدريبي).</li></ul></details></div>
      </div>
    </div>`;
  bindTrackSel();
  bindSim(ins);
}
const QSTEP = { MCT: '1', TTC: '1', EURUSD: '100', BTC: '0.00001', XAU: '0.001', XAG: '0.01' };
const fq = (v, sym) => `<span class="num">${num(v, dpOf(QSTEP[sym] || '1'))}</span>`;
const INSNAME = (k) => ({ MCT: 'MCT', TTC: 'TTC', EURUSD: 'EUR/USD', BTC: 'BTC/USDT', XAU: 'XAU', XAG: 'XAG' }[k] || k);
const defaultConv = (c) => (c === 'OMR' ? 'USD>OMR' : c === 'USDT' ? 'USD>USDT' : 'USD>OMR');

function updateEstimate(ins) {
  const f = S.sim.form, box = $('#estimate'); if (!box) return;
  const qty = Number(f.qty); if (!qty || f.type === 'protect') { box.innerHTML = '<span class="muted">أدخل الكمية لرؤية التقدير.</span>'; if (f.type === 'protect') box.innerHTML = '<span class="muted">عند التفعيل: الوقف يتحول لأمر سوق (قد ينزلق)، والهدف لا ينفذ بأقل من سعره.</span>'; return; }
  const price = f.type === 'limit' ? Number(f.limit) : ins.quote ? Number(f.side === 'buy' ? ins.quote.ask : ins.quote.bid) + (f.side === 'buy' ? 1 : -1) * Number(ins.tick) : NaN;
  if (!price) { box.innerHTML = '<span class="muted">لا يوجد سعر حالي.</span>'; return; }
  const notional = qty * price, fee = Math.max(notional * Number(ins.fee.pct), Number(ins.fee.min || 0));
  const total = f.side === 'buy' ? notional + fee : notional - fee;
  const dp = CUR[ins.currency].dp;
  box.innerHTML = `<div><span>السعر ${f.type === 'market' ? '(مع انزلاق تيك)' : '(الحد)'}</span><span class="num">${price.toFixed(dpOf(ins.tick))}</span></div>
    <div><span>القيمة</span><span>${money(notional.toFixed(dp + 2), ins.currency)}</span></div><div><span>الرسوم</span><span>${money(fee.toFixed(dp + 2), ins.currency)}</span></div>
    <div><b>${f.side === 'buy' ? 'تقريبًا تدفع' : 'تقريبًا تستلم'}</b><b>${money(total.toFixed(dp + 2), ins.currency)}</b></div>`;
}

function bindSim(ins) {
  const st = S.sim.state, f = S.sim.form;
  const save = () => { ['qty', 'limit', 'stop', 'target', 'reason'].forEach((k) => { const el = $('#' + k); if (el) f[k] = el.value; }); };
  main().querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => { save(); S.sim.active = Number(b.dataset.ins); renderSim(simHead()); }));
  main().querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { save(); f.type = b.dataset.type; renderSim(simHead()); }));
  main().querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { save(); f.side = b.dataset.side; renderSim(simHead()); }));
  ['qty', 'limit'].forEach((k) => $('#' + k)?.addEventListener('input', () => { save(); updateEstimate(ins); }));
  updateEstimate(ins);

  const act = async (path, body, keyName, btn) => {
    S.sim.keys[keyName] ||= uuid(); // نفس المفتاح عند إعادة المحاولة بعد خطأ شبكة
    if (btn) btn.disabled = true;
    try {
      const r = await api('POST', `/api/sim/${S.sim.track}/${path}`, body, { idem: S.sim.keys[keyName] });
      delete S.sim.keys[keyName];
      S.sim.state = r.state; return r;
    } catch (e) {
      if (!e.network) delete S.sim.keys[keyName];
      if (btn) btn.disabled = false;
      throw e;
    }
  };

  $('#ticket').addEventListener('submit', async (e) => {
    e.preventDefault(); save();
    const body = { sym: ins.key, type: f.type, side: f.side, qty: (f.qty || '').trim(), reason: f.reason, quoteCursor: st.cursor };
    if (f.type === 'limit') body.limit = (f.limit || '').trim();
    if (f.type === 'protect') { body.stop = (f.stop || '').trim(); body.target = (f.target || '').trim(); }
    try {
      const r = await act('order', body, 'order', $('#submitOrder'));
      toast(r.result.status === 'filled' ? `نُفذ بسعر ${r.result.fillPrice}` : 'سُجل الأمر وحُجز المطلوب');
      Object.assign(f, { qty: '', limit: '', stop: '', target: '', reason: '' });
      renderSim(simHead());
    } catch (err) { $('#ticketMsg').innerHTML = `<div class="notice err" style="margin-bottom:10px">${esc(err.message)}</div>`; }
  });
  $('#advBtn')?.addEventListener('click', async (e) => {
    save();
    try { await act('advance', { fromCursor: st.cursor }, 'adv', e.target); renderSim(simHead()); }
    catch (err) { toast(err.message, true); if (err.status === 400) router(); }
  });
  main().querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await act('cancel', { orderId: b.dataset.cancel }, 'cancel-' + b.dataset.cancel, b); toast('أُلغي الأمر'); renderSim(simHead()); } catch (err) { toast(err.message, true); }
  }));
  const convInfo = () => {
    const k = $('#cFrom').value, r = st.fx[k];
    $('#convInfo').textContent = `${k.replace('>', ' ← ')}: ${r.op === 'mul' ? '×' : '÷'} ${r.rate}، رسوم ${(Number(r.feePct) * 100).toFixed(2)}% من المبلغ المحوَّل.`;
  };
  $('#cFrom').addEventListener('change', convInfo); convInfo();
  $('#convForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const [from, to] = $('#cFrom').value.split('>');
    try { const r = await act('convert', { from, to, amount: $('#cAmt').value.trim() }, 'conv', e.submitter); toast(`حُوّل ${r.result.amount} ${from} → ${r.result.credited} ${to}`); renderSim(simHead()); }
    catch (err) { toast(err.message, true); }
  });
  $('#repBtn').addEventListener('click', async () => {
    const r = await api('GET', `/api/sim/${S.sim.track}/report`);
    const box = $('#reportBox'); box.hidden = false;
    box.innerHTML = `<h2>تقرير التطبيق</h2>
      <div class="kpis"><div class="kpi"><small>قيمة المحفظة</small><strong>${money(r.equityUSD, 'USD')}</strong></div><div class="kpi"><small>ربح/خسارة محققة</small><strong class="${Number(r.realizedUSD) >= 0 ? 'pos' : 'neg'}">${money(r.realizedUSD, 'USD')}</strong></div>
      <div class="kpi"><small>الرسوم والتحويل</small><strong>${money(r.feesUSD, 'USD')}</strong><small>${esc(r.feePct)}% من رأس المال</small></div><div class="kpi"><small>الصفقات / المحمية</small><strong class="num">${r.trades} / ${r.protectedOrders}</strong><small>أكبر صفقة ${esc(r.maxPositionPct)}%</small></div></div>
      <h3 style="margin-top:16px">قراءة تعليمية</h3>${r.insights.map((i) => `<div class="insight ${i.tone}">${esc(i.text)}</div>`).join('')}
      <p class="small muted">القيم بالدولار تقديرية بأسعار التحويل التدريبية. الصفقة الرابحة لا تعني تلقائيًا قرارًا جيدًا.</p>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#resetBtn').addEventListener('click', () => { if (confirmReset()) renderSimStart(S.sim.track, simHead()); });
}
function confirmReset() { return window.confirm('ستُؤرشف المحفظة الحالية وتبدأ محفظة جديدة بسيناريو جديد. متابعة؟'); }
function simHead() {
  const track = S.sim.track;
  return `<div class="section-head"><div><h1 style="font-size:30px;margin:0">المحاكي التدريبي</h1><p class="muted" style="margin:0">طبّق ما تعلمته. الهدف تطبيق الدروس، لا مسابقة أرباح.</p></div><div><label class="small" for="trackSel">المسار</label> <select id="trackSel" style="width:auto;min-height:38px">${Object.entries(TRACK_NAMES).map(([k, v]) => `<option value="${k}" ${k === track ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <div class="sim-banner" role="note"><span class="dot"></span>أسعار تدريبية — أموال وهمية. لأغراض التعلم فقط.</div>`;
}

// ---------- اللوحة والملف ----------
async function pageDashboard() {
  const p = await api('GET', '/api/progress');
  main().innerHTML = `<h1>لوحتي والتقدم</h1><p class="muted">أهلًا ${esc(S.user.name)} — هذا ملخص تقدمك وتجاربك في المحاكي.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${p.tracks.map((t) => {
      const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
      return `<div class="card"><h3>${esc(t.title)}</h3><div class="bar"><span style="width:${pct}%"></span></div>
        <p class="small muted" style="margin:6px 0 10px">المتطلبات ${t.done}/${t.total} · المحاكي ${t.simUnlocked ? '<span class="chip green">مفتوح</span>' : '<span class="chip">مقفل</span>'}</p>
        ${t.sim ? `<p class="small">المحفظة: ${money(t.sim.equityUSD, 'USD')} من ${money(t.sim.startBalance, 'USD')} · صفقات ${t.sim.trades} · رسوم ${esc(t.sim.feePct)}%</p>` : '<p class="small muted">لا توجد محفظة تدريبية بعد.</p>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap">${t.current ? `<a class="btn btn-primary btn-sm" href="#/lesson/${t.current}">تابع الدرس الحالي</a>` : ''}<a class="btn btn-ghost btn-sm" href="#/course/${t.id}">خريطة الدروس</a>${t.simUnlocked ? `<a class="btn btn-ghost btn-sm" href="#/sim/${t.id}">المحاكي</a>` : ''}</div></div>`;
    }).join('')}</div>`;
}
async function pageProfile() {
  if (!S.user) { main().innerHTML = needLogin(); return; }
  main().innerHTML = `<h1>الملف الشخصي</h1>
    <form class="card" id="profForm" style="max-width:560px" novalidate>
      <div class="field"><label for="pName">الاسم</label><input id="pName" type="text" value="${esc(S.user.name)}" maxlength="80"></div>
      <div class="field"><label for="pGoal">هدفي من التعلم</label><textarea id="pGoal" maxlength="300" placeholder="مثال: أفهم الأسهم المحلية قبل أن أستثمر أي مبلغ">${esc(S.user.goal)}</textarea></div>
      <p class="small muted">البريد: <span dir="ltr">${esc(S.user.email)}</span> · الدور: ${roleName(S.user.role)}</p>
      <div style="display:flex;gap:10px"><button class="btn btn-primary" type="submit">حفظ</button><button class="btn btn-ghost" type="button" id="logout">تسجيل الخروج</button></div>
    </form>
    <div class="notice" style="max-width:560px;margin-top:16px">لا نطلب أبدًا بيانات حساب تداول حقيقي أو مفاتيح سحب أو عبارات استرداد محافظ.</div>`;
  $('#profForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('PUT', '/api/profile', { name: $('#pName').value, goal: $('#pGoal').value }); S.user = r.user; renderShell(); toast('حُفظ الملف'); } catch (err) { toast(err.message, true); }
  });
  $('#logout').addEventListener('click', async () => { await auth.logout(); S.user = null; renderShell(); location.hash = '#/'; });
}
async function pageLogin() {
  main().innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));max-width:900px">
    <form class="card" id="loginForm" novalidate><h1 style="font-size:28px">تسجيل الدخول</h1>
      <div class="field"><label for="lEmail">البريد</label><input id="lEmail" type="email" dir="ltr" autocomplete="username"></div>
      <div class="field"><label for="lPw">كلمة المرور</label><input id="lPw" type="password" dir="ltr" autocomplete="current-password"></div>
      <div id="loginMsg" role="alert"></div><button class="btn btn-primary" type="submit">دخول</button></form>
    <form class="card" id="regForm" novalidate><h2>حساب طالب جديد</h2>
      <div class="field"><label for="rName">الاسم</label><input id="rName" type="text"></div>
      <div class="field"><label for="rEmail">البريد</label><input id="rEmail" type="email" dir="ltr" autocomplete="email"></div>
      <div class="field"><label for="rPw">كلمة المرور (8 أحرف على الأقل)</label><input id="rPw" type="password" dir="ltr" autocomplete="new-password"></div>
      <button class="btn btn-ghost" type="submit">إنشاء الحساب</button></form></div>
    ${REMOTE ? '<div class="notice info" style="max-width:900px;margin-top:16px">حسابك يحفظ تقدمك ومحفظتك التدريبية. لا نطلب أبدًا بيانات حساب تداول حقيقي.</div>' : '<div class="notice" style="max-width:900px;margin-top:16px">معاينة محلية: الحسابات التجريبية موثقة في README (مالك، محرر، مراجع، طالب). لا تستخدم كلمات مرور حقيقية هنا.</div>'}`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { S.user = await auth.login($('#lEmail').value, $('#lPw').value); renderShell(); location.hash = '#/dashboard'; }
    catch (err) { $('#loginMsg').innerHTML = `<div class="notice err" style="margin-bottom:10px">${esc(err.message)}</div>`; }
  });
  $('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const msg = await auth.register($('#rName').value, $('#rEmail').value, $('#rPw').value); toast(msg); $('#lEmail').value = $('#rEmail').value; if (session.get()) { S.user = (await api('GET', '/api/me')).user; renderShell(); location.hash = '#/dashboard'; } }
    catch (err) { toast(err.message, true); }
  });
}
async function pageLabs() {
  const box = (t, d, items) => `<div class="card coming"><h3>${t} <span class="chip">قريبًا</span></h3><p class="muted small">${d}</p><ul class="small">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
  main().innerHTML = `<h1>الذكاء الاصطناعي والمكتبة</h1><p class="muted">توسعات قادمة منفصلة عن المسارات المالية الخمسة. لا شيء منها مفعل الآن.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      ${box('دورات الذكاء الاصطناعي التوليدي', 'دورات عملية للاستخدام اليومي والعمل.', ['ChatGPT للعمل والدراسة', 'Claude للتحليل والكتابة', 'الأتمتة وربط الأدوات'])}
      ${box('مكتبة البرومبتات', 'قوالب قابلة للبحث والحفظ.', ['بحث وتصنيف', 'حفظ في حسابك', 'أمثلة للمشتريات والبنوك'])}
      ${box('الكتب والأدلة', 'كتب المؤسس والمواد المرخصة فقط.', ['حقوق استخدام موثقة لكل مادة', 'استيراد من Drive/Dropbox بتفويض', 'لا نسخ لكتب أو دورات مدفوعة دون حق'])}
    </div>`;
}

// ---------- الإدارة ----------
async function pageAdmin() {
  if (!S.user || !['owner', 'editor', 'reviewer'].includes(S.user.role)) { main().innerHTML = '<div class="notice err">هذه الصفحة للطاقم فقط.</div>'; return; }
  const d = await api('GET', '/api/admin/overview');
  const tab = sessionStorage.getItem('adminTab') || 'lessons';
  const tabs = [['lessons', 'الدروس والأسئلة'], ['sources', 'المصادر'], ['scenarios', 'السيناريوهات'], ['users', 'المستخدمون والأدوار'], ['audit', 'السجل']];
  main().innerHTML = `<h1>إدارة المحتوى</h1><p class="muted">دورك: <b>${roleName(d.role)}</b>. الأدوار يفرضها الخادم: المحرر ينشئ ويعدل ويرسل للمراجعة، المراجع يعتمد أو يعيد، المالك ينشر.</p>
    <div class="tabs" role="tablist">${tabs.map(([k, v]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}">${v}</button>`).join('')}</div><div id="adminBody"></div>`;
  main().querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('adminTab', b.dataset.tab); pageAdmin(); }));
  const body = $('#adminBody');
  const canDo = (from, to) => (d.transitions[`${from}>${to}`] || []).includes(d.role);
  const TLABEL = { in_review: 'إرسال للمراجعة', approved: 'اعتماد', draft: 'إعادة لمسودة', published: 'نشر' };

  if (tab === 'lessons') {
    body.innerHTML = `<div class="card"><div class="section-head"><h2 style="margin:0">الدروس (${d.lessons.length})</h2>${['owner', 'editor'].includes(d.role) ? '<button class="btn btn-primary btn-sm" id="newLesson">درس جديد</button>' : ''}</div>
      <div class="table-scroll"><table><thead><tr><th>العنوان</th><th>المسار</th><th>الحالة</th><th>أسئلة</th><th>إجراءات</th></tr></thead><tbody>
      ${d.lessons.sort((a, b) => a.track.localeCompare(b.track) || a.order - b.order).map((l) => `<tr><td>${esc(l.title)}${l.required ? ' <span class="chip green">مطلوب</span>' : ''}</td><td>${esc(l.track === 'foundation' ? 'تأسيس' : TRACK_NAMES[l.track] || l.track)}</td><td>${statusChip(l.status)}</td><td class="num">${l.questions}</td>
        <td><div class="admin-row-actions">${l.status === 'draft' && ['owner', 'editor'].includes(d.role) ? `<button class="btn btn-ghost btn-sm" data-edit="${l.id}">تعديل</button>` : ''}<a class="btn btn-ghost btn-sm" href="#/lesson/${l.id}">معاينة</a>
        ${['in_review', 'approved', 'draft', 'published'].filter((to) => canDo(l.status, to)).map((to) => `<button class="btn btn-sm ${to === 'published' ? 'btn-primary' : 'btn-ghost'}" data-tr="${l.id}" data-to="${to}">${TLABEL[to]}</button>`).join('')}</div></td></tr>`).join('')}
      </tbody></table></div></div><div id="editor"></div>`;
    body.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('POST', `/api/admin/lessons/${b.dataset.tr}/transition`, { to: b.dataset.to }); toast('تم'); pageAdmin(); } catch (e) { toast(e.message, true); }
    }));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => lessonEditor(await api('GET', '/api/admin/lessons/' + b.dataset.edit), d)));
    $('#newLesson')?.addEventListener('click', () => lessonEditor({ title: '', track: 'local', order: 9, kind: 'نظري', required: false, minutes: 10, summary: '', body: '## الفكرة\n', quiz: [], sources: [] }, d));
  }
  if (tab === 'sources') {
    body.innerHTML = `<div class="card"><h2>المصادر</h2><div class="table-scroll"><table><thead><tr><th>المصدر</th><th>المراجعة</th><th>الحقوق</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></td><td class="num">${esc(s.reviewed)}</td><td class="small">${esc(s.rights)}</td><td>${statusChip(s.status)}</td>
        <td><div class="admin-row-actions">${['owner', 'reviewer'].includes(d.role) ? ['published', 'rejected'].filter((x) => x !== s.status).map((x) => `<button class="btn btn-ghost btn-sm" data-src="${s.id}" data-st="${x}">${x === 'published' ? 'اعتماد' : 'رفض'}</button>`).join('') : ''}</div></td></tr>`).join('')}</tbody></table></div></div>
      ${['owner', 'editor'].includes(d.role) ? `<form class="card" id="srcForm" style="margin-top:16px" novalidate><h3>إضافة مصدر</h3><div class="form-grid">
        <div class="field"><label for="sT">العنوان</label><input id="sT" type="text"></div><div class="field"><label for="sU">الرابط (https)</label><input id="sU" type="text" dir="ltr"></div><div class="field"><label for="sR">تاريخ المراجعة</label><input id="sR" type="text" dir="ltr" placeholder="2026-11-22"></div></div>
        <div class="field"><label for="sRi">حقوق الاستخدام</label><input id="sRi" type="text" placeholder="مثال: رابط مرجعي فقط"></div><button class="btn btn-primary" type="submit">إضافة (تذهب للمراجعة)</button></form>` : ''}`;
    body.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', async () => { try { await api('PUT', `/api/admin/sources/${b.dataset.src}/status`, { status: b.dataset.st }); pageAdmin(); } catch (e) { toast(e.message, true); } }));
    $('#srcForm')?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('POST', '/api/admin/sources', { title: $('#sT').value, url: $('#sU').value, reviewed: $('#sR').value, rights: $('#sRi').value }); toast('أُضيف المصدر'); pageAdmin(); } catch (err) { toast(err.message, true); } });
  }
  if (tab === 'scenarios') {
    body.innerHTML = `<div class="card"><h2>سيناريوهات الأسعار التدريبية</h2><p class="small muted">السيناريو المنشور يُستخدم للمحافظ الجديدة فقط. الأسعار مولدة حتميًا من البذرة.</p><div class="table-scroll"><table><thead><tr><th>العنوان</th><th>البذرة</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${d.scenarios.map((s) => `<tr><td>${esc(s.title)}<div class="small muted">${esc(s.note)}</div></td><td class="num">${s.baseSeed}</td><td>${statusChip(s.status)}</td><td><div class="admin-row-actions"><button class="btn btn-ghost btn-sm" data-prev="${s.id}">معاينة</button>${d.role === 'owner' && s.status !== 'published' ? `<button class="btn btn-primary btn-sm" data-pub="${s.id}">نشر</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div><div id="scnPrev" class="chart-wrap"></div></div>
      ${['owner', 'editor'].includes(d.role) ? `<form class="card" id="scnForm" style="margin-top:16px" novalidate><h3>سيناريو جديد (مسودة)</h3><div class="form-grid"><div class="field"><label for="cT">العنوان</label><input id="cT" type="text"></div><div class="field"><label for="cS">البذرة (عدد صحيح)</label><input id="cS" type="text" dir="ltr"></div><div class="field"><label for="cN">ملاحظة</label><input id="cN" type="text"></div></div><button class="btn btn-primary" type="submit">إنشاء</button></form>` : ''}`;
    body.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', async () => { const r = await api('GET', `/api/admin/scenarios/${b.dataset.prev}/preview`); $('#scnPrev').innerHTML = candleChart(r.bars, { max: 120, dp: 3, foot: 'معاينة الطاقم: أول 120 فترة من MCT' }); }));
    body.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', async () => { try { await api('POST', `/api/admin/scenarios/${b.dataset.pub}/publish`, {}); pageAdmin(); } catch (e) { toast(e.message, true); } }));
    $('#scnForm')?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('POST', '/api/admin/scenarios', { title: $('#cT').value, baseSeed: Number($('#cS').value), note: $('#cN').value }); pageAdmin(); } catch (err) { toast(err.message, true); } });
  }
  if (tab === 'users') {
    body.innerHTML = d.role !== 'owner' ? '<div class="notice">إدارة الأدوار متاحة للمالك فقط.</div>' : `<div class="card"><h2>المستخدمون</h2><div class="table-scroll"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th></tr></thead><tbody>
      ${d.users.map((u) => `<tr><td>${esc(u.name)}</td><td dir="ltr">${esc(u.email)}</td><td>${u.id === S.user.id ? roleName(u.role) : `<select data-role="${u.id}" aria-label="دور ${esc(u.name)}">${['owner', 'editor', 'reviewer', 'student'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select>`}</td></tr>`).join('')}</tbody></table></div></div>`;
    body.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => { try { await api('PUT', `/api/admin/users/${s.dataset.role}/role`, { role: s.value }); toast('تم تحديث الدور'); } catch (e) { toast(e.message, true); } }));
  }
  if (tab === 'audit') {
    body.innerHTML = `<div class="card"><h2>آخر الإجراءات</h2>${d.audit.length ? `<ul class="small">${d.audit.map((a) => `<li><span class="num">${esc(a.at.slice(0, 16).replace('T', ' '))}</span> — ${esc(a.action)} — ${esc(a.target)}</li>`).join('')}</ul>` : '<p class="muted">لا إجراءات بعد.</p>'}</div>`;
  }
}
function lessonEditor(l, d) {
  const box = $('#editor');
  box.innerHTML = `<form class="card" id="lessonForm" style="margin-top:16px" novalidate><h2>${l.id ? 'تعديل درس' : 'درس جديد'}</h2>
    <div class="form-grid"><div class="field"><label for="eT">العنوان</label><input id="eT" type="text" value="${esc(l.title)}"></div>
      <div class="field"><label for="eTr">المسار</label><select id="eTr">${[['foundation', 'تأسيس مشترك'], ...Object.entries(TRACK_NAMES)].map(([k, v]) => `<option value="${k}" ${k === l.track ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="eO">الترتيب</label><input id="eO" type="number" min="1" max="99" value="${l.order}"></div>
      <div class="field"><label for="eK">النوع</label><input id="eK" type="text" value="${esc(l.kind)}"></div>
      <div class="field"><label for="eM">دقائق القراءة</label><input id="eM" type="number" min="1" value="${l.minutes || ''}"></div>
      <div class="field"><label><input id="eR" type="checkbox" ${l.required ? 'checked' : ''}> مطلوب لفتح المحاكي</label></div></div>
    <div class="field"><label for="eS">الملخص</label><input id="eS" type="text" value="${esc(l.summary)}"></div>
    <div class="field"><label for="eB">المحتوى</label><textarea id="eB" style="min-height:260px">${esc(l.body)}</textarea><span class="hint">## عنوان · - نقطة · 1. خطوة · > ملاحظة · !! سطر مثال · **عريض**</span></div>
    <div class="field"><label for="eQ">الأسئلة (JSON)</label><textarea id="eQ" class="code">${esc(JSON.stringify(l.quiz, null, 2))}</textarea><span class="hint">[{"q":"...","options":["أ","ب"],"answer":0,"explain":"..."}] — رقم الإجابة يبدأ من 0. النشر يتطلب 3 أسئلة على الأقل.</span></div>
    <div class="field"><label for="eSrc">معرفات المصادر (مفصولة بفاصلة)</label><input id="eSrc" type="text" dir="ltr" value="${esc(l.sources.join(', '))}"><span class="hint">المتاح: ${d.sources.map((s) => esc(s.id)).join('، ')}</span></div>
    <div id="eMsg" role="alert"></div><button class="btn btn-primary" type="submit">حفظ كمسودة</button></form>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#lessonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let quiz;
    try { quiz = JSON.parse($('#eQ').value || '[]'); } catch { $('#eMsg').innerHTML = '<div class="notice err">صيغة الأسئلة غير صحيحة (JSON).</div>'; return; }
    const payload = { title: $('#eT').value, track: $('#eTr').value, order: $('#eO').value, kind: $('#eK').value, minutes: $('#eM').value, required: $('#eR').checked, summary: $('#eS').value, body: $('#eB').value, quiz, sources: $('#eSrc').value.split(',').map((s) => s.trim()).filter(Boolean) };
    try { await api(l.id ? 'PUT' : 'POST', l.id ? `/api/admin/lessons/${l.id}` : '/api/admin/lessons', payload); toast('حُفظ'); pageAdmin(); }
    catch (err) { $('#eMsg').innerHTML = `<div class="notice err" style="margin-bottom:10px">${esc(err.message)}</div>`; }
  });
}
async function pageIntegrations() {
  if (!S.user || !['owner', 'editor', 'reviewer'].includes(S.user.role)) { main().innerHTML = '<div class="notice err">هذه الصفحة للطاقم فقط.</div>'; return; }
  const d = await api('GET', '/api/admin/overview');
  main().innerHTML = `<h1>مركز التكاملات</h1><p class="muted">وجود SDK أو إضافة لا يعني اتصالًا ناجحًا. الحالة تُحدّث فقط بعد اختبار فعلي.</p>
    <div class="card"><div class="table-scroll"><table><thead><tr><th>الخدمة</th><th>الوظيفة</th><th>الصلاحيات</th><th>التكلفة</th><th>آخر اختبار</th><th>الحالة</th></tr></thead><tbody>
    ${d.integrations.map((i) => `<tr><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.note)}</div></td><td class="small">${esc(i.purpose)}</td><td class="small">${esc(i.perms)}</td><td class="small">${esc(i.cost)}</td><td class="small num">${i.lastTest ? esc(i.lastTest.slice(0, 10)) : '—'}</td>
      <td>${d.role === 'owner' ? `<select data-int="${i.id}" aria-label="حالة ${esc(i.name)}">${Object.entries(INTEG).map(([k, [v]]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<span class="chip ${INTEG[i.status][1]}">${INTEG[i.status][0]}</span>`}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  main().querySelectorAll('[data-int]').forEach((s) => s.addEventListener('change', async () => {
    try { await api('PUT', `/api/admin/integrations/${s.dataset.int}`, { status: s.value, tested: s.value === 'connected_tested' || s.value === 'failed' }); toast('حُدّثت الحالة'); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- الإقلاع ----------
(async function boot() {
  try {
    S.brand = await (await fetch('config/brand.json')).json();
    document.title = S.brand.nameAr;
    S.user = (await api('GET', '/api/me')).user;
  } catch (e) {
    main().innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return;
  }
  renderShell();
  router();
})();
