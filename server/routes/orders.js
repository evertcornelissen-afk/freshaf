const express = require('express');
const { db, getSetting } = require('../db');
const { authRequired } = require('../auth');
const { SERVICE_KEYS, quote, catalog, priceFor, platformFee } = require('../pricing');
const payments = require('../payments');
const stitch = require('../stitch');
const dispatch = require('../dispatch');
const maps = require('../maps');
const realtime = require('../realtime');

const router = express.Router();

router.get('/pricing', (req, res) => {
  res.json({
    services: catalog(), payments_live: payments.cardAvailableFor(viewer(req)),
    points_earn_pct: Number(getSetting('points_earn_pct', '5')),
    callout: {
      free_km: Number(getSetting('callout_free_km', '5')),
      per_km_cents: Number(getSetting('callout_per_km_cents', '1000')),
      cap_cents: Number(getSetting('callout_cap_cents', '15000')),
    },
  });
});

// Callout fee: distance from the customer's pin to the nearest online approved provider of that service.
// The callout fee is real money, so it is worth one Routes call to get the distance
// right. Straight-line distance picks the candidate (free); the road distance only
// prices the one pro who would actually drive. Falls back to straight-line if the
// lookup fails — a slightly wrong fee beats refusing to quote.
// The signed-in visitor, if any, for decisions that depend on who is asking (card is open
// to demo accounts before it is open to everyone). Never required.
function viewer(req) {
  const u = require('../auth').readToken(req);
  return u ? db.prepare('SELECT id, is_demo FROM users WHERE id = ?').get(u.id) : null;
}

async function computeCallout(lat, lng, service, customerId) {
  const sups = db.prepare(
    `SELECT s.lat, s.lng FROM suppliers s WHERE s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
     AND instr(',' || s.services || ',', ',' || ? || ',') > 0
     AND (SELECT is_demo FROM users WHERE id = s.user_id) = (SELECT is_demo FROM users WHERE id = ?)`).all(service, customerId);
  if (!sups.length) return { available: false, fee_cents: 0, distance_km: null };
  let dist = Infinity;
  let nearest = null;
  for (const s of sups) {
    const d = dispatch.haversineKm(lat, lng, s.lat, s.lng);
    if (d < dist) { dist = d; nearest = s; }
  }
  const road = nearest ? await maps.drivingDistance({ lat: nearest.lat, lng: nearest.lng }, { lat, lng }) : null;
  const km = road ? road.km : dist;
  const freeKm = Number(getSetting('callout_free_km', '5'));
  const perKm = Number(getSetting('callout_per_km_cents', '1000'));
  const cap = Number(getSetting('callout_cap_cents', '15000'));
  const extraKm = Math.max(0, km - freeKm);
  const fee = Math.min(cap, Math.round(extraKm * perKm / 100) * 100); // round to whole rand
  return {
    available: true,
    fee_cents: fee,
    distance_km: +km.toFixed(1),
    by_road: Boolean(road),
    eta_minutes: road?.minutes ?? null,
  };
}

