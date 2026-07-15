// FreshAF supplier portal.
let me = null;
let map, pin;
let loc = { lat: null, lng: null };
let online = false;
let disconnectSse = null;

const VIEWS = ['view-auth', 'view-status', 'view-dash'];
const show = (view) => switchView(VIEWS, view);

function decorate() {
  el('h-signin').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-apply').insertAdjacentHTML('afterbegin', icon('briefcase'));
  el('h-avail').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-offers').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-active').insertAdjacentHTML('afterbegin', icon('droplet'));
  el('h-earnings').insertAdjacentHTML('afterbegin', icon('wallet'));
  el('h-history').insertAdjacentHTML('afterbegin', icon('clock'));
  el('btn-sup-geolocate').insertAdjacentHTML('afterbegin', icon('navigate'));
}

function setWho() {
  el('who').textContent = me ? `${me.name} · ${me.supplier?.business_name || ''}` : '';
  el('btn-logout').classList.toggle('hidden', !me);
}

async function boot() {
  try {
    decorate();
    const { user } = await api('/api/auth/me');
    if (user && user.role !== 'supplier') { window.location.href = user.role === 'admin' ? '/admin' : '/'; return; }
    me = user;
    setWho();
    if (!me) { show('view-auth'); hideSplash(); return; }
    await route();
    hideSplash();
  } catch (e) {
    show('view-auth');
    hideSplash();
  }
}

async function route() {
  const s = me.supplier;
  if (!s || s.status === 'approved') { await enterDash(); return; }
  show('view-status');
  const heading = el('status-heading'); const detail = el('status-detail'); const ic = el('status-icon');
  if (s.status === 'pending') {
    ic.innerHTML = icon('clock', 'xl');
    ic.style.color = 'var(--warn)';
    heading.textContent = 'Application under review';
    detail.textContent = 'The FreshAF team is checking your details. You will be able to accept jobs as soon as you are approved — this page updates automatically.';
  } else if (s.status === 'rejected') {
    ic.innerHTML = icon('x', 'xl');
    ic.style.color = 'var(--danger)';
    heading.textContent = 'Application not approved';
    detail.textContent = s.status_reason ? `Reason: ${s.status_reason}` : 'Contact support@freshaf.co.za for more information.';
  } else {
    ic.innerHTML = icon('alert', 'xl');
    ic.style.color = 'var(--danger)';
    heading.textContent = 'Account suspended';
    detail.textContent = s.status_reason ? `Reason: ${s.status_reason}` : 'Contact support@freshaf.co.za.';
  }
  listenAccountUpdates();
}

function listenAccountUpdates() {
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    account_update: async () => {
      const { user } = await api('/api/auth/me');
      me = user;
      if (me.supplier?.status === 'approved') toast('Your account has been approved — welcome aboard', 'ok');
      route();
    },
  });
}

async function enterDash() {
  online = !!me.supplier?.online;
  if (me.supplier?.lat != null) loc = { lat: me.supplier.lat, lng: me.supplier.lng };
  renderOnline();
  await Promise.all([refreshOffers(), refreshJobs(), refreshEarnings()]); // content first, then reveal
  show('view-dash');
  initMap();
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    offer: () => { ping(); toast('New job offer nearby', 'info'); refreshOffers(); },
    offer_expired: () => refreshOffers(),
    job_cancelled: () => { toast('A job was cancelled by the customer', 'error'); refreshJobs(); refreshOffers(); },
    account_update: async () => { const { user } = await api('/api/auth/me'); me = user; route(); },
    order_update: () => refreshJobs(),
  });
}

function ping() {
  // Soft two-tone chime for a new offer.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.value = 0.06;
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f; o.connect(g);
      o.start(ctx.currentTime + i * 0.14);
      o.stop(ctx.currentTime + i * 0.14 + 0.16);
    });
  } catch { /* no audio available */ }
}

function initMap() {
  if (map) return;
  map = L.map('sup-map').setView([loc.lat ?? -26.1076, loc.lng ?? 28.0567], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
  map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng));
  if (loc.lat != null) setPin(loc.lat, loc.lng);
}

