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
    { key: 'washing_machines', label: 'Washing machines', qty: 'Qty' },
    { key: 'tumble_dryers', label: 'Tumble dryers', qty: 'Qty' },
    { key: 'industrial', label: 'Industrial machines', qty: 'Qty' },
    { key: 'iron_station', label: 'Ironing station' },
    { key: 'packaging', label: 'Packaging / garment bags' },
  ],
};

/* ---------- service areas: nationwide, grouped by province, tick as many as you cover ---------- */
const SERVICE_AREAS = {
  'Gauteng': ['Johannesburg CBD', 'Sandton', 'Randburg', 'Roodepoort', 'Soweto', 'Midrand', 'Fourways',
    'Pretoria / Tshwane', 'Centurion', 'Ekurhuleni (East Rand)', 'Kempton Park', 'Benoni', 'Boksburg',
    'Germiston', 'Krugersdorp / West Rand', 'Vereeniging / Vaal'],
  'Western Cape': ['Cape Town CBD & Atlantic Seaboard', 'Southern Suburbs', 'Northern Suburbs', 'Cape Flats',
    'Blaauwberg / West Coast', 'Helderberg / Somerset West', 'Stellenbosch', 'Paarl / Wellington',
    'George', 'Mossel Bay', 'Knysna / Plettenberg Bay', 'Hermanus / Overberg', 'Worcester / Breede Valley'],
  'KwaZulu-Natal': ['Durban', 'Umhlanga', 'Ballito / North Coast', 'Pinetown / Westville', 'Amanzimtoti / South Coast',
    'Pietermaritzburg', 'Richards Bay', 'Newcastle', 'Port Shepstone'],
  'Eastern Cape': ['Gqeberha (Port Elizabeth)', 'East London', 'Mthatha', 'Makhanda', 'Jeffreys Bay'],
  'Free State': ['Bloemfontein', 'Welkom', 'Bethlehem', 'Sasolburg'],
  'Limpopo': ['Polokwane', 'Tzaneen', 'Thohoyandou', 'Mokopane', 'Bela-Bela'],
  'Mpumalanga': ['Mbombela (Nelspruit)', 'Emalahleni (Witbank)', 'Middelburg', 'Secunda'],
  'North West': ['Rustenburg', 'Mahikeng', 'Potchefstroom', 'Klerksdorp', 'Brits / Hartbeespoort'],
  'Northern Cape': ['Kimberley', 'Upington', 'Springbok'],
};
const escAttr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderAreaPicker() {
  el('area-list').innerHTML = Object.entries(SERVICE_AREAS).map(([prov, towns]) => `
    <div class="area-group" data-prov="${escAttr(prov)}">
      <label class="area-prov"><input type="checkbox" class="area-all" data-prov="${escAttr(prov)}"> <span>${prov}: all areas</span></label>
      ${towns.map((t) => `<label class="area-opt"><input type="checkbox" class="area-check" data-prov="${escAttr(prov)}" value="${escAttr(t)}"> <span>${t}</span></label>`).join('')}
    </div>`).join('');
  el('area-list').addEventListener('change', (e) => {
    const box = e.target;
    if (box.classList.contains('area-all')) {
      document.querySelectorAll(`.area-check[data-prov="${CSS.escape(box.dataset.prov)}"]`).forEach((c) => { c.checked = box.checked; });
    }
    syncAreas();
  });
  el('area-search').addEventListener('input', () => {
    const q = el('area-search').value.trim().toLowerCase();
    document.querySelectorAll('.area-group').forEach((g) => {
      const provHit = g.dataset.prov.toLowerCase().includes(q);
      let any = false;
      g.querySelectorAll('.area-opt').forEach((o) => {
        const hit = !q || provHit || o.textContent.toLowerCase().includes(q);
        o.classList.toggle('hidden', !hit);
        any = any || hit;
      });
      g.classList.toggle('hidden', !any);
    });
  });
  // A chip's x unticks that area.
  el('area-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.area-chip-x');
    if (!b) return;
    document.querySelectorAll('.area-check').forEach((c) => {
      if (b.dataset.prov ? c.dataset.prov === b.dataset.prov : c.value === b.dataset.area) c.checked = false;
    });
    syncAreas();
  });
  syncAreas();
}

function selectedAreas() {
  return [...document.querySelectorAll('.area-check:checked')].map((c) => c.value);
}

function syncAreas() {
  // A province box shows ticked only when every area in it is.
  document.querySelectorAll('.area-all').forEach((all) => {
    const boxes = [...document.querySelectorAll(`.area-check[data-prov="${CSS.escape(all.dataset.prov)}"]`)];
    const n = boxes.filter((c) => c.checked).length;
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  });
  const picked = selectedAreas();
  el('area-summary').textContent = picked.length
    ? `${picked.length} area${picked.length === 1 ? '' : 's'} selected`
    : 'Choose your service areas';
  // A whole province is one chip, not a dozen.
  const chip = (text, attr, val) => `<span class="area-chip">${text}<button type="button" class="area-chip-x" ${attr}="${escAttr(val)}" aria-label="Remove ${escAttr(text)}">${icon('x')}</button></span>`;
  const fullProv = new Set([...document.querySelectorAll('.area-all')].filter((a) => a.checked).map((a) => a.dataset.prov));
  el('area-chips').innerHTML = [
    ...[...fullProv].map((p) => chip(`${p} (all areas)`, 'data-prov', p)),
    ...[...document.querySelectorAll('.area-check:checked')].filter((c) => !fullProv.has(c.dataset.prov)).map((c) => chip(c.value, 'data-area', c.value)),
  ].join('');
}

