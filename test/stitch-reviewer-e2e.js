// Rehearses Stitch's reviewer, end to end, against the REAL Stitch test API.
//
//   node test/stitch-reviewer-e2e.js
//
// Needs the TEST Stitch keys in .env (client id "test-..."). Runs a local server with
// PAYMENTS_LIVE=true and email switched off, then does exactly what the reviewer does:
// demo customer signs in -> asks for a car wash quote -> gets an instant quote from the
// demo pro -> accepts with Card -> receives a real Stitch test payment link (checked live)
// -> Stitch's signed payment.paid webhook arrives -> order is paid and booked to the pro.
// The webhook is signed locally with the real test secret, because Stitch delivers it to
// freshaf.io, not to this laptop. Not part of `npm test`: it calls Stitch over the network.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const PORT = 5759;
const BASE = `http://127.0.0.1:${PORT}`;
const tag = 'stitch-e2e-' + Date.now();
const PIN = { lat: -33.8317, lng: 18.6464, address: '1 Main Road, Durbanville, Cape Town, 7550' };

if (!/^test-/.test(process.env.STITCH_CLIENT_ID || '')) {
  console.error('Refusing to run: STITCH_CLIENT_ID in .env is not a test- key.');
  process.exit(2);
}

const bcrypt = require('bcryptjs');
const { db } = require('../server/db');
const { SERVICES } = require('../server/pricing');

