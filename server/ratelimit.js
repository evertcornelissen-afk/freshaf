// Rate limiting, written by hand rather than pulled from npm.
//
// Why not express-rate-limit: this app has no native npm dependencies by design, and
// a limiter is forty lines. More to the point, the default memory store in that package
// has the same single-process limitation this does, so the dependency would buy nothing
// but a supply-chain surface on an app that holds ID numbers and bank details.
//
// Scope and honesty about it: this is per-process, in-memory. FreshAF runs one instance
// on Render, so that is the whole system today. If it is ever scaled to two instances an
// attacker gets 2x the budget, which is still a 500x improvement on the nothing that was
// here before, but at that point this should move to Redis or the host's edge limiter.

const BUCKETS = new Map(); // key -> { count, resetAt }

// Trimmed on write rather than on a timer, so an idle process holds no interval and a
// busy one never accumulates dead keys. Cheap: only runs when the map gets large.
function sweep(now) {
  if (BUCKETS.size < 5000) return;
  for (const [k, v] of BUCKETS) if (v.resetAt <= now) BUCKETS.delete(k);
}

// The client's address. Render terminates TLS at its proxy, so req.ip is only meaningful
// because trust proxy is set in index.js for production. Falling back to the socket
// address means a misconfigured proxy degrades to limiting everyone together rather
// than silently limiting nobody at all.
function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   length of the window
 * @param {number} opts.max        requests allowed per key per window
 * @param {string} opts.name       bucket namespace, so /login and /register do not share
 * @param {(req) => string} [opts.keyBy]  defaults to client address
 * @param {string} [opts.message]  what the caller is told
 */
function rateLimit({ windowMs, max, name, keyBy, message }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    sweep(now);
    const key = `${name}:${keyBy ? keyBy(req) : clientKey(req)}`;
    let b = BUCKETS.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      BUCKETS.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, max - b.count);
    const resetSec = Math.ceil((b.resetAt - now) / 1000);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(resetSec));

    if (b.count > max) {
      res.set('Retry-After', String(resetSec));
      // A plain-language message, because this fires on real people who forgot their
      // password far more often than it fires on an attacker.
      return res.status(429).json({
        error: message || `Too many attempts. Try again in ${resetSec} second${resetSec === 1 ? '' : 's'}.`,
      });
    }
    next();
  };
}

// Successful sign-ins should not count against the budget, otherwise a shared office or
// mobile NAT address locks out everyone behind it on a busy morning.
function forgive(name, req) {
  BUCKETS.delete(`${name}:${clientKey(req)}`);
}

// Clear a bucket keyed by something other than the address (e.g. the account's email).
function forgiveKey(name, key) {
  BUCKETS.delete(`${name}:${key}`);
}

module.exports = { rateLimit, forgive, forgiveKey, clientKey, _buckets: BUCKETS };
