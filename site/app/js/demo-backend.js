// FreshAF demo backend — the whole marketplace simulated in the browser.
// Persists to localStorage; pros are seeded around the visitor's real location.
(() => {
  const KEY = 'freshaf_demo_v1';
  const listeners = {};

  const CATALOG = {
    carwash: {
      key: 'carwash', name: 'Car Wash', providerNoun: 'washer', unitLabel: 'Vehicle type',
      packages: [
        { key: 'express', name: 'Express Wash', desc: 'Exterior hand wash & dry', base: 18000, eta: 'about 30 min' },
        { key: 'wash_vac', name: 'Wash & Vacuum', desc: 'Exterior wash, dry, interior vacuum & wipe-down', base: 28000, eta: 'about 50 min' },
        { key: 'full_valet', name: 'Full Valet', desc: 'Deep interior clean, wax, tyre shine, the works', base: 65000, eta: 'about 2 h' },
      ],
      units: [
        { key: 'sedan', name: 'Sedan / Hatchback', mult: 1.0 },
        { key: 'suv', name: 'SUV / Bakkie', mult: 1.25 },
        { key: 'minibus', name: 'Minibus / Van', mult: 1.5 },
      ],
    },
    laundry: {
      key: 'laundry', name: 'Laundry', providerNoun: 'laundry pro', unitLabel: 'Load size',
      packages: [
        { key: 'wash_fold', name: 'Wash & Fold', desc: 'Washed, tumble-dried and neatly folded', base: 22000, eta: '24–48 h turnaround' },
        { key: 'wash_iron', name: 'Wash, Dry & Iron', desc: 'Full wash plus professional ironing, ready to wear', base: 32000, eta: '48 h turnaround' },
        { key: 'bedding', name: 'Duvets & Bedding', desc: 'Duvets, blankets, linen — deep washed and dried', base: 38000, eta: '48 h turnaround' },
      ],
      units: [
        { key: 'small', name: 'Small load (up to 8 kg)', mult: 1.0 },
        { key: 'medium', name: 'Medium load (up to 15 kg)', mult: 1.5 },
        { key: 'large', name: 'Large load (up to 25 kg)', mult: 2.0 },
      ],
    },
  };

  const PRO_NAMES = [
    ['Sipho Dlamini', 'Sipho Mobile Shine', ['carwash']],
    ['Thandi Nkosi', 'Thandi Sparkle Wash', ['carwash']],
    ['Palesa Mokoena', 'Palesa Fresh Laundry', ['laundry']],
    ['Lerato Khumalo', 'Lerato Laundry Co', ['laundry']],
    ['Bongani Zulu', 'Bongani Wash & Fold', ['carwash', 'laundry']],
    ['Naledi Molefe', 'Naledi Premium Care', ['carwash', 'laundry']],
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
  let state = load();
  state.orders = state.orders || [];
  state.nextId = state.nextId || 1;

  function emit(event, data) {
    (listeners[event] || []).forEach((fn) => { try { fn(data); } catch {} });
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Seed simulated pros around a centre point (the visitor's real location).
  function ensurePros(lat, lng) {
    if (state.pros?.length && state.prosCenter && haversineKm(lat, lng, state.prosCenter.lat, state.prosCenter.lng) < 30) return;
    state.prosCenter = { lat, lng };
    state.pros = PRO_NAMES.map(([name, business, services], i) => {
      const angle = (i / PRO_NAMES.length) * 2 * Math.PI + 0.7;
      const distKm = 0.8 + (i * 1.3);
      return {
        id: 100 + i, name, business_name: business, services,
        lat: lat + (distKm / 111) * Math.cos(angle),
        lng: lng + (distKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle),
        rating: +(4.3 + (i % 3) * 0.25).toFixed(1), rating_count: 12 + i * 7,
        phone: `071 555 01${20 + i}`,
      };
    });
    save(state);
  }

  function quote(service, pkg, unit) {
    const cat = CATALOG[service];
    const p = cat?.packages.find((x) => x.key === pkg);
    const u = cat?.units.find((x) => x.key === unit);
    if (!p || !u) return null;
    return Math.round(p.base * u.mult / 100) * 100;
  }

  function callout(lat, lng, service) {
    ensurePros(lat, lng);
    const candidates = state.pros.filter((p) => p.services.includes(service));
    if (!candidates.length) return { available: false, fee_cents: 0, distance_km: null };
    let dist = Infinity;
    for (const p of candidates) dist = Math.min(dist, haversineKm(lat, lng, p.lat, p.lng));
    const extra = Math.max(0, dist - 5);
    return { available: true, fee_cents: Math.min(15000, Math.round(extra * 1000 / 100) * 100), distance_km: +dist.toFixed(1) };
  }

  function orderPublic(o) {
    const pro = o.pro_id ? state.pros.find((p) => p.id === o.pro_id) : null;
    return {
      ...o,
      amount_due_cents: o.price_cents - (o.points_used_cents || 0),
      supplier: pro ? {
        name: pro.name, business_name: pro.business_name, phone: pro.phone,
        rating: pro.rating, lat: pro.lat, lng: pro.lng,
      } : null,
    };
  }

  const ACTIVE = ['searching', 'accepted', 'en_route', 'in_progress'];
  const NEXT = { searching: 'accepted', accepted: 'en_route', en_route: 'in_progress', in_progress: 'completed' };
  const DELAYS = { searching: 4500, accepted: 6000, en_route: 8000, in_progress: 9000 };

  function advance(orderId) {
    const o = state.orders.find((x) => x.id === orderId);
    if (!o || !NEXT[o.status]) return;
    const next = NEXT[o.status];
    if (next === 'accepted') {
      // assign the nearest pro offering this service
      const candidates = state.pros.filter((p) => p.services.includes(o.service))
        .map((p) => ({ p, d: haversineKm(o.lat, o.lng, p.lat, p.lng) }))
        .sort((a, b) => a.d - b.d);
      if (!candidates.length) { o.status = 'no_providers'; save(state); emit('order_update', orderPublic(o)); return; }
      o.pro_id = candidates[0].p.id;
    }
    o.status = next;
    if (next === 'completed') {
      o.completed_at = new Date().toISOString();
      o.points_earned_cents = Math.round(o.price_cents * 0.05);
      if (o.payment_method === 'cash') o.payment_status = 'collected';
      state.user.points_cents = (state.user.points_cents || 0) + o.points_earned_cents;
    }
    save(state);
    emit('order_update', orderPublic(o));
    scheduleNext(o);
  }

  function scheduleNext(o) {
    if (!NEXT[o.status]) return;
    setTimeout(() => advance(o.id), DELAYS[o.status] || 6000);
  }

  // Resume any in-flight orders after a page reload.
  function resume() {
    for (const o of state.orders) if (ACTIVE.includes(o.status)) scheduleNext(o);
  }
  setTimeout(resume, 1500);

  function err(message, status = 400) {
    const e = new Error(message); e.status = status; return e;
  }

  function makeUser({ name, email, phone, home_address }) {
    state.user = {
      id: 1, role: 'customer',
      name: name || 'Guest Explorer',
      email: email || 'guest@freshaf.demo',
      phone: phone || null,
      home_address: home_address || null,
      home_lat: state.user?.home_lat ?? null,
      home_lng: state.user?.home_lng ?? null,
      points_cents: state.user?.points_cents || 0,
    };
    save(state);
    return state.user;
  }

  async function handle(path, opts = {}) {
    const method = opts.method || 'GET';
    const body = opts.body || {};
    const url = new URL(path, 'https://demo.local');
    const p = url.pathname;

    if (p === '/api/auth/me') return { user: state.user || null };
    if (p === '/api/auth/guest') return { user: makeUser({}) };
    if (p === '/api/auth/login') {
      const name = (body.email || 'Guest').split('@')[0].replace(/[._-]/g, ' ');
      return { user: makeUser({ name: name.charAt(0).toUpperCase() + name.slice(1), email: body.email }) };
    }
    if (p === '/api/auth/register') {
      if (body.accept_terms !== true) throw err('You must accept the Terms & Conditions to create an account');
      if (!body.home_address?.trim()) throw err('Your preferred address is required');
      return { user: makeUser(body) };
    }
    if (p === '/api/auth/logout') { state.user = null; save(state); return { ok: true }; }
    if (p === '/api/auth/profile') {
      if (!body.name?.trim()) throw err('Name is required');
      Object.assign(state.user, { name: body.name.trim(), phone: body.phone || null, home_address: body.home_address || state.user.home_address });
      save(state);
      return { user: state.user };
    }
    if (p === '/api/auth/delete-account') {
      localStorage.removeItem(KEY);
      state = { orders: [], nextId: 1 };
      return { ok: true };
    }

    if (p === '/api/pricing') {
      return {
        services: CATALOG, payments_live: false, points_earn_pct: 5,
        callout: { free_km: 5, per_km_cents: 1000, cap_cents: 15000 },
      };
    }
    if (p === '/api/quote/callout') {
      return callout(Number(url.searchParams.get('lat')), Number(url.searchParams.get('lng')), url.searchParams.get('service') || 'carwash');
    }

    if (p === '/api/orders' && method === 'POST') {
      if (!state.user) throw err('Not signed in', 401);
      const base = quote(body.service, body.package, body.vehicle);
      if (base == null) throw err('Invalid package or size selection');
      if (!body.address?.trim() || typeof body.lat !== 'number') throw err('Pick your location on the map and enter an address');
      if (state.orders.some((o) => o.service === body.service && ACTIVE.concat('pending_payment').includes(o.status))) {
        throw err('You already have an active order for this service. Complete or cancel it first.');
      }
      const c = callout(body.lat, body.lng, body.service);
      const price = base + c.fee_cents;
      const pointsUsed = body.use_points ? Math.min(state.user.points_cents || 0, price) : 0;
      state.user.points_cents -= pointsUsed;
      if (state.user.home_lat == null) { state.user.home_lat = body.lat; state.user.home_lng = body.lng; state.user.home_address = state.user.home_address || body.address; }
      const order = {
        id: state.nextId++, service: body.service, package: body.package, vehicle: body.vehicle,
        price_cents: price, callout_fee_cents: c.fee_cents, points_used_cents: pointsUsed, points_earned_cents: 0,
        address: body.address.trim(), lat: body.lat, lng: body.lng, notes: body.notes || null,
        payment_method: body.payment_method,
        payment_status: body.payment_method === 'cash' ? 'collect_on_completion' : 'paid', // demo: card is instant
        status: 'searching', pro_id: null, created_at: new Date().toISOString(),
      };
      state.orders.unshift(order);
      save(state);
      scheduleNext(order);
      return { order: orderPublic(order) }; // no payment_url — demo skips the gateway
    }
    if (p === '/api/orders' && method === 'GET') {
      return { orders: state.orders.map(orderPublic) };
    }
    const orderMatch = p.match(/^\/api\/orders\/(\d+)(?:\/(\w+))?$/);
    if (orderMatch) {
      const o = state.orders.find((x) => x.id === Number(orderMatch[1]));
      if (!o) throw err('Order not found', 404);
      const action = orderMatch[2];
      if (!action) return { order: orderPublic(o) };
      if (action === 'cancel') {
        if (!['pending_payment', 'searching', 'no_providers', 'accepted'].includes(o.status)) throw err('This order can no longer be cancelled');
        o.status = 'cancelled';
        state.user.points_cents += o.points_used_cents || 0;
        save(state);
        return { ok: true };
      }
      if (action === 'retry') { o.status = 'searching'; save(state); scheduleNext(o); return { ok: true }; }
      if (action === 'rate') {
        if (o.status !== 'completed') throw err('You can only rate completed orders');
        o.rated = body.stars; save(state); return { ok: true };
      }
    }

    throw err(`Demo: ${method} ${p} not implemented`, 404);
  }

  window.DEMO = {
    handle,
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    ensurePros,
  };
})();