// Available pros near a pin, each with THEIR price for the chosen package + our fee on top.
router.get('/quote/providers', authRequired('customer'), (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const { service, package: pkg, vehicle: unit } = req.query;
  if (!SERVICE_KEYS.includes(service)) return res.status(400).json({ error: 'Choose a service' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Pick a location first' });

  const feePct = Number(getSetting('platform_fee_pct', '20'));
  const maxRadius = Number(getSetting('dispatch_radius_km', '25'));
  const freeKm = Number(getSetting('callout_free_km', '5'));
  const perKm = Number(getSetting('callout_per_km_cents', '1000'));
  const cap = Number(getSetting('callout_cap_cents', '15000'));

  const rows = db.prepare(`
    SELECT s.user_id, s.business_name, s.lat, s.lng, s.radius_km, s.rating_sum, s.rating_count,
           u.name AS pro_name, sp.price_cents
    FROM suppliers s
    JOIN users u ON u.id = s.user_id
    JOIN supplier_prices sp ON sp.user_id = s.user_id AND sp.service = ? AND sp.package = ?
    WHERE s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0
      AND (SELECT is_demo FROM users WHERE id = s.user_id) = (SELECT is_demo FROM users WHERE id = ?)
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND status IN ('accepted','en_route','in_progress'))
  `).all(service, pkg, service, req.user.id);

  const providers = rows.map((r) => {
    const distance = dispatch.haversineKm(lat, lng, r.lat, r.lng);
    const supplierPrice = priceFor(service, pkg, unit, r.price_cents);
    if (supplierPrice == null) return null;
    // A pro only appears if the customer is inside the radius THEY chose.
    const limit = Math.min(r.radius_km || maxRadius, maxRadius);
    if (distance > limit) return null;
    const callout = Math.min(cap, Math.round(Math.max(0, distance - freeKm) * perKm / 100) * 100);
    const fee = platformFee(supplierPrice + callout, feePct);
    return {
      supplier_id: r.user_id,
      business_name: r.business_name,
      name: r.pro_name,
      rating: r.rating_count ? +(r.rating_sum / r.rating_count).toFixed(1) : null,
      rating_count: r.rating_count,
      distance_km: +distance.toFixed(1),
      supplier_price_cents: supplierPrice,
      callout_fee_cents: callout,
      platform_fee_cents: fee,
      total_cents: supplierPrice + callout + fee,
    };
  }).filter(Boolean).sort((a, b) => a.total_cents - b.total_cents);

  res.json({ providers, fee_pct: feePct });
});

/* ---------- hybrid quoting ----------
   The customer logs the job once; published prices answer instantly, per-job pros answer
   themselves. Everything the customer picks from is a real commitment from a real pro. */
const quotes = require('../quotes');
const { SERVICES } = require('../pricing');

function catalogHas(service, pkg, unit) {
  const svc = SERVICES[service];
  return !!(svc && svc.packages[pkg] && svc.units[unit]);
}

// Booking times are South African wall-clock time ("2026-08-22 09:00"), stored as typed;
// South Africa has one timezone and no daylight saving. They are compared in that frame:
// both sides are read as if they were UTC, so the server's own timezone (UTC on Render,
// SAST on a laptop) never shifts a check by two hours, as it used to.
function wallMs(text) {
  const m = String(text || '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}:00Z`);
}
function wallNowMs() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }); // "2026-11-06 10:15:00"
  return Date.parse(`${s.replace(' ', 'T').slice(0, 16)}:00Z`);
}
const wallText = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// Accepts "2026-08-22T09:00" from a datetime-local input.
function parseScheduledFor(raw) {
  if (!raw) return { value: null };
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return { error: 'That date and time could not be read' };
  const when = { getTime: () => wallMs(raw) };
  if (Number.isNaN(when.getTime())) return { error: 'That date and time could not be read' };
  const now = wallNowMs();
  if (when.getTime() < now + 15 * 60 * 1000) return { error: 'Choose a time at least 15 minutes from now' };
  if (when.getTime() > now + 30 * 24 * 3600 * 1000) return { error: 'You can book up to 30 days ahead' };
  return { value: `${m[1]} ${m[2]}` };
}

