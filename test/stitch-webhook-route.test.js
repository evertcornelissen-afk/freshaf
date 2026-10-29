// End-to-end test of the Stitch webhook ROUTE, over real HTTP. The risk this covers is
// the raw-body wiring: express.json() mangling the body would break the signature even
// though the verifier itself is correct. Seeds a pending_payment order, posts a signed
// webhook, and checks the order flips to paid.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SECRET = 'whsec_' + Buffer.from(crypto.randomBytes(24)).toString('base64');
const PORT = 5758;
const tag = 'stitch-route-' + Date.now();

const { db } = require('../server/db');

function seed() {
  const custId = Number(db.prepare(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'x', 'customer')`
  ).run(tag, tag + '@example.test').lastInsertRowid);
  const orderId = Number(db.prepare(
    `INSERT INTO orders (customer_id, service, package, vehicle, address, lat, lng,
       price_cents, supplier_price_cents, platform_fee_cents, callout_fee_cents,
       payment_method, payment_status, status)
     VALUES (?, 'carwash', 'wash_vac', 'suv', '1 Test Road', -33.93, 18.43,
             37600, 31300, 6300, 0, 'card', 'unpaid', 'pending_payment')`
  ).run(custId).lastInsertRowid);
  return { custId, orderId };
}

function sign(body, id, ts) {
  const key = Buffer.from(SECRET.split('_')[1], 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

function payload(orderId, state) {
  return JSON.stringify({
    data: { client: { paymentInitiationRequests: { node: {
      __typename: 'PaymentInitiationRequest',
      id: 'cGF5cmVxLxxx',
      externalReference: String(orderId),
      amount: { currency: 'ZAR', quantity: '376.00' },
      state: { __typename: state },
    } } } },
  });
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
  const { custId, orderId } = seed();
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
    const good = payload(orderId, 'PaymentInitiationRequestCompleted');

    console.log('order before:', paymentStatus(orderId));

    const forged = await post(good, { 'svix-id': 'msg_x', 'svix-timestamp': String(ts), 'svix-signature': 'v1,AAAA=' });
    check('forged signature is refused', forged.status, 400);
    check('order untouched by the forgery', paymentStatus(orderId).payment_status, 'unpaid');

    const unsigned = await post(good, {});
    check('unsigned webhook is refused', unsigned.status, 400);

    const real = await post(good, {
      'svix-id': 'msg_real', 'svix-timestamp': String(ts), 'svix-signature': sign(good, 'msg_real', ts),
    });
    check('signed webhook accepted', real.status, 200);
    check('order marked paid', paymentStatus(orderId).payment_status, 'paid');

    const cancelled = payload(orderId, 'PaymentInitiationRequestCancelled');
    const cancel = await post(cancelled, {
      'svix-id': 'msg_c', 'svix-timestamp': String(ts), 'svix-signature': sign(cancelled, 'msg_c', ts),
    });
    check('cancellation acknowledged, not retried', cancel.status, 200);

    const unknown = payload(999999, 'PaymentInitiationRequestCompleted');
    const unk = await post(unknown, {
      'svix-id': 'msg_u', 'svix-timestamp': String(ts), 'svix-signature': sign(unknown, 'msg_u', ts),
    });
    check('unknown order acknowledged, not retried', unk.status, 200);

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
