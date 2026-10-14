// Transactional email (account lifecycle only — job alerts go over push and WhatsApp,
// because email is too slow for a 60-second offer).
// Sends through admin@freshaf.io on GoDaddy Professional Email. Until SMTP_PASS is set the
// mailer runs in dry run: every message is printed to the console instead of being sent,
// exactly like the WhatsApp module.
const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || 'smtpout.secureserver.net';
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || 'admin@freshaf.io';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || `FreshAF <${USER}>`;
const ADMIN_TO = process.env.ADMIN_NOTIFY_EMAIL || 'admin@freshaf.io';
const BASE = (process.env.BASE_URL || 'https://freshaf.io').replace(/\/$/, '');

function configured() { return !!PASS; }

const transport = configured()
  ? nodemailer.createTransport({ host: HOST, port: PORT, secure: PORT === 465, auth: { user: USER, pass: PASS } })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One branded shell for every message. Logo is the hosted PNG so it renders in every client
// (Gmail and Outlook do not display SVG).
function layout(heading, paragraphs, cta) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${cta.url}" style="background:#1799C2;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f2f6f7;font-family:Segoe UI,Arial,sans-serif;color:#12303a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6f7;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:3px solid #1799C2"><img src="${BASE}/img/logo-email.png" alt="FreshAF" height="34" style="display:block;height:34px"></td></tr>
<tr><td style="padding:26px 28px 10px"><h1 style="font-size:20px;margin:0 0 16px;color:#10424F">${esc(heading)}</h1>${body}${button}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#5b7480;border-top:1px solid #e3ecef">FreshAF (Pty) Ltd · Consider it done.<br>Questions: <a href="mailto:admin@freshaf.io" style="color:#1799C2">admin@freshaf.io</a></td></tr>
</table></td></tr></table></body></html>`;
}

// Never throws at the caller: a mail failure must not break registration or approval.
async function send({ to, subject, heading, paragraphs, cta }) {
  if (!to) return { ok: false, status: 'no_recipient' };
  const html = layout(heading, paragraphs, cta);
  const text = [heading, '', ...paragraphs.map((p) => p.replace(/<[^>]+>/g, '')), cta ? `${cta.label}: ${cta.url}` : ''].join('\n');
  if (!transport) {
    console.log(`[FreshAF][mail:dry-run] ${subject} -> ${to}`);
    return { ok: true, status: 'dry_run' };
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, html, text });
    return { ok: true, status: 'sent' };
  } catch (e) {
    console.warn(`[FreshAF][mail] ${subject} -> ${to} failed: ${e.message}`);
    return { ok: false, status: 'failed' };
  }
}

const SERVICE_LABEL = { carwash: 'Car wash', laundry: 'Laundry' };

function proApplicationReceived({ to, name }) {
  return send({
    to, subject: 'We have your FreshAF Pro application',
    heading: `Thanks, ${esc(name)}. Your application is in.`,
    paragraphs: [
      'Here is what happens next:',
      '<b>1. Upload your documents</b> in FreshAF Pro if you have not yet: your ID, proof of address, bank confirmation letter and a police clearance certificate.',
      '<b>2. We review your application</b>, usually within two working days. We may call you to confirm a few details.',
      '<b>3. You get an email and a notification</b> the moment you are approved. Then set your prices, switch on alerts and go online.',
      'Tip: open FreshAF Pro on your phone and choose <b>Add to Home Screen</b>, then allow notifications. That is how job offers reach you.',
    ],
    cta: { label: 'Open FreshAF Pro', url: `${BASE}/supplier` },
  });
}

function proStatusChanged({ to, name, status, reason }) {
  if (status === 'approved') {
    return send({
      to, subject: 'You are approved on FreshAF Pro',
      heading: `Welcome aboard, ${esc(name)}.`,
      paragraphs: [
        'Your FreshAF Pro account is approved. To start receiving jobs:',
        '<b>1.</b> Set your prices for each package (or quote per job).',
        '<b>2.</b> Turn on notifications, and verify your WhatsApp number for job alerts.',
        '<b>3.</b> Go online. Jobs near you arrive as an alert; accept them before the timer runs out.',
      ],
      cta: { label: 'Go online now', url: `${BASE}/supplier` },
    });
  }
  const verb = status === 'suspended' ? 'suspended' : 'not approved';
  return send({
    to, subject: `Your FreshAF Pro application: ${verb}`,
    heading: status === 'suspended' ? 'Your account has been suspended' : 'We could not approve your application yet',
    paragraphs: [
      reason ? `Reason: ${esc(reason)}` : 'We could not verify everything we need.',
      'If you can fix this (for example by uploading a missing document), reply to this email and we will look again.',
    ],
    cta: { label: 'Open FreshAF Pro', url: `${BASE}/supplier` },
  });
}

function adminNewPro({ name, business, email, phone, services }) {
  return send({
    to: ADMIN_TO, subject: `New pro application: ${business}`,
    heading: 'A new pro has applied',
    paragraphs: [
      `<b>${esc(business)}</b> (${esc(name)})`,
      `Services: ${services.map((s) => SERVICE_LABEL[s] || s).join(', ')}`,
      `Email: ${esc(email)}${phone ? ` · Phone: ${esc(phone)}` : ''}`,
      'Review their documents and approve or reject them in the admin console.',
    ],
    cta: { label: 'Review applications', url: `${BASE}/admin` },
  });
}

module.exports = { configured, send, proApplicationReceived, proStatusChanged, adminNewPro };
