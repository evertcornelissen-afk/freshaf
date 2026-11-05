// Shared helpers for all FreshAF frontends.

// Where the API lives. On the website this is '' — same origin, as before.
//
// Inside the native app it is not. The store builds ship these same HTML, CSS and JS
// files INSIDE the binary (which is what makes them real apps rather than the website
// in a frame, and what Apple's guideline 4.2 is looking for), so the page origin is
// capacitor://localhost, not freshaf.io, and a relative /api/... would resolve to the
// bundle instead of the server. The native shell sets window.FRESHAF_API_BASE before
// any of this runs; see mobile/README.md.
//
// credentials follows from the same fact: 'same-origin' on the web keeps the session
// cookie exactly as strict as it is today, and 'include' is required in the app because
// the request genuinely is cross-origin there.
const API_BASE = (typeof window !== 'undefined' && window.FRESHAF_API_BASE) || '';
const API_CREDENTIALS = API_BASE ? 'include' : 'same-origin';

function apiUrl(path) {
  // Absolute URLs (the payment hand-off) are passed through untouched.
  if (!API_BASE || /^https?:\/\//i.test(path)) return path;
  return API_BASE.replace(/\/$/, '') + path;
}

// In the native app the session is a Bearer token, not a cookie, because the page origin
// is capacitor://localhost and the cookie is SameSite=lax. X-FreshAF-Client is what makes
// the server return a token on sign-in at all — it is never handed to a browser.
function authHeaders() {
  if (!window.FRESHAF_NATIVE) return {};
  const h = { 'X-FreshAF-Client': 'native' };
  const t = window.FreshAFNative && window.FreshAFNative.getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      credentials: API_CREDENTIALS,
      signal: AbortSignal.timeout(75000),
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // Free-tier hosting sleeps when idle — surface that instead of a cryptic failure.
    throw new Error('The server is waking up — please wait a few seconds and try again.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }

  // Session handling for the app, done once here rather than at every sign-in call site:
  // a missed one would leave the user signed out again on the next cold start, which is
  // the kind of bug that only shows up on a real device a day later.
  if (window.FRESHAF_NATIVE && window.FreshAFNative) {
    if (data && data.token) window.FreshAFNative.setToken(data.token);
    else if (/\/api\/auth\/(logout|delete-account)$/.test(path)) window.FreshAFNative.setToken(null);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Sign out of this device. The app's stored token is dropped FIRST, before any network
// call, so a dead connection can never leave the next person to pick up the phone signed
// in as the last one. On the website the session is an httpOnly cookie only the server
// can clear, so if that call fails we say so instead of reloading into a page that still
// looks signed in.
async function signOut() {
  // Unlink this phone's push token first, while the session that owns it is still valid,
  // so the next person to use the phone does not receive this account's alerts.
  if (window.FreshAFNative && window.FreshAFNative.push) await window.FreshAFNative.push.forget();
  if (window.FreshAFNative) await window.FreshAFNative.setToken(null);
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    if (!window.FRESHAF_NATIVE) {
      toast('Could not sign out. Check your connection and try again.', 'error');
      return;
    }
  }
  window.location.reload();
}

// Buttons built in JavaScript carry data-action="name" data-arg="value" instead of an
// inline onclick. The site's Content-Security-Policy (rightly) has no 'unsafe-inline', so
// the browser refuses to run inline handlers at all: from 5 Nov 2026, when the policy went
// live, every such button (accept / decline a job, advance a job, upload a document, view
// an order) silently did nothing. Only the names listed here can be triggered.
const CLICK_ACTIONS = new Set(['acceptOffer', 'declineOffer', 'advanceJob', 'submitHandover',
  'openTrack', 'openFilePicker']);
window.openFilePicker = (id) => { const f = document.getElementById(id); if (f) f.click(); };
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest && e.target.closest('[data-action]');
  if (!t || !CLICK_ACTIONS.has(t.dataset.action)) return;
  const fn = window[t.dataset.action];
  if (typeof fn !== 'function') return;
  e.preventDefault();
  const arg = t.dataset.arg;
  fn(arg != null && /^-?\d+$/.test(arg) ? Number(arg) : arg);
});

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

// Customer-supplied text goes into innerHTML in a few admin tables — escape it there.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

/* ---------- address autocomplete (South Africa, via /api/geocode) ---------- */
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
  // OSM knows most South African streets but few house numbers, so say plainly when
  // a pick is street-level and the customer still owes us a number.
  const note = document.createElement('div');
  note.className = 'ac-note hidden';
  wrap.parentNode.insertBefore(note, wrap.nextSibling);

  let timer = null, lastQuery = '';
  // One session token covers all the typing plus the one lookup that follows, which is
  // how Google bills a session rather than a charge per keystroke. A new one starts
  // after each pick.
  let session = newSession();
  function newSession() {
    try { return crypto.randomUUID(); } catch { return String(Math.random()).slice(2) + Date.now(); }
  }
  function hide() { list.classList.add('hidden'); }
  function setNote(text) {
    note.textContent = text || '';
    note.classList.toggle('hidden', !text);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { hide(); return; }
    timer = setTimeout(async () => {
      lastQuery = q;
      try {
        const { results } = await api('/api/geocode?q=' + encodeURIComponent(q)
          + '&session=' + encodeURIComponent(session));
        if (input.value.trim() !== lastQuery || !results.length) { hide(); return; }
        list.innerHTML = results.map((r, i) =>
          `<div class="ac-item" data-i="${i}">${icon('pin')} <span>${r.label}${
            r.precision === 'street' ? '<em class="ac-hint">street</em>' : ''}</span></div>`).join('');
        list.classList.remove('hidden');
        list.querySelectorAll('.ac-item').forEach((n) => {
          n.addEventListener('mousedown', async (e) => {
            e.preventDefault();
            const r = results[Number(n.dataset.i)];
            input.value = r.label;
            hide();
            // Google's suggestions carry a place id, not coordinates. Resolve it before
            // handing the pick on, or the pin never moves and the order cannot be placed.
            if (r.place_id && r.lat == null) {
              setNote('Finding that address…');
              try {
                const place = await api('/api/geocode/place?id=' + encodeURIComponent(r.place_id)
                  + '&session=' + encodeURIComponent(session));
                r.lat = place.lat; r.lng = place.lng;
                if (place.label) { r.label = place.label; input.value = place.label; }
              } catch {
                setNote('We could not place that address. Drop the pin on the map instead.');
                return;
              } finally {
                session = newSession();
              }
            }
            // A street-level hit with no number in the text still needs one from them.
            if (r.precision === 'street' && !/^\s*\d/.test(r.label)) {
              setNote('Add your street number in front, plus any unit or gate details.');
              input.focus();
              try { input.setSelectionRange(0, 0); } catch {}
            } else {
              setNote('');
            }
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

/* ============================================================
   MOTION
   Progressive enhancement only: with JS off or motion reduced,
   every element is already in its final, visible state.
   ============================================================ */
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAN_REVEAL = !REDUCED_MOTION && 'IntersectionObserver' in window;
// Only now is it safe for the stylesheet to hide .reveal elements: we know this script
// is running and can put them back. Anything that stops us getting here leaves the page
// fully visible rather than blank.
if (CAN_REVEAL) document.documentElement.classList.add('js-motion');

// Reveal on scroll. Anything tagged .reveal fades up once, the first time it is seen.
// Children of [data-stagger] follow each other rather than arriving as a block.
let revealObserver = null;
function observeReveals(root = document) {
  if (!CAN_REVEAL) {
    root.querySelectorAll?.('.reveal').forEach((n) => n.classList.add('is-in'));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        revealObserver.unobserve(e.target); // reveal once — re-animating on scroll-up is nauseating
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }
  const pending = [...root.querySelectorAll('.reveal:not(.is-in), .steps:not(.is-in)')];
  pending.forEach((n) => revealObserver.observe(n));
  // Backstop: if anything is still hidden a few seconds later — an observer that never
  // fired, a container that was display:none when we looked — show it anyway. A visitor
  // must never be left staring at a blank panel because an animation did not run.
  setTimeout(() => {
    for (const n of pending) {
      if (n.classList.contains('is-in')) continue;
      const r = n.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) n.classList.add('is-in');
    }
  }, 2600);
}

// Give each child of a stagger group its own small delay.
function applyStagger(root = document) {
  root.querySelectorAll('[data-stagger]').forEach((group) => {
    const step = Number(group.dataset.stagger) || 70;
    [...group.children].forEach((child, i) => {
      if (child.classList.contains('reveal')) child.style.transitionDelay = `${Math.min(i * step, 420)}ms`;
    });
  });
}

// Sticky bar condenses once you leave the top, plus a hairline read-progress bar.
function initScrollChrome() {
  const bar = document.querySelector('.topbar');
  let progress = null;
  if (!REDUCED_MOTION) {
    progress = document.createElement('div');
    progress.className = 'scroll-progress';
    document.body.appendChild(progress);
  }
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY || 0;
    if (bar) bar.classList.toggle('is-scrolled', y > 12);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    }
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

// Count a number up when it scrolls into view. Eased, so it decelerates into the value.
function initCounters(root = document) {
  const nodes = [...root.querySelectorAll('.count-up:not([data-counted])')];
  if (!nodes.length) return;
  const run = (node) => {
    node.dataset.counted = '1';
    const target = Number(node.dataset.target || node.textContent) || 0;
    const suffix = node.dataset.suffix || '';
    if (REDUCED_MOTION) { node.textContent = target + suffix; return; }
    const dur = 1100;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (!('IntersectionObserver' in window)) { nodes.forEach(run); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      run(e.target);
      io.unobserve(e.target);
    }
  }, { threshold: 0.4 });
  nodes.forEach((n) => io.observe(n));
}

// Roll a rand()-formatted money figure from its current value to a new one, so the
// total visibly moves when a package, vehicle or pro changes instead of snapping.
function animateRand(node, toCents) {
  if (!node) return;
  const parse = (t) => {
    const digits = String(t).replace(/[^\d]/g, '');
    return digits ? Number(digits) * 100 : null;
  };
  const from = parse(node.textContent);
  if (REDUCED_MOTION || from === null || from === toCents) { node.textContent = rand(toCents); return; }
  const dur = 420;
  const start = performance.now();
  cancelAnimationFrame(node._randRaf || 0);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = rand(Math.round(from + (toCents - from) * eased));
    if (t < 1) node._randRaf = requestAnimationFrame(tick);
  };
  node._randRaf = requestAnimationFrame(tick);
}

// One call to wire up a freshly rendered chunk of DOM.
function initMotion(root = document) {
  applyStagger(root);
  observeReveals(root);
  initCounters(root);
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

/* ---------- modal (replaces confirm/prompt) ---------- */
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
    in_progress: 'Laundering', out_for_delivery: 'Out for delivery', completed: 'Delivered',
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

// SSE with auto-reconnect.
//
// On the web this is a plain same-origin EventSource and the cookie does the work. In the
// app it cannot be: EventSource takes no headers, so there is nowhere to put the Bearer
// token. A sixty-second ticket is fetched instead — short enough that a URL appearing in
// a proxy log is worthless by the time anyone reads it. The ticket is re-fetched on every
// reconnect, since by then the previous one has certainly expired.
function connectEvents(handlers) {
  let es;
  let closed = false;

  function attach(url) {
    es = new EventSource(url);
    for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, (e) => fn(JSON.parse(e.data || '{}')));
    es.onerror = () => { es.close(); if (!closed) setTimeout(open, 3000); };
  }

  async function open() {
    if (closed) return;
    if (!window.FRESHAF_NATIVE) return attach(apiUrl('/api/events'));
    try {
      const { ticket } = await api('/api/auth/sse-ticket');
      attach(`${apiUrl('/api/events')}?ticket=${encodeURIComponent(ticket)}`);
    } catch {
      // Signed out, or offline. Retrying is right: the stream is how the app learns a
      // Pro accepted the job, so giving up leaves the screen silently stale.
      if (!closed) setTimeout(open, 5000);
    }
  }

  open();
  return () => { closed = true; if (es) es.close(); };
}

// Light / dark theme slider (theme is applied pre-paint by the inline head script).
// The track carries a sun and a moon so the switch says what it does — an unmarked
// pill next to the wordmark reads as a stray control.
const THEME_MARKS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
  moon: '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"/>',
};
document.addEventListener('DOMContentLoaded', () => {
  const sw = document.getElementById('theme-switch');
  if (!sw) return;
  const track = sw.parentElement.querySelector('.track');
  if (track && !track.querySelector('.tt-mark')) {
    const mark = (name) => `<span class="tt-mark tt-${name}"><svg viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${THEME_MARKS[name]}</svg></span>`;
    track.insertAdjacentHTML('afterbegin', mark('sun') + mark('moon'));
  }
  sw.checked = document.documentElement.dataset.theme === 'dark';
  sw.onchange = () => {
    const t = sw.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    localStorage.setItem('freshaf_theme', t);
  };
});

// Installable-app support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

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
  // A hidden view has no box, so the observer never saw its .reveal nodes. Wire them
  // up now that the view has one, and start each view at the top of the page.
  if (typeof initMotion === 'function') initMotion(n);
  window.scrollTo({ top: 0, behavior: 'auto' });
}
