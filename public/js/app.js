// FreshAF customer app — home, auth, booking (car wash + laundry), tracking, account.
let me = null;
let pricing = null;
let svc = 'carwash';
let sel = { package: null, unit: null, lat: null, lng: null };
let callout = null;
let map, pin;
let currentOrder = null;
let rateStars = 0;
let disconnectSse = null;

const VIEWS = ['view-home', 'view-login', 'view-register', 'view-order', 'view-track'];
const STEPS = ['searching', 'accepted', 'en_route', 'in_progress', 'completed'];
const STEP_LABELS = {
  carwash: { searching: 'Searching', accepted: 'Accepted', en_route: 'En route', in_progress: 'Washing', completed: 'Done' },
  laundry: { searching: 'Searching', accepted: 'Accepted', en_route: 'Collecting', in_progress: 'Laundering', completed: 'Delivered' },
};
const PKG_ICONS = {
  express: 'droplet', wash_vac: 'spark', full_valet: 'shield',
  wash_fold: 'shirt', wash_iron: 'spark', bedding: 'home',
};
const SVC_COPY = {
  carwash: { book: 'Book a wash', where: 'Where is the car?', notesPh: 'e.g. White Hilux, keys with security' },
  laundry: { book: 'Book a laundry collection', where: 'Where do we collect?', notesPh: 'e.g. Bag at reception, gate code 4321' },
};

const show = (view) => switchView(VIEWS, view);

function decorate() {
  el('chip-vetted').insertAdjacentHTML('afterbegin', icon('shield'));
  el('chip-track').insertAdjacentHTML('afterbegin', icon('navigate'));
  el('chip-pay').insertAdjacentHTML('afterbegin', icon('card'));
  el('chip-rewards').insertAdjacentHTML('afterbegin', icon('wallet'));
  el('h-how').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-pro').insertAdjacentHTML('afterbegin', icon('briefcase'));
  el('h-signin').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-create').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-book').insertAdjacentHTML('afterbegin', icon('droplet'));
  el('h-orders').insertAdjacentHTML('afterbegin', icon('clock'));
  el('btn-geolocate').insertAdjacentHTML('afterbegin', icon('navigate'));
  el('btn-saved-address').insertAdjacentHTML('afterbegin', icon('home'));
  el('tab-carwash').insertAdjacentHTML('afterbegin', icon('car'));
  el('tab-laundry').insertAdjacentHTML('afterbegin', icon('shirt'));
  el('seg-card').insertAdjacentHTML('afterbegin', icon('card'));
  el('seg-cash').insertAdjacentHTML('afterbegin', icon('cash'));
  el('btn-back-orders').insertAdjacentHTML('afterbegin', icon('back'));
  el('btn-retry-order').insertAdjacentHTML('afterbegin', icon('refresh'));
  el('rate-stars').innerHTML = [1, 2, 3, 4, 5].map((v) =>
    `<button data-v="${v}" aria-label="${v} star"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></button>`).join('');
  el('rate-stars').querySelectorAll('button').forEach((s) => {
    s.onclick = () => {
      rateStars = Number(s.dataset.v);
      el('rate-stars').querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.v) <= rateStars));
    };
  });
}

function setTopbar() {
  el('btn-account').classList.toggle('hidden', !me);
  el('btn-logout').classList.toggle('hidden', !me);
  el('btn-go-login').classList.toggle('hidden', !!me);
  if (me) el('btn-account').innerHTML = `${icon('user')} ${me.name.split(' ')[0]}`;
}

async function boot() {
  try {
    decorate();
    const { user } = await api('/api/auth/me');
    if (user && user.role !== 'customer') {
      window.location.href = user.role === 'supplier' ? '/supplier' : '/admin';
      return;
    }
    me = user;
    setTopbar();
    pricing = await api('/api/pricing');
    if (!me) { renderHomeServices(); show('view-home'); hideSplash(); return; }
    await enterApp();
    hideSplash();
  } catch (e) {
    try { renderHomeServices(); } catch {}
    show('view-home');
    hideSplash();
  }
}

