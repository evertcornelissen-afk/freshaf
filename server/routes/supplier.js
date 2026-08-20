const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { db, getSetting } = require('../db');
const { authRequired } = require('../auth');
const dispatch = require('../dispatch');
const realtime = require('../realtime');

const router = express.Router();
router.use(authRequired('supplier'));

// ---------- onboarding documents (allowed while pending — that's when they're needed) ----------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.pdf'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.user.id}-${req.body.kind || 'doc'}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()));
  },
});

router.post('/documents', upload.single('file'), (req, res) => {
  const kind = req.body.kind;
  if (!['id_copy', 'proof_address', 'work_photo'].includes(kind)) {
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
  res.json({ ok: true });
});

router.get('/documents', (req, res) => {
  const docs = db.prepare('SELECT kind, original_name, uploaded_at FROM supplier_docs WHERE user_id = ?').all(req.user.id);
  res.json({ documents: docs });
});

function requireApproved(req, res, next) {
  const s = db.prepare('SELECT status FROM suppliers WHERE user_id = ?').get(req.user.id);
  if (!s || s.status !== 'approved') return res.status(403).json({ error: 'Your supplier account is not approved yet' });
  next();
}

/* ---------- pro-set pricing ---------- */
const { SERVICES, SERVICE_KEYS, quote } = require('../pricing');

router.get('/prices', (req, res) => {
  const s = db.prepare('SELECT services FROM suppliers WHERE user_id = ?').get(req.user.id);
  const mine = db.prepare('SELECT service, package, price_cents FROM supplier_prices WHERE user_id = ?').all(req.user.id);
  const set = {};
  for (const r of mine) set[`${r.service}:${r.package}`] = r.price_cents;
  const out = {};
  for (const svcKey of (s?.services || 'carwash').split(',')) {
    const svc = SERVICES[svcKey];
    if (!svc) continue;
    out[svcKey] = {
      name: svc.name,
      unitLabel: svc.unitLabel,
      units: Object.values(svc.units),
      packages: Object.values(svc.packages).map((p) => ({
        key: p.key, name: p.name, desc: p.desc, eta: p.eta,
        suggested_cents: p.base,
        price_cents: set[`${svcKey}:${p.key}`] ?? null,
      })),
    };
  }
  res.json({ services: out, fee_pct: Number(getSetting('platform_fee_pct', '10')) });
});

router.post('/prices', (req, res) => {
  const prices = req.body?.prices;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'Send a prices array' });
  const allowed = (db.prepare('SELECT services FROM suppliers WHERE user_id = ?').get(req.user.id)?.services || 'carwash').split(',');
  for (const p of prices) {
    if (!SERVICE_KEYS.includes(p.service) || !allowed.includes(p.service)) {
      return res.status(400).json({ error: 'You do not offer that service' });
    }
    if (!SERVICES[p.service].packages[p.package]) return res.status(400).json({ error: 'Unknown package' });
    const cents = Math.round(Number(p.price_cents));
    if (!Number.isFinite(cents) || cents < 2000 || cents > 2000000) {
      return res.status(400).json({ error: 'Prices must be between R20 and R20 000' });
    }
    db.prepare(`INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, service, package) DO UPDATE SET price_cents = excluded.price_cents`)
      .run(req.user.id, p.service, p.package, cents);
  }
  res.json({ ok: true });
});

