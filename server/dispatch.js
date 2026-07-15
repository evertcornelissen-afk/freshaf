const { db, getSetting } = require('./db');
const realtime = require('./realtime');

const offerTimers = new Map(); // offerId -> timeout

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function orderPublic(order) {
  const { id, service, package: pkg, vehicle, price_cents, address, lat, lng, notes,
    payment_method, payment_status, status, created_at, accepted_at, completed_at, supplier_id,
    callout_fee_cents, points_used_cents, points_earned_cents } = order;
  let supplier = null;
  if (supplier_id) {
    const s = db.prepare(`
      SELECT u.name, u.phone, s.business_name, s.rating_sum, s.rating_count, s.lat, s.lng
      FROM suppliers s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`).get(supplier_id);
    if (s) supplier = {
      name: s.name, phone: s.phone, business_name: s.business_name,
      rating: s.rating_count ? +(s.rating_sum / s.rating_count).toFixed(1) : null,
      lat: s.lat, lng: s.lng,
    };
  }
  return { id, service, package: pkg, vehicle, price_cents, address, lat, lng, notes,
    payment_method, payment_status, status, created_at, accepted_at, completed_at, supplier,
    callout_fee_cents: callout_fee_cents || 0,
    points_used_cents: points_used_cents || 0,
    points_earned_cents: points_earned_cents || 0,
    amount_due_cents: price_cents - (points_used_cents || 0) };
}

function notifyCustomer(order) {
  realtime.send(order.customer_id, 'order_update', orderPublic(order));
}

// Offer the job to the nearest online, approved supplier not yet tried for this order.
function offerToNext(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'searching') return;

  const radiusKm = Number(getSetting('dispatch_radius_km', '25'));
  const candidates = db.prepare(`
    SELECT s.user_id, s.lat, s.lng FROM suppliers s
    WHERE s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0
      AND s.user_id NOT IN (SELECT supplier_id FROM offers WHERE order_id = ?)
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND status IN ('accepted','en_route','in_progress'))
  `).all(order.service, orderId)
    .map((s) => ({ ...s, distance: haversineKm(order.lat, order.lng, s.lat, s.lng) }))
    .filter((s) => s.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);

  if (!candidates.length) {
    db.prepare("UPDATE orders SET status = 'no_providers' WHERE id = ? AND status = 'searching'").run(orderId);
    notifyCustomer(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId));
    return;
  }

  const next = candidates[0];
  const info = db.prepare('INSERT INTO offers (order_id, supplier_id, distance_km) VALUES (?, ?, ?)')
    .run(orderId, next.user_id, +next.distance.toFixed(1));
  const offerId = Number(info.lastInsertRowid);

  realtime.send(next.user_id, 'offer', {
    offer_id: offerId,
    order: orderPublic(order),
    distance_km: +next.distance.toFixed(1),
    expires_in_sec: Number(getSetting('offer_timeout_sec', '60')),
  });

  const timeoutMs = Number(getSetting('offer_timeout_sec', '60')) * 1000;
  offerTimers.set(offerId, setTimeout(() => expireOffer(offerId), timeoutMs));
}

function expireOffer(offerId) {
  offerTimers.delete(offerId);
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
  if (!offer || offer.status !== 'pending') return;
  db.prepare("UPDATE offers SET status = 'expired' WHERE id = ?").run(offerId);
  realtime.send(offer.supplier_id, 'offer_expired', { offer_id: offerId });
  offerToNext(offer.order_id);
}

function clearOfferTimer(offerId) {
  const t = offerTimers.get(offerId);
  if (t) { clearTimeout(t); offerTimers.delete(offerId); }
}

function startDispatch(orderId) {
  db.prepare("UPDATE orders SET status = 'searching' WHERE id = ?").run(orderId);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  notifyCustomer(order);
  offerToNext(orderId);
}

// Withdraw pending offers for an order (on cancel / accept elsewhere).
function withdrawPendingOffers(orderId, exceptOfferId = null) {
  const pending = db.prepare("SELECT * FROM offers WHERE order_id = ? AND status = 'pending'").all(orderId);
  for (const o of pending) {
    if (o.id === exceptOfferId) continue;
    clearOfferTimer(o.id);
    db.prepare("UPDATE offers SET status = 'withdrawn' WHERE id = ?").run(o.id);
    realtime.send(o.supplier_id, 'offer_expired', { offer_id: o.id });
  }
}

// Re-dispatch orders left searching after a restart (offers in flight died with the process).
function resumeSearchingOrders() {
  const rows = db.prepare("SELECT id FROM orders WHERE status = 'searching'").all();
  for (const r of rows) {
    withdrawPendingOffers(r.id);
    offerToNext(r.id);
  }
  if (rows.length) console.log(`[FreshAF] Resumed dispatch for ${rows.length} searching order(s).`);
}

module.exports = {
  startDispatch, offerToNext, clearOfferTimer, withdrawPendingOffers,
  resumeSearchingOrders, notifyCustomer, orderPublic, haversineKm,
};