// One line for the record: grouped by province, plus anything typed under "Other".
function serviceAreaText() {
  const byProv = {};
  document.querySelectorAll('.area-check:checked').forEach((c) => { (byProv[c.dataset.prov] ||= []).push(c.value); });
  const parts = Object.entries(byProv).map(([prov, towns]) =>
    towns.length === SERVICE_AREAS[prov].length ? `${prov} (all)` : `${prov}: ${towns.join(', ')}`);
  const other = el('reg-area-other').value.trim();
  if (other) parts.push(`Other: ${other}`);
  return parts.join('; ');
}

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
  renderAreaPicker();
  el('btn-add-vehicle').onclick = () => addVehicleRow();
  el('svc-carwash').addEventListener('change', renderEquipmentList);
  el('svc-laundry').addEventListener('change', renderEquipmentList);
  el('h-docs').insertAdjacentHTML('afterbegin', icon('shield'));
  el('btn-enable-alerts').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-avail').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-offers').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-requests').insertAdjacentHTML('afterbegin', icon('wallet'));
  el('h-active').insertAdjacentHTML('afterbegin', icon('droplet'));
  el('h-earnings').insertAdjacentHTML('afterbegin', icon('wallet'));
  el('h-wa').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-history').insertAdjacentHTML('afterbegin', icon('clock'));
  el('btn-sup-geolocate').insertAdjacentHTML('afterbegin', icon('navigate'));
  initScrollChrome();
  addIphoneGuide();
}

