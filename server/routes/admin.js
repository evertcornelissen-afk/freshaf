const express = require('express');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, DEFAULT_ADMIN_PASSWORD } = require('../db');
const { authRequired, rotateSession } = require('../auth');
const realtime = require('../realtime');
const push = require('../push');
const balance = require('../balance');
const secrets = require('../secrets');
const mailer = require('../mailer');

const router = express.Router();

// Second factor for the whole admin surface.
//
// Taking the dashboard off the public site hides the page, not the API — anyone can
// still POST to /api/admin/* if they guess an admin password. This closes that: when
// ADMIN_API_KEY is set, every admin call must also carry it, and the key lives only in
// the operator's desktop app. A stolen password on its own opens nothing.
//
// Compared in constant time, because a plain !== leaks the key one character at a time
// to anyone willing to measure.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
if (!ADMIN_API_KEY) {
  console.warn('[FreshAF] ADMIN_API_KEY is not set — the admin API is protected by the '
    + 'admin password alone. Set it on Render and in admin-app/.env.');
}
router.use((req, res, next) => {
  if (!ADMIN_API_KEY) return next();
  const given = String(req.get('x-admin-key') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(ADMIN_API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).send('Not found'); // 404, not 403: do not confirm this exists
  }
  next();
});

router.use(authRequired('admin'));

// Bulk-import pre-approved suppliers. Each row: { name, email, phone, business_name,
// id_number, service_area, radius_km, vehicle_reg, equipment_notes,
// services: ['carwash','laundry'] }. Returns a generated temporary password per created
// supplier so the admin can hand out credentials.
//
// The fields line up with the Load sheet of the Pro vetting questionnaire, so a completed
// form goes in without being retyped. Banking details are deliberately not importable:
// the pro enters those in the app, where they are encrypted at rest.
router.post('/suppliers/import', (req, res) => {
  const rows = req.body?.suppliers;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Provide a suppliers array' });
  if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 suppliers per import' });

  const results = [];
  for (const r of rows) {
    const email = require('../email').normEmail(r.email);
    const services = (Array.isArray(r.services) ? r.services : ['carwash']).filter((s) => ['carwash', 'laundry'].includes(s));
    if (!r.name?.trim() || !email || !r.business_name?.trim() || !r.id_number?.trim() || !services.length) {
      results.push({ email: email || '(missing)', status: 'invalid', reason: 'name, email, business_name, id_number and services are required' });
      continue;
    }
    // A pasted row with its columns one out puts a person's name here, and without this
    // the import creates a supplier account that can never be logged in to or emailed.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      results.push({ email, status: 'invalid', reason: 'that is not an email address - check the columns line up' });
      continue;
    }
    if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
      results.push({ email, status: 'skipped', reason: 'email already registered' });
      continue;
    }
    // "Furthest you will travel" off the questionnaire. Dropping it put every imported pro
    // on the global dispatch radius instead of the distance they actually agreed to cover,
    // which quietly offers them jobs they will decline.
    const km = Number(String(r.radius_km ?? '').replace(/[^\d.]/g, ''));
    const radius = Number.isFinite(km) && km > 0 ? Math.min(200, Math.max(1, km)) : null;

    const tempPassword = crypto.randomBytes(6).toString('base64url'); // 8 chars, urlsafe
    const info = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, terms_accepted_at)
      VALUES ('supplier', ?, ?, ?, ?, NULL)`)
      .run(r.name.trim(), email, r.phone?.trim() || null, bcrypt.hashSync(tempPassword, 10));
    const userId = Number(info.lastInsertRowid);
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, vehicle_reg, service_area, equipment_notes, services, radius_km, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`)
      .run(userId, r.business_name.trim(), secrets.encryptField(r.id_number.trim()), r.vehicle_reg?.trim() || null,
        r.service_area?.trim() || null, r.equipment_notes?.trim() || null, services.join(','), radius);
    results.push({ email, status: 'created', temp_password: tempPassword, user_id: userId,
      services: services.join(','), radius_km: radius });
  }
  res.json({ results, created: results.filter((x) => x.status === 'created').length });
});

