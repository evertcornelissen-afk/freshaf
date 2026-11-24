// Pro payouts. Stitch Express cannot pay a pro, so this is the ledger, the cash
// set-off, the bank CSV and the second lock on live card charges.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { stopServer } = require('./stop-server');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-payouts-'));
process.env.FRESHAF_DATA_DIR = DATA_DIR;
process.env.JWT_SECRET = 'payout-test-secret';
process.env.PAYMENTS_LIVE = '';
process.env.PAYOUTS_READY = '';
process.env.ADMIN_API_KEY = '';

const { db, setSetting } = require('../server/db');
const auth = require('../server/auth');
const payouts = require('../server/payouts');
const balance = require('../server/balance');

const PORT = 5771;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'whsec_' + Buffer.from(crypto.randomBytes(24)).toString('base64');
const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
};

let seq = 0;
function user(role, extra = {}) {
  seq += 1;
  const id = Number(db.prepare(`INSERT INTO users (role, name, email, password_hash, is_demo)
    VALUES (?, ?, ?, 'x', ?)`).run(role, extra.name || role, `payout-${role}-${seq}@test.invalid`, extra.demo ? 1 : 0).lastInsertRowid);
  if (role === 'supplier') {
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, bank_name, bank_account, bank_branch)
      VALUES (?, ?, '0000000000000', 'approved', ?, ?, ?)`).run(
      id, extra.business || `Pro ${seq}`, extra.bank === null ? null : (extra.bank || 'FNB'),
      extra.account === null ? null : (extra.account || '1234567890'),
      extra.branch === null ? null : (extra.branch || '250655'),
    );
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function order(fields) {
  const id = Number(db.prepare(`INSERT INTO orders (
      customer_id, supplier_id, service, package, vehicle, price_cents, address, lat, lng,
      supplier_price_cents, platform_fee_cents, callout_fee_cents, return_leg_fee_cents,
      payment_method, payment_status, status, completed_at, payment_ref)
    VALUES (?, ?, 'carwash', 'express', 'suv', ?, '1 Test Road', -33.9, 18.6,
      ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`).run(
    fields.customer_id, fields.supplier_id || null,
    fields.price_cents, fields.supplier_price_cents || 0, fields.platform_fee_cents || 0,
    fields.callout_fee_cents || 0, fields.return_leg_fee_cents || 0,
    fields.payment_method, fields.payment_status, fields.status,
    fields.completed_at === undefined ? null : fields.completed_at,
    fields.payment_ref || null,
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function earningCount(orderId) {
  return db.prepare(`SELECT COUNT(*) c FROM payout_entries WHERE order_id = ? AND kind = 'earning' AND voided_at IS NULL`).get(orderId).c;
}

function probe(extra) {
  const r = spawnSync(process.execPath, ['-e',
    `const p=require('./server/payments'); process.stdout.write(JSON.stringify({LIVE:p.LIVE,TEST:p.TEST_GATEWAY,detail:p.statusDetail()}))`], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', PAYMENT_PROVIDER: 'stitch', ...extra },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

function sign(body, id, ts) {
  const key = Buffer.from(SECRET.split('_')[1], 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

(async () => {
  setSetting('payout_hold_days', '0');
  const customer = user('customer', { name: 'A Customer' });
  const pro = user('supplier', { name: 'Sipho', business: '=Evil Pro', account: '62000000001', branch: '250655' });
  const other = user('supplier', { name: 'Aya', business: 'Aya Wash', account: null, bank: null, branch: null });

  // ---- what gets credited ----
  const cash = order({
    customer_id: customer.id, supplier_id: pro.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'cash', payment_status: 'collected', status: 'completed',
  });
  check('a cash job is not a payout credit', payouts.recordCardEarning(cash.id), null);
  check('the cash commission is still owed', balance.cashOwed(pro.id), 6300);

  const unpaid = order({
    customer_id: customer.id, supplier_id: pro.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'card', payment_status: 'unpaid', status: 'completed',
  });
  check('an unpaid card job is not credited', payouts.recordCardEarning(unpaid.id), null);

  const card = order({
    customer_id: customer.id, supplier_id: pro.id, price_cents: 40600,
    supplier_price_cents: 31300, platform_fee_cents: 6300, callout_fee_cents: 0, return_leg_fee_cents: 1500,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  // price here is not used by the ledger; the pro earns price-parts, not the customer total.
  const first = payouts.recordCardEarning(card.id);
  check('a paid completed card job is credited once', typeof first === 'number' && first > 0, true);
  check('the credit is price + callout + return trip', db.prepare('SELECT amount_cents FROM payout_entries WHERE id = ?').get(first).amount_cents, 32800);
  check('recording it again does nothing', payouts.recordCardEarning(card.id), null);
  check('still one credit', earningCount(card.id), 1);

  const demoCustomer = user('customer', { name: 'Demo', demo: true });
  const demoJob = order({
    customer_id: demoCustomer.id, supplier_id: pro.id, price_cents: 21600,
    supplier_price_cents: 18000, platform_fee_cents: 3600,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  check('a demo customer never creates a payout', payouts.recordCardEarning(demoJob.id), null);

  // ---- hold ----
  setSetting('payout_hold_days', '7');
  let threw = null;
  try { payouts.createBatch({ by: 'test' }); } catch (e) { threw = e; }
  check('earnings inside the hold are not payable', threw && threw.status, 400);
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(card.id);
  setSetting('payout_hold_days', '0');
  // put the matured job back to "now" so hold 0 includes it, and keep one held job aside
  const heldPro = user('supplier', { name: 'Held', business: 'Held Wash' });
  const heldJob = order({
    customer_id: customer.id, supplier_id: heldPro.id, price_cents: 21600,
    supplier_price_cents: 18000, platform_fee_cents: 3600,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  payouts.recordCardEarning(heldJob.id);
  setSetting('payout_hold_days', '7');
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(card.id);
  const view = payouts.preview(pro.id);
  check('matured earnings are payable and the new one is held', [view.payable_cents > 0, payouts.preview(heldPro.id).held_cents], [true, 18000]);

  // ---- set-off, the GETTING-PAID example: pro keeps 313, FreshAF keeps 63, cash debt 63 ----
  // The card credit above is 31300 + 1500 return. Use a clean pro for the published example.
  const example = user('supplier', { name: 'Example', business: 'Example Wash', account: '62000000099' });
  order({
    customer_id: customer.id, supplier_id: example.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'cash', payment_status: 'collected', status: 'completed',
    completed_at: "datetime('now', '-2 days')",
  });
  // completed_at was bound as a string literal, not SQL. Fix it.
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-2 days')
    WHERE supplier_id = ? AND payment_method = 'cash'`).run(example.id);
  const exampleCard = order({
    customer_id: customer.id, supplier_id: example.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(exampleCard.id);
  payouts.recordCardEarning(exampleCard.id);
  check('example pro owes the cash commission', balance.cashOwed(example.id), 6300);
  const noBankJob = order({
    customer_id: customer.id, supplier_id: other.id, price_cents: 12000,
    supplier_price_cents: 10000, platform_fee_cents: 2000,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(noBankJob.id);
  payouts.recordCardEarning(noBankJob.id);

  const batch = payouts.createBatch({ by: 'test' });
  const exampleLine = batch.lines.find((l) => l.supplier_id === example.id);
  const proLine = batch.lines.find((l) => l.supplier_id === pro.id);
  check('batch pays 31300 − 6300', exampleLine && [exampleLine.earnings_cents, exampleLine.setoff_cents, exampleLine.net_cents], [31300, 6300, 25000]);
  check('an open batch still shows as waiting to be paid', payouts.forSupplier(example.id).payout_due_cents, 25000);
  check('cash debt is cleared by the set-off', balance.cashOwed(example.id), 0);
  check('the first pro\'s return-trip credit is set off against their cash job', proLine && [proLine.earnings_cents, proLine.setoff_cents, proLine.net_cents], [32800, 6300, 26500]);
  check('a second batch is refused while one is open', (() => {
    try { payouts.createBatch({ by: 'test' }); return 'created'; } catch (e) { return e.status; }
  })(), 409);

  const csv = payouts.batchCsv(batch.id);
  check('CSV pays the net in rands', csv.body.includes('250.00'), true);
  check('CSV has the account number', csv.body.includes('62000000099'), true);
  check('CSV neutralises a formula in the name', csv.body.includes("'=Evil Pro"), true);
  check('a pro with no bank details is flagged, not given an account', csv.body.includes('no bank details'), true);

  // Refund of a job already inside the open batch is refused, and the batch can be voided.
  let refundBlock = null;
  try { payouts.applyRefund(exampleCard); } catch (e) { refundBlock = e.status; }
  check('refund inside an open batch is refused', refundBlock, 409);
  check('the order was not marked refunded', db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(exampleCard.id).payment_status, 'paid');

  const voided = payouts.voidBatch(batch.id);
  check('voided batch', voided.status, 'void');
  check('set-off comes back', balance.cashOwed(example.id), 6300);
  check('the credit can be batched again', payouts.preview(example.id).payable_cents, 31300);

  // ---- partial set-off, oldest job first, and the cash cap ----
  const partial = user('supplier', { name: 'Partial', business: 'Partial Wash' });
  const oldCash = order({
    customer_id: customer.id, supplier_id: partial.id, price_cents: 110000,
    supplier_price_cents: 100000, platform_fee_cents: 10000,
    payment_method: 'cash', payment_status: 'collected', status: 'completed',
  });
  const newCash = order({
    customer_id: customer.id, supplier_id: partial.id, price_cents: 330000,
    supplier_price_cents: 300000, platform_fee_cents: 30000,
    payment_method: 'cash', payment_status: 'collected', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-5 days') WHERE id = ?`).run(oldCash.id);
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-4 days') WHERE id = ?`).run(newCash.id);
  const partialCard = order({
    customer_id: customer.id, supplier_id: partial.id, price_cents: 18000,
    supplier_price_cents: 15000, platform_fee_cents: 3000,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(partialCard.id);
  payouts.recordCardEarning(partialCard.id);
  check('over the cap before the payout', balance.isBlocked(partial.id), true);
  // Drop everyone else's matured earnings out of this batch by parking them in the hold.
  setSetting('payout_hold_days', '7');
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(partialCard.id);
  const partialBatch = payouts.createBatch({ by: 'test' });
  const pLine = partialBatch.lines.find((l) => l.supplier_id === partial.id);
  check('pays nothing: the card earning is smaller than the cash debt', pLine && [pLine.net_cents, pLine.setoff_cents], [0, 15000]);
  check('oldest cash job is fully settled', db.prepare('SELECT fee_settled, fee_settled_cents FROM orders WHERE id = ?').get(oldCash.id), { fee_settled: 1, fee_settled_cents: 10000 });
  check('the next job is only partly settled', db.prepare('SELECT fee_settled, fee_settled_cents FROM orders WHERE id = ?').get(newCash.id), { fee_settled: 0, fee_settled_cents: 5000 });
  check('remaining cash debt', balance.cashOwed(partial.id), 25000);
  check('under the cap again', balance.isBlocked(partial.id), false);
  // R0 batch still needs a reference, and repeating the same reference is a no-op.
  const marked = payouts.markBatchPaid(partialBatch.id, { reference: 'set-off only' });
  check('marked paid', marked.status, 'paid');
  const again = payouts.markBatchPaid(partialBatch.id, { reference: 'set-off only' });
  check('same reference again is idempotent', again.status, 'paid');
  let clash = null;
  try { payouts.markBatchPaid(partialBatch.id, { reference: 'OTHER REF' }); } catch (e) { clash = e.status; }
  check('a different reference is refused', clash, 409);

  // ---- refund after the pro was paid: claw back off the next batch ----
  const clawPro = user('supplier', { name: 'Claw', business: 'Claw Wash' });
  const paidJob = order({
    customer_id: customer.id, supplier_id: clawPro.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(paidJob.id);
  payouts.recordCardEarning(paidJob.id);
  const paidBatch = payouts.createBatch({ by: 'test' });
  payouts.markBatchPaid(paidBatch.id, { reference: 'FNB 24 Nov' });
  const effect = payouts.applyRefund(db.prepare('SELECT * FROM orders WHERE id = ?').get(paidJob.id));
  check('refund after payout claws the earning back', effect.action, 'clawback');
  check('order is refunded', db.prepare('SELECT payment_status, refund_due_cents FROM orders WHERE id = ?').get(paidJob.id), { payment_status: 'refunded', refund_due_cents: 0 });
  const nextJob = order({
    customer_id: customer.id, supplier_id: clawPro.id, price_cents: 24000,
    supplier_price_cents: 20000, platform_fee_cents: 4000,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(nextJob.id);
  payouts.recordCardEarning(nextJob.id);
  const clawBatch = payouts.createBatch({ by: 'test' });
  const clawLine = clawBatch.lines.find((l) => l.supplier_id === clawPro.id);
  check('next payout is the new job minus the clawback', clawLine && [clawLine.earnings_cents, clawLine.clawback_cents, clawLine.net_cents], [20000, 20000, 0]);
  check('the rest of the clawback is still open', payouts.preview(clawPro.id).clawback_cents, 11300);
  payouts.markBatchPaid(clawBatch.id, { reference: 'FNB claw' });

  // A refund before any batch voids the credit.
  const fresh = user('supplier', { name: 'Fresh', business: 'Fresh Wash' });
  const voidJob = order({
    customer_id: customer.id, supplier_id: fresh.id, price_cents: 21600,
    supplier_price_cents: 18000, platform_fee_cents: 3600,
    payment_method: 'card', payment_status: 'paid', status: 'completed',
  });
  db.prepare(`UPDATE orders SET completed_at = datetime('now', '-8 days') WHERE id = ?`).run(voidJob.id);
  payouts.recordCardEarning(voidJob.id);
  const voidedEarning = payouts.applyRefund(db.prepare('SELECT * FROM orders WHERE id = ?').get(voidJob.id));
  check('refund before payout voids the credit', voidedEarning.action, 'voided');
  check('nothing left to pay that pro', payouts.preview(fresh.id).payable_cents, 0);

  // completeOrder is the hook the pro's "job done" button uses.
  const viaHook = order({
    customer_id: customer.id, supplier_id: fresh.id, price_cents: 21600,
    supplier_price_cents: 18000, platform_fee_cents: 3600,
    payment_method: 'card', payment_status: 'paid', status: 'in_progress',
  });
  require('../server/routes/supplier').completeOrder(viaHook);
  check('closing the job credits it', earningCount(viaHook.id), 1);
  check('closing it twice does not credit it twice', (() => {
    require('../server/routes/supplier').completeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(viaHook.id));
    return earningCount(viaHook.id);
  })(), 1);

  // ---- live-card lock ----
  const blocked = probe({
    PAYMENTS_LIVE: 'true', STITCH_CLIENT_ID: 'live-client', STITCH_CLIENT_SECRET: 'secret',
  });
  check('live keys and PAYMENTS_LIVE do not charge without PAYOUTS_READY', blocked.LIVE, false);
  check('the readiness text names the flag', blocked.detail.includes('PAYOUTS_READY'), true);
  const armed = probe({
    PAYMENTS_LIVE: 'true', PAYOUTS_READY: 'true', STITCH_CLIENT_ID: 'live-client', STITCH_CLIENT_SECRET: 'secret',
  });
  check('both flags with live keys turns card on', armed.LIVE, true);
  const rehearsal = probe({
    PAYMENTS_LIVE: 'true', STITCH_CLIENT_ID: 'test-client', STITCH_CLIENT_SECRET: 'secret',
  });
  check('test keys still rehearse without PAYOUTS_READY', [rehearsal.LIVE, rehearsal.TEST], [false, true]);
  const off = probe({
    PAYMENTS_LIVE: '', PAYOUTS_READY: 'true', STITCH_CLIENT_ID: 'live-client', STITCH_CLIENT_SECRET: 'secret',
  });
  check('PAYOUTS_READY alone does not turn card on', off.LIVE, false);
  const payfast = spawnSync(process.execPath, ['-e',
    `const p=require('./server/payments'); process.stdout.write(JSON.stringify({LIVE:p.LIVE}))`], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
      PAYMENT_PROVIDER: 'payfast', PAYMENTS_LIVE: 'true',
      PAYFAST_MERCHANT_ID: '10000100', PAYFAST_MERCHANT_KEY: 'testkey',
    },
    encoding: 'utf8',
  });
  check('PayFast is unchanged by the payout lock', JSON.parse(payfast.stdout).LIVE, true);

  // ---- over HTTP: admin routes, supplier earnings, webhook idempotency ----
  const admin = user('admin', { name: 'Payout Admin' });
  const adminToken = auth.signUser(admin);
  const proToken = auth.signUser(pro);
  const link = 'LINK-PAYOUT-' + Date.now();
  const hookOrder = order({
    customer_id: customer.id, supplier_id: pro.id, price_cents: 37600,
    supplier_price_cents: 31300, platform_fee_cents: 6300,
    payment_method: 'card', payment_status: 'unpaid', status: 'completed',
    payment_ref: link,
  });

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PORT), FRESHAF_DATA_DIR: DATA_DIR, JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_API_KEY: '', PAYMENTS_LIVE: '', PAYOUTS_READY: '', STITCH_WEBHOOK_SECRET: SECRET,
      PAYMENT_PROVIDER: 'stitch', SMTP_PASS: '', WHATSAPP_TOKEN: '', NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const call = async (token, p, method = 'GET', body) => {
    const headers = { 'X-FreshAF-Client': 'native' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return {
      status: r.status,
      text: type.includes('json') ? null : await r.text(),
      json: type.includes('json') ? await r.json().catch(() => null) : null,
      disposition: r.headers.get('content-disposition'),
    };
  };

  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    let r = await call(null, '/api/admin/payouts');
    check('payouts require a sign-in', r.status, 401);
    r = await call(proToken, '/api/admin/payouts');
    check('a pro cannot open the payout run', r.status, 403);
    r = await call(adminToken, '/api/admin/payouts');
    check('admin sees a manual payout run', r.json && r.json.mode === 'manual' && r.json.stitch_can_pay_pros === false, true);
    r = await call(proToken, '/api/supplier/earnings');
    check('the pro earnings screen includes the payout fields', typeof r.json.payout_due_cents === 'number' && typeof r.json.payout_hold_days === 'number', true);

    const body = JSON.stringify({ amount: 37600, id: 'pay_' + link, linkId: link, status: 'PAID', type: 'LINK' });
    const ts = Math.floor(Date.now() / 1000);
    const postHook = (id) => fetch(`${BASE}/api/payments/stitch/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(body, id, ts) },
      body,
    });
    const firstHook = await postHook('msg_payout_1');
    const secondHook = await postHook('msg_payout_2');
    check('webhook accepted twice', [firstHook.status, secondHook.status], [200, 200]);
    check('the completed job is credited by the webhook, once', earningCount(hookOrder.id), 1);

    // Park every other matured credit so this HTTP batch is only the webhook job's pro... 
    // The webhook job may still be inside the hold (completed_at is now, hold is 7).
    setSetting('payout_hold_days', '0');
    r = await call(adminToken, '/api/admin/payouts/batches', 'POST', {});
    check('admin can create a batch', r.status, 200);
    const httpBatch = r.json.batch;
    r = await call(adminToken, `/api/admin/payouts/batches/${httpBatch.id}/csv`);
    check('CSV download is a file', r.status === 200 && (r.disposition || '').includes(`freshaf-payout-batch-${httpBatch.id}.csv`), true);
    check('the download contains an account number', (r.text || '').includes('62000000001') || (r.text || '').includes('62000000099'), true);
    r = await call(adminToken, `/api/admin/payouts/batches/${httpBatch.id}/paid`, 'POST', { reference: 'FNB http' });
    check('admin can mark the batch paid', r.json && r.json.batch.status, 'paid');
    r = await call(adminToken, `/api/admin/payouts/batches/${httpBatch.id}/paid`, 'POST', { reference: 'FNB http' });
    check('marking it paid again with the same reference is ok', r.status, 200);
    r = await call(adminToken, `/api/admin/payouts/batches/${httpBatch.id}/void`, 'POST', {});
    check('a paid batch cannot be voided', r.status, 409);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
    if (passed !== checks.length) {
      console.log('\n--- server log ---\n' + log.slice(-2000));
      process.exitCode = 1;
    }
  } finally {
    await stopServer(server);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
