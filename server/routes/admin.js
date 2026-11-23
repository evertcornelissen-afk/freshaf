const express = require('express');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, DEFAULT_ADMIN_PASSWORD } = require('../db');
const { authRequired, rotateSession } = require('../auth');
const { normEmail } = require('../email');
const realtime = require('../realtime');
const push = require('../push');
const balance = require('../balance');
const secrets = require('../secrets');
const mailer = require('../mailer');
const onboarding = require('../onboarding');
const vetting = require('../vetting');

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

const docsCache = new Map();
function docsFor(userId) {
  if (!docsCache.has(userId)) {
    docsCache.set(userId, db.prepare('SELECT id, kind, original_name, uploaded_at FROM supplier_docs WHERE user_id = ?').all(userId));
  }
  return docsCache.get(userId);
}
function safeList(json) { try { return JSON.parse(json || '[]'); } catch { return []; } }

router.get('/suppliers', (req, res) => {
  docsCache.clear(); // per request: one query per pro, not one per checklist lookup
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
      documents: docsFor(r.user_id),
      // What is still outstanding on this application, and what we have already asked for.
      checklist: onboarding.checklist(r, docsFor(r.user_id)),
      missing: onboarding.missingRequired(r, docsFor(r.user_id)),
      info_needed: safeList(r.info_needed), info_note: r.info_note,
      info_requested_at: r.info_requested_at,
      reg_number: r.reg_number, vat_number: r.vat_number,
      // Automatic checks: ID number arithmetic, company number format, Google listing.
      vetting: (() => {
        const v = vetting.stored(r.user_id);
        return v && { ...v, ...vetting.summarise(v) };
      })(),
      status: r.status, status_reason: r.status_reason, online: !!r.online, is_demo: !!r.is_demo,
      detailing_intent: !!r.detailing_intent,
      detailing: r.detailing_status ? {
        status: r.detailing_status, link: r.detailing_link, reason: r.detailing_reason,
        applied_at: r.detailing_applied_at, decided_at: r.detailing_decided_at,
        photos: db.prepare('SELECT id, original_name, uploaded_at FROM detailing_photos WHERE user_id = ? ORDER BY id').all(r.user_id),
      } : null,
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
  // A decision ends any outstanding request for information — otherwise an approved pro
  // would still be told they owe us documents.
  db.prepare(`UPDATE suppliers SET status = ?, status_reason = ?, online = ?,
    info_needed = NULL, info_note = NULL WHERE user_id = ?`)
    .run(status, reason, online, s.user_id);
  // Suspended or rejected: their open prices come off customers' screens at once.
  if (status !== 'approved') {
    db.prepare("UPDATE quotes SET status = 'withdrawn' WHERE supplier_id = ? AND status = 'open'").run(s.user_id);
  }
  realtime.send(s.user_id, 'account_update', { status, reason });
  // The pro is rarely looking at the app when this happens, so tell them on every channel.
  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(s.user_id);
  push.sendToUser(s.user_id, status === 'approved'
    ? { title: 'You are approved on FreshAF Pro', body: 'Set your prices and go online to start receiving jobs.', url: '/supplier', tag: 'account' }
    : { title: 'Update on your FreshAF Pro account', body: reason || 'Open FreshAF Pro for details.', url: '/supplier', tag: 'account' }
  ).catch(() => {});
  if (u) mailer.proStatusChanged({ to: u.email, name: u.name, status, reason }).catch(() => {});
  logMessage(s.user_id, {
    kind: 'decision', subject: `Application ${status}`,
    body: reason || `Marked ${status}.`, sentBy: req.user?.name, delivery: u ? 'sent' : 'skipped',
  });
  res.json({ ok: true });
}

// Stream an onboarding document to the reviewing admin.
router.get('/docs/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM supplier_docs WHERE id = ?').get(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.sendFile(path.join(DATA_DIR, 'uploads', doc.stored_name));
});

// A detailing applicant's photo of past work, for the reviewing admin.
router.get('/detailing-photos/:photoId', (req, res) => {
  const ph = db.prepare('SELECT * FROM detailing_photos WHERE id = ?').get(req.params.photoId);
  if (!ph) return res.status(404).json({ error: 'Photo not found' });
  res.sendFile(path.join(DATA_DIR, 'uploads', ph.stored_name));
});

