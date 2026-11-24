// What FreshAF owes a pro, and the EFT that pays it.
//
// Stitch Express cannot do this. The account is a card acquirer: the customer pays
// FreshAF, and the only "withdrawal" in the API moves FreshAF's own Stitch balance
// into FreshAF's own verified bank account. There is no beneficiary, no split, and
// no disbursement to a pro. The marketplace product that pays pros is a different
// API, and this account is not on it. Wiring withdrawal() up as a "payout" would
// dump the merchant balance into FreshAF's FNB account and pay nobody.
//
// So this is the payout run, done by hand and recorded here:
//   1. A paid card job, once completed, credits the pro with their own price plus
//      the callout plus any laundry return trip. FreshAF's margin was added on top
//      at booking and is not part of this number. Same figure as supplier_earns_cents
//      in server/dispatch.js.
//   2. The credit sits for payout_hold_days (default 7) so a refund can land first.
//   3. Creating a batch sets cash-job commission off against matured credits
//      (server/balance.js settleUpTo) and freezes the lines.
//   4. The admin downloads a CSV, pays it at the bank, and marks the batch paid
//      with the bank reference. Marking paid does not move money.
//
// Webhook retries and a double completion hit a unique index, so a job is credited
// once. A refund voids an unbatched credit, and claws a paid one back off the next
// batch. Demo accounts are never credited: a reviewer's job is not a debt.
const { db, getSetting, setSetting } = require('./db');
const balance = require('./balance');
const secrets = require('./secrets');

const NOTICE = 'Stitch Express pays FreshAF\'s own bank account only. It cannot pay a pro. '
  + 'This screen is the payout run: card earnings, minus cash the pro is still holding, '
  + 'exported as a CSV for the bank. Mark paid only after the transfer has actually gone.';

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    throw e;
  }
}

function isUnique(e) {
  return /UNIQUE constraint failed/i.test(e?.message || '');
}

function holdDays() {
  const n = Number(getSetting('payout_hold_days', '7'));
  if (!Number.isFinite(n)) return 7;
  return Math.min(30, Math.max(0, Math.round(n)));
}

function setHoldDays(days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 0 || n > 30) {
    throw fail(400, 'Hold must be a whole number of days from 0 to 30');
  }
  setSetting('payout_hold_days', n);
  return n;
}

// What the pro is paid for one job. Not the customer's total: the margin stays here.
function earnsCents(order) {
  return (order.supplier_price_cents || 0) + (order.callout_fee_cents || 0) + (order.return_leg_fee_cents || 0);
}

function isDemoOrder(order) {
  const row = db.prepare(`SELECT
      (SELECT is_demo FROM users WHERE id = ?) AS customer_demo,
      (SELECT is_demo FROM users WHERE id = ?) AS supplier_demo`)
    .get(order.customer_id, order.supplier_id);
  return !!(row?.customer_demo || row?.supplier_demo);
}

// Credit a completed, paid card job. Safe to call twice, and from a webhook retry.
// Returns the entry id, or null when the job is not something we owe a pro for.
function recordCardEarning(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.supplier_id) return null;
  if (order.payment_method !== 'card' || order.payment_status !== 'paid') return null;
  if (order.status !== 'completed') return null;
  if ((order.refund_due_cents || 0) > 0) return null;
  if (isDemoOrder(order)) return null;
  const gross = earnsCents(order);
  if (gross <= 0) return null;
  try {
    const info = db.prepare(`INSERT INTO payout_entries (supplier_id, order_id, kind, amount_cents, note)
      VALUES (?, ?, 'earning', ?, ?)`).run(order.supplier_id, order.id, gross, `Card job #${order.id}`);
    return Number(info.lastInsertRowid);
  } catch (e) {
    if (isUnique(e)) return null;
    throw e;
  }
}

// Pick up card jobs that completed before this ledger existed, or whose insert failed
// the first time. Idempotent: the unique index ignores anything already recorded.
function sync() {
  const rows = db.prepare(`
    SELECT o.id FROM orders o
    JOIN users c ON c.id = o.customer_id
    JOIN users s ON s.id = o.supplier_id
    WHERE o.payment_method = 'card' AND o.payment_status = 'paid' AND o.status = 'completed'
      AND COALESCE(o.refund_due_cents, 0) = 0
      AND c.is_demo = 0 AND s.is_demo = 0
      AND NOT EXISTS (
        SELECT 1 FROM payout_entries e WHERE e.order_id = o.id AND e.kind = 'earning')
  `).all();
  let added = 0;
  for (const r of rows) {
    if (recordCardEarning(r.id)) added += 1;
  }
  if (added) console.log(`[FreshAF] Recorded ${added} completed card job(s) on the payout ledger.`);
  return added;
}

