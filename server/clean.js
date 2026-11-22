// Caps on free text people type. Without them a 10,000-character "name" is stored as-is
// and then breaks every screen it is shown on (the customer's tracker, the pro's job card,
// the admin list), and a number sent where text belongs crashes the route on .trim().
// Text fields are trimmed and cut to a sensible length; anything that is not text where
// text is expected becomes '' so the route's own "is required" check answers with a 400.
function capFields(body, limits) {
  if (!body || typeof body !== 'object') return body;
  for (const [key, max] of Object.entries(limits)) {
    if (!(key in body) || body[key] == null) continue;
    const v = body[key];
    body[key] = (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max) : '';
  }
  return body;
}

const PERSON = {
  name: 80, email: 254, phone: 30, home_address: 200,
  business_name: 100, id_number: 20, reg_number: 30, vat_number: 20, vehicle_reg: 60,
  service_area: 1500, equipment_notes: 500, bank_name: 60, bank_account: 30, bank_branch: 40, phone_code: 10,
};

module.exports = { capFields, PERSON };
