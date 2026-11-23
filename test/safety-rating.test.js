// Safety rating rules (admin-app/public/js/safety.js): full marks only with everything in
// and verified, hard caps for the red flags, and nothing a human must check is ever scored.
const { safetyRating, whatsappRequest } = require('../admin-app/public/js/safety.js');

const ITEMS = ['id_copy', 'bank_letter', 'police_clearance', 'bank_details', 'proof_address', 'work_photo',
  'company_reg', 'company_reg_number', 'references', 'call_back'];
// Police clearance left the required set on 23 Nov 2026: it is the Top Tier upgrade now.
const REQUIRED = new Set(['id_copy', 'bank_letter', 'bank_details']);
const app = (have, vetting = {}) => ({
  name: 'Thabo Mokoena', business_name: 'Sparkle Mobile Wash',
  checklist: ITEMS.map((key) => ({ key, label: key, ask: `send ${key}`, required: REQUIRED.has(key),
    top_tier: key === 'police_clearance', have: have.includes(key) })),
  vetting,
});
const goodId = { ok: true, age: 34, warnings: [] };
const goodGoogle = { ok: true, rating: 4.6, reviews: 23, status: 'OPERATIONAL' };
const all = ['id_copy', 'bank_letter', 'police_clearance', 'bank_details', 'proof_address', 'work_photo'];

const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(got)}`); };

let r = safetyRating(app(all, { id_number: goodId, cipc_status: 'verified', google: goodGoogle }));
check('everything in and verified = 5/5, safe after reference call', r.score === 5 && r.level === 'ok' && /reference/.test(r.verdict), [r.score, r.verdict]);
check('reference call is never scored, always listed', r.stillToDo.some((x) => /reference/i.test(x)), r.stillToDo.length);

r = safetyRating(app(all, { id_number: goodId, google: { ok: false } }));
check('sole trader, no Google listing, all docs = still 4+', r.score >= 4 && r.score < 5, r.score);

r = safetyRating(app(all, { id_number: { ok: false, reason: 'Checksum fails' }, cipc_status: 'verified', google: goodGoogle }));
check('invalid ID number caps at 1 and says do not approve', r.score === 1 && r.verdict === 'Do not approve', [r.score, r.verdict]);

r = safetyRating(app(all, { id_number: { ...goodId, warnings: ['Under 18'] }, cipc_status: 'verified', google: goodGoogle }));
check('under 18 caps at 1', r.score === 1, r.score);

r = safetyRating(app(all, { id_number: goodId, cipc_status: 'not_found', google: goodGoogle }));
check('company not on CIPC caps at 1', r.score === 1 && r.level === 'bad', r.score);

r = safetyRating(app(all.filter((k) => k !== 'police_clearance'), { id_number: goodId, cipc_status: 'verified', google: goodGoogle }));
check('no police clearance is approvable, just not Top Tier',
  r.score >= 4 && r.topTier === false && !/Not ready/.test(r.verdict) && r.missingRequired.length === 0, [r.score, r.verdict]);
check('and the reason says what they lose by not having one', r.minus.some((x) => /Top Tier/.test(x)), null);

r = safetyRating(app(all, { id_number: goodId, cipc_status: 'verified', google: goodGoogle }));
check('with the clearance they are Top Tier', r.topTier === true && r.plus.some((x) => /TOP TIER/.test(x)), r.score);

r = safetyRating(app(all.filter((k) => k !== 'id_copy'), { id_number: goodId, cipc_status: 'verified', google: goodGoogle }));
check('no ID copy caps at 3 and is not ready: the one must-have',
  r.score <= 3 && /Not ready/.test(r.verdict), [r.score, r.verdict]);

r = safetyRating(app(all, { id_number: goodId, cipc_status: 'verified', google: { ...goodGoogle, status: 'CLOSED_PERMANENTLY' } }));
check('closed on Google caps at 2', r.score <= 2, r.score);

r = safetyRating(app([], {}));
check('nothing in yet = 0.5 or less, not ready', r.score <= 0.5 && r.missingRequired.length === 3, [r.score, r.missingRequired.length]);

r = safetyRating(app(all, {}));
check('checks not run yet are listed as to-do, not counted', r.minus.some((x) => /not checked yet/.test(x)) && r.score < 5, r.score);

check('score is always in half-star steps', [0, 1, 2, 3].every((n) => {
  const x = safetyRating(app(all.slice(0, n + 2), { id_number: goodId })).score; return x * 2 === Math.round(x * 2);
}), null);


// ---- the Google listing: shown on the analysis, and only counted when it is theirs ----
r = safetyRating({ ...app(all, { id_number: goodId, google: { ok: true, name: 'Tshwane Market', rating: 4.1, reviews: 2386, status: 'OPERATIONAL', address: '450 President Burgers St' } }), business_name: 'Fresh by Koketso' });
check('a Google match with a different name is not counted', r.business.matches === false && !r.plus.some((x) => /Google: /.test(x)), r.business.name);
check('and the owner is told whose reviews they are', r.minus.some((x) => /not their business name/.test(x)), null);
check('the shop address is still shown so it can be judged', r.business.shop, '450 President Burgers St');

r = safetyRating({ ...app(all, { id_number: goodId, google: { ok: true, name: 'The Capital Detailing', rating: 4.9, reviews: 16, status: 'OPERATIONAL', address: '12 Main Rd, Centurion' } }), business_name: 'The Capital Detailing' });
check('a listing in their own name counts and is shown',
  [r.business.matches, r.business.rating, r.business.reviews, r.business.shop],
  [true, 4.9, 16, '12 Main Rd, Centurion']);

r = safetyRating({ ...app(all, { id_number: goodId, google: { ok: false, reason: 'No Google Business listing found under this name' } }), business_name: 'Bakkie Wash' });
check('no listing at all is reported, not guessed at', [r.business.name, /No Google/.test(r.business.reason)], [null, true]);

const s = app([], {});
const msg = whatsappRequest(s, s.checklist.filter((c) => ['id_copy', 'company_reg'].includes(c.key)), 'ID photo was blurry');
check('WhatsApp message greets by first name, lists items and note',
  /^Hi Thabo,/.test(msg) && /1\. id_copy/.test(msg) && /2\. company_reg/.test(msg) && /Note: ID photo was blurry/.test(msg) && /Your documents/.test(msg),
  msg.split('\n')[0]);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
