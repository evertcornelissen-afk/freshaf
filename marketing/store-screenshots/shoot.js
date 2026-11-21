// Store screenshots of the REAL app, taken from a throwaway local FreshAF with example data.
//
//   node marketing/store-screenshots/shoot.js
//
// Starts its own server on a temporary database (never the real one), seeds fictional
// customers and pros in Johannesburg, drives headless Chrome over the DevTools protocol
// (no npm packages), and writes phone-sized PNGs for Google Play and the App Store:
//   android-1080x1920/, iphone-6.7-1290x2796/, iphone-6.9-1320x2868/
// Some screens are taken in night mode (the app's default), some in day mode.
// Needs Chrome and an internet connection (map tiles, fonts).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5781, CDP = 9381, BASE = `http://127.0.0.1:${PORT}`;
const SIZES = [
  { dir: 'android-1080x1920', w: 360, h: 640 },
  { dir: 'iphone-6.7-1290x2796', w: 430, h: 932 },
  { dir: 'iphone-6.9-1320x2868', w: 440, h: 956 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- throwaway database, seeded before the server boots ----------
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-shots-'));
process.env.FRESHAF_DATA_DIR = DATA_DIR;
process.chdir(ROOT);
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });
const { db, setSetting } = require(path.join(ROOT, 'server', 'db'));
const auth = require(path.join(ROOT, 'server', 'auth'));
setSetting('detailing_booking', '0');

// Rosebank, Johannesburg: a national example, not the old Durbanville one.
const HOME = { lat: -26.1458, lng: 28.0416, address: '12 Tyrwhitt Ave, Rosebank, Johannesburg' };
let n = 0;
function user(role, name) {
  const id = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, terms_accepted_at, home_lat, home_lng, home_address)
    VALUES (?, ?, ?, '+27825550123', 'x', datetime('now'), ?, ?, ?)`)
    .run(role, name, `shot${++n}@example.invalid`, role === 'customer' ? HOME.lat : null, role === 'customer' ? HOME.lng : null,
      role === 'customer' ? HOME.address : null).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function pro(name, business, dLat, dLng, rating, count, services = 'carwash,laundry') {
  const u = user('supplier', name);
  db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, online, lat, lng, services, radius_km, rating_sum, rating_count, service_area)
    VALUES (?, ?, '0000000000000', 'approved', 1, ?, ?, ?, 25, ?, ?, 'Johannesburg North')`)
    .run(u.id, business, HOME.lat + dLat, HOME.lng + dLng, services, Math.round(rating * count), count);
  for (const [svc, pkg, c] of [['carwash', 'express', 18000], ['carwash', 'wash_vac', 28000], ['carwash', 'full_valet', 65000], ['laundry', 'wash_fold', 22000]]) {
    db.prepare('INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)').run(u.id, svc, pkg, c);
  }
  return u;
}
const thandi = user('customer', 'Thandi Mokoena');
const lerato = user('customer', 'Lerato Dlamini');
const sipho = pro('Sipho Ndlovu', "Sipho's Mobile Valet", 0.006, 0.004, 4.9, 50);
const jozi = pro('Kagiso Molefe', 'Jozi Shine Car Care', -0.011, 0.007, 4.8, 31);
const bubbles = pro('Ayesha Patel', 'Bubbles on Wheels', 0.015, -0.012, 4.7, 24);
const TOKENS = new Map([thandi, lerato, sipho, jozi, bubbles].map((u) => [u.id, auth.signUser(u)]));