/* ---------- home showcase ---------- */
function renderHomeServices() {
  if (!pricing) return;
  el('home-services').innerHTML = ['carwash', 'laundry'].map((key) => {
    const cat = pricing.services[key];
    return `
    <div class="card" style="margin-bottom:0">
      <h2>${icon(key === 'laundry' ? 'shirt' : 'car')} ${cat.name}</h2>
      ${cat.packages.map((p) => `
        <div class="row spread" style="padding:9px 0;border-bottom:1px solid var(--border-soft)">
          <div>
            <strong style="font-size:.92rem">${p.name}</strong>
            <div class="muted small-text">${p.desc}</div>
          </div>
          <strong style="color:var(--accent-dim);white-space:nowrap">from ${rand(p.base)}</strong>
        </div>`).join('')}
      <p class="muted small-text mt">${key === 'carwash' ? 'Washed at your parking spot — home, office or gym.' : 'Collected, professionally cleaned, delivered back to you.'}</p>
    </div>`;
  }).join('');
}

/* ---------- auth navigation ---------- */
el('btn-cta-register').onclick = () => show('view-register');
el('btn-cta-login').onclick = () => show('view-login');
el('btn-go-login').onclick = () => show('view-login');
el('link-to-register').onclick = (e) => { e.preventDefault(); show('view-register'); };
el('link-to-login').onclick = (e) => { e.preventDefault(); show('view-login'); };
el('link-back-home').onclick = (e) => { e.preventDefault(); show('view-home'); };

async function enterApp() {
  if (!pricing) pricing = await api('/api/pricing');
  setService('carwash');
  refreshPointsRow();
  refreshSavedAddress();
  el('use-points').onchange = updateTotal;
  await refreshOrders();
  show('view-order');
  initMap();
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    order_update: async (order) => {
      if (currentOrder && order.id === currentOrder.id) renderTrack(order);
      refreshOrders();
      if (order.status === 'completed') {
        const { user } = await api('/api/auth/me');
        me = user;
        refreshPointsRow();
        updateTotal();
      }
    },
  });
  const params = new URLSearchParams(window.location.search);
  const trackId = params.get('track');
  if (trackId) {
    history.replaceState({}, '', '/');
    openTrack(Number(trackId));
  }
}

/* ---------- service tabs ---------- */
function setService(key) {
  svc = key;
  sel.package = null; sel.unit = null;
  callout = null;
  document.querySelectorAll('.service-tab').forEach((t) => t.classList.toggle('active', t.dataset.svc === key));
  const copy = SVC_COPY[key];
  el('h-book').innerHTML = `${icon(key === 'laundry' ? 'shirt' : 'droplet')} ${copy.book}`;
  el('unit-heading').textContent = pricing.services[key].unitLabel;
  el('where-heading').textContent = copy.where;
  el('order-notes').placeholder = copy.notesPh;
  renderPickers();
  if (sel.lat != null) refreshCallout();
  updateTotal();
}
document.querySelectorAll('.service-tab').forEach((t) => t.onclick = () => setService(t.dataset.svc));

function renderPickers() {
  const cat = pricing.services[svc];
  const pg = el('pkg-grid');
  pg.innerHTML = cat.packages.map((p) => `
    <div class="pkg" data-pkg="${p.key}">
      <span class="tick">${icon('check')}</span>
      <div class="pkg-icon">${icon(PKG_ICONS[p.key] || 'droplet', 'lg')}</div>
      <div class="name">${p.name}</div>
      <div class="price">${rand(p.base)} <small>base</small></div>
      <div class="desc">${p.desc} · ${p.eta}</div>
    </div>`).join('');
  const vg = el('veh-grid');
  vg.innerHTML = cat.units.map((u) => `
    <div class="pkg" data-unit="${u.key}">
      <span class="tick">${icon('check')}</span>
      <div class="pkg-icon">${icon(svc === 'laundry' ? 'shirt' : 'car', 'lg')}</div>
      <div class="name">${u.name}</div>
      <div class="desc">${u.mult === 1 ? 'Standard rate' : 'Rate multiplier ' + u.mult}</div>
    </div>`).join('');
  pg.querySelectorAll('.pkg').forEach((n) => n.onclick = () => { sel.package = n.dataset.pkg; refreshSel(); });
  vg.querySelectorAll('.pkg').forEach((n) => n.onclick = () => { sel.unit = n.dataset.unit; refreshSel(); });
}

function refreshSel() {
  document.querySelectorAll('#pkg-grid .pkg').forEach((n) => n.classList.toggle('selected', n.dataset.pkg === sel.package));
  document.querySelectorAll('#veh-grid .pkg').forEach((n) => n.classList.toggle('selected', n.dataset.unit === sel.unit));
  updateTotal();
}

function refreshPointsRow() {
  const balance = me?.points_cents || 0;
  el('points-row').classList.toggle('hidden', balance <= 0);
  el('points-label').textContent = `Use my rewards balance (${rand(balance)} available)`;
}

