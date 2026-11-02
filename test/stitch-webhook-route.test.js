// End-to-end test of the Stitch webhook ROUTE, over real HTTP. The risk this covers is
// the raw-body wiring: express.json() mangling the body would break the signature even
// though the verifier itself is correct. Seeds a pending_payment order, posts a signed
// webhook, and checks the order flips to paid.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SECRET = 'whsec_' + Buffer.from(crypto.randomBytes(24)).toString('base64');
const LINK_OK = 'LINK-OK-' + Date.now();
const LINK_SHORT = 'LINK-SHORT-' + Date.now();
const PORT = 5758;
const tag = 'stitch-route-' + Date.now();

const { db } = require('../server/db');

function seed() {
  const custId = Number(db.prepare(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'x', 'customer')`
  ).run(tag, tag + '@example.test').lastInsertRowid);
  // payment_ref holds the Stitch payment LINK id. The payment.paid payload carries no
  // merchant reference, so this column is the only thing tying money to an order.
  const make = (linkId) => Number(db.prepare(
    `INSERT INTO orders (customer_id, service, package, vehicle, address, lat, lng,
       price_cents, supplier_price_cents, platform_fee_cents, callout_fee_cents,
       payment_method, payment_status, status, payment_ref)
     VALUES (?, 'carwash', 'wash_vac', 'suv', '1 Test Road', -33.93, 18.43,
             37600, 31300, 6300, 0, 'card', 'unpaid', 'pending_payment', ?)`
  ).run(custId, linkId).lastInsertRowid);
  return { custId, orderId: make(LINK_OK), shortOrderId: make(LINK_SHORT) };
}

function sign(body, id, ts) {
  const key = Buffer.from(SECRET.split('_')[1], 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

// Stitch Express payment.paid. Amounts are CENTS.
function payload(linkId, status, amount = 37600, paymentId = 'pay_' + linkId) {
  return JSON.stringify({ amount, id: paymentId, linkId, status, type: 'LINK' });
}

async function post(body, headers) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/payments/stitch/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: r.status, text: (await r.text()).slice(0, 60) };
}

function paymentStatus(orderId) {
  return db.prepare('SELECT payment_status, status FROM orders WHERE id = ?').get(orderId);
}

(async () => {
  const { custId, orderId, shortOrderId } = seed();
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), STITCH_WEBHOOK_SECRET: SECRET, PAYMENT_PROVIDER: 'stitch' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const checks = [];
  const check = (name, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    checks.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}`);
  };

  try {
    // Wait for the port rather than sleeping blindly.
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }

    const ts = Math.floor(Date.now() / 1000);
    const send = async (id, body) => post(body, {
      'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(body, id, ts),
    });
    const good = payload(LINK_OK, 'PAID');

    console.log('order before:', paymentStatus(orderId));

    const forged = await post(good, { 'svix-id': 'msg_x', 'svix-timestamp': String(ts), 'svix-signature': 'v1,AAAA=' });
    check('forged signature is refused', forged.status, 400);
    check('order untouched by the forgery', paymentStatus(orderId).payment_status, 'unpaid');

    const unsigned = await post(good, {});
    check('unsigned webhook is refused', unsigned.status, 400);

    // Underpayment must never mark an order paid, however valid the signature.
    const short = payload(LINK_SHORT, 'PAID', 100);
    check('underpaid webhook acknowledged', (await send('msg_short', short)).status, 200);
    check('underpaid order NOT marked paid', paymentStatus(shortOrderId).payment_status, 'unpaid');

    const real = await send('msg_real', good);
    check('signed webhook accepted', real.status, 200);
    check('order marked paid', paymentStatus(orderId).payment_status, 'paid');

    // Svix retries until it sees a 2xx, so a repeat delivery must be harmless.
    check('replayed delivery acknowledged', (await send('msg_again', good)).status, 200);
    check('order still paid exactly once', paymentStatus(orderId).payment_status, 'paid');

    const expired = payload(LINK_SHORT, 'EXPIRED');
    check('non-paid status acknowledged', (await send('msg_c', expired)).status, 200);
    check('expired left unpaid', paymentStatus(shortOrderId).payment_status, 'unpaid');

    const unknown = payload('LINK-NOT-OURS', 'PAID');
    check('unknown link acknowledged, not retried', (await send('msg_u', unknown)).status, 200);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
    if (passed !== checks.length) {
      console.log('\n--- server log ---\n' + log.slice(-1500));
      process.exitCode = 1;
    }
  } finally {
    server.kill();
    db.prepare('DELETE FROM orders WHERE customer_id = ?').run(custId);
    db.prepare('DELETE FROM users WHERE id = ?').run(custId);
    console.log('(test rows removed)');
  }
})();