// iPhone pros (9 Nov 2026): the App Store app waits on the D-U-N-S number, so on an iPhone the
// pro portal runs from Safari. Added to the Home Screen it opens full screen like an app, and
// (iOS 16.4+) can show job alerts, which a plain Safari tab never can. Shown only on an
// iPhone/iPad that is not already running it from the Home Screen, and not inside our app.
function addIphoneGuide() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.navigator.standalone === true
    || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!ios || installed || window.FRESHAF_NATIVE) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('freshaf_ios_guide_done') === '1'; } catch (e) {}
  if (dismissed) return;
  const shareIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-label="Share" style="vertical-align:-3px">'
    + '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  const html = `
    <div class="card ios-guide" role="region" aria-label="Add FreshAF Pro to your Home Screen">
      <h2 style="margin-top:0">Using an iPhone? Put FreshAF Pro on your Home Screen</h2>
      <p class="muted small-text" style="margin-top:-4px">The App Store app is coming soon. Until then this works like an app, and it is how job alerts reach your iPhone.</p>
      <ol class="ios-steps">
        <li>Open <strong>freshaf.io/supplier</strong> in <strong>Safari</strong>.</li>
        <li>Tap the Share button ${shareIcon} at the bottom of the screen.</li>
        <li>Scroll down, tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open <strong>FreshAF Pro</strong> from your Home Screen, sign in, and tap <strong>Enable job alerts</strong>.</li>
      </ol>
      <p class="muted small-text">Job alerts need iOS 16.4 or newer (Settings &gt; General &gt; About &gt; iOS Version).</p>
      <div class="mt"><button type="button" class="secondary small" data-ios-guide-done>Got it</button></div>
    </div>`;
  const spots = [
    [el('view-auth').querySelector('.hero'), 'afterend'],
    [el('view-status'), 'afterbegin'],
    [el('view-dash'), 'afterbegin'],
  ];
  spots.forEach(([node, where]) => { if (node) node.insertAdjacentHTML(where, html); });
  document.querySelectorAll('[data-ios-guide-done]').forEach((b) => {
    b.onclick = () => {
      try { localStorage.setItem('freshaf_ios_guide_done', '1'); } catch (e) {}
      document.querySelectorAll('.ios-guide').forEach((n) => n.remove());
    };
  });
}

function showCustomerNote(u) {
  const h = el('h-apply');
  if (!h || el('customer-note')) return;
  h.insertAdjacentHTML('afterend', `<div class="msg ok" id="customer-note" style="display:block">
    You are signed in to the customer app as <strong>${escapeHtml(u.email || u.name || '')}</strong>.
    A pro account is separate: apply below with a different email address.
    <a href="#" id="customer-note-back">Back to the customer app</a></div>`);
  el('customer-note-back').onclick = (e) => { e.preventDefault(); goPage('/'); };
}

function setWho() {
  el('who').textContent = me ? `${me.name} · ${me.supplier?.business_name || ''}` : '';
  el('btn-logout').classList.toggle('hidden', !me);
  // Signed out: always a clear Sign in in the header, never only the form further down.
  el('btn-go-login').classList.toggle('hidden', !!me);
  el('btn-go-login').onclick = () => {
    show('view-auth');
    const f = el('login-email');
    if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.focus(), 350); }
  };
}

async function boot() {
  try {
    decorate();
    const { user } = await api('/api/auth/me');
    if (user && user.role === 'admin') { goPage('/'); return; }
    // A signed-in CUSTOMER who taps "Become a pro" used to be sent straight back to the
    // customer app, so the menu seemed to do nothing (found 9 Nov 2026). Show the pro page
    // instead, with a note: a pro account is separate and needs its own email address.
    const customer = user && user.role !== 'supplier' ? user : null;
    me = customer ? null : user;
    setWho();
    if (!me) {
      show('view-auth');
      hideSplash();
      if (customer) showCustomerNote(customer);
      // Arriving from "Pro sign in" (menu or the Customer | Pro switch): straight to the form.
      if (/signin/.test(location.hash)) setTimeout(() => el('btn-go-login').click(), 150);
      // Arriving from "Become a pro": straight to the application form.
      // A jump, not an animation: on arrival nothing needs to glide, and a jump cannot be
      // interrupted by the page still settling.
      else if (/apply/.test(location.hash)) setTimeout(() => scrollToApply(false), 250);
      return;
    }
    await route();
    hideSplash();
  } catch (e) {
    me = null;
    setWho();
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
        <button class="secondary small" data-action="openFilePicker" data-arg="file-${kind}">${doc ? 'Replace' : 'Upload'}</button>
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
        // Through apiUrl/authHeaders like every other call, so it also works inside the app.
        const res = await fetch(apiUrl('/api/supplier/documents'), {
          method: 'POST', body: fd, headers: authHeaders(), credentials: API_CREDENTIALS,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast('Document uploaded', 'ok');
        renderDocs();
      } catch (err) { showError('docs-error', err.message); }
    };
  });
}

/* ---------- your prices (the pro sets what FreshAF pays them per job) ---------- */
let priceCat = null;

async function renderPrices() {
  const data = await api('/api/supplier/prices');
  priceCat = data.services;
  const svcKeys = Object.keys(priceCat);
  if (!svcKeys.length) { el('prices-box').innerHTML = '<p class="empty">No services on your account.</p>'; return; }
  el('prices-box').innerHTML = svcKeys.map((k) => {
    const s = priceCat[k];
    return `
    <h3 style="margin-top:14px">${s.name}</h3>
    ${s.packages.map((p) => `
      <div class="row spread" style="padding:10px 0;border-bottom:1px solid var(--border-soft);gap:14px">
        <div style="flex:1;min-width:150px">
          <strong style="font-size:.92rem">${p.name}</strong>
          <div class="muted small-text">${p.desc}</div>
        </div>
        <div class="row" style="flex-wrap:nowrap;gap:8px;align-items:center">
          <span class="muted small-text">R</span>
          <input type="number" min="20" max="20000" step="10" style="width:110px"
                 data-svc="${k}" data-pkg="${p.key}"
                 value="${p.price_cents != null ? Math.round(p.price_cents / 100) : ''}"
                 placeholder="${Math.round(p.suggested_cents / 100)}">
        </div>
      </div>`).join('')}
    <p class="muted small-text mt">${s.unitLabel} adjusts this automatically:
      ${s.units.map((u) => `${u.name} ×${u.mult}`).join(' · ')}</p>`;
  }).join('');
}

el('btn-save-prices').onclick = () => withBusy(el('btn-save-prices'), 'Saving…', async () => {
  try {
    const prices = [...document.querySelectorAll('#prices-box input[data-pkg]')]
      .filter((i) => i.value !== '')
      .map((i) => ({ service: i.dataset.svc, package: i.dataset.pkg, price_cents: Math.round(Number(i.value) * 100) }));
    if (!prices.length) throw new Error('Enter at least one price so customers can book you');
    await api('/api/supplier/prices', { method: 'POST', body: { prices } });
    const okBox = el('prices-ok');
    okBox.textContent = 'Prices saved — this is exactly what you get paid.';
    okBox.style.display = 'block';
    setTimeout(() => { okBox.style.display = 'none'; }, 4000);
    toast('Your prices are saved', 'ok');
    renderPrices();
  } catch (e) { showError('prices-error', e.message); }
});

el('radius-km').oninput = () => { el('radius-label').textContent = el('radius-km').value + ' km'; };

/* ---------- push job alerts ---------- */
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function refreshAlertsButton() {
  // Inside the iOS / Android app: native push, not web push.
  const np = window.FreshAFNative && window.FreshAFNative.push;
  if (np && np.available) {
    const st = await np.enable(false); // refreshes the token if already allowed
    const show = st === 'prompt' || st === 'denied' || st === 'off';
    el('btn-enable-alerts').classList.toggle('hidden', !show);
    el('alerts-hint').classList.toggle('hidden', !show);
    return;
  }
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  el('btn-enable-alerts').classList.toggle('hidden', !supported || Notification.permission === 'granted');
  el('alerts-hint').classList.toggle('hidden', !supported || Notification.permission === 'granted');
  if (supported && Notification.permission === 'granted') {
    subscribePush().catch(() => {}); // keep the subscription fresh
  }
}

el('btn-enable-alerts').onclick = async () => {
  try {
    const np = window.FreshAFNative && window.FreshAFNative.push;
    if (np && np.available) {
      const st = await np.enable(true);
      if (st === 'denied') throw new Error('Notifications are switched off for FreshAF. Turn them on in your phone Settings > FreshAF > Notifications.');
      if (st !== 'granted') throw new Error('Job alerts are not available in the app yet. You will still get them on WhatsApp.');
      toast('Job alerts enabled. You will be notified even when the app is closed.', 'ok');
      refreshAlertsButton();
      return;
    }
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
    detail.textContent = s.status_reason ? `Reason: ${s.status_reason}` : 'Contact admin@freshaf.io for more information.';
  } else {
    ic.innerHTML = icon('alert', 'xl');
    ic.style.color = 'var(--danger)';
    heading.textContent = 'Account suspended';
    detail.textContent = s.status_reason ? `Reason: ${s.status_reason}` : 'Contact admin@freshaf.io.';
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
  if (me.supplier?.radius_km) {
    el('radius-km').value = me.supplier.radius_km;
    el('radius-label').textContent = me.supplier.radius_km + ' km';
  }
  await Promise.all([refreshOffers(), refreshJobs(), refreshEarnings(), renderPrices(), refreshAlerts(), refreshRequests()]); // content first, then reveal
  show('view-dash');
  initMap();
  openDeepLink();
  maybeFirstRunSetup(); // app only: alerts + location, asked once with the reason
  if (disconnectSse) disconnectSse();
  disconnectSse = connectEvents({
    quote_request: (data) => {
      ping();
      toast(data.auto_quoted
        ? 'New request nearby — your published price was sent automatically'
        : 'New request nearby — send your price', 'info');
      refreshRequests();
    },
    job_booked: (data) => {
      ping();
      toast(`New booking #${data.order_id} — you earn ${rand(data.earns_cents || 0)}. It is in your active jobs.`, 'ok');
      refreshJobs();
      refreshRequests();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`New booking #${data.order_id} — you earn ${rand(data.earns_cents || 0)}`, {
            body: 'Tap to open FreshAF Pro', icon: '/img/icon-192.png', tag: `job-${data.order_id}`,
          });
        } catch {}
      }
    },
    job_reminder: (data) => {
      ping();
      toast(`Order #${data.order_id} is waiting for you. Tap “On my way” when you set off.`, 'error');
      refreshJobs();
    },
    quote_result: (data) => {
      // A win is announced by job_booked (with sound and a notification); this only refreshes.
      if (data.won) { refreshRequests(); refreshJobs(); return; }
      else if (data.pending_payment) toast('Customer chose you — waiting on their payment', 'info');
      refreshRequests();
      refreshJobs();
    },
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
  map = FreshMap.create('sup-map', [loc.lat ?? -29.0, loc.lng ?? 24.5], loc.lat != null ? 15 : 5, setPin); // SA until set
  if (loc.lat != null) setPin(loc.lat, loc.lng);
}