// A booked time: Saturday-ish, five days out at 09:00 South African time (inside business hours).
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

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), FRESHAF_DATA_DIR: DATA_DIR, SMTP_PASS: '', WHATSAPP_TOKEN: '',
      NODE_ENV: 'development', ADMIN_API_KEY: '', PAYMENTS_LIVE: '', GOOGLE_MAPS_BROWSER_KEY: '' },
    stdio: 'ignore',
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-shots-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--window-size=500,1000', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/pricing`); break; } catch { await sleep(250); } }

    // ---------- the data the screens show ----------
    // 1. Lerato asked for a booked laundry collection (still waiting) and a booked wash that
    //    Jozi Shine has accepted. The wash is newest, so it is on top of her booking requests.
    await api(lerato, '/api/quote-requests', 'POST', { service: 'laundry', package: 'wash_iron', vehicle: 'medium',
      address: '7 Jan Smuts Ave, Parktown North, Johannesburg', lat: HOME.lat + 0.01, lng: HOME.lng - 0.006, scheduled_for: dayOut(6, '08:00') });
    const booked = await api(lerato, '/api/quote-requests', 'POST', { service: 'carwash', package: 'full_valet', vehicle: 'suv',
      address: '7 Jan Smuts Ave, Parktown North, Johannesburg', lat: HOME.lat + 0.01, lng: HOME.lng - 0.006, scheduled_for: dayOut(5, '09:00') });
    await api(jozi, `/api/supplier/quote-requests/${booked.request_id}/quote`, 'POST', { price_cents: 65000, availability: 'I bring my own water and power' });
    // 2. A booked request waiting in Sipho's Pro app (Lerato's Saturday wash, plus one now from Thandi below).

    // ---------- Chrome ----------
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(250); }
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); const w = waiting.get(d.id); if (w) { waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); } };
    const send = (method, params = {}) => new Promise((res, rej) => { waiting.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const js = async (expression) => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Page.enable'); await send('Network.enable');

    const signIn = async (u) => {
      await send('Network.clearBrowserCookies');
      if (u) await send('Network.setCookie', { name: 'freshaf_token', value: TOKENS.get(u.id), url: BASE });
    };
    const open = async (p, theme) => {
      await send('Page.navigate', { url: BASE + '/contact' });
      await sleep(400);
      await js(`localStorage.setItem('freshaf_theme', '${theme}'); localStorage.setItem('freshaf_cookie_ok', '1');`);
      await send('Page.navigate', { url: BASE + p });
      await sleep(2600);
      await js("document.querySelectorAll('.reveal,.steps').forEach((n) => n.classList.add('is-in'));");
    };
    const settle = async (ms = 900) => { await js("document.querySelectorAll('.reveal,.steps').forEach((n) => n.classList.add('is-in'));"); await sleep(ms); };
    // Scroll so an element sits just under the sticky header.
    const scrollTo = (sel, offset = 72) => js(`const n = document.querySelector(${JSON.stringify(sel)}); if (!n) throw new Error('missing ${sel}');
      window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - ${offset});`);

    const shots = [];
    const shoot = async (size, name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, size.dir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
    };

    for (const size of SIZES) {
      fs.mkdirSync(path.join(OUT, size.dir), { recursive: true });
      for (const f of fs.readdirSync(path.join(OUT, size.dir))) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, size.dir, f));
      await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 3, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });

      // 1. Home, night mode: pick a service.
      await signIn(null);
      await open('/', 'dark');
      await js('window.scrollTo(0, 0)');
      await settle();
      await shoot(size, '1-home');

      // 2. Booking form, day mode: package and size picked, a booked time.
      await signIn(thandi);
      await open('/?service=carwash', 'light');
      await js(`setService('carwash'); show('view-order'); await new Promise((r) => setTimeout(r, 500));
        sel.package = 'wash_vac'; sel.unit = 'suv'; refreshSel();
        el('order-address').value = ${JSON.stringify(HOME.address)}; setPin(${HOME.lat}, ${HOME.lng});`);
      await settle();
      await scrollTo('#h-book', 84);
      await settle();
      await shoot(size, '2-book');

      // 3. Pros who accepted, night mode: Thandi asks now; three pros accept with their price.
      await open('/', 'dark');
      await js(`setService('carwash'); show('view-order'); await new Promise((r) => setTimeout(r, 500));
        sel.package = 'wash_vac'; sel.unit = 'suv'; refreshSel();
        el('order-address').value = ${JSON.stringify(HOME.address)}; setPin(${HOME.lat}, ${HOME.lng});
        el('btn-get-quotes').click(); await new Promise((r) => setTimeout(r, 1500));`);
      const reqId = db.prepare("SELECT id FROM quote_requests WHERE customer_id = ? AND status = 'open' AND scheduled_for IS NULL ORDER BY id DESC").get(thandi.id).id;
      await api(sipho, `/api/supplier/quote-requests/${reqId}/quote`, 'POST', { price_cents: 32000, availability: 'In about 30 minutes' });
      await api(jozi, `/api/supplier/quote-requests/${reqId}/quote`, 'POST', { price_cents: 30000, availability: 'Within the hour' });
      await api(bubbles, `/api/supplier/quote-requests/${reqId}/quote`, 'POST', { price_cents: 34000, availability: 'Today at 14:00' });
      await sleep(1500);
      // Normally arrives live; make sure all three are on screen before the photo.
      await js(`if ((quotesList || []).length < 3) { const r = await api('/api/quote-requests/${reqId}'); quotesList = r.quotes; renderQuotes(); }`);
      await settle();
      await scrollTo('#quotes-intro', 102);
      await settle();
      await shoot(size, '3-pros-accepted');

      // 4. Live tracking, day mode: book Sipho, he is on the way.
      const order = await api(thandi, `/api/quotes/${db.prepare('SELECT id FROM quotes WHERE request_id = ? AND supplier_id = ?').get(reqId, sipho.id).id}/accept`, 'POST', { payment_method: 'cash' });
      await api(sipho, `/api/supplier/jobs/${order.order.id}/advance`, 'POST');
      await open('/', 'light');
      await js(`await openTrack(${order.order.id});`);
      await settle(2500);
      await shoot(size, '4-live-tracking');

      // 5. Booking requests, night mode: Lerato's booked wash, accepted by Jozi Shine.
      await signIn(lerato);
      await open('/?requests=1', 'dark');
      await settle(1200);
      await scrollTo('#requests-card', 76);
      await settle();
      await shoot(size, '5-booking-requests');

      // 6. Pro app, night mode: a booked job to accept or decline.
      await signIn(sipho);
      await open('/supplier', 'dark');
      await settle(1500);
      await scrollTo('#h-requests', 84);
      await settle();
      await shoot(size, '6-pro-accept');

      // Reset what this size changed, so the next size starts from the same data.
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE customer_id = ?").run(thandi.id);
      db.prepare("UPDATE quote_requests SET status = 'cancelled' WHERE customer_id = ? AND status = 'open'").run(thandi.id);
      db.prepare("UPDATE suppliers SET online = 1").run();
    }
    console.log(shots.map((f) => path.relative(ROOT, f)).join('\n'));
    ws.close();
  } finally {
    server.kill(); chrome.kill();
    await sleep(500);
    try { db.close(); } catch {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