// A refund of a card job. Unbatched earnings are voided. Earnings already in an open
// batch must be taken out by voiding that batch first — changing a CSV someone may
// be about to upload is worse than a clear error. Earnings already paid become a
// clawback on the next batch.
function onRefund(orderId) {
  const earning = db.prepare(`
    SELECT e.*, b.status AS batch_status, b.id AS batch_id
    FROM payout_entries e
    LEFT JOIN payouts p ON p.id = e.payout_id
    LEFT JOIN payout_batches b ON b.id = p.batch_id
    WHERE e.order_id = ? AND e.kind = 'earning'`).get(orderId);
  if (!earning || earning.voided_at) return { action: 'none' };
  if (earning.payout_id && earning.batch_status === 'open') {
    throw fail(409, `This job is in open payout batch #${earning.batch_id}. Void that batch if it has not been paid, then record the refund.`);
  }
  if (!earning.payout_id) {
    db.prepare(`UPDATE payout_entries SET voided_at = datetime('now'),
      note = TRIM(COALESCE(note, '') || ' voided: refunded') WHERE id = ?`).run(earning.id);
    return { action: 'voided', cents: earning.amount_cents };
  }
  const existing = db.prepare(`SELECT id, amount_cents FROM payout_entries
    WHERE order_id = ? AND kind = 'clawback'`).get(orderId);
  if (existing) return { action: 'already', cents: -existing.amount_cents };
  db.prepare(`INSERT INTO payout_entries (supplier_id, order_id, kind, amount_cents, note)
    VALUES (?, ?, 'clawback', ?, ?)`).run(
    earning.supplier_id, orderId, -earning.amount_cents,
    `Refund of card job #${orderId} after it was paid to the pro`,
  );
  return { action: 'clawback', cents: earning.amount_cents };
}

function openEarnings(supplierId, matured) {
  const days = holdDays();
  const cmp = matured ? '<=' : '>';
  return db.prepare(`
    SELECT e.id, e.amount_cents, e.order_id
    FROM payout_entries e
    JOIN orders o ON o.id = e.order_id
    WHERE e.supplier_id = ? AND e.kind = 'earning' AND e.voided_at IS NULL AND e.payout_id IS NULL
      AND o.completed_at IS NOT NULL
      AND o.completed_at ${cmp} datetime('now', ?)
    ORDER BY o.completed_at, e.id`).all(supplierId, `-${days} days`);
}

function openClawbacks(supplierId) {
  return db.prepare(`
    SELECT id, order_id, amount_cents, applied_cents
    FROM payout_entries
    WHERE supplier_id = ? AND kind = 'clawback' AND voided_at IS NULL
      AND applied_cents < -amount_cents
    ORDER BY id`).all(supplierId);
}

function clawbackRemaining(row) {
  return Math.max(0, -row.amount_cents - (row.applied_cents || 0));
}

function bankOf(supplierId) {
  const row = db.prepare(`
    SELECT s.bank_name, s.bank_account, s.bank_branch, s.business_name, u.name, u.is_demo
    FROM suppliers s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`).get(supplierId);
  if (!row) return null;
  const account = secrets.decryptField(row.bank_account);
  const branch = secrets.decryptField(row.bank_branch);
  const unreadable = row.bank_account && account == null;
  return {
    business_name: row.business_name,
    name: row.name,
    is_demo: !!row.is_demo,
    bank_name: row.bank_name || '',
    account: account || '',
    branch: branch || '',
    has_bank: !!(row.bank_name && account),
    bank_unreadable: !!unreadable,
    masked: secrets.maskTail(row.bank_account),
    branch_masked: secrets.maskTail(row.bank_branch),
  };
}

