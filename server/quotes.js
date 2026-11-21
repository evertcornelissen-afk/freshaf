// Hybrid quoting.
//
// The customer logs one request. Every approved pro who covers that service and has the
// customer inside their radius is asked. Pros who have already published a price for the
// package answer instantly and automatically, so the customer normally has bookable options
// within a second. Pros who price per job — most small operators — get a notification and
// send back their own price and when they can come. The customer picks from whatever arrives.
const { db, getSetting } = require('./db');
const { SERVICES, SERVICE_KEYS, priceFor, platformFee, quote: publishedPrice, serviceLabel } = require('./pricing');
const realtime = require('./realtime');
const push = require('./push');
const whatsapp = require('./whatsapp');
const dispatch = require('./dispatch');
const balance = require('./balance');
const mailer = require('./mailer');

function settings() {
  return {
    feePct: Number(getSetting('platform_fee_pct', '20')),
    detailingFeePct: Number(getSetting('detailing_fee_pct', '10')),
    maxRadius: Number(getSetting('dispatch_radius_km', '25')),
    freeKm: Number(getSetting('callout_free_km', '5')),
    perKm: Number(getSetting('callout_per_km_cents', '1000')),
    cap: Number(getSetting('callout_cap_cents', '15000')),
    windowMin: Number(getSetting('quote_window_min', '30')),
    // The second trip of a laundry job returned to a different address. FreshAF sets the
    // free distance, the cap and the MAXIMUM rate per km (published to customers before they
    // book); each pro chooses their own rate up to that maximum. Set in the admin app
    // (return_leg_price_set stays 0 until the owner saves it).
    returnFreeKm: Number(getSetting('return_leg_free_km', '5')),
    returnPerKm: Number(getSetting('return_leg_per_km_cents', '1000')),
    returnCap: Number(getSetting('return_leg_cap_cents', '15000')),
  };
}

// FreshAF's margin for a service. Detailing has its own (10%, Evert 21 Nov 2026); every
// other service uses the main margin. Every place that prices a job goes through here, so
// the two can never be mixed up between a quote, an order and the pro's own screens.
function feePctFor(service) {
  const { feePct, detailingFeePct } = settings();
  return service === 'detailing' ? detailingFeePct : feePct;
}

// Whether this customer can book a service right now. Detailing stays closed until the owner
// switches it on in the admin app, and it is paid by card only (Evert, 21 Nov 2026), so it
// is also closed to anyone card is not open to yet. Demo accounts can rehearse it.
function serviceOpen(service, customer = null) {
  if (!SERVICE_KEYS.includes(service)) return false;
  if (service === 'detailing') {
    return getSetting('detailing_booking', '0') === '1' && require('./payments').cardAvailableFor(customer);
  }
  return true;
}
function openServiceKeys(customer = null) { return SERVICE_KEYS.filter((k) => serviceOpen(k, customer)); }
// Services that can only be paid by card.
function cardOnly(service) { return !!SERVICES[service]?.cardOnly; }

