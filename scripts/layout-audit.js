// Layout audit: every screen of the customer app and the Pro app, on real phone sizes,
// in day and night mode, measured for the things that make an app feel broken on a phone.
//
//   node scripts/layout-audit.js            (all sizes)
//   node scripts/layout-audit.js --quick    (360 and 390 only)
//
// Runs its own server on a throwaway database (never the real one), seeds fictional
// accounts with deliberately LONG names and addresses, drives headless Chrome over the
// DevTools protocol in mobile + touch mode, and for every screen checks:
//   - anything wider than the screen (the cause of the page sliding sideways on a swipe)
//   - a real sideways swipe: the page must not move
//   - text cut off inside its box, words that overflow, buttons overlapping each other
//   - tap targets smaller than 40 px, text smaller than 12 px, inputs under 16 px (iOS zoom)
//   - images that failed to load, low-contrast buttons, JavaScript errors
// Writes a full-page PNG per screen and REPORT.md to Desktop/FreshAF/layout-audit/.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(os.homedir(), 'Desktop', 'FreshAF', 'layout-audit');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5771, CDP = 9371, BASE = `http://127.0.0.1:${PORT}`;
const QUICK = process.argv.includes('--quick');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const SIZES = [
  { name: '320 small Android', w: 320, h: 640 },
  { name: '360 Android', w: 360, h: 760 },
  { name: '375 iPhone SE', w: 375, h: 667 },
  { name: '390 iPhone 14', w: 390, h: 844 },
  { name: '412 Pixel', w: 412, h: 915 },
  { name: '430 iPhone Pro Max', w: 430, h: 932 },
].filter((s) => !QUICK || s.w === 360 || s.w === 390);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- throwaway database ----------
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-audit-'));
process.env.FRESHAF_DATA_DIR = DATA_DIR;
process.chdir(ROOT);
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });
const { db, setSetting } = require(path.join(ROOT, 'server', 'db'));
const auth = require(path.join(ROOT, 'server', 'auth'));
setSetting('detailing_booking', '0');
setSetting('detailing_signup', '1'); // pros may apply: puts the Detailing tick on the form
setSetting('app_min_build', '10'); setSetting('app_latest_build', '20'); // only fake 'native' scenes read these

const HOME = { lat: -26.1458, lng: 28.0416, address: '1234 Jan Smuts Avenue, Craighall Park Extension 2, Randburg, Johannesburg North, Gauteng, 2196' };
let n = 0;
function user(role, name) {
  const id = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, terms_accepted_at, home_lat, home_lng, home_address, points_cents)
    VALUES (?, ?, ?, '+27825550123', 'x', datetime('now'), ?, ?, ?, 12345)`)
    .run(role, name, `audit${++n}.a.very.long.email.address@example-company-name.invalid`, role === 'customer' ? HOME.lat : null,
      role === 'customer' ? HOME.lng : null, role === 'customer' ? HOME.address : null).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function pro(name, business, dLat, dLng, status = 'approved', services = 'carwash,laundry') {
  const u = user('supplier', name);
  db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, online, lat, lng, services, radius_km, rating_sum, rating_count, service_area, vehicle_reg)
    VALUES (?, ?, '0000000000000', ?, 1, ?, ?, ?, 25, 147, 31, 'Gauteng: Johannesburg North, Sandton, Randburg, Midrand, Centurion, Pretoria East', 'GP 123-456')`)
    .run(u.id, business, status, HOME.lat + dLat, HOME.lng + dLng, services);
  for (const [svc, pkg, c] of [['carwash', 'express', 18000], ['carwash', 'wash_vac', 28000], ['carwash', 'full_valet', 65000],
    ['laundry', 'wash_fold', 22000], ['laundry', 'wash_iron', 30000]]) {
    db.prepare('INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)').run(u.id, svc, pkg, c);
  }
  return u;
}
const cust = user('customer', 'Nomvula Thandiwe Mokoena-Van der Merwe');
const cust2 = user('customer', 'Lerato Dlamini');
const cust3 = user('customer', 'Pieter Botha');
const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const p1 = pro('Sipho Bongani Ndlovu' + XSS, "Sipho's Professional Mobile Valet & Detailing Services (Pty) Ltd", 0.006, 0.004);
const p2 = pro('Kagiso Molefe', 'Jozi Shine', -0.011, 0.007);
db.prepare(`INSERT INTO supplier_docs (user_id, kind, original_name, stored_name, uploaded_at)
  VALUES (?, 'police_clearance', 'clearance.pdf', 'audit-clearance.pdf', datetime('now'))`).run(p2.id);
