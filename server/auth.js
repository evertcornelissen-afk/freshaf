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

function readToken(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
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

module.exports = { setAuthCookie, clearAuthCookie, readToken, authRequired, COOKIE_NAME };
