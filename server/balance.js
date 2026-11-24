// What a pro owes FreshAF from cash jobs, and the cap that stops it running away.
//
// On a cash job the pro collects the whole selling price at the door. Their own price is
// theirs; the rest is FreshAF's money that they are holding as our collection agent. This
// is the Uber mechanic: the balance accrues against the pro's account, it is set off
// against anything we owe them, and once it passes a cap they cannot go online or be
// offered work until they settle.
const { db, getSetting } = require('./db');

// FreshAF's money in the pro's hand on one cash job: our fee, less any rewards the customer
// spent, because rewards come off what the pro collects at the door (found 21 Nov 2026: a
// R10.80 rewards spend billed the pro R10.80 they never received). fee_settled_cents is the
// part already set off against a card payout, so a payout can clear some of a job without
// forgiving the rest.
const SHARE = 'platform_fee_cents - COALESCE(points_used_cents, 0) - COALESCE(fee_settled_cents, 0)';
// Matches the sum shown to the pro in their earnings screen.
const OWED_SQL = `
  SELECT COALESCE(SUM(${SHARE}), 0) AS c
  FROM orders
  WHERE supplier_id = ? AND status = 'completed'
    AND payment_method = 'cash' AND fee_settled = 0`;

function cashOwed(userId) {
  return db.prepare(OWED_SQL).get(userId).c;
}

function cap() {
  return Number(getSetting('cash_owed_cap_cents', '30000'));
}

function isBlocked(userId) {
  return cashOwed(userId) >= cap();
}

// One shape for every caller, so the pro app, the dispatcher and the admin all agree.
function status(userId) {
  const owed = cashOwed(userId);
  const limit = cap();
  return {
    cash_owed_cents: owed,
    cash_cap_cents: limit,
    cash_blocked: owed >= limit,
    cash_remaining_cents: Math.max(0, limit - owed),
  };
}

function blockedMessage(userId) {
  const { cash_owed_cents: owed, cash_cap_cents: limit } = status(userId);
  return `You are holding R${(owed / 100).toFixed(2)} of FreshAF's money from cash jobs, which is over the R${(limit / 100).toFixed(2)} limit. Settle it to start taking jobs again.`;
}

// Settle what a pro owes. Returns the amount cleared, so the caller can record it.
// Used by the admin when a pro pays the cash in. The payout run uses settleUpTo instead,
// because a card payout may cover only part of the debt.
function settle(userId) {
  const owed = cashOwed(userId);
  if (!owed) return 0;
  db.prepare(`
    UPDATE orders SET
      fee_settled_cents = platform_fee_cents - COALESCE(points_used_cents, 0),
      fee_settled = 1
    WHERE supplier_id = ? AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0`).run(userId);
  return owed;
}

// Set off up to `cents` of cash debt, oldest job first. A job that is only partly
// covered stays open with fee_settled_cents increased, so the rest is still owed.
// Returns the allocations so a voided payout can put the same cents back.
function settleUpTo(userId, cents) {
  const want = Math.round(Number(cents) || 0);
  if (want <= 0) return { cleared_cents: 0, allocations: [] };
  const rows = db.prepare(`
    SELECT id, platform_fee_cents, points_used_cents, fee_settled_cents
    FROM orders
    WHERE supplier_id = ? AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0
    ORDER BY completed_at, id`).all(userId);
  let left = want;
  const allocations = [];
  const upd = db.prepare('UPDATE orders SET fee_settled_cents = ?, fee_settled = ? WHERE id = ?');
  for (const row of rows) {
    if (left <= 0) break;
    const share = (row.platform_fee_cents || 0) - (row.points_used_cents || 0) - (row.fee_settled_cents || 0);
    if (share <= 0) {
      upd.run(row.fee_settled_cents || 0, 1, row.id);
      continue;
    }
    const take = Math.min(share, left);
    const settled = (row.fee_settled_cents || 0) + take;
    upd.run(settled, take === share ? 1 : 0, row.id);
    allocations.push({ order_id: row.id, amount_cents: take });
    left -= take;
  }
  return { cleared_cents: want - left, allocations };
}

// Undo a set-off. Used when an unpaid payout batch is voided.
function restoreSettlement(allocations) {
  const get = db.prepare('SELECT fee_settled_cents FROM orders WHERE id = ?');
  const upd = db.prepare('UPDATE orders SET fee_settled_cents = ?, fee_settled = 0 WHERE id = ?');
  for (const a of allocations || []) {
    const row = get.get(a.order_id);
    if (!row) continue;
    const next = Math.max(0, (row.fee_settled_cents || 0) - (a.amount_cents || 0));
    upd.run(next, a.order_id);
  }
}

// Pros who are over the cap, as a Set, for filtering a list of candidates in one query.
function blockedSupplierIds() {
  const rows = db.prepare(`
    SELECT supplier_id, SUM(${SHARE}) AS owed
    FROM orders
    WHERE supplier_id IS NOT NULL AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0
    GROUP BY supplier_id
    HAVING owed >= ?`).all(cap());
  return new Set(rows.map((r) => r.supplier_id));
}

module.exports = {
  cashOwed, cap, isBlocked, status, blockedMessage, settle, settleUpTo, restoreSettlement, blockedSupplierIds,
};
