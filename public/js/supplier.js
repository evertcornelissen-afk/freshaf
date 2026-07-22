// FreshAF supplier portal.
let me = null;
let map, pin;
let loc = { lat: null, lng: null };
let online = false;
let disconnectSse = null;

const VIEWS = ['view-auth', 'view-status', 'view-dash'];
const show = (view) => switchView(VIEWS, view);

/* ---------- structured boarding inputs: vehicles + equipment ---------- */
const VEHICLE_TYPES = ['Car', 'Bakkie', 'Van / Kombi', 'Trailer rig', 'Motorbike'];
const EQUIPMENT = {
  carwash: [
    { key: 'pressure_washer', label: 'Pressure washer' },
    { key: 'water_tank', label: 'Water tank', qty: 'Litres' },
    { key: 'generator', label: 'Generator' },
    { key: 'vacuum', label: 'Vacuum cleaner' },
    { key: 'gazebo', label: 'Gazebo / shade cover' },
    { key: 'products', label: 'Own cleaning products' },
  ],
  laundry: [
    { key: 'washing_machines', label: 'Washing machines', qty: 'How many' },
    { key: 'tumble_dryers', label: 'Tumble dryers', qty: 'How many' },
    { key: 'industrial', label: 'Industrial machines', qty: 'How many' },
    { key: 'iron_station', label: 'Ironing station' },
    { key: 'packaging', label: 'Packaging / garment bags' },
  ],
};