function refreshSavedAddress() {
  el('btn-saved-address').classList.toggle('hidden', me?.home_lat == null);
  if (me?.home_address && !el('order-address').value) el('order-address').value = me.home_address;
}

function updateTotal() {
  const cat = pricing.services[svc];
  const pkg = cat.packages.find((p) => p.key === sel.package);
  const unit = cat.units.find((u) => u.key === sel.unit);
  const notes = [];
  if (!pkg || !unit) {
    el('order-total').textContent = '—';
    if (callout?.available && callout.fee_cents > 0) notes.push(`Callout fee ${rand(callout.fee_cents)} (nearest pro ${callout.distance_km} km)`);
    el('price-note').textContent = notes.join(' · ');
    return;
  }
  const base = Math.round(pkg.base * unit.mult / 100) * 100;
  const fee = callout?.available ? callout.fee_cents : 0;
  const subtotal = base + fee;
  const usePoints = el('use-points').checked;
  const discount = usePoints ? Math.min(me?.points_cents || 0, subtotal) : 0;
  el('order-total').textContent = rand(subtotal - discount);
  if (fee > 0) notes.push(`Includes ${rand(fee)} callout fee — nearest pro ${callout.distance_km} km`);
  else if (callout?.available) notes.push('No callout fee — a pro is nearby');
  else if (sel.lat != null) notes.push('Callout fee confirmed when a pro is online');
  if (discount > 0) notes.push(`Rewards applied −${rand(discount)}`);
  el('price-note').textContent = notes.join(' · ');
}

/* ---------- map ---------- */
function initMap() {
  if (map) return;
  const startLat = me?.home_lat ?? -26.1076, startLng = me?.home_lng ?? 28.0567;
  map = L.map('map').setView([startLat, startLng], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng));
  if (me?.home_lat != null) setPin(me.home_lat, me.home_lng);
}

function refreshCallout() {
  api(`/api/quote/callout?lat=${sel.lat}&lng=${sel.lng}&service=${svc}`)
    .then((q) => { callout = q; updateTotal(); })
    .catch(() => { callout = null; updateTotal(); });
}