// Approve or decline a pro for detailing. Separate from approving the pro: approving adds
// 'detailing' to their services (the only thing that sends them detailing requests);
// declining, or taking it away later, removes it again. They hear on every channel.
router.post('/suppliers/:id/detailing', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const decision = req.body?.decision;
  if (!['approve', 'decline'].includes(decision)) return res.status(400).json({ error: 'Choose approve or decline' });
  if (!s.detailing_status) return res.status(409).json({ error: 'This pro has not applied for detailing' });
  const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
  if (decision === 'decline' && !reason) return res.status(400).json({ error: 'Say why, so the pro knows what to fix' });
  const set = new Set((s.services || 'carwash').split(',').filter(Boolean));
  if (decision === 'approve') set.add('detailing');
  else {
    set.delete('detailing');
    // A detailer who had switched car wash off still needs one service on the account.
    if (!set.size) set.add('carwash');
  }
  const services = ['carwash', 'detailing', 'laundry'].filter((k) => set.has(k)).join(',');
  const status = decision === 'approve' ? 'approved' : 'declined';
  db.prepare(`UPDATE suppliers SET detailing_status = ?, detailing_reason = ?, detailing_decided_at = datetime('now'),
    services = ? WHERE user_id = ?`).run(status, reason, services, s.user_id);
  realtime.send(s.user_id, 'account_update', { detailing: status });
  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(s.user_id);
  const fee = require('../quotes').feePctFor('detailing');
  const msg = decision === 'approve'
    ? {
      title: 'You are approved for detailing on FreshAF',
      subject: 'You are approved for detailing on FreshAF',
      body: 'Good news: you are approved to take detailing jobs on FreshAF.\n\n'
        + `Open FreshAF Pro and set your detailing prices. FreshAF adds ${fee}% on top for customers, and you are paid your full price.\n\n`
        + 'Detailing jobs are always booked ahead, so you will get each request with its date and time.',
    }
    : {
      title: 'Update on your FreshAF detailing application',
      subject: 'Your FreshAF detailing application',
      body: `We could not approve you for detailing yet.\n\nReason: ${reason}\n\n`
        + 'You can update your photos and link in FreshAF Pro and apply again.',
    };
  push.sendToUser(s.user_id, { title: msg.title, body: decision === 'approve' ? 'Set your detailing prices in FreshAF Pro.' : reason, url: '/supplier', tag: 'detailing' }).catch(() => {});
  if (u) mailer.proMessage({ to: u.email, name: u.name, subject: msg.subject, body: msg.body }).catch(() => {});
  logMessage(s.user_id, {
    kind: 'decision', subject: `Detailing ${status}`,
    body: reason || 'Approved for detailing.', sentBy: req.user?.name, delivery: u ? 'sent' : 'skipped',
  });
  res.json({ ok: true, status, services: services.split(',') });
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

// Ask a pending pro for what is still outstanding, WITHOUT rejecting them. The
// application stays pending, they keep their login, and the tick list in their app
// matches the email word for word.
router.post('/suppliers/:id/request-info', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  if (s.status === 'rejected') {
    return res.status(409).json({ error: 'This application was turned down. Move it back to pending first.' });
  }
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).filter(onboarding.isValidKey);
  if (!items.length) return res.status(400).json({ error: 'Tick at least one thing you need from them' });
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;

  db.prepare(`UPDATE suppliers SET info_needed = ?, info_note = ?, info_requested_at = datetime('now')
    WHERE user_id = ?`).run(JSON.stringify(items), note, s.user_id);

  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(s.user_id);
  const labels = onboarding.labelsFor(items);
  // Tell them on every channel — the app page updates live, and the email is the one
  // they can act on later.
  realtime.send(s.user_id, 'account_update', { status: s.status, info_needed: items, info_note: note });
  push.sendToUser(s.user_id, {
    title: 'FreshAF Pro needs a few things',
    body: `Still outstanding: ${labels.join(', ')}`,
    url: '/supplier', tag: 'account',
  }).catch(() => {});
  let mail = 'skipped';
  if (u?.email) {
    mailer.proInfoRequested({ to: u.email, name: u.name, items: onboarding.asksFor(items), note })
      .catch(() => {});
    mail = 'queued';
  }
  logMessage(s.user_id, {
    kind: 'request_info',
    subject: 'Outstanding items requested',
    body: labels.map((l) => `- ${l}`).join('\n') + (note ? `\n\nNote: ${note}` : ''),
    sentBy: req.user?.name, delivery: mail === 'queued' ? 'sent' : 'skipped',
  });
  console.log(`[FreshAF] Asked pro ${s.user_id} for: ${items.join(', ')}`);
  res.json({ ok: true, items, mail });
});

