// Shared helpers — DEMO build: api() talks to the in-browser simulated backend.
async function api(path, opts = {}) {
  // Address autocomplete goes straight to Photon (OpenStreetMap) — no backend in the demo.
  if (path.startsWith('/api/geocode')) {
    try {
      const q = new URL(path, location.origin).searchParams.get('q') || '';
      if (q.length < 3) return { results: [] };
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=16.2,-35.0,33.1,-22.0`, { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      return {
        results: (data.features || []).map((f) => {
          const p = f.properties || {};
          const label = [
            [p.name, p.housenumber].filter(Boolean).join(' ') || p.street,
            p.street && p.name !== p.street ? p.street : null,
            p.district, p.city || p.town || p.village, p.state,
          ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
          return { label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
        }).filter((x) => x.label),
      };
    } catch { return { results: [] }; }
  }
  try {
    return await window.DEMO.handle(path, opts);
  } catch (e) {
    throw new Error(e.message || 'Something went wrong');
  }
}

// Disable a button and show progress text while an async action runs.
async function withBusy(btn, busyLabel, fn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function rand(cents) {
  return 'R' + (cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

function el(id) { return document.getElementById(id); }

/* ---------- inline SVG icon set ---------- */
const ICONS = {
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  navigate: '<path d="M3 11l19-9-9 19-2-8-8-2Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  droplet: '<path d="M12 2.7S6 10 6 14a6 6 0 0 0 12 0c0-4-6-11.3-6-11.3Z"/>',
  car: '<path d="M6 16l1.6-4.8A2 2 0 0 1 9.5 10h5a2 2 0 0 1 1.9 1.2L18 16"/><path d="M4 19v-1a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  wallet: '<path d="M20 7H4a2 2 0 0 1 0-4h14v4"/><path d="M4 7v12a2 2 0 0 0 2 2h14V7"/><path d="M16 13h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/>',
  signal: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>',
  shirt: '<path d="M20.4 7 16 3h-1.9a2.5 2.5 0 0 1-4.2 0H8L3.6 7l2.2 3L7 9.4V21h10V9.4l1.2.6 2.2-3Z"/>',
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
};

/* ---------- show/hide password toggle ---------- */
function pwToggle(input) {
  if (!input || input.dataset.pwWrapped) return;
  input.dataset.pwWrapped = '1';
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  btn.setAttribute('aria-label', 'Show password');
  btn.innerHTML = icon('eye');
  wrap.appendChild(btn);
  btn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  };
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[type="password"]').forEach(pwToggle);
});

/* ---------- address autocomplete ---------- */
function attachAutocomplete(input, onPick) {
  if (!input || input.dataset.acWrapped) return;
  input.dataset.acWrapped = '1';
  const wrap = document.createElement('div');
  wrap.className = 'ac-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('div');
  list.className = 'ac-list hidden';
  wrap.appendChild(list);

  let timer = null, lastQuery = '';
  function hide() { list.classList.add('hidden'); }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { hide(); return; }
    timer = setTimeout(async () => {
      lastQuery = q;
      try {
        const { results } = await api('/api/geocode?q=' + encodeURIComponent(q));
        if (input.value.trim() !== lastQuery || !results.length) { hide(); return; }
        list.innerHTML = results.map((r, i) =>
          `<div class="ac-item" data-i="${i}">${icon('pin')} ${r.label}</div>`).join('');
        list.classList.remove('hidden');
        list.querySelectorAll('.ac-item').forEach((n) => {
          n.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const r = results[Number(n.dataset.i)];
            input.value = r.label;
            hide();
            if (onPick) onPick(r);
          });
        });
      } catch { hide(); }
    }, 300);
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

function icon(name, cls = '') {
  return `<span class="icon ${cls}"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${ICONS[name] || ''}</svg></span>`;
}

/* ---------- toasts ---------- */
function toast(message, type = 'info') {
  let root = el('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const ic = type === 'ok' ? 'check' : type === 'error' ? 'alert' : 'signal';
  t.innerHTML = `${icon(ic)}<span>${message}</span>`;
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, 4200);
}

/* ---------- modal ---------- */
function modal({ title, body = '', input = null, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        ${body ? `<p>${body}</p>` : ''}
        ${input !== null ? `<label>${input}</label><input id="__modal-input" autocomplete="off">` : ''}
        <div class="row mt" style="justify-content:flex-end">
          <button class="ghost" data-act="cancel">${cancelText}</button>
          <button class="${danger ? 'danger' : ''}" data-act="ok">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const inputEl = backdrop.querySelector('#__modal-input');
    if (inputEl) inputEl.focus();
    function close(value) { backdrop.remove(); resolve(value); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('[data-act=cancel]').onclick = () => close(null);
    backdrop.querySelector('[data-act=ok]').onclick = () => close(input !== null ? (inputEl.value || '') : true);
    if (inputEl) inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(inputEl.value || ''); });
  });
}

function showError(id, msg) {
  const box = el(id);
  if (box) {
    box.textContent = msg;
    box.classList.add('error');
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 6000);
  } else {
    toast(msg, 'error');
  }
}

const STATUS_LABELS = {
  carwash: {
    pending_payment: 'Awaiting payment', searching: 'Finding your washer',
    accepted: 'Washer assigned', en_route: 'Washer en route',
    in_progress: 'Wash in progress', completed: 'Completed',
    cancelled: 'Cancelled', no_providers: 'No washers available',
  },
  laundry: {
    pending_payment: 'Awaiting payment', searching: 'Finding your laundry pro',
    accepted: 'Laundry pro assigned', en_route: 'Collecting your laundry',
    in_progress: 'Laundering', completed: 'Delivered',
    cancelled: 'Cancelled', no_providers: 'No laundry pros available',
  },
};

function statusLabel(s, service = 'carwash') {
  return (STATUS_LABELS[service] || STATUS_LABELS.carwash)[s] || s;
}

function serviceName(service) {
  return service === 'laundry' ? 'Laundry' : 'Car Wash';
}

function statusPillClass(s) {
  if (['completed'].includes(s)) return 'ok';
  if (['cancelled', 'no_providers'].includes(s)) return 'bad';
  return 'warn';
}

// DEMO build: realtime events come from the in-browser simulator, not SSE.
function connectEvents(handlers) {
  for (const [event, fn] of Object.entries(handlers)) window.DEMO.on(event, fn);
  return () => {};
}

// Light / dark theme slider (theme is applied pre-paint by the inline head script).
document.addEventListener('DOMContentLoaded', () => {
  const sw = document.getElementById('theme-switch');
  if (!sw) return;
  sw.checked = document.documentElement.dataset.theme === 'dark';
  sw.onchange = () => {
    const t = sw.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    localStorage.setItem('freshaf_theme', t);
  };
});

// Fade out and remove the boot splash once the page is ready.
function hideSplash() {
  const s = el('splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 500);
}

// Animated view switching: hide all ids, reveal one with a transition.
function switchView(ids, active) {
  for (const v of ids) el(v).classList.add('hidden');
  const n = el(active);
  n.classList.remove('hidden', 'view-anim');
  void n.offsetWidth; // restart animation
  n.classList.add('view-anim');
}
