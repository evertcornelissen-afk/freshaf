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

function signUser(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signUser(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
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

// Cookie first, so a browser session is never overridden by a stale header.
function readToken(req) {
  const token = req.cookies?.[COOKIE_NAME] || bearer(req);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// A client that cannot use cookies asks for the token explicitly. It is returned ONLY on
// that request, never in an ordinary web response: a token in a JSON body is readable by
// any script on the page, which is exactly what httpOnly exists to prevent.
function wantsToken(req) {
  return req.get('x-freshaf-client') === 'native';
}

function authRequired(...roles) {
  return (req, res, next) => {
    const payload = readToken(req);
    if (!payload) return res.status(401).json({ error: 'Not signed in' });
    if (roles.length && !roles.includes(payload.role)) {
      return res.status(403).json({ error: 'Not allowed for your account type' });
    }
    req.user = payload;
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
        if (t.sse) { req.user = t; return next(); }
      } catch { /* fall through to 401 */ }
    }
    return res.status(401).json({ error: 'Not signed in' });
  };
}

module.exports = { setAuthCookie, clearAuthCookie, readToken, authRequired, signUser,
  wantsToken, sseAuth, SSE_SECRET: JWT_SECRET, COOKIE_NAME };
