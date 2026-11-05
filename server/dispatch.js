const { db, getSetting } = require('./db');
const realtime = require('./realtime');
const push = require('./push');
const whatsapp = require('./whatsapp');

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
    callout_fee_cents, points_used_cents, points_earned_cents,
    supplier_price_cents, platform_fee_cents, scheduled_for } = order;
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
    scheduled_for: scheduled_for || null,
    callout_fee_cents: callout_fee_cents || 0,
    points_used_cents: points_used_cents || 0,
    points_earned_cents: points_earned_cents || 0,
    supplier_price_cents: supplier_price_cents || 0,
    platform_fee_cents: platform_fee_cents || 0,
    supplier_earns_cents: (supplier_price_cents || 0) + (callout_fee_cents || 0),
    amount_due_cents: price_cents - (points_used_cents || 0) };
}

function notifyCustomer(order) {
  realtime.send(order.customer_id, 'order_update', orderPublic(order));
  emailCustomer(order);
}

// Booking confirmed when a pro takes the job, receipt when it is done. Everything else
// (on the way, started) is shown live in the app, where the customer is looking anyway.
function emailCustomer(order) {
  if (!['accepted', 'completed', 'no_providers'].includes(order.status)) return;
  try {
    const claimed = db.prepare(`UPDATE orders SET emailed_status = ?
      WHERE id = ? AND COALESCE(emailed_status, '') != ?`).run(order.status, order.id, order.status).changes;
    if (!claimed) return;
    const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const customer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(fresh.customer_id);
    if (!customer?.email || customer.email.endsWith('@freshaf.invalid')) return;
    const pro = fresh.supplier_id ? db.prepare(`SELECT u.name, s.business_name FROM users u
      JOIN suppliers s ON s.user_id = u.id WHERE u.id = ?`).get(fresh.supplier_id) : null;
    const { SERVICES } = require('./pricing');
    const svc = SERVICES[fresh.service];
    const details = {
      orderId: fresh.id,
      service: svc?.name || fresh.service,
      pkg: svc?.packages?.[fresh.package]?.name || fresh.package,
      unit: svc?.units?.[fresh.vehicle]?.name || fresh.vehicle,
      address: fresh.address,
      scheduledFor: fresh.scheduled_for,
      proName: pro ? `${pro.business_name}${pro.name ? ` (${pro.name})` : ''}` : null,
      totalCents: fresh.price_cents,
      pointsUsedCents: fresh.points_used_cents || 0,
      pointsEarnedCents: fresh.points_earned_cents || 0,
      paymentMethod: fresh.payment_method,
      completedAt: fresh.completed_at,
    };
    const mailer = require('./mailer');
    const send = fresh.status === 'accepted' ? mailer.bookingConfirmed
      : fresh.status === 'completed' ? mailer.receipt : mailer.noProAvailable;
    send({ to: customer.email, name: customer.name, ...details }).catch(() => {});
  } catch (e) {
    console.warn(`[FreshAF] Could not email order ${order.id}: ${e.message}`);
  }
}

// Offer the job to the nearest online, approved supplier not yet tried for this order.
function offerToNext(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'searching') return;

  const radiusKm = Number(getSetting('dispatch_radius_km', '25'));
  // The customer chose this pro at this pro's price — never substitute someone else,
  // because their price (and therefore the customer's total) would be different.
  const candidates = db.prepare(`
    SELECT s.user_id, s.lat, s.lng FROM suppliers s
    WHERE s.user_id = ? AND s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
      AND s.user_id NOT IN (SELECT supplier_id FROM offers WHERE order_id = ?)
      AND (SELECT is_demo FROM users WHERE id = s.user_id) = (SELECT is_demo FROM users WHERE id = ?)
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND status IN ('accepted','en_route','in_progress'))
  `).all(order.requested_supplier_id, orderId, order.customer_id)
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

  const timeoutSec = Number(getSetting('offer_timeout_sec', '60'));
  const serviceLabel = order.service === 'laundry' ? 'Laundry' : 'Car wash';
  const earnsRand = Math.round((order.supplier_price_cents + order.callout_fee_cents) / 100);

  // Reach the provider even when the app is closed.
  push.sendToUser(next.user_id, {
    title: `New ${serviceLabel.toLowerCase()} job — you earn R${earnsRand}`,
    body: `${next.distance.toFixed(1)} km away · ${order.address}\nOpen FreshAF Pro to accept before it expires.`,
    url: '/supplier',
    tag: `offer-${offerId}`,
  }).catch(() => {});

  // WhatsApp is where these pros actually live, so alert there too — but only to a
  // number they verified, and only if they left the channel switched on.
  if (getSetting('whatsapp_alerts_enabled', '1') === '1') {
    const pro = db.prepare(`SELECT u.phone, u.phone_verified_at, s.alert_whatsapp
      FROM users u JOIN suppliers s ON s.user_id = u.id WHERE u.id = ?`).get(next.user_id);
    if (pro?.phone && pro.phone_verified_at && pro.alert_whatsapp) {
      whatsapp.jobAlert({
        userId: next.user_id,
        phone: pro.phone,
        service: serviceLabel,
        earnsRand,
        distanceKm: next.distance.toFixed(1),
        address: order.address,
        expiresMin: Math.max(1, Math.round(timeoutSec / 60)),
        offerId,
      }).catch(() => {});
    }
  }

  const timeoutMs = timeoutSec * 1000;
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