function setPin(lat, lng) {
  loc = { lat, lng };
  map.pin(lat, lng);
  el('sup-pin-status').innerHTML = `${icon('pin')} Location — ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

el('btn-sup-geolocate').onclick = () => {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      map.showMe(lat, lng, accuracy);
      setPin(lat, lng);
      map.flyTo(lat, lng, 16);
    },
    () => showError('dash-error', 'Could not get your location — tap the map instead.'),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
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
    await api('/api/supplier/online', { method: 'POST', body: {
      online: !online, lat: loc.lat, lng: loc.lng, radius_km: Number(el('radius-km').value) } });
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
        <button class="small" data-action="acceptOffer" data-arg="${o.offer_id}">Accept job</button>
        <button class="ghost small" data-action="declineOffer" data-arg="${o.offer_id}">Decline</button>
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
  laundry: { accepted: 'Start collection run', en_route: 'Collected — start laundering', in_progress: 'Laundered — out for delivery' },
};
// Turn-by-turn in the phone's own maps app.
const navLink = (lat, lng, label) => (lat == null ? '' : `<a class="btn secondary small" target="_blank" rel="noopener"
  href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving">${icon('pin')} ${label}</a>`);

// Where this job goes next: the collection until it is collected, then the drop-off.
function jobAddresses(o) {
  const dropOff = o.return_to || { address: o.address, lat: o.lat, lng: o.lng };
  const collecting = ['accepted', 'en_route'].includes(o.status);
  let html = `<p class="muted small-text" style="margin-top:8px">${icon('pin')} ${o.service === 'laundry' ? '<strong>Collect:</strong> ' : ''}${escapeHtml(o.address)}</p>`;
  if (o.return_to) {
    const r = o.return_to;
    html += `<p class="muted small-text">${icon('pin')} <strong>Return to:</strong> ${escapeHtml(r.address)}</p>
      <p class="muted small-text">Receiver: ${escapeHtml(r.receiver || '')}${r.window_start ? ` · from ${escapeHtml(r.window_start)}` : ''}${r.notes ? ` · ${escapeHtml(r.notes)}` : ''}</p>`;
  }
  html += `<div class="row mt">${collecting
    ? navLink(o.lat, o.lng, o.service === 'laundry' ? 'Navigate to collection' : 'Navigate')
    : o.service === 'laundry' ? navLink(dropOff.lat, dropOff.lng, 'Navigate to drop-off') : ''}</div>`;
  return html;
}

// The laundry drop-off: a photo and who took it. Closes the job.
function handoverForm(o) {
  return `<div class="mt" data-handover="${o.id}">
    <label>Photo of the handover</label>
    <input type="file" accept="image/*" capture="environment" class="ho-photo">
    <label>Who received it?</label>
    <input class="ho-receiver" maxlength="80" value="${escapeHtml(o.return_to?.receiver || '')}" placeholder="Name of the person who took it">
    <div class="mt"><button data-action="submitHandover" data-arg="${o.id}">Handed over — finish job</button></div>
  </div>`;
}
window.submitHandover = async (orderId) => {
  const box = document.querySelector(`[data-handover="${orderId}"]`);
  const photo = box.querySelector('.ho-photo').files[0];
  const receiver = box.querySelector('.ho-receiver').value.trim();
  if (!photo) { showError('dash-error', 'Take a photo of the laundry being handed over'); return; }
  if (!receiver) { showError('dash-error', 'Enter the name of the person who received it'); return; }
  const fd = new FormData();
  fd.append('receiver', receiver);
  fd.append('photo', photo);
  try {
    const res = await fetch(apiUrl(`/api/supplier/jobs/${orderId}/handover`), {
      method: 'POST', body: fd, headers: authHeaders(), credentials: API_CREDENTIALS,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the handover');
    toast('Handed over — job complete, the customer has been told', 'ok');
    await Promise.all([refreshJobs(), refreshEarnings()]);
  } catch (e) { showError('dash-error', e.message); }
};
const svcBadge = (s) => `<span class="pill ${s === 'laundry' ? 'ok' : 'warn'}" style="margin-right:6px">${serviceName(s)}</span>`;

async function refreshJobs() {
  const { active, history } = await api('/api/supplier/jobs');
  if (!active.length) {
    el('active-box').innerHTML = '<p class="empty">No active job.</p>';
  } else {
    el('active-box').innerHTML = active.map((o) => `
      <div data-job="${o.id}">
        <div class="row spread">
          <strong>${svcBadge(o.service)} Order #${o.id} — ${rand(o.price_cents)}</strong>
          <span class="pill warn live">${statusLabel(o.status, o.service)}</span>
        </div>
        ${jobAddresses(o)}
        <p class="small-text" style="margin-top:5px">${o.package.replace(/_/g, ' ')} · ${o.vehicle} · ${o.payment_method === 'cash' ? `Collect ${rand(o.amount_due_cents)} cash on completion` : 'Paid online'}${o.callout_fee_cents > 0 ? ` · incl. ${rand(o.callout_fee_cents)} callout` : ''}${o.return_leg_fee_cents > 0 ? ` · incl. ${rand(o.return_leg_fee_cents)} return trip` : ''}</p>
        ${o.notes ? `<p class="muted small-text">Note: ${escapeHtml(o.notes)}</p>` : ''}
        ${o.status === 'out_for_delivery'
          ? handoverForm(o)
          : `<div class="mt"><button data-action="advanceJob" data-arg="${o.id}">${(NEXT_LABEL[o.service] || NEXT_LABEL.carwash)[o.status] || 'Update'}</button></div>`}
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

// Links in WhatsApp, email and phone notifications: /supplier?job=42 opens FreshAF Pro on that
// job with its next step ("Start driving", "Arrived", …) highlighted, one tap from starting.
// ?offer=… (job alerts and price requests) opens on the requests and offers. A pro who is
// signed out signs in first; the link survives that, because sign-in does not reload the page.
function openDeepLink() {
  const params = new URLSearchParams(location.search);
  const job = params.get('job');
  const offer = params.get('offer');
  if (!job && !offer) return;
  history.replaceState(null, '', location.pathname); // a refresh should not jump again
  if (job) {
    const card = document.querySelector(`#active-box [data-job="${CSS.escape(job)}"]`);
    if (!card) {
      toast(`Order #${job} is no longer active — see your job history`, 'info');
      el('history-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    card.classList.add('job-focus');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const btn = card.querySelector('button');
    if (btn) {
      btn.focus({ preventScroll: true });
      toast(`Order #${job}: tap “${btn.textContent.trim()}” when you set off`, 'info');
    }
    setTimeout(() => card.classList.remove('job-focus'), 6000);
    return;
  }
  const target = document.querySelector('#offers-box .offer, #offers-box > div:not(.empty)') ? el('offers-box') : el('requests-box');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window.advanceJob = async (orderId) => {
  try {
    const { order } = await api(`/api/supplier/jobs/${orderId}/advance`, { method: 'POST' });
    if (order.status === 'completed') toast('Job complete — earnings updated', 'ok');
    await Promise.all([refreshJobs(), refreshEarnings()]);
  } catch (e) { showError('dash-error', e.message); }
};

/* ---------- WhatsApp job alerts ---------- */
let waState = null;

async function refreshAlerts() {
  waState = await api('/api/supplier/alerts');
  if (!waState.whatsapp_available) { el('wa-card').classList.add('hidden'); return; }
  el('wa-card').classList.remove('hidden');
  const phone = (waState.phone || '').replace(/"/g, '&quot;');
  if (waState.phone_verified) {
    el('wa-box').innerHTML = `
      <div class="row spread">
        <div>
          <strong>${escapeHtml(waState.phone || '')}</strong>
          <div class="muted small-text">${waState.codes_enabled ? 'Verified: ' : ''}new bookings and job offers arrive on WhatsApp.</div>
        </div>
        <label class="row" style="cursor:pointer;margin:0">
          <input type="checkbox" id="wa-toggle" style="width:auto" ${waState.whatsapp_enabled ? 'checked' : ''}>
          <span class="small-text">WhatsApp alerts on</span>
        </label>
      </div>
      <div class="row mt"><button class="ghost small" id="wa-change">Use a different number</button></div>`;
    el('wa-toggle').onchange = async (e) => {
      try {
        await api('/api/supplier/alerts', { method: 'POST', body: { whatsapp_enabled: e.target.checked } });
        toast(e.target.checked ? 'WhatsApp alerts on' : 'WhatsApp alerts off', 'ok');
      } catch (err) { showError('wa-error', err.message); }
    };
    el('wa-change').onclick = () => renderWaEntry('');
    return;
  }
  renderWaEntry(phone);
}

function renderWaEntry(phone) {
  if (waState && !waState.codes_enabled) {
    el('wa-box').innerHTML = `
      <label>Your WhatsApp number</label>
      <input id="wa-phone" placeholder="e.g. 082 555 1234" value="${phone}" autocomplete="tel">
      <div class="row mt"><button class="small" id="wa-save">Save number</button></div>`;
    el('wa-save').onclick = () => withBusy(el('wa-save'), 'Saving…', async () => {
      try {
        await api('/api/supplier/phone', { method: 'POST', body: { phone: el('wa-phone').value } });
        toast('Saved. New bookings go to this WhatsApp number', 'ok');
        await refreshAlerts();
      } catch (e) { showError('wa-error', e.message); }
    });
    return;
  }
  el('wa-box').innerHTML = `
    <label>Your WhatsApp number</label>
    <input id="wa-phone" placeholder="e.g. 082 555 1234" value="${phone}" autocomplete="tel">
    <div class="row mt"><button class="small" id="wa-send">Send me a code</button></div>`;
  el('wa-send').onclick = () => withBusy(el('wa-send'), 'Sending…', async () => {
    try {
      const r = await api('/api/supplier/phone/verify/send', { method: 'POST', body: { phone: el('wa-phone').value } });
      renderWaConfirm(r.dry_run);
    } catch (e) { showError('wa-error', e.message); }
  });
}

function renderWaConfirm(dryRun) {
  el('wa-box').innerHTML = `
    <p class="muted small-text">We sent a 6-digit code to that number on WhatsApp. Enter it below.
      ${dryRun ? '<br><strong>Test mode:</strong> WhatsApp is not connected yet — the code is in the server log.' : ''}</p>
    <label>Code</label>
    <input id="wa-code" inputmode="numeric" maxlength="6" placeholder="123456">
    <div class="row mt">
      <button class="small" id="wa-confirm">Confirm</button>
      <button class="ghost small" id="wa-back">Change number</button>
    </div>`;
  el('wa-confirm').onclick = () => withBusy(el('wa-confirm'), 'Checking…', async () => {
    try {
      await api('/api/supplier/phone/verify/confirm', { method: 'POST', body: { code: el('wa-code').value } });
      toast('Number verified — WhatsApp job alerts are on', 'ok');
      await refreshAlerts();
    } catch (e) { showError('wa-error', e.message); }
  });
  el('wa-back').onclick = () => renderWaEntry('');
}

/* ---------- job requests (quote them) ---------- */
async function refreshRequests() {
  const data = await api('/api/supplier/quote-requests');
  const box = el('requests-box');
  const list = data.requests || [];
  if (!list.length) {
    box.innerHTML = '<p class="empty">No open requests near you right now. Stay online — they appear here the moment a customer asks.</p>';
    return;
  }
  box.innerHTML = list.map((r) => {
    const quoted = r.my_quote && r.my_quote.status === 'open';
    return `
    <div class="offer-card" data-req="${r.id}">
      <div class="row spread">
        <div>
          <strong>${escapeHtml(r.package_name)}</strong>
          <div class="small-text" style="color:var(--accent-dim);font-weight:700">${icon('clock')} ${escapeHtml(r.when_label)}</div>
          <div class="muted small-text">${escapeHtml(r.unit_name)} · ${r.distance_km} km away</div>
          <div class="muted small-text">${escapeHtml(r.address)}</div>
          ${r.notes ? `<div class="muted small-text">Note: ${escapeHtml(r.notes)}</div>` : ''}
          ${r.return_to ? `<div class="muted small-text"><strong>Return to:</strong> ${escapeHtml(r.return_to.address)} (${r.return_to.distance_km} km from you) · from ${escapeHtml(r.return_to.window_start || '')}</div>` : ''}
        </div>
        <span class="pill ${quoted ? 'ok' : 'warn'}">${quoted ? 'You quoted ' + rand(r.my_quote.price_cents) : 'Awaiting your price'}</span>
      </div>
      <div class="row mt" style="align-items:flex-end;gap:10px">
        <div style="flex:1;min-width:120px">
          <label style="margin-bottom:4px">Your price (R)</label>
          <input type="number" class="q-price" min="20" max="20000" step="10"
                 value="${quoted ? Math.round(r.my_quote.price_cents / 100) : ''}"
                 placeholder="${r.suggested_cents ? Math.round(r.suggested_cents / 100) : '250'}">
        </div>
        <div style="flex:1;min-width:150px">
          <label style="margin-bottom:4px">${r.scheduled_for ? 'Can you make that time?' : 'When can you come?'}</label>
          <input class="q-when" maxlength="80" value="${quoted ? escapeHtml(r.my_quote.availability || '') : ''}"
                 placeholder="${r.scheduled_for ? 'e.g. Yes, that works' : 'e.g. Today within the hour'}">
        </div>
      </div>
      ${r.callout_fee_cents ? `<p class="muted small-text mt">Plus ${rand(r.callout_fee_cents)} callout, also yours.</p>` : ''}
      ${r.return_leg_fee_cents ? `<p class="muted small-text">Plus ${rand(r.return_leg_fee_cents)} for the return trip to the second address, also yours.</p>` : ''}
      <div class="row mt">
        <button class="small q-send">${quoted ? 'Update my price' : 'Send my price'}</button>
        <button class="ghost small q-skip">Not interested</button>
        <span class="muted small-text q-preview"></span>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.offer-card').forEach((card) => {
    const id = card.dataset.req;
    const priceInput = card.querySelector('.q-price');
    const preview = card.querySelector('.q-preview');
    const showPreview = () => {
      const r = Math.round(Number(priceInput.value));
      preview.textContent = Number.isFinite(r) && r > 0
        ? `FreshAF pays you R${r} for this job` : '';
    };
    priceInput.addEventListener('input', showPreview);
    showPreview();
    card.querySelector('.q-send').onclick = (e) => withBusy(e.target, 'Sending…', async () => {
      try {
        const rands = Math.round(Number(priceInput.value));
        if (!Number.isFinite(rands) || rands <= 0) throw new Error('Enter your price first');
        await api(`/api/supplier/quote-requests/${id}/quote`, {
          method: 'POST',
          body: { price_cents: rands * 100, availability: card.querySelector('.q-when').value },
        });
        toast('Price sent — the customer can book you now', 'ok');
        await refreshRequests();
      } catch (err) { showError('req-error', err.message); }
    });
    card.querySelector('.q-skip').onclick = async () => {
      try {
        await api(`/api/supplier/quote-requests/${id}/decline`, { method: 'POST' });
        await refreshRequests();
      } catch (err) { showError('req-error', err.message); }
    };
  });
}

async function refreshEarnings() {
  const e = await api('/api/supplier/earnings');
  // FreshAF buys each job from the pro at the pro's own price plus the callout, so a pro
  // is never paid less than they quoted. The only thing they can owe us is the balance of
  // a cash job they collected on our behalf.
  const owed = e.fee_owed_cents > 0
    ? `<div class="stat"><div class="v" style="color:${e.cash_blocked ? '#c0392b' : '#c2711a'}">${rand(e.fee_owed_cents)}</div><div class="l">Owed to FreshAF from cash jobs${e.cash_cap_cents ? ` · limit ${rand(e.cash_cap_cents)}` : ''}</div></div>`
    : '';
  const blocked = e.cash_blocked
    ? `<div class="msg error" style="display:block;grid-column:1/-1">You are holding ${rand(e.fee_owed_cents)} of FreshAF's money from cash jobs, over the ${rand(e.cash_cap_cents)} limit. <strong>You will not be offered jobs until it is settled.</strong> Pay it in and we will clear it straight away.</div>`
    : '';
  el('earnings-box').innerHTML = `
    <div class="stat"><div class="v">${e.jobs}</div><div class="l">Jobs done</div></div>
    <div class="stat"><div class="v">${rand(e.earned_cents)}</div><div class="l">FreshAF paid you — your price in full</div></div>` + owed + blocked;
}

el('login-form').onsubmit = (e) => { e.preventDefault(); return withBusy(el('btn-login'), 'Signing in…', async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value.trim().toLowerCase(), password: el('login-password').value } });
    if (user.role !== 'supplier') { goPage('/'); return; }
    me = user; setWho(); route();
  } catch (e) { showError('login-error', e.message); }
}); };

// Sign-up: the pro confirms their WhatsApp number with a code, so new bookings reach them
// from the first one. Asked for only while WhatsApp is connected (see /api/auth/phone-code).
const regPhone = { required: false, sentTo: null, canSkip: false };
(async () => {
  try { regPhone.required = !!(await api('/api/auth/phone-code')).required; } catch { regPhone.required = false; }
  el('btn-reg-code').style.display = regPhone.required ? '' : 'none';
})();
const regPhoneHint = (text, isError) => {
  const h = el('reg-phone-hint');
  h.textContent = text;
  h.style.display = text ? '' : 'none';
  h.style.color = isError ? '#c0392b' : '';
};
el('reg-phone').addEventListener('input', () => {
  if (regPhone.sentTo && el('reg-phone').value !== regPhone.sentTo) {
    regPhoneHint('You changed the number. Tap "Send code" again.', false);
  }
});
el('btn-reg-code').onclick = () => withBusy(el('btn-reg-code'), 'Sending…', async () => {
  try {
    const r = await api('/api/auth/phone-code', { method: 'POST', body: { phone: el('reg-phone').value } });
    regPhone.sentTo = el('reg-phone').value;
    regPhone.canSkip = false;
    el('reg-code-row').style.display = '';
    regPhoneHint(r.dry_run
      ? 'Test mode: the code is in the server log, not on WhatsApp.'
      : 'Code sent. Open WhatsApp and look for the message from FreshAF.', false);
    el('reg-code').focus();
  } catch (e) {
    regPhone.canSkip = !!e.data?.can_skip;
    if (regPhone.canSkip) { regPhone.sentTo = el('reg-phone').value; el('reg-code-row').style.display = 'none'; }
    regPhoneHint(e.message, true);
  }
}).then(() => { if (regPhone.sentTo) el('btn-reg-code').textContent = 'Resend'; });

// Sign-up problems are shown NEXT TO the field that needs fixing, and the page scrolls there.
// Found 9 Nov 2026: the only message box sat at the top of this long form, ~1,400px above the
// Submit button on a phone, and hid itself after 6s, so a pro who missed one box saw nothing
// happen and reported that the app "froze" when they submitted.
const regFieldOf = (id) => ({
  services: el('svc-carwash').closest('.row'),
  area: el('area-chips'),
  terms: el('reg-terms').closest('label'),
  phone: el('reg-phone').closest('.row'),
  code: el('reg-code-row').style.display === 'none' ? el('reg-phone').closest('.row') : el('reg-code'),
}[id] || el(id));
function clearRegErrors() {
  document.querySelectorAll('.reg-field-error').forEach((n) => n.remove());
  document.querySelectorAll('.field-invalid').forEach((n) => n.classList.remove('field-invalid'));
  const box = el('reg-error'); box.textContent = ''; box.style.display = '';
}
function showRegError(msg, field) {
  clearRegErrors();
  const after = field && regFieldOf(field);
  if (!after) {
    // No single field to point at (e.g. the server is down): right above the Submit button,
    // where the pro is looking, and it stays until they try again.
    const box = el('reg-error');
    box.textContent = msg;
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const note = document.createElement('div');
  note.className = 'msg error reg-field-error';
  note.setAttribute('role', 'alert');
  note.style.display = 'block';
  note.textContent = msg;
  after.insertAdjacentElement('afterend', note);
  const input = /^(INPUT|SELECT|TEXTAREA)$/.test(after.tagName) ? after : null;
  if (input) input.classList.add('field-invalid');
  if (field === 'area') el('area-pick').open = true;
  note.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (input && input.type !== 'checkbox') setTimeout(() => input.focus({ preventScroll: true }), 400);
}
// Typing in a field clears its note.
el('view-auth').addEventListener('input', (e) => {
  if (!e.target.classList?.contains('field-invalid')) return;
  e.target.classList.remove('field-invalid');
  const n = e.target.nextElementSibling;
  if (n?.classList.contains('reg-field-error')) n.remove();
});
// Server answers matched to the field they are about.
function serverErrorField(msg) {
  if (/email/i.test(msg)) return 'reg-email';
  if (/password/i.test(msg)) return 'reg-password';
  if (/business name/i.test(msg)) return 'reg-business';
  if (/ID number/i.test(msg)) return 'reg-idnum';
  if (/service you offer/i.test(msg)) return 'services';
  if (/WhatsApp code|6-digit code|Send code|Resend/i.test(msg)) return 'code';
  if (/WhatsApp number/i.test(msg)) return 'phone';
  if (/Terms/i.test(msg)) return 'terms';
  if (/^Name, email/i.test(msg)) return 'reg-name';
  return null;
}
const fail = (msg, field) => Object.assign(new Error(msg), { field });

el('btn-register').onclick = () => withBusy(el('btn-register'), 'Submitting application…', async () => {
  clearRegErrors();
  try {
    if (!el('svc-carwash').checked && !el('svc-laundry').checked) throw fail('Choose at least one service you offer', 'services');
    if (!el('reg-name').value.trim()) throw fail('Enter your full name', 'reg-name');
    if (!el('reg-business').value.trim()) throw fail('Enter your business or trading name. Your own name is fine if you work alone', 'reg-business');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el('reg-email').value.trim())) throw fail('Enter a valid email address', 'reg-email');
    if (!el('reg-phone').value.trim()) throw fail('Your WhatsApp number is required: new bookings are sent there', 'phone');
    if (regPhone.required) {
      if (!regPhone.sentTo) throw fail('Tap "Send code" to confirm your WhatsApp number', 'phone');
      if (el('reg-phone').value !== regPhone.sentTo) throw fail('You changed your WhatsApp number. Tap "Send code" again', 'phone');
      if (!regPhone.canSkip && !/^\d{6}$/.test(el('reg-code').value.trim())) {
        throw fail('Enter the 6-digit code we sent to your WhatsApp', 'code');
      }
    }
    const idNum = el('reg-idnum').value.replace(/\s/g, '');
    if (!/^\d{13}$/.test(idNum)) throw fail('Your SA ID number is 13 digits', 'reg-idnum');
    const serviceArea = serviceAreaText();
    if (!serviceArea) throw fail('Tick at least one service area, or type it under Other areas', 'area');
    if (el('reg-password').value.length < 8) throw fail('Choose a password of at least 8 characters', 'reg-password');
    if (!el('reg-terms').checked) throw fail('Please accept the Terms & Conditions to continue', 'terms');
    const services = [];
    if (el('svc-carwash').checked) services.push('carwash');
    if (el('svc-laundry').checked) services.push('laundry');
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        role: 'supplier', name: el('reg-name').value, email: el('reg-email').value.trim().toLowerCase(),
        phone: el('reg-phone').value, password: el('reg-password').value,
        business_name: el('reg-business').value, id_number: idNum,
        service_area: serviceArea,
        vehicles: collectVehicles(), equipment: collectEquipment(),
        services, accept_terms: true,
        phone_code: regPhone.canSkip ? undefined : el('reg-code').value.trim(),
        bank_name: el('reg-bank').value, bank_account: el('reg-account').value, bank_branch: el('reg-branch').value,
      },
    });
    me = user; setWho(); route();
    window.scrollTo(0, 0);
    toast('Application submitted for review', 'ok');
  } catch (e) { showRegError(e.message, e.field || serverErrorField(e.message)); }
});

el('btn-logout').onclick = signOut;

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

