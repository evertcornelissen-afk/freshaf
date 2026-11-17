# Google Maps on freshaf.io

*15 November 2026. The code is done and tested; it switches on by itself once two keys are on Render.*

## What changes for customers and pros

| | Without keys (today) | With keys |
|---|---|---|
| Map picture | OpenStreetMap | **Google Maps** |
| Address search | OpenStreetMap: street-level, few house numbers | **Google Places**: house numbers |
| Callout fee distance | Straight line | **Real driving distance** (Google Routes) |

The same pin, blue dot and gestures on both. If Google ever refuses the key or does not load,
the page switches back to OpenStreetMap by itself (tested with a fake key), so a booking can
always be placed.

**Why the map picture changes too:** Google's terms do not allow Places or Routes results to be
shown on a non-Google map. Switching on address search alone would breach them.

## Cost

Google's free monthly allowance (per product, from March 2025) is about **10,000 calls each**
for map loads, address suggestions, address lookups and route distances. FreshAF is far below
that, so the expected bill is **R0**. A budget alert and daily caps (below) stop any surprise.

## Setup — Google Cloud project `freshaf-514810` (already created)

**Evert (card, money):**
1. Billing → create a billing account (type **Business**, name **FreshAF (Pty) Ltd**), add the
   card, and link it to project **FreshAF**. Billing → Budgets & alerts → budget **$10/month**,
   alerts at 50/90/100% to admin@freshaf.io.

**Claude (after billing is linked):**
2. Enable: **Maps JavaScript API**, **Places API (New)**, **Routes API**.
3. Create **two keys** (names below). Nothing is pasted into chat.
   - `FreshAF server` → API restriction: Places API (New) + Routes API. No website
     restriction (Render's outgoing address changes). → Render `GOOGLE_MAPS_API_KEY`.
   - `FreshAF browser map` → API restriction: Maps JavaScript API only. Website restriction:
     `https://freshaf.io/*`, `https://www.freshaf.io/*`, `https://localhost/*` (Android app),
     `capacitor://localhost/*` (iPhone app), `http://localhost:5757/*` (testing).
     → Render `GOOGLE_MAPS_BROWSER_KEY`.
4. Quotas: Maps JavaScript API map loads **1,000/day**; Places autocomplete **2,000/day**;
   Routes **2,000/day**. Generous for FreshAF, small enough that a stolen browser key cannot
   run up a bill.

**Evert (keys into Render):**
5. Each key's copy button, then Render → Environment → add the two variables. One deploy,
   outside busy hours. For local testing: copy the key, then
   `powershell -ExecutionPolicy Bypass -File scripts\set-secret.ps1 GOOGLE_MAPS_BROWSER_KEY`
   (and the same for `GOOGLE_MAPS_API_KEY`).

## Check it worked

- `curl -s https://freshaf.io/api/map-config` shows a `google_key` (it is public by design).
- Type a house number + street in the booking address box: suggestions end with "Google Maps"
  and include house numbers.
- The booking map is Google's (Google logo bottom left).
- Browsers cache the map setting for 5 minutes, so allow that long after the deploy.

## The Android app

The APK on the site (v12, 9 Nov) still has the old map file inside it. It keeps working, but it
shows OpenStreetMap with Google addresses. **Rebuild and re-upload the APK in the same batch** as
the keys, so the app shows Google's map too.