const p3 = pro('Ayesha Patel', 'Bubbles on Wheels Mobile Car Wash', 0.015, -0.012);
const pending = pro('Thabo Nkosi', 'Thabo Shine Pending Applicant Mobile Wash', 0.02, 0.02, 'pending');
// In review for the pro account AND for detailing: the longest version of the status page,
// where the price card carries the detailing block as well.
const pendingDet = pro('Mandla Sibusiso Khumalo-Ferreira', 'Khumalo Premium Mobile Detailing & Valet Specialists', 0.03, 0.03, 'pending');
db.prepare("UPDATE suppliers SET detailing_status = 'pending', detailing_applied_at = datetime('now') WHERE user_id = ?").run(pendingDet.id);
db.prepare(`INSERT INTO supplier_docs (user_id, kind, original_name, stored_name, uploaded_at)
  VALUES (?, 'police_clearance', 'a-very-long-clearance-file-name-from-their-phone.pdf', 'audit-clearance-2.pdf', datetime('now'))`).run(pendingDet.id);
const detPro = pro('Rethabile Mokoena', 'Mokoena Detailing', -0.004, 0.005, 'approved', 'carwash,detailing');
db.prepare("UPDATE suppliers SET detailing_status = 'approved' WHERE user_id = ?").run(detPro.id);
const TOKENS = new Map([cust, cust2, cust3, p1, p2, p3, pending, pendingDet, detPro].map((u) => [u.id, auth.signUser(u)]));
const dayOut = (d, hhmm) => `${new Date(Date.now() + d * 86400e3).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 10)}T${hhmm}`;

