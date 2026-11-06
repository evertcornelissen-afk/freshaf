const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSetting } = require('../db');
const crypto = require('crypto');
const whatsapp = require('../whatsapp');
const { setAuthCookie, clearAuthCookie, readSession, renewIfStale, authRequired, signUser,
  wantsToken, signSseTicket, rotateSession } = require('../auth');
const mailer = require('../mailer');
const secrets = require('../secrets');
const { rateLimit, forgive } = require('../ratelimit');
const jwt = require('jsonwebtoken');
const { SSE_SECRET } = require('../auth');

const router = express.Router();

// Nothing here was throttled at all until now, on a live site that stores ID numbers and
// bank details: a script could try passwords as fast as the network allowed.
//
// Two limiters per sensitive route, deliberately. The per-address one stops one attacker
// hammering many accounts; the per-email one stops a botnet spread across many addresses
// hammering ONE account, which the address limiter alone cannot see. The email limiter is
// the looser of the two so that a person genuinely mistyping their own password is not
// the one who gets locked out.
const loginByIp = rateLimit({
  name: 'login-ip', windowMs: 15 * 60_000, max: 20,
  message: 'Too many sign-in attempts from this connection. Wait a few minutes and try again.',
});
const loginByEmail = rateLimit({
  name: 'login-email', windowMs: 15 * 60_000, max: 10,
  keyBy: (req) => String(req.body?.email || '').trim().toLowerCase() || 'none',
  message: 'Too many sign-in attempts for this account. Wait a few minutes and try again.',
});
const registerLimit = rateLimit({
  name: 'register', windowMs: 60 * 60_000, max: 10,
  message: 'Too many accounts created from this connection. Try again later.',
});
// Deleting an account asks for the password, so it is a password oracle like any other.
const deleteLimit = rateLimit({
  name: 'delete-account', windowMs: 15 * 60_000, max: 10,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

// Password reset. Asking is throttled per connection AND per address: the second stops
// someone flooding one person's inbox from many machines.
const forgotByIp = rateLimit({
  name: 'forgot-ip', windowMs: 60 * 60_000, max: 10,
  message: 'Too many reset requests from this connection. Try again later.',
});
const forgotByEmail = rateLimit({
  name: 'forgot-email', windowMs: 60 * 60_000, max: 3,
  keyBy: (req) => String(req.body?.email || '').trim().toLowerCase() || 'none',
  message: 'A reset link was sent recently. Check your inbox and spam folder before asking for another.',
});
// A reset token is 256 random bits, so this is about load, not guessing.
const resetLimit = rateLimit({
  name: 'reset', windowMs: 15 * 60_000, max: 20,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

const RESET_TTL_MIN = 30;
const SITE = (process.env.BASE_URL || 'https://freshaf.io').replace(/\/$/, '');
// Only a hash is stored. Someone holding a copy of the database, or of a backup, cannot
// turn an unused reset row into a way into the account.
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

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

/* ---------- pro sign-up: prove the WhatsApp number ---------- */
// New bookings go to the pro's WhatsApp. A code at sign-up proves the number is theirs, so
// every approved pro is reachable from the first booking without a separate step later.
// Asked for only while WhatsApp is connected (locally it runs against the dry run), so the
// live sign-up never waits for a code that cannot arrive.
function signupCodeRequired() {
  return getSetting('whatsapp_alerts_enabled', '1') === '1' && whatsapp.codesEnabled()
    && (whatsapp.configured() || process.env.NODE_ENV !== 'production');
}
const SA_MOBILE = /^27[678]\d{8}$/;
const signupCodeLimit = rateLimit({
  name: 'signup-code', windowMs: 60 * 60_000, max: 8,
  message: 'Too many codes requested from this connection. Try again later.',
});

router.get('/phone-code', (req, res) => res.json({ required: signupCodeRequired() }));

router.post('/phone-code', signupCodeLimit, async (req, res) => {
  if (!signupCodeRequired()) return res.json({ ok: true, required: false });
  const to = whatsapp.toE164(req.body?.phone);
  if (!to || !SA_MOBILE.test(to)) {
    return res.status(400).json({ error: 'Enter your South African WhatsApp number, e.g. 082 555 1234' });
  }
  const prev = db.prepare('SELECT sent_at FROM signup_phone_codes WHERE phone = ?').get(to);
  if (prev) {
    const waited = db.prepare("SELECT (julianday('now') - julianday(?)) * 86400 AS s").get(prev.sent_at).s;
    if (waited < 60) return res.status(429).json({ error: `Wait ${Math.ceil(60 - waited)}s before asking for another code` });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(`INSERT INTO signup_phone_codes (phone, code, attempts, send_failed, expires_at, sent_at)
    VALUES (?, ?, 0, 0, datetime('now','+15 minutes'), datetime('now'))
    ON CONFLICT(phone) DO UPDATE SET code = excluded.code, attempts = 0, send_failed = 0,
      expires_at = excluded.expires_at, sent_at = excluded.sent_at`).run(to, code);
  const result = await whatsapp.verifyCode({ userId: null, phone: to, code });
  if (!result.ok) {
    // Not the pro's fault (no WhatsApp on that number, or Meta refused it). They may still
    // apply; the number shows as unconfirmed and they confirm it later in FreshAF Pro.
    db.prepare('UPDATE signup_phone_codes SET send_failed = 1 WHERE phone = ?').run(to);
    return res.status(502).json({
      error: 'We could not reach that number on WhatsApp. Check the number. If it is right, you can still apply and confirm it later in FreshAF Pro.',
      can_skip: true,
    });
  }
  res.json({ ok: true, required: true, dry_run: result.status === 'dry_run' });
});

router.post('/register', registerLimit, (req, res) => {
  const { role, name, email, phone, password, home_address, home_lat, home_lng, accept_terms,
    business_name, id_number, vehicle_reg, service_area, equipment_notes, services,
    bank_name, bank_account, bank_branch, vehicles, equipment, phone_code } = req.body || {};

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

  // A pro's WhatsApp number: required, because that is where new bookings are sent.
  let phoneProved = null;
  if (role === 'supplier') {
    const to = whatsapp.toE164(phone);
    if (!to) return res.status(400).json({ error: 'Your WhatsApp number is required: new bookings are sent there' });
    if (signupCodeRequired()) {
      const row = db.prepare('SELECT * FROM signup_phone_codes WHERE phone = ?').get(to);
      const code = String(phone_code || '').trim();
      if (!row) return res.status(400).json({ error: 'Tap "Send code" to confirm your WhatsApp number' });
      if (code) {
        if (db.prepare("SELECT datetime('now') > ? AS x").get(row.expires_at).x) {
          return res.status(400).json({ error: 'That WhatsApp code has expired. Tap "Resend" for a new one' });
        }
        if (row.attempts >= 5) return res.status(429).json({ error: 'Too many wrong codes. Tap "Resend" for a new one' });
        if (code !== row.code) {
          db.prepare('UPDATE signup_phone_codes SET attempts = attempts + 1 WHERE phone = ?').run(to);
          return res.status(400).json({ error: 'That WhatsApp code does not match' });
        }
        phoneProved = to;
      } else if (!row.send_failed) {
        return res.status(400).json({ error: 'Enter the 6-digit code we sent to your WhatsApp' });
      }
    }
  }

  // Store one canonical form. The column is UNIQUE COLLATE NOCASE so matching was already
  // case-insensitive, but storing lower case keeps exports, comparisons and support lookups
  // from ever disagreeing about whether two addresses are the same person.
  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  let info;
  try {
    info = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash, home_address, home_lat, home_lng, terms_accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(role, name.trim(), cleanEmail, phone?.trim() || null, bcrypt.hashSync(password, 10),
      home_address?.trim() || null,
      typeof home_lat === 'number' ? home_lat : null,
      typeof home_lng === 'number' ? home_lng : null);
  } catch (e) {
    // Belt and braces: two people submitting the same address at the same moment slip past
    // the check above, and the UNIQUE index catches it. Answer with the same clear message
    // rather than a 500.
    if (String(e.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    throw e;
  }
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
      .run(userId, business_name.trim(), secrets.encryptField(id_number.trim()), vehicleSummary,
        service_area?.trim() || null, equipmentSummary, supplierServices.join(','),
        bank_name?.trim() || null, secrets.encryptField(bank_account?.trim() || null),
        secrets.encryptField(bank_branch?.trim() || null),
        JSON.stringify(cleanVehicles), JSON.stringify(cleanEquipment));
    if (phoneProved) {
      db.prepare("UPDATE users SET phone_verified_at = datetime('now') WHERE id = ?").run(userId);
      db.prepare('DELETE FROM signup_phone_codes WHERE phone = ?').run(phoneProved);
    }
    mailer.proApplicationReceived({ to: cleanEmail, name: name.trim() }).catch(() => {});
    mailer.adminNewPro({ name: name.trim(), business: business_name.trim(), email: cleanEmail,
      phone: phone?.trim(), services: supplierServices }).catch(() => {});
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  setAuthCookie(res, user);
  // The app gets a Bearer token because it cannot receive the cookie; see server/auth.js.
  res.json({ user: mePayload(user), ...(wantsToken(req) ? { token: signUser(user) } : {}) });
});

router.post('/login', loginByIp, loginByEmail, (req, res) => {
  const { email, password } = req.body || {};
  const user = email && db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  // A correct password clears the address budget, so a household or office behind one
  // address is not locked out by whoever fumbled their password first this morning.
  forgive('login-ip', req);
  setAuthCookie(res, user);
  // The app gets a Bearer token because it cannot receive the cookie; see server/auth.js.
  res.json({ user: mePayload(user), ...(wantsToken(req) ? { token: signUser(user) } : {}) });
});

// EventSource cannot send an Authorization header, so the native app cannot open the
// live-updates stream the way it makes every other call. The usual workaround is to put
// the session token in the query string, but URLs end up in access logs and proxy logs,
// and that token is good for thirty days.
//
// This hands out a separate ticket that is valid for sixty seconds and only for the
// stream. If it leaks into a log it is already expired by the time anyone reads it.
router.get('/sse-ticket', authRequired('customer', 'supplier'), (req, res) => {
  res.json({ ticket: signSseTicket(req.user.id) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const s = readSession(req);
  if (!s) {
    // A token that no longer matches an account is cleared rather than left to be sent
    // on every request for the rest of its thirty days.
    if (req.cookies?.freshaf_token) clearAuthCookie(res);
    return res.json({ user: null });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user.id);
  if (!user) return res.json({ user: null });
  const fresh = renewIfStale(req, res, s); // the app's token, renewed on launch
  res.json({ user: mePayload(user), ...(fresh ? { token: fresh } : {}) });
});

// Step one: send a reset link. The answer is identical whether or not the address has an
// account, so this cannot be used to find out who our customers and pros are.
router.post('/forgot', forgotByIp, forgotByEmail, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter the email address you signed up with' });
  }
  const answer = { ok: true, message: `If there is a FreshAF account for ${email}, a reset link is on its way. `
    + `It works once and expires in ${RESET_TTL_MIN} minutes. Check your spam folder if it has not arrived in a few minutes.` };

  const user = db.prepare('SELECT id, name, email, role FROM users WHERE email = ?').get(email);
  // The admin password is set from the server environment on every boot, so an emailed
  // reset could not stick anyway. Refusing it keeps a compromised mailbox from being a
  // way into the admin account.
  if (!user || user.role === 'admin' || user.email.endsWith('@freshaf.invalid')) return res.json(answer);

  const token = crypto.randomBytes(32).toString('base64url');
  // Only the newest link works; asking twice does not leave two keys lying around.
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+${RESET_TTL_MIN} minutes'))`).run(user.id, hashToken(token));
  const pro = user.role === 'supplier' ? '&pro=1' : '';
  mailer.passwordReset({ to: user.email, name: user.name, minutes: RESET_TTL_MIN,
    url: `${SITE}/reset-password?token=${token}${pro}` }).catch(() => {});
  res.json(answer);
});

// Step two: the link from the email. Sets the password, signs this device in, and signs
// every other device out, in case the reason for the reset is that someone else got in.
router.post('/reset', resetLimit, (req, res) => {
  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'This reset link is incomplete. Ask for a new one.' });
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const expired = 'This reset link has expired or has already been used. Ask for a new one.';
  const row = db.prepare(`SELECT * FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`).get(hashToken(token));
  if (!row) return res.status(400).json({ error: expired });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.role === 'admin' || user.email.endsWith('@freshaf.invalid')) {
    return res.status(400).json({ error: expired });
  }

  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  rotateSession(user.id);
  mailer.passwordChanged({ to: user.email, name: user.name }).catch(() => {});

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  setAuthCookie(res, fresh);
  res.json({ user: mePayload(fresh), ...(wantsToken(req) ? { token: signUser(fresh) } : {}) });
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
router.post('/delete-account', deleteLimit, authRequired('customer', 'supplier'), (req, res) => {
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
  // Without this the token stayed valid for up to thirty days on every other device, still
  // signed in to what is now the anonymised "Deleted user" row.
  rotateSession(user.id);
  // And no more notifications to a deleted account's phones or browsers.
  require('../native-push').forgetUser(user.id);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(user.id);
  clearAuthCookie(res);
  res.json({ ok: true });
});

module.exports = router;
