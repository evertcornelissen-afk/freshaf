// FreshAF admin dashboard.
let me = null;

const VIEWS = ['view-auth', 'view-dash'];
const show = (view) => switchView(VIEWS, view);

// Say which site is being read, before anything is read. A dashboard pointed at a dev
// database shows real numbers from the wrong place and looks perfectly healthy doing it.
(async function showTarget() {
  const tag = document.getElementById('admin-target');
  if (!tag) return;
  try {
    const r = await fetch('/_admin/target');
    const t = await r.json();
    tag.textContent = t.host;
    tag.classList.toggle('target-live', Boolean(t.live));
    tag.classList.toggle('target-other', !t.live);
    tag.title = t.live
      ? 'Reading the LIVE site. Changes here affect real customers and pros.'
      : `NOT the live site - reading ${t.target}. Numbers here are not freshaf.io.`;
  } catch {
    tag.textContent = 'target unknown';
    tag.classList.add('target-other');
  }
})();

function decorate() {
  el('h-admin').insertAdjacentHTML('afterbegin', icon('lock'));
  el('h-overview').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-launch').insertAdjacentHTML('afterbegin', icon('spark'));
  el('h-suppliers').insertAdjacentHTML('afterbegin', icon('briefcase'));
  el('h-import').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-orderlog').insertAdjacentHTML('afterbegin', icon('clock'));
  el('h-customers').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-settings').insertAdjacentHTML('afterbegin', icon('shield'));
  el('h-reviewers').insertAdjacentHTML('afterbegin', icon('user'));
  initScrollChrome();
}

/* ---------- bulk supplier import ----------
   Reads a row copied straight out of the Load sheet of the Pro vetting questionnaire, so a
   completed form is pasted rather than retyped.

   Excel puts TABS between cells on the clipboard, and that matters here: two of the Load
   columns contain commas of their own - services is "carwash,laundry" and the service area
   is a list of suburbs - so splitting on commas tears those apart and shifts every column
   after them. Tabs are looked for first, and a header row is honoured when there is one,
   so the column order cannot silently corrupt an import. */
let lastCreds = [];

const IMPORT_FIELDS = ['name', 'email', 'phone', 'business_name', 'id_number', 'services',
  'service_area', 'radius_km', 'vehicle_reg', 'equipment_notes'];
// What the old comma format meant, kept so a list already written that way still imports.
const IMPORT_LEGACY = ['name', 'email', 'phone', 'business_name', 'id_number', 'service_area', 'services'];

function parseSupplierPaste(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Paste at least one supplier line first');

  const tabbed = lines.some((l) => l.includes('\t'));
  const cut = (l) => (tabbed ? l.split('\t') : l.split(','))
    .map((x) => (x || '').trim().replace(/^"([\s\S]*)"$/, '$1').trim());

  let order = tabbed ? IMPORT_FIELDS : IMPORT_LEGACY;
  let body = lines;
  const head = cut(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z_]/g, '_'));
  if (head.includes('email') && head.includes('name')) { order = head; body = lines.slice(1); }
  if (!body.length) throw new Error('That is a header row with no suppliers under it');

  return body.map((line, i) => {
    const cells = cut(line);
    const row = {};
    order.forEach((key, c) => { if (IMPORT_FIELDS.includes(key) && cells[c]) row[key] = cells[c]; });
    // Not cosmetic: a shifted column puts a person's NAME in the email field, and the
    // import happily creates an account nobody can ever log in to.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email || '')) {
      throw new Error(`Line ${i + 1}: "${row.email || ''}" is not an email address - check the columns line up`);
    }

    const svc = String(row.services || 'carwash').toLowerCase();
    row.services = svc === 'both'
      ? ['carwash', 'laundry']
      : svc.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return row;
  });
}

el('btn-import').onclick = async () => {
  try {
    const suppliers = parseSupplierPaste(el('import-text').value);
    const { results, created } = await api('/api/admin/suppliers/import', { method: 'POST', body: { suppliers } });
    lastCreds = results.filter((r) => r.status === 'created');
    el('import-results').innerHTML = '<table><thead><tr><th>Email</th><th>Status</th><th>Services</th><th>Radius</th><th>Temp password</th></tr></thead><tbody>' +
      results.map((r) => `<tr>
        <td>${escapeHtml(r.email)}</td>
        <td><span class="pill ${r.status === 'created' ? 'ok' : r.status === 'skipped' ? 'warn' : 'bad'}">${r.status}</span>
          ${r.reason ? `<div class="muted small-text">${escapeHtml(r.reason)}</div>` : ''}</td>
        <td class="small-text">${escapeHtml(r.services || '—')}</td>
        <td class="small-text">${r.radius_km ? `${r.radius_km} km` : '—'}</td>
        <td><code>${escapeHtml(r.temp_password || '—')}</code></td>
      </tr>`).join('') + '</tbody></table>';
    el('btn-copy-creds').classList.toggle('hidden', !lastCreds.length);
    toast(`${created} supplier${created === 1 ? '' : 's'} imported and pre-approved`, 'ok');
    await Promise.all([refreshSuppliers(), refreshStats()]);
  } catch (e) { showError('import-error', e.message); }
};

