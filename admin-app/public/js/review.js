/* ---------- reviewing an applicant ---------- */
// Shared by the dashboard list and the single-applicant page, so a change to how an
// application is judged or acted on lands in both places at once. Each page defines
// afterSupplierChange() for what to refresh when something here changes it.
if (typeof window.afterSupplierChange !== 'function') window.afterSupplierChange = async () => {};
function reviewError(msg) {
  const box = document.getElementById('sup-error');
  if (box) showError('sup-error', msg); else toast(msg, 'error');
}

const starInline = `<span class="star-inline"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span>`;

function vettingHtml(s) {
  const v = s.vetting;
  if (!v) {
    return `<div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--border)">
      <span class="muted">Background checks not run yet.</span>
      <button class="secondary small" onclick="recheck(${s.user_id})">Run checks</button></div>`;
  }
  const dot = (state) => state === true ? '<span style="color:var(--ok,#1799c2)">✓</span>'
    : state === false ? '<span style="color:var(--danger)">✗</span>'
    : '<span class="muted">?</span>';

  const id = v.id_number || {};
  const co = v.company || {};
  const g = v.google || {};

  const stars = g.rating != null
    ? `${starInline} <strong>${g.rating}</strong> <span class="muted">(${g.reviews} review${g.reviews === 1 ? '' : 's'})</span>`
    : '<span class="muted">no rating</span>';

  const cipcPill = {
    verified: '<span class="pill ok">CIPC verified</span>',
    not_found: '<span class="pill bad">NOT on CIPC register</span>',
    not_a_company: '<span class="pill">sole trader</span>',
    unchecked: '<span class="pill warn">CIPC not checked</span>',
  }[v.cipc_status || 'unchecked'];

  return `
  <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--border)">
    <strong style="display:block;margin-bottom:4px">
      Background checks
      ${v.level === 'bad' ? '<span class="pill bad">problem</span>'
        : v.level === 'warn' ? '<span class="pill warn">look closer</span>'
        : '<span class="pill ok">nothing flagged</span>'}
    </strong>
    <div>${dot(id.ok)} <strong>ID number</strong> —
      ${id.ok ? `valid checksum, born ${id.dob} (age ${id.age}), ${id.citizenship}` : (id.reason || 'not checked')}
      ${id.ok ? '<br><span class="muted small-text">Format and checksum only &mdash; does not prove the ID belongs to them.</span>' : ''}
    </div>
    <div>${dot(co.ok)} <strong>Company number</strong> —
      ${co.ok ? `${co.formatted} (registered ${co.year})` : (co.reason || 'none given')}
      ${cipcPill}
      <a href="${co.search_url || 'https://bizprofile.cipc.co.za/'}" target="_blank" rel="noopener">check on CIPC</a>
      <br><span class="muted small-text">Format only. CIPC has no free API, so confirm on their site and record it:</span>
      <span style="white-space:nowrap">
        <button class="secondary small" onclick="setCipc(${s.user_id},'verified')">Verified</button>
        <button class="danger small" onclick="setCipc(${s.user_id},'not_found')">Not found</button>
        <button class="ghost small" onclick="setCipc(${s.user_id},'not_a_company')">Sole trader</button>
      </span>
      ${v.cipc_note ? `<br><span class="muted small-text">Note: ${escapeHtml(v.cipc_note)}</span>` : ''}
    </div>
    <div>${dot(g.ok)} <strong>Google</strong> —
      ${g.ok ? `${stars}${g.address ? `<br><span class="muted small-text">${escapeHtml(g.address)}</span>` : ''}
        ${g.maps_url ? `<br><a href="${g.maps_url}" target="_blank" rel="noopener">open on Google Maps</a>` : ''}`
        : (g.reason || 'not checked')}
      ${g.note ? `<br><span class="muted small-text">${escapeHtml(g.note)}</span>` : ''}
    </div>
    ${(v.flags || []).length
      ? `<div style="margin-top:5px;color:var(--warn)"><strong>Flagged:</strong> ${v.flags.join(' &middot; ')}</div>`
      : ''}
    <div class="muted small-text" style="margin-top:4px">
      Checked ${v.checked_at ? String(v.checked_at).replace('T', ' ').slice(0, 16) : 'never'}
      <button class="ghost small" onclick="recheck(${s.user_id})">Re-run</button>
    </div>
  </div>`;
}

