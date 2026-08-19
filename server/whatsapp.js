// WhatsApp job alerts via the Meta WhatsApp Cloud API.
//
// Business-initiated messages (a job alert lands when the pro is not chatting with us)
// must use a template Meta has pre-approved, so every send here goes through one of the
// two templates documented in WHATSAPP-SETUP.md.
//
// With no credentials set the module runs in DRY RUN: it records exactly what it would
// have sent in the whatsapp_log table and prints it, so dispatch is testable end to end
// before the Meta account exists.
const { db, getSetting } = require('./db');

const API_VERSION = 'v21.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const TPL_JOB = process.env.WHATSAPP_TEMPLATE_JOB || 'freshaf_job_alert';
const TPL_CODE = process.env.WHATSAPP_TEMPLATE_CODE || 'freshaf_verify_code';

function configured() { return !!(PHONE_ID && TOKEN); }

// South African numbers arrive as 082…, 082 123 4567, +27 82…, 2782… — normalise to E.164
// digits (no plus), which is what the Cloud API expects in the `to` field.
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('27') && d.length === 11) return d;
  if (d.startsWith('0') && d.length === 10) return '27' + d.slice(1);
  if (d.length === 9) return '27' + d; // typed without the leading zero
  if (d.length >= 10 && d.length <= 15) return d; // already international
  return null;
}

function log(userId, phone, template, status, detail) {
  db.prepare(`INSERT INTO whatsapp_log (user_id, phone, template, status, detail)
    VALUES (?, ?, ?, ?, ?)`).run(userId ?? null, phone || '', template, status, detail ? String(detail).slice(0, 500) : null);
}

// Send one template message. Resolves to { ok, status } and never throws at the caller:
// a failed alert must not take down dispatch.
async function sendTemplate({ userId, phone, template, bodyParams = [], urlSuffix = null }) {
  const to = toE164(phone);
  if (!to) { log(userId, phone, template, 'bad_number', 'Could not normalise to E.164'); return { ok: false, status: 'bad_number' }; }

  const components = [];
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) });
  }
  if (urlSuffix !== null) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(urlSuffix) }] });
  }
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: template, language: { code: LANG }, components },
  };

  if (!configured()) {
    log(userId, to, template, 'dry_run', JSON.stringify(bodyParams));
    console.log(`[FreshAF][whatsapp:dry-run] ${template} -> +${to} :: ${bodyParams.join(' | ')}`);
    return { ok: true, status: 'dry_run' };
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      log(userId, to, template, 'failed', msg);
      console.warn(`[FreshAF][whatsapp] ${template} -> +${to} failed: ${msg}`);
      return { ok: false, status: 'failed', error: msg };
    }
    log(userId, to, template, 'sent', data?.messages?.[0]?.id || null);
    return { ok: true, status: 'sent', id: data?.messages?.[0]?.id };
  } catch (e) {
    log(userId, to, template, 'failed', e.message);
    return { ok: false, status: 'failed', error: e.message };
  }
}

// Template: freshaf_job_alert — see WHATSAPP-SETUP.md for the exact body registered with Meta.
// Variables, in order: {{1}} service, {{2}} what the pro earns, {{3}} distance, {{4}} suburb/address,
// {{5}} minutes to respond. The URL button appends the offer id to https://freshaf.io/supplier?offer=
function jobAlert({ userId, phone, service, earnsRand, distanceKm, address, expiresMin, offerId }) {
  return sendTemplate({
    userId,
    phone,
    template: TPL_JOB,
    bodyParams: [service, `R${earnsRand}`, `${distanceKm} km`, address, String(expiresMin)],
    urlSuffix: String(offerId),
  });
}

// Template: freshaf_verify_code (Authentication category, copy-code button).
function verifyCode({ userId, phone, code }) {
  return sendTemplate({ userId, phone, template: TPL_CODE, bodyParams: [code], urlSuffix: null });
}

function status() {
  const recent = db.prepare(`SELECT status, COUNT(*) c FROM whatsapp_log
    WHERE created_at > datetime('now','-1 day') GROUP BY status`).all();
  return {
    configured: configured(),
    enabled: getSetting('whatsapp_alerts_enabled', '1') === '1',
    templates: { job: TPL_JOB, code: TPL_CODE, lang: LANG },
    last_24h: Object.fromEntries(recent.map((r) => [r.status, r.c])),
  };
}

module.exports = { configured, toE164, jobAlert, verifyCode, sendTemplate, status };