el('btn-copy-creds').onclick = async () => {
  const text = lastCreds.map((r) => `${r.email}  password: ${r.temp_password}`).join('\n');
  await navigator.clipboard.writeText(text);
  toast('Credentials copied — share them with your suppliers', 'ok');
};

/* ---------- store reviewer accounts ----------
   The passwords come back once, from this button, and live only on this page until it is
   closed. Copy them into Play Console / App Store Connect (and your password manager). */
let reviewerCreds = null;

async function refreshReviewers() {
  try {
    const s = await api('/api/admin/reviewer-accounts');
    const line = (label, a, extra) => a
      ? `${label}: <strong>${escapeHtml(a.email)}</strong>${a.is_demo ? ' <span class="pill warn">DEMO</span>' : ' <span class="pill bad">NOT DEMO</span>'}${extra || ''}`
      : `${label}: <span class="muted">not created yet</span>`;
    el('rev-status').innerHTML = line('Customer', s.customer) + '<br>' + line('Pro', s.pro, s.pro
      ? ` <span class="pill ${s.pro.status === 'approved' ? 'ok' : 'bad'}">${escapeHtml(s.pro.status || '?')}</span> <span class="pill ${s.pro.online ? 'ok' : 'bad'}">${s.pro.online ? 'online' : 'OFFLINE'}</span>`
      : '');
    if (s.customer) el('rev-customer').value = s.customer.email;
    if (s.pro) el('rev-pro').value = s.pro.email;
    el('btn-reviewers').textContent = s.customer || s.pro ? 'Reset passwords and put the pro online' : 'Create reviewer accounts';
  } catch (e) { showError('rev-error', e.message); }
}

el('btn-reviewers').onclick = async () => {
  el('rev-error').style.display = 'none';
  try {
    const r = await api('/api/admin/reviewer-accounts', { method: 'POST',
      body: { customer_email: el('rev-customer').value, pro_email: el('rev-pro').value } });
    reviewerCreds = r;
    el('rev-result').innerHTML = '<table><thead><tr><th>Account</th><th>Email</th><th>Password</th></tr></thead><tbody>'
      + [['Customer', r.customer], ['Pro', r.pro]].map(([k, c]) =>
        `<tr><td>${k}</td><td>${escapeHtml(c.email)}</td><td><code>${escapeHtml(c.password)}</code></td></tr>`).join('')
      + '</tbody></table><p class="muted small-text">Shown once. Any earlier password for these accounts no longer works.</p>';
    el('btn-copy-reviewers').classList.remove('hidden');
    toast('Reviewer accounts ready: pro online in Durbanville', 'ok');
    await Promise.all([refreshReviewers(), refreshSuppliers(), refreshCustomers()]);
  } catch (e) { showError('rev-error', e.message); }
};

el('btn-copy-reviewers').onclick = async () => {
  if (!reviewerCreds) return;
  const c = reviewerCreds;
  await navigator.clipboard.writeText(
    `FreshAF reviewer accounts (demo)\nCustomer: ${c.customer.email} / ${c.customer.password}\nPro: ${c.pro.email} / ${c.pro.password}`);
  toast('Sign-in details copied', 'ok');
};

async function boot() {
  try {
    decorate();
    const { user } = await api('/api/auth/me');
    if (user && user.role !== 'admin') { window.location.href = user.role === 'supplier' ? '/supplier' : '/'; return; }
    me = user;
    el('who').textContent = me ? me.name : '';
    el('btn-logout').classList.toggle('hidden', !me);
    if (!me) { show('view-auth'); hideSplash(); return; }
    await enterDash();
    hideSplash();
  } catch (e) {
    show('view-auth');
    hideSplash();
  }
}

async function enterDash() {
  if (me && me.must_change_password) await forcePasswordChange();
  await Promise.all([refreshStats(), refreshReadiness(), refreshSuppliers(), refreshCustomers(), refreshOrders(), loadSettings(), refreshReviewers(), refreshAdmins()]); // content first
  show('view-dash');
  setInterval(() => { refreshStats(); refreshOrders(); }, 15000);
}