function setPin(lat, lng) {
  sel.lat = lat; sel.lng = lng;
  if (pin) pin.setLatLng([lat, lng]); else pin = L.marker([lat, lng]).addTo(map);
  el('pin-status').innerHTML = `${icon('pin')} Pin set — ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  refreshCallout();
}

el('btn-geolocate').onclick = () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => { setPin(pos.coords.latitude, pos.coords.longitude); map.setView([pos.coords.latitude, pos.coords.longitude], 14); },
    () => showError('order-error', 'Could not get your location — tap the map instead.'),
  );
};

el('btn-saved-address').onclick = () => {
  if (me?.home_lat == null) return;
  setPin(me.home_lat, me.home_lng);
  map.setView([me.home_lat, me.home_lng], 14);
  if (me.home_address) el('order-address').value = me.home_address;
};

// Booking address suggestions: picking one drops the pin and quotes the callout fee.
attachAutocomplete(el('order-address'), (r) => {
  if (!map) return;
  setPin(r.lat, r.lng);
  map.setView([r.lat, r.lng], 15);
});

/* ---------- auth actions ---------- */
// Address suggestions: registration stores the picked coordinates as the home pin.
let regGeo = null;
attachAutocomplete(el('reg-address'), (r) => { regGeo = { lat: r.lat, lng: r.lng }; });
el('reg-address').addEventListener('input', () => { regGeo = null; }); // typed edits invalidate the pick

el('btn-login').onclick = () => withBusy(el('btn-login'), 'Signing in…', async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value, password: el('login-password').value } });
    if (user.role !== 'customer') { window.location.href = user.role === 'supplier' ? '/supplier' : '/admin'; return; }
    me = user; setTopbar(); await enterApp();
    toast(`Welcome back, ${user.name.split(' ')[0]}`, 'ok');
  } catch (e) { showError('login-error', e.message); }
});

el('btn-register').onclick = () => withBusy(el('btn-register'), 'Creating your account…', async () => {
  try {
    if (!el('reg-terms').checked) throw new Error('Please accept the Terms & Conditions to continue');
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        role: 'customer', name: el('reg-name').value, email: el('reg-email').value,
        phone: el('reg-phone').value, password: el('reg-password').value,
        home_address: el('reg-address').value, accept_terms: true,
        home_lat: regGeo?.lat, home_lng: regGeo?.lng,
      },
    });
    me = user; setTopbar(); await enterApp();
    toast('Account created — welcome to FreshAF', 'ok');
  } catch (e) { showError('reg-error', e.message); }
});

el('btn-logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.reload(); };

/* ---------- account dialog (profile, rewards, deletion) ---------- */
el('btn-account').onclick = () => openAccount();

function openAccount() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${icon('user')} My account</h3>
      <p style="margin-bottom:4px">Rewards balance: <strong style="color:var(--accent-dim)">${rand(me.points_cents || 0)}</strong></p>
      <label>Full name</label><input id="acc-name" value="${me.name.replace(/"/g, '&quot;')}">
      <label>Mobile number</label><input id="acc-phone" value="${(me.phone || '').replace(/"/g, '&quot;')}">
      <label>Preferred address</label><input id="acc-address" value="${(me.home_address || '').replace(/"/g, '&quot;')}">
      <div class="row mt" style="justify-content:space-between">
        <button class="ghost small" data-act="delete" style="color:var(--danger)">Delete account</button>
        <div class="row">
          <button class="ghost" data-act="close">Close</button>
          <button data-act="save">Save</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  attachAutocomplete(backdrop.querySelector('#acc-address'));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-act=close]').onclick = () => backdrop.remove();
  backdrop.querySelector('[data-act=save]').onclick = async () => {
    try {
      const { user } = await api('/api/auth/profile', {
        method: 'POST',
        body: {
          name: backdrop.querySelector('#acc-name').value,
          phone: backdrop.querySelector('#acc-phone').value,
          home_address: backdrop.querySelector('#acc-address').value,
        },
      });
      me = user; setTopbar(); refreshSavedAddress();
      backdrop.remove();
      toast('Profile updated', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
  backdrop.querySelector('[data-act=delete]').onclick = async () => {
    backdrop.remove();
    const pw = await modal({
      title: 'Delete your account?',
      body: 'This permanently removes your personal details and rewards balance. Completed order records are kept anonymised as required by law. Enter your password to confirm.',
      input: 'Password', confirmText: 'Delete my account', danger: true,
    });
    if (pw === null) return;
    try {
      await api('/api/auth/delete-account', { method: 'POST', body: { password: pw } });
      toast('Your account has been deleted', 'info');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- ordering ---------- */
el('btn-place-order').onclick = async () => {
  try {
    if (!sel.package || !sel.unit) throw new Error('Choose a package and an option first');
    const payment_method = document.querySelector('input[name=pay]:checked').value;
    const data = await api('/api/orders', {
      method: 'POST',
      body: {
        service: svc, package: sel.package, vehicle: sel.unit,
        address: el('order-address').value, lat: sel.lat, lng: sel.lng,
        notes: el('order-notes').value, payment_method,
        use_points: el('use-points').checked,
      },
    });
    if (data.payment_url) { window.location.href = data.payment_url; return; }
    const { user } = await api('/api/auth/me');
    me = user;
    refreshPointsRow();
    refreshSavedAddress();
    openTrackOrder(data.order);
  } catch (e) { showError('order-error', e.message); }
};

async function refreshOrders() {
  const { orders } = await api('/api/orders');
  if (!orders.length) { el('orders-list').innerHTML = '<p class="empty">No orders yet.</p>'; return; }
  el('orders-list').innerHTML = orders.map((o) => {
    const cat = pricing.services[o.service] || pricing.services.carwash;
    const pkgName = (cat.packages.find((p) => p.key === o.package) || {}).name || o.package;
    return `
    <div class="order-item">
      <div>
        <div class="title">${serviceName(o.service)} #${o.id} — ${pkgName}</div>
        <div class="sub">${o.address}</div>
      </div>
      <div class="row" style="flex-wrap:nowrap">
        <span class="pill ${statusPillClass(o.status)}">${statusLabel(o.status, o.service)}</span>
        <strong>${rand(o.price_cents)}</strong>
        <button class="secondary small" onclick="openTrack(${o.id})">View</button>
      </div>
    </div>`;
  }).join('');
}

async function openTrack(orderId) {
  const { order } = await api(`/api/orders/${orderId}`);
  openTrackOrder(order);
}
window.openTrack = openTrack;

function openTrackOrder(order) {
  currentOrder = order;
  show('view-track');
  renderTrack(order);
}

function renderTrack(order) {
  const prevStatus = currentOrder?.status;
  currentOrder = order;
  const noun = order.service === 'laundry' ? 'laundry pro' : 'washer';
  el('track-title').innerHTML = `${icon(order.service === 'laundry' ? 'shirt' : 'droplet')} ${serviceName(order.service)} order #${order.id}`;
  const pill = el('track-pill');
  pill.textContent = statusLabel(order.status, order.service);
  pill.className = `pill ${statusPillClass(order.status)}${['searching', 'en_route', 'in_progress'].includes(order.status) ? ' live' : ''}`;

  const idx = STEPS.indexOf(order.status);
  const labels = STEP_LABELS[order.service] || STEP_LABELS.carwash;
  el('track-timeline').innerHTML = STEPS.map((s, i) => {
    const cls = idx < 0 ? '' : i < idx ? 'done' : i === idx ? 'current' : '';
    return `<div class="step ${cls}">${labels[s]}</div>`;
  }).join('');

  let body = '';
  if (order.status === 'searching') {
    body += `<div class="radar"><div class="rings"><div class="r3"></div><div class="core">${icon('search')}</div></div>
      <p>Contacting the nearest available ${noun}…</p></div>`;
  }
  const breakdown = [];
  if (order.callout_fee_cents > 0) breakdown.push(`includes ${rand(order.callout_fee_cents)} callout fee`);
  if (order.points_used_cents > 0) breakdown.push(`rewards applied −${rand(order.points_used_cents)}`);
  body += `<p class="muted">${icon('pin')} ${order.address}</p>
    <p class="mt"><strong>${rand(order.amount_due_cents)}</strong> <span class="muted">· ${order.payment_method === 'cash' ? 'Cash on completion' : 'Paid by card'}${breakdown.length ? ' · ' + breakdown.join(' · ') : ''}</span></p>`;
  if (order.status === 'completed' && order.points_earned_cents > 0) {
    body += `<p class="mt" style="color:var(--accent-dim);font-weight:600">${icon('wallet')} You earned ${rand(order.points_earned_cents)} back in rewards.</p>`;
  }
  if (order.supplier) {
    body += `<div class="provider-box">
      <span class="avatar">${icon('user', 'lg')}</span>
      <div>
        <strong>${order.supplier.business_name}</strong> — ${order.supplier.name}
        ${order.supplier.rating ? `<span class="star-inline"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span> ${order.supplier.rating}` : '<span class="muted small-text">· New pro</span>'}
        <div class="muted small-text">${order.supplier.phone || ''}</div>
      </div>
    </div>`;
  }
  if (order.status === 'no_providers') {
    body += `<p class="mt" style="color:var(--warn)">No ${noun}s are available near you right now. Try again in a few minutes.</p>`;
  }
  el('track-body').innerHTML = body;

  el('btn-cancel-order').classList.toggle('hidden', !['pending_payment', 'searching', 'no_providers', 'accepted'].includes(order.status));
  el('btn-retry-order').classList.toggle('hidden', order.status !== 'no_providers');
  el('rate-box').classList.toggle('hidden', order.status !== 'completed');

  if (prevStatus && prevStatus !== order.status) {
    if (order.status === 'accepted') toast(`A ${noun} accepted your order`, 'ok');
    if (order.status === 'en_route') toast(order.service === 'laundry' ? 'Your laundry pro is on the way to collect' : 'Your washer is on the way', 'info');
    if (order.status === 'completed') {
      toast(order.points_earned_cents > 0
        ? `Order complete — you earned ${rand(order.points_earned_cents)} in rewards`
        : 'Order complete', 'ok');
    }
  }
}

