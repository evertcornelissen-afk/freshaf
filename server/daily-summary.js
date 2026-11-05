// The morning email to the FreshAF inbox: what happened yesterday, and what needs a person
// today. Sent once a day at 07:00 South African time. The date it last went out is stored
// in settings, so a restart or a deploy at 07:05 never sends it twice, and a server that
// was down at 07:00 sends it as soon as it is back.
//
// Every figure excludes demo accounts (the real_orders / real_suppliers views).
const { db, getSetting, setSetting } = require('./db');
const balance = require('./balance');

const SEND_HOUR_SAST = 7;
const rand = (c) => `R${(Math.round(Number(c) || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

// South Africa is UTC+2 all year (no daylight saving), and the database stores UTC.
const sastNow = () => new Date(Date.now() + 2 * 3600_000);
const sastDate = (d) => d.toISOString().slice(0, 10);

function build(day) {
  const onDay = (col) => `date(${col}, '+2 hours') = '${day}'`;
  const one = (sql) => db.prepare(sql).get();
  const all = (sql) => db.prepare(sql).all();

  const created = one(`SELECT COUNT(*) c FROM real_orders WHERE ${onDay('created_at')}`).c;
  const done = one(`SELECT COUNT(*) c, COALESCE(SUM(price_cents - COALESCE(points_used_cents,0)),0) takings,
    COALESCE(SUM(commission_cents),0) margin,
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN price_cents - COALESCE(points_used_cents,0) END),0) cash
    FROM real_orders WHERE status = 'completed' AND ${onDay('completed_at')}`);
  const cancelled = all(`SELECT COALESCE(cancelled_by, 'unknown') who, COUNT(*) c FROM real_orders
    WHERE status = 'cancelled' AND ${onDay('COALESCE(cancelled_at, created_at)')} GROUP BY 1`);
  const signups = one(`SELECT COUNT(*) c FROM users WHERE role = 'customer' AND is_demo = 0 AND ${onDay('created_at')}`).c;
  const proApps = one(`SELECT COUNT(*) c FROM real_suppliers WHERE ${onDay('created_at')}`).c;

  // ---- needs a person ----
  const refunds = all(`SELECT id, refund_due_cents, cancelled_by FROM real_orders WHERE refund_due_cents > 0 ORDER BY id`);
  const stuckSearching = all(`SELECT id FROM real_orders WHERE status = 'searching'
    AND created_at < datetime('now', '-30 minutes')`);
  const stuckAccepted = all(`SELECT id FROM real_orders WHERE status IN ('accepted','en_route')
    AND scheduled_for IS NULL AND accepted_at < datetime('now', '-4 hours')`);
  const stuckWorking = all(`SELECT id FROM real_orders WHERE status = 'in_progress'
    AND accepted_at < datetime('now', '-8 hours')`);
  const pendingPros = one(`SELECT COUNT(*) c FROM real_suppliers WHERE status = 'pending'`).c;
  const blocked = [...balance.blockedSupplierIds()];
  const cashHeld = db.prepare(`SELECT user_id FROM real_suppliers WHERE status = 'approved'`).all()
    .reduce((sum, r) => sum + (balance.cashOwed(r.user_id) || 0), 0);
  const approved = one(`SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved'`).c;
  const online = one(`SELECT COUNT(*) c FROM real_suppliers WHERE status = 'approved' AND online = 1`).c;

  const todo = [];
  if (refunds.length) {
    todo.push(`<strong>${refunds.length} refund${refunds.length === 1 ? '' : 's'} owed, ${rand(refunds.reduce((s, r) => s + r.refund_due_cents, 0))}:</strong> `
      + refunds.map((r) => `#${r.id} (${rand(r.refund_due_cents)})`).join(', ')
      + '. Refund in the Stitch dashboard, then press Mark refunded in the admin app.');
  }
  if (stuckSearching.length) todo.push(`<strong>Waiting over 30 min for a pro:</strong> ${stuckSearching.map((r) => `#${r.id}`).join(', ')}.`);
  if (stuckAccepted.length) todo.push(`<strong>Accepted over 4 h ago and not started:</strong> ${stuckAccepted.map((r) => `#${r.id}`).join(', ')}. Call the pro.`);
  if (stuckWorking.length) todo.push(`<strong>Marked in progress for over 8 h:</strong> ${stuckWorking.map((r) => `#${r.id}`).join(', ')}. Probably finished but not closed.`);
  if (blocked.length) todo.push(`<strong>${blocked.length} pro${blocked.length === 1 ? '' : 's'} blocked at the cash limit.</strong> Collect and press Settle cash.`);
  if (pendingPros) todo.push(`<strong>${pendingPros} pro application${pendingPros === 1 ? '' : 's'} waiting</strong> for review.`);

  const cancelText = cancelled.length
    ? cancelled.map((r) => `${r.c} by ${r.who}`).join(', ')
    : 'none';
  const row = (k, v) => `<tr><td style="padding:3px 16px 3px 0;color:#5b7480">${k}</td><td style="padding:3px 0">${v}</td></tr>`;
  const table = `<table cellpadding="0" cellspacing="0" style="font-size:14px">${[
    row('Orders placed', created),
    row('Jobs completed', done.c),
    row('Takings', `${rand(done.takings)} <span style="color:#5b7480">(${rand(done.cash)} of it in cash, held by pros)</span>`),
    row('FreshAF margin', rand(done.margin)),
    row('Cancelled', cancelText),
    row('New customers', signups),
    row('New pro applications', proApps),
  ].join('')}</table>`;
  const now = `<table cellpadding="0" cellspacing="0" style="font-size:14px">${[
    row('Approved pros', `${approved} (${online} online right now)`),
    row('Cash held by pros', rand(cashHeld)),
  ].join('')}</table>`;

  const headline = `${created} order${created === 1 ? '' : 's'}, ${rand(done.margin)} margin`
    + (todo.length ? `, ${todo.length} to do` : '');
  return {
    subject: `Daily summary ${day}: ${headline}`,
    lines: [
      `<strong>Yesterday, ${day}</strong>`,
      table,
      '<strong>Right now</strong>',
      now,
      todo.length ? '<strong>Needs you today</strong>' : '<strong>Nothing needs you today.</strong>',
      ...(todo.length ? [`<ul style="margin:0;padding-left:18px">${todo.map((x) => `<li style="margin-bottom:6px">${x}</li>`).join('')}</ul>`] : []),
    ],
    todo: todo.length,
  };
}

function send(day) {
  const s = build(day);
  return require('./mailer').adminDigest({ subject: s.subject, paragraphs: s.lines })
    .then((mail) => ({ ...s, mail }));
}

function tick() {
  try {
    const now = sastNow();
    if (now.getUTCHours() < SEND_HOUR_SAST) return;
    const today = sastDate(now);
    if (getSetting('daily_summary_sent_for') === today) return;
    setSetting('daily_summary_sent_for', today); // claim first, so two ticks cannot both send
    const yesterday = sastDate(new Date(now.getTime() - 24 * 3600_000));
    // The mailer never throws; it reports. A failed send releases the day so the next
    // check (ten minutes on) tries again, rather than the summary being lost for the day.
    const release = (why) => {
      setSetting('daily_summary_sent_for', '');
      console.warn(`[FreshAF] Daily summary for ${yesterday} not sent (${why}); will retry`);
    };
    send(yesterday)
      .then((s) => {
        if (s.mail && s.mail.status === 'failed') return release('mail server refused it');
        console.log(`[FreshAF] Daily summary ${s.mail?.status || 'sent'} for ${yesterday} (${s.todo} to do)`);
      })
      .catch((e) => release(e.message));
  } catch (e) {
    console.warn(`[FreshAF] Daily summary check failed: ${e.message}`);
  }
}

function start() {
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}

module.exports = { build, send, start, tick };
