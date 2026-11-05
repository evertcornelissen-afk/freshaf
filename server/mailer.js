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

// Whether mail actually works, proven at boot by signing in to the mail server. "The
// password is set" and "email is being delivered" are different statements: a mistyped
// password looks identical to a correct one until a customer's reset email never arrives.
// The result goes in the log, where it can be checked without anyone needing an account,
// and on the admin readiness screen.
let health = transport
  ? { ok: false, detail: 'Checking the mail server sign-in...' }
  : { ok: false, detail: 'Dry run. Set SMTP_PASS (the admin@freshaf.io mailbox password) on Render.' };

if (transport) {
  transport.verify()
    .then(() => {
      health = { ok: true, detail: `Signed in to ${HOST} as ${USER}. Account emails are being sent.` };
      console.log(`[FreshAF][mail] LIVE: signed in to ${HOST}:${PORT} as ${USER}`);
    })
    .catch((e) => {
      health = { ok: false, detail: `Mail server sign-in FAILED (${e.code || 'error'}): ${e.message}` };
      console.error(`[FreshAF][mail] NOT WORKING: could not sign in to ${HOST}:${PORT} as ${USER}: ${e.message}`);
    });
} else {
  console.warn('[FreshAF][mail] DRY RUN: SMTP_PASS is not set, no email will be sent');
}

function status() { return health; }

