// A second person who can approve pros and read ID numbers and bank details.
//
// Tested hard because every failure here is an access-control failure. The one that
// nearly shipped: the boot-time admin seeding picked `WHERE role = 'admin' LIMIT 1` with
// no ORDER BY, so once a second admin existed SQLite could hand back the NEW person's
// row — and the seeding would then overwrite their password with ADMIN_PASSWORD and
// rename their sign-in to ADMIN_EMAIL. The owner would be locked out of their own
// dashboard by a restart, with nothing in the logs to explain it. The last test here
// restarts the server with a second admin present and checks exactly that.
const { spawn } = require('child_process');
const path = require('path');
const { stopServer } = require('./stop-server');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-admin-accounts-'));
const PORT = 5764;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'test-admin-key-for-accounts';
const OWNER_EMAIL = 'owner@freshaf.co.za';
const OWNER_PASSWORD = 'Owner!Passw0rd2026';

const env = {
  ...process.env, PORT: String(PORT), ADMIN_API_KEY: ADMIN_KEY,
  ADMIN_EMAIL: OWNER_EMAIL, ADMIN_PASSWORD: OWNER_PASSWORD,
  FRESHAF_DATA_DIR: DATA_DIR, SMTP_PASS: '', WHATSAPP_VERIFY_CODES: 'off',
};

const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}`);
};
const jsonOf = async (res) => { try { return await res.json(); } catch { return {}; } };

function jar() {
  const cookies = new Map();
  return {
    take(res) {
      for (const raw of res.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(';');
        const i = pair.indexOf('=');
        if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      return res;
    },
    header() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; '); },
  };
}
async function call(p, { method = 'GET', body, cookies, extra = {} } = {}) {
  const headers = { ...extra };
  if (cookies) headers.cookie = cookies.header();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (cookies) cookies.take(res);
  return res;
}
async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${BASE}/api/pricing`); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
}
async function signIn(email, password) {
  const c = jar();
  const r = await call('/api/auth/login', { method: 'POST', cookies: c, body: { email, password } });
  return { jar: c, status: r.status, body: await jsonOf(r) };
}