router.post('/online', requireApproved, (req, res) => {
  const { online, lat, lng, radius_km } = req.body || {};
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

router.post('/jobs/:orderId/advance', requireApproved, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND supplier_id = ?').get(req.params.orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Job not found' });
  const next = STATUS_FLOW[order.status];
  if (!next) return res.status(400).json({ error: 'Job cannot be advanced from its current status' });

  if (next === 'completed') {
    // Our fee was already added on top at booking — record it as the platform's revenue.
    const commission = order.platform_fee_cents || 0;
    const payment = order.payment_method === 'cash' ? 'collected' : order.payment_status;
    // Money-back rewards: customer earns a % of the full order value on completion.
    const earnPct = Number(getSetting('points_earn_pct', '5'));
    const earned = Math.round(order.price_cents * earnPct / 100);
    db.prepare(`UPDATE orders SET status = 'completed', completed_at = datetime('now'),
      commission_cents = ?, payment_status = ?, points_earned_cents = ? WHERE id = ?`)
      .run(commission, payment, earned, order.id);
    if (earned > 0) {
      db.prepare('UPDATE users SET points_cents = points_cents + ? WHERE id = ?').run(earned, order.customer_id);
    }
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(next, order.id);
  }
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  dispatch.notifyCustomer(updated);
  res.json({ order: dispatch.orderPublic(updated) });
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
  if (!me || !me.online || me.lat == null) return res.json({ requests: [] });
  const maxRadius = Number(getSetting('dispatch_radius_km', '25'));
  const limit = Math.min(me.radius_km || maxRadius, maxRadius);
  const mine = (me.services || 'carwash').split(',');

  const rows = db.prepare(`
    SELECT r.*, q.id AS my_quote_id, q.supplier_price_cents AS my_price_cents,
           q.availability AS my_availability, q.source AS my_source, q.status AS my_quote_status
    FROM quote_requests r
    LEFT JOIN quotes q ON q.request_id = r.id AND q.supplier_id = ?
    WHERE r.status = 'open' AND datetime('now') <= r.expires_at
    ORDER BY r.id DESC LIMIT 40`).all(req.user.id);

  const requests = rows.filter((r) => mine.includes(r.service)).map((r) => {
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
      scheduled_for: r.scheduled_for || null,
      when_label: quotes.whenLabel(r.scheduled_for),
      distance_km: +distance.toFixed(1),
      callout_fee_cents: quotes.calloutFor(distance),
      suggested_cents: svc?.packages[r.package]?.base ?? null,
      created_at: r.created_at,
      expires_at: r.expires_at,
      my_quote: r.my_quote_id ? {
        id: r.my_quote_id, price_cents: r.my_price_cents,
        availability: r.my_availability, source: r.my_source, status: r.my_quote_status,
      } : null,
    };
  }).filter(Boolean);

  res.json({ requests, fee_pct: Number(getSetting('platform_fee_pct', '10')) });
});

// Send (or replace) my price and availability for one request.
router.post('/quote-requests/:id/quote', requireApproved, (req, res) => {
  const me = proContext(req.user.id);
  if (!me || !me.online || me.lat == null) return res.status(400).json({ error: 'Go online before quoting' });

  const request = db.prepare("SELECT * FROM quote_requests WHERE id = ? AND status = 'open'").get(req.params.id);
  if (!request) return res.status(409).json({ error: 'That request is no longer open' });
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

  const total = quotes.insertQuote({
    requestId: request.id,
    supplierId: req.user.id,
    supplierPrice: cents,
    distanceKm: distance,
    availability: String(req.body?.availability || '').slice(0, 80) || null,
    note: String(req.body?.note || '').slice(0, 200) || null,
    source: 'manual',
  });
  quotes.notifyCustomer(request);
  res.json({ ok: true, total_cents: total, you_earn_cents: cents + quotes.calloutFor(distance) });
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
    phone_verified: !!row?.phone_verified_at,
    whatsapp_enabled: !!row?.alert_whatsapp,
    whatsapp_available: getSetting('whatsapp_alerts_enabled', '1') === '1',
  });
});

router.post('/alerts', (req, res) => {
  const { whatsapp_enabled } = req.body || {};
  db.prepare('UPDATE suppliers SET alert_whatsapp = ? WHERE user_id = ?')
    .run(whatsapp_enabled ? 1 : 0, req.user.id);
  res.json({ ok: true, whatsapp_enabled: !!whatsapp_enabled });
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
  const owed = db.prepare(`SELECT COALESCE(SUM(platform_fee_cents),0) AS c
    FROM orders WHERE supplier_id = ? AND status = 'completed'
      AND payment_method = 'cash' AND fee_settled = 0`).get(req.user.id).c;
  res.json({
    jobs: row.jobs,
    earned_cents: row.earned,
    fees_cents: row.fees,
    fee_owed_cents: owed,
    fee_pct: Number(getSetting('platform_fee_pct', '10')),
  });
});

module.exports = router;
