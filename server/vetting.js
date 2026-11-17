// Automatic background checks on a pro application.
//
// Runs the moment an application arrives, so a reviewer never has to remember to do it.
// Three checks, each honest about how much it proves:
//
//   1. SA ID number  — arithmetic. The last digit is a Luhn check digit over the first
//      twelve, so a made-up number fails instantly and for free. This proves the number
//      is WELL FORMED, not that it belongs to the applicant. Home Affairs verification
//      is a separate, paid service.
//
//   2. Company registration number — FORMAT ONLY (YYYY/NNNNNN/NN) plus a sane year.
//      It deliberately does NOT claim what the two-digit suffix means: the published
//      tables contradict each other (07 is agreed to be (Pty) Ltd, but sources disagree
//      on 06, 08 and 21) and CIPC's own notice was not reachable to settle it. Guessing
//      "this is a non-profit" from an unverified table would be worse than saying
//      nothing. Whether the company EXISTS and is in good standing needs CIPC itself —
//      there is no free official API, so that stays a tracked manual step with a
//      one-click link, or a paid provider via CIPC_LOOKUP_URL.
//
//   3. Google Business listing — real, automatic, and the most useful of the three for
//      judging an actual trading business: rating, number of reviews, address and
//      whether Google shows the place as permanently closed.
//
// Nothing here approves or rejects anybody. It puts the facts in front of the reviewer.

// db and secrets are required lazily, inside the functions that touch them. Validating a
// checksum must not boot a database: loading it here made the pure-function test open the
// SQLite handle, which crashed Node on exit on Windows (libuv UV_HANDLE_CLOSING assertion)
// and took the whole suite down after it.
const maps = require('./maps');
const getDb = () => require('./db').db;

/* ---------- 1. South African ID number ---------- */
// YYMMDD SSSS C A Z : date of birth, gender sequence, citizenship, legacy digit, check digit.
function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function checkSaId(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return { ok: false, reason: 'No ID number on the application' };
  if (d.length !== 13) return { ok: false, reason: `${d.length} digits — an SA ID number has 13` };

  const yy = +d.slice(0, 2), mm = +d.slice(2, 4), dd = +d.slice(4, 6);
  if (mm < 1 || mm > 12) return { ok: false, reason: `Month "${d.slice(2, 4)}" is not a real month` };
  if (dd < 1 || dd > 31) return { ok: false, reason: `Day "${d.slice(4, 6)}" is not a real day` };

  // Two-digit year: assume nobody applying to wash cars was born in the future.
  const nowYY = new Date().getFullYear() % 100;
  const century = yy <= nowYY ? 2000 : 1900;
  const year = century + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) {
    return { ok: false, reason: 'That date of birth does not exist' };
  }
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));

  if (!luhnOk(d)) return { ok: false, reason: 'Checksum fails — this is not a valid SA ID number', dob: dob.toISOString().slice(0, 10), age };

  const citizenDigit = +d[10];
  return {
    ok: true,
    dob: dob.toISOString().slice(0, 10),
    age,
    citizenship: citizenDigit === 0 ? 'SA citizen' : citizenDigit === 1 ? 'Permanent resident' : 'Unknown',
    // Flags a reviewer should see even on a valid number.
    warnings: [
      ...(age < 18 ? ['Under 18'] : []),
      ...(age > 80 ? [`Age reads as ${age} — check the ID`] : []),
      ...(citizenDigit > 1 ? ['Citizenship digit is not 0 or 1'] : []),
    ],
    note: 'Valid format and checksum. This does NOT prove the number belongs to the applicant.',
  };
}

/* ---------- 2. Company registration number ---------- */
const CIPC_SEARCH_URL = 'https://bizprofile.cipc.co.za/';

function checkCompanyReg(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: null, reason: 'No company number given — applying as a sole trader' };

  const digits = s.replace(/\D/g, '');
  const m = s.match(/^(\d{4})\s*\/\s*(\d{6,7})\s*\/\s*(\d{2})$/)
    || (digits.length === 12 ? [null, digits.slice(0, 4), digits.slice(4, 10), digits.slice(10)] : null);
  if (!m) {
    return { ok: false, reason: 'Not in CIPC format YYYY/NNNNNN/NN' };
  }
  const year = +m[1];
  const thisYear = new Date().getFullYear();
  if (year < 1900 || year > thisYear) {
    return { ok: false, formatted: `${m[1]}/${m[2]}/${m[3]}`, reason: `Registration year ${year} is not possible` };
  }
  return {
    ok: true,
    formatted: `${m[1]}/${m[2]}/${m[3]}`,
    year,
    suffix: m[3],
    // Deliberately unlabelled — see the note at the top of this file.
    note: 'Format is valid. Whether the company exists and is in good standing must still be confirmed on CIPC.',
    search_url: CIPC_SEARCH_URL,
  };
}

