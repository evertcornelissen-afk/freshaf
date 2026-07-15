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
  laundry: {
    key: 'laundry',
    name: 'Laundry',
    providerNoun: 'laundry pro',
    unitLabel: 'Load size',
    packages: {
      wash_fold: { key: 'wash_fold', name: 'Wash & Fold',       desc: 'Washed, tumble-dried and neatly folded',            base: 22000, eta: '24–48 h turnaround' },
      wash_iron: { key: 'wash_iron', name: 'Wash, Dry & Iron',  desc: 'Full wash plus professional ironing, ready to wear', base: 32000, eta: '48 h turnaround' },
      bedding:   { key: 'bedding',   name: 'Duvets & Bedding',  desc: 'Duvets, blankets, linen — deep washed and dried',    base: 38000, eta: '48 h turnaround' },
    },
    units: {
      small:  { key: 'small',  name: 'Small load (up to 8 kg)',   mult: 1.0 },
      medium: { key: 'medium', name: 'Medium load (up to 15 kg)', mult: 1.5 },
      large:  { key: 'large',  name: 'Large load (up to 25 kg)',  mult: 2.0 },
    },
  },
};

const SERVICE_KEYS = Object.keys(SERVICES);

function quote(serviceKey, packageKey, unitKey) {
  const svc = SERVICES[serviceKey];
  if (!svc) return null;
  const pkg = svc.packages[packageKey];
  const unit = svc.units[unitKey];
  if (!pkg || !unit) return null;
  return Math.round(pkg.base * unit.mult / 100) * 100; // round to whole rand
}

// Public catalog shape for the frontend.
function catalog() {
  const out = {};
  for (const [key, svc] of Object.entries(SERVICES)) {
    out[key] = {
      key, name: svc.name, providerNoun: svc.providerNoun, unitLabel: svc.unitLabel,
      packages: Object.values(svc.packages),
      units: Object.values(svc.units),
    };
  }
  return out;
}

module.exports = { SERVICES, SERVICE_KEYS, quote, catalog };
