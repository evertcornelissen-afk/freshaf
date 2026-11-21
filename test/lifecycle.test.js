// The everyday order lifecycle, end to end, against a throwaway database (21 Nov 2026).
// Written after the first full simulation, to cover what the other tests do not:
//  - sign-up and sign-in (email never case-sensitive);
//  - one account can never see or move another account's order or job;
//  - money on a cash job paid partly with rewards: the pro is never billed for cash they
//    never collected;
//  - the R300 cash cap stops a pro being offered work until they settle;
//  - cancelling (customer, after acceptance; refused once the pro is on the way);
//  - laundry: handed over only with a photo and a name, photo private to that customer;
//  - a booking nobody answers turns "unanswered" for the customer and leaves the pros' lists;
//  - password reset does not reveal which emails have accounts.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { stopServer } = require('./stop-server');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-lifecycle-'));
process.env.FRESHAF_DATA_DIR = DATA_DIR;
const { db } = require(path.join(ROOT, 'server', 'db'));
const auth = require(path.join(ROOT, 'server', 'auth'));

const PORT = 5764, BASE = `http://127.0.0.1:${PORT}`;
const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
};
const stamp = Date.now();
function mkUser(role, name, services = 'carwash,laundry') {
  const id = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, home_lat, home_lng, home_address)
    VALUES (?, ?, ?, '+27820000000', 'x', -33.84, 18.65, 'Test street')`)
    .run(role, name, `lc-${role}-${name.replace(/\W/g, '')}-${stamp}@test.invalid`).lastInsertRowid;
  if (role === 'supplier') {
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, online, lat, lng, services, radius_km)
      VALUES (?, ?, '0000000000000', 'approved', 1, -33.83, 18.65, ?, 25)`).run(id, name, services);
    for (const [svc, pkg, c] of [['carwash', 'express', 18000], ['laundry', 'wash_fold', 22000]]) {
      db.prepare('INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)').run(id, svc, pkg, c);
    }
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
const admin = mkUser('admin', 'LC Admin');
const proA = mkUser('supplier', 'LC Pro A');
const proB = mkUser('supplier', 'LC Pro B');
const cust = mkUser('customer', 'LC Customer');
const other = mkUser('customer', 'LC Other');
const TOKENS = new Map([admin, proA, proB, cust, other].map((u) => [u.id, auth.signUser(u)]));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dayOut = (d, hhmm) => `${new Date(Date.now() + d * 86400e3).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 10)}T${hhmm}`;

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), FRESHAF_DATA_DIR: DATA_DIR, ADMIN_API_KEY: '', SMTP_PASS: '',
      WHATSAPP_TOKEN: '', NODE_ENV: 'development', PAYMENTS_LIVE: '', BASE_URL: BASE, FCM_SERVICE_ACCOUNT: '', APNS_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  const call = async (u, p, method = 'GET', body) => {
    const headers = { 'X-FreshAF-Client': 'native' };
    if (u) headers.Authorization = `Bearer ${TOKENS.get(u.id)}`;
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, json: type.includes('json') ? await r.json().catch(() => null) : null };
  };
  const openReq = () => db.prepare("SELECT id FROM quote_requests WHERE customer_id = ? AND status = 'open' ORDER BY id DESC").get(cust.id)?.id;
  // Customer asks, pro A accepts, customer books. Returns the order.
  const book = async ({ service = 'carwash', pkg = 'express', vehicle = 'sedan', when = null, pay = 'cash', points = false, c = cust } = {}) => {
    const q = await call(c, '/api/quote-requests', 'POST', { service, package: pkg, vehicle, address: 'Test street', lat: -33.84, lng: 18.65, scheduled_for: when });
    if (q.status !== 200) throw new Error(`request: ${q.status} ${JSON.stringify(q.json)}`);
    const a = await call(proA, `/api/supplier/quote-requests/${q.json.request_id}/quote`, 'POST', { price_cents: service === 'laundry' ? 22000 : 18000, availability: 'Soon' });
    if (a.status !== 200) throw new Error(`quote: ${a.status} ${JSON.stringify(a.json)}`);
    const quote = db.prepare("SELECT id FROM quotes WHERE request_id = ? AND supplier_id = ? AND status = 'open'").get(q.json.request_id, proA.id);
    const o = await call(c, `/api/quotes/${quote.id}/accept`, 'POST', { payment_method: pay, use_points: points });
    if (o.status !== 200) throw new Error(`accept: ${o.status} ${JSON.stringify(o.json)}`);
    return o.json.order;
  };
  const advance = (o, u = proA) => call(u, `/api/supplier/jobs/${o.id}/advance`, 'POST');
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

    // ---- sign-up and sign-in ----
    const email = `New.Person-${stamp}@Example.com`;
    let r = await call(null, '/api/auth/register', 'POST', { role: 'customer', name: 'New Person', email, password: 'longenough1',
      home_address: '1 Test Rd', home_lat: -33.84, home_lng: 18.65, accept_terms: true });
    check('a customer signs up', r.status, 200);
    r = await call(null, '/api/auth/login', 'POST', { email: email.toLowerCase(), password: 'longenough1' });
    check('and signs in with the email in lower case', r.status, 200);
    r = await call(null, '/api/auth/register', 'POST', { role: 'customer', name: 'Dup', email: email.toUpperCase(), password: 'longenough1',
      home_address: '1 Test Rd', accept_terms: true });
    check('the same email in other capitals cannot sign up twice', r.status >= 400 && r.status < 500, true);
    r = await call(null, '/api/auth/login', 'POST', { email, password: 'wrong-password' });
    check('a wrong password is refused', r.status, 401);
    const known = await call(null, '/api/auth/forgot', 'POST', { email });
    const unknown = await call(null, '/api/auth/forgot', 'POST', { email: `nobody-${stamp}@example.com` });
    // The message repeats the address typed, so compare with that taken out.
    const same = (j, e) => JSON.stringify(j).split(e).join('<email>');
    check('password reset answers the same for a known and an unknown email',
      [known.status, same(known.json, email.toLowerCase()) === same(unknown.json, `nobody-${stamp}@example.com`)], [unknown.status, true]);

    // ---- a cash job, start to finish, and privacy between accounts ----
    const o1 = await book();
    check('booked: R180 + 20% = R216, cash on completion', [o1.price_cents, o1.payment_method], [21600, 'cash']);
    r = await call(other, `/api/orders/${o1.id}`);
    check('another customer cannot open this order', r.status, 404);
    r = await call(other, `/api/orders/${o1.id}/cancel`, 'POST');
    check('another customer cannot cancel it', r.status, 404);
    r = await advance(o1, proB);
    check('another pro cannot move this job', r.status, 404);
    r = await call(cust, '/api/supplier/jobs');
    check('a customer cannot reach the pro app', r.status >= 401 && r.status <= 403, true);
    r = await call(proA, '/api/admin/suppliers');
    check('a pro cannot reach admin', r.status >= 401 && r.status <= 404, true);
    await advance(o1);
    r = await call(cust, `/api/orders/${o1.id}/cancel`, 'POST');
    check('the customer cannot cancel once the pro is on the way', r.status, 400);
    await advance(o1);
    r = await advance(o1);
    check('job done', r.json?.order?.status, 'completed');
    await call(cust, `/api/orders/${o1.id}/rate`, 'POST', { stars: 5 });
    r = await call(cust, `/api/orders/${o1.id}/rate`, 'POST', { stars: 1 });
    check('an order is rated once only', r.status, 409);
    r = await call(proA, '/api/supplier/earnings');
    check('pro A holds FreshAF R36 from that cash job', r.json.fee_owed_cents, 3600);
    const pts = db.prepare('SELECT points_cents FROM users WHERE id = ?').get(cust.id).points_cents;
    check('the customer earned rewards (5% of R216)', pts, Math.round(21600 * 0.05));

    // ---- rewards on a cash job: the pro collects less, so must owe less ----
    const o2 = await book({ points: true });
    check('rewards come off what the customer pays at the door', [o2.amount_due_cents ?? null, o2.price_cents], [21600 - pts, 21600]);
    await advance(o2); await advance(o2); await advance(o2);
    r = await call(proA, '/api/supplier/earnings');
    // Collected R216 minus rewards in cash; R180 is theirs; FreshAF's share in their hand is R36 minus rewards.
    check('the pro is billed only for FreshAF money they actually collected', r.json.fee_owed_cents, 3600 + (3600 - pts));

    // ---- customer cancels after acceptance: the job leaves the pro's list ----
    const o3 = await book();
    r = await call(cust, `/api/orders/${o3.id}/cancel`, 'POST');
    check('the customer can cancel before the pro sets off', r.status, 200);
    r = await call(proA, '/api/supplier/jobs');
    check('the cancelled job is gone from the pro jobs', r.json.active.some((j) => j.id === o3.id), false);

    // ---- laundry: handover needs a photo and a name; the photo is private ----
    const l1 = await book({ service: 'laundry', pkg: 'wash_fold', vehicle: 'small' });
    await advance(l1); await advance(l1); await advance(l1);
    r = await advance(l1);
    check('laundry cannot be closed without the handover photo', r.status, 400);
    const fd = new FormData(); fd.append('receiver', 'Neighbour'); fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'h.png');
    r = await call(proA, `/api/supplier/jobs/${l1.id}/handover`, 'POST', fd);
    check('handover with a photo and a name closes it', r.status, 200);
    r = await call(cust, `/api/orders/${l1.id}/handover-photo`);
    const r2 = await call(other, `/api/orders/${l1.id}/handover-photo`);
    check('the customer sees the handover photo, nobody else does', [r.status, r2.status], [200, 404]);

    // ---- the R300 cash cap ----
    r = await call(proA, '/api/supplier/earnings');
    db.prepare('UPDATE orders SET platform_fee_cents = platform_fee_cents + ? WHERE id = ?').run(30000 - r.json.fee_owed_cents, o1.id);
    r = await call(proA, '/api/supplier/earnings');
    check('over the cap: pro A is blocked', r.json.cash_blocked, true);
    r = await call(cust, '/api/quote-requests', 'POST', { service: 'carwash', package: 'express', vehicle: 'sedan', address: 'Test street', lat: -33.84, lng: 18.65 });
    check('a blocked pro is not asked; the others are', r.json.asked, 1);
    r = await call(proA, '/api/supplier/quote-requests');
    check('and sees no requests', r.json.requests.length, 0);
    r = await call(proA, `/api/supplier/quote-requests/${openReq()}/quote`, 'POST', { price_cents: 18000 });
    check('and cannot accept one by going around the app', r.status, 402);
    db.prepare('UPDATE orders SET fee_settled = 1 WHERE supplier_id = ?').run(proA.id);
    r = await call(proA, '/api/supplier/earnings');
    check('after settling, pro A is free again', r.json.cash_blocked, false);
    await call(cust, `/api/quote-requests/${openReq()}/cancel`, 'POST');

    // ---- a booking nobody answers ----
    r = await call(cust, '/api/quote-requests', 'POST', { service: 'carwash', package: 'express', vehicle: 'sedan', address: 'Unanswered', lat: -33.84, lng: 18.65, scheduled_for: dayOut(3, '11:00') });
    const lonely = r.json.request_id;
    // What the server's expiry timer does once the answer-by time passes.
    db.prepare("UPDATE quote_requests SET status = 'expired', expires_at = datetime('now', '-1 minute') WHERE id = ?").run(lonely);
    r = await call(cust, '/api/quote-requests');
    const mine = r.json.requests.find((x) => x.id === lonely);
    check('the customer sees it as unanswered (not silently gone)', mine?.status, 'unanswered');
    r = await call(proB, '/api/supplier/quote-requests');
    check('and it has left the pros lists', r.json.requests.some((x) => x.id === lonely), false);
  } catch (e) {
    console.log('ERROR', e); checks.push(false);
  } finally {
    await stopServer(server);
    try { db.close(); } catch {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
    const bad = checks.filter((c) => !c).length;
    console.log(`\n${checks.length - bad}/${checks.length} passed`);
    if (bad) console.log(log.slice(-2000));
    process.exit(bad ? 1 : 0);
  }
})();
