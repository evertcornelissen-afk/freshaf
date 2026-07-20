const express = require('express');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting } = require('../db');
const { authRequired } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();
router.use(authRequired('admin'));

// Bulk-import pre-approved suppliers. Each row: { name, email, phone, business_name,
// id_number, service_area, services: ['carwash','laundry'] }. Returns a generated
// temporary password per created supplier so the admin can hand out credentials.
router.post('/suppliers/import', (req, res) => {
  const rows = req.body?.suppliers;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Provide a suppliers array' });
  if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 suppliers per import' });

  const results = [];
  for (const r of rows) {
    const email = r.email?.trim().toLowerCase();
    const services = (Array.isArray(r.services) ? r.services : ['carwash']).filter((s) => ['carwash', 'laundry'].includes(s));
    if (!r.name?.trim() || !email || !r.business_name?.trim() || !r.id_number?.trim() || !services.length) {
      results.push({ email: email || '(missing)', status: 'invalid', reason: 'name, email, business_name, id_number and services are required' });
      continue;
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      results.push({ email, status: 'skipped', reason: 'email already registered' });
      continue;
    }
    const tempPassword = crypto.randomBytes(6).toString('base64url'); // 8 chars, urlsafe
    const info = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, terms_accepted_at)
      VALUES ('supplier', ?, ?, ?, ?, NULL)`)
      .run(r.name.trim(), email, r.phone?.trim() || null, bcrypt.hashSync(tempPassword, 10));
    const userId = Number(info.lastInsertRowid);
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, vehicle_reg, service_area, equipment_notes, services, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`)
      .run(userId, r.business_name.trim(), r.id_number.trim(), r.vehicle_reg?.trim() || null,
        r.service_area?.trim() || null, r.equipment_notes?.trim() || null, services.join(','));
    results.push({ email, status: 'created', temp_password: tempPassword, user_id: userId });
  }
  res.json({ results, created: results.filter((x) => x.status === 'created').length });
});

router.get('/suppliers', (req, res) => {
  const status = req.query.status;
  const base = `
    SELECT s.*, u.name, u.email, u.phone, u.created_at AS user_created_at
    FROM suppliers s JOIN users u ON u.id = s.user_id`;
  const rows = status
    ? db.prepare(`${base} WHERE s.status = ? ORDER BY s.created_at DESC`).all(status)
    : db.prepare(`${base} ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`).all();
  res.json({
    suppliers: rows.map((r) => ({
      user_id: r.user_id, name: r.name, email: r.email, phone: r.phone,
      business_name: r.business_name, id_number: r.id_number, vehicle_reg: r.vehicle_reg,
      service_area: r.service_area, equipment_notes: r.equipment_notes,
      services: (r.services || 'carwash').split(','),
      vehicles: JSON.parse(r.vehicles_json || '[]'),
      equipment: JSON.parse(r.equipment_json || 'null'),
      bank_name: r.bank_name, bank_account: r.bank_account, bank_branch: r.bank_branch,
      documents: db.prepare('SELECT id, kind, original_name FROM supplier_docs WHERE user_id = ?').all(r.user_id),
      status: r.status, status_reason: r.status_reason, online: !!r.online,
      rating: r.rating_count ? +(r.rating_sum / r.rating_count).toFixed(1) : null,
      rating_count: r.rating_count, created_at: r.created_at,
    })),
  });
});

function setSupplierStatus(req, res, status) {
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const reason = req.body?.reason?.trim() || null;
  const online = status === 'approved' ? s.online : 0;
  db.prepare('UPDATE suppliers SET status = ?, status_reason = ?, online = ? WHERE user_id = ?')
    .run(status, reason, online, s.user_id);
  realtime.send(s.user_id, 'account_update', { status, reason });
  res.json({ ok: true });
}

// Stream an onboarding document to the reviewing admin.
router.get('/docs/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM supplier_docs WHERE id = ?').get(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.sendFile(path.join(__dirname, '..', '..', 'data', 'uploads', doc.stored_name));
});

router.post('/suppliers/:id/approve', (req, res) => setSupplierStatus(req, res, 'approved'));
router.post('/suppliers/:id/reject', (req, res) => setSupplierStatus(req, res, 'rejected'));
router.post('/suppliers/:id/suspend', (req, res) => setSupplierStatus(req, res, 'suspended'));

router.get('/orders', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, cu.name AS customer_name, su.name AS supplier_name
    FROM orders o
    JOIN users cu ON cu.id = o.customer_id
    LEFT JOIN users su ON su.id = o.supplier_id
    ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows });
});

router.get('/stats', (req, res) => {
  const stats = {
    customers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c,
    suppliers_pending: db.prepare("SELECT COUNT(*) c FROM suppliers WHERE status = 'pending'").get().c,
    suppliers_approved: db.prepare("SELECT COUNT(*) c FROM suppliers WHERE status = 'approved'").get().c,
    suppliers_online: db.prepare("SELECT COUNT(*) c FROM suppliers WHERE status = 'approved' AND online = 1").get().c,
    orders_total: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    orders_active: db.prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('searching','accepted','en_route','in_progress')").get().c,
    orders_completed: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'completed'").get().c,
    orders_carwash: db.prepare("SELECT COUNT(*) c FROM orders WHERE service = 'carwash'").get().c,
    orders_laundry: db.prepare("SELECT COUNT(*) c FROM orders WHERE service = 'laundry'").get().c,
    revenue_cents: db.prepare("SELECT COALESCE(SUM(commission_cents),0) c FROM orders WHERE status = 'completed'").get().c,
  };
  res.json(stats);
});

router.get('/settings', (req, res) => {
  res.json({
    commission_pct: Number(getSetting('commission_pct', '15')),
    dispatch_radius_km: Number(getSetting('dispatch_radius_km', '25')),
    offer_timeout_sec: Number(getSetting('offer_timeout_sec', '60')),
    points_earn_pct: Number(getSetting('points_earn_pct', '5')),
    callout_free_km: Number(getSetting('callout_free_km', '5')),
    callout_per_km_cents: Number(getSetting('callout_per_km_cents', '1000')),
    callout_cap_cents: Number(getSetting('callout_cap_cents', '15000')),
  });
});

router.post('/settings', (req, res) => {
  const { commission_pct, dispatch_radius_km, offer_timeout_sec,
    points_earn_pct, callout_free_km, callout_per_km_cents, callout_cap_cents } = req.body || {};
  const checks = [
    ['commission_pct', commission_pct, 0, 50],
    ['dispatch_radius_km', dispatch_radius_km, 1, 200],
    ['offer_timeout_sec', offer_timeout_sec, 10, 600],
    ['points_earn_pct', points_earn_pct, 0, 50],
    ['callout_free_km', callout_free_km, 0, 100],
    ['callout_per_km_cents', callout_per_km_cents, 0, 10000],
    ['callout_cap_cents', callout_cap_cents, 0, 100000],
  ];
  for (const [key, val, min, max] of checks) {
    if (val === undefined) continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) {
      return res.status(400).json({ error: `${key} must be between ${min} and ${max}` });
    }
    setSetting(key, n);
  }
  res.json({ ok: true });
});

module.exports = router;