window.recheck = async (userId) => {
  try {
    toast('Running checks...', 'info');
    await api(`/api/admin/suppliers/${userId}/recheck`, { method: 'POST' });
    toast('Checks updated', 'ok');
    await window.afterSupplierChange();
  } catch (e) { toast(e.message, 'error'); }
};

window.setCipc = async (userId, status) => {
  try {
    let note = '';
    if (status === 'not_found') {
      note = await modal({
        title: 'Company not found on CIPC?',
        body: 'This is a serious flag: the business claims a registration number that is not on the register. It is recorded against the application and shown on every review from now on.',
        input: 'What did you search for, and what came back?', confirmText: 'Record it', danger: true,
      });
      if (note === null) return;
    }
    await api(`/api/admin/suppliers/${userId}/cipc`, { method: 'POST', body: { status, note } });
    toast('CIPC result recorded', 'ok');
    await window.afterSupplierChange();
  } catch (e) { toast(e.message, 'error'); }
};

// Safety rating out of 5 (rules and weights in js/safety.js), shown first on every

function safetyHtml(s) {
  if (!window.FreshSafety) return '';
  const r = window.FreshSafety.safetyRating(s);
  const color = r.level === 'ok' ? 'var(--ok,#1799c2)' : r.level === 'warn' ? 'var(--warn)' : 'var(--danger)';
  const full = Math.floor(r.score);
  const half = r.score - full >= 0.5;
  const stars = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  const li = (arr, mark, c) => arr.map((x) => `<div><span style="color:${c}">${mark}</span> ${escapeHtml(x)}</div>`).join('');
  return `
    <div style="margin:8px 0 2px;padding:9px 11px;border:1px solid ${color};border-radius:9px">
      <div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap">
        <strong style="font-size:1.05rem">Safety ${r.score.toFixed(1)} / 5</strong>
        <span style="color:${color};letter-spacing:1px">${stars}</span>
        <strong style="color:${color}">${escapeHtml(r.verdict)}</strong>
      </div>
      <details style="margin-top:4px">
        <summary class="small-text" style="cursor:pointer">Why this score</summary>
        <div class="small-text" style="margin-top:5px">
          ${li(r.plus, '+', 'var(--ok,#1799c2)')}
          ${li(r.minus, '−', 'var(--danger)')}
          <div class="muted" style="margin-top:6px"><strong>Still yours to do (never scored):</strong></div>
          ${li(r.stillToDo, '□', 'var(--muted,#888)')}
        </div>
      </details>
    </div>`;
}

// The approval checklist, straight from the server. Red = required and not in yet, so
// the application cannot be approved; "asked" = we have already requested it.
function checklistHtml(s) {
  const list = s.checklist || [];
  if (!list.length) return '';
  const missing = list.filter((c) => c.required && !c.have);
  const rows = list.filter((c) => c.required || c.have || c.asked).map((c) => {
    const mark = c.have ? '<span style="color:var(--ok,#1799c2)">✓</span>'
      : c.required ? '<span style="color:var(--danger)">✗</span>'
      : '<span class="muted">·</span>';
    const tag = !c.have && c.asked ? ' <em class="muted">(asked)</em>' : '';
    return `<span style="display:inline-block;margin-right:11px;white-space:nowrap">${mark} ${c.label}${tag}</span>`;
  }).join('');
  const asked = (s.info_needed || []).length;
  return `
    <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--border)">
      <strong style="display:block;margin-bottom:3px">
        ${missing.length
          ? `<span style="color:var(--danger)">Cannot approve — ${missing.length} required item${missing.length === 1 ? '' : 's'} outstanding</span>`
          : '<span style="color:var(--ok,#1799c2)">All required items in</span>'}
      </strong>
      ${rows}
      ${asked ? `<div class="muted small-text" style="margin-top:5px">Requested ${s.info_requested_at ? `on ${String(s.info_requested_at).slice(0, 10)}` : ''}${s.info_note ? ` — note: ${escapeHtml(s.info_note)}` : ''}</div>` : ''}
    </div>`;
}

