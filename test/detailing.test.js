// Detailing (21 Nov 2026), end to end, against a throwaway database.
//
// What has to hold, because each failure lands on a real customer or a real pro:
//  - both switches start OFF: no customer or pro sees detailing until the owner opens it;
//  - a detailing request only ever reaches a pro FreshAF approved for detailing, never an
//    everyday car wash pro (the complaint that started this: "low quality" washers quoting
//    on R900+ jobs);
//  - detailing carries its own 10% margin, and car wash keeps its 20%;
//  - detailing is always booked ahead (12 h+), goes to approved detailers even when they are
//    offline, and each detailer accepts or declines it; nothing is answered for them;
//  - detailing is paid by card only, so it is closed to anyone card is not open to;
//  - approving and taking it away again put the pro's services back exactly as they were.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { stopServer } = require('./stop-server');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });
// Throwaway database, set before db.js loads so both this process and the server use it.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-detailing-'));
process.env.FRESHAF_DATA_DIR = DATA_DIR;
const { db } = require(path.join(ROOT, 'server', 'db'));
const auth = require(path.join(ROOT, 'server', 'auth'));

const PORT = 5763, BASE = `http://127.0.0.1:${PORT}`;
const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
};

const stamp = Date.now();
function mkUser(role, name, services) {
  const id = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash) VALUES (?, ?, ?, '+27820000000', 'x')`)
    .run(role, name, `dt-${role}-${name.replace(/\W/g, '')}-${stamp}@test.invalid`).lastInsertRowid;
  if (role === 'supplier') {
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, online, lat, lng, services, radius_km)
      VALUES (?, ?, '0000000000000', 'approved', 1, -33.83, 18.65, ?, 25)`).run(id, name, services);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
const admin = mkUser('admin', 'DT Admin');
const carPro = mkUser('supplier', 'DT Washer', 'carwash');
const detailer = mkUser('supplier', 'DT Detailer', 'carwash');
const customer = mkUser('customer', 'DT Customer');
// The everyday washer has a published price, so they would answer instantly if asked.
db.prepare("INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, 'carwash', 'express', 18000)").run(carPro.id);
const TOKENS = new Map([admin, carPro, detailer, customer].map((u) => [u.id, auth.signUser(u)]));

