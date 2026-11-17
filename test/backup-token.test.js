// The off-site backup route (/api/backup): only the backup token opens it, and what it
// returns is a complete, consistent copy of the database. Also runs scripts/backup.js
// against it, so the nightly job is tested exactly as it runs.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stopServer } = require('./stop-server');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 5762;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = crypto.randomBytes(32).toString('base64url');

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BACKUP_TOKEN: TOKEN, SMTP_PASS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`);
  };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-backup-'));
  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    const status = async (headers) => (await fetch(`${BASE}/api/backup`, { headers })).status;
    check('no token is refused (404)', await status({}) === 404);
    check('wrong token is refused (404)', await status({ Authorization: 'Bearer ' + 'x'.repeat(TOKEN.length) }) === 404);
    check('token of the wrong length is refused (404)', await status({ Authorization: 'Bearer abc' }) === 404);

    const r = await fetch(`${BASE}/api/backup`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    check('right token downloads a SQLite file', r.status === 200 && buf.toString('utf8', 0, 15) === 'SQLite format 3', r.status);
    const file = path.join(out, 'direct.db');
    fs.writeFileSync(file, buf);
    const copy = new DatabaseSync(file, { readOnly: true });
    const live = new DatabaseSync(path.join(ROOT, 'data', 'freshaf.db'), { readOnly: true });
    const tables = live.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
    const diffs = tables.filter((t) => live.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c !== copy.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
    check(`every table matches the live database (${tables.length} tables)`, diffs.length === 0, diffs);
    check('the copy passes SQLite integrity check', copy.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
    copy.close(); live.close();
    check('no temporary file left on the server', !fs.readdirSync(path.join(ROOT, 'data')).some((f) => f.startsWith('backup-download-')));

    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'backup.js')], {
      env: { ...process.env, BACKUP_URL: BASE, BACKUP_TOKEN: TOKEN, BACKUP_DIR: out, BACKUP_EMAIL: '', BACKUP_PASSWORD: '' },
      encoding: 'utf8',
    });
    const made = fs.readdirSync(out).filter((f) => /^freshaf-.*\.db$/.test(f));
    check('nightly script backs up with the token alone (no password)', run.status === 0 && made.length === 1, run.stdout.split('\n').find((l) => /OK|FAIL/.test(l)));
    check('nightly script writes LAST-BACKUP.txt saying OK', /^OK/.test(fs.readFileSync(path.join(out, 'LAST-BACKUP.txt'), 'utf8')));
  } catch (e) {
    console.error(e);
    results.push(false);
  } finally {
    await stopServer(server);
    fs.rmSync(out, { recursive: true, force: true });
    const passed = results.filter(Boolean).length;
    if (!results.every(Boolean)) console.log(log.split('\n').slice(-15).join('\n'));
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
