// One application, on its own page (/applicant.html?id=123).
//
// Deliberately NOT a panel inside the dashboard: reviewing someone means reading a lot
// of detail, opening documents in other tabs and writing them a message. That deserves
// a page you can open, leave open, and come back to — one per applicant.
//
// The judging and the actions live in review.js, shared with the dashboard list, so the
// two can never disagree about whether an application can be approved.

const APPLICANT_ID = Number(new URLSearchParams(location.search).get('id'));

// The shared menu reads this to show who is signed in and offer Sign out.
let me = null;

// Which site this page is reading. Same reason as the dashboard: a page showing real
// numbers from the wrong database looks perfectly healthy.
(async function showTarget() {
  const tag = document.getElementById('admin-target');
  if (!tag) return;
  try {
    const t = await (await fetch('/_admin/target')).json();
    tag.textContent = t.host;
    tag.classList.toggle('target-live', Boolean(t.live));
    tag.classList.toggle('target-other', !t.live);
    tag.title = t.live
      ? 'Reading the LIVE site. Changes here affect real customers and pros.'
      : `NOT the live site - reading ${t.target}.`;
  } catch {
    tag.textContent = 'target unknown';
    tag.classList.add('target-other');
  }
})();

const DOC_LABELS = {
  id_copy: 'SA ID copy',
  proof_address: 'Proof of address',
  work_photo: 'Photo of setup',
  bank_letter: 'Bank confirmation letter',
  police_clearance: 'Police clearance',
  company_reg: 'Company registration',
};

function fieldRow(label, value, opts) {
  const mono = opts && opts.mono;
  const v = value == null || value === ''
    ? '<span class="muted">not provided</span>'
    : escapeHtml(String(value));
  return `<div class="appl-field">
    <div class="k muted small-text">${escapeHtml(label)}</div>
    <div class="v"${mono ? ' style="font-family:ui-monospace,monospace"' : ''}>${v}</div>
  </div>`;
}

