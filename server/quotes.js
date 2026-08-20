// Hybrid quoting.
//
// The customer logs one request. Every approved pro who covers that service and has the
// customer inside their radius is asked. Pros who have already published a price for the
// package answer instantly and automatically, so the customer normally has bookable options
// within a second. Pros who price per job — most small operators — get a notification and
// send back their own price and when they can come. The customer picks from whatever arrives.
const { db, getSetting } = require('./db');
const { priceFor, platformFee } = require('./pricing');
const realtime = require('./realtime');
const push = require('./push');
const whatsapp = require('./whatsapp');
const dispatch = require('./dispatch');

function settings() {
  return {
    feePct: Number(getSetting('platform_fee_pct', '10')),
    maxRadius: Number(getSetting('dispatch_radius_km', '25')),
    freeKm: Number(getSetting('callout_free_km', '5')),
    perKm: Number(getSetting('callout_per_km_cents', '1000')),
    cap: Number(getSetting('callout_cap_cents', '15000')),
    windowMin: Number(getSetting('quote_window_min', '30')),
  };
}

function calloutFor(distanceKm) {
  const { freeKm, perKm, cap } = settings();
  return Math.min(cap, Math.round(Math.max(0, distanceKm - freeKm) * perKm / 100) * 100);
}

// Every pro who could do this job, whether or not they have published a price.
// A pro mid-job cannot take another one *right now*, but they can absolutely take a
// booking for Saturday — so the busy filter only applies to as-soon-as-possible work.
function eligiblePros(request) {
  const { maxRadius } = settings();
  const busyClause = request.scheduled_for ? '' : `
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND status IN ('accepted','en_route','in_progress'))`;
  const rows = db.prepare(`
    SELECT s.user_id, s.business_name, s.lat, s.lng, s.radius_km, s.rating_sum, s.rating_count,
           u.name AS pro_name, u.phone, u.phone_verified_at, s.alert_whatsapp,
           (SELECT price_cents FROM supplier_prices sp
             WHERE sp.user_id = s.user_id AND sp.service = ? AND sp.package = ?) AS listed_price_cents
    FROM suppliers s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'approved' AND s.online = 1 AND s.lat IS NOT NULL
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0${busyClause}
  `).all(request.service, request.package, request.service);

  return rows.map((r) => {
    const distance = dispatch.haversineKm(request.lat, request.lng, r.lat, r.lng);
    // A pro is only asked if the customer is inside the radius THEY chose.
    const limit = Math.min(r.radius_km || maxRadius, maxRadius);
    if (distance > limit) return null;
    return { ...r, distance };
  }).filter(Boolean);
}

function quotePublic(q) {
  return {
    id: q.id,
    supplier_id: q.supplier_id,
    business_name: q.business_name,
    name: q.pro_name,
    rating: q.rating_count ? +(q.rating_sum / q.rating_count).toFixed(1) : null,
    rating_count: q.rating_count || 0,
    distance_km: q.distance_km,
    supplier_price_cents: q.supplier_price_cents,
    callout_fee_cents: q.callout_fee_cents,
    platform_fee_cents: q.platform_fee_cents,
    total_cents: q.total_cents,
    availability: q.availability,
    note: q.note,
    source: q.source,
    created_at: q.created_at,
  };
}

function listQuotes(requestId) {
  const rows = db.prepare(`
    SELECT q.*, s.business_name, s.rating_sum, s.rating_count, u.name AS pro_name
    FROM quotes q
    JOIN suppliers s ON s.user_id = q.supplier_id
    JOIN users u ON u.id = q.supplier_id
    WHERE q.request_id = ? AND q.status = 'open'
    ORDER BY q.total_cents ASC`).all(requestId);
  return rows.map(quotePublic);
}

function insertQuote({ requestId, supplierId, supplierPrice, distanceKm, availability, note, source }) {
  const { feePct } = settings();
  const callout = calloutFor(distanceKm);
  const fee = platformFee(supplierPrice + callout, feePct);
  const total = supplierPrice + callout + fee;
  db.prepare(`
    INSERT INTO quotes (request_id, supplier_id, supplier_price_cents, callout_fee_cents,
      platform_fee_cents, total_cents, distance_km, availability, note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id, supplier_id) DO UPDATE SET
      supplier_price_cents = excluded.supplier_price_cents,
      callout_fee_cents = excluded.callout_fee_cents,
      platform_fee_cents = excluded.platform_fee_cents,
      total_cents = excluded.total_cents,
      availability = excluded.availability,
      note = excluded.note,
      source = excluded.source,
      status = 'open',
      created_at = datetime('now')`)
    .run(requestId, supplierId, supplierPrice, callout, fee, total,
      +distanceKm.toFixed(1), availability || null, note || null, source);
  return total;
}

