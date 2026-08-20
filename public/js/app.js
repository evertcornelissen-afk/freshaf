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

const VIEWS = ['view-home', 'view-login', 'view-register', 'view-service', 'view-order', 'view-track'];
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
  el('h-signin').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-create').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-book').insertAdjacentHTML('afterbegin', icon('droplet'));
  el('h-orders').insertAdjacentHTML('afterbegin', icon('clock'));
  el('btn-geolocate').insertAdjacentHTML('afterbegin', icon('navigate'));
  el('btn-saved-address').insertAdjacentHTML('afterbegin', icon('home'));
  el('h-orders-2').insertAdjacentHTML('afterbegin', icon('clock'));
  el('btn-change-service').insertAdjacentHTML('afterbegin', icon('back'));
  el('seg-card').insertAdjacentHTML('afterbegin', icon('card'));
  el('seg-cash').insertAdjacentHTML('afterbegin', icon('cash'));
  el('btn-back-orders').insertAdjacentHTML('afterbegin', icon('back'));
  el('btn-retry-order').insertAdjacentHTML('afterbegin', icon('refresh'));
  el('rate-stars').innerHTML = [1, 2, 3, 4, 5].map((v) =>
    `<button data-v="${v}" aria-label="${v} star"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></button>`).join('');
  initScrollChrome();
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
  if (me) el('btn-account').innerHTML = `${icon('user')}<span class="acct-name">${me.name.split(' ')[0]}</span>`;
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

/* ---------- home ----------
   The logged-out home is deliberately just the two service blocks. Nothing below them. */
function renderHomeServices() {
  if (!pricing) return;
  renderCategoryCards();
}

/* ---------- auth navigation ---------- */
el('btn-go-login').onclick = () => show('view-login');

// The wordmark is always the way back to the main page. Route in-app rather than
// reloading, so a signed-in customer lands on the service chooser, not the marketing home.
el('brand-home').onclick = (e) => {
  e.preventDefault();
  if (!me) { show('view-home'); return; }
  currentOrder = null;
  renderCategoryCards();
  show('view-service');
  refreshOrders();
};
el('link-to-register').onclick = (e) => { e.preventDefault(); show('view-register'); };
el('link-to-login').onclick = (e) => { e.preventDefault(); show('view-login'); };
el('link-back-home').onclick = (e) => { e.preventDefault(); show('view-home'); };

async function enterApp() {
  if (!pricing) pricing = await api('/api/pricing');
  // A service picked before signing up only preselects the booking form. Signing in or
  // registering always lands on the main chooser — being dropped straight into a wash
  // booking is disorienting when you have just typed in your details.
  const wanted = pendingService();
  setService(wanted || 'carwash');
  refreshPointsRow();
  refreshSavedAddress();
  el('use-points').onchange = updateTotal;
  await refreshOrders();
  renderCategoryCards();
  if (wanted) { try { localStorage.removeItem(SVC_KEY); } catch {} }
  show('view-service');
  initMap();
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    quotes_update: (data) => {
      if (data.request_id !== quoteRequestId) return;
      quotesList = data.quotes || [];
      el('quote-status').textContent = quotesList.length
        ? `${quotesList.length} price${quotesList.length === 1 ? '' : 's'} in`
        : 'Waiting for pros…';
      renderQuotes();
    },
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
  const copy = SVC_COPY[key];
  el('h-book').innerHTML = `${icon(key === 'laundry' ? 'shirt' : 'droplet')} ${copy.book}`;
  el('unit-heading').textContent = pricing.services[key].unitLabel;
  el('where-heading').textContent = copy.where;
  el('order-notes').placeholder = copy.notesPh;
  renderPickers();
  if (sel.lat != null) refreshCallout();
  updateTotal();
}
// Picking a service is the first thing anyone does. Logged out it sends them to sign up,
// and the choice is remembered only to preselect the booking form afterwards.
const SVC_KEY = 'freshaf_pending_svc';
function pendingService() {
  try { const v = localStorage.getItem(SVC_KEY); return v === 'laundry' || v === 'carwash' ? v : null; } catch { return null; }
}
function chooseService(key) {
  if (key !== 'carwash' && key !== 'laundry') return;
  if (!me) {
    try { localStorage.setItem(SVC_KEY, key); } catch {}
    show('view-register');
    return;
  }
  setService(key);
  show('view-order');
  // Leaflet mis-sizes itself when it was laid out inside a hidden view.
  if (map) setTimeout(() => map.invalidateSize(), 60);
}
document.querySelectorAll('.cat-card').forEach((c) => c.onclick = () => chooseService(c.dataset.svc));
el('btn-change-service').onclick = () => { renderCategoryCards(); show('view-service'); refreshOrders(); };