function messagesHtml(messages) {
  if (!messages) return '<p class="muted">Loading…</p>';
  if (!messages.length) return '<p class="muted">Nothing has been sent to this applicant yet.</p>';
  const tags = { request_info: 'Requested info', decision: 'Decision', message: 'Message' };
  return messages.map((m) => {
    const tag = tags[m.kind] || m.kind;
    const bad = m.delivery === 'failed' || m.delivery === 'dry_run' || m.delivery === 'skipped';
    const warn = bad
      ? `<span class="pill warn" style="margin-left:6px">${m.delivery === 'dry_run' ? 'not actually emailed' : escapeHtml(m.delivery)}</span>`
      : '';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border-soft,#eee)">
      <div class="row spread" style="gap:8px">
        <strong style="font-size:.9rem">${escapeHtml(m.subject || tag)}</strong>
        <span class="muted small-text">${String(m.created_at || '').replace('T', ' ').slice(0, 16)}</span>
      </div>
      <div class="muted small-text">${tag}${m.sent_by ? ' by ' + escapeHtml(m.sent_by) : ''}${warn}</div>
      <div class="small-text" style="white-space:pre-wrap;margin-top:4px">${escapeHtml(m.body || '')}</div>
    </div>`;
  }).join('');
}

let current = null;
let history = null;
let mailStatus = null;

// review.js calls this after an approve / reject / request-info, so the page it was
// clicked on updates instead of showing the buttons for a decision already made.
window.afterSupplierChange = async () => { await load(); };

async function load() {
  if (!APPLICANT_ID) {
    el('applicant-box').innerHTML = '<p class="empty">No application id in the address.</p>';
    return;
  }
  const { suppliers } = await api('/api/admin/suppliers');
  const s = suppliers.find((x) => x.user_id === APPLICANT_ID);
  if (!s) {
    el('applicant-box').innerHTML = '<p class="empty">That application no longer exists.</p>';
    return;
  }
  current = s;
  render();
  // The message history is a second call and an older server does not have it yet;
  // the page is useful without it, so it never blocks the first paint.
  try {
    const h = await api(`/api/admin/suppliers/${APPLICANT_ID}/messages`);
    history = h.messages || [];
    mailStatus = h.mail || null;
  } catch {
    history = [];
    mailStatus = null;
  }
  render();
}

function render() {
  const s = current;
  const docs = s.documents || [];
  const statusPill = `<span class="pill ${s.status === 'approved' ? 'ok' : s.status === 'pending' ? 'warn' : 'bad'}">${s.status}</span>`;
  const mailWarning = mailStatus && mailStatus.ok === false
    ? `<div class="msg error" style="display:block">Email is NOT working from the server: ${escapeHtml(mailStatus.detail || '')}
       Use “Open in Outlook” below until that is fixed.</div>`
    : '';
  const vehicles = (s.vehicles || []).length
    ? s.vehicles.map((v) => [v.type, v.model, v.reg].filter(Boolean).join(' ')).join(' / ')
    : s.vehicle_reg;
  const equipment = s.equipment && s.equipment.items && s.equipment.items.length
    ? s.equipment.items.map((i) => (i.qty ? `${i.label} ×${i.qty}` : i.label)).join(', ')
      + (s.equipment.other ? `, ${s.equipment.other}` : '')
    : s.equipment_notes;

  document.title = `${s.business_name || 'Application'} — FreshAF Admin`;

  el('applicant-box').innerHTML = `
    <p><a href="/" class="muted">&larr; All applications</a></p>

    <div class="card">
      <div class="row spread" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0 0 3px">${escapeHtml(s.business_name || '')} ${statusPill}</h2>
          <div class="muted">${escapeHtml(s.name || '')} &middot; ${escapeHtml(s.service_area || 'no area given')}
            &middot; ${(s.services || []).map(serviceName).join(', ')}</div>
          <div class="muted small-text" style="margin-top:3px">
            Applied ${String(s.created_at || '').replace('T', ' ').slice(0, 16)}</div>
        </div>
        <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
          ${s.status !== 'approved' ? `<button class="small" onclick="setStatus(${s.user_id},'approve')">Approve</button>` : ''}
          ${s.status !== 'rejected' ? `<button class="secondary small" onclick="requestInfo(${s.user_id})">Request info</button>` : ''}
          ${(s.info_needed || []).length ? `<button class="secondary small" onclick="clearInfoRequest(${s.user_id})">Clear request</button>` : ''}
          ${s.status === 'pending' ? `<button class="danger small" onclick="setStatus(${s.user_id},'reject')">Reject</button>` : ''}
          ${s.status === 'approved' ? `<button class="danger small" onclick="setStatus(${s.user_id},'suspend')">Suspend</button>` : ''}
        </div>
      </div>
      ${s.status !== 'approved' && !s.is_demo ? safetyHtml(s) : ''}
      ${checklistHtml(s)}
      ${vettingHtml(s)}
    </div>

    <div class="card">
      <h2>What they submitted</h2>
      ${fieldRow('Business / trading name', s.business_name)}
      ${fieldRow('Contact name', s.name)}
      ${fieldRow('Email', s.email)}
      ${fieldRow('WhatsApp / phone', s.phone)}
      ${fieldRow('Service area', s.service_area)}
      ${fieldRow('Services', (s.services || []).map(serviceName).join(', '))}
      ${fieldRow('SA ID number', s.id_number, { mono: true })}
      ${fieldRow('Company registration', s.reg_number, { mono: true })}
      ${fieldRow('VAT number', s.vat_number, { mono: true })}
      ${fieldRow('Vehicles', vehicles)}
      ${fieldRow('Equipment', equipment)}
      ${fieldRow('Bank', [s.bank_name, s.bank_account, s.bank_branch].filter(Boolean).join(' / '))}
    </div>

    <div class="card">
      <h2>Documents</h2>
      ${docs.length
        ? `<div class="row" style="flex-wrap:wrap;gap:8px">${docs.map((d) => `
            <a class="btn secondary small" href="/api/admin/docs/${d.id}" target="_blank" rel="noopener">
              ${escapeHtml(DOC_LABELS[d.kind] || String(d.kind).replace(/_/g, ' '))}</a>`).join('')}</div>`
        : '<p class="muted">Nothing uploaded.</p>'}
    </div>

    ${detailingHtml(s)}

    <div class="card">
      <h2>Message this applicant</h2>
      ${mailWarning}
      <p class="muted small-text">Sent from the FreshAF address, in the FreshAF email shell. It does not
        change their status &mdash; this is a conversation, not a decision.</p>
      <label for="msg-subject">Subject</label>
      <input id="msg-subject" autocomplete="off" placeholder="e.g. Two documents still outstanding">
      <label for="msg-body">Message</label>
      <textarea id="msg-body" rows="8" placeholder="Hi ${escapeHtml((s.name || '').split(' ')[0])},"></textarea>
      <div class="row mt" style="flex-wrap:wrap">
        <button onclick="sendMessage(${s.user_id})">Send from FreshAF</button>
        <button class="secondary small" onclick="openInOutlook('${escapeHtml(s.email || '')}')">Open in Outlook</button>
        <button class="ghost small" onclick="copyMessage()">Copy text</button>
      </div>
      <p class="muted small-text" style="margin-top:9px">
        <strong>Send from FreshAF</strong> goes out as <strong>FreshAF &lt;admin@freshaf.io&gt;</strong>
        to <strong>${escapeHtml(s.email || 'their address')}</strong>, and their reply comes back to
        admin@freshaf.io. It also shows as a notification in their FreshAF Pro app.<br>
        <strong>Open in Outlook</strong> uses whichever account Outlook opens with &mdash; that is
        <em>not</em> necessarily FreshAF. Check the <strong>From</strong> line says admin@freshaf.io
        before you send, or the applicant gets an email from a different business.
      </p>
    </div>

    <div class="card">
      <h2>What we have already sent</h2>
      ${messagesHtml(history)}
    </div>`;
}

// The detailing application, when there is one: photos of past work, their link, and the
// decision. Separate from approving the pro: approving here only adds detailing jobs.
function detailingHtml(s) {
  const d = s.detailing;
  // Ticked "I also do detailing" when applying, but has not sent photos yet. Worth seeing
  // here: it is a detailer who has not finished the second application.
  if (!d) {
    if (!s.detailing_intent) return '';
    return `
    <div class="card">
      <h2>Detailing <span class="pill warn">said yes, not applied</span></h2>
      <p class="muted small-text">They ticked detailing on their application but have not sent photos of their work yet,
        so no detailing job can reach them. Worth a nudge if the rest of the application is good.</p>
    </div>`;
  }
  const pill = `<span class="pill ${d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'warn' : 'bad'}">${d.status}</span>`;
  const link = d.link ? `<a href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.link)}</a>` : 'none';
  return `
    <div class="card">
      <h2>Detailing application ${pill}</h2>
      <p class="muted small-text">Applied ${String(d.applied_at || '').slice(0, 16)}${d.decided_at ? ` &middot; decided ${String(d.decided_at).slice(0, 16)}` : ''}</p>
      <div class="appl-field"><div class="k muted small-text">Reviews / website</div><div class="v">${link}</div></div>
      ${d.reason ? fieldRow('Reason given', d.reason) : ''}
      <p class="muted small-text" style="margin-top:10px">Approve only if the photos look like their own work (same car
        park, same equipment, before-and-after pairs) and the link shows real detailing reviews.</p>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin:10px 0">${(d.photos || []).map((p, i) => `
        <a href="/api/admin/detailing-photos/${p.id}" target="_blank" rel="noopener" title="${escapeHtml(p.original_name || '')}">
          <img src="/api/admin/detailing-photos/${p.id}" alt="Photo ${i + 1}" loading="lazy"
            style="width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border-soft)"></a>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap">
        ${d.status !== 'approved' ? `<button class="small" onclick="detailingDecision(${s.user_id},'approve')">Approve for detailing</button>` : ''}
        ${d.status === 'pending' ? `<button class="danger small" onclick="detailingDecision(${s.user_id},'decline')">Decline</button>` : ''}
        ${d.status === 'approved' ? `<button class="danger small" onclick="detailingDecision(${s.user_id},'decline')">Take detailing away</button>` : ''}
      </div>
    </div>`;
}

window.detailingDecision = async (userId, decision) => {
  let reason = null;
  if (decision === 'decline') {
    reason = prompt('Why? The pro sees this, so say what they can fix.');
    if (reason === null) return;
    if (!reason.trim()) return toast('Give a reason', 'error');
  } else if (!confirm('Approve this pro for detailing jobs?')) return;
  try {
    await api(`/api/admin/suppliers/${userId}/detailing`, { method: 'POST', body: { decision, reason } });
    toast(decision === 'approve' ? 'Approved for detailing' : 'Detailing declined', 'ok');
    await load();
  } catch (e) { toast(e.message, 'error'); }
};

window.sendMessage = async (userId) => {
  const subject = el('msg-subject').value.trim();
  const body = el('msg-body').value.trim();
  if (!body) return toast('Write a message first', 'error');
  try {
    const r = await api(`/api/admin/suppliers/${userId}/message`, { method: 'POST', body: { subject, body } });
    if (r.delivery === 'dry_run') {
      toast('Recorded, but NOT emailed: the server has no mail password set', 'error');
    } else {
      toast(`Sent to ${r.to}`, 'ok');
    }
    await load();
  } catch (e) { showError('sup-error', e.message); }
};

// Works even before the server update lands: hands the drafted message to Outlook so it
// goes out by hand, and gets read once more before it does.
window.openInOutlook = (email) => {
  const subject = el('msg-subject').value.trim() || 'FreshAF Pro application';
  const body = el('msg-body').value;
  if (!body.trim()) return toast('Write a message first', 'error');
  window.location.href = `mailto:${encodeURIComponent(email)}`
    + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

window.copyMessage = async () => {
  const text = `${el('msg-subject').value}\n\n${el('msg-body').value}`.trim();
  if (!text) return toast('Write a message first', 'error');
  try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); }
  catch { toast('Could not copy', 'error'); }
};

(async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    if (!user || user.role !== 'admin') throw new Error('not an admin');
    me = user;
    const who = el('who');
    if (who) who.textContent = user.name || '';
    await load();
  } catch {
    el('applicant-box').innerHTML = `<div class="card" style="text-align:center">
      <h2 style="justify-content:center">Sign in first</h2>
      <p class="muted">Open the dashboard, sign in, then come back to this application.</p>
      <p><a class="btn" href="/">Go to the dashboard</a></p>
    </div>`;
  }
})();
