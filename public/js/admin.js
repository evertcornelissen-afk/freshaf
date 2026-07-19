// FreshAF admin dashboard.
let me = null;

const VIEWS = ['view-auth', 'view-dash'];
const show = (view) => switchView(VIEWS, view);

function decorate() {
  el('h-admin').insertAdjacentHTML('afterbegin', icon('lock'));
  el('h-overview').insertAdjacentHTML('afterbegin', icon('signal'));
  el('h-suppliers').insertAdjacentHTML('afterbegin', icon('briefcase'));
  el('h-import').insertAdjacentHTML('afterbegin', icon('user'));
  el('h-orderlog').insertAdjacentHTML('afterbegin', icon('clock'));
  el('h-settings').insertAdjacentHTML('afterbegin', icon('shield'));
}

/* ---------- bulk supplier import ---------- */
let lastCreds = [];

el('btn-import').onclick = async () => {
  try {
    const lines = el('import-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Paste at least one supplier line first');
    const suppliers = lines.map((line) => {
      const [name, email, phone, business_name, id_number, service_area, svc] = line.split(',').map((x) => (x || '').trim());
      const s = (svc || 'carwash').toLowerCase();
      return {
        name, email, phone, business_name, id_number, service_area,
        services: s === 'both' ? ['carwash', 'laundry'] : [s],
      };
    });
    const { results, created } = await api('/api/admin/suppliers/import', { method: 'POST', body: { suppliers } });
    lastCreds = results.filter((r) => r.status === 'created');
    el('import-results').innerHTML = '<table><thead><tr><th>Email</th><th>Status</th><th>Temp password</th></tr></thead><tbody>' +
      results.map((r) => `<tr>
        <td>${r.email}</td>
        <td><span class="pill ${r.status === 'created' ? 'ok' : r.status === 'skipped' ? 'warn' : 'bad'}">${r.status}</span>
          ${r.reason ? `<div class="muted small-text">${r.reason}</div>` : ''}</td>
        <td><code>${r.temp_password || '—'}</code></td>
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
  await Promise.all([refreshStats(), refreshSuppliers(), refreshOrders(), loadSettings()]); // content first
  show('view-dash');
  setInterval(() => { refreshStats(); refreshOrders(); }, 15000);
}

async function refreshStats() {
  const s = await api('/api/admin/stats');
  el('stats-box').innerHTML = `
    <div class="stat"><div class="v">${s.customers}</div><div class="l">Customers</div></div>
    <div class="stat"><div class="v">${s.suppliers_pending}</div><div class="l">Suppliers pending</div></div>
    <div class="stat"><div class="v">${s.suppliers_approved}</div><div class="l">Suppliers approved</div></div>
    <div class="stat"><div class="v">${s.suppliers_online}</div><div class="l">Online now</div></div>
    <div class="stat"><div class="v">${s.orders_active}</div><div class="l">Active orders</div></div>
    <div class="stat"><div class="v">${s.orders_completed}</div><div class="l">Completed</div></div>
    <div class="stat"><div class="v">${s.orders_carwash}</div><div class="l">Car wash orders</div></div>
    <div class="stat"><div class="v">${s.orders_laundry}</div><div class="l">Laundry orders</div></div>
    <div class="stat"><div class="v">${rand(s.revenue_cents)}</div><div class="l">Commission earned</div></div>`;
}

const starInline = `<span class="star-inline"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span>`;

async function refreshSuppliers() {
  const status = el('sup-filter').value;
  const { suppliers } = await api(`/api/admin/suppliers${status ? `?status=${status}` : ''}`);
  if (!suppliers.length) { el('suppliers-box').innerHTML = '<p class="empty">None found.</p>'; return; }
  el('suppliers-box').innerHTML = `<table><thead><tr>
      <th>Business</th><th>Contact</th><th>Details</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>` + suppliers.map((s) => `<tr>
      <td><strong>${s.business_name}</strong><br>
        <span class="muted small-text">${s.service_area || ''}</span><br>
        ${(s.services || []).map((x) => `<span class="pill ${x === 'laundry' ? 'ok' : 'warn'}" style="margin-top:4px">${serviceName(x)}</span>`).join(' ')}</td>
      <td>${s.name}<br><span class="muted small-text">${s.email}<br>${s.phone || ''}</span></td>
      <td class="muted small-text">ID: ${s.id_number}<br>Reg: ${s.vehicle_reg || '—'}<br>${s.equipment_notes || ''}
        ${s.bank_name ? `<br>Bank: ${s.bank_name} · ${s.bank_account || ''} · ${s.bank_branch || ''}` : '<br>Bank: not provided'}
        ${(s.documents || []).length
          ? '<br>' + s.documents.map((d) => `<a href="/api/admin/docs/${d.id}" target="_blank">${d.kind.replace(/_/g, ' ')}</a>`).join(' · ')
          : '<br><span style="color:var(--warn)">No documents uploaded</span>'}</td>
      <td><span class="pill ${s.status === 'approved' ? 'ok' : s.status === 'pending' ? 'warn' : 'bad'}">${s.status}</span>
        ${s.online ? '<br><span class="pill ok live" style="margin-top:5px">online</span>' : ''}
        ${s.rating ? `<br><span class="muted small-text">${starInline} ${s.rating} (${s.rating_count})</span>` : ''}</td>
      <td>
        <div class="row" style="flex-wrap:nowrap">
        ${s.status !== 'approved' ? `<button class="small" onclick="setStatus(${s.user_id},'approve')">Approve</button>` : ''}
        ${s.status === 'pending' ? `<button class="danger small" onclick="setStatus(${s.user_id},'reject')">Reject</button>` : ''}
        ${s.status === 'approved' ? `<button class="danger small" onclick="setStatus(${s.user_id},'suspend')">Suspend</button>` : ''}
        </div>
      </td>
    </tr>`).join('') + '</tbody></table>';
}

window.setStatus = async (id, action) => {
  try {
    let reason = null;
    if (action === 'reject' || action === 'suspend') {
      reason = await modal({
        title: action === 'reject' ? 'Reject this application?' : 'Suspend this supplier?',
        body: 'The supplier will see the reason you give on their portal.',
        input: 'Reason', confirmText: action === 'reject' ? 'Reject' : 'Suspend', danger: true,
      });
      if (reason === null) return;
    } else {
      const ok = await modal({
        title: 'Approve this supplier?',
        body: 'They will immediately be able to go online and receive job offers.',
        confirmText: 'Approve',
      });
      if (!ok) return;
    }
    await api(`/api/admin/suppliers/${id}/${action}`, { method: 'POST', body: { reason } });
    toast(`Supplier ${action}${action === 'approve' ? 'd' : 'ed'}`, action === 'approve' ? 'ok' : 'info');
    await Promise.all([refreshSuppliers(), refreshStats()]);
  } catch (e) { showError('sup-error', e.message); }
};

async function refreshOrders() {
  const { orders } = await api('/api/admin/orders');
  if (!orders.length) { el('orders-box').innerHTML = '<p class="empty">No orders yet.</p>'; return; }
  el('orders-box').innerHTML = `<table><thead><tr>
      <th>Order</th><th>Service</th><th>Customer</th><th>Supplier</th><th>Package</th><th>Total</th><th>Fee</th><th>Payment</th><th>Status</th>
    </tr></thead><tbody>` + orders.map((o) => `<tr>
      <td>#${o.id}</td>
      <td><span class="pill ${o.service === 'laundry' ? 'ok' : 'warn'}">${serviceName(o.service)}</span></td>
      <td>${o.customer_name}</td><td>${o.supplier_name || '—'}</td>
      <td>${o.package.replace(/_/g, ' ')} / ${o.vehicle}</td>
      <td>${rand(o.price_cents)}</td><td>${o.commission_cents ? rand(o.commission_cents) : '—'}</td>
      <td class="muted small-text">${o.payment_method} · ${o.payment_status.replace(/_/g, ' ')}</td>
      <td><span class="pill ${statusPillClass(o.status)}">${statusLabel(o.status, o.service)}</span></td>
    </tr>`).join('') + '</tbody></table>';
}

async function loadSettings() {
  const s = await api('/api/admin/settings');
  el('set-commission').value = s.commission_pct;
  el('set-radius').value = s.dispatch_radius_km;
  el('set-timeout').value = s.offer_timeout_sec;
  el('set-points').value = s.points_earn_pct;
  el('set-callout-free').value = s.callout_free_km;
  el('set-callout-rate').value = s.callout_per_km_cents / 100;
  el('set-callout-cap').value = s.callout_cap_cents / 100;
}

el('btn-save-settings').onclick = async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: {
        commission_pct: el('set-commission').value,
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
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email: el('login-email').value, password: el('login-password').value } });
    if (user.role !== 'admin') { window.location.href = user.role === 'supplier' ? '/supplier' : '/'; return; }
    me = user;
    el('who').textContent = me.name;
    el('btn-logout').classList.remove('hidden');
    enterDash();
  } catch (e) { showError('login-error', e.message); }
};

el('btn-logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.reload(); };

boot();