/* ---------- launch readiness + backup ---------- */
async function refreshReadiness() {
  const r = await api('/api/admin/readiness');
  const row = (c) => `
    <div class="row spread" style="padding:9px 0;border-bottom:1px solid var(--border-soft);gap:12px">
      <div style="flex:1;min-width:180px">
        <strong style="font-size:.9rem">${escapeHtml(c.label)}</strong>
        <div class="muted small-text">${escapeHtml(c.detail)}</div>
      </div>
      <span class="pill ${c.ok ? 'ok' : 'warn'}">${c.ok ? 'ready' : 'not yet'}</span>
    </div>`;
  const apps = r.apps || [];
  el('readiness-box').innerHTML = r.checks.map(row).join('')
    + (apps.length ? `<h3 style="margin:18px 0 4px">Apps &amp; push notifications</h3>${apps.map(row).join('')}` : '');
}

el('btn-restore').onclick = () => el('restore-file').click();

const btnSummary = el('btn-daily-summary');
if (btnSummary) btnSummary.onclick = async () => {
  try {
    const r = await api('/api/admin/daily-summary', { method: 'POST' });
    toast(r.mail === 'sent' ? `Sent to admin@freshaf.io: ${r.subject}` : `Not sent (${r.mail}): ${r.subject}`, r.mail === 'sent' ? 'ok' : 'error');
  } catch (e) { toast(e.message, 'error'); }
};
el('restore-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const ok = await modal({
      title: 'Restore this backup?',
      body: `${file.name} will replace the live database on the next restart. Anything currently in production is discarded.`,
      confirmText: 'Stage restore', danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/admin/restore', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Restore failed');
    el('backup-ok').textContent = data.next;
    el('backup-ok').style.display = 'block';
    toast('Backup staged — redeploy to apply it', 'ok');
  } catch (err) { showError('backup-error', err.message); }
  finally { e.target.value = ''; }
};

async function refreshStats() {
  const s = await api('/api/admin/stats');
  el('stats-box').innerHTML = `
    <div class="stat"><div class="v">${s.customers}</div><div class="l">Customers signed up</div></div>
    <div class="stat"><div class="v">${s.signups_7d}</div><div class="l">Signed up this week</div></div>
    <div class="stat"><div class="v">${s.signups_30d}</div><div class="l">Signed up this month</div></div>
    <div class="stat"><div class="v">${s.suppliers_pending}</div><div class="l">Suppliers pending</div></div>
    <div class="stat"><div class="v">${s.suppliers_approved}</div><div class="l">Suppliers approved</div></div>
    <div class="stat"><div class="v">${s.suppliers_online}</div><div class="l">Online now</div></div>
    <div class="stat"><div class="v">${s.orders_active}</div><div class="l">Active orders</div></div>
    <div class="stat"><div class="v">${s.orders_completed}</div><div class="l">Completed</div></div>
    <div class="stat"><div class="v">${s.orders_carwash}</div><div class="l">Car wash orders</div></div>
    <div class="stat"><div class="v">${s.orders_laundry}</div><div class="l">Laundry orders</div></div>
    <div class="stat"><div class="v">${rand(s.revenue_cents)}</div><div class="l">Commission earned</div></div>`;
}


// The automatic background checks: ID arithmetic, company number format, Google listing.
// Every line says what it does and does not prove — a green tick here is not a clearance.
// application that is not yet approved, so the decision starts from the evidence.
// tick list in their app. The application stays pending.

window.afterSupplierChange = async () => {
  await Promise.all([refreshSuppliers(), refreshStats()]);
};