/* ---------- who else can get in ---------- */
// A second admin is a second person who can approve pros and see ID numbers and bank
// details. They get their OWN login, never a shared one: every message and decision is
// already stamped with who sent it, and that is worthless if two people share an account.
// Removing someone must also not mean changing your own password.

// Readable aloud over the phone and still strong: no 0/O/1/l/I to mistype.
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function tempPassword(len = 16) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`;
}

router.get('/admins', (req, res) => {
  const rows = db.prepare(`SELECT id, name, email, created_at, must_change_password, invited_by
    FROM users WHERE role = 'admin' AND admin_revoked_at IS NULL ORDER BY id ASC`).all();
  res.json({
    admins: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, created_at: r.created_at,
      pending_first_sign_in: !!r.must_change_password,
      invited_by: r.invited_by || null,
      is_you: r.id === req.user.id,
    })),
  });
});

router.post('/admins', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = normEmail(String(req.body?.email || ''));
  if (!name) return res.status(400).json({ error: 'Give them a name' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That is not a valid email address' });
  }

  // Removing someone leaves their row in place with role = 'admin' and a revoked stamp,
  // so their name still explains the decisions they made. That meant this guard, which
  // only looked at the role, refused the address FOREVER after a removal — the account
  // could not be removed and re-created, which is the obvious thing to try when something
  // looks stuck. A revoked admin is reinstated instead of refused.
  const existing = db.prepare('SELECT id, role, admin_revoked_at FROM users WHERE lower(email) = ?').get(email);
  if (existing && existing.role === 'admin' && existing.admin_revoked_at) {
    const chosen = String(req.body?.password || '');
    if (chosen && chosen.length < 12) {
      return res.status(400).json({ error: 'Use at least 12 characters — this account can see ID numbers and bank details' });
    }
    const password = chosen || tempPassword();
    db.prepare(`UPDATE users SET name = ?, password_hash = ?, must_change_password = ?,
      admin_revoked_at = NULL, invited_by = ? WHERE id = ?`)
      .run(name, bcrypt.hashSync(password, 10), chosen ? 0 : 1, req.user.name || null, existing.id);
    console.log(`[FreshAF] Admin access restored for ${email} by ${req.user.name || 'an admin'}`);
    return res.json({ ok: true, id: existing.id, email, name, password, chosen: !!chosen, reinstated: true });
  }
  if (existing) {
    return res.status(409).json({
      error: existing.role === 'admin'
        ? 'That address is already an admin — use "New password" next to their name instead of adding them again'
        : `That address already has a ${existing.role} account. Admins need their own address.`,
    });
  }

  // Either the inviting admin chooses the password and tells them directly - simplest,
  // and what most people expect - or we generate one and force a change on first sign-in.
  // A chosen password is NOT forced to change: whoever typed it already knows it, and
  // making them change something they just agreed on is friction with no benefit.
  const chosen = String(req.body?.password || '');
  if (chosen && chosen.length < 12) {
    return res.status(400).json({ error: 'Use at least 12 characters — this account can see ID numbers and bank details' });
  }
  const password = chosen || tempPassword();
  const mustChange = chosen ? 0 : 1;
  const info = db.prepare(`INSERT INTO users (role, name, email, password_hash, must_change_password, invited_by)
    VALUES ('admin', ?, ?, ?, ?, ?)`)
    .run(name, email, bcrypt.hashSync(password, 10), mustChange, req.user.name || null);

  console.log(`[FreshAF] Admin access granted to ${email} by ${req.user.name || 'an admin'}`);
  res.json({ ok: true, id: Number(info.lastInsertRowid), email, name, password, chosen: !!chosen });
});

// Reissue a temporary password — for "she never got it" or "she is locked out", without
// touching anyone else's login.
router.post('/admins/:id/reset-password', (req, res) => {
  const a = db.prepare(`SELECT id, email FROM users WHERE id = ? AND role = 'admin'
    AND admin_revoked_at IS NULL`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'That admin does not exist' });
  const chosen = String(req.body?.password || '');
  if (chosen && chosen.length < 12) {
    return res.status(400).json({ error: 'Use at least 12 characters' });
  }
  const password = chosen || tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), chosen ? 0 : 1, a.id);
  rotateSession(a.id);
  console.log(`[FreshAF] Temporary password reissued for ${a.email}`);
  res.json({ ok: true, email: a.email, password, chosen: !!chosen });
});

router.post('/admins/:id/remove', (req, res) => {
  const a = db.prepare(`SELECT id, name, email FROM users WHERE id = ? AND role = 'admin'
    AND admin_revoked_at IS NULL`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'That admin does not exist' });
  if (a.id === req.user.id) return res.status(409).json({ error: 'You cannot remove your own access' });
  const count = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'
    AND admin_revoked_at IS NULL`).get().c;
  if (count <= 1) return res.status(409).json({ error: 'That is the only admin left' });
  // The account is kept, not deleted: their name is attached to decisions and messages in
  // the history, and deleting the row would turn that history into "by someone".
  db.prepare(`UPDATE users SET admin_revoked_at = datetime('now'), password_hash = ?,
    must_change_password = 0 WHERE id = ?`)
    .run(bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10), a.id);
  rotateSession(a.id);
  console.log(`[FreshAF] Admin access removed for ${a.email} by ${req.user.name || 'an admin'}`);
  res.json({ ok: true, removed: a.email });
});

