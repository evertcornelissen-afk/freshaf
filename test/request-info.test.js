// Asking a pro for what is still missing, end to end.
//
// Worth a test because the failure modes are all silent and all land on a real applicant:
// a request that quietly rejects them instead of staying pending, an email listing items
// that differ from the tick list in their app, a bank letter or police clearance that the
// upload route refuses (which is how it shipped — the welcome email asked for two
// documents the database would not accept), or a request that never closes once everything
// has arrived, so a complete application sits in the queue looking incomplete.
const { spawn } = require('child_process');
const path = require('path');
const { stopServer } = require('./stop-server');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
// A throwaway database: this test creates accounts and approves them, which has no
// business happening in the real one.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshaf-request-info-'));
const PORT = 5761;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'test-admin-key-for-request-info';
const ADMIN_EMAIL = 'admin@freshaf.co.za';
const ADMIN_PASSWORD = 'FreshAF!Admin2026';
// A Luhn-valid SA ID number, so the automatic checks have something real to verify.
const ID_VALID = '9203045800084';

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env, PORT: String(PORT), ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_EMAIL, ADMIN_PASSWORD,
      FRESHAF_DATA_DIR: DATA_DIR,
      SMTP_PASS: '',                 // dry-run mail: nothing leaves the machine
      WHATSAPP_VERIFY_CODES: 'off',  // the sign-up code has its own test
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const checks = [];
  const check = (name, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    checks.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}`);
  };
  const jsonOf = async (res) => { try { return await res.json(); } catch { return {}; } };

  // The app signs in with an httpOnly cookie, so the test keeps one jar per account
  // exactly as a browser would.
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
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    });
    if (cookies) cookies.take(res);
    return res;
  }

  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }

    // ---- a pro applies -----------------------------------------------------
    const email = `pro-ri-${Date.now()}@example.com`;
    const pro = jar();
    const reg = await call('/api/auth/register', { method: 'POST', cookies: pro, body: {
      role: 'supplier', name: 'Thabo Mokoena', email, password: 'Str0ng!Passw0rd',
      phone: '0782991050', business_name: 'Mokoena Mobile Wash', id_number: ID_VALID,
      services: ['carwash'], service_area: 'Durbanville', accept_terms: true,
    } });
    check('pro application accepted', reg.status, 200);

    const mePro = async () => (await jsonOf(await call('/api/auth/me', { cookies: pro }))).user?.supplier;

    // ---- the pro's own checklist ------------------------------------------
    const docs0 = await jsonOf(await call('/api/supplier/documents', { cookies: pro }));
    const keys = (docs0.checklist || []).map((c) => c.key);
    check('checklist includes the bank letter', keys.includes('bank_letter'), true);
    check('checklist includes police clearance', keys.includes('police_clearance'), true);
    check('nothing requested yet', docs0.info_needed, []);

    // ---- admin signs in ----------------------------------------------------
    const admin = jar();
    const login = await call('/api/auth/login', { method: 'POST', cookies: admin,
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    check('admin signed in', login.status, 200);
    const KEY = { 'x-admin-key': ADMIN_KEY };
    const adminGet = (p) => call(p, { cookies: admin, extra: KEY });
    const adminPost = (p, body) => call(p, { method: 'POST', cookies: admin, extra: KEY, body: body || {} });

    const list1 = await jsonOf(await adminGet('/api/admin/suppliers?status=pending'));
    const mine = (list1.suppliers || []).find((s) => s.email === email);
    check('the application is visible to the admin', !!mine, true);
    check('required items are reported missing',
      (mine?.missing || []).slice().sort(), ['bank_details', 'bank_letter', 'id_copy', 'police_clearance']);

    const id = mine.user_id;

    // ---- admin asks for three of them --------------------------------------
    const ask = await adminPost(`/api/admin/suppliers/${id}/request-info`, {
      items: ['id_copy', 'bank_letter', 'police_clearance'],
      note: 'ID photo was too blurry to read',
    });
    check('request accepted', ask.status, 200);

    // An empty tick list is a mistake, not a no-op.
    const askNone = await adminPost(`/api/admin/suppliers/${id}/request-info`, { items: [] });
    check('an empty request is refused', askNone.status, 400);

    // ---- the pro is still pending, and now knows why -----------------------
    const s1 = await mePro();
    check('the pro is STILL pending, not rejected', s1?.status, 'pending');
    check('the pro sees what is outstanding',
      (s1?.info_needed || []).slice().sort(), ['bank_letter', 'id_copy', 'police_clearance']);
    check('the admin note reaches the pro', s1?.info_note, 'ID photo was too blurry to read');

    const docs1 = await jsonOf(await call('/api/supplier/documents', { cookies: pro }));
    const asked = (docs1.checklist || []).filter((c) => c.asked).map((c) => c.key).sort();
    check('the app tick list matches the request exactly', asked, ['bank_letter', 'id_copy', 'police_clearance']);
    check('every requested item carries instructions',
      (docs1.checklist || []).filter((c) => c.asked).every((c) => typeof c.ask === 'string' && c.ask.length > 20), true);

    // ---- the pro uploads them ----------------------------------------------
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64');
    async function uploadDoc(kind) {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', new Blob([png], { type: 'image/png' }), `${kind}.png`);
      const r = await call('/api/supplier/documents', { method: 'POST', cookies: pro, body: fd });
      return { status: r.status, body: await jsonOf(r) };
    }

    const up1 = await uploadDoc('id_copy');
    check('ID copy uploads', up1.status, 200);
    check('request stays open while items are outstanding', up1.body.request_settled, false);

    const up2 = await uploadDoc('bank_letter');
    check('BANK LETTER uploads (it could not before)', up2.status, 200);

    const up3 = await uploadDoc('police_clearance');
    check('POLICE CLEARANCE uploads (it could not before)', up3.status, 200);
    check('the last item closes the request', up3.body.request_settled, true);

    const s2 = await mePro();
    check('the pro no longer owes us anything', s2?.info_needed, []);
    check('still pending, now awaiting a decision', s2?.status, 'pending');

    // A kind nobody defined is still refused.
    const bad = await uploadDoc('passport_scan');
    check('an unknown document kind is refused', bad.status, 400);

    // ---- what the admin sees now -------------------------------------------
    const list2 = await jsonOf(await adminGet('/api/admin/suppliers?status=pending'));
    const mine2 = (list2.suppliers || []).find((s) => s.email === email);
    check('only the bank details are still outstanding', mine2?.missing, ['bank_details']);
    check('the closed request is gone from the dashboard', mine2?.info_needed, []);
    check('the uploaded documents are downloadable',
      (mine2?.documents || []).map((d) => d.kind).sort(), ['bank_letter', 'id_copy', 'police_clearance']);
    const docRes = await adminGet(`/api/admin/docs/${mine2.documents[0].id}`);
    check('a document streams to the reviewer', docRes.status, 200);

    // ---- the automatic background checks -----------------------------------
    // They run on sign-up without being asked for; recheck makes the assertion
    // deterministic rather than racing the unawaited call in the register route.
    const rc = await adminPost(`/api/admin/suppliers/${id}/recheck`);
    check('background checks can be re-run', rc.status, 200);
    const v = (await jsonOf(await adminGet('/api/admin/suppliers?status=pending')))
      .suppliers.find((x) => x.email === email)?.vetting;
    check('the application carries a vetting result', !!v, true);
    check('the ID number was checked automatically', v?.id_number?.ok, true);
    check('  and its date of birth was read', v?.id_number?.dob, '1992-03-04');
    check('no company number given reads as sole trader, not invalid', v?.company?.ok, null);
    check('CIPC starts unchecked', v?.cipc_status, 'unchecked');
    check('nothing is flagged on a clean application', v?.flags, []);

    // Recording the CIPC outcome.
    const cipcBad = await adminPost(`/api/admin/suppliers/${id}/cipc`, { status: 'wishful_thinking' });
    check('an invented CIPC status is refused', cipcBad.status, 400);
    const cipcOk = await adminPost(`/api/admin/suppliers/${id}/cipc`, { status: 'not_found', note: 'Searched the reg number, nothing came back' });
    check('a CIPC result is recorded', cipcOk.status, 200);
    check('  and a company not on the register is a hard flag',
      (await jsonOf(cipcOk)).vetting?.level, 'bad');

    // ---- messaging an applicant --------------------------------------------
    const emptyMsg = await adminPost(`/api/admin/suppliers/${id}/message`, { body: '   ' });
    check('an empty message is refused', emptyMsg.status, 400);

    const sent = await adminPost(`/api/admin/suppliers/${id}/message`, {
      subject: 'Two documents still outstanding',
      body: 'Hi Thabo,\n\nWe still need your bank letter.\n\nThanks',
    });
    check('a message is accepted', sent.status, 200);
    const sentBody = await jsonOf(sent);
    check('  and reports it was not really emailed in dry run', sentBody.delivery, 'dry_run');
    check('  and says who it went to', sentBody.to, email);

    const hist = await jsonOf(await adminGet(`/api/admin/suppliers/${id}/messages`));
    const kinds = (hist.messages || []).map((m) => m.kind);
    check('the message is in the history', kinds.includes('message'), true);
    check('  and so is the earlier info request', kinds.includes('request_info'), true);
    check('  newest first', hist.messages[0].kind, 'message');
    check('  with the text that was sent',
      /bank letter/.test(hist.messages[0].body), true);
    check('  and a delivery state, so a silent failure is visible',
      hist.messages[0].delivery, 'dry_run');

    const missingPro = await adminPost('/api/admin/suppliers/99999/message', { body: 'hello' });
    check('messaging a non-existent applicant 404s', missingPro.status, 404);

    // ---- approving clears any outstanding request --------------------------
    await adminPost(`/api/admin/suppliers/${id}/request-info`, { items: ['references'] });
    await adminPost(`/api/admin/suppliers/${id}/approve`);
    const s3 = await mePro();
    check('approved', s3?.status, 'approved');
    check('an approved pro is not still told to send documents', s3?.info_needed, []);

    // ---- a manual item needs the admin to clear it -------------------------
    await adminPost(`/api/admin/suppliers/${id}/request-info`, { items: ['call_back'] });
    check('a phone call can be asked for', (await mePro())?.info_needed, ['call_back']);
    await adminPost(`/api/admin/suppliers/${id}/clear-info-request`);
    check('the admin can clear it by hand', (await mePro())?.info_needed, []);

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
    // Windows keeps a handle on the SQLite file for a moment after the child exits.
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir, it can wait */ }
  }
})();