function setPin(lat, lng) {
  loc = { lat, lng };
  if (pin) pin.setLatLng([lat, lng]); else pin = L.marker([lat, lng]).addTo(map);
  el('sup-pin-status').innerHTML = `${icon('pin')} Location — ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

el('btn-sup-geolocate').onclick = () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => { setPin(pos.coords.latitude, pos.coords.longitude); map.setView([pos.coords.latitude, pos.coords.longitude], 14); },
    () => showError('dash-error', 'Could not get your location — tap the map instead.'),
  );
};

function renderOnline() {
  const pill = el('online-pill');
  pill.textContent = online ? 'Online — receiving jobs' : 'Offline';
  pill.className = `pill ${online ? 'ok live' : 'bad'}`;
  el('btn-toggle-online').textContent = online ? 'Go offline' : 'Go online';
}

el('btn-toggle-online').onclick = async () => {
  try {
    if (!online && (loc.lat == null)) throw new Error('Set your location first (tap the map or use your location)');
    await api('/api/supplier/online', { method: 'POST', body: { online: !online, lat: loc.lat, lng: loc.lng } });
    online = !online;
    renderOnline();
    toast(online ? 'You are online — jobs will come to you' : 'You are offline', online ? 'ok' : 'info');
  } catch (e) { showError('dash-error', e.message); }
};

async function refreshOffers() {
  const { offers } = await api('/api/supplier/offers');
  if (!offers.length) {
    el('offers-box').innerHTML = '<p class="empty">No offers right now. Stay online — jobs appear here instantly.</p>';
    return;
  }
  el('offers-box').innerHTML = offers.map((o) => `
    <div class="offer-card">
      <div class="row spread">
        <strong>${svcBadge(o.order.service)} Order #${o.order.id} — ${rand(o.order.price_cents)}</strong>
        <span class="pill warn">${o.distance_km} km away</span>
      </div>
      <p class="muted small-text" style="margin-top:8px">${icon('pin')} ${o.order.address}</p>
      <p class="small-text" style="margin-top:5px">${o.order.package.replace(/_/g, ' ')} · ${o.order.vehicle} · ${o.order.payment_method === 'cash' ? `Collect ${rand(o.order.amount_due_cents)} cash` : 'Paid online'}${o.order.callout_fee_cents > 0 ? ` · incl. ${rand(o.order.callout_fee_cents)} callout` : ''}</p>
      ${o.order.notes ? `<p class="muted small-text">Note: ${o.order.notes}</p>` : ''}
      <div class="row mt">
        <button class="small" onclick="acceptOffer(${o.offer_id})">Accept job</button>
        <button class="ghost small" onclick="declineOffer(${o.offer_id})">Decline</button>
      </div>
    </div>`).join('');
}

window.acceptOffer = async (id) => {
  try {
    await api(`/api/supplier/offers/${id}/accept`, { method: 'POST' });
    toast('Job accepted — head to the customer', 'ok');
    await Promise.all([refreshOffers(), refreshJobs()]);
  } catch (e) { showError('dash-error', e.message); refreshOffers(); }
};
window.declineOffer = async (id) => {
  await api(`/api/supplier/offers/${id}/decline`, { method: 'POST' });
  refreshOffers();
};

const NEXT_LABEL = {
  carwash: { accepted: 'Start driving — en route', en_route: 'Arrived — start wash', in_progress: 'Finish job' },
  laundry: { accepted: 'Start collection run', en_route: 'Collected — start laundering', in_progress: 'Delivered — finish job' },
};
const svcBadge = (s) => `<span class="pill ${s === 'laundry' ? 'ok' : 'warn'}" style="margin-right:6px">${serviceName(s)}</span>`;

async function refreshJobs() {
  const { active, history } = await api('/api/supplier/jobs');
  if (!active.length) {
    el('active-box').innerHTML = '<p class="empty">No active job.</p>';
  } else {
    el('active-box').innerHTML = active.map((o) => `
      <div>
        <div class="row spread">
          <strong>${svcBadge(o.service)} Order #${o.id} — ${rand(o.price_cents)}</strong>
          <span class="pill warn live">${statusLabel(o.status, o.service)}</span>
        </div>
        <p class="muted small-text" style="margin-top:8px">${icon('pin')} ${o.address}</p>
        <p class="small-text" style="margin-top:5px">${o.package.replace(/_/g, ' ')} · ${o.vehicle} · ${o.payment_method === 'cash' ? `Collect ${rand(o.amount_due_cents)} cash on completion` : 'Paid online'}${o.callout_fee_cents > 0 ? ` · incl. ${rand(o.callout_fee_cents)} callout` : ''}</p>
        ${o.notes ? `<p class="muted small-text">Note: ${o.notes}</p>` : ''}
        <div class="mt"><button onclick="advanceJob(${o.id})">${(NEXT_LABEL[o.service] || NEXT_LABEL.carwash)[o.status] || 'Update'}</button></div>
      </div>`).join('<hr class="divider">');
  }
  if (!history.length) {
    el('history-box').innerHTML = '<p class="empty">Nothing yet.</p>';
  } else {
    el('history-box').innerHTML = '<div class="table-scroll"><table><thead><tr><th>Order</th><th>Status</th><th>Total</th></tr></thead><tbody>' +
      history.map((o) => `<tr><td>${serviceName(o.service)} #${o.id}</td><td><span class="pill ${statusPillClass(o.status)}">${statusLabel(o.status, o.service)}</span></td><td>${rand(o.price_cents)}</td></tr>`).join('') +
      '</tbody></table></div>';
  }
}