// Store reviewer accounts (Google Play "App access", Apple "Sign-in Information").
//
// One demo customer and one demo pro that a reviewer can use with nobody awake: the pro is
// approved, prices every package at the suggested price, offers car wash and laundry, and
// stays ONLINE in Durbanville with a 25 km radius. Both are demo accounts, so they only ever
// see each other (and other demo accounts): no real customer or pro is involved, card
// payments go to the test page, and the demo autopilot plays a booking through to done.
//
// Pressing it again resets both passwords (and puts the pro back online) - use that if a
// password is lost or after the store review. The passwords are returned once, here, and
// are never stored or logged anywhere else.
const REVIEW_PIN = { lat: -33.8317, lng: 18.6464, address: 'Main Road, Durbanville, Cape Town, 7550' };

function reviewerPassword() {
  // 12 characters, letters and digits only, so nothing is lost copying it into a store form.
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join('');
}

function reviewerStatus() {
  const ids = { customer: Number(getSetting('reviewer_customer_id', '0')), pro: Number(getSetting('reviewer_pro_id', '0')) };
  const out = {};
  for (const [k, id] of Object.entries(ids)) {
    const u = id ? db.prepare('SELECT id, email, is_demo FROM users WHERE id = ?').get(id) : null;
    out[k] = u ? { user_id: u.id, email: u.email, is_demo: !!u.is_demo } : null;
  }
  if (out.pro) {
    const s = db.prepare('SELECT status, online, lat, lng, radius_km, services FROM suppliers WHERE user_id = ?').get(out.pro.user_id);
    Object.assign(out.pro, { status: s?.status, online: !!s?.online, radius_km: s?.radius_km, services: s?.services });
  }
  return out;
}

router.get('/reviewer-accounts', (req, res) => res.json(reviewerStatus()));

router.post('/reviewer-accounts', (req, res) => {
  const { normEmail } = require('../email');
  const { SERVICES } = require('../pricing');
  const want = {
    customer: normEmail(req.body?.customer_email),
    pro: normEmail(req.body?.pro_email),
  };
  for (const [k, email] of Object.entries(want)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) {
      return res.status(400).json({ error: `Enter a valid email for the reviewer ${k === 'pro' ? 'pro' : 'customer'}` });
    }
  }
  if (want.customer === want.pro) return res.status(400).json({ error: 'Use two different email addresses' });

  const known = { customer: Number(getSetting('reviewer_customer_id', '0')), pro: Number(getSetting('reviewer_pro_id', '0')) };
  const role = { customer: 'customer', pro: 'supplier' };
  // Refuse to take over somebody else's account: an email already in use is accepted only
  // when it is the reviewer account this button made before.
  for (const k of ['customer', 'pro']) {
    const hit = db.prepare('SELECT id, role FROM users WHERE lower(email) = ?').get(want[k]);
    if (hit && hit.id !== known[k]) {
      return res.status(409).json({ error: `${want[k]} already belongs to another account. Use a new address for the reviewer.` });
    }
  }

  const creds = {};
  for (const k of ['customer', 'pro']) {
    const password = reviewerPassword();
    const hash = bcrypt.hashSync(password, 10);
    let id = known[k] && db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(known[k], role[k])?.id;
    if (id) {
      // Reset: new password, signs out every earlier session of this account.
      db.prepare('UPDATE users SET email = ?, password_hash = ?, is_demo = 1 WHERE id = ?').run(want[k], hash, id);
      rotateSession(id);
    } else {
      const info = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, home_address, home_lat, home_lng, is_demo)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1)`)
        .run(role[k], k === 'pro' ? 'Demo Pro' : 'App Reviewer', want[k], hash,
          k === 'customer' ? REVIEW_PIN.address : null,
          k === 'customer' ? REVIEW_PIN.lat : null, k === 'customer' ? REVIEW_PIN.lng : null);
      id = Number(info.lastInsertRowid);
      setSetting(k === 'pro' ? 'reviewer_pro_id' : 'reviewer_customer_id', String(id));
    }
    if (k === 'pro') {
      const exists = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(id);
      if (!exists) {
        db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, service_area, equipment_notes, services, status)
          VALUES (?, 'FreshAF Demo Pro', ?, 'Durbanville, Cape Town', 'Demo account for app store review', 'carwash,laundry', 'approved')`)
          .run(id, secrets.encryptField('DEMO-NOT-A-PERSON'));
      }
      db.prepare(`UPDATE suppliers SET status = 'approved', status_reason = NULL, services = 'carwash,laundry',
        online = 1, lat = ?, lng = ?, radius_km = 25, alert_whatsapp = 0 WHERE user_id = ?`)
        .run(REVIEW_PIN.lat, REVIEW_PIN.lng, id);
      for (const svc of Object.values(SERVICES)) {
        for (const p of Object.values(svc.packages)) {
          db.prepare(`INSERT INTO supplier_prices (user_id, service, package, price_cents) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, service, package) DO NOTHING`).run(id, svc.key, p.key, p.base);
        }
      }
    }
    creds[k] = { email: want[k], password, user_id: id };
  }
  console.log(`[FreshAF] Store reviewer accounts set: customer ${creds.customer.user_id}, pro ${creds.pro.user_id} (demo, pro online in Durbanville)`);
  res.json({ ...creds, status: reviewerStatus() });
});

