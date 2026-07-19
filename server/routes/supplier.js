const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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

router.post('/online', requireApproved, (req, res) => {
  const { online, lat, lng } = req.body || {};
  if (online) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Set your current location to go online' });
    }
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
    const pct = Number(getSetting('commission_pct', '15'));
    const commission = Math.round(order.price_cents * pct / 100);
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

router.get('/earnings', (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) AS jobs, COALESCE(SUM(price_cents),0) AS gross,
    COALESCE(SUM(commission_cents),0) AS commission
    FROM orders WHERE supplier_id = ? AND status = 'completed'`).get(req.user.id);
  res.json({
    jobs: row.jobs,
    gross_cents: row.gross,
    commission_cents: row.commission,
    net_cents: row.gross - row.commission,
    commission_pct: Number(getSetting('commission_pct', '15')),
  });
});

module.exports = router;
