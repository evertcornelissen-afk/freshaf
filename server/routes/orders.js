const express = require('express');
const { db, getSetting } = require('../db');
const { authRequired } = require('../auth');
const { SERVICE_KEYS, quote, catalog, priceFor, platformFee } = require('../pricing');
const payments = require('../payments');
const dispatch = require('../dispatch');
const realtime = require('../realtime');

const router = express.Router();

router.get('/pricing', (req, res) => {
  res.json({
    services: catalog(), payments_live: payments.LIVE,
    points_earn_pct: Number(getSetting('points_earn_pct', '5')),
    callout: {
      free_km: Number(getSetting('callout_free_km', '5')),
      per_km_cents: Number(getSetting('callout_per_km_cents', '1000')),
      cap_cents: Number(getSetting('callout_cap_cents', '15000')),
    },
  });
});

// Callout fee: distance from the customer's pin to the nearest online approved provider of that service.
function computeCallout(lat, lng, service) {
  const sups = db.prepare(
    `SELECT lat, lng FROM suppliers WHERE status = 'approved' AND online = 1 AND lat IS NOT NULL
     AND instr(',' || services || ',', ',' || ? || ',') > 0`).all(service);
  if (!sups.length) return { available: false, fee_cents: 0, distance_km: null };
  let dist = Infinity;
  for (const s of sups) dist = Math.min(dist, dispatch.haversineKm(lat, lng, s.lat, s.lng));
  const freeKm = Number(getSetting('callout_free_km', '5'));
  const perKm = Number(getSetting('callout_per_km_cents', '1000'));
  const cap = Number(getSetting('callout_cap_cents', '15000'));
  const extraKm = Math.max(0, dist - freeKm);
  const fee = Math.min(cap, Math.round(extraKm * perKm / 100) * 100); // round to whole rand
  return { available: true, fee_cents: fee, distance_km: +dist.toFixed(1) };
}

// Available pros near a pin, each with THEIR price for the chosen package + our fee on top.
router.get('/quote/providers', authRequired('customer'), (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const { service, package: pkg, vehicle: unit } = req.query;
  if (!SERVICE_KEYS.includes(service)) return res.status(400).json({ error: 'Choose a service' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Pick a location first' });

  const feePct = Number(getSetting('platform_fee_pct', '10'));
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
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND status IN ('accepted','en_route','in_progress'))
  `).all(service, pkg, service);

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

router.get('/quote/callout', authRequired('customer'), (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const service = SERVICE_KEYS.includes(req.query.service) ? req.query.service : 'carwash';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
  res.json(computeCallout(lat, lng, service));
});

router.post('/orders', authRequired('customer'), (req, res) => {
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
  `).get(service, pkg, supplier_id, service);
  if (!chosen) return res.status(409).json({ error: 'That pro is no longer available. Please choose another.' });

  const supplierPrice = priceFor(service, pkg, vehicle, chosen.price_cents);
  if (supplierPrice == null) return res.status(400).json({ error: 'Invalid package or size selection' });

  const callout = computeCallout(lat, lng, service);
  const feePct = Number(getSetting('platform_fee_pct', '10'));
  const fee = platformFee(supplierPrice + callout.fee_cents, feePct);
  // Customer pays the pro's price + callout + our fee on top. The pro keeps their price + callout.
  const price = supplierPrice + callout.fee_cents + fee;

  // Rewards redemption — platform-funded, deducted from what the customer pays.
  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
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
  const pay = payments.createPayment(order, customer);
  res.json({ order: dispatch.orderPublic(order), payment_url: pay.url, payment_mode: pay.mode });
});

// Sandbox payment confirmation (used by /pay/:id page when no PayFast keys are set).
router.post('/orders/:id/pay-sandbox', authRequired('customer'), (req, res) => {
  if (payments.LIVE) return res.status(400).json({ error: 'Live payments enabled — sandbox disabled' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending_payment') return res.status(400).json({ error: 'Order is not awaiting payment' });
  db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  dispatch.startDispatch(order.id);
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
      dispatch.startDispatch(orderId);
    }
  }
  res.send('ok');
});

router.get('/orders', authRequired('customer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ orders: rows.map(dispatch.orderPublic) });
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
  dispatch.withdrawPendingOffers(order.id);
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
  if (order.points_used_cents > 0) {
    db.prepare('UPDATE users SET points_cents = points_cents + ? WHERE id = ?')
      .run(order.points_used_cents, order.customer_id);
  }
  if (order.supplier_id) realtime.send(order.supplier_id, 'job_cancelled', { order_id: order.id });
  res.json({ ok: true });
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