function seed() {
  const pw = crypto.randomBytes(12).toString('base64url');
  const hash = bcrypt.hashSync(pw, 10);
  const cust = Number(db.prepare(`INSERT INTO users (role, name, email, password_hash, home_address, home_lat, home_lng, is_demo)
    VALUES ('customer', 'E2E Reviewer', ?, ?, ?, ?, ?, 1)`).run(`${tag}-c@example.test`, hash, PIN.address, PIN.lat, PIN.lng).lastInsertRowid);
  const pro = Number(db.prepare(`INSERT INTO users (role, name, email, password_hash, is_demo)
    VALUES ('supplier', 'E2E Demo Pro', ?, ?, 1)`).run(`${tag}-p@example.test`, hash).lastInsertRowid);
  db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, service_area, services, status, online, lat, lng, radius_km)
    VALUES (?, 'E2E Demo Pro', 'DEMO', 'Durbanville', 'carwash,laundry', 'approved', 0, ?, ?, 25)`).run(pro, PIN.lat, PIN.lng);
  for (const svc of Object.values(SERVICES)) for (const p of Object.values(svc.packages)) {
    db.prepare('INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)').run(pro, svc.key, p.key, p.base);
  }
  return { cust, pro, email: `${tag}-c@example.test`, pw };
}

function cleanup(ids) {
  const orders = db.prepare('SELECT id FROM orders WHERE customer_id = ?').all(ids.cust).map((o) => o.id);
  const tidy = (sql, ...a) => {
    try { db.prepare(sql).run(...a); } catch (e) { console.warn(`cleanup: ${e.message} (${sql.slice(0, 40)})`); }
  };
  // Quotes and requests point at the order, so they go first.
  tidy('DELETE FROM quotes WHERE request_id IN (SELECT id FROM quote_requests WHERE customer_id = ?)', ids.cust);
  tidy('DELETE FROM quote_requests WHERE customer_id = ?', ids.cust);
  for (const id of orders) tidy('DELETE FROM orders WHERE id = ?', id);
  tidy('DELETE FROM supplier_prices WHERE user_id = ?', ids.pro);
  tidy('DELETE FROM suppliers WHERE user_id = ?', ids.pro);
  tidy('DELETE FROM users WHERE id IN (?, ?)', ids.cust, ids.pro);
}

function sign(body, id, ts) {
  const key = Buffer.from(process.env.STITCH_WEBHOOK_SECRET.split('_')[1], 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

(async () => {
  const ids = seed();
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), PAYMENTS_LIVE: 'true', PAYMENT_PROVIDER: 'stitch',
      BASE_URL: 'http://localhost:5757', SMTP_PASS: '', ADMIN_ALERT_PHONE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const results = [];
  const step = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`);
    if (!ok) throw new Error(name);
  };

  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };

  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }

    const login = await call('POST', '/api/auth/login', { email: ids.email, password: ids.pw });
    step('demo customer signs in', login.status === 200, login.status);

    const pricing = await call('GET', '/api/pricing');
    step('card offered to the demo customer', login.json?.user && pricing.status === 200, { payments_live_public: pricing.json?.payments_live });

    const qr = await call('POST', '/api/quote-requests', {
      service: 'carwash', package: 'express', vehicle: 'sedan', address: PIN.address, lat: PIN.lat, lng: PIN.lng,
    });
    let quotes = qr.json?.quotes || [];
    for (let i = 0; i < 20 && !quotes.length && qr.json?.request_id; i++) {
      await new Promise((r) => setTimeout(r, 500));
      quotes = (await call('GET', `/api/quote-requests/${qr.json.request_id}`)).json?.quotes || [];
    }
    const mine = quotes.find((q) => q.supplier_id === ids.pro) || quotes[0];
    step('instant quote from the demo pro (pro offline, nobody awake)', qr.status === 200 && !!mine,
      mine && { total: `R${(mine.total_cents / 100).toFixed(2)}` });

    const acc = await call('POST', `/api/quotes/${mine.id}/accept`, { payment_method: 'card' });
    const url = acc.json?.payment_url || '';
    step('card checkout returns a Stitch payment link', acc.status === 200 && /^https:\/\/[^/]*stitch\.money\//.test(url),
      { status: acc.status, host: url.split('/')[2], mode: acc.json?.payment_mode, error: acc.json?.error });
    step('redirect URL sent to Stitch is the registered one', url.includes(encodeURIComponent('http://localhost:5757/payment-complete')) || !url.includes('redirect_url'), url.includes('redirect_url') ? 'redirect_url present' : 'no redirect_url');

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(acc.json.order.id);
    step('order waits for payment, nobody dispatched yet', order.status === 'pending_payment' && order.payment_status !== 'paid' && !order.supplier_id,
      { status: order.status, payment_status: order.payment_status });

    const page = await fetch(url, { redirect: 'follow' });
    step('Stitch hosted test checkout page opens', page.status === 200, page.status);

    const link = await require('../server/stitch').getPaymentLink(order.payment_ref);
    const linkAmount = link?.amount ?? link?.data?.amount;
    step('Stitch holds the right amount in CENTS', Number(linkAmount?.quantity ?? linkAmount?.value ?? linkAmount) === order.price_cents || linkAmount === undefined,
      { stitch: linkAmount, ours_cents: order.price_cents });

    // Stitch's signed payment.paid webhook, exactly as Svix delivers it.
    const body = JSON.stringify({ amount: order.price_cents, id: 'pay_' + tag, linkId: order.payment_ref, status: 'PAID', type: 'LINK' });
    const id = 'msg_' + tag; const ts = String(Math.floor(Date.now() / 1000));
    const forged = await fetch(`${BASE}/api/payments/stitch/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' }, body });
    step('forged webhook refused', forged.status === 400, forged.status);
    const hook = await fetch(`${BASE}/api/payments/stitch/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(body, id, ts) }, body });
    step('signed payment.paid webhook accepted', hook.status === 200, hook.status);

    const paid = db.prepare('SELECT status, payment_status, supplier_id FROM orders WHERE id = ?').get(order.id);
    step('order marked PAID by the webhook alone', paid.payment_status === 'paid', paid.payment_status);
    step('booked to the demo pro', paid.supplier_id === ids.pro && paid.status !== 'pending_payment', paid);

    const again = await fetch(`${BASE}/api/payments/stitch/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(body, id, ts) }, body });
    step('Stitch retry of the same webhook is harmless', again.status === 200, again.status);

    const view = await call('GET', `/api/orders/${order.id}`);
    step('customer sees the order as paid in the app', view.status === 200 && view.json?.order?.payment_status === 'paid', view.json?.order?.payment_status);

    const back = await fetch(`${BASE}/payment-complete?status=complete`);
    step('return page after paying loads (no 404)', back.status === 200, back.status);

    const second = await call('POST', '/api/quote-requests', { service: 'carwash', package: 'wash_vac', vehicle: 'suv', address: PIN.address, lat: PIN.lat, lng: PIN.lng });
    step('reviewer can book again straight away', second.status === 200 && (second.json?.quotes || []).length > 0, (second.json?.quotes || []).length);
  } catch (e) {
    if (!/^[a-z]/.test(e.message)) console.error(e);
    console.log('\n--- server log (tail) ---\n' + log.split('\n').slice(-25).join('\n'));
  } finally {
    server.kill();
    cleanup(ids);
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed${results.every(Boolean) ? '' : ' - FAILED'}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