router.get('/suppliers', (req, res) => {
  const status = req.query.status;
  const base = `
    SELECT s.*, u.name, u.email, u.phone, u.is_demo, u.created_at AS user_created_at
    FROM suppliers s JOIN users u ON u.id = s.user_id`;
  const rows = status
    ? db.prepare(`${base} WHERE s.status = ? ORDER BY s.created_at DESC`).all(status)
    : db.prepare(`${base} ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`).all();
  res.json({
    suppliers: rows.map((r) => ({
      user_id: r.user_id, name: r.name, email: r.email, phone: r.phone,
      business_name: r.business_name,
      // Masked by default. A full ID or account number is almost never needed on a list
      // screen, and anything sent to a browser ends up in screenshots and support threads.
      id_number: secrets.maskTail(r.id_number), vehicle_reg: r.vehicle_reg,
      service_area: r.service_area, equipment_notes: r.equipment_notes,
      services: (r.services || 'carwash').split(','),
      vehicles: JSON.parse(r.vehicles_json || '[]'),
      equipment: JSON.parse(r.equipment_json || 'null'),
      bank_name: r.bank_name, bank_account: secrets.maskTail(r.bank_account),
      bank_branch: secrets.maskTail(r.bank_branch),
      documents: db.prepare('SELECT id, kind, original_name FROM supplier_docs WHERE user_id = ?').all(r.user_id),
      status: r.status, status_reason: r.status_reason, online: !!r.online, is_demo: !!r.is_demo,
      ...balance.status(r.user_id),
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
  // The pro is rarely looking at the app when this happens, so tell them on every channel.
  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(s.user_id);
  push.sendToUser(s.user_id, status === 'approved'
    ? { title: 'You are approved on FreshAF Pro', body: 'Set your prices and go online to start receiving jobs.', url: '/supplier', tag: 'account' }
    : { title: 'Update on your FreshAF Pro account', body: reason || 'Open FreshAF Pro for details.', url: '/supplier', tag: 'account' }
  ).catch(() => {});
  if (u) mailer.proStatusChanged({ to: u.email, name: u.name, status, reason }).catch(() => {});
  res.json({ ok: true });
}

// Stream an onboarding document to the reviewing admin.
router.get('/docs/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM supplier_docs WHERE id = ?').get(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.sendFile(path.join(__dirname, '..', '..', 'data', 'uploads', doc.stored_name));
});

// Record that a pro has paid in the cash they were holding. Clears the balance that
// keeps them off the platform.
router.post('/suppliers/:id/settle-cash', (req, res) => {
  const s = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const cleared = balance.settle(s.user_id);
  console.log(`[FreshAF] Cash settled for supplier ${s.user_id}: R${(cleared / 100).toFixed(2)}`);
  res.json({ ok: true, cleared_cents: cleared, ...balance.status(s.user_id) });
});

// Mark an account as a demo account (or back). See the note in server/db.js. Refused while
// the account has an order in progress, so nothing in flight changes sides.
router.post('/users/:id/demo', (req, res) => {
  const u = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('customer','supplier')").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Account not found' });
  const busy = db.prepare(`SELECT id FROM orders WHERE (customer_id = ? OR supplier_id = ?)
    AND status IN ('pending_payment','searching','accepted','en_route','in_progress')`).get(u.id, u.id);
  if (busy) return res.status(409).json({ error: 'This account has an order in progress. Finish or cancel it first.' });
  const flag = req.body?.is_demo ? 1 : 0;
  db.prepare('UPDATE users SET is_demo = ? WHERE id = ?').run(flag, u.id);
  console.log(`[FreshAF] Account ${u.id} (${u.role}) marked ${flag ? 'DEMO' : 'real'}`);
  res.json({ ok: true, is_demo: !!flag });
});

router.post('/suppliers/:id/approve', (req, res) => setSupplierStatus(req, res, 'approved'));
router.post('/suppliers/:id/reject', (req, res) => setSupplierStatus(req, res, 'rejected'));
router.post('/suppliers/:id/suspend', (req, res) => setSupplierStatus(req, res, 'suspended'));

// The daily summary on demand: GET shows it, POST emails it now. ?day=YYYY-MM-DD for a
// particular day; defaults to yesterday, South African time.
function summaryDay(req) {
  const d = String(req.query.day || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(Date.now() + 2 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
}
router.get('/daily-summary', (req, res) => {
  const s = require('../daily-summary').build(summaryDay(req));
  res.json({ subject: s.subject, todo: s.todo });
});
router.post('/daily-summary', async (req, res) => {
  const s = await require('../daily-summary').send(summaryDay(req));
  res.json({ subject: s.subject, todo: s.todo, mail: s.mail?.status });
});

// Cancel any order that is not finished, with a reason the customer will see. Refunds owed
// on card orders are recorded and flagged; see dispatch.cancelOrder.
router.post('/orders/:id/cancel', (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Give a reason. The customer will see it.' });
  const done = require('../dispatch').cancelOrder(Number(req.params.id), { by: 'admin', reason: reason.slice(0, 300) });
  if (!done) return res.status(409).json({ error: 'That order is already finished or cancelled' });
  res.json({ ok: true, refund_due_cents: done.refund_due_cents });
});

// Record that a refund owed has been paid back (in the Stitch dashboard). The customer
// is told it is on its way.
router.post('/orders/:id/refunded', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (!(o.refund_due_cents > 0)) return res.status(409).json({ error: 'No refund is owed on this order' });
  db.prepare(`UPDATE orders SET payment_status = 'refunded', refunded_at = datetime('now'),
    refund_due_cents = 0 WHERE id = ?`).run(o.id);
  const c = db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.customer_id);
  if (c?.email) mailer.refundSent({ to: c.email, name: c.name, orderId: o.id, refundCents: o.refund_due_cents }).catch(() => {});
  console.log(`[FreshAF] Refund of R${(o.refund_due_cents / 100).toFixed(2)} recorded for order ${o.id}`);
  res.json({ ok: true });
});

router.get('/orders/:id/handover-photo', (req, res) => {
  const o = db.prepare('SELECT handover_photo FROM orders WHERE id = ?').get(req.params.id);
  if (!o?.handover_photo) return res.status(404).json({ error: 'No handover photo' });
  res.sendFile(path.join(__dirname, '..', '..', 'data', 'uploads', o.handover_photo));
});

router.get('/orders', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, cu.name AS customer_name, su.name AS supplier_name
    FROM orders o
    JOIN users cu ON cu.id = o.customer_id
    LEFT JOIN users su ON su.id = o.supplier_id
    ORDER BY o.id DESC LIMIT 200`).all();
  res.json({ orders: rows });
});

// Everyone who has signed up for the service, newest first — the sign-up book.
router.get('/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.home_address, u.created_at, u.terms_accepted_at, u.is_demo,
           u.points_cents,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS orders,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id AND o.status = 'completed') AS orders_completed,
           (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = u.id) AS last_order_at
    FROM users u WHERE u.role = 'customer'
    ORDER BY u.id DESC`).all();
  res.json({ customers: rows });
});

// CSV so the sign-up list survives outside the app — and can be worked in Excel.
router.get('/customers.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.home_address, u.created_at,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS orders
    FROM users u WHERE u.role = 'customer' ORDER BY u.id DESC`).all();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'name', 'email', 'phone', 'address', 'signed_up', 'orders'];
  const csv = [header.join(',')]
    .concat(rows.map((r) => [r.id, r.name, r.email, r.phone, r.home_address, r.created_at, r.orders].map(esc).join(',')))
    .join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="freshaf-signups.csv"');
  res.send('﻿' + csv); // BOM so Excel opens the accented characters correctly
});

/* ---------- backup / restore ----------
   Attaching a persistent disk mounts it EMPTY, so the plan upgrade would otherwise throw
   away production. Download before, upload after, redeploy, done. */
const fs = require('fs');
const multer = require('multer');
const { checkpoint, DB_FILE, RESTORE_FILE, DATA_DIR } = require('../db');

// Streaming the live database file can hand back a torn copy: a write landing midway
// through the read produces a file that opens fine and is quietly missing rows. VACUUM
// INTO asks SQLite for a consistent snapshot instead, and this file is the one thing a
// server migration depends on being correct.
router.get('/backup', (req, res) => {
  checkpoint(); // fold the write-ahead log in first
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const snapshot = path.join(DATA_DIR, `snapshot-${Date.now()}.db`);
  const cleanup = () => { try { fs.unlinkSync(snapshot); } catch {} };
  try {
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } catch (e) {
    cleanup();
    console.error('[FreshAF] Snapshot failed, sending the live file instead:', e.message);
    return res.download(DB_FILE, `freshaf-backup-${stamp}.db`);
  }
  res.download(snapshot, `freshaf-backup-${stamp}.db`, cleanup);
});

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (req, file, cb) => cb(null, `restore-upload-${Date.now()}.tmp`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post('/restore', restoreUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a .db backup file' });
  const tmp = req.file.path;
  try {
    // Every SQLite file starts with this. Refuse anything else rather than boot into a brick.
    const head = Buffer.alloc(16);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (head.toString('utf8', 0, 15) !== 'SQLite format 3') {
      fs.unlinkSync(tmp);
      return res.status(400).json({ error: 'That is not a SQLite backup file' });
    }
    fs.renameSync(tmp, RESTORE_FILE);
    res.json({
      ok: true,
      bytes: req.file.size,
      next: 'Backup staged. Redeploy or restart the service and it will be restored on boot.',
    });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    res.status(500).json({ error: `Could not stage the restore: ${e.message}` });
  }
});

/* ---------- launch readiness ----------
   One place that answers "is this thing actually ready to take real customers". */
// The apps and push notifications, shown as their own group in the readiness panel. Push is
// read live from the server's settings; the store steps come from server/app-release.json,
// which Claude updates as each one moves.
function appChecks() {
  let rel = {};
  try { rel = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'app-release.json'), 'utf8')); } catch { /* shown as not ready */ }
  const nat = require('../native-push').configured();
  const count = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
  const webSubs = count('SELECT COUNT(*) c FROM push_subscriptions');
  const androidDevices = count("SELECT COUNT(*) c FROM device_tokens WHERE platform = 'android'");
  const iosDevices = count("SELECT COUNT(*) c FROM device_tokens WHERE platform = 'ios'");
  const apk = rel.android_apk || {};
  const apkOnDisk = fs.existsSync(require('path').join(__dirname, '..', '..', 'downloads', 'freshaf.apk'));
  return [
    { key: 'web_push', label: 'Push notifications: website and home-screen app', ok: true,
      detail: `Live. Pros get job alerts in the browser or the home-screen app once they tap "Enable job alerts" (iPhone: Safari > Share > Add to Home Screen first, iOS 16.4+). ${webSubs} device(s) signed up.` },
    { key: 'android_push', label: 'Push notifications: Android app', ok: nat.android,
      detail: nat.android
        ? `Live. ${androidDevices} Android device(s) registered.`
        : 'Off: the app is already connected to Firebase; only the server key is missing. Firebase console > Project settings > Service accounts > Generate new private key, then paste the whole file into Render as FCM_SERVICE_ACCOUNT.' },
    { key: 'ios_push', label: 'Push notifications: iPhone app', ok: nat.ios,
      detail: nat.ios
        ? `Live. ${iosDevices} iPhone(s) registered.`
        : 'Off until the Apple Developer account exists (waits on the D-U-N-S number). Then: Apple Developer > Keys > APNs key, set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID on Render.' },
    { key: 'android_apk', label: 'Android app: direct download', ok: apkOnDisk,
      detail: apkOnDisk
        ? `Version ${apk.version || '?'} (${apk.date || 'date unknown'}) at freshaf.io${apk.url || '/download/freshaf.apk'}, until the app is on Google Play.`
        : 'No APK on the server.' },
    { key: 'store_pack', label: 'Store listing pack', ok: !!rel.store_pack?.ok, detail: rel.store_pack?.detail || 'Unknown.' },
    { key: 'duns', label: 'D-U-N-S number (needed for both stores)', ok: !!rel.duns?.ok, detail: rel.duns?.detail || 'Unknown.' },
    { key: 'google_play', label: 'Google Play', ok: !!rel.google_play?.ok, detail: rel.google_play?.detail || 'Unknown.' },
    { key: 'app_store', label: 'Apple App Store', ok: !!rel.app_store?.ok, detail: rel.app_store?.detail || 'Unknown.' },
  ];
}

router.get('/readiness', (req, res) => {
  const payments = require('../payments');
  const whatsapp = require('../whatsapp');
  const onDisk = (p) => { try { return fs.existsSync(p); } catch { return false; } };

  // A persistent disk shows up as a real mount, not a folder inside the build.
  let diskLooksPersistent = false;
  try {
    const st = fs.statSync(DATA_DIR);
    const parent = fs.statSync(require('path').join(DATA_DIR, '..'));
    diskLooksPersistent = st.dev !== parent.dev; // different device = separate volume
  } catch { /* leave false */ }
  // The empirical signal: a boot counter stored next to the database. Above one
  // means the folder outlived a restart, which is the only thing that matters.
  const { persistence } = require('../db');
  const survivedARestart = Number(persistence?.boots || 0) > 1;

  const approvedPros = db.prepare("SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved'").get().c;
  res.json({
    checks: [
      { key: 'persistent_disk', label: 'Customer accounts survive a restart', ok: survivedARestart,
        detail: survivedARestart
          ? `Proven: the data folder has survived ${persistence.boots - 1} restart(s) since ${persistence.firstBoot.slice(0, 10)}.`
          : diskLooksPersistent
            ? 'A separate volume is mounted, but nothing has restarted yet to prove it. Restart the service once and check again.'
            : 'NOT PROVEN. The data folder was empty on this boot. If that happens again after a deploy, every customer login and every order is being wiped. Mount a disk at /opt/render/project/src/data.' },
      { key: 'data_encryption', label: 'ID and bank details encrypted at rest', ok: secrets.isConfigured(),
        detail: secrets.isConfigured()
          ? 'Supplier ID numbers and bank accounts are encrypted in the database and masked on screen.'
          : 'DATA_KEY is not set, so ID numbers and bank account numbers sit in the database as plain text. Anyone with the file, or with one of the backups, can read them.' },
      { key: 'jwt_secret', label: 'Login secret pinned', ok: !!process.env.JWT_SECRET,
        detail: process.env.JWT_SECRET ? 'Sessions survive deploys.'
          : 'JWT_SECRET is not set, so every deploy signs everyone out.' },
      { key: 'card_payments', label: 'Card payments live', ok: payments.LIVE,
        detail: payments.statusDetail() },
      { key: 'return_leg_price', label: 'Laundry return-trip price set',
        ok: getSetting('return_leg_price_set', '0') === '1',
        detail: getSetting('return_leg_price_set', '0') === '1'
          ? `Return to a different address: first ${getSetting('return_leg_free_km', '5')} km free, then each pro's own rate up to R${(Number(getSetting('return_leg_per_km_cents', '1000')) / 100).toFixed(2)}/km, capped at R${(Number(getSetting('return_leg_cap_cents', '15000')) / 100).toFixed(2)}.`
          : 'NOT SET BY YOU YET. Laundry returned to a different address is charging the call-out rule as a stand-in (first 5 km free, then R10/km, capped at R150). Set it under Settings.' },
      { key: 'whatsapp', label: 'WhatsApp job alerts live', ok: whatsapp.configured(),
        detail: whatsapp.configured() ? 'Alerts are being sent.' : 'Dry run — see WHATSAPP-SETUP.md.' },
      // Proven by an actual sign-in to the mail server at boot, not by the password
      // merely being set; see server/mailer.js.
      { key: 'email', label: 'Account emails live', ok: require('../mailer').status().ok,
        detail: require('../mailer').status().detail },
      { key: 'suppliers', label: 'Approved pros on the platform', ok: approvedPros > 0,
        detail: `${approvedPros} approved. Nothing else matters without supply.` },
      // Checked against the real default, not merely "is the variable set". Someone
      // pasting the published default into ADMIN_PASSWORD would otherwise turn this
      // green while the published password still opened the dashboard.
      { key: 'admin_password', label: 'Admin password changed from default',
        ok: !!process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== DEFAULT_ADMIN_PASSWORD,
        detail: !process.env.ADMIN_PASSWORD
          ? 'Using the built-in default, which is published in .env.example.'
          : process.env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD
            ? 'ADMIN_PASSWORD is set to the published default. Choose a different one.'
            : 'Set from the environment, and applied on every boot.' },
    ],
    apps: appChecks(),
    approved_pros: approvedPros,
    online_pros: db.prepare("SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved' AND online = 1").get().c,
    uploads_present: onDisk(require('path').join(DATA_DIR, 'uploads')),
  });
});

