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

// THE FRONT DOOR.
//
// This process holds ADMIN_API_KEY and attaches it to every admin call. On a laptop
// bound to 127.0.0.1 that is safe: nothing else can reach it. Published on the internet
// it is the opposite — anyone who finds the address gets the key attached to their
// requests for free, which turns "admin password AND key" into "admin password", and
// deletes the second factor exactly when it starts to matter.
//
// So a publicly bound instance must carry its own gate: one shared password in front of
// everything, separate from each person's FreshAF login. Two different secrets again,
// one of which never travels with the other.
//
// This refuses to start rather than coming up unprotected. A dashboard holding ID
// numbers and bank details must not be one missing environment variable away from open.
const GATE_USER = process.env.ADMIN_GATE_USER || 'freshaf';
const GATE_PASSWORD = process.env.ADMIN_GATE_PASSWORD || '';
if (PUBLIC && !GATE_PASSWORD) {
  console.error('[FreshAF Admin] REFUSING TO START.');
  console.error(`  ADMIN_BIND is "${BIND}", so this would be reachable from the internet,`);
  console.error('  but ADMIN_GATE_PASSWORD is not set — there would be nothing in front of');
  console.error('  the admin key this process holds. Set ADMIN_GATE_PASSWORD, or bind to');
  console.error('  127.0.0.1 to run it locally.');
  process.exit(1);
}

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

  // Render's health checker is not a browser and cannot send the front-door password.
  // Gated, it would get 401 on every probe and fail every deploy. So this one path sits
  // in front of the gate — and says nothing except that the process is up.
  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

  const gateFails = new Map(); // ip -> { n, until }
  const WINDOW_MS = 15 * 60_000;
  const MAX_TRIES = 10;

  app.use((req, res, next) => {
    const ip = req.ip || 'unknown';
    const rec = gateFails.get(ip);
    if (rec && rec.until > Date.now() && rec.n >= MAX_TRIES) {
      res.setHeader('Retry-After', String(Math.ceil((rec.until - Date.now()) / 1000)));
      return res.status(429).type('text/plain').send('Too many attempts. Try again later.');
    }

    const header = String(req.headers.authorization || '');
    const [scheme, encoded] = header.split(' ');
    let ok = false;
    if (/^Basic$/i.test(scheme || '') && encoded) {
      const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      const pw = rest.join(':');
      // Constant time on the password, so the gate cannot be guessed character by
      // character from how long the answer takes.
      const a = Buffer.from(pw);
      const b = Buffer.from(GATE_PASSWORD);
      ok = u === GATE_USER && a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (ok) {
      gateFails.delete(ip);
      return next();
    }
    const n = (rec && rec.until > Date.now() ? rec.n : 0) + 1;
    gateFails.set(ip, { n, until: Date.now() + WINDOW_MS });
    if (n >= MAX_TRIES) console.warn(`[FreshAF Admin] ${MAX_TRIES} failed front-door attempts from ${ip}`);
    res.setHeader('WWW-Authenticate', 'Basic realm="FreshAF Admin", charset="UTF-8"');
    return res.status(401).type('text/plain').send('FreshAF Admin');
  });
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
  if (ADMIN_API_KEY) headers['x-admin-key'] = ADMIN_API_KEY;

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
    ? `  Listening on ${BIND}:${PORT} — PUBLIC, behind the shared front-door password.`
    : `  Listening on ${BIND} only, so nothing on your network can reach it.`);
  console.log('');
});