window.advanceJob = async (orderId) => {
  try {
    const { order } = await api(`/api/supplier/jobs/${orderId}/advance`, { method: 'POST' });
    if (order.status === 'completed') toast('Job complete — earnings updated', 'ok');
    await Promise.all([refreshJobs(), refreshEarnings()]);
  } catch (e) { showError('dash-error', e.message); }
};

async function refreshEarnings() {
  const e = await api('/api/supplier/earnings');
  el('earnings-box').innerHTML = `
    <div class="stat"><div class="v">${e.jobs}</div><div class="l">Jobs done</div></div>
    <div class="stat"><div class="v">${rand(e.gross_cents)}</div><div class="l">Gross</div></div>
    <div class="stat"><div class="v">${rand(e.net_cents)}</div><div class="l">Your earnings (after ${e.commission_pct}% fee)</div></div>`;
}

el('btn-login').onclick = async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value, password: el('login-password').value } });
    if (user.role !== 'supplier') { window.location.href = user.role === 'admin' ? '/admin' : '/'; return; }
    me = user; setWho(); route();
  } catch (e) { showError('login-error', e.message); }
};

el('btn-register').onclick = async () => {
  try {
    if (!el('reg-terms').checked) throw new Error('Please accept the Terms & Conditions to continue');
    const services = [];
    if (el('svc-carwash').checked) services.push('carwash');
    if (el('svc-laundry').checked) services.push('laundry');
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        role: 'supplier', name: el('reg-name').value, email: el('reg-email').value,
        phone: el('reg-phone').value, password: el('reg-password').value,
        business_name: el('reg-business').value, id_number: el('reg-idnum').value,
        vehicle_reg: el('reg-vehreg').value, service_area: el('reg-area').value,
        equipment_notes: el('reg-equipment').value, services, accept_terms: true,
      },
    });
    me = user; setWho(); route();
    toast('Application submitted for review', 'ok');
  } catch (e) { showError('reg-error', e.message); }
};

el('btn-logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.reload(); };

el('btn-delete-account').onclick = async () => {
  const pw = await modal({
    title: 'Delete your account?',
    body: 'Your profile is anonymised permanently and you will stop receiving jobs. Complete or cancel any active job first. Enter your password to confirm.',
    input: 'Password', confirmText: 'Delete my account', danger: true,
  });
  if (pw === null) return;
  try {
    await api('/api/auth/delete-account', { method: 'POST', body: { password: pw } });
    toast('Your account has been deleted', 'info');
    setTimeout(() => window.location.reload(), 1200);
  } catch (e) { toast(e.message, 'error'); }
};

boot();