// What a payout created right now would do. Does not write.
function preview(supplierId) {
  const matured = openEarnings(supplierId, true);
  const held = openEarnings(supplierId, false);
  const claws = openClawbacks(supplierId);
  const payable = matured.reduce((s, e) => s + e.amount_cents, 0);
  const heldCents = held.reduce((s, e) => s + e.amount_cents, 0);
  const clawback = claws.reduce((s, c) => s + clawbackRemaining(c), 0);
  const afterClaw = Math.max(0, payable - clawback);
  const cash = balance.cashOwed(supplierId);
  // Set-off only against money we would actually pay. A clawback larger than the
  // matured earnings pays nothing and does not also eat the cash debt — that debt
  // stays collectable on its own.
  const setoff = Math.min(afterClaw, Math.max(0, cash));
  const net = afterClaw - setoff;
  const bank = bankOf(supplierId);
  return {
    supplier_id: supplierId,
    name: bank?.name || null,
    business_name: bank?.business_name || null,
    is_demo: !!bank?.is_demo,
    payable_cents: payable,
    held_cents: heldCents,
    clawback_cents: clawback,
    cash_owed_cents: cash,
    setoff_cents: payable > 0 ? setoff : 0,
    net_cents: payable > 0 ? net : 0,
    has_bank: !!bank?.has_bank,
    bank_unreadable: !!bank?.bank_unreadable,
    bank_name: bank?.bank_name || null,
    bank_account_masked: bank?.masked || null,
    matured,
    claws,
  };
}

function statements() {
  const ids = db.prepare(`
    SELECT DISTINCT supplier_id AS id FROM payout_entries WHERE voided_at IS NULL
    UNION
    SELECT supplier_id FROM orders
    WHERE status = 'completed' AND payment_method = 'cash' AND fee_settled = 0 AND supplier_id IS NOT NULL
  `).all();
  return ids.map((r) => preview(r.id)).filter((s) => s
    && !s.is_demo
    && (s.payable_cents || s.held_cents || s.clawback_cents || s.cash_owed_cents));
}

function forSupplier(supplierId) {
  const v = preview(supplierId);
  // An open batch has already taken the earnings off the preview, but the pro has
  // not been paid until the batch is marked paid. They should still see that money.
  const pending = db.prepare(`SELECT COALESCE(SUM(net_cents), 0) AS c FROM payouts
    WHERE supplier_id = ? AND status = 'pending'`).get(supplierId).c;
  return {
    payout_due_cents: v.net_cents + pending,
    payout_held_cents: v.held_cents,
    payout_hold_days: holdDays(),
    payout_setoff_cents: v.setoff_cents,
    payout_clawback_cents: v.clawback_cents,
  };
}

// Freeze one pro's matured earnings into a payout line. Caller is inside a transaction.
function allocate(supplierId) {
  const view = preview(supplierId);
  if (view.is_demo || view.payable_cents <= 0) return null;
  let room = view.payable_cents;
  let clawApplied = 0;
  const links = view.matured.map((e) => ({ entry_id: e.id, amount_cents: e.amount_cents, kind: 'earning' }));
  for (const c of view.claws) {
    if (room <= 0) break;
    const rem = clawbackRemaining(c);
    const take = Math.min(rem, room);
    if (take <= 0) continue;
    db.prepare('UPDATE payout_entries SET applied_cents = applied_cents + ? WHERE id = ?').run(take, c.id);
    links.push({ entry_id: c.id, amount_cents: take, kind: 'clawback', full: take === rem });
    room -= take;
    clawApplied += take;
  }
  const after = view.payable_cents - clawApplied;
  const setoff = Math.min(after, Math.max(0, balance.cashOwed(supplierId)));
  return {
    supplier_id: supplierId,
    earnings_cents: view.payable_cents,
    clawback_cents: clawApplied,
    setoff_cents: setoff,
    net_cents: after - setoff,
    has_bank: view.has_bank,
    links,
  };
}

