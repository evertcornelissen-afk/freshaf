// Demo autopilot: a DEMO booking plays itself through when nobody works it as the pro.
//
// Demo accounts exist so a payment reviewer (Stitch) and the owner can run the real flow on
// the live site. After paying, a booking waits at "accepted" until the pro moves it on, so a
// reviewer watching alone saw the job freeze. Here, if the demo pro has not touched a demo
// booking for GRACE_MS after it was accepted, it advances one step every STEP_MS: on the
// way, in progress, (laundry: out for delivery,) done, with the receipt email at the end.
//
// The owner keeps control: any step the pro takes resets the clock, so a demo job being
// worked by hand is never moved underneath them. Real bookings are never touched — the
// query only matches orders whose customer is a demo account.
const { db } = require('./db');
const dispatch = require('./dispatch');

const GRACE_MS = 2 * 60 * 1000;   // after acceptance, before the first automatic step
const STEP_MS = 60 * 1000;        // between automatic steps
const TICK_MS = 15 * 1000;

// orderId -> { state, since } — the last state seen and when it was first seen. Lost on a
// restart, which only means a demo job waits one more step interval. Never moves early.
const seen = new Map();

const stateOf = (o) => (o.status === 'in_progress' && o.out_for_delivery_at ? 'out_for_delivery' : o.status);

function next(o) {
  switch (stateOf(o)) {
    case 'accepted': return () => db.prepare("UPDATE orders SET status = 'en_route' WHERE id = ?").run(o.id);
    case 'en_route': return () => db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(o.id);
    case 'in_progress':
      if (o.service === 'laundry') {
        return () => db.prepare("UPDATE orders SET out_for_delivery_at = datetime('now') WHERE id = ?").run(o.id);
      }
      return () => complete(o);
    case 'out_for_delivery': return () => complete(o, { receiver: o.return_receiver || customerName(o) });
    default: return null;
  }
}

function customerName(o) {
  return db.prepare('SELECT name FROM users WHERE id = ?').get(o.customer_id)?.name || 'Customer';
}

function complete(o, extra) {
  require('./routes/supplier').completeOrder(o, extra);
}

function tick() {
  let rows;
  try {
    rows = db.prepare(`SELECT o.* FROM orders o JOIN users c ON c.id = o.customer_id
      WHERE c.is_demo = 1 AND o.supplier_id IS NOT NULL
        AND o.status IN ('accepted','en_route','in_progress')`).all();
  } catch (e) {
    console.warn(`[FreshAF][demo-autopilot] ${e.message}`);
    return;
  }
  const now = Date.now();
  const live = new Set();
  for (const o of rows) {
    live.add(o.id);
    const state = stateOf(o);
    const prev = seen.get(o.id);
    if (!prev || prev.state !== state) {
      // New to us, or the pro moved it: start the clock from now (or from acceptance, for
      // the first step, if that was longer ago — so a restart does not add a whole grace).
      const accepted = o.accepted_at ? Date.parse(o.accepted_at.replace(' ', 'T') + 'Z') : now;
      seen.set(o.id, { state, by: 'pro', since: !prev && state === 'accepted' ? Math.min(now, accepted) : now });
      continue;
    }
    // The full grace after acceptance or after any step the pro took; a minute between our own.
    const wait = prev.by === 'auto' ? STEP_MS : GRACE_MS;
    if (now - prev.since < wait) continue;
    const step = next(o);
    if (!step) continue;
    try {
      step();
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
      dispatch.notifyCustomer(updated); // live update, and the receipt when it completes
      seen.set(o.id, { state: stateOf(updated), by: 'auto', since: now });
      console.log(`[FreshAF][demo-autopilot] order ${o.id}: ${state} -> ${stateOf(updated)}`);
    } catch (e) {
      console.warn(`[FreshAF][demo-autopilot] order ${o.id}: ${e.message}`);
    }
  }
  for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
}

function start() {
  const t = setInterval(tick, TICK_MS);
  t.unref?.();
}

module.exports = { start, tick, GRACE_MS, STEP_MS };