async function refreshSuppliers() {
  const status = el('sup-filter').value;
  const { suppliers } = await api(`/api/admin/suppliers${status ? `?status=${status}` : ''}`);
  if (!suppliers.length) { el('suppliers-box').innerHTML = '<p class="empty">None found.</p>'; return; }
  el('suppliers-box').innerHTML = `<table><thead><tr>
      <th>Business</th><th>Contact</th><th>Details</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>` + suppliers.map((s) => `<tr>
      <td><a href="/applicant.html?id=${s.user_id}" target="_blank" rel="noopener" style="font-weight:700">${escapeHtml(s.business_name)}</a>${s.is_demo ? ' <span class="pill warn">DEMO</span>' : ''}<br>
        <span class="muted small-text">${escapeHtml(s.service_area || '')}</span><br>
        ${(s.services || []).map((x) => `<span class="pill ${x === 'laundry' ? 'ok' : 'warn'}" style="margin-top:4px">${serviceName(x)}</span>`).join(' ')}</td>
      <td>${escapeHtml(s.name)}<br><span class="muted small-text">${escapeHtml(s.email)}<br>${escapeHtml(s.phone || '')}</span></td>
      <td class="muted small-text">ID: ${escapeHtml(s.id_number)}
        ${(s.vehicles || []).length
          ? '<br><strong>Vehicles:</strong> ' + s.vehicles.map((v) => escapeHtml([v.type, v.model, v.reg].filter(Boolean).join(' '))).join(' · ')
          : `<br>Vehicles: ${escapeHtml(s.vehicle_reg || 'none listed')}`}
        ${s.equipment?.items?.length
          ? '<br><strong>Equipment:</strong> ' + s.equipment.items.map((i) => i.qty ? `${escapeHtml(i.label)} ×${escapeHtml(i.qty)}` : escapeHtml(i.label)).join(', ') + (s.equipment.other ? `, ${escapeHtml(s.equipment.other)}` : '')
          : `<br>Equipment: ${escapeHtml(s.equipment_notes || 'none listed')}`}
        ${s.bank_name ? `<br>Bank: ${escapeHtml(s.bank_name)} · ${escapeHtml(s.bank_account || '')} · ${escapeHtml(s.bank_branch || '')}` : '<br>Bank: not provided'}
        ${(s.documents || []).length
          ? '<br>' + s.documents.map((d) => `<a href="/api/admin/docs/${d.id}" target="_blank">${d.kind.replace(/_/g, ' ')}</a>`).join(' · ')
          : '<br><span style="color:var(--warn)">No documents uploaded</span>'}
        ${s.status !== 'approved' && !s.is_demo ? safetyHtml(s) : ''}
        ${checklistHtml(s)}
        ${vettingHtml(s)}</td>
      <td><span class="pill ${s.status === 'approved' ? 'ok' : s.status === 'pending' ? 'warn' : 'bad'}">${s.status}</span>
        ${s.cash_blocked ? '<br><span class="pill bad" style="margin-top:5px">cash limit</span>' : ''}
        ${s.online ? '<br><span class="pill ok live" style="margin-top:5px">online</span>' : ''}
        ${s.status === 'approved' && !s.has_base ? '<br><span class="pill bad" style="margin-top:5px">no home base</span>' : ''}
        ${s.detailing ? `<br><span class="pill ${s.detailing.status === 'approved' ? 'ok' : s.detailing.status === 'pending' ? 'warn' : 'bad'}" style="margin-top:5px">detailing ${s.detailing.status}</span>` : ''}
        ${s.cash_owed_cents > 0 ? `<br><span class="muted small-text">holds ${rand(s.cash_owed_cents)} cash</span>` : ''}
        ${s.rating ? `<br><span class="muted small-text">${starInline} ${s.rating} (${s.rating_count})</span>` : ''}</td>
      <td>
        <div class="row" style="flex-wrap:nowrap">
        <a class="btn small" href="/applicant.html?id=${s.user_id}" target="_blank" rel="noopener">Open</a>
        ${s.status !== 'approved' ? `<button class="secondary small" onclick="setStatus(${s.user_id},'approve')">Approve</button>` : ''}
        ${s.status !== 'rejected' ? `<button class="secondary small" onclick="requestInfo(${s.user_id})">Request info</button>` : ''}
        ${(s.info_needed || []).length ? `<button class="secondary small" onclick="clearInfoRequest(${s.user_id})">Clear request</button>` : ''}
        ${s.status === 'pending' ? `<button class="danger small" onclick="setStatus(${s.user_id},'reject')">Reject</button>` : ''}
        ${s.status === 'approved' ? `<button class="danger small" onclick="setStatus(${s.user_id},'suspend')">Suspend</button>` : ''}
        ${s.cash_owed_cents > 0 ? `<button class="small" onclick="settleCash(${s.user_id}, ${s.cash_owed_cents})">Settle cash</button>` : ''}
        <button class="secondary small" onclick="setDemo(${s.user_id}, ${!s.is_demo})">${s.is_demo ? 'Make real' : 'Make demo'}</button>
        </div>
      </td>
    </tr>`).join('') + '</tbody></table>';
}

window.adminCancel = async (id) => {
  try {
    const reason = await modal({
      title: `Cancel order #${id}?`,
      body: 'The customer is emailed with your reason and the pro is told not to go. If it was paid by card, the refund is recorded as owed and you are emailed.',
      input: 'Reason (the customer sees this)', confirmText: 'Cancel order', danger: true,
    });
    if (reason === null) return;
    const r = await api(`/api/admin/orders/${id}/cancel`, { method: 'POST', body: { reason } });
    toast(r.refund_due_cents > 0 ? `Cancelled. Refund owed: ${rand(r.refund_due_cents)}` : 'Order cancelled', 'ok');
    await Promise.all([refreshOrders(), refreshStats()]);
  } catch (e) { toast(e.message, 'error'); }
};

