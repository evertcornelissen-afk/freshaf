const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { db, getSetting, DATA_DIR } = require('../db');
const { authRequired } = require('../auth');
const dispatch = require('../dispatch');
const realtime = require('../realtime');
const balance = require('../balance');
const mailer = require('../mailer');
const onboarding = require('../onboarding');

const router = express.Router();
router.use(authRequired('supplier'));

// ---------- onboarding documents (allowed while pending — that's when they're needed) ----------
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.pdf'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      // Never put what the browser sent into a path: "kind" could be "../../x" (audit, 21 Nov 2026).
      const ext = path.extname(file.originalname).toLowerCase();
      const kind = onboarding.DOC_KINDS.includes(req.body.kind) ? req.body.kind : 'doc';
      cb(null, `${req.user.id}-${kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ALLOWED_EXT.includes(ext) ? ext : '.bin'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()));
  },
});

router.post('/documents', upload.single('file'), (req, res) => {
  const kind = req.body.kind;
  if (!onboarding.DOC_KINDS.includes(kind)) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(400).json({ error: 'Invalid document type' });
  }
  if (!req.file) return res.status(400).json({ error: 'Attach a JPG, PNG or PDF up to 5 MB' });
  // Replace any previous upload of the same kind.
  const old = db.prepare('SELECT * FROM supplier_docs WHERE user_id = ? AND kind = ?').get(req.user.id, kind);
  if (old) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, old.stored_name)); } catch {}
    db.prepare('DELETE FROM supplier_docs WHERE id = ?').run(old.id);
  }
  db.prepare('INSERT INTO supplier_docs (user_id, kind, original_name, stored_name) VALUES (?, ?, ?, ?)')
    .run(req.user.id, kind, req.file.originalname, req.file.filename);

  // If this was the last thing an admin asked for, close the request and put the
  // application back in the queue — nobody should have to notice by hand.
  const settled = onboarding.settleRequest(req.user.id);
  if (settled?.done) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    const s = db.prepare('SELECT business_name FROM suppliers WHERE user_id = ?').get(req.user.id);
    const to = process.env.ADMIN_NOTIFY_EMAIL;
    if (to) {
      mailer.adminProInfoComplete({
        to, name: u?.name, business: s?.business_name,
        items: onboarding.labelsFor(settled.supplied),
      }).catch(() => {});
    }
    console.log(`[FreshAF] Pro ${req.user.id} supplied everything requested: ${settled.supplied.join(', ')}`);
  }
  res.json({ ok: true, request_settled: !!settled?.done });
});

// The pro's own view of the checklist: what they have sent, what is still outstanding,
// and anything an admin has specifically asked for.
router.get('/documents', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(req.user.id);
  const docs = db.prepare('SELECT kind, original_name, uploaded_at FROM supplier_docs WHERE user_id = ?').all(req.user.id);
  let asked = [];
  try { asked = JSON.parse(s?.info_needed || '[]'); } catch { asked = []; }
  res.json({
    documents: docs,
    checklist: onboarding.checklist(s, docs),
    info_needed: asked.filter(onboarding.isValidKey),
    info_note: s?.info_note || null,
    info_requested_at: s?.info_requested_at || null,
  });
});

function requireApproved(req, res, next) {
  const s = db.prepare('SELECT status FROM suppliers WHERE user_id = ?').get(req.user.id);
  if (!s || s.status !== 'approved') return res.status(403).json({ error: 'Your supplier account is not approved yet' });
  next();
}

/* ---------- pro-set pricing ---------- */
const { SERVICES, SERVICE_KEYS, quote, priceFor: priceForUnit } = require('../pricing');

// The pro's own return-trip rate (laundry), with the limits FreshAF sets around it.
function returnTripFor(s) {
  if (!(s?.services || '').split(',').includes('laundry')) return null;
  const q = require('../quotes').settings();
  return { rate_cents: s.return_per_km_cents ?? null, max_cents: q.returnPerKm, free_km: q.returnFreeKm, cap_cents: q.returnCap };
}

// Which services a pro may put prices against. A pro who has applied for detailing (or
// been approved for it) can load their detailing prices straight away, while the
// application is still in review and while customers cannot book detailing yet. Those
// prices just sit there until detailing is approved and opened (Evert, 22 Nov 2026).
function priceableServices(s) {
  const keys = (s?.services || 'carwash').split(',').filter(Boolean);
  const d = s?.detailing_status;
  if ((d === 'pending' || d === 'approved') && !keys.includes('detailing')) keys.push('detailing');
  return keys;
}

router.get('/prices', (req, res) => {
  const s = db.prepare('SELECT services, detailing_status, return_per_km_cents FROM suppliers WHERE user_id = ?').get(req.user.id);
  const mine = db.prepare('SELECT service, package, price_cents FROM supplier_prices WHERE user_id = ?').all(req.user.id);
  const set = {};
  for (const r of mine) set[`${r.service}:${r.package}`] = r.price_cents;
  const out = {};
  const live = (s?.services || 'carwash').split(',').filter(Boolean);
  for (const svcKey of priceableServices(s)) {
    const svc = SERVICES[svcKey];
    if (!svc) continue;
    out[svcKey] = {
      name: svc.name,
      unitLabel: svc.unitLabel,
      // true = they can price it now, but no job can reach them on it yet
      pending_approval: !live.includes(svcKey),
      units: Object.values(svc.units),
      packages: Object.values(svc.packages).map((p) => ({
        key: p.key, name: p.name, desc: p.desc, eta: p.eta,
        suggested_cents: p.base,
        quote_only: !!p.quoteOnly,
        price_cents: p.quoteOnly ? null : (set[`${svcKey}:${p.key}`] ?? null),
      })),
    };
  }
  const q = require('../quotes');
  res.json({ services: out, return_trip: returnTripFor(s), fee_pct: q.feePctFor('carwash'),
    fee_pct_by_service: Object.fromEntries(Object.keys(out).map((k) => [k, q.feePctFor(k)])) });
});

router.post('/prices', (req, res) => {
  const prices = req.body?.prices;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'Send a prices array' });
  const me = db.prepare('SELECT services, detailing_status, return_per_km_cents FROM suppliers WHERE user_id = ?').get(req.user.id);
  const allowed = priceableServices(me);
  // Return-trip rate (laundry pros): a number up to FreshAF's maximum, or null to clear it.
  // Validated before any price is written, so a bad rate never leaves a half-saved list.
  let returnRate;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'return_per_km_cents')) {
    const trip = returnTripFor(me);
    if (!trip) return res.status(400).json({ error: 'The return-trip rate is for laundry pros' });
    const v = req.body.return_per_km_cents;
    if (v === null || v === '') returnRate = null;
    else {
      returnRate = Math.round(Number(v));
      if (!Number.isFinite(returnRate) || returnRate < 0) return res.status(400).json({ error: 'Enter a return-trip rate of R0 or more per km' });
      if (returnRate > trip.max_cents) {
        return res.status(400).json({ error: `The most you can charge for the return trip is R${(trip.max_cents / 100).toFixed(2)} per km` });
      }
    }
  }
  for (const p of prices) {
    if (!SERVICE_KEYS.includes(p.service) || !allowed.includes(p.service)) {
      return res.status(400).json({ error: 'You do not offer that service' });
    }
    if (!SERVICES[p.service].packages[p.package]) return res.status(400).json({ error: 'Unknown package' });
    if (SERVICES[p.service].packages[p.package].quoteOnly) {
      return res.status(400).json({ error: `${SERVICES[p.service].packages[p.package].name} is always quoted per car` });
    }
    const cents = Math.round(Number(p.price_cents));
    if (!Number.isFinite(cents) || cents < 2000 || cents > 2000000) {
      return res.status(400).json({ error: 'Prices must be between R20 and R20 000' });
    }
    db.prepare(`INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, service, package) DO UPDATE SET price_cents = excluded.price_cents`)
      .run(req.user.id, p.service, p.package, cents);
  }
  if (returnRate !== undefined) {
    db.prepare('UPDATE suppliers SET return_per_km_cents = ? WHERE user_id = ?').run(returnRate, req.user.id);
  }
  res.json({ ok: true });
});

/* ---------- detailing: a second approval on top of the normal one ----------
   A pro applies with photos of past work and a link to their reviews or website. Only an
   approved detailer gets 'detailing' added to their services, which is the one thing that
   puts detailing requests in front of them (see quotes.eligiblePros). Pending pros may
   apply too, alongside their normal application. Closed until the owner switches pro
   applications on in the admin app. */
const DETAILING_MIN_PHOTOS = 5;
const DETAILING_MAX_PHOTOS = 12;
const PHOTO_EXT = ['.jpg', '.jpeg', '.png'];
const detailingUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.user.id}-detailing-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, PHOTO_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

function detailingState(userId) {
  const q = require('../quotes');
  const s = db.prepare(`SELECT services, detailing_status, detailing_link, detailing_reason,
    detailing_applied_at, detailing_decided_at FROM suppliers WHERE user_id = ?`).get(userId);
  const photos = db.prepare('SELECT id, original_name, uploaded_at FROM detailing_photos WHERE user_id = ? ORDER BY id').all(userId);
  const services = (s?.services || 'carwash').split(',');
  return {
    signup_open: q.detailingSignupOpen(),
    booking_open: q.serviceOpen('detailing'),
    status: s?.detailing_status || null,
    link: s?.detailing_link || null,
    reason: s?.detailing_reason || null,
    applied_at: s?.detailing_applied_at || null,
    decided_at: s?.detailing_decided_at || null,
    photos,
    min_photos: DETAILING_MIN_PHOTOS,
    max_photos: DETAILING_MAX_PHOTOS,
    fee_pct: q.feePctFor('detailing'),
    // An approved detailer chooses whether they also want everyday car wash requests.
    carwash: services.includes('carwash'),
    other_services: services.filter((x) => x !== 'detailing'),
  };
}

const detailingStatusOf = (userId) =>
  db.prepare('SELECT detailing_status FROM suppliers WHERE user_id = ?').get(userId)?.detailing_status || null;

// A pro who has never applied cannot start while applications are closed; anyone already
// in the process (or decided) keeps seeing their own state.
function detailingClosedFor(userId) {
  return !detailingStatusOf(userId) && !require('../quotes').detailingSignupOpen();
}

router.get('/detailing', (req, res) => res.json(detailingState(req.user.id)));

router.post('/detailing/photos', (req, res, next) => {
  if (detailingClosedFor(req.user.id)) return res.status(403).json({ error: 'Detailing applications are not open yet' });
  if (detailingStatusOf(req.user.id) === 'pending') {
    return res.status(409).json({ error: 'Your detailing application is being reviewed. You can change your photos once it is decided' });
  }
  const n = db.prepare('SELECT COUNT(*) c FROM detailing_photos WHERE user_id = ?').get(req.user.id).c;
  if (n >= DETAILING_MAX_PHOTOS) return res.status(400).json({ error: `You can add up to ${DETAILING_MAX_PHOTOS} photos. Remove one first` });
  next();
}, detailingUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a JPG or PNG photo up to 5 MB' });
  db.prepare('INSERT INTO detailing_photos (user_id, original_name, stored_name) VALUES (?, ?, ?)')
    .run(req.user.id, String(req.file.originalname).slice(0, 120), req.file.filename);
  res.json(detailingState(req.user.id));
});

router.post('/detailing/photos/:id/remove', (req, res) => {
  if (detailingStatusOf(req.user.id) === 'pending') {
    return res.status(409).json({ error: 'Your detailing application is being reviewed' });
  }
  const ph = db.prepare('SELECT * FROM detailing_photos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ph) return res.status(404).json({ error: 'Photo not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, ph.stored_name)); } catch {}
  db.prepare('DELETE FROM detailing_photos WHERE id = ?').run(ph.id);
  res.json(detailingState(req.user.id));
});

router.post('/detailing/apply', (req, res) => {
  if (detailingClosedFor(req.user.id)) return res.status(403).json({ error: 'Detailing applications are not open yet' });
  const cur = detailingState(req.user.id);
  if (cur.status === 'pending') return res.status(409).json({ error: 'Your detailing application is already being reviewed' });
  if (cur.status === 'approved') return res.status(409).json({ error: 'You are already approved for detailing' });
  if (cur.photos.length < DETAILING_MIN_PHOTOS) {
    return res.status(400).json({ error: `Add at least ${DETAILING_MIN_PHOTOS} photos of detailing work you have done (you have ${cur.photos.length})` });
  }
  let link = String(req.body?.link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  let ok = false;
  try { const u = new URL(link); ok = /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch { ok = false; }
  if (!ok) return res.status(400).json({ error: 'Add a link to your Google reviews, website or Instagram so we can see your work' });
  db.prepare(`UPDATE suppliers SET detailing_status = 'pending', detailing_link = ?, detailing_reason = NULL,
    detailing_applied_at = datetime('now'), detailing_decided_at = NULL WHERE user_id = ?`).run(link.slice(0, 300), req.user.id);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const biz = db.prepare('SELECT business_name FROM suppliers WHERE user_id = ?').get(req.user.id)?.business_name;
  mailer.adminAlert({
    subject: `Detailing application: ${biz || u?.name || 'a pro'}`,
    lines: [`${biz || ''} (${u?.name || ''}) applied to do detailing jobs.`,
      `${cur.photos.length} photos of past work. Link: ${link}`,
      'Review it on their application page in the admin app.'],
  }).catch(() => {});
  res.json(detailingState(req.user.id));
});

// An approved detailer can turn everyday car wash requests off (or back on). At least one
// service always stays on the account.
router.post('/detailing/carwash', (req, res) => {
  const s = db.prepare('SELECT services, detailing_status FROM suppliers WHERE user_id = ?').get(req.user.id);
  if (s?.detailing_status !== 'approved') return res.status(403).json({ error: 'This is for approved detailers' });
  const set = new Set((s.services || 'carwash').split(',').filter(Boolean));
  if (req.body?.enabled) set.add('carwash'); else set.delete('carwash');
  if (!set.size) return res.status(400).json({ error: 'Keep at least one service on your account' });
  const ordered = ['carwash', 'detailing', 'laundry'].filter((k) => set.has(k));
  db.prepare('UPDATE suppliers SET services = ? WHERE user_id = ?').run(ordered.join(','), req.user.id);
  res.json(detailingState(req.user.id));
});

router.post('/online', requireApproved, (req, res) => {
  const { online, lat, lng, radius_km } = req.body || {};
  if (online && balance.isBlocked(req.user.id)) {
    return res.status(402).json({ error: balance.blockedMessage(req.user.id) });
  }
  if (typeof radius_km === 'number' && radius_km > 0) {
    db.prepare('UPDATE suppliers SET radius_km = ? WHERE user_id = ?')
      .run(Math.min(200, Math.max(1, radius_km)), req.user.id);
  }
  if (online) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Set your current location to go online' });
    }
    // A published price list is optional now: without one you simply quote each job
    // yourself. Blocking here kept per-job pros off the platform entirely.
    db.prepare('UPDATE suppliers SET online = 1, lat = ?, lng = ? WHERE user_id = ?').run(lat, lng, req.user.id);
    // A new supplier coming online may unlock stuck orders.
    const stuck = db.prepare("SELECT id FROM orders WHERE status = 'searching'").all();
    for (const o of stuck) {
      const hasPending = db.prepare("SELECT id FROM offers WHERE order_id = ? AND status = 'pending'").get(o.id);
      if (!hasPending) dispatch.offerToNext(o.id);
    }
  } else {
    db.prepare('UPDATE suppliers SET online = 0 WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true, online: !!online });
});

router.get('/offers', requireApproved, (req, res) => {
  const rows = db.prepare(`
    SELECT o.id AS offer_id, o.distance_km, o.created_at, ord.*
    FROM offers o JOIN orders ord ON ord.id = o.order_id
    WHERE o.supplier_id = ? AND o.status = 'pending' AND ord.status = 'searching'
    ORDER BY o.id DESC`).all(req.user.id);
  res.json({
    offers: rows.map((r) => ({
      offer_id: r.offer_id, distance_km: r.distance_km,
      order: dispatch.orderPublic(r),
      expires_in_sec: Number(getSetting('offer_timeout_sec', '60')),
    })),
  });
});

router.post('/offers/:id/accept', requireApproved, (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND supplier_id = ?').get(req.params.id, req.user.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(409).json({ error: 'Offer is no longer available' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(offer.order_id);
  if (!order || order.status !== 'searching') return res.status(409).json({ error: 'Job is no longer available' });

  dispatch.clearOfferTimer(offer.id);
  db.prepare("UPDATE offers SET status = 'accepted' WHERE id = ?").run(offer.id);
  db.prepare("UPDATE orders SET supplier_id = ?, status = 'accepted', accepted_at = datetime('now') WHERE id = ?")
    .run(req.user.id, order.id);
  dispatch.withdrawPendingOffers(order.id, offer.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  dispatch.notifyCustomer(updated);
  res.json({ order: dispatch.orderPublic(updated) });
});

router.post('/offers/:id/decline', requireApproved, (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND supplier_id = ?').get(req.params.id, req.user.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.json({ ok: true });
  dispatch.clearOfferTimer(offer.id);
  db.prepare("UPDATE offers SET status = 'declined' WHERE id = ?").run(offer.id);
  dispatch.offerToNext(offer.order_id);
  res.json({ ok: true });
});

const STATUS_FLOW = { accepted: 'en_route', en_route: 'in_progress', in_progress: 'completed' };
const bh = require('../business-hours');
// How early a pro may set off for a booked job.
const SET_OFF_HOURS = 2;
// "2026-11-22 10:00" (South African time) as wall-clock milliseconds.
const bookedWallMs = (text) => Date.parse(`${String(text).replace(' ', 'T').slice(0, 16)}:00Z`);

// Closing a job: FreshAF's revenue recorded, cash collected, rewards earned. Used by the
// advance button for car washes and by the laundry handover.
function completeOrder(order, extra = {}) {
  const commission = order.platform_fee_cents || 0;
  const payment = order.payment_method === 'cash' ? 'collected' : order.payment_status;
  const earnPct = Number(getSetting('points_earn_pct', '5'));
  const earned = Math.round(order.price_cents * earnPct / 100);
  db.prepare(`UPDATE orders SET status = 'completed', completed_at = datetime('now'),
    commission_cents = ?, payment_status = ?, points_earned_cents = ?,
    handover_receiver = COALESCE(?, handover_receiver), handover_photo = COALESCE(?, handover_photo),
    handover_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE handover_at END WHERE id = ?`)
    .run(commission, payment, earned, extra.receiver || null, extra.photo || null, extra.receiver || null, order.id);
  if (earned > 0) {
    db.prepare('UPDATE users SET points_cents = points_cents + ? WHERE id = ?').run(earned, order.customer_id);
  }
}

router.post('/jobs/:orderId/advance', requireApproved, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND supplier_id = ?').get(req.params.orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Job not found' });
  const next = STATUS_FLOW[order.status];
  if (!next) return res.status(400).json({ error: 'Job cannot be advanced from its current status' });
  // A booked job cannot be started a day early by mistake (found in the 21 Nov simulation):
  // the pro can set off from SET_OFF_HOURS before the booked time, not before.
  if (order.status === 'accepted' && order.scheduled_for) {
    const from = bookedWallMs(order.scheduled_for) - SET_OFF_HOURS * 3600e3;
    if (bh.wallNow() < from) {
      return res.status(400).json({ error: `This job is booked for ${quotes.whenLabel(bh.wallText(bookedWallMs(order.scheduled_for)))}. `
        + `You can set off from ${quotes.whenLabel(bh.wallText(from))}.` });
    }
  }

  // Laundry: laundered -> out for delivery -> handed over (with a photo and a name, below).
  if (order.service === 'laundry' && order.status === 'in_progress') {
    if (order.out_for_delivery_at) {
      return res.status(400).json({ error: 'Take a photo of the handover and enter who received it' });
    }
    db.prepare("UPDATE orders SET out_for_delivery_at = datetime('now') WHERE id = ?").run(order.id);
  } else if (next === 'completed') {
    completeOrder(order); // FreshAF's fee was added on top at booking; recorded as revenue here
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(next, order.id);
  }
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  dispatch.notifyCustomer(updated);
  res.json({ order: dispatch.orderPublic(updated) });
});

// The laundry drop-off: a photo of what was handed over and the name of who took it.
// Closes the job, and the customer is told at once (live, push, and the receipt email).
const handoverUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      // Only an image extension is ever stored, whatever the file claims to be: a ".html"
      // "photo" would otherwise be served to the customer as a page (audit, 21 Nov 2026).
      const ext = path.extname(file.originalname).toLowerCase();
      const safe = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
      cb(null, `handover-${Number(req.params.orderId) || 0}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']
    .includes(path.extname(file.originalname).toLowerCase()) || /^image\//.test(file.mimetype)),
});

