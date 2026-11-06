// Booking watch: a booking the pro has not started on time is escalated to the FreshAF team,
// so a customer is never left waiting with nobody aware of it.
//
// "Started" means the pro tapped "On my way" (status en_route). A booking is late when it is
// still only accepted:
//   ASAP booking       LATE_MIN minutes after it was booked;
//   scheduled booking  LATE_MIN minutes after the booked start time.
// Then the team gets an email and a WhatsApp (to ADMIN_ALERT_PHONE), and the pro gets a
// second priority alert. Once per booking: orders.escalated_at is set first, so a restart or
// a second server never sends it twice. Demo bookings are skipped; the demo autopilot moves
// those along.
const { db, getSetting } = require('./db');

const LATE_MIN = 5;
const TICK_MS = 30 * 1000;

function due() {
  // scheduled_for is South African wall time (UTC+2 all year); the database clock is UTC.
  return db.prepare(`SELECT o.*,
      CAST((julianday('now') - julianday(COALESCE(o.accepted_at, o.created_at))) * 1440 AS INTEGER) AS waiting_min
    FROM orders o JOIN users c ON c.id = o.customer_id
    WHERE c.is_demo = 0 AND o.status = 'accepted' AND o.supplier_id IS NOT NULL AND o.escalated_at IS NULL
      AND (
        (o.scheduled_for IS NULL
          AND COALESCE(o.accepted_at, o.created_at) <= datetime('now', '-${LATE_MIN} minutes')
          AND COALESCE(o.accepted_at, o.created_at) > datetime('now', '-1 day'))
        OR (o.scheduled_for IS NOT NULL
          AND datetime(o.scheduled_for, '-2 hours', '+${LATE_MIN} minutes') <= datetime('now')
          AND datetime(o.scheduled_for, '-2 hours') > datetime('now', '-1 day'))
      )`).all();
  // Older than a day is not an emergency any more: the 07:00 summary lists stuck bookings,
  // and this way the first start never fires a burst of alerts for stale test orders.
}

function escalate(o) {
  const claimed = db.prepare("UPDATE orders SET escalated_at = datetime('now') WHERE id = ? AND escalated_at IS NULL").run(o.id);
  if (!claimed.changes) return;

  const pro = db.prepare(`SELECT u.name, u.phone, s.business_name FROM users u
    LEFT JOIN suppliers s ON s.user_id = u.id WHERE u.id = ?`).get(o.supplier_id) || {};
  const customer = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.customer_id) || {};
  const { SERVICES } = require('./pricing');
  const service = SERVICES[o.service]?.name || o.service;
  const late = o.scheduled_for
    ? `booked for ${o.scheduled_for}, not on the way ${LATE_MIN} min after the start`
    : `booked ${Math.max(LATE_MIN, o.waiting_min || 0)} min ago, not on the way yet`;
  const proLabel = [pro.name, pro.business_name && pro.business_name !== pro.name ? `(${pro.business_name})` : '']
    .filter(Boolean).join(' ') || `Pro ${o.supplier_id}`;
  const pay = o.payment_method === 'cash'
    ? `Cash, R${Math.round((o.price_cents - (o.points_used_cents || 0)) / 100)} to collect`
    : `Card, ${o.payment_status === 'paid' ? 'paid' : o.payment_status}`;

  // The team: email always, WhatsApp when a number is set for it.
  require('./mailer').adminAlert({
    subject: `Order #${o.id} not started by the pro`,
    lines: [
      `Order #${o.id}: ${service}, ${late}.`,
      `Address: ${o.address}`,
      `Pro: ${proLabel}, ${pro.phone || 'no phone on file'}`,
      `Customer: ${customer.name || 'unknown'}, ${customer.phone || 'no phone on file'}`,
      `Payment: ${pay}`,
      'The pro has not tapped "On my way". Phone them now, or cancel the booking in the admin app so the customer can book someone else.',
    ],
  }).catch(() => {});

  const adminPhone = process.env.ADMIN_ALERT_PHONE;
  if (adminPhone && getSetting('whatsapp_alerts_enabled', '1') === '1') {
    require('./whatsapp').opsAlert({
      phone: adminPhone, orderId: o.id, service, proName: proLabel, proPhone: pro.phone, late,
    }).catch(() => {});
  }

  // The pro: a second priority alert in case the first was missed.
  require('./push').sendToUser(o.supplier_id, {
    title: `Order #${o.id} is waiting for you`,
    body: `The customer is expecting you. Tap "On my way" when you set off.\n${o.address}`,
    url: `/supplier?job=${o.id}`,
    tag: `job-${o.id}`,
    priority: true,
    ttl: 3600,
  }).catch(() => {});
  require('./realtime').send(o.supplier_id, 'job_reminder', { order_id: o.id });

  console.log(`[FreshAF][booking-watch] order ${o.id} escalated: ${late}`);
}

function tick() {
  let rows;
  try { rows = due(); } catch (e) { console.warn(`[FreshAF][booking-watch] ${e.message}`); return; }
  for (const o of rows) {
    try { escalate(o); } catch (e) { console.warn(`[FreshAF][booking-watch] order ${o.id}: ${e.message}`); }
  }
}

function start() {
  const t = setInterval(tick, TICK_MS);
  t.unref?.();
}

module.exports = { start, tick, LATE_MIN };
