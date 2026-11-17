#!/usr/bin/env node
// Pull a verified backup of the FreshAF database.
//
//   npm run backup              download from the live site to ./backups
//   npm run backup -- --local   snapshot the database on THIS machine (run on the server)
//   npm run backup -- --keep 60 keep the newest 60 backups instead of 30
//
// Why this exists: the admin panel could already download a backup and stage a restore,
// but nothing ever MADE one. A restore path with no backups is half a bridge — it only
// helps if someone remembered to click the button. This is the half that can be put on
// a schedule and run from a machine that is not the server.
//
// Every backup is verified by opening it and counting rows. A backup nobody has opened
// is not a backup, it is a file.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const keepIdx = args.indexOf('--keep');
const KEEP = keepIdx >= 0 ? Number(args[keepIdx + 1]) || 30 : 30;

const BASE_URL = (process.env.BACKUP_URL || process.env.BASE_URL || 'https://freshaf.io').replace(/\/$/, '');
const EMAIL = process.env.BACKUP_EMAIL || process.env.ADMIN_EMAIL || '';
const PASSWORD = process.env.BACKUP_PASSWORD || process.env.ADMIN_PASSWORD || '';
// The live admin API also demands the admin key (server/routes/admin.js). Without it every
// admin call is answered 404, so a scheduled backup failed every single night.
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

const tick = (s) => console.log(`  \x1b[32mOK\x1b[0m   ${s}`);
const cross = (s) => console.log(`  \x1b[31mFAIL\x1b[0m ${s}`);
const info = (s) => console.log(`       ${s}`);

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

// A SQLite file that opens is not necessarily a file with your data in it. Count the
// rows that matter, so a silently truncated download is caught here and not during a
// cutover at midnight.
function verify(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error('not a SQLite file — the download probably returned an error page');
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const counts = {};
    for (const t of ['users', 'suppliers', 'orders', 'quotes', 'settings']) {
      try {
        counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      } catch {
        counts[t] = 'missing';
      }
    }
    if (counts.users === 'missing' || counts.orders === 'missing') {
      throw new Error('the expected tables are not in this file');
    }
    return counts;
  } finally {
    db.close();
  }
}

const BACKUP_RE = /^freshaf-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/;
const rows = (c) => (Number(c?.users) || 0) + (Number(c?.orders) || 0);

// The fullest backup on disk is never pruned. If the live data were ever wiped, every
// nightly backup after that would be empty, and plain "keep the newest 30" would quietly
// delete the last good copy a month later.
function fullest(files) {
  let best = null, bestRows = -1;
  for (const f of files) {
    try { const n = rows(verify(path.join(OUT_DIR, f))); if (n > bestRows) { best = f; bestRows = n; } } catch {}
  }
  return best;
}

// Status the owner can see without reading logs: LAST-BACKUP.txt always, and a loud
// BACKUP-FAILED.txt that stays until a backup succeeds again.
function status(ok, lines) {
  const text = [`${ok ? 'OK' : 'FAILED'}  ${new Date().toString()}`, ...lines, ''].join('\r\n');
  try {
    fs.writeFileSync(path.join(OUT_DIR, 'LAST-BACKUP.txt'), text);
    const failFile = path.join(OUT_DIR, 'BACKUP-FAILED.txt');
    if (ok) { if (fs.existsSync(failFile)) fs.unlinkSync(failFile); } else fs.writeFileSync(failFile, text);
  } catch { /* the console output still says it */ }
}

function prune() {
  const files = fs.readdirSync(OUT_DIR)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .reverse();
  const keepAlways = files.length > KEEP ? fullest(files) : null;
  for (const f of files.slice(KEEP)) {
    if (f === keepAlways) { info(`kept ${f} (the fullest backup on disk)`); continue; }
    fs.unlinkSync(path.join(OUT_DIR, f));
    info(`pruned ${f}`);
  }
  return files.length;
}