// a***@gmail.com: enough to match a support query to a log line, without the log
// becoming a list of customer email addresses.
const mask = (addr) => String(addr).replace(/^(.)[^@]*(@.*)$/, '$1***$2');

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
    // Local development: MAIL_PREVIEW_DIR=some/folder saves each email as an .html file
    // to open in a browser, so a template can be looked at without sending anything.
    if (process.env.MAIL_PREVIEW_DIR) {
      try {
        const fs = require('fs');
        const path = require('path');
        fs.mkdirSync(process.env.MAIL_PREVIEW_DIR, { recursive: true });
        const name = `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.html`;
        fs.writeFileSync(path.join(process.env.MAIL_PREVIEW_DIR, name), html);
      } catch { /* preview only */ }
    }
    console.log(`[FreshAF][mail:dry-run] ${subject} -> ${to}`);
    return { ok: true, status: 'dry_run' };
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, html, text });
    console.log(`[FreshAF][mail] sent: ${subject} -> ${mask(to)}`);
    return { ok: true, status: 'sent' };
  } catch (e) {
    console.warn(`[FreshAF][mail] FAILED: ${subject} -> ${mask(to)}: ${e.message}`);
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

const rand = (cents) => `R${(Math.round(Number(cents) || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const firstName = (name) => esc(String(name || '').split(' ')[0] || 'there');
const row = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#5b7480;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`;

function bookingConfirmed(o) {
  const when = o.scheduledFor ? esc(o.scheduledFor) : 'As soon as possible';
  const pay = o.paymentMethod === 'cash'
    ? `${rand(o.totalCents - o.pointsUsedCents)}, paid in cash to your pro when the job is done`
    : `${rand(o.totalCents - o.pointsUsedCents)}, paid by card`;
  return send({
    to: o.to,
    subject: `Booked: ${o.service} #${o.orderId}`,
    heading: 'Your booking is confirmed',
    paragraphs: [
      `Hi ${firstName(o.name)},`,
      `Your pro has accepted the job. You can follow them live in the app, from on the way to done.`,
      `<table cellpadding="0" cellspacing="0" style="font-size:14px">${[
        row('Order', `#${o.orderId}`),
        row('Service', esc(`${o.service}: ${o.pkg}, ${o.unit}`)),
        row('Pro', esc(o.proName || 'Your FreshAF pro')),
        row('Where', esc(o.address)),
        row('When', when),
        row('Price', pay),
      ].join('')}</table>`,
      'Need to change something? Reply to this email or cancel in the app before your pro is on the way.',
    ],
    cta: { label: 'Track my order', url: `${BASE}/?track=${o.orderId}` },
  });
}

// A receipt, never a tax invoice, and no VAT line. FreshAF is not VAT-registered (confirmed
// by Evert, 5 Nov 2026), and a business that is not a VAT vendor may not issue a tax invoice
// or show VAT. If FreshAF registers, this and terms section 3 change together: the words
// "tax invoice", the VAT number, and the VAT amount shown separately.
function receipt(o) {
  const paid = o.totalCents - o.pointsUsedCents;
  const lines = [
    row('Receipt for order', `#${o.orderId}`),
    row('Date', esc(String(o.completedAt || '').slice(0, 16) || new Date().toISOString().slice(0, 16).replace('T', ' '))),
    row('Service', esc(`${o.service}: ${o.pkg}, ${o.unit}`)),
    row('Done by', esc(o.proName || 'Your FreshAF pro')),
    row('Where', esc(o.address)),
    row('Price', rand(o.totalCents)),
  ];
  if (o.pointsUsedCents > 0) lines.push(row('Rewards used', `-${rand(o.pointsUsedCents)}`));
  lines.push(row('<strong>Paid</strong>', `<strong>${rand(paid)}</strong> ${o.paymentMethod === 'cash' ? '(cash, to your pro)' : '(card)'}`));
  if (o.pointsEarnedCents > 0) lines.push(row('Rewards earned', `${rand(o.pointsEarnedCents)} to spend on your next order`));
  return send({
    to: o.to,
    subject: `Receipt: ${o.service} #${o.orderId}`,
    heading: 'All done. Here is your receipt',
    paragraphs: [
      `Hi ${firstName(o.name)},`,
      'Thank you for using FreshAF. Your job is complete.',
      `<table cellpadding="0" cellspacing="0" style="font-size:14px">${lines.join('')}</table>`,
      'How did it go? Rate your pro in the app. It helps the best pros get more work.',
      '<span style="font-size:12px;color:#5b7480">FreshAF (Pty) Ltd, registration 2026/683087/07. FreshAF sells this service to you and pays the pro who carried it out.</span>',
    ],
    cta: { label: 'Rate your pro', url: `${BASE}/?track=${o.orderId}` },
  });
}

function orderCancelled({ to, name, orderId, by, reason, refundCents }) {
  const why = {
    expired: 'The card payment for it was not completed within the hour, so we released the booking.',
    admin: `FreshAF cancelled it${reason ? `: ${esc(reason)}` : '.'}`,
    customer: 'You cancelled it.',
    late_payment: 'Your card payment came through after the booking had already been released.',
  }[by] || 'It has been cancelled.';
  const paras = [`Hi ${firstName(name)},`, `Your FreshAF booking #${orderId} is cancelled. ${why}`];
  if (refundCents > 0) {
    paras.push(`<strong>${rand(refundCents)} is being refunded to your card.</strong> We will email you as soon as it is sent. Banks usually show it within 5 to 10 working days after that.`);
  } else if (by === 'expired') {
    paras.push('No money was taken. You can book again at any time.');
  }
  paras.push('Questions? Reply to this email.');
  return send({
    to, subject: `Cancelled: booking #${orderId}`, heading: 'Your booking is cancelled', paragraphs: paras,
    cta: { label: 'Book again', url: `${BASE}/` },
  });
}

function noProAvailable({ to, name, orderId, service }) {
  return send({
    to,
    subject: `No pro available yet: ${service} #${orderId}`,
    heading: 'Your pro could not take this one',
    paragraphs: [
      `Hi ${firstName(name)},`,
      `The pro you chose for booking #${orderId} could not take it right now. Nothing has been charged for the job itself.`,
      'Open your booking to try again, or pick another pro near you.',
    ],
    cta: { label: 'Open my booking', url: `${BASE}/?track=${orderId}` },
  });
}

function refundSent({ to, name, orderId, refundCents }) {
  return send({
    to,
    subject: `Refund sent: booking #${orderId}`,
    heading: 'Your refund is on its way',
    paragraphs: [
      `Hi ${firstName(name)},`,
      `We have refunded <strong>${rand(refundCents)}</strong> for booking #${orderId} to the card you paid with. Banks usually show it within 5 to 10 working days.`,
      'Questions? Reply to this email.',
    ],
  });
}

// The morning summary to the FreshAF inbox; see server/daily-summary.js. The lines are
// built there from figures and fixed wording, so they are passed through as HTML.
function adminDigest({ subject, paragraphs }) {
  return send({ to: ADMIN_TO, subject: `[FreshAF] ${subject}`, heading: 'Daily summary', paragraphs });
}

// Operational alerts to the FreshAF inbox: refunds owed, payments that need a person.
function adminAlert({ subject, lines }) {
  return send({ to: ADMIN_TO, subject: `[FreshAF] ${subject}`, heading: subject, paragraphs: lines.map(esc) });
}

function passwordReset({ to, name, url, minutes }) {
  return send({
    to,
    subject: 'Reset your FreshAF password',
    heading: 'Choose a new password',
    paragraphs: [
      `Hi ${esc(String(name || '').split(' ')[0] || 'there')},`,
      'Someone, hopefully you, asked to reset the password on your FreshAF account. Use the button below to choose a new one. You keep your account, your bookings and your reward points.',
      `The link works once and expires in ${Number(minutes) || 30} minutes.`,
      'If you did not ask for this, ignore this email. Your password has not changed and nobody can change it without this link.',
    ],
    cta: { label: 'Choose a new password', url },
  });
}

// Sent after every successful reset, so a reset the owner did not make does not go unseen.
function passwordChanged({ to, name }) {
  return send({
    to,
    subject: 'Your FreshAF password was changed',
    heading: 'Your password was changed',
    paragraphs: [
      `Hi ${esc(String(name || '').split(' ')[0] || 'there')},`,
      'The password on your FreshAF account was just changed, and every other device signed in to your account has been signed out.',
      'If this was you, there is nothing more to do.',
      'If it was <strong>not</strong> you, reset your password straight away using the button below, and email <a href="mailto:admin@freshaf.io">admin@freshaf.io</a> so we can check your account.',
    ],
    cta: { label: 'Reset my password', url: `${BASE}/reset-password` },
  });
}

// layout is exported so an email can be rendered and looked at before it is sent.
module.exports = { layout, configured, status, send, proApplicationReceived, proStatusChanged, adminNewPro,
  passwordReset, passwordChanged, bookingConfirmed, receipt, orderCancelled, noProAvailable, refundSent, adminAlert, adminDigest };
