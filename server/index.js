require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { authRequired, sseAuth } = require('./auth');
const realtime = require('./realtime');
const dispatch = require('./dispatch');
const push = require('./push');
const maps = require('./maps');

const app = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // secure cookies behind the host's TLS proxy
}
app.disable('x-powered-by');
app.use(require('./security').securityHeaders(path.join(__dirname, '..', 'public')));

// CORS, for the native iOS and Android builds only.
//
// Those builds serve the same pages from inside the app binary, so their origin is
// capacitor://localhost (iOS) or https://localhost (Android) and every API call is
// cross-origin. An explicit allow-list rather than '*': a wildcard would let any website
// on the internet call this API from a visitor's browser.
//
// No Access-Control-Allow-Credentials, on purpose. The app authenticates with a Bearer
// token precisely so the cookie never has to travel cross-origin (see server/auth.js),
// and allowing credentials here would undo that decision by the back door.
const APP_ORIGINS = new Set([
  'capacitor://localhost', // iOS
  'ionic://localhost',     // iOS, older Capacitor
  'https://localhost',     // Android, androidScheme https
  'http://localhost',      // Android, androidScheme http
]);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && APP_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-FreshAF-Client');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
// Stitch signs the RAW body, so this one path must not be JSON-parsed. express.json()
// skips a request whose body a previous parser already set.
app.use('/api/payments/stitch/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json());
app.use(cookieParser());

// Nothing under /api may be stored by a browser or by anything between it and us. These
// responses are one person's account; a cached copy is served to whoever asks next.
// Cloudflare sits in front of the site and does not cache them today, but that is its
// default, not a promise, and one page rule would change it.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  res.set('Vary', 'Cookie, Authorization');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/orders'));
app.use('/api/supplier', require('./routes/supplier'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/events', sseAuth(), realtime.sseHandler);

// Address autocomplete. Google Places when a key is configured, because OpenStreetMap
// rarely knows South African house numbers; Photon (OpenStreetMap) otherwise, so the
// app still works without a key. The API key stays on the server — a browser key would
// be scraped off the page and spent by someone else.
const geoCache = new Map();
app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });
  const key = q.toLowerCase();
  if (geoCache.has(key)) return res.json({ results: geoCache.get(key) });

  if (maps.hasGoogle()) {
    try {
      const results = await maps.autocomplete(q, req.query.session);
      if (results.length) {
        if (geoCache.size > 500) geoCache.clear();
        geoCache.set(key, results);
        return res.json({ results });
      }
    } catch (e) {
      // Fall through to Photon rather than leaving the customer with a dead field.
      console.error('[FreshAF] Google autocomplete failed, using OpenStreetMap:', e.message);
    }
  }
  // OpenStreetMap coverage in South Africa is street-level far more often than
  // house-level, so "12 Rivonia Rd" matches nothing while "Rivonia Rd" matches.
  // Search on the street, then put the number the customer typed back on the label.
  const numMatch = q.match(/^\s*(\d{1,5}[A-Za-z]?)\s+(\S.*)$/);
  const typedNumber = numMatch ? numMatch[1] : null;
  const searchQ = numMatch ? numMatch[2] : q;
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQ)}&limit=12&lang=en&bbox=16.2,-35.0,33.1,-22.0`;
    const r = await fetch(url, { headers: { 'User-Agent': 'FreshAF/1.0 (admin@freshaf.io)' }, signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    const results = (data.features || []).map((f) => {
      const p = f.properties || {};
      const street = p.street || (p.name !== p.city ? p.name : null);
      // Prefer the real house number OSM knows; otherwise re-attach what was typed.
      const number = p.housenumber || typedNumber || null;
      const head = number && street ? `${number} ${street}`
        : [p.name, p.housenumber].filter(Boolean).join(' ') || street;
      // "Johannesburg Ward 103" is an electoral boundary, not something a customer
      // recognises as their address — drop it and keep the suburb and city.
      const district = p.district && !/\bward\b/i.test(p.district) ? p.district : null;
      const label = [
        head,
        street && p.name && p.name !== street && !number ? p.street : null,
        district, p.city || p.town || p.village, p.state,
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      return {
        label,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        // Tell the client whether the pin is the exact house or just the street,
        // so it can ask for the number instead of pretending it has it.
        precision: p.housenumber ? 'house' : 'street',
      };
    }).filter((x) => x.label);
    // One road is many OSM segments, so the same label comes back several times.
    // A dropdown with the same address listed three times reads as broken.
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      const k = r.label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(r);
      if (unique.length === 6) break;
    }
    if (geoCache.size > 500) geoCache.clear();
    geoCache.set(key, unique);
    res.json({ results: unique });
  } catch {
    res.json({ results: [] }); // autocomplete is best-effort; typing still works
  }
});

// Google autocomplete returns place ids, not coordinates. The pin is dropped only once
// the customer picks a suggestion, which is also the call that closes the billing
// session opened by their typing.
app.get('/api/geocode/place', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id || !maps.hasGoogle()) return res.status(400).json({ error: 'Unknown place' });
  try {
    const place = await maps.placeDetails(id, req.query.session);
    if (!place) return res.status(404).json({ error: 'Unknown place' });
    res.json(place);
  } catch (e) {
    console.error('[FreshAF] Place details failed:', e.message);
    res.status(502).json({ error: 'Could not look that address up' });
  }
});

// Native app push (APNs / FCM). The app asks first which platforms the server can send to,
// and only then asks the person for permission.
const nativePush = require('./native-push');
app.get('/api/push/native-config', (req, res) => res.json(nativePush.configured()));
app.post('/api/push/device', authRequired('customer', 'supplier'), (req, res) => {
  try {
    nativePush.register(req.user.id, String(req.body?.platform || ''), String(req.body?.token || ''));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Called by the app just before signing out, so this phone stops receiving the account's
// alerts the moment someone else might pick it up.
app.post('/api/push/device/remove', authRequired(), (req, res) => {
  res.json({ ok: true, removed: nativePush.unregister(req.user.id, req.body?.token) });
});

// Web Push (provider job alerts)
app.get('/api/push/key', (req, res) => res.json({ key: push.publicKey() }));
app.post('/api/push/subscribe', authRequired(), (req, res) => {
  try {
    push.subscribe(req.user.id, req.body?.subscription);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Digital Asset Links, for the Play Store wrapper. Served explicitly rather than left
// to express.static, whose handling of dot-directories is version-dependent: if Android
// cannot fetch this, the app opens with a browser address bar across the top.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json').sendFile(path.join(PUBLIC_DIR, '.well-known', 'assetlinks.json'));
});
app.use(express.static(PUBLIC_DIR));
app.get('/supplier', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supplier.html')));
// The admin dashboard is NOT served from the public site. It runs on the operator's own
// machine, from admin-app/, and talks to the API over HTTPS. See admin-app/README.md.
//
// Honest note on what that buys: hiding the page does not hide the API. The real
// protection is ADMIN_API_KEY below — an admin password alone no longer opens anything.

// Public reliability signal. Deliberately tiny: whether data outlived a restart, and
// since when. No counts, no names, nothing an attacker can use — but it is the one
// question ("are customer accounts being wiped?") that has to be answerable without
// logging in, and the admin UI is no longer on this site to answer it.
app.get('/api/health', (req, res) => {
  const { persistence, DATA_DIR } = require('./db');
  // data_dir and the file list are here to answer one question that cannot be answered
  // from outside: is the folder the app writes to actually the folder the host mounted?
  // A disk attached at a path the app never writes to looks identical to no disk at all.
  let fileCount = null;
  try {
    fileCount = require('fs').readdirSync(DATA_DIR).length;
  } catch (e) {
    fileCount = `unreadable: ${e.code || e.message}`;
  }
  res.json({
    ok: true,
    data_persisted: Number(persistence?.boots || 0) > 1,
    boots: Number(persistence?.boots || 0),
    since: persistence?.firstBoot || null,
    data_dir: DATA_DIR,
    file_count: fileCount,
    // The exact string the app will hand Stitch as the return URL. Stitch matches
    // registered redirect URLs byte-for-byte, so if BASE_URL on the host is not
    // exactly the public address, customers get a 404 AFTER paying — money gone,
    // no order. Worth being able to read from outside before switching card on.
    return_url: require('./stitch').returnUrl(process.env.BASE_URL || ''),
  });
});
app.get('/pay/:orderId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pay.html')));
// Where Stitch returns the customer after paying. The URL is registered with Stitch and
// matched byte-for-byte, so this path must exist exactly as registered — no trailing
// slash, no redirect. It carries ?reference= and ?payment_id=, which the app reads.
app.get('/payment-complete', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
// Google Play requires an account-deletion route reachable from OUTSIDE the app, as a
// public web page, in addition to the in-app one. The URL is submitted in Play Console
// under Data safety, so it must stay at exactly this path once declared.
app.get('/delete-account', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'delete-account.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'reset-password.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'terms.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'contact.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'privacy.html')));

app.use((err, req, res, next) => {
  console.error('[FreshAF] Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

// Until now a single unhandled promise rejection killed the process. Node's default for
// an unhandled rejection is to terminate, and this app awaits on Stitch, SMTP, Google
// Places and Web Push — four things that fail for reasons outside our control. Render
// restarts it, but a customer mid-checkout sees the failure and the dispatch loop has to
// rebuild its state.
//
// These handlers log and keep serving. That is the right call for a rejection, which is
// usually one request's problem. An uncaughtException is different: the process may be
// in an unknown state, so it finishes in-flight requests and then exits for a clean
// restart rather than serving from a corrupted one.
process.on('unhandledRejection', (reason) => {
  console.error('[FreshAF] Unhandled promise rejection (continuing):',
    reason instanceof Error ? reason.stack : reason);
});

let server;
function shutdown(code, label) {
  console.error(`[FreshAF] ${label} — finishing in-flight requests, then exiting.`);
  if (!server) process.exit(code);
  // Do not wait forever for a hung socket to drain.
  const force = setTimeout(() => process.exit(code), 5000);
  force.unref();
  server.close(() => process.exit(code));
}
process.on('uncaughtException', (err) => {
  console.error('[FreshAF] Uncaught exception:', err?.stack || err);
  shutdown(1, 'Uncaught exception');
});
// Render sends SIGTERM on deploy. Draining first means nobody's order is cut mid-write.
process.on('SIGTERM', () => shutdown(0, 'SIGTERM received'));
process.on('SIGINT', () => shutdown(0, 'SIGINT received'));

const PORT = Number(process.env.PORT || 5757);
require('./daily-summary').start(); // the 07:00 email to the FreshAF inbox
require('./demo-autopilot').start(); // demo bookings play through if nobody works them
server = app.listen(PORT, () => {
  console.log(`[FreshAF] Fresh and Fast — running at http://localhost:${PORT}`);
  console.log(`[FreshAF] Customer app:    http://localhost:${PORT}/`);
  console.log(`[FreshAF] Supplier portal: http://localhost:${PORT}/supplier`);
  // No /admin line here: that route was removed and the dashboard now runs from
  // admin-app/ on the operator's own machine. Advertising a dead path in the boot log
  // of a production service invites someone to go looking for it.
  console.log('[FreshAF] Admin dashboard: run admin-app/ locally (see admin-app/README.md)');
  dispatch.resumeSearchingOrders();
});
