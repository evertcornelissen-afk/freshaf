require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { authRequired } = require('./auth');
const realtime = require('./realtime');
const dispatch = require('./dispatch');
const push = require('./push');

const app = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // secure cookies behind the host's TLS proxy
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/orders'));
app.use('/api/supplier', require('./routes/supplier'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/events', authRequired(), realtime.sseHandler);

// Address autocomplete — proxies Photon (OpenStreetMap), biased to South Africa. No API key.
const geoCache = new Map();
app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });
  const key = q.toLowerCase();
  if (geoCache.has(key)) return res.json({ results: geoCache.get(key) });
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=16.2,-35.0,33.1,-22.0`;
    const r = await fetch(url, { headers: { 'User-Agent': 'FreshAF/1.0 (support@freshaf.co.za)' }, signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    const results = (data.features || []).map((f) => {
      const p = f.properties || {};
      const label = [
        [p.name, p.housenumber].filter(Boolean).join(' ') || p.street,
        p.street && p.name !== p.street ? p.street : null,
        p.district, p.city || p.town || p.village, p.state,
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      return { label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    }).filter((x) => x.label);
    if (geoCache.size > 500) geoCache.clear();
    geoCache.set(key, results);
    res.json({ results });
  } catch {
    res.json({ results: [] }); // autocomplete is best-effort; typing still works
  }
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
app.use(express.static(PUBLIC_DIR));
app.get('/supplier', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supplier.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/pay/:orderId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pay.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'privacy.html')));

app.use((err, req, res, next) => {
  console.error('[FreshAF] Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

const PORT = Number(process.env.PORT || 5757);
app.listen(PORT, () => {
  console.log(`[FreshAF] Fresh and Fast — running at http://localhost:${PORT}`);
  console.log(`[FreshAF] Customer app:    http://localhost:${PORT}/`);
  console.log(`[FreshAF] Supplier portal: http://localhost:${PORT}/supplier`);
  console.log(`[FreshAF] Admin dashboard: http://localhost:${PORT}/admin`);
  dispatch.resumeSearchingOrders();
});
