// Laundry return trip, priced per pro (Evert, 9 Nov 2026): each laundry pro sets their own
// rate per km, up to the maximum FreshAF publishes; customers see that maximum, all in,
// before they book. Runs against the local database like the other tests; it creates its
// own throwaway accounts and puts the return-trip settings back as it found them.
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
// The server signs sessions with JWT_SECRET from .env; the test must use the same secret.
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });
const { db, setSetting, getSetting } = require(path.join(ROOT, 'server', 'db'));
const auth = require(path.join(ROOT, 'server', 'auth'));
const quotes = require(path.join(ROOT, 'server', 'quotes'));

const PORT = 5761, BASE = `http://127.0.0.1:${PORT}`;
const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`);
};

const SAVED = ['return_leg_free_km', 'return_leg_per_km_cents', 'return_leg_cap_cents', 'platform_fee_pct']
  .map((k) => [k, getSetting(k, null)]);
// Known settings for the test: first 5 km free, max R10/km, cap R150, margin 20%.
setSetting('return_leg_free_km', '5'); setSetting('return_leg_per_km_cents', '1000');
setSetting('return_leg_cap_cents', '15000'); setSetting('platform_fee_pct', '20');

const stamp = Date.now();
function mkUser(role, name, services) {
  const id = db.prepare(`INSERT INTO users (role, name, email, phone, password_hash) VALUES (?, ?, ?, '+27820000000', 'x')`)
    .run(role, name, `rt-${role}-${services || ''}-${stamp}@test.invalid`).lastInsertRowid;
  if (role === 'supplier') {
    db.prepare(`INSERT INTO suppliers (user_id, business_name, id_number, status, online, lat, lng, services, radius_km)
      VALUES (?, ?, '0000000000000', 'approved', 1, -33.83, 18.65, ?, 25)`).run(id, name, services);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
const laundryPro = mkUser('supplier', 'RT Laundry', 'laundry');
const carPro = mkUser('supplier', 'RT Car', 'carwash');
const customer = mkUser('customer', 'RT Customer');
// Sign before the server boots: its startup gives any key-less account a fresh session key.
const TOKENS = new Map([laundryPro, carPro, customer].map((u) => [u.id, auth.signUser(u)]));
const tok = (u) => TOKENS.get(u.id);

// An open laundry request 2 km from the pro, returning to an address ~20 km from the pro.
const reqId = db.prepare(`INSERT INTO quote_requests (customer_id, service, package, vehicle, address, lat, lng,
    return_address, return_lat, return_lng, expires_at)
  VALUES (?, 'laundry', 'wash_fold', ?, 'Test street', -33.84, 18.65, 'Return street', -33.83, 18.866, datetime('now', '+1 hour'))`)
  .run(customer.id, Object.keys(require(path.join(ROOT, 'server', 'pricing')).SERVICES.laundry.units)[0]).lastInsertRowid;

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), SMTP_PASS: '', WHATSAPP_TOKEN: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  const call = async (u, p, method = 'GET', body) => {
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${tok(u)}`, 'Content-Type': 'application/json', 'X-FreshAF-Client': 'native' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

    const pub = (await (await fetch(`${BASE}/api/pricing`)).json()).return_leg;
    check('customer sees max all-in before booking', pub, { free_km: 5, max_per_km_cents: 1200, cap_cents: 18000 });

    let r = await call(laundryPro, '/api/supplier/prices');
    check('laundry pro sees return-trip limits, no rate yet', r.json.return_trip, { rate_cents: null, max_cents: 1000, free_km: 5, cap_cents: 15000 });
    r = await call(carPro, '/api/supplier/prices');
    check('car-wash-only pro has no return-trip setting', r.json.return_trip, null);

    const km = require(path.join(ROOT, 'server', 'dispatch')).haversineKm(-33.83, 18.866, -33.83, 18.65);
    r = await call(laundryPro, '/api/supplier/quote-requests');
    const leg = (x) => x.json.requests.find((q) => q.id === Number(reqId))?.return_leg_fee_cents;
    check(`no rate chosen: paid the maximum (${km.toFixed(1)} km)`, leg(r), Math.min(15000, Math.round((km - 5) * 1000 / 100) * 100));

    r = await call(laundryPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: 1100 });
    check('rate above the maximum is refused', [r.status, r.json.error], [400, 'The most you can charge for the return trip is R10.00 per km']);
    r = await call(laundryPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: -5 });
    check('negative rate is refused', r.status, 400);
    r = await call(carPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: 500 });
    check('car-wash-only pro cannot set a return rate', r.status, 400);

    r = await call(laundryPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: 500 });
    check('pro saves R5/km', r.status, 200);
    r = await call(laundryPro, '/api/supplier/prices');
    check('rate is stored', r.json.return_trip.rate_cents, 500);
    r = await call(laundryPro, '/api/supplier/quote-requests');
    check('job list uses the pro rate', leg(r), Math.round((km - 5) * 500 / 100) * 100);

    // A manual quote: what the pro earns and what the customer pays both use the pro's rate.
    r = await call(laundryPro, `/api/supplier/quote-requests/${reqId}/quote`, 'POST', { price_cents: 20000 });
    const q = db.prepare('SELECT * FROM quotes WHERE request_id = ? AND supplier_id = ?').get(reqId, laundryPro.id);
    const want = Math.round((km - 5) * 500 / 100) * 100;
    check('quote stores the pro-rate return leg', q.return_leg_fee_cents, want);
    check('pro is told the right earnings', r.json.you_earn_cents, 20000 + q.callout_fee_cents + want);
    check('customer total = cost + 20% margin, one price', q.total_cents,
      20000 + q.callout_fee_cents + want + Math.round((20000 + q.callout_fee_cents + want) * 20 / 100 / 100) * 100);
    check('customer return share within published max', want * 1.2 <= Math.max(0, km - 5) * 1200 + 1, true);

    // Owner lowers the maximum below the pro's saved rate: the pro is capped, not refused.
    setSetting('return_leg_per_km_cents', '300');
    check('lowered maximum caps an existing rate', quotes.returnLegFor(km, 500), Math.round((km - 5) * 300 / 100) * 100);
    setSetting('return_leg_per_km_cents', '1000');

    r = await call(laundryPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: null });
    r = await call(laundryPro, '/api/supplier/prices');
    check('clearing the rate goes back to the maximum', r.json.return_trip.rate_cents, null);
    check('R0 is allowed (free return)', (await call(laundryPro, '/api/supplier/prices', 'POST', { prices: [], return_per_km_cents: 0 })).status, 200);
    check('R0 rate gives a free return trip', quotes.returnLegFor(km, 0), 0);
  } catch (e) {
    console.log('ERROR', e); checks.push(false);
  } finally {
    server.kill();
    for (const [k, v] of SAVED) { if (v == null) db.prepare('DELETE FROM settings WHERE key = ?').run(k); else setSetting(k, v); }
    const bad = checks.filter((c) => !c).length;
    console.log(`\n${checks.length - bad}/${checks.length} passed`);
    if (bad) console.log(log.slice(-1500));
    process.exit(bad ? 1 : 0);
  }
})();