// Tick what is outstanding, add a note, and the pro gets an email, a push and a live

window.requestInfo = async (userId) => {
  const { suppliers } = await api('/api/admin/suppliers');
  const s = suppliers.find((x) => x.user_id === userId);
  if (!s) return toast('Supplier not found', 'error');

  const picked = await new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" style="max-width:520px">
        <h3>What do you still need from ${escapeHtml(s.business_name)}?</h3>
        <p class="muted small-text">They stay pending — this is not a rejection. Required items that have
          not arrived are ticked for you.</p>
        <div style="max-height:46vh;overflow:auto;margin:12px 0">
          ${(s.checklist || []).map((c) => `
            <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);font-weight:400;cursor:pointer">
              <input type="checkbox" value="${c.key}" style="margin-top:3px;width:auto"
                ${c.required && !c.have ? 'checked' : ''}>
              <span>
                <strong>${c.label}</strong>
                ${c.have ? ' <span style="color:var(--ok,#1799c2)">already in</span>' : ''}
                ${c.required ? ' <em class="muted">required</em>' : ''}
                <br><span class="muted small-text">${c.ask}</span>
              </span>
            </label>`).join('')}
        </div>
        <label for="__ri-note">Note to add to the email (optional)</label>
        <input id="__ri-note" autocomplete="off" placeholder="e.g. the ID photo you sent is too blurry to read">
        <div class="row mt" style="justify-content:flex-end">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="secondary" data-act="wa" title="Copies the same request, worded for WhatsApp">Copy WhatsApp message</button>
          <button data-act="ok">Send request</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = (v) => { backdrop.remove(); resolve(v); };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('[data-act=cancel]').onclick = () => close(null);
    // Same items and note as the email, ready to paste into WhatsApp (078 299 1050).
    // Copying does not send or save anything; "Send request" still records it and emails.
    backdrop.querySelector('[data-act=wa]').onclick = async () => {
      const keys = [...backdrop.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      if (!keys.length) return toast('Tick at least one thing you need', 'error');
      const items = (s.checklist || []).filter((c) => keys.includes(c.key));
      const text = window.FreshSafety.whatsappRequest(s, items, backdrop.querySelector('#__ri-note').value.trim());
      try { await navigator.clipboard.writeText(text); toast('WhatsApp message copied. Paste it into their chat.', 'ok'); }
      catch { window.prompt('Copy this message:', text); }
    };
    backdrop.querySelector('[data-act=ok]').onclick = () => close({
      items: [...backdrop.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value),
      note: backdrop.querySelector('#__ri-note').value.trim(),
    });
  });
  if (!picked) return;
  if (!picked.items.length) return toast('Tick at least one thing you need', 'error');
  try {
    const r = await api(`/api/admin/suppliers/${userId}/request-info`, { method: 'POST', body: picked });
    toast(r.mail === 'queued'
      ? `Asked for ${r.items.length} item${r.items.length === 1 ? '' : 's'} — email and notification sent`
      : `Request saved — no email configured, so tell them yourself`, 'ok');
    await window.afterSupplierChange();
  } catch (e) { toast(e.message, 'error'); }
};

window.clearInfoRequest = async (userId) => {
  try {
    const ok = await modal({
      title: 'Clear the outstanding request?',
      body: 'Use this when what you asked for arrived another way — a phone call, a reference, a document emailed to you. The pro stops seeing the request in their app.',
      confirmText: 'Clear request',
    });
    if (!ok) return;
    await api(`/api/admin/suppliers/${userId}/clear-info-request`, { method: 'POST' });
    toast('Request cleared', 'ok');
    await window.afterSupplierChange();
  } catch (e) { toast(e.message, 'error'); }
};

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
    await window.afterSupplierChange();
  } catch (e) { reviewError(e.message); }
};
