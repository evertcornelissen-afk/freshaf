const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'freshaf.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('customer','supplier','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  business_name TEXT NOT NULL,
  id_number TEXT NOT NULL,
  vehicle_reg TEXT,
  service_area TEXT,
  equipment_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  status_reason TEXT,
  online INTEGER NOT NULL DEFAULT 0,
  lat REAL, lng REAL,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  supplier_id INTEGER REFERENCES users(id),
  service TEXT NOT NULL DEFAULT 'carwash',
  package TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_cents INTEGER,
  address TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  notes TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card','cash')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','collect_on_completion','collected','refunded')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','searching','accepted','en_route','in_progress','completed','cancelled','no_providers')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  supplier_id INTEGER NOT NULL REFERENCES users(id),
  distance_km REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  supplier_id INTEGER NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_offers_order ON offers(order_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON offers(supplier_id, status);
`);

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Defensive migrations for databases created before these columns existed.
function addColumn(table, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`); } catch { /* already exists */ }
}
addColumn('users', 'points_cents INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'terms_accepted_at TEXT');
addColumn('users', 'home_address TEXT');
addColumn('users', 'home_lat REAL');
addColumn('users', 'home_lng REAL');
addColumn('suppliers', "services TEXT NOT NULL DEFAULT 'carwash'");
addColumn('orders', 'callout_fee_cents INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'points_used_cents INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'points_earned_cents INTEGER NOT NULL DEFAULT 0');

if (!getSetting('commission_pct')) setSetting('commission_pct', '15');
if (!getSetting('dispatch_radius_km')) setSetting('dispatch_radius_km', '25');
if (!getSetting('offer_timeout_sec')) setSetting('offer_timeout_sec', '60');
if (!getSetting('points_earn_pct')) setSetting('points_earn_pct', '5');
if (!getSetting('callout_free_km')) setSetting('callout_free_km', '5');
if (!getSetting('callout_per_km_cents')) setSetting('callout_per_km_cents', '1000');
if (!getSetting('callout_cap_cents')) setSetting('callout_cap_cents', '15000');

// Seed admin account
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@freshaf.co.za';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'FreshAF!Admin2026';
const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!adminExists) {
  db.prepare('INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('admin', 'FreshAF Admin', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  console.log(`[FreshAF] Admin account created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} — change ADMIN_PASSWORD in .env for production.`);
}

module.exports = { db, getSetting, setSetting };
