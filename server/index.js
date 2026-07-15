require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { authRequired } = require('./auth');
const realtime = require('./realtime');
const dispatch = require('./dispatch');

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
