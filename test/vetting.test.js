// The automatic checks run on every pro application.
//
// The ID checksum is the part that makes a hard claim ("this is not a valid SA ID
// number"), so it is the part most worth testing: a wrong implementation either waves
// through fabricated IDs or accuses honest applicants of fraud. The company-number check
// is tested for what it deliberately does NOT do — it must never claim to know what the
// two-digit suffix means, because the published tables contradict each other.
const vetting = require('../server/vetting');

const checks = [];
const check = (name, actual, want) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}`);
};

// Build an ID number with a correct Luhn check digit, so the fixtures are real rather
// than numbers I hope are valid.
function withCheckDigit(first12) {
  for (let d = 0; d <= 9; d++) {
    const candidate = first12 + d;
    let sum = 0, alt = false;
    for (let i = candidate.length - 1; i >= 0; i--) {
      let n = candidate.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    if (sum % 10 === 0) return candidate;
  }
  throw new Error('no check digit found');
}

/* ---------- SA ID numbers ---------- */
const valid = withCheckDigit('900101500008');       // 1990-01-01, SA citizen
check('a well-formed ID passes', vetting.checkSaId(valid).ok, true);
check('  and its date of birth is read correctly', vetting.checkSaId(valid).dob, '1990-01-01');
check('  and citizenship is read', vetting.checkSaId(valid).citizenship, 'SA citizen');
check('  and it says what it does not prove',
  /does NOT prove/.test(vetting.checkSaId(valid).note || ''), true);

// One digit changed: the checksum must catch it.
const tampered = valid.slice(0, 5) + String((+valid[5] + 1) % 10) + valid.slice(6);
check('a single altered digit is caught', vetting.checkSaId(tampered).ok, false);

check('13 ones is rejected', vetting.checkSaId('1111111111111').ok, false);
check('too short is rejected', vetting.checkSaId('90010150000').ok, false);
check('  and says how many digits were given',
  /11 digits/.test(vetting.checkSaId('90010150000').reason), true);
check('month 13 is rejected', vetting.checkSaId(withCheckDigit('901301500008')).ok, false);
check('day 32 is rejected', vetting.checkSaId(withCheckDigit('900132500008')).ok, false);
check('31 February is rejected', vetting.checkSaId(withCheckDigit('900231500008')).ok, false);
check('an empty ID is rejected', vetting.checkSaId('').ok, false);
check('spaces and dashes are tolerated',
  vetting.checkSaId(valid.slice(0, 6) + ' ' + valid.slice(6, 10) + '-' + valid.slice(10)).ok, true);

// Permanent resident flag.
const resident = withCheckDigit('900101500018');
check('permanent resident is identified', vetting.checkSaId(resident).citizenship, 'Permanent resident');

// Under-18 must be flagged even though the number is arithmetically fine.
const yy = String((new Date().getFullYear() - 10) % 100).padStart(2, '0');
const child = withCheckDigit(`${yy}010150000`.padEnd(12, '8').slice(0, 12));
const childRes = vetting.checkSaId(child);
check('a child\'s ID is valid but flagged', childRes.ok && childRes.warnings.includes('Under 18'), true);

/* ---------- company registration numbers ---------- */
const co = vetting.checkCompanyReg('2021/123456/07');
check('a well-formed CIPC number passes', co.ok, true);
check('  and is normalised', co.formatted, '2021/123456/07');
check('  and the year is read', co.year, 2021);
check('  and it does NOT claim to know the entity type',
  Object.keys(co).some((k) => /type|entity/i.test(k)), false);
check('  and it says the company still must be confirmed',
  /must still be confirmed on CIPC/.test(co.note), true);
check('  and it offers where to confirm it', typeof co.search_url === 'string' && co.search_url.length > 10, true);

check('digits with no slashes are accepted', vetting.checkCompanyReg('202112345607').ok, true);
check('a future registration year is rejected', vetting.checkCompanyReg('2099/123456/07').ok, false);
check('an ID number in the company field is rejected', vetting.checkCompanyReg(valid).ok, false);
check('rubbish is rejected', vetting.checkCompanyReg('my company').ok, false);
check('blank is "not a company", not "invalid"', vetting.checkCompanyReg('').ok, null);
check('  and says why', /sole trader/.test(vetting.checkCompanyReg('').reason), true);

/* ---------- the one-line verdict ---------- */
const clean = {
  id_number: { ok: true, warnings: [] },
  company: { ok: true },
  google: { ok: true, warnings: [] },
  cipc_status: 'verified',
};
check('a clean application is "ok"', vetting.summarise(clean).level, 'ok');

const badId = { ...clean, id_number: { ok: false, reason: 'Checksum fails' } };
check('a bad ID number is "bad"', vetting.summarise(badId).level, 'bad');
check('  and the reason is surfaced', vetting.summarise(badId).flags[0], 'ID number: Checksum fails');

const notOnRegister = { ...clean, cipc_status: 'not_found' };
check('a company not on the register is "bad"', vetting.summarise(notOnRegister).level, 'bad');

const poorReviews = { ...clean, google: { ok: true, warnings: ['Rating is 2.1'] } };
check('a poor Google rating is "look closer", not "bad"', vetting.summarise(poorReviews).level, 'warn');
check('  and is listed', vetting.summarise(poorReviews).flags, ['Google: Rating is 2.1']);

check('no vetting at all is "none"', vetting.summarise(null).level, 'none');

/* ---------- Google without a key ---------- */
(async () => {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    const g = await vetting.checkGoogle('Some Business', 'Durbanville');
    check('without a Google key the check is "unknown", not "failed"', g.ok, null);
    check('  and says how to switch it on', /GOOGLE_MAPS_API_KEY/.test(g.reason), true);
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
  if (passed !== checks.length) process.exitCode = 1;
})();