// Booked slots, South African wall-clock time. Five days out at 10:00 is always inside
// business hours (07:00-18:00 by default) and past every lead time.
const dayOut = (d, hhmm) => `${new Date(Date.now() + d * 86400e3).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 10)}T${hhmm}`;
const slot = dayOut(5, '10:00');
const quotesMod = require(path.join(ROOT, 'server', 'quotes'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    // Card is live for this server (PayFast with dummy keys builds a URL and moves no money),
    // because detailing is card only and would otherwise stay closed to customers.
    env: { ...process.env, PORT: String(PORT), FRESHAF_DATA_DIR: DATA_DIR, ADMIN_API_KEY: '',
      SMTP_PASS: '', WHATSAPP_TOKEN: '', NODE_ENV: 'development',
      PAYMENTS_LIVE: 'true', PAYMENT_PROVIDER: 'payfast', PAYFAST_MERCHANT_ID: '10000100', PAYFAST_MERCHANT_KEY: 'testkey',
      BASE_URL: `http://127.0.0.1:${PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  const call = async (u, p, method = 'GET', body) => {
    const headers = { Authorization: `Bearer ${TOKENS.get(u.id)}`, 'X-FreshAF-Client': 'native' };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, json: type.includes('json') ? await r.json().catch(() => null) : null };
  };
  const photo = (name = 'work.png') => { const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), name); return f; };
  const ask = (pkg, when = slot, service = 'detailing') => call(customer, '/api/quote-requests', 'POST', {
    service, package: pkg, vehicle: 'sedan', address: 'Test street', lat: -33.84, lng: 18.65, scheduled_for: when,
  });
  const quotesOn = (reqId) => db.prepare("SELECT * FROM quotes WHERE request_id = ? AND status = 'open'").all(reqId);
  const services = (u) => db.prepare('SELECT services FROM suppliers WHERE user_id = ?').get(u.id).services;

  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

    // ---- closed by default ----
    let r = await (await fetch(`${BASE}/api/pricing`)).json();
    check('customers see no detailing while it is off', Object.keys(r.services), ['carwash', 'laundry']);
    r = await ask('interior_detail');
    check('a detailing request is refused while it is off', [r.status, r.json.error], [400, 'Detailing is not open for bookings yet']);
    r = await call(admin, '/api/admin/settings');
    check('admin: margin 10%, both switches off', [r.json.detailing_fee_pct, r.json.detailing_signup, r.json.detailing_booking], [10, false, false]);
    check('admin: car wash margin still 20%', r.json.platform_fee_pct, 20);
    r = await call(detailer, '/api/supplier/detailing');
    check('pro sees applications closed', [r.json.signup_open, r.json.status], [false, null]);
    r = await call(detailer, '/api/supplier/detailing/photos', 'POST', photo());
    check('no photo uploads while applications are closed', r.status, 403);

    // ---- pro applies ----
    r = await call(admin, '/api/admin/settings', 'POST', { detailing_signup: 'yes' });
    check('a switch must be true or false', r.status, 400);
    r = await call(admin, '/api/admin/settings', 'POST', { detailing_signup: true });
    check('owner opens pro applications', r.status, 200);
    r = await call(detailer, '/api/supplier/detailing/apply', 'POST', { link: 'https://example.co.za' });
    check('applying needs 5 photos', [r.status, r.json.error], [400, 'Add at least 5 photos of detailing work you have done (you have 0)']);
    for (let i = 0; i < 5; i++) r = await call(detailer, '/api/supplier/detailing/photos', 'POST', photo(`job${i}.png`));
    check('five photos stored', r.json.photos.length, 5);
    const pdf = new FormData(); pdf.append('photo', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'cv.pdf');
    r = await call(detailer, '/api/supplier/detailing/photos', 'POST', pdf);
    check('a PDF is not a photo', r.status, 400);
    r = await call(detailer, '/api/supplier/detailing/apply', 'POST', { link: 'not a link' });
    check('a link is required', r.status, 400);
    r = await call(detailer, '/api/supplier/detailing/apply', 'POST', { link: 'iskraautolabs.co.za' });
    check('application goes in as pending, link made https', [r.status, r.json.status, r.json.link], [200, 'pending', 'https://iskraautolabs.co.za']);
    r = await call(detailer, '/api/supplier/detailing/photos', 'POST', photo());
    check('photos are locked while it is reviewed', r.status, 409);
    check('applying does not change what the pro is sent', services(detailer), 'carwash');

    // ---- admin decides ----
    r = await call(admin, '/api/admin/suppliers');
    const row = r.json.suppliers.find((x) => x.user_id === detailer.id);
    check('admin sees the application with its photos', [row.detailing.status, row.detailing.photos.length], ['pending', 5]);
    const ph = await fetch(`${BASE}/api/admin/detailing-photos/${row.detailing.photos[0].id}`, { headers: { Authorization: `Bearer ${TOKENS.get(admin.id)}`, 'X-FreshAF-Client': 'native' } });
    check('admin can open a photo', ph.status, 200);
    r = await call(detailer, `/api/admin/detailing-photos/${row.detailing.photos[0].id}`);
    check('a pro cannot use the admin photo route', r.status, 403);
    r = await call(admin, `/api/admin/suppliers/${carPro.id}/detailing`, 'POST', { decision: 'approve' });
    check('cannot approve someone who never applied', r.status, 409);
    r = await call(admin, `/api/admin/suppliers/${detailer.id}/detailing`, 'POST', { decision: 'decline' });
    check('declining needs a reason', r.status, 400);
    r = await call(admin, `/api/admin/suppliers/${detailer.id}/detailing`, 'POST', { decision: 'approve' });
    check('approved: detailing added to their services', [r.status, services(detailer)], [200, 'carwash,detailing']);

    // ---- approved detailer sets prices ----
    r = await call(detailer, '/api/supplier/prices');
    const dpk = r.json.services.detailing?.packages || [];
    check('detailer now has a detailing price list', dpk.map((p) => p.key), ['interior_detail', 'exterior_detail', 'full_detail', 'paint_ceramic']);
    check('paint correction / ceramic is quote-only', dpk.find((p) => p.key === 'paint_ceramic').quote_only, true);
    check('the pro is shown the right margin per service', r.json.fee_pct_by_service, { carwash: 20, detailing: 10 });
    r = await call(detailer, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'interior_detail', price_cents: 90000 }] });
    check('detailer saves R900 for an interior detail', r.status, 200);
    r = await call(detailer, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'paint_ceramic', price_cents: 300000 }] });
    check('a quote-only package cannot get a fixed price', r.status, 400);
    r = await call(carPro, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'interior_detail', price_cents: 50000 }] });
    check('an everyday washer cannot price detailing', r.status, 400);

    // ---- still closed to customers until the second switch ----
    r = await ask('interior_detail');
    check('approved detailers alone do not open bookings', r.status, 400);
    r = await call(admin, '/api/admin/settings', 'POST', { detailing_booking: true });
    r = await (await fetch(`${BASE}/api/pricing`)).json();
    check('customers now see detailing, booked ahead', [Object.keys(r.services).includes('detailing'), r.services.detailing?.book_ahead], [true, true]);

    // ---- customer books ----
    r = await ask('interior_detail', null);
    check('detailing cannot be "as soon as possible"', [r.status, r.json.error], [400, 'Detailing is booked ahead. Choose Schedule a time and pick a slot']);
    r = await call(customer, '/api/orders', 'POST', { service: 'detailing', package: 'interior_detail', vehicle: 'sedan', address: 'x', lat: -33.84, lng: 18.65, payment_method: 'cash', supplier_id: detailer.id });
    check('detailing cannot skip the quote step', r.status, 400);
    r = await ask('interior_detail', dayOut(5, '20:00'));
    check('a booked time must be inside business hours', [r.status, r.json.error], [400, 'Choose a time between 07:00 and 18:00, our business hours']);
    // 12 business hours ahead: the earliest slot works, 15 minutes earlier does not.
    const earliest = quotesMod.earliestBooking('detailing').replace(' ', 'T');
    const tooSoon = new Date(Date.parse(`${earliest}:00Z`) - 15 * 60e3).toISOString().slice(0, 16);
    r = await ask('interior_detail', tooSoon);
    check('detailing needs 12 business hours notice', r.status, 400);
    r = await ask('interior_detail', earliest);
    check('the earliest slot offered is accepted', r.status, 200);
    // The detailer is offline: booked-ahead requests still reach them.
    db.prepare('UPDATE suppliers SET online = 0 WHERE user_id = ?').run(detailer.id);
    r = await ask('interior_detail');
    check('the offline approved detailer is asked; nothing is answered for them', [r.status, r.json.asked, r.json.auto_quoted, r.json.book_ahead], [200, 1, 0, true]);
    const reqId = r.json.request_id;
    const exp = db.prepare('SELECT expires_at FROM quote_requests WHERE id = ?').get(reqId).expires_at;
    const want = quotesMod.bookedExpiry('detailing', slot.replace('T', ' '));
    check('detailers get 12 business hours to answer', Math.abs(Date.parse(`${exp.replace(' ', 'T')}Z`) - Date.parse(`${want.replace(' ', 'T')}Z`)) <= 300e3, true); // both on 5-minute marks
    check('the customer is not notified just for asking', /accepted your booking/.test(log), false);
    await new Promise((res) => setTimeout(res, 300));
    check('the detailer is emailed the booking request', /mail:dry-run\] Detailing booking request: Interior Detail/.test(log), true);
    let list = await call(carPro, '/api/supplier/quote-requests');
    check('the everyday washer never sees the detailing request', list.json.requests.some((x) => x.service === 'detailing'), false);
    list = await call(detailer, '/api/supplier/quote-requests');
    const mine = list.json.requests.find((x) => x.id === reqId);
    check('offline, the detailer still sees it: accept/decline, their price pre-filled, 10% margin',
      [mine?.book_ahead, mine?.my_listed_cents, mine?.fee_pct, !!mine?.answer_by], [true, 90000, 10, true]);
    r = await call(detailer, `/api/supplier/quote-requests/${reqId}/quote`, 'POST', { price_cents: 90000, availability: 'I bring my own water' });
    check('the detailer accepts while offline', r.status, 200);
    let qs = quotesOn(reqId);
    check('detailing margin is 10%: R900 -> R990', [qs[0].supplier_price_cents, qs[0].platform_fee_cents, qs[0].total_cents],
      [90000, 9000, 90000 + qs[0].callout_fee_cents + 9000]);
    await new Promise((res) => setTimeout(res, 300));
    check('the customer is emailed that a detailer accepted', /mail:dry-run\] DT Detailer accepted your booking/.test(log), true);
    r = await call(customer, '/api/quote-requests');
    check('the customer finds it under their booking requests, with the acceptance',
      r.json.requests.find((x) => x.id === reqId)?.quotes.map((q) => q.business_name), ['DT Detailer']);
    r = await call(customer, `/api/quotes/${qs[0].id}/accept`, 'POST', { payment_method: 'cash' });
    check('detailing cannot be paid in cash', [r.status, r.json.error], [400, 'Detailing is paid by card']);
    r = await call(customer, `/api/quotes/${qs[0].id}/accept`, 'POST', { payment_method: 'card' });
    check('booking by card goes to payment; the job waits for the money', [r.status, !!r.json.payment_url, r.json.order?.status], [200, true, 'pending_payment']);
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE customer_id = ? AND service = 'detailing'").run(customer.id);
    db.prepare('UPDATE suppliers SET online = 1 WHERE user_id = ?').run(detailer.id);

    r = await ask('paint_ceramic');
    check('ceramic: asked, but never auto-quoted', [r.json.asked, r.json.auto_quoted], [1, 0]);
    r = await call(detailer, `/api/supplier/quote-requests/${r.json.request_id}/quote`, 'POST', { price_cents: 300000, availability: 'Saturday' });
    check('detailer quotes R3 000 by hand, customer pays R3 300', r.json.total_cents - quotesOn(db.prepare("SELECT id FROM quote_requests WHERE package = 'paint_ceramic' ORDER BY id DESC").get().id)[0].callout_fee_cents, 330000);

    // ---- card only: without card payments, detailing stays closed (checked in this process,
    // where no gateway is configured) ----
    check('no card yet: real customers cannot book detailing', quotesMod.serviceOpen('detailing', { id: customer.id, is_demo: 0 }), false);
    check('no card yet: a demo account can still rehearse it', quotesMod.serviceOpen('detailing', { id: 1, is_demo: 1 }), true);
    check('car wash is unaffected', quotesMod.serviceOpen('carwash', { id: customer.id, is_demo: 0 }), true);

    // ---- booked car wash: the pro accepts or declines, even with a published price ----
    r = await ask('express', dayOut(5, '23:30'), 'carwash');
    check('a booked car wash must be inside business hours too', r.status, 400);
    db.prepare('UPDATE suppliers SET online = 0 WHERE user_id = ?').run(carPro.id);
    r = await ask('express', slot, 'carwash');
    const washReq = r.json.request_id;
    check('booked car wash: offline washer asked, NOT answered from their price list', [r.status, r.json.auto_quoted, r.json.book_ahead], [200, 0, true]);
    list = await call(carPro, '/api/supplier/quote-requests');
    const washMine = list.json.requests.find((x) => x.id === washReq);
    check('the washer sees it offline, to accept or decline, own price pre-filled', [washMine?.book_ahead, washMine?.my_listed_cents], [true, 18000]);
    await new Promise((res) => setTimeout(res, 300));
    check('no customer notification before anyone accepts', /DT Washer accepted your booking/.test(log), false);
    r = await call(carPro, `/api/supplier/quote-requests/${washReq}/quote`, 'POST', { price_cents: 18000 });
    check('the washer accepts', r.status, 200);
    await new Promise((res) => setTimeout(res, 300));
    check('the customer is told once the washer accepts', /mail:dry-run\] DT Washer accepted your booking/.test(log), true);
    r = await call(carPro, `/api/supplier/quote-requests/${washReq}/quote`, 'POST', { price_cents: 19000 });
    await new Promise((res) => setTimeout(res, 300));
    check('changing the price does not notify the customer again', (log.match(/DT Washer accepted your booking/g) || []).length, 1);
    r = await call(customer, '/api/quote-requests');
    const washListed = r.json.requests.find((x) => x.id === washReq);
    check('it is in the customer\'s booking requests, cash allowed for car wash', [washListed?.quotes.length, washListed?.card_only], [1, false]);
    r = await call(customer, `/api/quotes/${washListed.quotes[0].id}/accept`, 'POST', { payment_method: 'cash' });
    check('customer books the washer, cash on completion', [r.status, r.json.order?.status], [200, 'accepted']);
    db.prepare('UPDATE suppliers SET online = 1 WHERE user_id = ?').run(carPro.id);

    // ---- several bookings side by side (two cars, two days) ----
    const sat = await ask('express', dayOut(6, '10:00'), 'carwash');
    const sun = await ask('express', dayOut(7, '10:00'), 'carwash');
    const statusOf = (id) => db.prepare('SELECT status FROM quote_requests WHERE id = ?').get(id).status;
    check('a second booking does not cancel the first', [statusOf(sat.json.request_id), statusOf(sun.json.request_id)], ['open', 'open']);
    const satAgain = await ask('express', dayOut(6, '10:00'), 'carwash');
    check('asking for the identical booking again replaces it (no double job for pros)', [statusOf(sat.json.request_id), statusOf(satAgain.json.request_id)], ['cancelled', 'open']);
    const now = await ask('express', null, 'carwash');
    check('an "as soon as possible" request leaves the bookings open', [statusOf(satAgain.json.request_id), statusOf(sun.json.request_id)], ['open', 'open']);
    // Like Uber: nobody is booked until a pro accepts, even "as soon as possible".
    check('"as soon as possible": online washers asked, nobody answered for them', [now.json.asked, now.json.auto_quoted], [2, 0]);
    r = await call(carPro, `/api/supplier/quote-requests/${now.json.request_id}/quote`, 'POST', { price_cents: 18000, availability: 'In 30 minutes' });
    check('the washer accepts the job now', r.status, 200);
    const nowQ = quotesOn(now.json.request_id).find((q) => q.supplier_id === carPro.id);
    check('car wash margin still 20%: R180 -> R216', [nowQ.platform_fee_cents, nowQ.total_cents], [3600, 18000 + nowQ.callout_fee_cents + 3600]);
    r = await call(customer, `/api/quotes/${nowQ.id}/accept`, 'POST', { payment_method: 'cash' });
    check('a job now can be booked next to an existing booking', [r.status, r.json.order?.status], [200, 'accepted']);
    await call(carPro, `/api/supplier/quote-requests/${sun.json.request_id}/quote`, 'POST', { price_cents: 18000 });
    r = await call(customer, `/api/quotes/${quotesOn(sun.json.request_id)[0].id}/accept`, 'POST', { payment_method: 'cash' });
    check('and a second booking next to both', [r.status, r.json.order?.status], [200, 'accepted']);
    await call(carPro, `/api/supplier/quote-requests/${satAgain.json.request_id}/quote`, 'POST', { price_cents: 18000 });
    const dupOrder = db.prepare("SELECT id FROM orders WHERE customer_id = ? AND service = 'carwash' AND scheduled_for = ?").get(customer.id, dayOut(7, '10:00').replace('T', ' '));
    check('the Sunday booking is its own order', !!dupOrder, true);
    // Found in the 21 Nov simulation: a booked job showed "Start driving" a week early.
    r = await call(carPro, `/api/supplier/jobs/${dupOrder.id}/advance`, 'POST');
    check('a booked job cannot be started days early', [r.status, /You can set off from/.test(r.json?.error || '')], [400, true]);
    const soon = db.prepare("SELECT id FROM orders WHERE customer_id = ? AND service = 'carwash' AND scheduled_for IS NULL AND status = 'accepted'").get(customer.id);
    r = await call(carPro, `/api/supplier/jobs/${soon.id}/advance`, 'POST');
    check('a job for now still starts straight away', [r.status, r.json?.order?.status], [200, 'en_route']);
    const wallIn = (h) => new Date(Date.now() + 2 * 3600e3 + h * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    db.prepare('UPDATE orders SET scheduled_for = ? WHERE id = ?').run(wallIn(1.5), dupOrder.id);
    r = await call(carPro, `/api/supplier/jobs/${dupOrder.id}/advance`, 'POST');
    check('within 2 hours of the booked time the pro can set off', [r.status, r.json?.order?.status], [200, 'en_route']);
    // Found in the 21 Nov simulation: Decline used to leave the job on the pro's screen.
    r = await call(carPro, '/api/supplier/quote-requests');
    check('before declining, the pro sees the Saturday booking', r.json.requests.some((x) => x.id === satAgain.json.request_id), true);
    r = await call(carPro, `/api/supplier/quote-requests/${satAgain.json.request_id}/decline`, 'POST');
    check('the pro declines it', r.status, 200);
    r = await call(carPro, '/api/supplier/quote-requests');
    check('a declined request is gone from the pro list', r.json.requests.some((x) => x.id === satAgain.json.request_id), false);
    check('and the customer is not told about a decline (no "accepted" left for that pro)', quotesOn(satAgain.json.request_id).some((q) => q.supplier_id === carPro.id), false);
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE customer_id = ? AND service = 'carwash'").run(customer.id);
    db.prepare("UPDATE quote_requests SET status = 'cancelled' WHERE customer_id = ? AND status = 'open'").run(customer.id);

    // ---- nobody accepts: shown quietly, no notification ----
    r = await ask('full_valet', dayOut(6, '09:00'), 'carwash');
    const idle = r.json.request_id;
    db.prepare("UPDATE quote_requests SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(idle);
    quotesMod.expireStale();
    r = await call(customer, '/api/quote-requests');
    check('an unanswered booking shows as unanswered', r.json.requests.find((x) => x.id === idle)?.status, 'unanswered');
    check('and nobody emailed the customer about it', /No .* was available|No detailer/.test(log), false);
    r = await call(customer, `/api/quote-requests/${idle}/cancel`, 'POST');
    r = await call(customer, '/api/quote-requests');
    check('the customer can dismiss it', r.json.requests.some((x) => x.id === idle), false);

    // ---- business hours are the owner's setting ----
    r = await call(admin, '/api/admin/settings', 'POST', { business_open: '18:00', business_close: '07:00' });
    check('closing must be after opening', r.status, 400);
    r = await call(admin, '/api/admin/settings', 'POST', { business_open: '06:00', business_close: '20:00' });
    r = await ask('express', dayOut(5, '19:30'), 'carwash');
    check('with longer hours, 19:30 can be booked', r.status, 200);
    await call(admin, '/api/admin/settings', 'POST', { business_open: '07:00', business_close: '18:00' });

    // ---- a demo customer (the payment reviewer) still gets instant answers ----
    const demoCust = mkUser('customer', 'DT Demo Customer');
    db.prepare('UPDATE users SET is_demo = 1 WHERE id = ?').run(demoCust.id);
    const demoPro = mkUser('supplier', 'DT Demo Pro', 'carwash');
    db.prepare('UPDATE users SET is_demo = 1 WHERE id = ?').run(demoPro.id);
    db.prepare("INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, 'carwash', 'express', 18000)").run(demoPro.id);
    TOKENS.set(demoCust.id, auth.signUser(demoCust));
    r = await call(demoCust, '/api/quote-requests', 'POST', { service: 'carwash', package: 'express', vehicle: 'sedan', address: 'Demo', lat: -33.84, lng: 18.65 });
    check('demo accounts keep instant answers', r.json.auto_quoted >= 1, true);

    // ---- "I also do detailing" on the application form ----
    // The sign-up flow proves the WhatsApp number first; stand that part in so these
    // checks are about the detailing tick and nothing else.
    const provedPhone = (phone, code) => db.prepare(`INSERT INTO signup_phone_codes (phone, code, attempts, send_failed, expires_at, sent_at)
      VALUES (?, ?, 0, 0, datetime('now', '+30 minutes'), datetime('now'))
      ON CONFLICT(phone) DO UPDATE SET code = excluded.code, attempts = 0, expires_at = excluded.expires_at`).run(phone, code);
    const signUp = (email, body) => fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FreshAF-Client': 'native' },
      body: JSON.stringify({ role: 'supplier', name: 'DT Applicant', email, password: 'TestPass!2026',
        phone: '0780000000', accept_terms: true, business_name: 'DT Applicant Detailing',
        id_number: '9001015800085', service_area: 'Western Cape: Northern Suburbs',
        services: ['carwash'], ...body }),
    });
    const intentOf = (email) => db.prepare(`SELECT detailing_intent d FROM suppliers
      WHERE user_id = (SELECT id FROM users WHERE email = ?)`).get(email)?.d;

    await call(admin, '/api/admin/settings', 'POST', { detailing_signup: false });
    let pub = await (await fetch(`${BASE}/api/pricing`)).json();
    check('the form is not offered detailing while applications are closed', pub.detailing_signup_open, false);
    let email = `dt-closed-${stamp}@test.invalid`;
    provedPhone('27780000000', '123456');
    let reg = await signUp(email, { detailing_intent: true, phone_code: '123456' });
    if (reg.status !== 200) console.log('REGDEBUG', await reg.clone().json());
    check('signing up with detailing ticked still works while it is closed', reg.status, 200);
    check('but the intention is not recorded', intentOf(email), 0);

    await call(admin, '/api/admin/settings', 'POST', { detailing_signup: true });
    pub = await (await fetch(`${BASE}/api/pricing`)).json();
    check('with applications open the form offers detailing', pub.detailing_signup_open, true);
    email = `dt-intent-${stamp}@test.invalid`;
    provedPhone('27780000000', '123456');
    reg = await signUp(email, { detailing_intent: true, phone_code: '123456' });
    check('a detailer signs up with the tick on', reg.status, 200);
    check('the intention is recorded', intentOf(email), 1);
    const applicant = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    check('and detailing is NOT added to their services',
      db.prepare('SELECT services FROM suppliers WHERE user_id = ?').get(applicant.id).services, 'carwash');
    TOKENS.set(applicant.id, auth.signUser(applicant));
    r = await call(applicant, '/api/supplier/detailing');
    check('their own page knows they said yes, with no application yet', [r.json.intent, r.json.status], [true, null]);
    r = await call(admin, '/api/admin/suppliers');
    check('the admin list shows the intention',
      r.json.suppliers.find((x) => x.user_id === applicant.id).detailing_intent, true);

    // ---- prices can be loaded while the detailing application is in review ----
    // (Evert, 22 Nov 2026: "let the ones who do detailing put their pricing in for detailing solong")
    const waiting = mkUser('supplier', 'DT Waiting Detailer', 'carwash');
    TOKENS.set(waiting.id, auth.signUser(waiting));
    // parked in Johannesburg so this extra pro never joins the Cape Town request counts above
    db.prepare('UPDATE suppliers SET lat = -26.2, lng = 28.04 WHERE user_id = ?').run(waiting.id);
    r = await call(waiting, '/api/supplier/prices');
    check('a pro who has not applied for detailing sees no detailing prices', Object.keys(r.json.services), ['carwash']);
    r = await call(waiting, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'full_detail', price_cents: 150000 }] });
    check('and cannot save a detailing price', r.status, 400);

    db.prepare("UPDATE suppliers SET detailing_status = 'pending' WHERE user_id = ?").run(waiting.id);
    r = await call(waiting, '/api/supplier/prices');
    check('once the application is in, detailing is on the price list',
      [Object.keys(r.json.services), r.json.services.detailing.pending_approval], [['carwash', 'detailing'], true]);
    r = await call(waiting, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'full_detail', price_cents: 150000 }] });
    check('and the detailing price saves', r.status, 200);
    check('it is stored against detailing',
      db.prepare("SELECT price_cents FROM supplier_prices WHERE user_id = ? AND service = 'detailing'").get(waiting.id).price_cents, 150000);
    r = await ask('full_detail');
    check('but a detailing job still never reaches them while they wait',
      quotesOn(r.json.request_id).some((q) => q.supplier_id === waiting.id), false);
    r = await call(waiting, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'paint_ceramic', price_cents: 300000 }] });
    check('paint correction stays quote-only even in review', r.status, 400);

    // an application still awaiting the pro's own approval may price too
    db.prepare("UPDATE suppliers SET status = 'pending' WHERE user_id = ?").run(waiting.id);
    r = await call(waiting, '/api/supplier/prices', 'POST', { prices: [{ service: 'detailing', package: 'interior_detail', price_cents: 95000 }] });
    check('a pro whose own application is in review can set prices as well', r.status, 200);
    db.prepare("UPDATE suppliers SET status = 'approved' WHERE user_id = ?").run(waiting.id);

    // ---- detailer chooses detailing only ----
    r = await call(detailer, '/api/supplier/detailing/carwash', 'POST', { enabled: false });
    check('detailer turns everyday car wash off', [r.status, services(detailer)], [200, 'detailing']);
    r = await call(carPro, '/api/supplier/detailing/carwash', 'POST', { enabled: false });
    check('only approved detailers have that switch', r.status, 403);
    r = await ask('express', null, 'carwash');
    check('a detailing-only pro gets no car wash requests', r.json.asked, 1);

    // ---- taken away again ----
    r = await call(admin, `/api/admin/suppliers/${detailer.id}/detailing`, 'POST', { decision: 'decline', reason: 'Photos do not show your own work' });
    check('declined: detailing removed, car wash put back so the account has a service', [r.status, services(detailer)], [200, 'carwash']);
    r = await call(detailer, '/api/supplier/detailing');
    check('pro sees the decision and the reason', [r.json.status, r.json.reason], ['declined', 'Photos do not show your own work']);
    r = await ask('interior_detail');
    check('with no approved detailer nobody is asked', r.json.asked, 0);

    r = await call(admin, '/api/admin/settings', 'POST', { detailing_booking: false });
    r = await ask('interior_detail');
    check('switching bookings off closes it again', r.status, 400);

    // ---- Top Tier: a police clearance is a badge, not a gate (Evert, 23 Nov 2026) ----
    // Two fresh pros, so none of the bookings above can make them busy: one with a police
    // clearance on file and a higher price, one cheaper without.
    const ttPro = mkUser('supplier', 'DT TopTier Washer', 'carwash');
    const ttRival = mkUser('supplier', 'DT Cheaper Washer', 'carwash');
    TOKENS.set(ttPro.id, auth.signUser(ttPro));
    TOKENS.set(ttRival.id, auth.signUser(ttRival));
    const ttQuote = () => r.json.quotes.find((q) => q.supplier_id === ttPro.id);

    r = await ask('express', null, 'carwash');
    let ttReq = r.json.request_id;
    await call(ttPro, `/api/supplier/quote-requests/${ttReq}/quote`, 'POST', { price_cents: 19000 });
    r = await call(customer, `/api/quote-requests/${ttReq}`);
    check('a pro with no police clearance still quotes', !!ttQuote(), true);
    check('and is not shown as Top Tier', ttQuote()?.top_tier, false);

    await call(customer, `/api/quote-requests/${ttReq}/cancel`, 'POST');
    db.prepare(`INSERT INTO supplier_docs (user_id, kind, original_name, stored_name, uploaded_at)
      VALUES (?, 'police_clearance', 'clearance.pdf', 'x-clearance.pdf', datetime('now'))`).run(ttPro.id);
    r = await ask('express', null, 'carwash');
    ttReq = r.json.request_id;
    await call(ttRival, `/api/supplier/quote-requests/${ttReq}/quote`, 'POST', { price_cents: 17000 });
    await call(ttPro, `/api/supplier/quote-requests/${ttReq}/quote`, 'POST', { price_cents: 19000 });
    r = await call(customer, `/api/quote-requests/${ttReq}`);
    check('once the clearance is in, the customer sees Top Tier', ttQuote()?.top_tier, true);
    check('and the Top Tier pro is listed first, above a cheaper quote without the badge',
      [r.json.quotes.length, r.json.quotes[0].supplier_id === ttPro.id], [2, true]);
  } catch (e) {
    console.log('ERROR', e); checks.push(false);
  } finally {
    await stopServer(server);
    try { db.close(); } catch {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
    const bad = checks.filter((c) => !c).length;
    console.log(`\n${checks.length - bad}/${checks.length} passed`);
    if (bad) console.log(log.slice(-2500));
    process.exit(bad ? 1 : 0);
  }
})();