/* ---------- 3. Google Business listing ---------- */
async function checkGoogle(businessName, area) {
  if (!maps.hasGoogle()) {
    return { ok: null, reason: 'No Google key configured — set GOOGLE_MAPS_API_KEY to switch this on' };
  }
  try {
    const place = await maps.findBusiness(businessName, area);
    if (!place) {
      return {
        ok: false,
        reason: 'No Google Business listing found under this name',
        // Not damning on its own: plenty of real one-person operations have no listing.
        note: 'Many legitimate sole traders have no listing. Treat as "unknown", not "fake".',
      };
    }
    return {
      ok: true,
      name: place.name,
      address: place.address,
      rating: place.rating ?? null,
      reviews: place.reviews ?? 0,
      status: place.status || null,
      maps_url: place.mapsUrl || null,
      warnings: [
        ...(place.status && place.status !== 'OPERATIONAL' ? [`Google shows this place as ${place.status}`] : []),
        ...(place.rating != null && place.rating < 3.5 ? [`Rating is ${place.rating}`] : []),
        ...((place.reviews ?? 0) === 0 ? ['Listing has no reviews'] : []),
      ],
    };
  } catch (e) {
    return { ok: null, reason: `Google lookup failed: ${e.message}` };
  }
}

/* ---------- running and storing ---------- */

async function runFor(userId) {
  const db = getDb();
  const secrets = require('./secrets');
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(userId);
  if (!s) return null;
  const result = {
    checked_at: new Date().toISOString(),
    id_number: checkSaId(secrets.decryptField(s.id_number)),
    company: checkCompanyReg(s.reg_number),
    google: await checkGoogle(s.business_name, s.service_area),
  };
  db.prepare(`INSERT INTO supplier_vetting (user_id, result_json, checked_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET result_json = excluded.result_json, checked_at = excluded.checked_at`)
    .run(userId, JSON.stringify(result));
  const flags = summarise(result).flags;
  console.log(`[FreshAF] Vetting ${userId} (${s.business_name}): ${flags.length ? flags.join('; ') : 'nothing flagged'}`);
  return result;
}

function stored(userId) {
  const row = getDb().prepare('SELECT * FROM supplier_vetting WHERE user_id = ?').get(userId);
  if (!row) return null;
  let result;
  try { result = JSON.parse(row.result_json); } catch { return null; }
  return {
    ...result,
    checked_at: row.checked_at,
    cipc_status: row.cipc_status || 'unchecked',
    cipc_note: row.cipc_note || null,
    cipc_checked_at: row.cipc_checked_at || null,
  };
}

// The one-line verdict the dashboard leads with.
function summarise(v) {
  if (!v) return { flags: [], level: 'none' };
  const flags = [];
  if (v.id_number?.ok === false) flags.push(`ID number: ${v.id_number.reason}`);
  (v.id_number?.warnings || []).forEach((w) => flags.push(`ID: ${w}`));
  if (v.company?.ok === false) flags.push(`Company number: ${v.company.reason}`);
  (v.google?.warnings || []).forEach((w) => flags.push(`Google: ${w}`));
  if (v.cipc_status === 'not_found') flags.push('CIPC: company not found on the register');
  const level = v.id_number?.ok === false || v.cipc_status === 'not_found' ? 'bad'
    : flags.length ? 'warn' : 'ok';
  return { flags, level };
}

const CIPC_STATUSES = ['unchecked', 'verified', 'not_found', 'not_a_company'];

function setCipcStatus(userId, status, note) {
  if (!CIPC_STATUSES.includes(status)) return false;
  getDb().prepare(`INSERT INTO supplier_vetting (user_id, result_json, cipc_status, cipc_note, cipc_checked_at)
    VALUES (?, '{}', ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET cipc_status = excluded.cipc_status,
      cipc_note = excluded.cipc_note, cipc_checked_at = excluded.cipc_checked_at`)
    .run(userId, status, note || null);
  return true;
}

module.exports = { checkSaId, checkCompanyReg, checkGoogle, runFor, stored, summarise, setCipcStatus, CIPC_STATUSES, CIPC_SEARCH_URL };