window.markRefunded = async (id, cents) => {
  try {
    const ok = await modal({
      title: `Mark ${rand(cents)} as refunded?`,
      body: 'Only after you have actually refunded it in the Stitch dashboard. The customer is emailed that the refund is on its way.',
      confirmText: 'Mark refunded',
    });
    if (!ok) return;
    await api(`/api/admin/orders/${id}/refunded`, { method: 'POST' });
    toast('Refund recorded and customer emailed', 'ok');
    await Promise.all([refreshOrders(), refreshStats()]);
  } catch (e) { toast(e.message, 'error'); }
};

window.setDemo = async (id, makeDemo) => {
  try {
    const ok = await modal({
      title: makeDemo ? 'Make this a demo account?' : 'Make this a real account again?',
      body: makeDemo
        ? 'Demo accounts only ever see other demo accounts: a demo customer is matched only with demo pros, card payments use the test page, and they are left out of all figures. Use this for the App Store reviewer and for your own testing.'
        : 'It will be matched with real customers and pros again, card payments will be real, and it counts in the figures.',
      confirmText: makeDemo ? 'Make demo' : 'Make real',
      danger: !makeDemo,
    });
    if (!ok) return;
    await api(`/api/admin/users/${id}/demo`, { method: 'POST', body: { is_demo: makeDemo } });
    toast(makeDemo ? 'Marked as a demo account' : 'Marked as a real account', 'ok');
    await Promise.all([refreshSuppliers(), refreshCustomers(), refreshStats(), refreshReadiness()]);
  } catch (e) { showError('sup-error', e.message); }
};

window.settleCash = async (id, owed) => {
  try {
    const ok = await modal({
      title: `Record ${rand(owed)} received?`,
      body: 'Confirm only once the money is actually in the FreshAF account. This clears the balance and, if they were over the limit, puts them back on the platform.',
      confirmText: 'Mark as settled',
    });
    if (!ok) return;
    const r = await api(`/api/admin/suppliers/${id}/settle-cash`, { method: 'POST' });
    toast(`${rand(r.cleared_cents)} settled`, 'ok');
    await refreshSuppliers();
  } catch (e) { showError('sup-error', e.message); }
};


/* ---------- who else can get in ---------- */
// Shown once, never again: the temporary password is not stored in readable form, so if
// this card is dismissed before it is passed on, a new one has to be issued.
function showNewAdminCredentials(r) {
  // NOT location.origin. On the operator's own laptop that is http://localhost:5858 —
  // their machine and nobody else's. Pasting it to a new admin sends them to a dead
  // address on their own computer, which is exactly what happened the first time.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(location.origin);
  const signInUrl = local ? '<< fill in the dashboard address - see the note below >>' : location.origin;
  const localWarning = local ? `
    <p class="small-text" style="margin:9px 0 0;color:var(--warn)"><strong>This dashboard is not published yet.</strong>
      It is running at <code>${escapeHtml(location.origin)}</code>, which is this computer and nobody
      else can reach it. Until it is hosted, they either run their own copy on their laptop
      (see <code>admin-app/README.md</code>) or they cannot sign in at all. Fill the real address in
      before you send this.</p>` : '';
  const block = [
    `FreshAF admin dashboard`,
    `Sign in: ${signInUrl}`,
    `Email: ${r.email}`,
    `Temporary password: ${r.password}`,
    ``,
    `You will be asked to choose your own password the first time you sign in.`,
    `Do not forward this message.`,
  ].join('\n');
  const box = el('admins-new');
  box.classList.remove('hidden');
  box.innerHTML = `
    <strong>${escapeHtml(r.name)} can now sign in.</strong>
    <p class="small-text" style="margin:6px 0">This password is shown <strong>once</strong>. Send it to them
      now — if you lose it, issue a new one with “New password” below. They must change it on first sign-in.</p>
    <div style="font-family:ui-monospace,monospace;background:var(--panel-2,#f4f6f8);padding:10px 12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(block)}</div>
    ${localWarning}
    <div class="row mt">
      <button class="secondary small" id="btn-copy-admin">Copy these details</button>
      <button class="ghost small" onclick="document.getElementById('admins-new').classList.add('hidden')">Done, hide it</button>
    </div>`;
  el('btn-copy-admin').onclick = async () => {
    try { await navigator.clipboard.writeText(block); toast('Copied — paste it to them now', 'ok'); }
    catch { toast('Could not copy — select the text above', 'error'); }
  };
}