async function api(u, p, method = 'GET', body) {
  const r = await fetch(BASE + p, {
    method, headers: { Authorization: `Bearer ${TOKENS.get(u.id)}`, 'X-FreshAF-Client': 'native', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${j.error || ''}`);
  return j;
}

// ---------- the in-page measurement ----------
const MEASURE = String.raw`
const vw = document.documentElement.clientWidth;
const out = { vw, docScroll: document.documentElement.scrollWidth, wide: [], clipped: [], overlap: [], small: [], tiny: [], inputs: [], imgs: [], contrast: [] };
const visible = (n) => { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const label = (n) => { let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; const c = [...n.classList].slice(0, 2).join('.'); if (c) s += '.' + c; const t = (n.innerText || n.value || n.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40); return t ? s + ' "' + t + '"' : s; };
// Is n inside something that legitimately scrolls or clips sideways (a table scroller, a map)?
const contained = (n) => { for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { const r = a.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) return true; } } return false; };
const all = [...document.querySelectorAll('body *')].filter((x) => !x.closest('.leaflet-container, .gm-style, svg, #splash, #toast-root, .hidden, [hidden]') && visible(x));
for (const x of all) {
  const r = x.getBoundingClientRect();
  if ((r.right > vw + 1 || r.left < -1) && !contained(x) && getComputedStyle(x).position !== 'fixed') out.wide.push(label(x) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
  const cs = getComputedStyle(x);
  const hasText = [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
  if (hasText && x.scrollWidth > x.clientWidth + 2 && x.clientWidth > 0 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis') out.clipped.push(label(x));
  if (hasText && x.scrollWidth > x.clientWidth + 2 && x.clientWidth > 0 && cs.overflowX === 'visible' && cs.whiteSpace !== 'nowrap' && x.tagName !== 'BUTTON') out.clipped.push('overflows: ' + label(x));
  if (hasText && parseFloat(cs.fontSize) < 12) out.tiny.push(label(x) + ' ' + cs.fontSize);
}
const taps = all.filter((x) => x.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button], .pro-opt, .drawer-item, summary') && !x.closest('.leaflet-control-attribution'));
for (const x of taps) {
  const r = x.getBoundingClientRect();
  const inline = x.tagName === 'A' && getComputedStyle(x).display === 'inline' && x.closest('p, li, small, label, .muted, .fine');
  const box = x.matches('input[type=checkbox], input[type=radio]') ? x.closest('label') || x : x;
  const br = box.getBoundingClientRect();
  if (!inline && (br.height < 40 || br.width < 40)) out.small.push(label(x) + ' ' + Math.round(br.width) + 'x' + Math.round(br.height));
  if (x.matches('input, select, textarea') && parseFloat(getComputedStyle(x).fontSize) < 16) out.inputs.push(label(x) + ' ' + getComputedStyle(x).fontSize);
}
const btns = taps.filter((x) => x.matches('button, a.btn, .btn, [role=button]') && getComputedStyle(x).position !== 'fixed');
for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
  const a = btns[i], b = btns[j]; if (a.contains(b) || b.contains(a)) continue;
  const layer = (x) => x.closest('#app-drawer, .app-drawer, .modal-backdrop, .app-update'); if (layer(a) !== layer(b)) continue; // one sits on an overlay above the other
  const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
  const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
  if (ix > 4 && iy > 4) out.overlap.push(label(a) + ' x ' + label(b));
}
for (const im of document.querySelectorAll('img')) if (visible(im) && im.complete && im.naturalWidth === 0) out.imgs.push(im.getAttribute('src'));
const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const bgOf = (n) => { for (let a = n; a; a = a.parentElement) { const c = rgb(getComputedStyle(a).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > .5)) return c; } return [255, 255, 255]; };
for (const x of btns) {
  if (getComputedStyle(x).backgroundImage !== 'none') continue;
  const fg = rgb(getComputedStyle(x).color), bg = bgOf(x);
  const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
  if (ratio < 3 && (x.innerText || '').trim()) out.contrast.push(label(x) + ' ' + ratio.toFixed(2));
}
out.xss = window.__xss || 0;
for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [...new Set(out[k])].slice(0, 25);
return out;`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), FRESHAF_DATA_DIR: DATA_DIR, SMTP_PASS: '', WHATSAPP_TOKEN: '', FCM_SERVICE_ACCOUNT: '', APNS_KEY: '',
      NODE_ENV: 'development', ADMIN_API_KEY: '', PAYMENTS_LIVE: '', GOOGLE_MAPS_BROWSER_KEY: '' },
    stdio: 'ignore',
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-audit-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--window-size=500,1000', 'about:blank'], { stdio: 'ignore' });
  const results = [];
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/pricing`); break; } catch { await sleep(250); } }

    // Data the screens show: a booked request accepted by a pro, a booked laundry waiting,
    // an order on the way, a completed order waiting for a rating.
    await api(cust, '/api/quote-requests', 'POST', { service: 'laundry', package: 'wash_iron', vehicle: 'medium',
      address: HOME.address, lat: HOME.lat + 0.01, lng: HOME.lng - 0.006, scheduled_for: dayOut(6, '08:00') });
    const booked = await api(cust, '/api/quote-requests', 'POST', { service: 'carwash', package: 'full_valet', vehicle: 'suv',
      address: HOME.address, lat: HOME.lat + 0.01, lng: HOME.lng - 0.006, scheduled_for: dayOut(5, '09:00') });
    await api(p1, `/api/supplier/quote-requests/${booked.request_id}/quote`, 'POST', { price_cents: 65000, availability: 'I bring my own water, power and eco-friendly products, no need for a tap' });
    const now = await api(cust2, '/api/quote-requests', 'POST', { service: 'carwash', package: 'wash_vac', vehicle: 'suv', address: HOME.address, lat: HOME.lat, lng: HOME.lng, notes: 'Gate code 1234 ' + XSS });
    await api(p1, `/api/supplier/quote-requests/${now.request_id}/quote`, 'POST', { price_cents: 28000, availability: 'In about 30 minutes' });
    const q = db.prepare('SELECT id FROM quotes WHERE request_id = ? AND supplier_id = ?').get(now.request_id, p1.id);
    const order = (await api(cust2, `/api/quotes/${q.id}/accept`, 'POST', { payment_method: 'cash' })).order;
    await api(p1, `/api/supplier/jobs/${order.id}/advance`, 'POST');
    // A finished one for the history and the rating box.
    const done = await api(cust3, '/api/quote-requests', 'POST', { service: 'carwash', package: 'express', vehicle: 'sedan', address: HOME.address, lat: HOME.lat, lng: HOME.lng });
    await api(p2, `/api/supplier/quote-requests/${done.request_id}/quote`, 'POST', { price_cents: 18000 });
    const q2 = db.prepare('SELECT id FROM quotes WHERE request_id = ? AND supplier_id = ?').get(done.request_id, p2.id);
    const order2 = (await api(cust3, `/api/quotes/${q2.id}/accept`, 'POST', { payment_method: 'cash' })).order;
    for (let i = 0; i < 4; i++) { try { await api(p2, `/api/supplier/jobs/${order2.id}/advance`, 'POST'); } catch { break; } }

    // ---------- Chrome ----------
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(250); }
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const waiting = new Map(); let jsErrors = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.method === 'Runtime.exceptionThrown') jsErrors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text);
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') jsErrors.push('console: ' + d.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
      const w = waiting.get(d.id); if (w) { waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => { waiting.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const js = async (expression) => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');

    const signIn = async (u) => {
      await send('Network.clearBrowserCookies');
      if (u) await send('Network.setCookie', { name: 'freshaf_token', value: TOKENS.get(u.id), url: BASE });
    };
    const reveal = "document.querySelectorAll('.reveal,.steps').forEach((n) => n.classList.add('is-in')); document.documentElement.style.scrollBehavior = 'auto';";
    const open = async (p, theme, native) => {
      await send('Page.navigate', { url: BASE + '/contact' });
      await sleep(300);
      await js(`localStorage.setItem('freshaf_theme', '${theme}'); localStorage.setItem('freshaf_cookie_ok', '1'); localStorage.setItem('freshaf_setup_prompted', '1');`);
      await send('Page.navigate', { url: BASE + p });
      await sleep(2200);
      await js(reveal + (native ? "document.documentElement.classList.add('native-app');" : ''));
      await sleep(300);
    };
    // A real finger swipe sideways, then: did the page move?
    const swipe = async (size) => {
      const y = Math.round(size.h * 0.55);
      const pts = (x) => [{ x, y, radiusX: 5, radiusY: 5, force: 1, id: 1 }];
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(size.w - 40) });
      for (let x = size.w - 60; x > 20; x -= 30) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(x) }); await sleep(16); }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(350);
      return js("return { sx: window.scrollX, vx: (window.visualViewport && window.visualViewport.offsetLeft) || 0, body: document.scrollingElement.scrollLeft };");
    };
    const shoot = async (file) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    };

    // ---------- the screens ----------
    const customerOrder = (service, extra = '') => `setService('${service}'); show('view-order'); await new Promise((r) => setTimeout(r, 600));
      const pk = document.querySelector('#pkg-grid .pkg'); if (pk) pk.click();
      const un = document.querySelector('#veh-grid .pkg:nth-child(2)'); if (un) un.click();
      el('order-address').value = ${JSON.stringify(HOME.address)}; setPin(${HOME.lat}, ${HOME.lng}); ${extra}`;
    const SCENES = [
      { key: 'c-home', who: null, path: '/' },
      { key: 'c-menu', who: null, path: '/', run: "document.querySelector('.menu-btn').click(); await new Promise((r) => setTimeout(r, 500));" },
      { key: 'c-login', who: null, path: '/', run: "show('view-login');" },
      { key: 'c-register', who: null, path: '/', run: "show('view-register'); showError('reg-error', 'That email is already registered. Sign in instead, or use Forgot password if you do not remember it.');" },
      { key: 'c-services', who: cust, path: '/' },
      { key: 'c-requests', who: cust, path: '/?requests=1' },
      { key: 'c-order-carwash-later', who: cust, path: '/', run: customerOrder('carwash', "el('seg-later').click();") },
      { key: 'c-order-laundry-return', who: cust, path: '/', run: customerOrder('laundry', "el('return-toggle').checked = true; el('return-toggle').dispatchEvent(new Event('change')); el('seg-later').click();") },
      { key: 'c-quotes', who: cust, path: '/', run: customerOrder('carwash', `quoteRequestId = ${booked.request_id}; const r = await api('/api/quote-requests/${booked.request_id}'); quotesList = r.quotes; renderQuotes(); refreshQuotesIntro && refreshQuotesIntro();`) },
      { key: 'c-track-on-way', who: cust2, path: '/', run: `await openTrack(${order.id});`, wait: 1500 },
      { key: 'c-track-done-rate', who: cust3, path: '/', run: `await openTrack(${order2.id});`, wait: 1200 },
      { key: 'c-account', who: cust, path: '/', run: "openAccount(); await new Promise((r) => setTimeout(r, 400));" },
      { key: 'c-settings', who: cust, path: '/', run: "openAppSettings(); await new Promise((r) => setTimeout(r, 600));" },
      { key: 'c-confirm-modal', who: cust, path: '/', run: "modal({ title: 'Cancel this booking?', body: 'Your pro has not set off yet, so there is no charge. Are you sure you want to cancel the full valet booked for Saturday morning?', confirmText: 'Yes, cancel booking', cancelText: 'Keep it', danger: true }); await new Promise((r) => setTimeout(r, 400));" },
      { key: 'c-update-wall', who: cust, path: '/', run: "window.FRESHAF_NATIVE = true; window.Capacitor = Object.assign(window.Capacitor || {}, { getPlatform: () => 'android', Plugins: { App: { getInfo: async () => ({ build: '5' }) } } }); localStorage.removeItem('freshaf_update_asked'); await checkAppVersion(); await new Promise((r) => setTimeout(r, 300));" },
      { key: 'c-update-bar', who: cust, path: '/', run: "window.FRESHAF_NATIVE = true; window.Capacitor = Object.assign(window.Capacitor || {}, { getPlatform: () => 'android', Plugins: { App: { getInfo: async () => ({ build: '15' }) } } }); localStorage.removeItem('freshaf_update_asked'); await checkAppVersion(); await new Promise((r) => setTimeout(r, 300));" },
      { key: 'p-auth', who: null, path: '/supplier' },
      { key: 'p-apply-open', who: null, path: '/supplier#apply', run: "el('area-pick').open = true; el('btn-add-vehicle').click(); el('btn-add-vehicle').click(); await new Promise((r) => setTimeout(r, 300));" },
      { key: 'p-apply-detailing', who: null, path: '/supplier#apply', wait: 900, run: "await showDetailingTick(); el('svc-detailing').checked = true; el('svc-detailing').dispatchEvent(new Event('change')); el('svc-laundry').checked = true; el('svc-laundry').dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300));" },
      { key: 'p-menu', who: p1, path: '/supplier', run: "document.querySelector('.menu-btn').click(); await new Promise((r) => setTimeout(r, 500));" },
      { key: 'p-pending', who: pending, path: '/supplier', wait: 800 },
      { key: 'p-pending-detailing', who: pendingDet, path: '/supplier', wait: 1200 },
      { key: 'p-dash-detailing', who: detPro, path: '/supplier', wait: 1500 },
      { key: 'p-dash', who: p1, path: '/supplier', wait: 1500 },
      { key: 'p-dash-p2', who: p2, path: '/supplier', wait: 1500 },
      { key: 'p-settings', who: p1, path: '/supplier', run: "openAppSettings(); await new Promise((r) => setTimeout(r, 600));" },
      { key: 'w-contact', who: null, path: '/contact' },
      { key: 'w-terms', who: null, path: '/terms' },
      { key: 'w-privacy', who: null, path: '/privacy' },
      { key: 'w-delete', who: null, path: '/delete-account' },
      { key: 'w-reset', who: null, path: '/reset-password?token=abc' },
    ].filter((s) => !ONLY || s.key.startsWith(ONLY));

    for (const size of SIZES) {
      await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      for (const theme of ['dark', 'light']) {
        for (const sc of SCENES) {
          const file = `${sc.key}__${size.w}__${theme}.png`;
          jsErrors = [];
          const row = { scene: sc.key, size: size.w, theme, file };
          try {
            await signIn(sc.who);
            await open(sc.path, theme, theme === 'light');
            if (sc.run) await js(sc.run);
            await sleep(sc.wait || 500);
            await js(reveal + 'window.scrollTo(0, 0);');
            row.m = await js(MEASURE);
            row.swipe = await swipe(size);
            await js('window.scrollTo(0, 0);');
            await shoot(file);
          } catch (e) { row.fail = String(e.message || e).split('\n')[0]; }
          row.js = [...new Set(jsErrors)];
          results.push(row);
          process.stdout.write(row.fail ? 'x' : '.');
        }
      }
    }
    ws.close();
  } finally {
    server.kill(); chrome.kill();
    await sleep(500);
    try { db.close(); } catch {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  }

  // ---------- report ----------
  const lines = ['# FreshAF layout audit', '', `${new Date().toISOString()} · ${results.length} screens · sizes ${SIZES.map((s) => s.w).join(', ')}`, ''];
  const tally = {};
  for (const r of results) {
    const probs = [];
    if (r.fail) probs.push(`FAILED TO RUN: ${r.fail}`);
    const m = r.m || {};
    if (m.xss) { probs.push(`SECURITY: text typed by a user ran as code (${m.xss}x)`); tally['SECURITY: user text ran as code'] = (tally['SECURITY: user text ran as code'] || 0) + 1; }
    if (m.docScroll > m.vw) probs.push(`page is ${m.docScroll}px wide on a ${m.vw}px screen`);
    if (r.swipe && (r.swipe.sx || r.swipe.vx || r.swipe.body)) probs.push(`SIDEWAYS SWIPE MOVED THE PAGE ${JSON.stringify(r.swipe)}`);
    for (const [k, t] of [['wide', 'wider than screen'], ['clipped', 'text cut off'], ['overlap', 'buttons overlap'], ['small', 'tap target < 40px'],
      ['tiny', 'text < 12px'], ['inputs', 'input < 16px (iOS zooms)'], ['imgs', 'broken image'], ['contrast', 'low-contrast button']]) {
      for (const v of m[k] || []) { probs.push(`${t}: ${v}`); tally[t] = (tally[t] || 0) + 1; }
    }
    for (const e of r.js || []) { probs.push(`JS error: ${e}`); tally['JS error'] = (tally['JS error'] || 0) + 1; }
    r.probs = probs;
  }
  lines.push('## Totals', '', ...Object.entries(tally).map(([k, v]) => `- ${k}: ${v}`), '');
  const byScene = {};
  for (const r of results) (byScene[r.scene] ||= []).push(r);
  for (const [scene, rows] of Object.entries(byScene)) {
    lines.push(`## ${scene}`, '');
    const seen = new Map();
    for (const r of rows) for (const p of r.probs) { if (!seen.has(p)) seen.set(p, []); seen.get(p).push(`${r.size}${r.theme[0]}`); }
    if (!seen.size) lines.push('- clean');
    for (const [p, where] of seen) lines.push(`- ${p}  _(${where.join(' ')})_`);
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} screens. Report: ${path.join(OUT, 'REPORT.md')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