// The two categories, each with its own look and copy.
function renderCategoryCards() {
  if (!pricing) return;
  const bullets = {
    carwash: ['Washed where it stands', 'Vetted, rated washers', 'Card or cash'],
    laundry: ['Collected and delivered back', 'Wash, iron, duvets & bedding', 'Card or cash'],
  };
  // The same two cards appear on the logged-out home and on the in-app chooser.
  const fill = (icoId, listId, key, ico) => {
    if (el(icoId)) el(icoId).innerHTML = icon(ico, 'lg');
    if (el(listId)) el(listId).innerHTML = bullets[key].map((b) => `<li>${icon('check')}${b}</li>`).join('');
  };
  fill('cat-ico-wash', 'cat-list-wash', 'carwash', 'car');
  fill('cat-ico-laundry', 'cat-list-laundry', 'laundry', 'shirt');
  fill('home-ico-wash', 'home-list-wash', 'carwash', 'car');
  fill('home-ico-laundry', 'home-list-laundry', 'laundry', 'shirt');
}

function renderPickers() {
  const cat = pricing.services[svc];
  const pg = el('pkg-grid');
  pg.innerHTML = cat.packages.map((p) => `
    <div class="pkg" data-pkg="${p.key}">
      <span class="tick">${icon('check')}</span>
      <div class="pkg-icon">${icon(PKG_ICONS[p.key] || 'droplet', 'lg')}</div>
      <div class="name">${p.name}</div>
      <div class="price"><small>from</small> ${rand(p.base)}</div>
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
  invalidateQuotes();
  updateTotal();
}

/* ---------- choose your pro (each sets their own price) ---------- */
/* ---------- quotes ----------
   The customer logs one request; pros answer with their own price and availability.
   Published prices answer automatically, so there is usually something bookable at once. */
let quoteRequestId = null;
let quotesList = [];
let chosenQuote = null;

function quotesReady() {
  return !!(sel.package && sel.unit && sel.lat != null && el('order-address').value.trim());
}

function resetQuotes(message) {
  quoteRequestId = null; quotesList = []; chosenQuote = null;
  el('quote-list').innerHTML = `<p class="empty">${message}</p>`;
  el('quote-status').textContent = '';
  updateTotal();
}

function renderQuotes() {
  const box = el('quote-list');
  if (!quotesList.length) {
    box.innerHTML = '<p class="empty">Waiting for pros to send their prices…</p>';
    chosenQuote = null;
    updateTotal();
    return;
  }
  if (!quotesList.some((q) => q.id === chosenQuote)) chosenQuote = quotesList[0].id;
  box.innerHTML = quotesList.map((q) => `
    <div class="pro-opt ${q.id === chosenQuote ? 'selected' : ''}" data-id="${q.id}">
      <div>
        <div class="who">${escapeHtml(q.business_name)}</div>
        <div class="meta">${q.distance_km} km away${q.rating ? ` · ★ ${q.rating} (${q.rating_count})` : ' · New pro'}</div>
        ${q.availability ? `<div class="meta">${escapeHtml(q.availability)}</div>` : ''}
        ${q.note ? `<div class="meta">${escapeHtml(q.note)}</div>` : ''}
      </div>
      <div class="amt">
        <strong>${rand(q.total_cents)}</strong>
        <span class="brk">${rand(q.supplier_price_cents)} pro${q.callout_fee_cents ? ' + ' + rand(q.callout_fee_cents) + ' callout' : ''} + ${rand(q.platform_fee_cents)} fee</span>
      </div>
    </div>`).join('');
  box.querySelectorAll('.pro-opt').forEach((n) => n.onclick = () => {
    chosenQuote = Number(n.dataset.id);
    box.querySelectorAll('.pro-opt').forEach((x) => x.classList.toggle('selected', x === n));
    updateTotal();
  });
  updateTotal();
}

/* ---------- when: now or scheduled ---------- */
// "2026-08-22 09:00" -> "Sat 22 Aug, 09:00"
function whenLabel(scheduledFor) {
  if (!scheduledFor) return 'As soon as possible';
  const d = new Date(String(scheduledFor).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(scheduledFor);
  return d.toLocaleString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function scheduledValue() {
  const mode = document.querySelector('input[name=when]:checked')?.value;
  return mode === 'scheduled' ? (el('scheduled-for').value || null) : null;
}

// datetime-local wants local wall time, so build the min/max from the local clock
// rather than toISOString(), which would shift them by the UTC offset.
function localStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function refreshWhenBounds() {
  const input = el('scheduled-for');
  const soonest = new Date(Date.now() + 30 * 60 * 1000);
  soonest.setMinutes(Math.ceil(soonest.getMinutes() / 15) * 15, 0, 0);
  input.min = localStamp(soonest);
  input.max = localStamp(new Date(Date.now() + 30 * 24 * 3600 * 1000));
  if (!input.value) input.value = input.min;
}
document.querySelectorAll('input[name=when]').forEach((r) => r.onchange = () => {
  const scheduled = r.value === 'scheduled' && r.checked;
  el('when-picker').classList.toggle('hidden', !scheduled);
  if (scheduled) refreshWhenBounds();
  invalidateQuotes(); // a different time is a different job — old prices no longer apply
});
el('scheduled-for').addEventListener('change', invalidateQuotes);

el('btn-get-quotes').onclick = () => withBusy(el('btn-get-quotes'), 'Asking pros…', async () => {
  if (!quotesReady()) {
    showError('order-error', 'Pick a package, a size, your location and an address first.');
    return;
  }
  try {
    const r = await api('/api/quote-requests', {
      method: 'POST',
      body: {
        service: svc, package: sel.package, vehicle: sel.unit,
        address: el('order-address').value, lat: sel.lat, lng: sel.lng,
        notes: el('order-notes').value,
        scheduled_for: scheduledValue(),
      },
    });
    quoteRequestId = r.request_id;
    quotesList = r.quotes || [];
    el('quote-status').textContent = r.asked
      ? `${r.asked} pro${r.asked === 1 ? '' : 's'} asked · ${r.auto_quoted} answered instantly`
      : 'No pros are online near you right now.';
    renderQuotes();
  } catch (e) { showError('order-error', e.message); }
});

// Anything that changes the job invalidates the prices pros gave for it.
function invalidateQuotes() {
  if (!quoteRequestId) return;
  api(`/api/quote-requests/${quoteRequestId}/cancel`, { method: 'POST' }).catch(() => {});
  resetQuotes('The job changed — ask for prices again.');
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
  const q = quotesList.find((x) => x.id === chosenQuote);
  if (!q) {
    el('order-total').textContent = '—';
    el('price-note').textContent = quotesReady()
      ? 'Ask for prices above, then pick a pro.' : '';
    return;
  }
  const usePoints = el('use-points').checked;
  const discount = usePoints ? Math.min(me?.points_cents || 0, q.total_cents) : 0;
  animateRand(el('order-total'), q.total_cents - discount);
  const notes = [`${q.business_name}: ${rand(q.supplier_price_cents)}`];
  if (q.callout_fee_cents) notes.push(`callout ${rand(q.callout_fee_cents)}`);
  notes.push(`service fee ${rand(q.platform_fee_cents)}`);
  if (discount > 0) notes.push(`rewards −${rand(discount)}`);
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
  invalidateQuotes();
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

// Real form submits: browsers only offer to save a password when a form is actually
// submitted, so these are submit handlers rather than button clicks.
el('login-form').onsubmit = (e) => { e.preventDefault(); return withBusy(el('btn-login'), 'Signing in…', async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value, password: el('login-password').value } });
    if (user.role !== 'customer') { window.location.href = user.role === 'supplier' ? '/supplier' : '/admin'; return; }
    me = user; setTopbar(); await enterApp();
    toast(`Welcome back, ${user.name.split(' ')[0]}`, 'ok');
  } catch (e) { showError('login-error', e.message); }
}); };

el('register-form').onsubmit = (e) => { e.preventDefault(); return withBusy(el('btn-register'), 'Creating your account…', async () => {
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
}); };

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
    if (!chosenQuote) throw new Error('Ask for prices, then pick a pro before booking');
    const payment_method = document.querySelector('input[name=pay]:checked').value;
    // The quote IS the pro's commitment, so accepting it books the job outright.
    const data = await api(`/api/quotes/${chosenQuote}/accept`, {
      method: 'POST',
      body: { payment_method, use_points: el('use-points').checked },
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
  if (!orders.length) {
    el('orders-list').innerHTML = '<p class="empty">No orders yet.</p>';
    if (el('orders-list-2')) el('orders-list-2').innerHTML = '<p class="empty">No orders yet.</p>';
    return;
  }
  const render = (o) => {
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
  };
  const html = orders.map(render).join('');
  el('orders-list').innerHTML = html;
  if (el('orders-list-2')) el('orders-list-2').innerHTML = html;
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
  if (order.scheduled_for) {
    body += `<p class="mt" style="color:var(--accent-dim);font-weight:700">${icon('clock')} Booked for ${whenLabel(order.scheduled_for)}</p>`;
  }
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

el('btn-back-orders').onclick = () => { currentOrder = null; renderCategoryCards(); show('view-service'); refreshOrders(); };

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