function createBatch({ by } = {}) {
  return tx(() => {
    sync();
    const open = db.prepare(`SELECT id FROM payout_batches WHERE status = 'open'`).get();
    if (open) throw fail(409, `Payout batch #${open.id} is still open. Mark it paid or void it first.`);
    const suppliers = db.prepare(`
      SELECT DISTINCT supplier_id AS id FROM payout_entries
      WHERE voided_at IS NULL AND kind = 'earning' AND payout_id IS NULL`).all();
    const lines = [];
    for (const s of suppliers) lines.push(allocate(s.id));
    const ready = lines.filter(Boolean);
    if (!ready.length) {
      throw fail(400, `Nothing is ready to pay. Card earnings are held for ${holdDays()} day(s), then show up here.`);
    }
    const totals = ready.reduce((t, l) => ({
      earnings_cents: t.earnings_cents + l.earnings_cents,
      clawback_cents: t.clawback_cents + l.clawback_cents,
      setoff_cents: t.setoff_cents + l.setoff_cents,
      net_cents: t.net_cents + l.net_cents,
    }), { earnings_cents: 0, clawback_cents: 0, setoff_cents: 0, net_cents: 0 });
    const batchId = Number(db.prepare(`
      INSERT INTO payout_batches (created_by, earnings_cents, clawback_cents, setoff_cents, net_cents)
      VALUES (?, ?, ?, ?, ?)`).run(by || null, totals.earnings_cents, totals.clawback_cents, totals.setoff_cents, totals.net_cents)
      .lastInsertRowid);
    const insertPayout = db.prepare(`
      INSERT INTO payouts (batch_id, supplier_id, earnings_cents, clawback_cents, setoff_cents, net_cents, has_bank)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertLink = db.prepare('INSERT INTO payout_links (payout_id, entry_id, amount_cents) VALUES (?, ?, ?)');
    const claim = db.prepare('UPDATE payout_entries SET payout_id = ? WHERE id = ?');
    const insertSetoff = db.prepare('INSERT INTO payout_setoffs (payout_id, order_id, amount_cents) VALUES (?, ?, ?)');
    for (const line of ready) {
      const payoutId = Number(insertPayout.run(
        batchId, line.supplier_id, line.earnings_cents, line.clawback_cents,
        line.setoff_cents, line.net_cents, line.has_bank ? 1 : 0,
      ).lastInsertRowid);
      for (const link of line.links) {
        insertLink.run(payoutId, link.entry_id, link.amount_cents);
        if (link.kind === 'earning' || link.full) claim.run(payoutId, link.entry_id);
      }
      if (line.setoff_cents > 0) {
        const settled = balance.settleUpTo(line.supplier_id, line.setoff_cents);
        if (settled.cleared_cents !== line.setoff_cents) {
          throw fail(409, 'The cash balance changed while the batch was being built. Nothing was saved — try again.');
        }
        for (const a of settled.allocations) insertSetoff.run(payoutId, a.order_id, a.amount_cents);
      }
    }
    console.log(`[FreshAF] Payout batch #${batchId}: pay R${(totals.net_cents / 100).toFixed(2)} `
      + `after R${(totals.setoff_cents / 100).toFixed(2)} cash set-off `
      + `(${ready.length} pro${ready.length === 1 ? '' : 's'}).`);
    return getBatch(batchId);
  });
}

function lineView(row) {
  const bank = bankOf(row.supplier_id);
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    name: bank?.name || null,
    business_name: bank?.business_name || null,
    earnings_cents: row.earnings_cents,
    clawback_cents: row.clawback_cents,
    setoff_cents: row.setoff_cents,
    net_cents: row.net_cents,
    has_bank: !!row.has_bank,
    bank_unreadable: !!bank?.bank_unreadable,
    bank_name: bank?.bank_name || null,
    bank_account_masked: bank?.masked || null,
    status: row.status,
    reference: row.reference,
    paid_at: row.paid_at,
  };
}

function getBatch(batchId) {
  const batch = db.prepare('SELECT * FROM payout_batches WHERE id = ?').get(batchId);
  if (!batch) return null;
  const lines = db.prepare('SELECT * FROM payouts WHERE batch_id = ? ORDER BY id').all(batchId).map(lineView);
  return { ...batch, lines };
}

function listBatches(limit = 20) {
  return db.prepare('SELECT * FROM payout_batches ORDER BY id DESC LIMIT ?').all(limit)
    .map((b) => getBatch(b.id));
}