async function refreshAdmins() {
  let admins;
  try { ({ admins } = await api('/api/admin/admins')); }
  catch { el('admins-box').innerHTML = '<p class="muted">Team access needs the server update deployed.</p>'; return; }
  el('admins-box').innerHTML = `<table><thead><tr>
      <th>Name</th><th>Sign-in email</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>` + admins.map((a) => `<tr>
      <td><strong>${escapeHtml(a.name)}</strong>${a.is_you ? ' <span class="pill ok">you</span>' : ''}
        ${a.invited_by ? `<br><span class="muted small-text">added by ${escapeHtml(a.invited_by)}</span>` : ''}</td>
      <td>${escapeHtml(a.email)}</td>
      <td>${a.pending_first_sign_in
        ? '<span class="pill warn">has not signed in yet</span>'
        : '<span class="pill ok">active</span>'}</td>
      <td><div class="row" style="flex-wrap:nowrap">
        ${a.is_you ? '' : `<button class="secondary small" onclick="resetAdminPassword(${a.id})">Set password</button>`}
        ${a.is_you ? '' : `<button class="danger small" onclick="removeAdmin(${a.id}, '${escapeHtml(a.name)}')">Remove</button>`}
      </div></td>
    </tr>`).join('') + '</tbody></table>';
}

window.addAdmin = async () => {
  const name = el('admin-name').value.trim();
  const email = el('admin-email').value.trim();
  const password = el('admin-pw').value;
  if (!name || !email) return toast('Name and email are both needed', 'error');
  if (password && password.length < 12) return toast('That password is too short — use at least 12 characters', 'error');
  try {
    const ok = await modal({
      title: `Give ${name} full admin access?`,
      body: 'They will be able to approve and reject pros, read ID numbers and bank details, and message applicants. Everything they do is recorded under their own name.',
      confirmText: 'Create their login',
    });
    if (!ok) return;
    const r = await api('/api/admin/admins', { method: 'POST', body: { name, email, password } });
    el('admin-name').value = '';
    el('admin-email').value = '';
    el('admin-pw').value = '';
    showNewAdminCredentials(r);
    await refreshAdmins();
  } catch (e) { showError('admins-error', e.message); }
};

window.resetAdminPassword = async (id) => {
  try {
    const password = await modal({
      title: 'Set a new password for them',
      body: 'Their current password stops working immediately and they are signed out everywhere. '
        + 'Type the password you want them to use and tell them what it is &mdash; or leave it blank '
        + 'and one is generated that they must replace on first sign-in.',
      input: 'New password (at least 12 characters, or blank to generate one)',
      confirmText: 'Set it', danger: true,
    });
    if (password === null) return;
    if (password && password.length < 12) return toast('That password is too short — use at least 12 characters', 'error');
    const r = await api(`/api/admin/admins/${id}/reset-password`, { method: 'POST', body: { password } });
    showNewAdminCredentials({ name: r.email, email: r.email, password: r.password, chosen: r.chosen });
    await refreshAdmins();
  } catch (e) { showError('admins-error', e.message); }
};

window.removeAdmin = async (id, name) => {
  try {
    const ok = await modal({
      title: `Remove ${name}'s access?`,
      body: 'They are signed out immediately and cannot sign in again. Their name stays on the decisions and messages they already sent, so the history still makes sense.',
      confirmText: 'Remove access', danger: true,
    });
    if (!ok) return;
    await api(`/api/admin/admins/${id}/remove`, { method: 'POST' });
    toast('Access removed', 'ok');
    await refreshAdmins();
  } catch (e) { showError('admins-error', e.message); }
};

// An invited admin arrives holding a password that was sent over WhatsApp. Nothing else
// in the dashboard opens until they have replaced it.
async function forcePasswordChange() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal" style="max-width:460px">
      <h3>Choose your own password</h3>
      <p>You signed in with a temporary password that was sent to you. Replace it before going any
        further — this account can see applicants' ID numbers and bank details.</p>
      <div class="msg error" id="pw-error"></div>
      <label for="pw-current">The temporary password you were sent</label>
      <input id="pw-current" type="password" autocomplete="current-password">
      <label for="pw-next">Your new password (at least 12 characters)</label>
      <input id="pw-next" type="password" autocomplete="new-password">
      <label for="pw-again">Type it again</label>
      <input id="pw-again" type="password" autocomplete="new-password">
      <div class="row mt" style="justify-content:flex-end">
        <button data-act="save">Save and continue</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-act=save]').onclick = async () => {
    const current = wrap.querySelector('#pw-current').value;
    const next = wrap.querySelector('#pw-next').value;
    const again = wrap.querySelector('#pw-again').value;
    const err = (m) => { const b = wrap.querySelector('#pw-error'); b.textContent = m; b.classList.add('error'); b.style.display = 'block'; };
    if (next !== again) return err('Those two do not match');
    if (next.length < 12) return err('Use at least 12 characters');
    try {
      await api('/api/auth/admin-password', { method: 'POST', body: { current, next } });
      wrap.remove();
      toast('Password changed — this is yours now', 'ok');
    } catch (e) { err(e.message); }
  };
}

