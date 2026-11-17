// Safety rating for a pro application: how safe is it to approve them, out of 5.
//
// Rule-based and fully explained: every point added or withheld comes with the reason, so
// the score can be argued with. It reads only what the live site already sends the
// dashboard (the approval checklist and the automatic background checks); it never
// guesses. Things the system cannot see (a reference call, whether the photo on the ID
// matches the person) are listed as still to do, never scored as done.
//
// Weights, out of 10 points (score = points / 2, rounded to the nearest half star):
//   Identity            2.5  ID copy 1, ID number passes the checksum 1.5
//   Payment trail       2    bank confirmation letter 1.5, bank details captured 0.5
//   Police clearance    2.5  they work at customers' homes and on their cars
//   Business standing   2    CIPC verified 1 (sole trader 0.5), Google listing up to 1
//   Extras              1    proof of address 0.5, photo of their setup 0.5
//
// Hard caps (the score cannot be higher than this, whatever else is in):
//   invalid ID number or under 18 -> 1    company NOT on the CIPC register -> 1
//   Google shows the business closed -> 2  no police clearance -> 2.5
(function (root) {
  'use strict';

  function safetyRating(s) {
    const list = (s && s.checklist) || [];
    const have = (k) => list.some((c) => c.key === k && c.have);
    const v = (s && s.vetting) || {};
    const plus = [];
    const minus = [];
    let pts = 0;
    let cap = 5;
    const capAt = (n) => { cap = Math.min(cap, n); };

    // Identity
    if (have('id_copy')) { pts += 1; plus.push('ID copy uploaded'); } else minus.push('No ID copy yet');
    const id = v.id_number;
    if (id && id.ok === true) {
      pts += 1.5;
      plus.push(`ID number is valid (checksum), age ${id.age}`);
      if ((id.warnings || []).includes('Under 18')) { capAt(1); minus.push('Applicant is under 18'); }
    } else if (id && id.ok === false) {
      capAt(1);
      minus.push(`ID number fails: ${id.reason}`);
    } else {
      minus.push('ID number not checked yet (press Run checks)');
    }

    // Payment trail
    if (have('bank_letter')) { pts += 1.5; plus.push('Bank confirmation letter uploaded'); } else minus.push('No bank confirmation letter yet');
    if (have('bank_details')) { pts += 0.5; plus.push('Bank details captured'); } else minus.push('No bank details yet');

    // Police clearance
    if (have('police_clearance')) {
      pts += 2.5;
      plus.push('Police clearance uploaded (check it is under 6 months old)');
    } else {
      capAt(2.5);
      minus.push("No police clearance: they work at customers' homes and on their cars");
    }

    // Business standing: CIPC
    const cipc = v.cipc_status || 'unchecked';
    const co = v.company || {};
    if (cipc === 'not_found') { capAt(1); minus.push('Company NOT found on the CIPC register'); }
    else if (cipc === 'verified') { pts += 1; plus.push('Company verified on CIPC'); }
    else if (cipc === 'not_a_company') { pts += 0.5; plus.push('Trades as a sole trader (no company to check)'); }
    else if (co.ok === false) { minus.push(`Company number is wrong: ${co.reason}`); }
    else if (co.ok === true) { pts += 0.25; minus.push(`Company ${co.formatted} not yet confirmed on CIPC`); }
    else { pts += 0.5; plus.push('No company given: applying as a sole trader'); }

    // Business standing: Google
    const g = v.google || {};
    if (g.ok === true) {
      if (g.status && g.status !== 'OPERATIONAL') { capAt(2); minus.push(`Google shows the business as ${g.status}`); }
      else if (g.rating != null && g.rating < 3.5) { minus.push(`Google rating is low: ${g.rating} from ${g.reviews} reviews`); }
      else if (g.rating != null && g.rating >= 4 && (g.reviews || 0) >= 5) { pts += 1; plus.push(`Google: ${g.rating} stars from ${g.reviews} reviews`); }
      else { pts += 0.5; plus.push(`Google listing found${g.rating != null ? ` (${g.rating} stars, ${g.reviews} reviews)` : ''}`); }
    } else if (g.ok === false) {
      minus.push('No Google listing (common for one-person operators; not proof of anything)');
    } else {
      minus.push('Google listing not checked yet');
    }

    // Extras
    if (have('proof_address')) { pts += 0.5; plus.push('Proof of address uploaded'); }
    if (have('work_photo')) { pts += 0.5; plus.push('Photo of their setup uploaded'); }

    const score = Math.min(cap, Math.round(pts) / 2); // 10 points -> 5 stars, half-star steps
    const missingRequired = list.filter((c) => c.required && !c.have).map((c) => c.label);

    let verdict, level;
    if (cap <= 1) { verdict = 'Do not approve'; level = 'bad'; }
    else if (missingRequired.length) { verdict = 'Not ready: request the missing items'; level = 'warn'; }
    else if (score >= 4.5) { verdict = 'Safe to approve after your reference call'; level = 'ok'; }
    else if (score >= 3.5) { verdict = 'Probably fine: check the flagged items first'; level = 'ok'; }
    else if (score >= 2.5) { verdict = 'Hold: request more information'; level = 'warn'; }
    else { verdict = 'Do not approve yet'; level = 'bad'; }

    return {
      score,
      verdict,
      level,
      plus,
      minus,
      missingRequired,
      // Never scored, always shown: a human has to do these.
      stillToDo: [
        'Call one reference',
        'Check the face on the ID matches the person you speak to',
        'Check the police clearance date (under 6 months) and that the name matches the ID',
        'Check the bank letter is in the same name as the ID',
      ],
    };
  }

  // The same request the email sends, worded for WhatsApp, so it can be pasted into a chat.
  function whatsappRequest(s, items, note) {
    const raw = String((s && s.name) || '').trim().split(/\s+/)[0] || 'there';
    const first = raw === 'there' ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const lines = [
      `Hi ${first}, this is FreshAF about your application for ${s.business_name}.`,
      '',
      'Thank you for applying. Before we can approve you we still need:',
      ...items.map((c, i) => `${i + 1}. ${c.label}: ${c.ask}`),
    ];
    if (note) lines.push('', `Note: ${note}`);
    lines.push(
      '',
      'You can upload documents in the FreshAF Pro app (freshaf.io/supplier, sign in, then "Your documents"), or reply here with a clear photo.',
      'Your application stays open while we wait. Thanks!',
      'FreshAF team',
    );
    return lines.join('\n');
  }

  const api = { safetyRating, whatsappRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreshSafety = api;
})(typeof window !== 'undefined' ? window : globalThis);
