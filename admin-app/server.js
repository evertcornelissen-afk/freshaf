#!/usr/bin/env node
// FreshAF Admin — runs on your own machine, not on freshaf.io.
//
// It serves the dashboard at http://localhost:5858 and forwards every API call to the
// live site over HTTPS, adding the admin key that the public internet does not have.
//
// What this actually buys, stated honestly:
//   - The dashboard is no longer a page on the public site for anyone to find.
//   - ADMIN_API_KEY means a stolen admin password alone opens nothing: an attacker
//     needs the key too, and the key only exists on this machine.
//   - The key never reaches the browser. It is added here, server-side.
// What it does NOT buy: the admin API still exists on the live site. It has to, or this
// could not reach it. The key is the protection, not the hiding.
//
// Moving it to a server later: this is an ordinary Node app with no local state. Deploy
// the folder, set the same two environment variables, and put it behind your own login.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.ADMIN_PORT || 5858);
const TARGET = (process.env.FRESHAF_URL || 'https://freshaf.io').replace(/\/$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const BIND = process.env.ADMIN_BIND || '127.0.0.1';

const PUBLIC = BIND !== '127.0.0.1' && BIND !== 'localhost';

// WHY THERE IS NO SECOND PASSWORD.
//
// This process holds ADMIN_API_KEY. The first published version put a shared Basic-auth
// password in front of everything, because a proxy that blindly attaches the key to any
// request hands it to whoever finds the address.
//
// That worked, but it meant two passwords to explain and to send by two routes, and it
// was confusing enough to be got wrong - which is itself a security problem.
//
// The better fix is narrower: attach the key ONLY to /api/admin/* calls, and only after
// checking with freshaf.io that the caller is already signed in as an admin. A stranger
// who finds this address gets the sign-in page and nothing else; the key never helps
// anyone who does not already hold an admin password. One password, same property.
//
// What this does NOT restore: on the laptop-only version the key was a true second
// factor, because a stolen password alone could not reach a dashboard that held it.
// Published, it cannot be - that is the trade-off of publishing, decided 17 Nov 2026.
// The live site rate-limits admin sign-ins by IP and by address, which is what stands
// between a guessed password and the data now.

const app = express();
app.disable('x-powered-by');

if (PUBLIC) {
  // Render terminates TLS, so the real client address arrives in X-Forwarded-For.
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Nothing here should ever be indexed or cached by anything in between.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  // Render's health checker needs one path that is always answerable, and it reveals
  // nothing but that the process is up.
  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
}

// Everything the dashboard needs that is not an API call is served from here first,
// then falls through to the live site for shared assets (css, images, icons).
// No caching. This dashboard is updated in place on the operator's own machine, and a
// browser holding a stale admin.js shows an older set of buttons than the one that was
// shipped — which looks exactly like a feature that was never built. Correctness beats
// a few kilobytes on localhost.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate'),
}));

// What this dashboard is actually reading. The header shows it, because a dashboard
// pointed at the wrong database looks exactly like one pointed at the right database.
app.get('/_admin/target', (req, res) => {
  const live = /^https:\/\/(www\.)?freshaf\.io$/i.test(TARGET);
  res.json({ target: TARGET, live, host: TARGET.replace(/^https?:\/\//, '') });
});

// Is this request from someone freshaf.io already knows as an admin? Asked upstream
// WITHOUT the key, so this cannot be used to answer itself. Cached briefly per session
// so a dashboard that fires a dozen calls on load does not make a dozen extra round
// trips - short enough that removing someone takes effect within seconds.
const adminCache = new Map(); // session token -> { ok, until }
const ADMIN_CACHE_MS = 15_000;

async function callerIsAdmin(req) {
  const cookie = req.headers.cookie || '';
  const auth = req.headers.authorization || '';
  if (!cookie && !auth) return false;
  const cacheKey = crypto.createHash('sha256').update(cookie + '|' + auth).digest('hex');
  const hit = adminCache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(`${TARGET}/api/auth/me`, {
      headers: { ...(cookie ? { cookie } : {}), ...(auth ? { authorization: auth } : {}) },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const body = await r.json().catch(() => ({}));
      ok = body?.user?.role === 'admin';
    }
  } catch { ok = false; }
  if (adminCache.size > 500) adminCache.clear();
  adminCache.set(cacheKey, { ok, until: Date.now() + ADMIN_CACHE_MS });
  return ok;
}

// One hop: browser -> this process -> freshaf.io. Bodies are streamed through as raw
// bytes so uploads (the database restore) and JSON both work without special cases.
app.use(async (req, res) => {
  const url = TARGET + req.originalUrl;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // host must be the target's, and hop-by-hop headers must not be forwarded.
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue;
    headers[k] = v;
  }
  // The key goes ONLY on admin calls, and only for a caller freshaf.io already
  // recognises as a signed-in admin. Everything else (sign-in, /api/auth/me, static
  // assets) is forwarded untouched, exactly as a browser would send it.
  if (ADMIN_API_KEY && req.path.startsWith('/api/admin/')) {
    if (!(await callerIsAdmin(req))) {
      return res.status(403).json({ error: 'Sign in as an admin first.' });
    }
    headers['x-admin-key'] = ADMIN_API_KEY;
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(300000), // restores can be large
    });

    for (const [k, v] of upstream.headers) {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) continue;
      if (k === 'set-cookie') continue; // handled below
      res.setHeader(k, v);
    }
    // The live site sets a Secure cookie for its own domain. This runs on http://localhost,
    // so strip Secure and Domain or the browser silently discards the session and the
    // dashboard just looks broken after a correct login.
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) {
      res.setHeader('set-cookie', cookies.map((c) =>
        c.split(';').filter((p) => !/^\s*(secure|domain=)/i.test(p)).join(';')));
    }
    res.status(upstream.status);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error(`[admin] ${req.method} ${req.originalUrl} -> ${e.message}`);
    res.status(502).json({ error: `Could not reach ${TARGET}: ${e.message}` });
  }
});

app.listen(PORT, BIND, () => {
  console.log('');
  console.log('  FreshAF Admin');
  console.log(`  Dashboard : http://localhost:${PORT}`);
  console.log(`  Talking to: ${TARGET}`);
  console.log(`  Admin key : ${ADMIN_API_KEY ? 'set' : 'NOT SET — the live site must also have it unset, or every call returns 404'}`);
  console.log(PUBLIC
    ? `  Listening on ${BIND}:${PORT} — public. The admin key is attached only to calls`
      + ` from someone ${TARGET} already knows as a signed-in admin.`
    : `  Listening on ${BIND} only, so nothing on your network can reach it.`);
  console.log('');
});