/* ---------- customer sign-ups ---------- */
let allCustomers = [];

function renderCustomers() {
  const q = (el('cust-search').value || '').trim().toLowerCase();
  const rows = q
    ? allCustomers.filter((c) => [c.name, c.email, c.phone, c.home_address]
      .some((v) => (v || '').toLowerCase().includes(q)))
    : allCustomers;
  el('cust-count').textContent = q
    ? `${rows.length} of ${allCustomers.length} sign-ups`
    : `${allCustomers.length} sign-up${allCustomers.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    el('customers-box').innerHTML = `<p class="empty">${q ? 'No sign-up matches that.' : 'No sign-ups yet.'}</p>`;
    return;
  }
  el('customers-box').innerHTML = `<table><thead><tr>
      <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Signed up</th><th>Orders</th><th>Rewards</th><th></th>
    </tr></thead><tbody>` + rows.map((c) => `<tr>
      <td>${c.id}</td>
      <td>${escapeHtml(c.name)}${c.is_demo ? ' <span class="pill warn">DEMO</span>' : ''}</td>
      <td><a href="mailto:${encodeURIComponent(c.email)}">${escapeHtml(c.email)}</a></td>
      <td>${c.phone ? `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a>` : '—'}</td>
      <td class="muted small-text">${escapeHtml(c.home_address || '—')}</td>
      <td class="muted small-text">${(c.created_at || '').replace('T', ' ').slice(0, 16)}</td>
      <td>${c.orders}${c.orders_completed ? ` <span class="muted small-text">(${c.orders_completed} done)</span>` : ''}</td>
      <td>${c.points_cents ? rand(c.points_cents) : '—'}</td>
      <td><button class="secondary small" onclick="setDemo(${c.id}, ${!c.is_demo})">${c.is_demo ? 'Make real' : 'Make demo'}</button></td>
    </tr>`).join('') + '</tbody></table>';
}

async function refreshCustomers() {
  const { customers } = await api('/api/admin/customers');
  allCustomers = customers;
  renderCustomers();
}
el('cust-search').addEventListener('input', renderCustomers);

async function refreshOrders() {
  const { orders } = await api('/api/admin/orders');
  if (!orders.length) { el('orders-box').innerHTML = '<p class="empty">No orders yet.</p>'; return; }
  el('orders-box').innerHTML = `<table><thead><tr>
      <th>Order</th><th>Service</th><th>Customer</th><th>Supplier</th><th>Package</th><th>Total</th><th>Fee</th><th>Payment</th><th>Status</th><th></th>
    </tr></thead><tbody>` + orders.map((o) => `<tr>
      <td>#${o.id}</td>
      <td><span class="pill ${o.service === 'laundry' ? 'ok' : 'warn'}">${serviceName(o.service)}</span></td>
      <td>${escapeHtml(o.customer_name)}${o.return_address ? `<div class="muted small-text">Return: ${escapeHtml(o.return_address)} · to ${escapeHtml(o.return_receiver || '')}</div>` : ''}${o.handover_receiver ? `<div class="muted small-text">Handed to ${escapeHtml(o.handover_receiver)}${o.handover_photo ? ` · <a href="/api/admin/orders/${o.id}/handover-photo" target="_blank">photo</a>` : ''}</div>` : ''}</td><td>${escapeHtml(o.supplier_name || '—')}</td>
      <td>${o.package.replace(/_/g, ' ')} / ${o.vehicle}</td>
      <td>${rand(o.price_cents)}</td><td>${o.commission_cents ? rand(o.commission_cents) : '—'}</td>
      <td class="muted small-text">${o.payment_method} · ${o.payment_status.replace(/_/g, ' ')}</td>
      <td><span class="pill ${statusPillClass(o.status)}">${statusLabel(o.status === 'in_progress' && o.out_for_delivery_at ? 'out_for_delivery' : o.status, o.service)}</span>
        ${o.refund_due_cents > 0 ? `<br><span class="pill bad" style="margin-top:5px">refund due ${rand(o.refund_due_cents)}</span>` : ''}
        ${o.status === 'cancelled' && o.cancelled_by ? `<div class="muted small-text">by ${escapeHtml(o.cancelled_by)}${o.cancel_reason ? `: ${escapeHtml(o.cancel_reason)}` : ''}</div>` : ''}</td>
      <td><div class="row" style="flex-wrap:nowrap">
        ${!['completed', 'cancelled'].includes(o.status) ? `<button class="danger small" onclick="adminCancel(${o.id})">Cancel</button>` : ''}
        ${o.refund_due_cents > 0 ? `<button class="small" onclick="markRefunded(${o.id}, ${o.refund_due_cents})">Mark refunded</button>` : ''}
      </div></td>
    </tr>`).join('') + '</tbody></table>';
}

async function loadSettings() {
  const s = await api('/api/admin/settings');
  el('set-commission').value = s.platform_fee_pct;
  el('set-radius').value = s.dispatch_radius_km;
  el('set-timeout').value = s.offer_timeout_sec;
  el('set-points').value = s.points_earn_pct;
  el('set-callout-free').value = s.callout_free_km;
  el('set-callout-rate').value = s.callout_per_km_cents / 100;
  el('set-callout-cap').value = s.callout_cap_cents / 100;
  el('set-return-free').value = s.return_leg_free_km;
  el('set-return-rate').value = s.return_leg_per_km_cents / 100;
  el('set-return-cap').value = s.return_leg_cap_cents / 100;
  el('return-price-flag').classList.toggle('hidden', !!s.return_leg_price_set);
  el('set-detailing-fee').value = s.detailing_fee_pct ?? 10;
  el('set-detailing-signup').checked = !!s.detailing_signup;
  el('set-detailing-booking').checked = !!s.detailing_booking;
  el('detailing-card-note').classList.toggle('hidden', !!s.card_live);
  el('set-bh-open').value = s.business_open || '07:00';
  el('set-bh-close').value = s.business_close || '18:00';
}

el('btn-save-hours').onclick = async () => {
  try {
    await api('/api/admin/settings', { method: 'POST', body: { business_open: el('set-bh-open').value, business_close: el('set-bh-close').value } });
    toast('Business hours saved', 'ok');
    await loadSettings();
  } catch (e) { toast(e.message, 'error'); }
};

// Detailing has two switches. Pro applications can open first so detailers are approved
// and priced before a single customer sees the service.
el('btn-save-detailing').onclick = async () => {
  const booking = el('set-detailing-booking').checked;
  if (booking && !confirm('Open detailing to customers? They will see it on freshaf.io and in the app straight away.')) return;
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: {
        detailing_fee_pct: el('set-detailing-fee').value,
        detailing_signup: el('set-detailing-signup').checked,
        detailing_booking: booking,
      },
    });
    toast('Detailing settings saved', 'ok');
    await loadSettings();
  } catch (e) { toast(e.message, 'error'); }
};

el('btn-save-return').onclick = async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: {
        return_leg_free_km: el('set-return-free').value,
        return_leg_per_km_cents: Number(el('set-return-rate').value) * 100,
        return_leg_cap_cents: Number(el('set-return-cap').value) * 100,
      },
    });
    toast('Return-trip price saved', 'ok');
    await Promise.all([loadSettings(), refreshReadiness()]);
  } catch (e) { toast(e.message, 'error'); }
};

el('btn-save-settings').onclick = async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: {
        platform_fee_pct: el('set-commission').value,
        dispatch_radius_km: el('set-radius').value,
        offer_timeout_sec: el('set-timeout').value,
        points_earn_pct: el('set-points').value,
        callout_free_km: el('set-callout-free').value,
        callout_per_km_cents: Number(el('set-callout-rate').value) * 100,
        callout_cap_cents: Number(el('set-callout-cap').value) * 100,
      },
    });
    toast('Settings saved', 'ok');
  } catch (e) { toast(e.message, 'error'); }
};

el('sup-filter').onchange = refreshSuppliers;

el('btn-login').onclick = async () => {
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value.trim().toLowerCase(), password: el('login-password').value } });
    if (user.role !== 'admin') { window.location.href = user.role === 'supplier' ? '/supplier' : '/'; return; }
    me = user;
    el('who').textContent = me.name;
    el('btn-logout').classList.remove('hidden');
    enterDash();
  } catch (e) { showError('login-error', e.message); }
};

el('btn-logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.reload(); };

boot();
