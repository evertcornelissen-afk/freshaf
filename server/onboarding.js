// What a pro has to send in before they can be approved — one list, used by the admin
// dashboard, the "we still need" email and the pro's own app, so none of the three can
// drift from the others.
//
// The required set mirrors the decision rule in SUPPLIER-ONBOARDING.md: do not approve
// without the ID, the bank letter in the same name, and a police clearance for every
// person who will do jobs.

const { db } = require('./db');

// kind: 'doc'    — satisfied by an upload of that name
//       'field'  — satisfied by data already on the account
//       'manual' — a human check an admin can ask about but the system cannot see
const ITEMS = [
  { key: 'id_copy', kind: 'doc', required: true,
    label: 'SA ID copy',
    ask: 'A clear photo or scan of your South African ID (both sides of the card, or the ID book page with your photo).' },
  { key: 'bank_letter', kind: 'doc', required: true,
    label: 'Bank confirmation letter',
    ask: 'A bank confirmation letter in the same name as your ID. Any bank app can generate one — it is not a statement.' },
  { key: 'police_clearance', kind: 'doc', required: true,
    label: 'Police clearance',
    ask: 'A police clearance certificate less than 6 months old, for every person who will be doing jobs.' },
  { key: 'bank_details', kind: 'field', required: true,
    label: 'Bank account details',
    ask: 'Your bank name, account number and branch, so we can pay you.' },
  { key: 'proof_address', kind: 'doc', required: false,
    label: 'Proof of address',
    ask: 'A municipal bill, bank statement or lease not older than 3 months showing your address.' },
  { key: 'work_photo', kind: 'doc', required: false,
    label: 'Photo of your setup',
    ask: 'A photo of your vehicle and equipment as a customer would see it on arrival.' },
  { key: 'company_reg', kind: 'doc', required: false,
    label: 'Company registration',
    ask: 'Your CIPC registration document, if you are applying as a company rather than as yourself.' },
  { key: 'company_reg_number', kind: 'field', required: false,
    label: 'Company registration number',
    ask: 'Your CIPC registration number in the form YYYY/NNNNNN/NN, if you trade as a company rather than as yourself.' },
  { key: 'references', kind: 'manual', required: false,
    label: 'Contactable reference',
    ask: 'The name and phone number of one previous customer or employer we may call.' },
  { key: 'call_back', kind: 'manual', required: false,
    label: 'Phone call with us',
    ask: 'A short call to go through your services and area. Reply with the times that suit you.' },
];

const BY_KEY = Object.fromEntries(ITEMS.map((i) => [i.key, i]));
const DOC_KINDS = ITEMS.filter((i) => i.kind === 'doc').map((i) => i.key);

function isValidKey(key) { return !!BY_KEY[key]; }

// Which checklist items this pro has already satisfied. Manual items are never counted
// as satisfied — only an admin knows whether the reference call happened.
function haveFor(supplier, docs) {
  const uploaded = new Set((docs || []).map((d) => d.kind));
  const have = new Set();
  for (const item of ITEMS) {
    if (item.kind === 'doc' && uploaded.has(item.key)) have.add(item.key);
    if (item.key === 'bank_details' && supplier?.bank_name && supplier?.bank_account) have.add(item.key);
    if (item.key === 'company_reg_number' && supplier?.reg_number) have.add(item.key);
  }
  return have;
}

// The checklist as the dashboard and the pro's app show it.
function checklist(supplier, docs) {
  const have = haveFor(supplier, docs);
  let asked = [];
  try { asked = JSON.parse(supplier?.info_needed || '[]'); } catch { asked = []; }
  const askedSet = new Set(asked.filter(isValidKey));
  return ITEMS.map((i) => ({
    key: i.key, label: i.label, ask: i.ask, kind: i.kind, required: i.required,
    have: have.has(i.key),
    asked: askedSet.has(i.key),
  }));
}

// Required items still outstanding — what stands between this application and a decision.
function missingRequired(supplier, docs) {
  const have = haveFor(supplier, docs);
  return ITEMS.filter((i) => i.required && !have.has(i.key)).map((i) => i.key);
}

function labelsFor(keys) {
  return (keys || []).filter(isValidKey).map((k) => BY_KEY[k].label);
}
function asksFor(keys) {
  return (keys || []).filter(isValidKey).map((k) => ({ label: BY_KEY[k].label, ask: BY_KEY[k].ask }));
}

// Called after a pro uploads a document: if everything an admin asked for has now
// arrived, the request is closed so the application goes back to a clean "under review".
// Manual items (a phone call, a reference) can only be cleared by the admin, so a
// request that contains one stays open.
function settleRequest(userId) {
  const s = db.prepare('SELECT * FROM suppliers WHERE user_id = ?').get(userId);
  if (!s?.info_needed) return null;
  let asked = [];
  try { asked = JSON.parse(s.info_needed); } catch { return null; }
  asked = asked.filter(isValidKey);
  if (!asked.length) return null;
  const docs = db.prepare('SELECT kind FROM supplier_docs WHERE user_id = ?').all(userId);
  const have = haveFor(s, docs);
  const outstanding = asked.filter((k) => BY_KEY[k].kind === 'manual' || !have.has(k));
  if (outstanding.length) return { done: false, outstanding };
  db.prepare("UPDATE suppliers SET info_needed = NULL, info_note = NULL WHERE user_id = ?").run(userId);
  return { done: true, supplied: asked };
}

module.exports = { ITEMS, BY_KEY, DOC_KINDS, isValidKey, checklist, missingRequired, labelsFor, asksFor, settleRequest };