// Booked jobs (Evert, 21 Nov 2026): any job for a later time, and every detailing job, is
// accepted or declined by the pro. We cannot assume a pro is free on Saturday because they
// published a price. So a booked request goes to every eligible pro, online or not, nothing
// is answered for them, and the customer is only told once someone accepts.
// Timings count BUSINESS hours (server/business-hours.js): the slot must be at least leadH
// business hours away and inside business hours; pros have up to windowH business hours to
// answer; answers stop cutoffH business hours before the slot.
const BOOKED_RULES = {
  detailing: { leadH: 12, windowH: 12, cutoffH: 3 },
  default: { leadH: 2, windowH: 2, cutoffH: 1 },
};
const bh = require('./business-hours');
function bookAhead(service) { return !!SERVICES[service]?.bookAhead; }      // detailing: never "as soon as possible"
function bookedRules(service) { return BOOKED_RULES[service] || BOOKED_RULES.default; }
// Whether this request waits for pros to accept (a booked time, or a booked-ahead service).
function needsAcceptance(request) { return !!request?.scheduled_for || bookAhead(request?.service); }
const slotWallMs = (scheduledFor) => {
  const m = String(scheduledFor || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : NaN;
};
// The earliest slot a customer may pick for this service, as "YYYY-MM-DD HH:MM" wall time.
function earliestBooking(service) { return bh.wallText(bh.earliestSlot(bookedRules(service).leadH)); }
// null when the slot is fine, otherwise the reason it is not.
function bookedSlotError(service, scheduledFor) {
  const slot = slotWallMs(scheduledFor);
  if (Number.isNaN(slot)) return 'That date and time could not be read';
  if (!bh.isOpenAt(slot)) return `Choose a time between ${bh.label()}, our business hours`;
  const earliest = bh.earliestSlot(bookedRules(service).leadH);
  if (slot < earliest - 60000) {
    return `The earliest you can book is ${whenLabel(bh.wallText(earliest))}, so pros have time to accept`;
  }
  return null;
}
// When a booked request stops taking answers, as an SQL datetime (UTC, like datetime('now')).
function bookedExpiry(service, scheduledFor) {
  const r = bookedRules(service);
  const slot = slotWallMs(scheduledFor);
  if (Number.isNaN(slot)) return null;
  const end = Math.min(bh.addBusinessHours(bh.wallNow(), r.windowH), bh.subtractBusinessHours(slot, r.cutoffH));
  // On a 5-minute mark, so pros read "answer by 08:40", not "08:42".
  const tidy = Math.floor(Math.max(end, bh.wallNow() + 15 * 60000) / 300000) * 300000;
  return bh.wallToUtcSql(tidy);
}

// Whether pros can apply for detailing yet (second switch, also off by default).
function detailingSignupOpen() { return getSetting('detailing_signup', '0') === '1'; }

// What the pro is paid for the return trip. proRateCents is the pro's own rate per km; a pro
// who never chose one (null) gets FreshAF's maximum, and no pro can exceed it, including one
// whose rate was saved before the owner lowered the maximum.
function returnLegFor(distanceKm, proRateCents = null) {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return 0;
  const { returnFreeKm, returnPerKm, returnCap } = settings();
  const rate = proRateCents == null ? returnPerKm : Math.min(returnPerKm, Math.max(0, proRateCents));
  return Math.min(returnCap, Math.round(Math.max(0, distanceKm - returnFreeKm) * rate / 100) * 100);
}

function proReturnRate(supplierId) {
  return db.prepare('SELECT return_per_km_cents FROM suppliers WHERE user_id = ?').get(supplierId)?.return_per_km_cents ?? null;
}

// The return-trip rule as the CUSTOMER sees it before booking: the most they can be charged,
// with FreshAF's margin included (the customer only ever sees all-in prices). Rounded UP to
// the next 10c so the published figure is never below what a quote can actually contain.
function returnLegPublic() {
  const { returnFreeKm, returnPerKm, returnCap, feePct } = settings();
  const allIn = (c) => Math.ceil(c * (100 + feePct) / 100 / 10) * 10;
  return { free_km: returnFreeKm, max_per_km_cents: allIn(returnPerKm), cap_cents: allIn(returnCap) };
}

function calloutFor(distanceKm) {
  const { freeKm, perKm, cap } = settings();
  return Math.min(cap, Math.round(Math.max(0, distanceKm - freeKm) * perKm / 100) * 100);
}

// Every pro who could do this job, whether or not they have published a price.
// A pro mid-job cannot take another one *right now*, but they can absolutely take a
// booking for Saturday — so the busy filter only applies to as-soon-as-possible work.
// Demo accounts exist so a payment reviewer (Stitch) can run the real checkout on the live
// site, unattended, from wherever they are. So a demo customer's request is answered by
// every approved demo pro who offers the service: online or not, busy or not, and however
// far away. Without this the reviewer sits on "waiting for quotes" unless the owner happens
// to be watching FreshAF Pro. Real customers and real pros never take this path: demo and
// real accounts never see each other (see server/db.js).
function isDemoUser(userId) {
  return !!db.prepare('SELECT is_demo FROM users WHERE id = ?').get(userId)?.is_demo;
}

function demoPros(request) {
  return db.prepare(`
    SELECT s.user_id, s.business_name, s.lat, s.lng, s.radius_km, s.rating_sum, s.rating_count,
           u.name AS pro_name, u.phone, u.phone_verified_at, s.alert_whatsapp,
           (SELECT price_cents FROM supplier_prices sp
             WHERE sp.user_id = s.user_id AND sp.service = ? AND sp.package = ?) AS listed_price_cents
    FROM suppliers s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'approved' AND u.is_demo = 1
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0
      AND (? != 'detailing' OR s.detailing_status = 'approved')
  `).all(request.service, request.package, request.service, request.service).map((r) => ({
    ...r,
    distance: r.lat == null ? 0 : dispatch.haversineKm(request.lat, request.lng, r.lat, r.lng),
  }));
}

function eligiblePros(request) {
  if (isDemoUser(request.customer_id)) return demoPros(request);
  const { maxRadius } = settings();
  // Busy = on a job right now. An accepted booking for Saturday does not make a pro busy today.
  const busyClause = request.scheduled_for ? '' : `
      AND s.user_id NOT IN (
        SELECT supplier_id FROM orders
        WHERE supplier_id IS NOT NULL AND (status IN ('en_route','in_progress') OR (status = 'accepted' AND scheduled_for IS NULL)))`;
  const rows = db.prepare(`
    SELECT s.user_id, s.business_name, s.lat, s.lng, s.radius_km, s.rating_sum, s.rating_count,
           u.name AS pro_name, u.phone, u.phone_verified_at, s.alert_whatsapp,
           (SELECT price_cents FROM supplier_prices sp
             WHERE sp.user_id = s.user_id AND sp.service = ? AND sp.package = ?) AS listed_price_cents
    FROM suppliers s
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'approved' AND (s.online = 1 OR ?) AND s.lat IS NOT NULL
      AND instr(',' || s.services || ',', ',' || ? || ',') > 0
      AND (? != 'detailing' OR s.detailing_status = 'approved')
      AND (SELECT is_demo FROM users WHERE id = s.user_id) = (SELECT is_demo FROM users WHERE id = ?)${busyClause}
  `).all(request.service, request.package, needsAcceptance(request) ? 1 : 0, request.service, request.service, request.customer_id);

  // A pro sitting on too much of our cash stops being offered work until they settle.
  const blocked = balance.blockedSupplierIds();
  return rows.filter((r) => !blocked.has(r.user_id)).map((r) => {
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
    // FreshAF sells the job to the customer at total_cents. What we pay the pro, and
    // what we keep, is our cost of sale and our margin — not the customer's business,
    // and itemising it on their bill is what made us look like a payment intermediary.
    total_cents: q.total_cents,
    // Included in total_cents; shown so the customer can see their return trip is in it.
    return_leg_fee_cents: q.return_leg_fee_cents || 0,
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

// returnDistanceKm: the pro's distance to a separate return address, when the customer
// asked for one. That trip is paid to the pro like the call-out, and FreshAF's margin
// applies to it the same way, so the customer still sees one all-in total.
function insertQuote({ requestId, supplierId, supplierPrice, distanceKm, returnDistanceKm = null,
  availability, note, source }) {
  const service = db.prepare('SELECT service FROM quote_requests WHERE id = ?').get(requestId)?.service;
  const feePct = feePctFor(service);
  const callout = calloutFor(distanceKm);
  const returnLeg = returnLegFor(returnDistanceKm, proReturnRate(supplierId));
  const fee = platformFee(supplierPrice + callout + returnLeg, feePct);
  const total = supplierPrice + callout + returnLeg + fee;
  db.prepare(`
    INSERT INTO quotes (request_id, supplier_id, supplier_price_cents, callout_fee_cents,
      platform_fee_cents, total_cents, distance_km, availability, note, source,
      return_leg_fee_cents, return_distance_km)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id, supplier_id) DO UPDATE SET
      supplier_price_cents = excluded.supplier_price_cents,
      callout_fee_cents = excluded.callout_fee_cents,
      platform_fee_cents = excluded.platform_fee_cents,
      total_cents = excluded.total_cents,
      availability = excluded.availability,
      note = excluded.note,
      source = excluded.source,
      return_leg_fee_cents = excluded.return_leg_fee_cents,
      return_distance_km = excluded.return_distance_km,
      status = 'open',
      created_at = datetime('now')`)
    .run(requestId, supplierId, supplierPrice, callout, fee, total,
      +distanceKm.toFixed(1), availability || null, note || null, source,
      returnLeg, returnDistanceKm == null ? null : +returnDistanceKm.toFixed(1));
  return total;
}

// How far a pro is from the request's return address, or null when there is none.
function returnDistanceFor(request, proLat, proLng) {
  if (request.return_lat == null || request.return_lng == null || proLat == null) return null;
  return dispatch.haversineKm(request.return_lat, request.return_lng, proLat, proLng);
}

// Tell the customer their quote list changed, so it fills in live.
function notifyCustomer(request) {
  realtime.send(request.customer_id, 'quotes_update', {
    request_id: request.id,
    status: request.status,
    quotes: listQuotes(request.id),
  });
}


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
  const demo = isDemoUser(request.customer_id);
  let auto = 0;
  const asked = [];

  // Some packages (paint correction, ceramic) are always priced per car by the pro.
  // Like Uber (Evert, 21 Nov 2026): every job waits for a pro to accept it. Nothing is
  // answered for a pro, now or booked; their published price only pre-fills their answer.
  // Demo accounts keep instant answers, so a payment reviewer is never left waiting on a person.
  const quoteOnly = !!SERVICES[request.service]?.packages[request.package]?.quoteOnly || !demo;
  for (const pro of pros) {
    let listed = !quoteOnly && pro.listed_price_cents != null
      ? priceFor(request.service, request.package, request.vehicle, pro.listed_price_cents)
      : null;
    // A demo pro with no price for this package answers at FreshAF's published price, so a
    // demo request always gets a bookable quote straight away.
    if (listed == null && demo && !quoteOnly) listed = publishedPrice(request.service, request.package, request.vehicle);
    if (listed != null) {
      insertQuote({
        requestId: request.id, supplierId: pro.user_id, supplierPrice: listed,
        distanceKm: pro.distance,
        returnDistanceKm: returnDistanceFor(request, pro.lat, pro.lng),
        // For a booked slot the useful thing to show is the slot, not where the price came from.
        // Shown to the CUSTOMER on the quote card, and to the pro on their own quote. It used
        // to say "From your published price list", which told the customer it was theirs.
        availability: request.scheduled_for ? whenLabel(request.scheduled_for) : "Instant price from this pro's price list",
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
      return_address: request.return_address || null,
      distance_km: +pro.distance.toFixed(1),
      scheduled_for: request.scheduled_for,
      auto_quoted: listed != null,
    });
  }

  // Only nudge phones for pros who actually have to do something.
  const ahead = needsAcceptance(request);
  const pkgName = SERVICES[request.service]?.packages[request.package]?.name || request.package;
  const answerBy = ahead ? whenLabel(utcToWall(request.expires_at)) : null;
  for (const pro of asked) {
    if (ahead) {
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(pro.user_id);
      if (u?.email) {
        mailer.send({
          to: u.email,
          subject: `${serviceLabel(request.service)} booking request: ${pkgName}, ${whenLabel(request.scheduled_for)}`,
          heading: 'A customer wants to book you',
          paragraphs: [
            `<b>${pkgName}</b> on <b>${whenLabel(request.scheduled_for)}</b>, ${pro.distance.toFixed(1)} km from you.`,
            `Accept it with your price, or decline it, in FreshAF Pro before <b>${answerBy}</b>.`,
            'Once you accept, the customer can choose you. The job is only yours when they book you'
              + (cardOnly(request.service) ? ' and have paid by card.' : '.'),
          ],
          cta: { label: 'Open FreshAF Pro', url: `${process.env.BASE_URL || 'https://freshaf.io'}/supplier` },
        }).catch(() => {});
      }
    }
    push.sendToUser(pro.user_id, {
      title: ahead
        ? `${serviceLabel(request.service)} booking request — accept or decline by ${answerBy}`
        : `New ${serviceLabel(request.service).toLowerCase()} request near you — accept or decline`,
      body: `${whenLabel(request.scheduled_for)} · ${pro.distance.toFixed(1)} km away\n${request.address}`
        + `${request.return_address ? `\nReturn to: ${request.return_address}` : ''}\nOpen FreshAF Pro to quote.`,
      url: '/supplier',
      tag: `quote-${request.id}`,
    }).catch(() => {});

    if (getSetting('whatsapp_alerts_enabled', '1') === '1'
        && whatsapp.canAlert(pro)) {
      whatsapp.jobAlert({
        userId: pro.user_id,
        phone: pro.phone,
        service: serviceLabel(request.service),
        earnsRand: 'your price',
        distanceKm: pro.distance.toFixed(1),
        address: request.address,
        expiresMin: ahead ? Math.max(1, Math.round((Date.parse(`${request.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 60000)) : settings().windowMin,
        offerId: request.id,
      }).catch(() => {});
    }
  }

  notifyCustomer(request);
  return { asked: pros.length, auto };
}

// A stored UTC datetime ("2026-11-21 14:00:00") as South African wall time, for labels.
function utcToWall(utc) {
  const ms = Date.parse(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) return utc;
  return new Date(ms + 2 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}

const SITE = () => process.env.BASE_URL || 'https://freshaf.io';

// A pro accepted. This is the only thing the customer is notified about (Evert, 21 Nov 2026):
// by push and email, with a link straight to their booking requests.
function tellCustomerAccepted(request, supplierId, totalCents) {
  const cust = db.prepare('SELECT name, email FROM users WHERE id = ?').get(request.customer_id);
  const pro = db.prepare('SELECT business_name FROM suppliers WHERE user_id = ?').get(supplierId);
  const pkgName = SERVICES[request.service]?.packages[request.package]?.name || request.package;
  const price = `R${(totalCents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
  const noun = SERVICES[request.service]?.providerNoun || 'pro';
  const who = pro?.business_name || `A ${noun}`;
  // "As soon as possible" is a request, not a booking yet; a booked time names the slot.
  const booked = !!request.scheduled_for;
  const what = booked ? 'booking' : 'request';
  const line = booked
    ? `${who} can do your ${pkgName} on ${whenLabel(request.scheduled_for)} for ${price}.`
    : `${who} can come and do your ${pkgName} now, for ${price}.`;
  push.sendToUser(request.customer_id, {
    title: `${who} accepted your ${what}`, body: `${line} Tap to book.`, url: '/?requests=1', tag: `req-${request.id}`,
  }).catch(() => {});
  if (cust?.email) {
    mailer.send({
      to: cust.email, subject: `${who} accepted your ${what}`,
      heading: `Your ${what} was accepted`,
      paragraphs: [line, `Book in FreshAF before ${whenLabel(utcToWall(request.expires_at))}${cardOnly(request.service) ? ', paying by card' : ''}. Other ${noun}s may still accept, and you can choose.`],
      cta: { label: 'See and book', url: `${SITE()}/?requests=1` },
    }).catch(() => {});
  }
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
  returnLegFor, proReturnRate, returnLegPublic, isDemoUser,
  feePctFor, serviceOpen, openServiceKeys, detailingSignupOpen, cardOnly, bookAhead,
  needsAcceptance, bookedRules, bookedSlotError, bookedExpiry, earliestBooking, BOOKED_RULES,
  tellCustomerAccepted, utcToWall,
  openRequest, listQuotes, insertQuote, notifyCustomer, getRequest,
  eligiblePros, calloutFor, settings, expireStale, quotePublic, serviceLabel, whenLabel,
};