router.get('/stats', (req, res) => {
  const stats = {
    customers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer' AND is_demo = 0").get().c,
    // Growth, not just a total — a flat number tells an investor nothing.
    signups_7d: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer' AND is_demo = 0 AND created_at > datetime('now','-7 days')").get().c,
    signups_30d: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer' AND is_demo = 0 AND created_at > datetime('now','-30 days')").get().c,
    suppliers_pending: db.prepare("SELECT COUNT(*) c FROM real_suppliers WHERE status = 'pending'").get().c,
    suppliers_approved: db.prepare("SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved'").get().c,
    suppliers_online: db.prepare("SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved' AND online = 1").get().c,
    orders_total: db.prepare('SELECT COUNT(*) c FROM real_orders').get().c,
    orders_active: db.prepare("SELECT COUNT(*) c FROM real_orders WHERE status IN ('searching','accepted','en_route','in_progress')").get().c,
    orders_completed: db.prepare("SELECT COUNT(*) c FROM real_orders WHERE status = 'completed'").get().c,
    orders_carwash: db.prepare("SELECT COUNT(*) c FROM real_orders WHERE service = 'carwash'").get().c,
    orders_laundry: db.prepare("SELECT COUNT(*) c FROM real_orders WHERE service = 'laundry'").get().c,
    revenue_cents: db.prepare("SELECT COALESCE(SUM(commission_cents),0) c FROM real_orders WHERE status = 'completed'").get().c,
    refunds_due: db.prepare('SELECT COUNT(*) c FROM real_orders WHERE refund_due_cents > 0').get().c,
    refunds_due_cents: db.prepare('SELECT COALESCE(SUM(refund_due_cents),0) c FROM real_orders').get().c,
  };
  res.json(stats);
});