async function remote(dest) {
  // Preferred: the backup-only token (server/index.js /api/backup). No password involved,
  // so a changed admin password cannot break the nightly backup.
  if (process.env.BACKUP_TOKEN) {
    const r = await fetch(`${BASE_URL}/api/backup`, {
      headers: { Authorization: `Bearer ${process.env.BACKUP_TOKEN}` },
      signal: AbortSignal.timeout(180000),
    });
    if (r.ok) { fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); return; }
    if (r.status !== 404 || !EMAIL || !PASSWORD) {
      throw new Error(r.status === 404
        ? 'backup refused (404): BACKUP_TOKEN on Render is missing or does not match .env'
        : `backup download failed (${r.status})`);
    }
    info('BACKUP_TOKEN not accepted yet; trying the admin sign-in instead.');
  }
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set BACKUP_EMAIL and BACKUP_PASSWORD in .env (an admin login on the live site)');
  }
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(20000),
  });
  if (!login.ok) {
    throw new Error(`login failed (${login.status}) — check BACKUP_EMAIL / BACKUP_PASSWORD`);
  }
  const setCookie = login.headers.getSetCookie?.() || [login.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map((c) => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('the server did not return a session cookie');

  const r = await fetch(`${BASE_URL}/api/admin/backup`, {
    headers: { Cookie: cookie, ...(ADMIN_KEY ? { 'x-admin-key': ADMIN_KEY } : {}) },
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    throw new Error(r.status === 404
      ? 'backup download refused (404) — ADMIN_API_KEY in .env does not match the one on Render'
      : `backup download failed (${r.status}) — is that account an admin?`);
  }
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function local(dest) {
  const { db, checkpoint } = require(path.join(ROOT, 'server', 'db'));
  checkpoint();
  // VACUUM INTO is SQLite's own consistent-snapshot call. Copying the file by hand
  // while the server is writing can produce a file that opens and is missing rows.
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

(async () => {
  console.log(`\nFreshAF backup${LOCAL ? ' (local snapshot)' : ` from ${BASE_URL}`}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, `freshaf-${stamp()}.db`);
  if (fs.existsSync(dest)) {
    info('a backup for this minute already exists; nothing to do.');
    return;
  }
  try {
    if (LOCAL) local(dest); else await remote(dest);
  } catch (e) {
    cross(e.message);
    try { fs.unlinkSync(dest); } catch {}
    status(false, [e.message]);
    process.exitCode = 1;
    return;
  }
  let counts;
  try {
    counts = verify(dest);
  } catch (e) {
    cross(`The backup is not usable: ${e.message}`);
    try { fs.unlinkSync(dest); } catch {}
    status(false, [`The backup is not usable: ${e.message}`]);
    process.exitCode = 1;
    return;
  }
  // Data should only ever grow. A drop in accounts or orders since the last backup means
  // something deleted them, so say so loudly, and keep both files.
  let warning = null;
  const previous = fs.readdirSync(OUT_DIR).filter((f) => BACKUP_RE.test(f) && f !== path.basename(dest)).sort().pop();
  if (previous) {
    try {
      const before = verify(path.join(OUT_DIR, previous));
      // A customer deleting their own account is a normal small drop; losing more than
      // 2 rows or 5% of a table at once is not.
      const drop = (t) => Number(before[t]) - Number(counts[t]);
      const small = ['users', 'orders', 'suppliers'].filter((t) => drop(t) > 0 && drop(t) <= Math.max(2, before[t] * 0.05));
      if (small.length) info(`small drop since ${previous} (deleted accounts?): ${small.map((t) => `${t} -${drop(t)}`).join(', ')}`);
      const lost = ['users', 'orders', 'suppliers'].filter((t) => drop(t) > Math.max(2, before[t] * 0.05));
      if (lost.length) {
        warning = `LIVE DATA SHRANK since ${previous}: ` + lost.map((t) => `${t} ${before[t]} -> ${counts[t]}`).join(', ')
          + '. Nothing was deleted here; check the live site before the next release.';
        cross(warning);
      }
    } catch { /* an unreadable older file does not block today's backup */ }
  }
  const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
  tick(`${path.basename(dest)} — ${mb} MB`);
  info(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '));
  const total = prune();
  info(`${Math.min(total, KEEP)} backup${total === 1 ? '' : 's'} in ${OUT_DIR}`);
  status(!warning, [`${path.basename(dest)} (${mb} MB)`,
    Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '), ...(warning ? [warning] : [])]);
  console.log('');
})();