// Tell the customer their quote list changed, so it fills in live.
function notifyCustomer(request) {
  realtime.send(request.customer_id, 'quotes_update', {
    request_id: request.id,
    status: request.status,
    quotes: listQuotes(request.id),
  });
}

function serviceLabel(service) { return service === 'laundry' ? 'Laundry' : 'Car wash'; }

// "2026-08-22 09:00" -> "Sat 22 Aug, 09:00". Null means as soon as possible.
function whenLabel(scheduledFor) {
  if (!scheduledFor) return 'As soon as possible';
  const d = new Date(String(scheduledFor).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(scheduledFor);
  return d.toLocaleString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// Ask everyone, and auto-answer for anyone who already published a price.
function openRequest(request) {
  const pros = eligiblePros(request);
  let auto = 0;
  const asked = [];

  for (const pro of pros) {
    const listed = pro.listed_price_cents != null
      ? priceFor(request.service, request.package, request.vehicle, pro.listed_price_cents)
      : null;
    if (listed != null) {
      insertQuote({
        requestId: request.id, supplierId: pro.user_id, supplierPrice: listed,
        distanceKm: pro.distance,
        // For a booked slot the useful thing to show is the slot, not where the price came from.
        availability: request.scheduled_for ? whenLabel(request.scheduled_for) : 'From your published price list',
        note: null, source: 'auto',
      });
      auto++;
    } else {
      asked.push(pro);
    }
    // Every eligible pro sees the request, including auto-quoted ones — they may want
    // to replace their published price for this particular job.
    realtime.send(pro.user_id, 'quote_request', {
      request_id: request.id,
      service: request.service,
      package: request.package,
      vehicle: request.vehicle,
      address: request.address,
      distance_km: +pro.distance.toFixed(1),
      scheduled_for: request.scheduled_for,
      auto_quoted: listed != null,
    });
  }

  // Only nudge phones for pros who actually have to do something.
  for (const pro of asked) {
    push.sendToUser(pro.user_id, {
      title: `New ${serviceLabel(request.service).toLowerCase()} request — send your price`,
      body: `${whenLabel(request.scheduled_for)} · ${pro.distance.toFixed(1)} km away\n${request.address}\nOpen FreshAF Pro to quote.`,
      url: '/supplier',
      tag: `quote-${request.id}`,
    }).catch(() => {});

    if (getSetting('whatsapp_alerts_enabled', '1') === '1'
        && pro.phone && pro.phone_verified_at && pro.alert_whatsapp) {
      whatsapp.jobAlert({
        userId: pro.user_id,
        phone: pro.phone,
        service: serviceLabel(request.service),
        earnsRand: 'your price',
        distanceKm: pro.distance.toFixed(1),
        address: request.address,
        expiresMin: settings().windowMin,
        offerId: request.id,
      }).catch(() => {});
    }
  }

  notifyCustomer(request);
  return { asked: pros.length, auto };
}

function getRequest(id) {
  return db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id);
}

// Requests do not stay open forever — a stale one would keep pinging pros.
function expireStale() {
  const rows = db.prepare("SELECT * FROM quote_requests WHERE status = 'open' AND datetime('now') > expires_at").all();
  for (const r of rows) {
    db.prepare("UPDATE quote_requests SET status = 'expired' WHERE id = ?").run(r.id);
    db.prepare("UPDATE quotes SET status = 'expired' WHERE request_id = ? AND status = 'open'").run(r.id);
    notifyCustomer({ ...r, status: 'expired' });
  }
  if (rows.length) console.log(`[FreshAF] Expired ${rows.length} stale quote request(s).`);
}
const staleTimer = setInterval(expireStale, 60 * 1000);
staleTimer.unref?.();

module.exports = {
  openRequest, listQuotes, insertQuote, notifyCustomer, getRequest,
  eligiblePros, calloutFor, settings, expireStale, quotePublic, serviceLabel, whenLabel,
};