router.get('/settings', (req, res) => {
  res.json({
    // FreshAF's margin on top of the pro's price (merchant of record). This replaced a
    // "commission_pct" control that the pricing code never read: changing it did nothing.
    platform_fee_pct: Number(getSetting('platform_fee_pct', '20')),
    dispatch_radius_km: Number(getSetting('dispatch_radius_km', '25')),
    offer_timeout_sec: Number(getSetting('offer_timeout_sec', '60')),
    points_earn_pct: Number(getSetting('points_earn_pct', '5')),
    callout_free_km: Number(getSetting('callout_free_km', '5')),
    callout_per_km_cents: Number(getSetting('callout_per_km_cents', '1000')),
    callout_cap_cents: Number(getSetting('callout_cap_cents', '15000')),
    return_leg_free_km: Number(getSetting('return_leg_free_km', '5')),
    return_leg_per_km_cents: Number(getSetting('return_leg_per_km_cents', '1000')),
    return_leg_cap_cents: Number(getSetting('return_leg_cap_cents', '15000')),
    return_leg_price_set: getSetting('return_leg_price_set', '0') === '1',
  });
});

router.post('/settings', (req, res) => {
  const { platform_fee_pct, dispatch_radius_km, offer_timeout_sec,
    points_earn_pct, callout_free_km, callout_per_km_cents, callout_cap_cents,
    return_leg_free_km, return_leg_per_km_cents, return_leg_cap_cents } = req.body || {};
  const checks = [
    ['platform_fee_pct', platform_fee_pct, 0, 50],
    ['dispatch_radius_km', dispatch_radius_km, 1, 200],
    ['offer_timeout_sec', offer_timeout_sec, 10, 600],
    ['points_earn_pct', points_earn_pct, 0, 50],
    ['callout_free_km', callout_free_km, 0, 100],
    ['callout_per_km_cents', callout_per_km_cents, 0, 10000],
    ['callout_cap_cents', callout_cap_cents, 0, 100000],
    ['return_leg_free_km', return_leg_free_km, 0, 100],
    ['return_leg_per_km_cents', return_leg_per_km_cents, 0, 10000],
    ['return_leg_cap_cents', return_leg_cap_cents, 0, 100000],
  ];
  for (const [key, val, min, max] of checks) {
    if (val === undefined) continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) {
      return res.status(400).json({ error: `${key} must be between ${min} and ${max}` });
    }
    setSetting(key, n);
  }
  // Saving any return-trip figure is the owner deciding that price.
  if ([return_leg_free_km, return_leg_per_km_cents, return_leg_cap_cents].some((v) => v !== undefined)) {
    setSetting('return_leg_price_set', '1');
  }
  res.json({ ok: true });
});

module.exports = router;