function overview() {
  sync();
  const rows = statements();
  const totals = rows.reduce((t, s) => ({
    payable_cents: t.payable_cents + s.payable_cents,
    held_cents: t.held_cents + s.held_cents,
    net_cents: t.net_cents + s.net_cents,
    cash_owed_cents: t.cash_owed_cents + s.cash_owed_cents,
  }), { payable_cents: 0, held_cents: 0, net_cents: 0, cash_owed_cents: 0 });
  let cardLive = false;
  try { cardLive = !!require('./payments').LIVE; } catch { /* payments not loadable in a unit test */ }
  return {
    mode: 'manual',
    stitch_can_pay_pros: false,
    notice: NOTICE,
    hold_days: holdDays(),
    payouts_ready: process.env.PAYOUTS_READY === 'true',
    card_live: cardLive,
    totals,
    pros: rows.map((s) => ({
      supplier_id: s.supplier_id,
      name: s.name,
      business_name: s.business_name,
      payable_cents: s.payable_cents,
      held_cents: s.held_cents,
      clawback_cents: s.clawback_cents,
      cash_owed_cents: s.cash_owed_cents,
      setoff_cents: s.setoff_cents,
      net_cents: s.net_cents,
      has_bank: s.has_bank,
      bank_unreadable: s.bank_unreadable,
      bank_name: s.bank_name,
      bank_account_masked: s.bank_account_masked,
    })),
    batches: listBatches(),
  };
}

function cleanRef(reference) {
  const ref = String(reference || '').trim().replace(/\s+/g, ' ');
  if (ref.length < 3 || ref.length > 40) throw fail(400, 'Enter the bank reference (3 to 40 characters).');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(ref)) {
    throw fail(400, 'The reference can only use letters, numbers, spaces, dots, slashes and hyphens.');
  }
  return ref;
}

function markBatchPaid(batchId, { reference } = {}) {
  const ref = cleanRef(reference);
  return tx(() => {
    const batch = db.prepare('SELECT * FROM payout_batches WHERE id = ?').get(batchId);
    if (!batch) throw fail(404, 'Payout batch not found');
    if (batch.status === 'void') throw fail(409, 'That batch was voided');
    if (batch.status === 'paid') {
      if (batch.reference === ref) return getBatch(batchId);
      throw fail(409, `Already marked paid with reference ${batch.reference}`);
    }
    db.prepare(`UPDATE payouts SET status = 'paid', reference = ?, paid_at = datetime('now')
      WHERE batch_id = ? AND status = 'pending'`).run(ref, batchId);
    db.prepare(`UPDATE payout_batches SET status = 'paid', reference = ?, paid_at = datetime('now')
      WHERE id = ?`).run(ref, batchId);
    console.log(`[FreshAF] Payout batch #${batchId} marked paid, reference ${ref}.`);
    return getBatch(batchId);
  });
}

function markPayoutPaid(payoutId, { reference } = {}) {
  const ref = cleanRef(reference);
  return tx(() => {
    const line = db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
    if (!line) throw fail(404, 'Payout not found');
    const batch = db.prepare('SELECT * FROM payout_batches WHERE id = ?').get(line.batch_id);
    if (!batch || batch.status === 'void' || line.status === 'void') throw fail(409, 'That payout was voided');
    if (line.status === 'paid') {
      if (line.reference === ref) return getBatch(line.batch_id);
      throw fail(409, `Already marked paid with reference ${line.reference}`);
    }
    db.prepare(`UPDATE payouts SET status = 'paid', reference = ?, paid_at = datetime('now') WHERE id = ?`)
      .run(ref, line.id);
    const left = db.prepare(`SELECT COUNT(*) c FROM payouts WHERE batch_id = ? AND status = 'pending'`).get(line.batch_id).c;
    if (!left && batch.status === 'open') {
      const refs = db.prepare(`SELECT DISTINCT reference FROM payouts WHERE batch_id = ? AND status = 'paid'`).all(line.batch_id);
      const batchRef = refs.length === 1 ? refs[0].reference : 'see lines';
      db.prepare(`UPDATE payout_batches SET status = 'paid', reference = ?, paid_at = datetime('now') WHERE id = ?`)
        .run(batchRef, line.batch_id);
    }
    return getBatch(line.batch_id);
  });
}

