// Google Maps Platform: address search and real driving distances.
//
// Why pay for this at all. Two things were wrong with the free stack:
//
//   1. OpenStreetMap knows most South African streets but few house numbers, so
//      "12 Rivonia Rd" matched nothing and the customer had to re-type the number
//      onto a street-level pin. A mobile service that arrives at the wrong house
//      loses the job and the rating.
//   2. Distance was straight-line (haversine). The callout fee is R10 per km beyond
//      5 km, so in a city with a mountain and a highway in the way, a 6 km
//      straight-line trip that is really a 19 km drive was undercharged by R130 —
//      and FreshAF, as merchant of record, eats that difference.
//
// What we deliberately do NOT buy: map tiles. Leaflet on OpenStreetMap tiles is free
// and already works. Google is worth money for the data that was wrong (addresses and
// driving distances), not for the picture.
//
// Everything degrades to the old free behaviour when GOOGLE_MAPS_API_KEY is unset, so
// the app keeps working without a key — just less precisely.
const KEY = process.env.GOOGLE_MAPS_API_KEY || '';

const PLACES = 'https://places.googleapis.com/v1';
const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Keep calls inside South Africa. Cheaper, and it stops "Springfield" resolving to Ohio.
const REGION = 'ZA';

function hasGoogle() {
  return Boolean(KEY);
}

async function googleJson(url, { method = 'GET', body, fieldMask } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      'X-Goog-Api-Key': KEY,
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Google returned non-JSON (${r.status})`);
  }
  if (!r.ok) {
    const msg = data?.error?.message || text.slice(0, 200);
    throw new Error(`Google ${r.status}: ${msg}`);
  }
  return data;
}

/* ---------- address autocomplete ---------- */
// Autocomplete returns place ids, not coordinates. The session token ties the typing
// and the follow-up details lookup into ONE billable session instead of one charge per
// keystroke, so it matters to the bill, not just to correctness.
async function autocomplete(input, sessionToken) {
  const data = await googleJson(`${PLACES}/places:autocomplete`, {
    method: 'POST',
    body: {
      input,
      includedRegionCodes: [REGION.toLowerCase()],
      languageCode: 'en',
      ...(sessionToken ? { sessionToken } : {}),
    },
  });
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => {
      const main = p.structuredFormat?.mainText?.text || p.text?.text || '';
      const secondary = p.structuredFormat?.secondaryText?.text || '';
      return {
        label: [main, secondary].filter(Boolean).join(', '),
        place_id: p.placeId,
        // Google does not say "this is a house" here. A leading street number is the
        // honest proxy, and it drives the "add your street number" hint in the UI.
        precision: /^\s*\d/.test(main) ? 'house' : 'street',
      };
    })
    .filter((x) => x.label && x.place_id)
    .slice(0, 6);
}

// Resolve a place id to coordinates. Charged once per session when it follows
// autocomplete with the same token.
async function placeDetails(placeId, sessionToken) {
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const data = await googleJson(`${PLACES}/places/${encodeURIComponent(placeId)}${qs}`, {
    fieldMask: 'location,formattedAddress,shortFormattedAddress',
  });
  if (!data?.location) return null;
  return {
    label: data.shortFormattedAddress || data.formattedAddress || '',
    lat: data.location.latitude,
    lng: data.location.longitude,
  };
}

/* ---------- driving distance ---------- */
// Rounded to ~110 m. Two customers in the same street should not cost two API calls,
// and a pro's pin moves constantly while they drive.
const routeCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(from, to) {
  const r = (n) => Number(n).toFixed(3);
  return `${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}`;
}

// Returns { km, minutes } by road, or null when we cannot find out. Callers fall back
// to haversine rather than failing a quote — a fee slightly wrong beats no price at all.
async function drivingDistance(from, to) {
  if (!hasGoogle()) return null;
  const key = cacheKey(from, to);
  const hit = routeCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  try {
    const data = await googleJson(ROUTES, {
      method: 'POST',
      // TRAFFIC_UNAWARE is the Essentials tier: cheapest, and traffic at quote time
      // tells us nothing about traffic when the pro actually drives.
      fieldMask: 'routes.distanceMeters,routes.duration',
      body: {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        regionCode: REGION,
      },
    });
    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;
    const value = {
      km: route.distanceMeters / 1000,
      minutes: route.duration ? Math.round(Number(String(route.duration).replace('s', '')) / 60) : null,
    };
    if (routeCache.size > 2000) routeCache.clear();
    routeCache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (e) {
    console.error('[FreshAF] Routes lookup failed:', e.message);
    return null;
  }
}

module.exports = { hasGoogle, autocomplete, placeDetails, drivingDistance };