// The one way an order is cancelled, whoever does it: the customer, an admin, or the
// clock (a card checkout never finished). Every path gets the same treatment: offers
// withdrawn, rewards points given back, the pro told, and any card money owed back
// recorded and flagged to the admin by email. Returns the cancelled order, or null if
// it was already finished or cancelled.
function cancelOrder(orderId, { by = 'customer', reason = null } = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || ['completed', 'cancelled'].includes(order.status)) return null;
  withdrawPendingOffers(order.id);
  const refundDue = order.payment_method === 'card' && order.payment_status === 'paid'
    ? order.price_cents - (order.points_used_cents || 0) : 0;
  db.prepare(`UPDATE orders SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?,
    cancelled_at = datetime('now'), refund_due_cents = ? WHERE id = ?`)
    .run(by, reason, refundDue, order.id);
  if (order.points_used_cents > 0) {
    db.prepare('UPDATE users SET points_cents = points_cents + ? WHERE id = ?')
      .run(order.points_used_cents, order.customer_id);
  }
  if (order.supplier_id) {
    realtime.send(order.supplier_id, 'job_cancelled', { order_id: order.id });
    push.sendToUser(order.supplier_id, {
      title: 'Job cancelled', body: `Order #${order.id} at ${order.address} was cancelled. You do not need to go.`,
      url: '/supplier', tag: `job-${order.id}`,
    }).catch(() => {});
  }
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  notifyCustomer(fresh); // live update in the app; cancellations are emailed below

  try {
    const mailer = require('./mailer');
    const customer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(order.customer_id);
    // A customer who cancels does not need telling, unless money is coming back to them.
    if (customer?.email && !customer.email.endsWith('@freshaf.invalid') && (by !== 'customer' || refundDue > 0)) {
      mailer.orderCancelled({ to: customer.email, name: customer.name, orderId: order.id,
        by, reason, refundCents: refundDue }).catch(() => {});
    }
    if (refundDue > 0) {
      mailer.adminAlert({
        subject: `Refund due: order #${order.id}`,
        lines: [
          `Order #${order.id} was paid by card and then cancelled (by ${by}${reason ? `: ${reason}` : ''}).`,
          `Refund owed: R${(refundDue / 100).toFixed(2)}. Stitch payment reference: ${order.payment_ref || 'see Stitch'}.`,
          'Refund it in the Stitch dashboard, then press "Mark refunded" on the order in the admin app.',
        ],
      }).catch(() => {});
    }
  } catch (e) {
    console.warn(`[FreshAF] Cancellation emails for order ${order.id} failed: ${e.message}`);
  }
  console.log(`[FreshAF] Order ${order.id} cancelled by ${by}${refundDue ? `; refund due R${(refundDue / 100).toFixed(2)}` : ''}`);
  return fresh;
}

// A card checkout left unfinished holds the order "awaiting payment" forever, and the
// customer cannot book that service again until it is gone. The Stitch payment link
// itself expires after 60 minutes, so at 65 nobody can still be paying: cancel it.
const PAYMENT_WINDOW_MIN = 65;
function expireUnpaidOrders() {
  try {
    const rows = db.prepare(`SELECT id FROM orders WHERE status = 'pending_payment'
      AND created_at < datetime('now', ?)`).all(`-${PAYMENT_WINDOW_MIN} minutes`);
    for (const r of rows) cancelOrder(r.id, { by: 'expired', reason: 'Payment was not completed' });
  } catch (e) {
    console.warn(`[FreshAF] Expiring unpaid orders failed: ${e.message}`);
  }
}
setTimeout(expireUnpaidOrders, 15_000).unref();
setInterval(expireUnpaidOrders, 60_000).unref();

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
  cancelOrder, expireUnpaidOrders,
};