// The return leg of a laundry job, when the customer wants it back somewhere else. The
// window opens once the package's turnaround has passed since collection, and can be set
// up to RETURN_WINDOW_DAYS after that. Returns { value } (null when not asked for) or
// { error }.
const RETURN_WINDOW_DAYS = 7;
const RETURN_WINDOW_HOURS = 2; // the customer picks the start of a two-hour slot
const RETURN_DAY = [7, 18];     // drop-offs start between 07:00 and 18:00, SA time
// The first daytime moment at or after ms (wall time in the UTC frame, see wallMs).
function nextDaytime(ms) {
  const d = new Date(ms);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins < RETURN_DAY[0] * 60) { d.setUTCHours(RETURN_DAY[0], 0, 0, 0); return d.getTime(); }
  if (mins > RETURN_DAY[1] * 60) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(RETURN_DAY[0], 0, 0, 0); return d.getTime(); }
  return ms;
}
function parseReturn(body, service, pkg, scheduledFor) {
  const r = body?.return_to;
  if (!r || !r.enabled) return { value: null };
  if (service !== 'laundry') return { error: 'Returning to a different address is for laundry only' };
  const address = String(r.address || '').trim();
  if (!address || typeof r.lat !== 'number' || typeof r.lng !== 'number') {
    return { error: 'Drop the return pin on the second map and enter the return address' };
  }
  const receiver = String(r.receiver || '').trim();
  if (!receiver) return { error: 'Say who will receive the laundry, for example Reception or a name' };
  const turnaround = SERVICES.laundry.packages[pkg]?.turnaround_h ?? 48;
  const collect = scheduledFor ? wallMs(scheduledFor) : wallNowMs();
  const earliest = nextDaytime(collect + turnaround * 3600_000);
  const latest = earliest + RETURN_WINDOW_DAYS * 24 * 3600_000;
  const start = wallMs(r.window_start);
  if (Number.isNaN(start)) return { error: 'Choose when you want it back' };
  // Five minutes' grace for the time it takes to press the button.
  if (start < earliest - 5 * 60_000) {
    return { error: `This package needs ${turnaround} hours, so the earliest return is ${wallText(earliest)}` };
  }
  if (start > latest) return { error: `Choose a return time within ${RETURN_WINDOW_DAYS} days of the earliest` };
  const startMins = new Date(start).getUTCHours() * 60 + new Date(start).getUTCMinutes();
  if (startMins < RETURN_DAY[0] * 60 || startMins > RETURN_DAY[1] * 60) {
    return { error: `Returns are between ${RETURN_DAY[0]}:00 and ${RETURN_DAY[1]}:00. Choose a time in that window` };
  }
  return {
    value: {
      address: address.slice(0, 200), lat: r.lat, lng: r.lng,
      notes: String(r.notes || '').trim().slice(0, 300) || null,
      receiver: receiver.slice(0, 80), window_start: wallText(start),
    },
  };
}

router.post('/quote-requests', authRequired('customer'), (req, res) => {
  const { service, package: pkg, vehicle, address, lat, lng, notes, scheduled_for } = req.body || {};
  if (!SERVICE_KEYS.includes(service)) return res.status(400).json({ error: 'Choose a service' });
  if (!catalogHas(service, pkg, vehicle)) return res.status(400).json({ error: 'Choose a package and size' });
  if (!address?.trim() || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Pick your location on the map and enter an address' });
  }
  const sched = parseScheduledFor(scheduled_for);
  if (sched.error) return res.status(400).json({ error: sched.error });
  const ret = parseReturn(req.body, service, pkg, sched.value);
  if (ret.error) return res.status(400).json({ error: ret.error });

  // One open request per service — otherwise pros get the same job twice.
  const existing = db.prepare(`SELECT id FROM quote_requests
    WHERE customer_id = ? AND service = ? AND status = 'open'`).get(req.user.id, service);
  if (existing) {
    db.prepare("UPDATE quote_requests SET status = 'cancelled' WHERE id = ?").run(existing.id);
    db.prepare("UPDATE quotes SET status = 'withdrawn' WHERE request_id = ? AND status = 'open'").run(existing.id);
  }

  const windowMin = quotes.settings().windowMin;
  const info = db.prepare(`
    INSERT INTO quote_requests (customer_id, service, package, vehicle, address, lat, lng, notes, scheduled_for, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))`)
    .run(req.user.id, service, pkg, vehicle, address.trim(), lat, lng,
      (notes || '').slice(0, 300) || null, sched.value, windowMin);

  if (ret.value) {
    db.prepare(`UPDATE quote_requests SET return_address = ?, return_lat = ?, return_lng = ?,
      return_notes = ?, return_receiver = ?, return_window_start = ? WHERE id = ?`)
      .run(ret.value.address, ret.value.lat, ret.value.lng, ret.value.notes, ret.value.receiver,
        ret.value.window_start, Number(info.lastInsertRowid));
  }
  const request = quotes.getRequest(Number(info.lastInsertRowid));
  const { asked, auto } = quotes.openRequest(request);
  res.json({
    request_id: request.id,
    scheduled_for: request.scheduled_for,
    asked, auto_quoted: auto,
    expires_in_min: windowMin,
    quotes: quotes.listQuotes(request.id),
  });
});