(async () => {
  let server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  try {
    await waitUp();

    // ---- the owner signs in -------------------------------------------------
    const owner = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
    check('the owner can sign in', owner.status, 200);
    check('  and is not asked to change their password', owner.body.user?.must_change_password, false);
    const KEY = { 'x-admin-key': ADMIN_KEY };
    const get = (p) => call(p, { cookies: owner.jar, extra: KEY });
    const post = (p, body) => call(p, { method: 'POST', cookies: owner.jar, extra: KEY, body: body || {} });

    check('one admin to start with', (await jsonOf(await get('/api/admin/admins'))).admins.length, 1);

    // ---- inviting a second admin -------------------------------------------
    const bad = await post('/api/admin/admins', { name: 'Nikki', email: 'not-an-email' });
    check('a bad email is refused', bad.status, 400);
    const noName = await post('/api/admin/admins', { name: '', email: 'nikki@example.com' });
    check('a missing name is refused', noName.status, 400);

    const made = await post('/api/admin/admins', { name: 'Nikki', email: 'Nikki@Example.com' });
    check('a second admin is created', made.status, 200);
    const invite = await jsonOf(made);
    check('  the email is stored lower-case', invite.email, 'nikki@example.com');
    check('  a temporary password is returned once', typeof invite.password === 'string' && invite.password.length >= 16, true);

    const dup = await post('/api/admin/admins', { name: 'Nikki again', email: 'nikki@example.com' });
    check('the same address cannot be added twice', dup.status, 409);

    const list = (await jsonOf(await get('/api/admin/admins'))).admins;
    check('both admins are listed', list.length, 2);
    check('  the owner is marked as you', list.find((a) => a.email === OWNER_EMAIL)?.is_you, true);
    check('  the new one is flagged as not yet signed in',
      list.find((a) => a.email === 'nikki@example.com')?.pending_first_sign_in, true);
    check('  and records who added her', list.find((a) => a.email === 'nikki@example.com')?.invited_by, 'FreshAF Admin');
    check('no password is ever listed', list.some((a) => 'password' in a || 'password_hash' in a), false);

    // ---- an admin who sets the password themselves --------------------------
    const shortChosen = await post('/api/admin/admins', { name: 'Shorty', email: 'short@example.com', password: 'abc' });
    check('a chosen password under 12 characters is refused', shortChosen.status, 400);

    const chosenMade = await post('/api/admin/admins', {
      name: 'Chosen', email: 'chosen@example.com', password: 'EvertPicksThis1!',
    });
    check('an admin can be created with a chosen password', chosenMade.status, 200);
    check('  and the response says it was chosen', (await jsonOf(chosenMade)).chosen, true);
    const chosenLogin = await signIn('chosen@example.com', 'EvertPicksThis1!');
    check('  they sign in with it straight away', chosenLogin.status, 200);
    check('  and are NOT forced to change it', chosenLogin.body.user?.must_change_password, false);

    // ---- she signs in and must replace the password -------------------------
    const nikki = await signIn('nikki@example.com', invite.password);
    check('she can sign in with the temporary password', nikki.status, 200);
    check('  and is told to change it', nikki.body.user?.must_change_password, true);
    check('  capitals in the address still work',
      (await signIn('NIKKI@example.com', invite.password)).status, 200);

    const nPost = (p, body) => call(p, { method: 'POST', cookies: nikki.jar, extra: KEY, body: body || {} });

    const wrongCurrent = await nPost('/api/auth/admin-password', { current: 'nonsense', next: 'aVeryLongNewOne1' });
    check('changing with the wrong current password is refused', wrongCurrent.status, 401);
    const tooShort = await nPost('/api/auth/admin-password', { current: invite.password, next: 'short1' });
    check('a short password is refused', tooShort.status, 400);
    const same = await nPost('/api/auth/admin-password', { current: invite.password, next: invite.password });
    check('reusing the same password is refused', same.status, 400);

    const changed = await nPost('/api/auth/admin-password', { current: invite.password, next: 'NikkiOwnPassw0rd!' });
    check('she sets her own password', changed.status, 200);
    check('the temporary password stops working', (await signIn('nikki@example.com', invite.password)).status, 401);
    const nikki2 = await signIn('nikki@example.com', 'NikkiOwnPassw0rd!');
    check('the new one works', nikki2.status, 200);
    check('  and she is no longer nagged', nikki2.body.user?.must_change_password, false);
    check("the owner's password is untouched", (await signIn(OWNER_EMAIL, OWNER_PASSWORD)).status, 200);

    // ---- she has real admin powers, under her own name ----------------------
    const n2 = (p) => call(p, { cookies: nikki2.jar, extra: KEY });
    check('she can read the applications', (await n2('/api/admin/suppliers')).status, 200);

    // ---- guard rails ---------------------------------------------------------
    const me = (await jsonOf(await get('/api/admin/admins'))).admins.find((a) => a.is_you);
    check('you cannot remove your own access', (await post(`/api/admin/admins/${me.id}/remove`)).status, 409);

    // ---- a restart must not hijack her account ------------------------------
    // The bug this guards: boot-time seeding picking the wrong admin row and resetting it.
    await stopServer(server);
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { log += d; });
    server.stderr.on('data', (d) => { log += d; });
    await waitUp();

    check('AFTER A RESTART her own password still works',
      (await signIn('nikki@example.com', 'NikkiOwnPassw0rd!')).status, 200);
    check('  and she was NOT reset to the owner password',
      (await signIn('nikki@example.com', OWNER_PASSWORD)).status, 401);
    const after = (await jsonOf(await call('/api/admin/admins', {
      cookies: (await signIn(OWNER_EMAIL, OWNER_PASSWORD)).jar, extra: KEY,
    }))).admins;
    check('  her sign-in address was not renamed to the owner address',
      after.filter((a) => a.email === OWNER_EMAIL).length, 1);
    check('  every admin survives the restart',
      after.map((a) => a.email).sort(),
      ['chosen@example.com', 'nikki@example.com', OWNER_EMAIL].sort());

    // ---- removing access -----------------------------------------------------
    const owner2 = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
    const nikkiRow = after.find((a) => a.email === 'nikki@example.com');
    const removed = await call(`/api/admin/admins/${nikkiRow.id}/remove`, {
      method: 'POST', cookies: owner2.jar, extra: KEY, body: {},
    });
    check('access can be removed', removed.status, 200);
    check('  she can no longer sign in', (await signIn('nikki@example.com', 'NikkiOwnPassw0rd!')).status, 401);
    const left = (await jsonOf(await call('/api/admin/admins', { cookies: owner2.jar, extra: KEY }))).admins;
    check('  she is gone from the list', left.some((a) => a.email === 'nikki@example.com'), false);
    check('  everyone else remains', left.map((a) => a.email).sort(), ['chosen@example.com', OWNER_EMAIL].sort());

    // Down to one, so the last-admin guard is actually being tested.
    const chosenRow = left.find((a) => a.email === 'chosen@example.com');
    await call(`/api/admin/admins/${chosenRow.id}/remove`, { method: 'POST', cookies: owner2.jar, extra: KEY, body: {} });
    // ---- removed, then added back ------------------------------------------
    // The guard only looked at role, and a removed admin keeps role = 'admin'. That
    // refused the address forever after a removal: no way to undo, and no way to
    // re-create the account someone had just deleted by mistake.
    const back = await post('/api/admin/admins', {
      name: 'Nikki', email: 'nikki@example.com', password: 'SheIsBackAgain1!',
    });
    check('a removed admin can be added back', back.status, 200);
    check('  and it says it reinstated them', (await jsonOf(back)).reinstated, true);
    const backIn = await signIn('nikki@example.com', 'SheIsBackAgain1!');
    check('  they can sign in again', backIn.status, 200);
    const stillOne = (await jsonOf(await call('/api/admin/admins', { cookies: owner2.jar, extra: KEY }))).admins;
    check('  and they appear once, not twice',
      stillOne.filter((a) => a.email === 'nikki@example.com').length, 1);
    // Remove her again so the last-admin guard below is still meaningful.
    const nikkiAgain = stillOne.find((a) => a.email === 'nikki@example.com');
    await call(`/api/admin/admins/${nikkiAgain.id}/remove`, { method: 'POST', cookies: owner2.jar, extra: KEY, body: {} });

    // ---- a chosen password on reset ----------------------------------------
    const ownerRow = (await jsonOf(await call('/api/admin/admins', { cookies: owner2.jar, extra: KEY }))).admins
      .find((a) => a.email === OWNER_EMAIL);
    check('an active admin cannot be added again', (await post('/api/admin/admins',
      { name: 'Dup', email: OWNER_EMAIL })).status, 409);
    check('  and the refusal says to use the password button instead',
      /New password/.test((await jsonOf(await post('/api/admin/admins', { name: 'Dup', email: OWNER_EMAIL }))).error), true);

    const lastOne = (await jsonOf(await call('/api/admin/admins', { cookies: owner2.jar, extra: KEY }))).admins[0];
    check('  only the owner is left', lastOne.email, OWNER_EMAIL);
    check('the last admin cannot be removed either', (await call(`/api/admin/admins/${lastOne.id}/remove`, {
      method: 'POST', cookies: owner2.jar, extra: KEY, body: {},
    })).status, 409);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
    if (passed !== checks.length) {
      console.log('\n--- server log ---\n' + log.slice(-2500));
      process.exitCode = 1;
    }
  } catch (e) {
    console.log('FAIL  threw: ' + e.message);
    console.log('\n--- server log ---\n' + log.slice(-2500));
    process.exitCode = 1;
  } finally {
    await stopServer(server);
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
})();
