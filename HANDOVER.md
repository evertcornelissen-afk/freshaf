# FreshAF — Handover / context for a new chat

*Last updated: 28 July 2026. Paste this file (or point Claude at it) to resume work in a fresh session.*

## What FreshAF is
On-demand marketplace, South Africa. Two services: **mobile car wash** and **laundry
collection**. Customers book, the pro they choose comes to them. Built as a web app + PWA.

## Live URLs
| What | URL |
|---|---|
| **The real app (customers)** | https://freshaf.io |
| **FreshAF Pro (providers)** | https://freshaf.io/supplier |
| **Admin console** | https://freshaf.io/admin — `admin@freshaf.co.za` / `on7bBgRpXyC50sPVTQmk` |
| Marketing site | https://freshaf.netlify.app |
| Interactive demo (simulated) | https://freshaf.netlify.app/app/ |
| Code | https://github.com/evertcornelissen-afk/freshaf (public — was made public so Render could fetch it) |

## Infrastructure
- **Render** web service `srv-d9eavarrjlhs73c2u3ag`, region Frankfurt. **FREE PLAN.**
  - ⚠️ **No persistent disk — the database is wiped on every restart/redeploy.** This is the
    single most important outstanding item. Fix: add a card at dashboard.render.com/billing,
    then upgrade to Starter + attach a 1 GB disk at `/opt/render/project/src/data`.
  - Render does **not** auto-deploy on git push. After pushing, trigger manually:
    `POST https://api.render.com/v1/services/srv-d9eavarrjlhs73c2u3ag/deploys` with the
    Render API key (Evert has it; ask him — not stored in the repo).
- **Netlify** site `7250306b-6d15-4420-a20e-496571ed8eca` — marketing + demo + a scheduled
  function (`netlify/functions/keepwarm.mjs`) that pings Render every 10 min so the free tier
  doesn't sleep. Deploy: `netlify deploy --prod --site 7250306b-...`
- **PayFast** merchant 18767813 — integrated and live-mode, but the **account is still pending
  PayFast's own verification**, so card payments fail at their end. Cash works fully.
- **Domain** freshaf.io — bought, live, pointing at Render.

## THE PRICING MODEL (rebuilt 28 July — this is the current model)
**Pros set their own prices. FreshAF adds 10% ON TOP, paid by the customer.**
- Pro sets a price per package (e.g. Express Wash = R250) in FreshAF Pro → `supplier_prices` table.
- The vehicle/load multiplier still applies on top of the pro's price (sedan ×1, SUV ×1.25, etc.).
- Customer picks a **specific pro** from a list showing that pro's price, distance and rating.
- Customer pays: `pro price + callout fee + 10% platform fee`. **The pro keeps 100% of their
  price + the callout.** Our fee never comes out of their money.
- Verified working: pro sets R250 → customer pays R275 → pro earns R250.
- **Cash jobs:** the pro collects our 10% at the door, so it's owed back to us. Tracked on
  `orders.fee_settled` and surfaced in the pro's earnings as "fee owed". **There is no
  collection mechanism yet — this is an open business decision.**
- Dispatch offers **only to the chosen pro**. If they decline/time out the order goes to
  `no_providers` and the customer picks again — deliberately no silent substitution, because
  another pro's price would differ from what the customer agreed.
- Old 15%-deducted commission model is gone. `commission_pct` setting still exists but
  `platform_fee_pct` (=10) is what's used.

## Customer flow (rebuilt 28 July)
Home (logged out) → register/login → **category chooser: Car Wash or Laundry** → booking
(package → vehicle/load → map pin + address → **choose your pro** → payment) → live tracking.

## Key features already built
- Two services, service-filtered dispatch, per-service job lifecycle wording.
- Pro app: onboarding (ID/docs upload, banking, services, vehicles, equipment), **own pricing**,
  **own radius**, online/offline, job alerts (in-app SSE + Web Push + WhatsApp option is
  advertised but **Web Push only is built — WhatsApp alerts are NOT implemented yet**).
