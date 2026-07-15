# FreshAF — Fresh and Fast

On-demand **car wash + laundry** marketplace (Uber-style dispatch). Customers register with a preferred address, pick a service tab (Car Wash or Laundry), and book; the nearest available, **admin-approved** provider *of that service* gets the job offer. Suppliers register per service (car wash, laundry, or both) with their location — supply is loaded per area per vertical.

**Laundry catalog:** Wash & Fold R220 / Wash, Dry & Iron R320 / Duvets & Bedding R380 (base, × load size: small ×1, medium ×1.5, large ×2). Laundry lifecycle: accepted → collecting → laundering → delivered. Customers can run one car wash and one laundry order simultaneously.

## Run

```
cd freshaf
npm install
npm start
```

- Customer app: http://localhost:5757/
- Supplier portal: http://localhost:5757/supplier
- Admin dashboard: http://localhost:5757/admin
- Default admin login: `admin@freshaf.co.za` / `FreshAF!Admin2026` (seeded on first run; override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` **before** first run)

## How it works

1. **Suppliers apply** on `/supplier` (business name, SA ID, vehicle reg, service area, equipment). They land on an "under review" screen.
2. **Admin approves/rejects** from `/admin`. The supplier's screen flips to the live dashboard in real time (SSE).
3. Approved suppliers **go online** with their current location.
4. Customers **book** (package × vehicle type = ZAR price), drop a pin, pay by card or cash. A **callout fee** is added based on distance to the nearest online washer (free within 5 km, R10/km after, capped at R150 — all admin-tunable). Rates: Express R180 / Wash & Vacuum R280 / Full Valet R650 (base, × vehicle multiplier).
4b. **Money-back rewards:** customers earn 5% of every completed order as a rewards balance, redeemable against any future order (platform-funded — washers are always paid on full order value). Points are refunded if an order is cancelled.
5. **Dispatch** offers the job to the nearest online washer within the radius (default 25 km). Decline/timeout (60 s) cascades to the next nearest. No one available → `no_providers`, customer can retry.
6. Supplier advances the job: **en route → washing → complete**. Commission (default 15%) is recorded per completed job; customer rates the washer.

## Payments

Card payments use a **PayFast adapter**. Without merchant keys it runs in sandbox mode (an internal page simulates the redirect so the full flow works). To go live: register at payfast.co.za, copy `.env.example` to `.env`, fill in `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, and set `BASE_URL` to your public https URL (the ITN webhook needs to reach `/api/payments/payfast/itn`).

## Stack

Node 24 (built-in `node:sqlite` — no native builds), Express, JWT (httpOnly cookie) + bcrypt auth, server-sent events for realtime dispatch, Leaflet + OpenStreetMap (no API keys). Data lives in `data/freshaf.db`; delete it to reset everything.

## Admin settings (live-editable)

Commission %, dispatch radius (km), offer timeout (sec) — under Marketplace settings on `/admin`.

## App-store readiness

- **Home screen** for logged-out visitors (hero, live price showcase, how-it-works, become-a-pro), with separate Sign in / Create account flows.
- **Terms & Conditions** (`/terms`) and **Privacy Policy** (`/privacy`, POPIA) — acceptance is mandatory at registration (customers and suppliers) and stored with a timestamp.
- **Account management:** profile editing (name, phone, address) and **in-app account deletion** (password-confirmed, anonymises the user, blocked while orders are active) — required by Apple App Store Guideline 5.1.1(v).
- **PWA:** `manifest.json`, 180/192/512 px icons generated from the logo, service worker (`sw.js`, network-first) — installable from the browser today; wrap with Capacitor for the actual Apple/Google stores.

## Backlog

- Supplier document uploads (ID copy, proof of address) + payouts (EFT batch)
- Scheduled bookings, live provider GPS tracking on the customer map
- Push/WhatsApp notifications instead of in-page SSE only
- Public deployment + Capacitor wrapper for store submission
