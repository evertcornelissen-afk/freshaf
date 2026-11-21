// Service catalogs. Prices in cents (ZAR); unit multiplier applied on the package base.
const SERVICES = {
  carwash: {
    key: 'carwash',
    name: 'Car Wash',
    providerNoun: 'washer',
    unitLabel: 'Vehicle type',
    packages: {
      express:    { key: 'express',    name: 'Express Wash',     desc: 'Exterior hand wash & dry',                        base: 18000, eta: 'about 30 min' },
      wash_vac:   { key: 'wash_vac',   name: 'Wash & Vacuum',    desc: 'Exterior wash, dry, interior vacuum & wipe-down', base: 28000, eta: 'about 50 min' },
      full_valet: { key: 'full_valet', name: 'Full Valet',       desc: 'Deep interior clean, wax, tyre shine, the works', base: 65000, eta: 'about 2 h' },
    },
    units: {
      sedan:   { key: 'sedan',   name: 'Sedan / Hatchback', mult: 1.0 },
      suv:     { key: 'suv',     name: 'SUV / Bakkie',      mult: 1.25 },
      minibus: { key: 'minibus', name: 'Minibus / Van',     mult: 1.5 },
    },
  },
  // Detailing (added 21 Nov 2026): high-value, multi-hour work, so it is its own service
  // rather than more car wash packages. Only pros FreshAF has approved for detailing carry
  // 'detailing' in their services, which is what keeps these requests away from car wash
  // pros. bookAhead: no "as soon as possible", every job is a booked slot. quoteOnly: the
  // price depends on the car, so a published price never answers automatically.
  // base = suggested starting price for the pro's price form, and the "from" price shown.
  detailing: {
    key: 'detailing',
    name: 'Detailing',
    providerNoun: 'detailer',
    unitLabel: 'Vehicle type',
    bookAhead: true,
    // Paid by card only (Evert, 21 Nov 2026): R900+ is too much for a pro to carry in cash.
    cardOnly: true,
    packages: {
      interior_detail: { key: 'interior_detail', name: 'Interior Detail', desc: 'Seats, carpets, roof lining and trim deep cleaned and protected', base: 90000, eta: 'about 3 h' },
      exterior_detail: { key: 'exterior_detail', name: 'Exterior Detail', desc: 'Decontamination wash, clay bar, machine polish and wax',           base: 90000, eta: 'about 3 h' },
      full_detail:     { key: 'full_detail',     name: 'Full Detail',     desc: 'Interior and exterior detail in one visit',                        base: 150000, eta: 'about 5 h' },
      paint_ceramic:   { key: 'paint_ceramic',   name: 'Paint Correction / Ceramic', desc: 'Paint correction and ceramic coating, priced once the detailer has seen the car', base: 300000, eta: 'a full day', quoteOnly: true },
    },
    units: {
      sedan:   { key: 'sedan',   name: 'Sedan / Hatchback', mult: 1.0 },
      suv:     { key: 'suv',     name: 'SUV / Bakkie',      mult: 1.25 },
      minibus: { key: 'minibus', name: 'Minibus / Van',     mult: 1.5 },
    },
  },
  laundry: {
    key: 'laundry',
    name: 'Laundry',
    providerNoun: 'laundry pro',
    unitLabel: 'Load size',
    packages: {
      // turnaround_h: the earliest a load can come back after it is collected. It is what
      // the "return" window on a laundry booking is measured from.
      wash_fold: { key: 'wash_fold', name: 'Wash & Fold',       desc: 'Washed, tumble-dried and neatly folded',            base: 22000, eta: '24–48 h turnaround', turnaround_h: 24 },
      wash_iron: { key: 'wash_iron', name: 'Wash, Dry & Iron',  desc: 'Full wash plus professional ironing, ready to wear', base: 32000, eta: '48 h turnaround', turnaround_h: 48 },
      bedding:   { key: 'bedding',   name: 'Duvets & Bedding',  desc: 'Duvets, blankets, linen — deep washed and dried',    base: 38000, eta: '48 h turnaround', turnaround_h: 48 },
    },
    units: {
      small:  { key: 'small',  name: 'Small load (up to 8 kg)',   mult: 1.0 },
      medium: { key: 'medium', name: 'Medium load (up to 15 kg)', mult: 1.5 },
      large:  { key: 'large',  name: 'Large load (up to 25 kg)',  mult: 2.0 },
    },
  },
};

const SERVICE_KEYS = Object.keys(SERVICES);

// Suggested price only — every pro sets their own. Used to pre-fill the pricing form.
function quote(serviceKey, packageKey, unitKey) {
  const svc = SERVICES[serviceKey];
  if (!svc) return null;
  const pkg = svc.packages[packageKey];
  const unit = svc.units[unitKey];
  if (!pkg || !unit) return null;
  return Math.round(pkg.base * unit.mult / 100) * 100; // round to whole rand
}

// A pro's own price for a package, scaled by the vehicle/load multiplier.
function priceFor(serviceKey, packageKey, unitKey, supplierBaseCents) {
  const svc = SERVICES[serviceKey];
  const unit = svc?.units[unitKey];
  if (!svc || !svc.packages[packageKey] || !unit || !supplierBaseCents) return null;
  return Math.round(supplierBaseCents * unit.mult / 100) * 100;
}

// Our margin, added on top of what we pay the pro, to reach FreshAF's selling price.
function platformFee(supplierPriceCents, pct) {
  return Math.round(supplierPriceCents * pct / 100 / 100) * 100;
}

// Public catalog shape for the frontend. openKeys: the services customers can book right
// now (a service switched off in the admin app is left out entirely, so no app version,
// old or new, can show it).
function catalog(openKeys = SERVICE_KEYS) {
  const out = {};
  for (const [key, svc] of Object.entries(SERVICES)) {
    if (!openKeys.includes(key)) continue;
    out[key] = {
      key, name: svc.name, providerNoun: svc.providerNoun, unitLabel: svc.unitLabel,
      book_ahead: !!svc.bookAhead,
      card_only: !!svc.cardOnly,
      packages: Object.values(svc.packages).map((p) => ({ ...p, quote_only: !!p.quoteOnly })),
      units: Object.values(svc.units),
    };
  }
  return out;
}

// What a service is called in messages, emails and alerts.
const SERVICE_LABELS = { carwash: 'Car wash', laundry: 'Laundry', detailing: 'Detailing' };
function serviceLabel(key) { return SERVICE_LABELS[key] || 'Car wash'; }

module.exports = { SERVICES, SERVICE_KEYS, quote, catalog, priceFor, platformFee, serviceLabel, SERVICE_LABELS };