router.post('/jobs/:orderId/handover', requireApproved, handoverUpload.single('photo'), (req, res) => {
  const drop = () => { if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} } };
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND supplier_id = ?').get(req.params.orderId, req.user.id);
  if (!order) { drop(); return res.status(404).json({ error: 'Job not found' }); }
  if (order.service !== 'laundry' || order.status !== 'in_progress' || !order.out_for_delivery_at) {
    drop();
    return res.status(400).json({ error: 'Mark the job out for delivery first' });
  }
  const receiver = String(req.body?.receiver || '').trim().slice(0, 80);
  if (!req.file) return res.status(400).json({ error: 'Take a photo of the laundry being handed over' });
  if (!receiver) { drop(); return res.status(400).json({ error: 'Enter the name of the person who received it' }); }

  completeOrder(order, { receiver, photo: req.file.filename });
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  dispatch.notifyCustomer(updated); // live update + receipt email with the handover in it
  require('../push').sendToUser(order.customer_id, {
    title: 'Your laundry has been delivered',
    body: `Received by ${receiver}${order.return_address ? ` at ${order.return_address}` : ''}.`,
    url: `/?track=${order.id}`, tag: `order-${order.id}`,
  }).catch(() => {});
  res.json({ order: dispatch.orderPublic(updated) });
});