router.get('/quote-requests/:id', authRequired('customer'), (req, res) => {
  const request = db.prepare('SELECT * FROM quote_requests WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json({
    request_id: request.id, status: request.status, order_id: request.order_id,
    quotes: quotes.listQuotes(request.id),
  });
});

router.post('/quote-requests/:id/cancel', authRequired('customer'), (req, res) => {
  const request = db.prepare('SELECT * FROM quote_requests WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status === 'open') {
    db.prepare("UPDATE quote_requests SET status = 'cancelled' WHERE id = ?").run(request.id);
    db.prepare("UPDATE quotes SET status = 'withdrawn' WHERE request_id = ? AND status = 'open'").run(request.id);
  }
  res.json({ ok: true });
});

router.get('/quote/callout', authRequired('customer'), async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const service = SERVICE_KEYS.includes(req.query.service) ? req.query.service : 'carwash';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
  res.json(await computeCallout(lat, lng, service, req.user.id));
});

// Accept one quote: it becomes the order, at exactly the price that pro quoted.
router.post('/quotes/:id/accept', authRequired('customer'), async (req, res) => {
  const { payment_method, use_points } = req.body || {};
  if (!['card', 'cash'].includes(payment_method)) return res.status(400).json({ error: 'Choose a payment method' });

  const q = db.prepare(`SELECT q.*, r.customer_id, r.service, r.package, r.vehicle,
      r.address, r.lat, r.lng, r.notes, r.scheduled_for, r.status AS request_status, r.id AS request_id,
      r.return_address, r.return_lat, r.return_lng, r.return_notes, r.return_receiver, r.return_window_start
    FROM quotes q JOIN quote_requests r ON r.id = q.request_id
    WHERE q.id = ? AND r.customer_id = ?`).get(req.params.id, req.user.id);
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (q.status !== 'open') return res.status(409).json({ error: 'That quote is no longer available' });
  if (q.request_status !== 'open') return res.status(409).json({ error: 'This request is closed' });

  // A demo customer (the payment reviewer) may book again and again, and the demo pro may
  // hold any number of demo jobs: a reviewer who abandons a checkout and starts over must
  // not hit "you already have an active order". Real accounts keep both rules.
  const demo = quotes.isDemoUser(req.user.id);
  const active = demo ? null : db.prepare(`SELECT id FROM orders WHERE customer_id = ? AND service = ?
    AND status IN ('pending_payment','searching','accepted','en_route','in_progress')`).get(req.user.id, q.service);
  if (active) return res.status(409).json({ error: 'You already have an active order for this service. Complete or cancel it first.' });

  // For work happening now the pro must still be free. A booking for a future date is
  // fine even if they are mid-job today.
  if (!q.scheduled_for && !demo) {
    const busy = db.prepare(`SELECT id FROM orders WHERE supplier_id = ?
      AND status IN ('accepted','en_route','in_progress') AND scheduled_for IS NULL`).get(q.supplier_id);
    if (busy) return res.status(409).json({ error: 'That pro has just taken another job. Please pick another quote.' });
  }

  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (payment_method === 'card' && !payments.cardAvailableFor(customer)) {
    return res.status(400).json({ error: 'Card payments are not available yet. Please choose cash.' });
  }
  const pointsUsed = use_points ? Math.min(customer.points_cents || 0, q.total_cents) : 0;
  if (pointsUsed > 0) {
    db.prepare('UPDATE users SET points_cents = points_cents - ? WHERE id = ?').run(pointsUsed, req.user.id);
  }
  const amountDue = q.total_cents - pointsUsed;
  if (customer.home_lat == null) {
    db.prepare('UPDATE users SET home_lat = ?, home_lng = ?, home_address = COALESCE(home_address, ?) WHERE id = ?')
      .run(q.lat, q.lng, q.address, req.user.id);
  }

  const isCash = payment_method === 'cash';
  const paidByPoints = !isCash && amountDue === 0;
  const paymentStatus = isCash ? 'collect_on_completion' : paidByPoints ? 'paid' : 'unpaid';
  // A quote is the pro's commitment, so there is no second accept step — once it is paid
  // for (or is cash) the job is theirs.
  const status = (isCash || paidByPoints) ? 'accepted' : 'pending_payment';

  const info = db.prepare(`INSERT INTO orders
    (customer_id, supplier_id, service, package, vehicle, price_cents, callout_fee_cents,
     points_used_cents, supplier_price_cents, platform_fee_cents, requested_supplier_id,
     address, lat, lng, notes, payment_method, payment_status, status, accepted_at, scheduled_for)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, (isCash || paidByPoints) ? q.supplier_id : null,
      q.service, q.package, q.vehicle, q.total_cents, q.callout_fee_cents, pointsUsed,
      q.supplier_price_cents, q.platform_fee_cents, q.supplier_id,
      q.address, q.lat, q.lng, q.notes, payment_method, paymentStatus, status,
      (isCash || paidByPoints) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      q.scheduled_for);
  const orderId = Number(info.lastInsertRowid);
  if (q.return_address) {
    db.prepare(`UPDATE orders SET return_address = ?, return_lat = ?, return_lng = ?, return_notes = ?,
      return_receiver = ?, return_window_start = ?, return_leg_fee_cents = ? WHERE id = ?`)
      .run(q.return_address, q.return_lat, q.return_lng, q.return_notes, q.return_receiver,
        q.return_window_start, q.return_leg_fee_cents || 0, orderId);
  }

  db.prepare("UPDATE quotes SET status = 'accepted' WHERE id = ?").run(q.id);
  db.prepare("UPDATE quotes SET status = 'declined' WHERE request_id = ? AND id != ? AND status = 'open'")
    .run(q.request_id, q.id);
  db.prepare("UPDATE quote_requests SET status = 'booked', order_id = ? WHERE id = ?").run(orderId, q.request_id);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  // Tell every pro who quoted how it went, so nobody is left waiting.
  for (const other of db.prepare('SELECT supplier_id, status FROM quotes WHERE request_id = ?').all(q.request_id)) {
    realtime.send(other.supplier_id, 'quote_result', {
      request_id: q.request_id,
      won: other.supplier_id === q.supplier_id && (isCash || paidByPoints),
      pending_payment: other.supplier_id === q.supplier_id && !(isCash || paidByPoints),
    });
  }
  if (isCash || paidByPoints) {
    dispatch.notifyCustomer(order);
    return res.json({ order: dispatch.orderPublic(order) });
  }
  const pay = await startPayment(order, customer, res);
  if (!pay) return;
  res.json({ order: dispatch.orderPublic(order), payment_url: pay.url, payment_mode: pay.mode });
});

router.post('/orders', authRequired('customer'), async (req, res) => {
  const { service, package: pkg, vehicle, address, lat, lng, notes, payment_method, use_points,
    supplier_id } = req.body || {};
  if (!SERVICE_KEYS.includes(service)) return res.status(400).json({ error: 'Choose a service' });
  if (!address?.trim() || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Pick your location on the map and enter an address' });
  }
  if (!['card', 'cash'].includes(payment_method)) return res.status(400).json({ error: 'Choose a payment method' });

  // One active order per service — you can run a car wash and a laundry order at the same time.
  const active = db.prepare(`SELECT id FROM orders WHERE customer_id = ? AND service = ?
    AND status IN ('pending_payment','searching','accepted','en_route','in_progress')`).get(req.user.id, service);
  if (active) return res.status(409).json({ error: 'You already have an active order for this service. Complete or cancel it first.' });

  // The customer picks a pro; that pro's own price is what they earn.
  const chosen = db.prepare(`
    SELECT s.user_id, s.lat, s.lng, s.radius_km, sp.price_cents
    FROM suppliers s
    JOIN supplier_prices sp ON sp.user_id = s.user_id AND sp.service = ? AND sp.package = ?
    WHERE s.user_id = ? AND s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0
      AND (SELECT is_demo FROM users WHERE id = s.user_id) = (SELECT is_demo FROM users WHERE id = ?)
  `).get(service, pkg, supplier_id, service, req.user.id);
  if (!chosen) return res.status(409).json({ error: 'That pro is no longer available. Please choose another.' });

  const supplierPrice = priceFor(service, pkg, vehicle, chosen.price_cents);
  if (supplierPrice == null) return res.status(400).json({ error: 'Invalid package or size selection' });

  const callout = await computeCallout(lat, lng, service, req.user.id);
  const feePct = Number(getSetting('platform_fee_pct', '20'));
  const fee = platformFee(supplierPrice + callout.fee_cents, feePct);
  // Customer pays the pro's price + callout + our fee on top. The pro keeps their price + callout.
  const price = supplierPrice + callout.fee_cents + fee;

  // Rewards redemption — platform-funded, deducted from what the customer pays.
  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (payment_method === 'card' && !payments.cardAvailableFor(customer)) {
    return res.status(400).json({ error: 'Card payments are not available yet. Please choose cash.' });
  }
  const pointsUsed = use_points ? Math.min(customer.points_cents || 0, price) : 0;
  if (pointsUsed > 0) {
    db.prepare('UPDATE users SET points_cents = points_cents - ? WHERE id = ?').run(pointsUsed, req.user.id);
  }
  const amountDue = price - pointsUsed;

  // Remember the customer's location as their saved home pin after their first order.
  if (customer.home_lat == null) {
    db.prepare('UPDATE users SET home_lat = ?, home_lng = ?, home_address = COALESCE(home_address, ?) WHERE id = ?')
      .run(lat, lng, address.trim(), req.user.id);
  }

  // Card orders fully covered by points skip the payment step entirely.
  const isCash = payment_method === 'cash';
  const paidByPoints = !isCash && amountDue === 0;
  const paymentStatus = isCash ? 'collect_on_completion' : paidByPoints ? 'paid' : 'unpaid';
  const status = (isCash || paidByPoints) ? 'searching' : 'pending_payment';

  const info = db.prepare(`INSERT INTO orders
    (customer_id, service, package, vehicle, price_cents, callout_fee_cents, points_used_cents,
     supplier_price_cents, platform_fee_cents, requested_supplier_id,
     address, lat, lng, notes, payment_method, payment_status, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, service, pkg, vehicle, price, callout.fee_cents, pointsUsed,
      supplierPrice, fee, chosen.user_id,
      address.trim(), lat, lng, notes?.trim() || null, payment_method, paymentStatus, status);
  const orderId = Number(info.lastInsertRowid);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  if (isCash || paidByPoints) {
    dispatch.startDispatch(orderId);
    return res.json({ order: dispatch.orderPublic(order) });
  }
  const pay = await startPayment(order, customer, res);
  if (!pay) return;
  res.json({ order: dispatch.orderPublic(order), payment_url: pay.url, payment_mode: pay.mode });
});

// Ask the gateway for a payment URL. A gateway can be down or misconfigured, and the
// customer must be told that plainly rather than left on a dead screen with an order
// sitting in pending_payment.
async function startPayment(order, customer, res) {
  try {
    const pay = await payments.createPayment(order, customer); // demo handling lives there
    if (pay.reference) db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(pay.reference, order.id);
    return pay;
  } catch (e) {
    console.error('[FreshAF] Payment setup failed for order', order.id, e);
    res.status(502).json({
      error: 'We could not reach our payment provider. Your order is saved — try again in a moment, or choose cash.',
    });
    return null;
  }
}

// Sandbox payment confirmation (used by the /pay/:id page when no gateway is configured).
// A paid order that came from an accepted quote already has its pro committed — confirm
// the booking instead of putting it back out to dispatch.
function afterPayment(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;
  const fromQuote = db.prepare("SELECT id FROM quote_requests WHERE order_id = ? AND status = 'booked'").get(orderId);
  if (fromQuote && order.requested_supplier_id) {
    const busy = (order.scheduled_for || quotes.isDemoUser(order.customer_id)) ? null : db.prepare(`SELECT id FROM orders WHERE supplier_id = ? AND id != ?
      AND status IN ('accepted','en_route','in_progress') AND scheduled_for IS NULL`).get(order.requested_supplier_id, orderId);
    if (!busy) {
      db.prepare(`UPDATE orders SET supplier_id = ?, status = 'accepted',
        accepted_at = datetime('now') WHERE id = ?`).run(order.requested_supplier_id, orderId);
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      dispatch.notifyCustomer(updated);
      realtime.send(order.requested_supplier_id, 'quote_result', { request_id: fromQuote.id, won: true });
      return;
    }
    // The pro took something else while the customer was paying — fall back to dispatch.
  }
  dispatch.startDispatch(orderId);
}

router.post('/orders/:id/pay-sandbox', authRequired('customer'), (req, res) => {
  // Marks an order paid without any money moving, so it is for demo accounts only. Before
  // this, any customer could open /pay/<id> while card was not live and "pay" for free.
  const demo = db.prepare('SELECT is_demo FROM users WHERE id = ?').get(req.user.id)?.is_demo;
  if (!demo) return res.status(403).json({ error: 'Test payments are only available on demo accounts' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending_payment') return res.status(400).json({ error: 'Order is not awaiting payment' });
  db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  afterPayment(order.id);
  res.json({ ok: true });
});

// PayFast ITN webhook (live mode).
router.post('/payments/payfast/itn', express.urlencoded({ extended: false }), (req, res) => {
  const data = { ...req.body };
  const signature = data.signature;
  delete data.signature;
  const expected = payments.payfastSignature(data, process.env.PAYFAST_PASSPHRASE || '');
  if (signature !== expected) return res.status(400).send('bad signature');
  if (data.payment_status === 'COMPLETE') {
    const orderId = Number(data.m_payment_id);
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'pending_payment'").get(orderId);
    if (order) {
      db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(orderId);
      afterPayment(orderId);
    }
  }
  res.send('ok');
});

// Stitch webhook (Svix). The status on the browser redirect is attacker-controllable,
// so this signed callback is the only thing that marks an order paid.
router.post('/payments/stitch/webhook', async (req, res) => {
  if (!stitch.verifyWebhook(req.body, req.headers)) {
    console.warn('[FreshAF] Rejected a Stitch webhook with a bad or missing signature.');
    return res.status(400).send('bad signature');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
  } catch {
    return res.status(400).send('bad payload');
  }
  const event = stitch.readPaymentEvent(payload);
  // Acknowledge anything we do not act on, or Stitch will keep retrying it.
  if (!event) return res.send('ok');

  // The payload carries no merchantReference, so match on the payment link id stored
  // when the link was created. If it is absent (a terminal or subscription payment,
  // or a shape change), ask Stitch for the payment and read the reference off it.
  let order = null;
  if (event.linkId) {
    order = db.prepare('SELECT * FROM orders WHERE payment_ref = ?').get(event.linkId);
  }
  if (!order) {
    try {
      const payment = await stitch.getPayment(event.paymentId);
      const orderId = stitch.orderIdFromReference(payment?.merchantReference);
      if (orderId) order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    } catch (e) {
      console.error('[FreshAF] Could not look up Stitch payment', event.paymentId, e.message);
    }
  }
  if (!order) {
    console.warn(`[FreshAF] Stitch ${event.status} for payment ${event.paymentId} matched no order.`);
    return res.send('ok');
  }
  if (!event.paid) {
    console.log(`[FreshAF] Stitch reported ${event.status} for order ${order.id}.`);
    return res.send('ok');
  }

  // Never mark an order paid for less than it costs. Stitch's hosted page does not let
  // the customer change the amount, but this is the one place where believing the
  // payload without checking would cost real money.
  const expected = order.price_cents - (order.points_used_cents || 0);
  if (event.amountCents !== null && event.amountCents < expected) {
    console.error(`[FreshAF] Stitch paid ${event.amountCents}c for order ${order.id}, expected ${expected}c.`);
    return res.send('ok');
  }

  // Svix retries until it gets a 2xx, so this has to be safe to run twice.
  if (order.payment_status === 'paid') return res.send('ok');

  // Money for an order that is already cancelled: the customer finished paying after the
  // checkout expired or after cancelling. It must go back, and someone must be told.
  if (order.status === 'cancelled') {
    const amount = event.amountCents ?? expected;
    db.prepare("UPDATE orders SET payment_status = 'paid', refund_due_cents = ? WHERE id = ?").run(amount, order.id);
    const mailer = require('../mailer');
    mailer.adminAlert({
      subject: `Refund due: payment arrived for cancelled order #${order.id}`,
      lines: [
        `Stitch confirmed R${(amount / 100).toFixed(2)} for order #${order.id}, which was already cancelled (${order.cancelled_by || 'unknown'}).`,
        `Stitch payment: ${event.paymentId}. Refund it in the Stitch dashboard, then press "Mark refunded" in the admin app.`,
      ],
    }).catch(() => {});
    const customer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(order.customer_id);
    if (customer?.email) {
      mailer.orderCancelled({ to: customer.email, name: customer.name, orderId: order.id,
        by: 'late_payment', reason: null, refundCents: amount }).catch(() => {});
    }
    console.warn(`[FreshAF] Payment arrived for cancelled order ${order.id}; refund due.`);
    return res.send('ok');
  }
  db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  if (order.status === 'pending_payment') afterPayment(order.id);
  console.log(`[FreshAF] Stitch confirmed payment for order ${order.id}.`);
  res.send('ok');
});

router.get('/orders', authRequired('customer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ orders: rows.map(dispatch.orderPublic) });
});

router.get('/orders/:id/handover-photo', authRequired('customer'), (req, res) => {
  const o = db.prepare('SELECT handover_photo FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!o?.handover_photo) return res.status(404).json({ error: 'No handover photo' });
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(require('path').join(__dirname, '..', '..', 'data', 'uploads', o.handover_photo));
});

router.get('/orders/:id', authRequired('customer'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: dispatch.orderPublic(order) });
});

router.post('/orders/:id/cancel', authRequired('customer'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!['pending_payment', 'searching', 'no_providers', 'accepted'].includes(order.status)) {
    return res.status(400).json({ error: 'This order can no longer be cancelled' });
  }
  const done = dispatch.cancelOrder(order.id, { by: 'customer' });
  res.json({ ok: true, refund_due_cents: done?.refund_due_cents || 0 });
});

// Retry dispatch after no providers were found.
router.post('/orders/:id/retry', authRequired('customer'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'no_providers') return res.status(400).json({ error: 'Order is not awaiting retry' });
  db.prepare('DELETE FROM offers WHERE order_id = ?').run(order.id);
  dispatch.startDispatch(order.id);
  res.json({ ok: true });
});

router.post('/orders/:id/rate', authRequired('customer'), (req, res) => {
  const { stars, comment } = req.body || {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'completed' || !order.supplier_id) return res.status(400).json({ error: 'You can only rate completed orders' });
  const s = Number(stars);
  if (!Number.isInteger(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Rating must be 1–5 stars' });
  const existing = db.prepare('SELECT id FROM ratings WHERE order_id = ?').get(order.id);
  if (existing) return res.status(409).json({ error: 'Order already rated' });
  db.prepare('INSERT INTO ratings (order_id, customer_id, supplier_id, stars, comment) VALUES (?, ?, ?, ?, ?)')
    .run(order.id, req.user.id, order.supplier_id, s, comment?.trim() || null);
  db.prepare('UPDATE suppliers SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE user_id = ?')
    .run(s, order.supplier_id);
  res.json({ ok: true });
});

module.exports = router;