function voidBatch(batchId) {
  return tx(() => {
    const batch = db.prepare('SELECT * FROM payout_batches WHERE id = ?').get(batchId);
    if (!batch) throw fail(404, 'Payout batch not found');
    if (batch.status === 'void') return getBatch(batchId);
    if (batch.status !== 'open') throw fail(409, 'A batch that has been marked paid cannot be voided.');
    const paid = db.prepare(`SELECT COUNT(*) c FROM payouts WHERE batch_id = ? AND status = 'paid'`).get(batchId).c;
    if (paid) throw fail(409, 'Part of this batch is already marked paid, so it cannot be voided.');
    const lines = db.prepare('SELECT id FROM payouts WHERE batch_id = ? AND status = ?').all(batchId, 'pending');
    for (const line of lines) {
      const links = db.prepare('SELECT entry_id, amount_cents FROM payout_links WHERE payout_id = ?').all(line.id);
      for (const link of links) {
        const entry = db.prepare('SELECT kind FROM payout_entries WHERE id = ?').get(link.entry_id);
        if (!entry) continue;
        if (entry.kind === 'clawback') {
          db.prepare(`UPDATE payout_entries
            SET applied_cents = MAX(0, applied_cents - ?), payout_id = NULL WHERE id = ?`)
            .run(link.amount_cents, link.entry_id);
        } else {
          db.prepare('UPDATE payout_entries SET payout_id = NULL WHERE id = ?').run(link.entry_id);
        }
      }
      const allocs = db.prepare('SELECT order_id, amount_cents FROM payout_setoffs WHERE payout_id = ?').all(line.id);
      balance.restoreSettlement(allocs);
      db.prepare('DELETE FROM payout_setoffs WHERE payout_id = ?').run(line.id);
      db.prepare('DELETE FROM payout_links WHERE payout_id = ?').run(line.id);
      db.prepare(`UPDATE payouts SET status = 'void' WHERE id = ?`).run(line.id);
    }
    db.prepare(`UPDATE payout_batches SET status = 'void' WHERE id = ?`).run(batchId);
    console.log(`[FreshAF] Payout batch #${batchId} voided. Cash set-off restored.`);
    return getBatch(batchId);
  });
}

function csvCell(value) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  // A cell that starts with one of these is a formula when Excel opens the file.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function statementRef(batchId, payoutId) {
  return `FAF${batchId}-${payoutId}`.slice(0, 20);
}

// Bank-upload file. Account numbers are decrypted here and nowhere else in the
// response: the on-screen list stays masked. Rows of R0 are omitted — there is
// nothing to transfer; the set-off already happened.
function batchCsv(batchId) {
  const batch = getBatch(batchId);
  if (!batch) throw fail(404, 'Payout batch not found');
  if (batch.status === 'void') throw fail(409, 'That batch was voided');
  const header = ['beneficiary_name', 'bank_name', 'branch_code', 'account_number', 'amount_zar',
    'statement_reference', 'payout_id', 'supplier_id', 'note'];
  const lines = [header.join(',')];
  for (const line of batch.lines) {
    if (!(line.net_cents > 0) || line.status === 'void') continue;
    const bank = bankOf(line.supplier_id);
    const notes = [];
    if (!bank?.has_bank) notes.push(bank?.bank_unreadable ? 'account unreadable — DATA_KEY missing' : 'no bank details — do not upload this row');
    lines.push([
      bank?.business_name || bank?.name || `Pro ${line.supplier_id}`,
      bank?.bank_name || '',
      bank?.branch || '',
      bank?.account || '',
      (line.net_cents / 100).toFixed(2),
      statementRef(batch.id, line.id),
      line.id,
      line.supplier_id,
      notes.join('; '),
    ].map(csvCell).join(','));
  }
  return { filename: `freshaf-payout-batch-${batch.id}.csv`, body: `\uFEFF${lines.join('\r\n')}\r\n` };
}

// Mark the order refunded and adjust the ledger together, so a failed ledger write
// cannot leave the order looking refunded while the pro is still owed.
function applyRefund(order) {
  return tx(() => {
    const effect = onRefund(order.id);
    db.prepare(`UPDATE orders SET payment_status = 'refunded', refunded_at = datetime('now'),
      refund_due_cents = 0 WHERE id = ?`).run(order.id);
    return effect;
  });
}

function readyForLiveCard() {
  return process.env.PAYOUTS_READY === 'true';
}

module.exports = {
  NOTICE, holdDays, setHoldDays, earnsCents, recordCardEarning, sync, onRefund,
  preview, statements, forSupplier, createBatch, getBatch, listBatches, overview,
  markBatchPaid, markPayoutPaid, voidBatch, batchCsv, applyRefund, readyForLiveCard,
};