- Rewards: customer earns 5% of completed order value, redeemable, refunded on cancel.
- Callout fee: free ≤5 km from the pro, R10/km after, capped R150 (admin-tunable).
- Address autocomplete (Photon/OpenStreetMap via `/api/geocode`), show-password toggles.
- Light/dark theme with a dark-mode logo variant.
- T&C + POPIA privacy policy, enforced acceptance, in-app account deletion (App Store requirement).
- Admin: approvals with documents + banking visible, bulk supplier import, live settings.
- PWA installable; separate "FreshAF Pro" manifest for providers.

## Brand rules (Evert's, non-negotiable)
- Slogan: **"Consider it done."**
- **Never use the word "fresh" in a headline** — the logo owns it.
- **No prices and no city/suburb names in marketing creative** — brand is national (South Africa).
- **No emojis** in brand surfaces.
- Colours: petrol `#10424F`, cyan `#1799C2`. Logo is an italic two-tone wordmark
  (`public/img/logo.svg`, dark variant `logo-dark.svg`).

## Documents on Evert's Desktop
- `FreshAF Marketing Plan.docx` — 13-page plan (for investor/partner meetings)
- `FreshAF Supplier Outreach Tracker.xlsx` — 20 researched Northern Suburbs businesses, live
  dashboard, cold-call playbook
- `FreshAF Pro Brochure - Car Wash.pdf` / `- Laundry.pdf` — recruitment brochures, WhatsApp CTA
  **078 299 1050** with a tappable wa.me link

## In-repo docs
`ROADMAP.md` (levers, roles, 4-phase growth plan) · `marketing/CAMPAIGN.md` (full campaign) ·
`SUPPLY-TARGETS-NORTHERN-SUBURBS.md` (recruitment list) · `STORE-LAUNCH.md` (App/Play Store
requirements) · `DEPLOY.md` · `marketing/make-brochures.py` (regenerates the PDFs)

## People
- **Evert Cornelissen** — founder. Owns ops, marketing, supply recruitment, pricing decisions.
- **A lawyer partner** — owns all legal. First deliverable: the Supplier/Pro Agreement
  (contractor status). Company (Pty Ltd) **not yet registered** — everything is currently in
  Evert's personal name, including the PayFast account.

## OUTSTANDING — in priority order
1. **Render card → Starter plan + persistent disk.** Until then production data can vanish.
2. **PayFast account verification** (their side) — then card payments work.
3. **Load suppliers.** Nothing else matters without supply. Brochures + tracker + call script ready.
4. **Decide how the 10% is collected on cash jobs.** Currently only tracked, not collected.
5. **WhatsApp job alerts** — promised on the brochures, not built (Web Push is).
6. Register the Pty Ltd; move domain/PayFast/accounts into it.
7. Social accounts (Instagram + TikTok) — kit ready at `marketing/social/SOCIAL-SETUP.md`.
8. Update T&C to describe the new pricing model (it still describes commission).

## Working notes for whoever picks this up
- Windows machine. **No LibreOffice** — convert Office docs via **Microsoft Word/Excel COM in
  PowerShell**, render PDFs to images with **PyMuPDF**. Chrome headless (`--print-to-pdf`) is
  what generates the brochures.
- PowerShell 5.1 mangles `git commit -m` messages containing double quotes — use plain text.
- `npm install` of native modules fails (no VS build tools) — the app uses Node's built-in
  `node:sqlite`, not better-sqlite3.
- Files drift between sessions — **grep before editing**, don't trust remembered line numbers.
- **Always visually verify generated images/PDFs** by rendering and reading them back. Evert
  will spot anything sloppy immediately, and has rejected AI imagery of cars and people before
  (use real CC0 photos for vehicles/people; AI is fine for textiles and tight hand shots).