function addVehicleRow(prefill = {}) {
  const row = document.createElement('div');
  row.className = 'row vehicle-row';
  row.style.cssText = 'gap:8px;margin-bottom:9px;flex-wrap:nowrap;align-items:stretch';
  row.innerHTML = `
    <select class="v-type" style="width:130px;flex:none">${VEHICLE_TYPES.map((t) => `<option${t === prefill.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <input class="v-model" placeholder="Make & model, e.g. Toyota Hilux" value="${prefill.model || ''}" style="flex:1">
    <input class="v-reg" placeholder="Registration" value="${prefill.reg || ''}" style="width:120px;flex:none">
    <button type="button" class="ghost small v-remove" style="flex:none;color:var(--danger)">${icon('x')}</button>`;
  row.querySelector('.v-remove').onclick = () => row.remove();
  el('vehicles-rows').appendChild(row);
}

function collectVehicles() {
  return [...document.querySelectorAll('.vehicle-row')].map((r) => ({
    type: r.querySelector('.v-type').value,
    model: r.querySelector('.v-model').value.trim(),
    reg: r.querySelector('.v-reg').value.trim(),
  })).filter((v) => v.reg || v.model);
}

function renderEquipmentList() {
  // Preserve current state across re-renders when services change.
  const prev = collectEquipmentState();
  const active = [];
  if (el('svc-carwash').checked) active.push(...EQUIPMENT.carwash);
  if (el('svc-laundry').checked) active.push(...EQUIPMENT.laundry);
  el('equipment-list').innerHTML = active.map((item) => {
    const p = prev[item.key] || {};
    return `
    <div class="row" style="padding:7px 0;border-bottom:1px solid var(--border-soft);gap:10px">
      <label style="margin:0;cursor:pointer;flex:1" class="row">
        <input type="checkbox" class="eq-check" data-key="${item.key}" data-label="${item.label}" ${p.checked ? 'checked' : ''} style="width:auto">
        <span style="font-size:.9rem">${item.label}</span>
      </label>
      ${item.qty ? `<input type="number" min="1" class="eq-qty" data-for="${item.key}" placeholder="${item.qty}" value="${p.qty || ''}" style="width:110px;flex:none">` : ''}
    </div>`;
  }).join('') || '<p class="empty">Select at least one service above.</p>';
}

function collectEquipmentState() {
  const state = {};
  document.querySelectorAll('.eq-check').forEach((c) => {
    state[c.dataset.key] = {
      checked: c.checked,
      label: c.dataset.label,
      qty: document.querySelector(`.eq-qty[data-for="${c.dataset.key}"]`)?.value || null,
    };
  });
  return state;
}

function collectEquipment() {
  const items = Object.entries(collectEquipmentState())
    .filter(([, v]) => v.checked)
    .map(([key, v]) => ({ key, label: v.label, qty: v.qty ? Number(v.qty) : null }));
  return { items, other: el('reg-equipment-other').value.trim() };
}

function decorate() {
  el('h-signin').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-apply').insertAdjacentHTML('afterbegin', icon('briefcase'));
  addVehicleRow();
  renderEquipmentList();
  el('btn-add-vehicle').onclick = () => addVehicleRow();
  el('svc-carwash').addEventListener('change', renderEquipmentList);
  el('svc-laundry').addEventListener('change', renderEquipmentList);
  el('h-docs').insertAdjacentHTML('afterbegin', icon('shield'));
  el('btn-enable-alerts').insertAdjacentHTML('afterbegin', icon('signal'));
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

/* ---------- onboarding documents ---------- */
const DOC_KINDS = [
  ['id_copy', 'SA ID copy (required)'],
  ['proof_address', 'Proof of address'],
  ['work_photo', 'Photo of your setup / equipment'],
];

async function renderDocs() {
  el('docs-card').classList.remove('hidden');
  const { documents } = await api('/api/supplier/documents');
  el('docs-rows').innerHTML = DOC_KINDS.map(([kind, label]) => {
    const doc = documents.find((d) => d.kind === kind);
    return `
    <div class="row spread" style="padding:11px 0;border-bottom:1px solid var(--border-soft)">
      <div>
        <strong style="font-size:.9rem">${label}</strong>
        <div class="muted small-text">${doc ? `${icon('check')} ${doc.original_name}` : 'Not uploaded yet'}</div>
      </div>
      <div>
        <input type="file" id="file-${kind}" accept=".jpg,.jpeg,.png,.pdf" class="hidden">
        <button class="secondary small" onclick="document.getElementById('file-${kind}').click()">${doc ? 'Replace' : 'Upload'}</button>
      </div>
    </div>`;
  }).join('');
  DOC_KINDS.forEach(([kind]) => {
    el(`file-${kind}`).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('file', file);
        const res = await fetch('/api/supplier/documents', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast('Document uploaded', 'ok');
        renderDocs();
      } catch (err) { showError('docs-error', err.message); }
    };
  });
}

/* ---------- push job alerts ---------- */
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function refreshAlertsButton() {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  el('btn-enable-alerts').classList.toggle('hidden', !supported || Notification.permission === 'granted');
  el('alerts-hint').classList.toggle('hidden', !supported || Notification.permission === 'granted');
  if (supported && Notification.permission === 'granted') {
    subscribePush().catch(() => {}); // keep the subscription fresh
  }
}

el('btn-enable-alerts').onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed — enable them in your browser settings');
    await subscribePush();
    toast('Job alerts enabled — you will be notified even when the app is closed', 'ok');
    refreshAlertsButton();
  } catch (e) { showError('dash-error', e.message); }
};

async function route() {
  const s = me.supplier;
  if (!s || s.status === 'approved') { await enterDash(); return; }
  show('view-status');
  if (s.status === 'pending') renderDocs().catch(() => {});
  else el('docs-card').classList.add('hidden');
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
  refreshAlertsButton();
  await Promise.all([refreshOffers(), refreshJobs(), refreshEarnings()]); // content first, then reveal
  show('view-dash');
  initMap();
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    offer: (data) => {
      ping();
      toast('New job offer nearby', 'info');
      refreshOffers();
      // System notification when the tab is in the background.
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`New job — ${rand(data.order?.price_cents || 0)}`, {
            body: `${data.distance_km} km away · tap to view`,
            icon: '/img/icon-192.png', tag: `offer-${data.offer_id}`,
          });
        } catch {}
      }
    },
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

el('btn-login').onclick = () => withBusy(el('btn-login'), 'Signing in…', async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value, password: el('login-password').value } });
    if (user.role !== 'supplier') { window.location.href = user.role === 'admin' ? '/admin' : '/'; return; }
    me = user; setWho(); route();
  } catch (e) { showError('login-error', e.message); }
});

el('btn-register').onclick = () => withBusy(el('btn-register'), 'Submitting application…', async () => {
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
        service_area: el('reg-area').value,
        vehicles: collectVehicles(), equipment: collectEquipment(),
        services, accept_terms: true,
        bank_name: el('reg-bank').value, bank_account: el('reg-account').value, bank_branch: el('reg-branch').value,
      },
    });
    me = user; setWho(); route();
    toast('Application submitted for review', 'ok');
  } catch (e) { showError('reg-error', e.message); }
});

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