router.get('/jobs/:orderId/handover-photo', (req, res) => {
  const o = db.prepare('SELECT handover_photo FROM orders WHERE id = ? AND supplier_id = ?').get(req.params.orderId, req.user.id);
  if (!o?.handover_photo) return res.status(404).json({ error: 'No handover photo' });
  res.sendFile(path.join(UPLOAD_DIR, o.handover_photo));
});

router.get('/jobs', (req, res) => {
  const active = db.prepare(`SELECT * FROM orders WHERE supplier_id = ?
    AND status IN ('accepted','en_route','in_progress') ORDER BY id DESC`).all(req.user.id);
  const history = db.prepare(`SELECT * FROM orders WHERE supplier_id = ?
    AND status IN ('completed','cancelled') ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json({
    active: active.map(dispatch.orderPublic),
    history: history.map(dispatch.orderPublic),
  });
});

/* ---------- quote requests ----------
   Open jobs near this pro. Anyone can answer with their own price and when they can come,
   including pros who have no published price list at all. */
const quotes = require('../quotes');


function proContext(userId) {
  return db.prepare(`SELECT s.*, u.name FROM suppliers s JOIN users u ON u.id = s.user_id
    WHERE s.user_id = ?`).get(userId);
}

router.get('/quote-requests', requireApproved, (req, res) => {
  const me = proContext(req.user.id);
  if (!me || me.lat == null) return res.json({ requests: [] });
  // Offline pros still see booked requests (a later time, and all detailing): those wait for
  // the pro to accept or decline, so they can answer whenever they open the app.
  const offline = !me.online;
  if (balance.isBlocked(req.user.id)) {
    return res.json({ requests: [], ...balance.status(req.user.id) });
  }
  const maxRadius = Number(getSetting('dispatch_radius_km', '25'));
  const limit = Math.min(me.radius_km || maxRadius, maxRadius);
  const mine = (me.services || 'carwash').split(',');

  const rows = db.prepare(`
    SELECT r.*, q.id AS my_quote_id, q.supplier_price_cents AS my_price_cents,
           q.availability AS my_availability, q.source AS my_source, q.status AS my_quote_status
    FROM quote_requests r
    LEFT JOIN quotes q ON q.request_id = r.id AND q.supplier_id = ?
    WHERE r.status = 'open' AND datetime('now') <= r.expires_at
      AND (SELECT is_demo FROM users WHERE id = r.customer_id) = (SELECT is_demo FROM users WHERE id = ?)
    ORDER BY r.id DESC LIMIT 40`).all(req.user.id, req.user.id);

  const listed = {};
  for (const x of db.prepare('SELECT service, package, price_cents FROM supplier_prices WHERE user_id = ?').all(req.user.id)) {
    listed[`${x.service}:${x.package}`] = x.price_cents;
  }
  // A request this pro declined is gone from their list for good (it used to stay, so
  // Decline looked like it did nothing).
  const requests = rows.filter((r) => mine.includes(r.service) && r.my_quote_status !== 'declined'
    && (!offline || quotes.needsAcceptance(r))).map((r) => {
    const distance = dispatch.haversineKm(r.lat, r.lng, me.lat, me.lng);
    if (distance > limit) return null;
    const svc = SERVICES[r.service];
    return {
      id: r.id,
      service: r.service,
      service_name: svc?.name || r.service,
      package: r.package,
      package_name: svc?.packages[r.package]?.name || r.package,
      unit_name: svc?.units[r.vehicle]?.name || r.vehicle,
      unit_label: svc?.unitLabel || '',
      address: r.address,
      notes: r.notes,
      return_to: r.return_address ? {
        address: r.return_address, notes: r.return_notes, receiver: r.return_receiver,
        window_start: r.return_window_start,
        distance_km: +dispatch.haversineKm(r.return_lat, r.return_lng, me.lat, me.lng).toFixed(1),
      } : null,
      return_leg_fee_cents: r.return_address
        ? quotes.returnLegFor(dispatch.haversineKm(r.return_lat, r.return_lng, me.lat, me.lng), me.return_per_km_cents) : 0,
      scheduled_for: r.scheduled_for || null,
      when_label: quotes.whenLabel(r.scheduled_for),
      distance_km: +distance.toFixed(1),
      callout_fee_cents: quotes.calloutFor(distance),
      suggested_cents: svc?.packages[r.package]?.base ?? null,
      fee_pct: quotes.feePctFor(r.service),
      // Booked: the pro accepts or declines the slot; their own list price pre-fills it.
      book_ahead: quotes.needsAcceptance(r),
      my_listed_cents: listed[`${r.service}:${r.package}`] != null
        ? priceForUnit(r.service, r.package, r.vehicle, listed[`${r.service}:${r.package}`]) : null,
      answer_by: quotes.needsAcceptance(r) ? quotes.whenLabel(quotes.utcToWall(r.expires_at)) : null,
      created_at: r.created_at,
      expires_at: r.expires_at,
      my_quote: r.my_quote_id ? {
        id: r.my_quote_id, price_cents: r.my_price_cents,
        availability: r.my_availability, source: r.my_source, status: r.my_quote_status,
      } : null,
    };
  }).filter(Boolean);

  res.json({ requests, fee_pct: quotes.feePctFor('carwash') });
});

// Send (or replace) my price and availability for one request.
router.post('/quote-requests/:id/quote', requireApproved, (req, res) => {
  const me = proContext(req.user.id);
  if (!me || me.lat == null) return res.status(400).json({ error: 'Set your location before quoting' });
  if (balance.isBlocked(req.user.id)) return res.status(402).json({ error: balance.blockedMessage(req.user.id) });

  // Same demo rule as the list: a request id typed by hand does not cross the line.
  const request = db.prepare(`SELECT * FROM quote_requests r WHERE r.id = ? AND r.status = 'open'
    AND (SELECT is_demo FROM users WHERE id = r.customer_id) = (SELECT is_demo FROM users WHERE id = ?)`)
    .get(req.params.id, req.user.id);
  if (!request) return res.status(409).json({ error: 'That request is no longer open' });
  // Booked requests can be answered offline; "as soon as possible" ones need the pro online.
  if (!me.online && !quotes.needsAcceptance(request)) return res.status(400).json({ error: 'Go online before quoting' });
  const expired = db.prepare("SELECT datetime('now') > ? AS x").get(request.expires_at).x;
  if (expired) return res.status(409).json({ error: 'That request has expired' });
  if (!(me.services || 'carwash').split(',').includes(request.service)) {
    return res.status(403).json({ error: 'You do not offer that service' });
  }

  const cents = Math.round(Number(req.body?.price_cents));
  if (!Number.isFinite(cents) || cents < 2000 || cents > 2000000) {
    return res.status(400).json({ error: 'Your price must be between R20 and R20 000' });
  }
  const maxRadius = Number(getSetting('dispatch_radius_km', '25'));
  const limit = Math.min(me.radius_km || maxRadius, maxRadius);
  const distance = dispatch.haversineKm(request.lat, request.lng, me.lat, me.lng);
  if (distance > limit) return res.status(403).json({ error: 'That job is outside your travel radius' });

  const returnKm = request.return_lat != null
    ? dispatch.haversineKm(request.return_lat, request.return_lng, me.lat, me.lng) : null;
  const priorQuote = db.prepare('SELECT status FROM quotes WHERE request_id = ? AND supplier_id = ?').get(request.id, req.user.id);
  const total = quotes.insertQuote({
    requestId: request.id,
    supplierId: req.user.id,
    supplierPrice: cents,
    distanceKm: distance,
    returnDistanceKm: returnKm,
    availability: String(req.body?.availability || '').slice(0, 80) || null,
    note: String(req.body?.note || '').slice(0, 200) || null,
    source: 'manual',
  });
  quotes.notifyCustomer(request);
  // Booked: the customer hears only when a pro accepts, and only once per pro, not on every edit.
  if (!priorQuote || priorQuote.status !== 'open') quotes.tellCustomerAccepted(request, req.user.id, total);
  res.json({ ok: true, total_cents: total,
    you_earn_cents: cents + quotes.calloutFor(distance) + quotes.returnLegFor(returnKm, me.return_per_km_cents) });
});

// Not interested — stop showing it to me.
router.post('/quote-requests/:id/decline', requireApproved, (req, res) => {
  const request = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  db.prepare(`INSERT INTO quotes (request_id, supplier_id, supplier_price_cents, total_cents, status)
    VALUES (?, ?, 0, 0, 'declined')
    ON CONFLICT(request_id, supplier_id) DO UPDATE SET status = 'declined'`)
    .run(request.id, req.user.id);
  quotes.notifyCustomer(request);
  res.json({ ok: true });
});

/* ---------- job alert channels ---------- */
const whatsapp = require('../whatsapp');

router.get('/alerts', (req, res) => {
  const row = db.prepare(`SELECT u.phone, u.phone_verified_at, s.alert_whatsapp
    FROM users u JOIN suppliers s ON s.user_id = u.id WHERE u.id = ?`).get(req.user.id);
  res.json({
    phone: row?.phone || null,
    // Without codes (see whatsapp.codesEnabled) the number on file is the alert number.
    phone_verified: !!row?.phone_verified_at || (!whatsapp.codesEnabled() && !!row?.phone),
    codes_enabled: whatsapp.codesEnabled(),
    whatsapp_enabled: !!row?.alert_whatsapp,
    // Only offered once WhatsApp is actually connected. In dry run the code never reaches
    // the pro's phone, so on the live site the card was a dead end ("we sent a code"; none
    // came). Locally it still shows, so the flow stays testable against the dry run.
    whatsapp_available: getSetting('whatsapp_alerts_enabled', '1') === '1'
      && (whatsapp.configured() || process.env.NODE_ENV !== 'production'),
  });
});

router.post('/alerts', (req, res) => {
  const { whatsapp_enabled } = req.body || {};
  db.prepare('UPDATE suppliers SET alert_whatsapp = ? WHERE user_id = ?')
    .run(whatsapp_enabled ? 1 : 0, req.user.id);
  res.json({ ok: true, whatsapp_enabled: !!whatsapp_enabled });
});

// While codes are not available, a pro changes their alert number directly.
router.post('/phone', (req, res) => {
  if (whatsapp.codesEnabled()) return res.status(400).json({ error: 'Confirm the number with a code instead' });
  const raw = String(req.body?.phone || '').trim();
  if (!/^27[678]\d{8}$/.test(whatsapp.toE164(raw) || '')) {
    return res.status(400).json({ error: 'Enter your South African WhatsApp number, e.g. 082 555 1234' });
  }
  db.prepare('UPDATE users SET phone = ?, phone_verified_at = NULL WHERE id = ?').run(raw, req.user.id);
  res.json({ ok: true });
});

// Step 1: send a code to the number the pro says is theirs.
router.post('/phone/verify/send', async (req, res) => {
  const raw = String(req.body?.phone || '').trim();
  const normalised = whatsapp.toE164(raw);
  if (!normalised) return res.status(400).json({ error: 'Enter a valid South African mobile number' });

  // One send per minute — a resend button should not become an SMS bill.
  const prev = db.prepare('SELECT sent_at FROM phone_verifications WHERE user_id = ?').get(req.user.id);
  if (prev) {
    const waited = db.prepare("SELECT (julianday('now') - julianday(?)) * 86400 AS s").get(prev.sent_at).s;
    if (waited < 60) return res.status(429).json({ error: `Wait ${Math.ceil(60 - waited)}s before requesting another code` });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(`INSERT INTO phone_verifications (user_id, phone, code, attempts, expires_at, sent_at)
    VALUES (?, ?, ?, 0, datetime('now','+10 minutes'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, code = excluded.code,
      attempts = 0, expires_at = excluded.expires_at, sent_at = excluded.sent_at`)
    .run(req.user.id, raw, code);

  const result = await whatsapp.verifyCode({ userId: req.user.id, phone: raw, code });
  if (!result.ok) return res.status(502).json({ error: 'Could not send the code to that number. Check it and try again.' });
  res.json({ ok: true, dry_run: result.status === 'dry_run' });
});

// Step 2: confirm the code, then the number is trusted for job alerts.
router.post('/phone/verify/confirm', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const row = db.prepare('SELECT * FROM phone_verifications WHERE user_id = ?').get(req.user.id);
  if (!row) return res.status(400).json({ error: 'Request a code first' });
  const expired = db.prepare("SELECT datetime('now') > ? AS x").get(row.expires_at).x;
  if (expired) return res.status(400).json({ error: 'That code has expired — request a new one' });
  if (row.attempts >= 5) return res.status(429).json({ error: 'Too many attempts — request a new code' });
  if (code !== row.code) {
    db.prepare('UPDATE phone_verifications SET attempts = attempts + 1 WHERE user_id = ?').run(req.user.id);
    return res.status(400).json({ error: 'That code does not match' });
  }
  db.prepare("UPDATE users SET phone = ?, phone_verified_at = datetime('now') WHERE id = ?").run(row.phone, req.user.id);
  db.prepare('DELETE FROM phone_verifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/earnings', (req, res) => {
  // Pros keep 100% of their own price plus the callout. Our fee was charged on top,
  // to the customer — it never comes out of their money.
  const row = db.prepare(`SELECT COUNT(*) AS jobs,
      COALESCE(SUM(supplier_price_cents + callout_fee_cents),0) AS earned,
      COALESCE(SUM(platform_fee_cents),0) AS fees
    FROM orders WHERE supplier_id = ? AND status = 'completed'`).get(req.user.id);
  // Cash jobs: the pro collected our fee at the door, so it is owed back to us.
  const owed = balance.cashOwed(req.user.id);
  res.json({
    jobs: row.jobs,
    earned_cents: row.earned,
    fees_cents: row.fees,
    fee_owed_cents: owed,
    fee_pct: quotes.feePctFor('carwash'),
    ...balance.status(req.user.id),
  });
});

module.exports = router;
module.exports.completeOrder = completeOrder; // the demo autopilot closes demo jobs the same way