/* ---------- talking to an applicant ---------- */
// Record anything sent to a pro, whichever route it went out by, so the detail page
// shows one history instead of each feature keeping its own.
function logMessage(userId, { kind, subject, body, sentBy, delivery }) {
  db.prepare(`INSERT INTO supplier_messages (user_id, kind, subject, body, sent_by, delivery)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, kind || 'message', subject || null, body || '', sentBy || null, delivery || 'unknown');
}

router.get('/suppliers/:id/messages', (req, res) => {
  const rows = db.prepare(`SELECT id, kind, subject, body, sent_by, delivery, created_at
    FROM supplier_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(req.params.id);
  res.json({ messages: rows, mail: mailer.status() });
});

// Send a free-text email to an applicant from the FreshAF address. The application is
// not touched: this is a conversation, not a decision.
router.post('/suppliers/:id/message', async (req, res) => {
  const s = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(s.user_id);
  if (!u?.email) return res.status(409).json({ error: 'This account has no email address' });

  const subject = String(req.body?.subject || '').trim().slice(0, 150) || 'A message from FreshAF';
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!body) return res.status(400).json({ error: 'Write a message first' });

  let delivery = 'sent';
  try {
    const out = await mailer.proMessage({ to: u.email, name: u.name, subject, body });
    if (out?.status === 'dry_run') delivery = 'dry_run';
  } catch (e) {
    delivery = 'failed';
    logMessage(s.user_id, { kind: 'message', subject, body, sentBy: req.user?.name, delivery });
    return res.status(502).json({ error: `Could not send: ${e.message}`, delivery });
  }
  logMessage(s.user_id, { kind: 'message', subject, body, sentBy: req.user?.name, delivery });

  // Also surface it in the pro's app, so it is not lost in a spam folder.
  push.sendToUser(s.user_id, {
    title: 'Message from FreshAF', body: subject, url: '/supplier', tag: 'account',
  }).catch(() => {});

  console.log(`[FreshAF] Message to pro ${s.user_id} (${delivery}): ${subject}`);
  res.json({ ok: true, delivery, to: u.email, mail: mailer.status() });
});

// Re-run the automatic checks on demand — after a pro corrects a number, or when the
// Google key was added later.
router.post('/suppliers/:id/recheck', async (req, res) => {
  const s = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  try {
    const result = await vetting.runFor(s.user_id);
    const v = vetting.stored(s.user_id);
    res.json({ ok: true, vetting: v && { ...v, ...vetting.summarise(v) }, ran: !!result });
  } catch (e) {
    res.status(502).json({ error: `Checks failed: ${e.message}` });
  }
});

