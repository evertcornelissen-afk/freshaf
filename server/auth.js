const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Persist a random JWT secret so sessions survive restarts without requiring config.
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRET_FILE = path.join(DATA_DIR, 'jwt.secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (fs.existsSync(SECRET_FILE)) {
    JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } else {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, JWT_SECRET);
  }
}

const COOKIE_NAME = 'freshaf_token';

// Every token carries the account's session key, and every request checks it against
// the database.
//
// Before this, a token said only "user 3". The signing secret is pinned on Render so that
// sessions survive deploys, but the database itself has been wiped on restart, and user
// ids start again at 1 on an empty database. A thirty-day cookie that said "user 3" then
// opened the account of whoever happened to sign up third AFTER the wipe: a stranger saw
// another customer's name, phone and address, and every protected route would have let
// them act as that person. Restoring a backup reuses ids in exactly the same way.
//
// The key is random per account and lives in the users row, so it disappears with the
// row. A token minted against any other database, or for an account that has since been
// deleted, no longer matches anything and simply reads as signed out.
function db() {
  return require('./db').db; // required lazily so load order between the two never matters
}

function sessionKeyFor(user) {
  if (user.session_key) return user.session_key;
  const key = crypto.randomBytes(16).toString('hex');
  db().prepare('UPDATE users SET session_key = ? WHERE id = ? AND session_key IS NULL').run(key, user.id);
  return db().prepare('SELECT session_key FROM users WHERE id = ?').get(user.id).session_key;
}

// Signs every token this account holds out, on every device. Used when the account is
// deleted; anything else that should end all sessions (a password change) calls it too.
function rotateSession(userId) {
  db().prepare('UPDATE users SET session_key = ? WHERE id = ?')
    .run(crypto.randomBytes(16).toString('hex'), userId);
}

function signUser(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, sk: sessionKeyFor(user) },
    JWT_SECRET, { expiresIn: '30d' });
}

// The live account behind a verified token, or null. Role and name come from the
// database, not the token, so a role change takes effect on the next request.
function currentUser(payload) {
  if (!payload || !payload.id || !payload.sk) return null;
  const u = db().prepare('SELECT id, role, name, session_key FROM users WHERE id = ?').get(payload.id);
  if (!u || !u.session_key) return null;
  const a = Buffer.from(String(payload.sk));
  const b = Buffer.from(u.session_key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: u.id, role: u.role, name: u.name };
}

function signSseTicket(userId) {
  const u = db().prepare('SELECT id, role, session_key FROM users WHERE id = ?').get(userId);
  return jwt.sign({ id: u.id, role: u.role, sse: true, sk: sessionKeyFor(u) }, JWT_SECRET, { expiresIn: '60s' });
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signUser(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

// Cleared with the same attributes it was set with. Browsers match a cookie on more than
// its name, and a clear that does not match leaves the session sitting there.
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

// The native iOS and Android builds cannot use the cookie. Their pages are served from
// capacitor://localhost inside the binary, so every API call is cross-origin, and the
// cookie is SameSite=lax — deliberately, because that is what stops CSRF on the website.
//
// Relaxing it to SameSite=None to suit the app would hand the website a CSRF hole to buy
// a convenience for a different client. Instead the app carries the same JWT as a Bearer
// token, which no browser attaches automatically and so cannot be forged cross-site. The
// website is untouched: it still uses the httpOnly cookie, which JavaScript cannot read.
function bearer(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// An explicit Bearer token wins over the cookie, and if it is present it is the ONLY thing
// looked at. The website never sends one (common.js adds it only inside the native app),
// so this changes nothing on the web. In the app it means the identity the app chose is
// the identity used: a cookie the web view picked up for some earlier account can never
// quietly take over, and a rejected token is not rescued by falling back to that cookie.
function readSession(req) {
  const fromHeader = bearer(req);
  const token = fromHeader || req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = currentUser(payload);
    return user ? { user, iat: payload.iat || 0, via: fromHeader ? 'bearer' : 'cookie' } : null;
  } catch {
    return null;
  }
}

function readToken(req) {
  const s = readSession(req);
  return s ? s.user : null;
}

// Sessions slide. A token older than a week is quietly replaced on the next request, so
// anyone who uses FreshAF at least once a month is never asked to sign in again. A fixed
// thirty days signed every regular customer out once a month, and a customer who is asked
// for a password they have long forgotten is a customer who opens a second account or
// goes elsewhere.
//
// The website gets a new cookie. The app gets a new token in the body of /api/auth/me,
// which it calls on every launch; common.js stores any token it is handed.
const RENEW_AFTER_SEC = 7 * 24 * 3600;
function renewIfStale(req, res, s) {
  if (!s || Date.now() / 1000 - s.iat < RENEW_AFTER_SEC) return null;
  if (s.via === 'cookie') { setAuthCookie(res, s.user); return null; }
  return wantsToken(req) ? signUser(s.user) : null;
}

// A client that cannot use cookies asks for the token explicitly. It is returned ONLY on
// that request, never in an ordinary web response: a token in a JSON body is readable by
// any script on the page, which is exactly what httpOnly exists to prevent.
function wantsToken(req) {
  return req.get('x-freshaf-client') === 'native';
}

function authRequired(...roles) {
  return (req, res, next) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: 'Not signed in' });
    if (roles.length && !roles.includes(s.user.role)) {
      return res.status(403).json({ error: 'Not allowed for your account type' });
    }
    req.user = s.user;
    renewIfStale(req, res, s);
    next();
  };
}

// Accepts the short-lived stream ticket in the query string as well as the normal
// cookie or Bearer token. Scoped to the events route only: everything else must use a
// header, so a thirty-day session token never appears in a URL.
function sseAuth() {
  return (req, res, next) => {
    const payload = readToken(req);
    if (payload) { req.user = payload; return next(); }
    const ticket = req.query?.ticket;
    if (ticket) {
      try {
        const t = jwt.verify(String(ticket), JWT_SECRET);
        const u = t.sse && currentUser(t);
        if (u) { req.user = u; return next(); }
      } catch { /* fall through to 401 */ }
    }
    return res.status(401).json({ error: 'Not signed in' });
  };
}

module.exports = { setAuthCookie, clearAuthCookie, readToken, readSession, renewIfStale,
  authRequired, signUser, wantsToken, sseAuth, signSseTicket, rotateSession,
  SSE_SECRET: JWT_SECRET, COOKIE_NAME };
