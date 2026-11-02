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

function prune() {
  const files = fs.readdirSync(OUT_DIR)
    .filter((f) => /^freshaf-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse();
  for (const f of files.slice(KEEP)) {
    fs.unlinkSync(path.join(OUT_DIR, f));
    info(`pruned ${f}`);
  }
  return files.length;
}

async function remote(dest) {
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
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    throw new Error(`backup download failed (${r.status}) — is that account an admin?`);
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
    process.exitCode = 1;
    return;
  }
  let counts;
  try {
    counts = verify(dest);
  } catch (e) {
    cross(`The backup is not usable: ${e.message}`);
    try { fs.unlinkSync(dest); } catch {}
    process.exitCode = 1;
    return;
  }
  const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
  tick(`${path.basename(dest)} — ${mb} MB`);
  info(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '));
  const total = prune();
  info(`${Math.min(total, KEEP)} backup${total === 1 ? '' : 's'} in ${OUT_DIR}`);
  console.log('');
})();