el('btn-back-orders').onclick = () => { currentOrder = null; show('view-order'); refreshOrders(); };

el('btn-cancel-order').onclick = async () => {
  const yes = await modal({
    title: 'Cancel this order?',
    body: 'The search will stop and the order will be closed. Any rewards used are refunded.',
    confirmText: 'Cancel order', cancelText: 'Keep it', danger: true,
  });
  if (!yes) return;
  await api(`/api/orders/${currentOrder.id}/cancel`, { method: 'POST' });
  const { user } = await api('/api/auth/me');
  me = user;
  refreshPointsRow();
  toast('Order cancelled', 'info');
  openTrack(currentOrder.id);
};

el('btn-retry-order').onclick = async () => {
  await api(`/api/orders/${currentOrder.id}/retry`, { method: 'POST' });
  openTrack(currentOrder.id);
};

el('btn-submit-rating').onclick = async () => {
  try {
    await api(`/api/orders/${currentOrder.id}/rate`, { method: 'POST', body: { stars: rateStars, comment: el('rate-comment').value } });
    el('rate-box').innerHTML = `<hr class="divider"><p style="color:var(--accent-dim)">${icon('check')} Thanks — your rating is in.</p>`;
    toast('Rating submitted', 'ok');
  } catch (e) { showError('order-error', e.message); }
};

boot();
