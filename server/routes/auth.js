const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { setAuthCookie, clearAuthCookie, readToken, authRequired } = require('../auth');

const router = express.Router();

function supplierProfile(userId) {
  return db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(userId) || null;
}

function mePayload(user) {
  const out = { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone };
  if (user.role === 'customer') {
    out.points_cents = user.points_cents || 0;
    out.home_address = user.home_address || null;
    out.home_lat = user.home_lat;
    out.home_lng = user.home_lng;
  }
  if (user.role === 'supplier') {
    const s = supplierProfile(user.id);
    out.supplier = s && {
      business_name: s.business_name, status: s.status, status_reason: s.status_reason,
      online: !!s.online, lat: s.lat, lng: s.lng, service_area: s.service_area,
      services: (s.services || 'carwash').split(','),
      rating: s.rating_count ? +(s.rating_sum / s.rating_count).toFixed(1) : null,
      rating_count: s.rating_count,
    };
  }
  return out;
}

const VALID_SERVICES = ['carwash', 'laundry'];

router.post('/register', (req, res) => {
  const { role, name, email, phone, password, home_address, accept_terms,
    business_name, id_number, vehicle_reg, service_area, equipment_notes, services,
    bank_name, bank_account, bank_branch, vehicles, equipment } = req.body || {};

  // Structured onboarding data: multiple vehicles + itemised equipment.
  const cleanVehicles = (Array.isArray(vehicles) ? vehicles : []).slice(0, 10)
    .map((v) => ({
      type: String(v?.type || '').slice(0, 30),
      reg: String(v?.reg || '').trim().slice(0, 20),
      model: String(v?.model || '').trim().slice(0, 60),
    }))
    .filter((v) => v.reg || v.model);
  const cleanEquipment = {
    items: (Array.isArray(equipment?.items) ? equipment.items : []).slice(0, 30)
      .map((i) => ({
        key: String(i?.key || '').slice(0, 40),
        label: String(i?.label || '').slice(0, 60),
        qty: i?.qty ? Number(i.qty) || null : null,
      }))
      .filter((i) => i.label),
    other: String(equipment?.other || '').trim().slice(0, 300),
  };

  if (!['customer', 'supplier'].includes(role)) return res.status(400).json({ error: 'Invalid account type' });
  if (accept_terms !== true) return res.status(400).json({ error: 'You must accept the Terms & Conditions to create an account' });
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return res.status(400).json({ error: 'Invalid email address' });
  if (role === 'customer' && !home_address?.trim()) {
    return res.status(400).json({ error: 'Your preferred address is required' });
  }
  let supplierServices = ['carwash'];
  if (role === 'supplier') {
    if (!business_name?.trim() || !id_number?.trim()) {
      return res.status(400).json({ error: 'Business name and ID number are required for suppliers' });
    }
    supplierServices = Array.isArray(services) ? services.filter((s) => VALID_SERVICES.includes(s)) : [];
    if (!supplierServices.length) return res.status(400).json({ error: 'Choose at least one service you offer' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const info = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, home_address, terms_accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(role, name.trim(), email.trim(), phone?.trim() || null, bcrypt.hashSync(password, 10),
      home_address?.trim() || null);
  const userId = Number(info.lastInsertRowid);

  if (role === 'supplier') {
    // Legacy text summaries keep older views working; structured JSON is the source of truth.
    const vehicleSummary = cleanVehicles.map((v) => [v.type, v.model, v.reg].filter(Boolean).join(' ')).join('; ')
      || vehicle_reg?.trim() || null;
    const equipmentSummary = [
      ...cleanEquipment.items.map((i) => i.qty ? `${i.label} ×${i.qty}` : i.label),
      cleanEquipment.other,
    ].filter(Boolean).join(', ') || equipment_notes?.trim() || null;
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, vehicle_reg, service_area, equipment_notes, services,
                bank_name, bank_account, bank_branch, vehicles_json, equipment_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, business_name.trim(), id_number.trim(), vehicleSummary,
        service_area?.trim() || null, equipmentSummary, supplierServices.join(','),
        bank_name?.trim() || null, bank_account?.trim() || null, bank_branch?.trim() || null,
        JSON.stringify(cleanVehicles), JSON.stringify(cleanEquipment));
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  setAuthCookie(res, user);
  res.json({ user: mePayload(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email && db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  setAuthCookie(res, user);
  res.json({ user: mePayload(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const payload = readToken(req);
  if (!payload) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.json({ user: null });
  res.json({ user: mePayload(user) });
});

// Update profile details (name, phone, preferred address).
router.post('/profile', authRequired('customer', 'supplier'), (req, res) => {
  const { name, phone, home_address } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  // A changed address invalidates the saved map pin until the next order sets it again.
  const addressChanged = user.role === 'customer' && home_address?.trim() && home_address.trim() !== user.home_address;
  db.prepare('UPDATE users SET name = ?, phone = ?, home_address = COALESCE(?, home_address) WHERE id = ?')
    .run(name.trim(), phone?.trim() || null, home_address?.trim() || null, req.user.id);
  if (addressChanged) db.prepare('UPDATE users SET home_lat = NULL, home_lng = NULL WHERE id = ?').run(req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: mePayload(updated) });
});

// Permanent account deletion (required for app-store listing). Anonymises the user so
// completed-order history and marketplace accounting stay intact.
router.post('/delete-account', authRequired('customer', 'supplier'), (req, res) => {
  const { password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const active = db.prepare(`SELECT id FROM orders
    WHERE (customer_id = ? OR supplier_id = ?)
    AND status IN ('pending_payment','searching','accepted','en_route','in_progress')`).get(user.id, user.id);
  if (active) return res.status(409).json({ error: 'Complete or cancel your active orders before deleting your account' });

  if (user.role === 'supplier') {
    db.prepare(`UPDATE suppliers SET status = 'suspended', online = 0, status_reason = 'Account deleted by owner'
      WHERE user_id = ?`).run(user.id);
  }
  db.prepare(`UPDATE users SET name = 'Deleted user', email = ?, phone = NULL,
    home_address = NULL, home_lat = NULL, home_lng = NULL, points_cents = 0, password_hash = ?
    WHERE id = ?`)
    .run(`deleted-${user.id}-${Date.now()}@freshaf.invalid`, bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10), user.id);
  clearAuthCookie(res);
  res.json({ ok: true });
});

module.exports = router;