// Record the outcome of the CIPC check, which a human has to do: there is no free
// official API, so the dashboard tracks the answer instead of pretending to fetch it.
router.post('/suppliers/:id/cipc', (req, res) => {
  const s = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  const status = String(req.body?.status || '');
  if (!vetting.setCipcStatus(s.user_id, status, String(req.body?.note || '').trim().slice(0, 300))) {
    return res.status(400).json({ error: `Status must be one of: ${vetting.CIPC_STATUSES.join(', ')}` });
  }
  const v = vetting.stored(s.user_id);
  res.json({ ok: true, vetting: v && { ...v, ...vetting.summarise(v) } });
});

// Clear the request by hand — used when the outstanding item was a phone call or a
// reference, which the system cannot see arriving.
router.post('/suppliers/:id/clear-info-request', (req, res) => {
  const s = db.prepare('SELECT user_id FROM suppliers WHERE user_id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  db.prepare('UPDATE suppliers SET info_needed = NULL, info_note = NULL WHERE user_id = ?').run(s.user_id);
  realtime.send(s.user_id, 'account_update', {});
  res.json({ ok: true });
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
  res.sendFile(path.join(DATA_DIR, 'uploads', o.handover_photo));
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
    // Detailing: its own margin, and two switches that are off until the owner opens them.
    detailing_fee_pct: Number(getSetting('detailing_fee_pct', '10')),
    detailing_signup: getSetting('detailing_signup', '0') === '1',
    detailing_booking: getSetting('detailing_booking', '0') === '1',
    // Detailing is card only, so real customers only see it once card payments are live.
    card_live: require('../payments').LIVE,
    // Business hours: booked jobs must start inside them, and their timings count only them.
    business_open: getSetting('business_open', '07:00'),
    business_close: getSetting('business_close', '18:00'),
    // Phone apps: builds below app_min_build must update before they can be used; below
    // app_latest_build they are asked to, once a day. 0 = no prompt.
    app_min_build: Number(getSetting('app_min_build', '0')),
    app_latest_build: Number(getSetting('app_latest_build', '0')),
  });
});

router.post('/settings', (req, res) => {
  const { platform_fee_pct, dispatch_radius_km, offer_timeout_sec,
    points_earn_pct, callout_free_km, callout_per_km_cents, callout_cap_cents,
    return_leg_free_km, return_leg_per_km_cents, return_leg_cap_cents, detailing_fee_pct,
    detailing_signup, detailing_booking, business_open, business_close, app_min_build, app_latest_build } = req.body || {};
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
    ['detailing_fee_pct', detailing_fee_pct, 0, 50],
    ['app_min_build', app_min_build, 0, 100000],
    ['app_latest_build', app_latest_build, 0, 100000],
  ];
  // Checked before anything is written, so a bad value never leaves a half-saved form.
  const switches = [['detailing_signup', detailing_signup], ['detailing_booking', detailing_booking]]
    .filter(([, v]) => v !== undefined);
  for (const [key, val] of switches) {
    if (typeof val !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
  }
  const clock = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  if (business_open !== undefined || business_close !== undefined) {
    const o = clock(business_open ?? getSetting('business_open', '07:00'));
    const c = clock(business_close ?? getSetting('business_close', '18:00'));
    if (!o || !c) return res.status(400).json({ error: 'Business hours must be times like 07:00' });
    if (c <= o) return res.status(400).json({ error: 'Closing time must be after opening time' });
  }
  for (const [key, val, min, max] of checks) {
    if (val === undefined) continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) {
      return res.status(400).json({ error: `${key} must be between ${min} and ${max}` });
    }
    setSetting(key, n);
  }
  for (const [key, val] of switches) setSetting(key, val ? '1' : '0');
  if (business_open !== undefined) setSetting('business_open', business_open);
  if (business_close !== undefined) setSetting('business_close', business_close);
  // Saving any return-trip figure is the owner deciding that price.
  if ([return_leg_free_km, return_leg_per_km_cents, return_leg_cap_cents].some((v) => v !== undefined)) {
    setSetting('return_leg_price_set', '1');
  }
  res.json({ ok: true });
});

module.exports = router;
