// What a pro owes FreshAF from cash jobs, and the cap that stops it running away.
//
// On a cash job the pro collects the whole selling price at the door. Their own price is
// theirs; the rest is FreshAF's money that they are holding as our collection agent. This
// is the Uber mechanic: the balance accrues against the pro's account, it is set off
// against anything we owe them, and once it passes a cap they cannot go online or be
// offered work until they settle.
const { db, getSetting } = require('./db');

// Matches the sum shown to the pro in their earnings screen.
const OWED_SQL = `
  SELECT COALESCE(SUM(platform_fee_cents), 0) AS c
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
// Used by the admin when a pro pays in, and by the payout run as a set-off against
// money FreshAF owes them on card jobs.
function settle(userId) {
  const owed = cashOwed(userId);
  if (!owed) return 0;
  db.prepare(`
    UPDATE orders SET fee_settled = 1
    WHERE supplier_id = ? AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0`).run(userId);
  return owed;
}

// Pros who are over the cap, as a Set, for filtering a list of candidates in one query.
function blockedSupplierIds() {
  const rows = db.prepare(`
    SELECT supplier_id, SUM(platform_fee_cents) AS owed
    FROM orders
    WHERE supplier_id IS NOT NULL AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0
    GROUP BY supplier_id
    HAVING owed >= ?`).all(cap());
  return new Set(rows.map((r) => r.supplier_id));
}

module.exports = { cashOwed, cap, isBlocked, status, blockedMessage, settle, blockedSupplierIds };
