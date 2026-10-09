# FreshAF — Handover / context for a new chat

*Last updated: 19 August 2026. Paste this file (or point Claude at it) to resume work in a fresh session.*

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
  - **`JWT_SECRET` is now set as a Render environment variable (19 Aug).** Before that, the
    signing secret lived in `data/jwt.secret` on the ephemeral disk, regenerated on every
    deploy, and silently invalidated every login cookie. Env vars survive restarts, so that
    cause of being signed out is gone. **This is only half the fix** — see the disk item above:
    if the database itself is reset, the user account is gone regardless of a valid cookie.
  - **AUTO-DEPLOY — fixed 19 Aug. Pushes now deploy on their own.** The cause was that Render
    had **no GitHub connection at all**: Settings → Source → Edit showed *"No repositories found"*,
    because the service was created from a **public Git URL**. Render can clone a public URL but
    gets no webhook from it, which is why Auto-Deploy read "On Commit" while nothing happened,
    and why every build log warned
    `It looks like we don't have access to your repo, but we'll try to clone it anyway.`
    Evert installed **Render's GitHub app**, which fixed it. Verified: pushing `065202f`
    started and completed a deploy with no manual click.
    (A stop-gap GitHub push webhook onto Render's Deploy Hook was tried first; once the app was
    installed it caused **two deploys per push**, so it was deleted. If you ever see duplicate
    deploys again, check `gh api repos/evertcornelissen-afk/freshaf/hooks` for a stray hook.)
  - Manual trigger via the dashboard: Events page → **Manual Deploy → Deploy latest commit**.
    The dropdown is flaky under automation — clicking the button sometimes toggles without
    rendering the menu; click, check for the menu, click again if it did not open.
  - Or trigger via the API. After pushing:
    `POST https://api.render.com/v1/services/srv-d9eavarrjlhs73c2u3ag/deploys` with the
    Render API key (Evert has it; ask him — not stored in the repo).
- **Netlify** site `7250306b-6d15-4420-a20e-496571ed8eca` — marketing + demo + a scheduled
  function (`netlify/functions/keepwarm.mjs`) that pings Render every 10 min so the free tier
  doesn't sleep. Deploy: `netlify deploy --prod --site 7250306b-...`
- **PayFast** merchant 18767813 — integrated, live-mode, and **VERIFIED since 27 July 2026**
  (email from Ebrahim Salie, Onboarding Compliance Specialist, Payfast/Network; confirmed by
  noreply@payfast.io the same day). The old "pending verification" note was wrong.
  ⚠️ **Open question:** verification predates the company (26 Aug) and the FNB account (8 Oct),
  so the nominated payout account is probably NOT FreshAF's. Check the entity and payout
  account in the Payfast dashboard — see `PAYFAST-REGISTRATION.md`.
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

## HYBRID QUOTING (built 19 Aug — this replaces choose-a-pro-from-a-price-list)
The customer logs the job **once**; pros answer with their own price and availability.
- Prices in the catalogue are **indicative only** and shown as "from R180".
- `POST /api/quote-requests` opens a request and asks every approved, online pro whose radius
  covers the pin and who offers that service.
  - Pros **with** a published price list are auto-quoted instantly (`quotes.source = 'auto'`),
    so the customer normally has something bookable within a second.
  - Pros **without** one get a push/WhatsApp/SSE nudge and send their own price + availability
    (`source = 'manual'`). They can also override their published price for a specific job.
- Quotes stream to the customer live over SSE (`quotes_update`).
- `POST /api/quotes/:id/accept` books that pro at exactly their quoted price. **A quote is the
  pro's commitment, so there is no second accept step** — a cash order goes straight to
  `accepted`. Card orders go `pending_payment` and are confirmed by `afterPayment()`.
- Requests expire after `quote_window_min` (default 30) and are swept once a minute.
- **A pro no longer needs a price list to go online.** That block was removed — it kept
  per-job operators off the platform entirely.
- Tables: `quote_requests`, `quotes`. Logic in `server/quotes.js`.
- The old `/api/quote/providers` and `POST /api/orders` paths still exist and still work.

### Scheduling (added 20 Aug)
Step 4 of the booking form is **As soon as possible** or **Schedule a time** (datetime-local,
15-minute steps, 15 min to 30 days ahead, validated server-side in `parseScheduledFor`).
Stored on `quote_requests.scheduled_for` and copied to `orders.scheduled_for` as **local wall
time** (`2026-08-23 14:30`) — South Africa is a single zone with no daylight saving, so nothing
is converted. Pros see the slot on the request card and quote against it.
**Important consequence:** the "pro is already busy" filter is skipped for scheduled work, in
`quotes.eligiblePros`, in quote acceptance and in `afterPayment`. A pro mid-job today can and
should be able to take a booking for Saturday — verified a pro holding an ASAP job and a future
booking at the same time.

## Customer flow (rebuilt 28 July, quoting added 19 Aug)
Home (logged out) → register/login → **category chooser: Car Wash or Laundry** → booking
(package → vehicle/load → map pin + address → **choose your pro** → payment) → live tracking.

## Key features already built
- Two services, service-filtered dispatch, per-service job lifecycle wording.
- Pro app: onboarding (ID/docs upload, banking, services, vehicles, equipment), **own pricing**,
  **own radius**, online/offline, job alerts (in-app SSE + Web Push + **WhatsApp**).
- **WhatsApp job alerts (built 19 Aug).** Meta WhatsApp Cloud API. Pro verifies their number
  with a 6-digit code, then every job offer also arrives on WhatsApp; per-pro on/off toggle.
  Runs in **dry run** (logged to `whatsapp_log`, printed to console) until four env vars are
  set — **see `WHATSAPP-SETUP.md`**, which has the exact Meta templates to register. Needs a
  **spare SIM**: the API number can no longer be used in normal WhatsApp, so not 078 299 1050.
- **Admin sign-up register (built 19 Aug).** Searchable list of every customer who signed up
  (name, email, phone, address, date, orders, rewards), CSV export at
  `/api/admin/customers.csv`, plus signed-up-this-week / this-month growth stats for investors.
- Rewards: customer earns 5% of completed order value, redeemable, refunded on cancel.
- Callout fee: free ≤5 km from the pro, R10/km after, capped R150 (admin-tunable).
- Address autocomplete (Photon/OpenStreetMap via `/api/geocode`), show-password toggles.
- Light/dark theme with a dark-mode logo variant.
- T&C + POPIA privacy policy, enforced acceptance, in-app account deletion (App Store requirement).
  **Rewritten 19 Aug** for pro-set pricing: what you pay, choosing your pro, payment, and a new
  **section 11 "Terms for Pros"** (contractor status, own prices, keep 100%, cash fee owed back).
  Customers and pros accept the same page, so both are now covered. **Still needs the lawyer's
  review**, and the separate Supplier Agreement is still his first deliverable.
- Customer front door is the **two service buttons side by side** (Car Wash / Laundry) at every
  screen width; choosing one before signing up carries through registration into that booking.
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

## THE COMPANY (registered 26 Aug 2026 — this supersedes "not yet registered")
**FRESHAF (PTY) LTD**, registration **2026/683087/07**, incorporated 26 August 2026, standard
MOI (CoR 15.1A), financial year end February, status IN BUSINESS.
- Directors: **MERTENS, NIKKI** and **CORNELISSEN, EVERT**, both active from 26/08/2026.
- Registered office: 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights, Cape Town,
  Western Cape, 7570 (a residential address — it is published on `/contact`, see note there).
- Bank: **FNB Gold Business Account**, Durbanville branch 210203, opened 08/10/2026, in the
  company name with the registration number matching CIPC exactly.
  WARNING: the confirmation letter says the account **has not yet been activated with a deposit**.
- WARNING: **Beneficial Ownership** was due at CIPC within 10 business days of registration
  (approx 9 September 2026) — verify whether it was filed.
- WARNING: CIPC holds **RPELLETDP@GMAIL.COM** as the company contact email, not Evert's.
- Source documents live in the `FreshAF` folder on Evert's Desktop.
- Full PayFast document pack and the two blockers: **`PAYFAST-REGISTRATION.md`**.

## People
- **Evert Cornelissen** — founder. Owns ops, marketing, supply recruitment, pricing decisions.
- **A lawyer partner** — owns all legal. First deliverable: the Supplier/Pro Agreement
  (contractor status). Company **FreshAF (Pty) Ltd registered 26 Aug 2026** — see the company section above.
  The PayFast merchant account (18767813) still needs FICA verification under the company.

### Why people get signed out (fixed by config, not code)
`data/jwt.secret` is generated on first boot and stored on the ephemeral disk. Every restart
or deploy on the free plan wipes it, a new secret is generated, and **every existing login
cookie becomes invalid** — so all users are silently signed out. The cookie itself is already
30 days. Fix: set **`JWT_SECRET`** as a Render environment variable (env vars survive restarts,
so this works on the free plan too). Same applies to `data/vapid.json` — losing it kills every
Web Push subscription.

## GO-LIVE (the disk cutover) — see `GO-LIVE.md`
Attaching a persistent disk mounts it **empty**, so the cutover destroys production unless it
is backed up first. Admin → Launch readiness now has **Download backup** and **Upload a backup
to restore**; `db.js` applies a staged `data/restore.db` on the next boot and logs
`Restored the database from an uploaded backup.` Tested end to end 19 Aug: wiped the database
completely, uploaded the backup, restarted — 19 customers, 15 orders and 10 approved pros all
came back. Non-SQLite uploads are rejected. **The backup covers the database only** — files in
`data/uploads/` (pro ID copies) need their own copy once pros start uploading.

## OUTSTANDING — in priority order
1. **Render card → Starter plan + persistent disk.** Until then production data can vanish.
   Evert chose this route (19 Aug) over migrating to Postgres, because Postgres would *not*
   have fixed it on its own: supplier ID copies, proof of address and work photos are files in
   `data/uploads`, and `jwt.secret` + `vapid.json` are files too — the free plan wipes those
   whatever database you use. `render.yaml` already declares the 1 GB disk at
   `/opt/render/project/src/data`; it just needs the card and the dashboard upgrade.
2. **PayFast account verification** (their side) — then card payments work.
3. **Load suppliers.** Nothing else matters without supply. Brochures + tracker + call script ready.
4. **Decide how the 10% is collected on cash jobs.** Currently only tracked, not collected.
   The pro's earnings screen now shows the running "Platform fee owed on cash jobs" balance,
   and T&C section 11 says it is held on our behalf — but there is still no collection mechanism.
5. **Switch WhatsApp alerts on** — code is built and tested; needs a spare SIM, a Meta Business
   account and the two templates approved. Follow `WHATSAPP-SETUP.md`. While you are there,
   raise Offer timeout from 60s to 120–180s or pros will lose jobs they wanted.
6. Register the Pty Ltd; move domain/PayFast/accounts into it. Also lifts the WhatsApp
   250-conversations-per-day cap that applies to unverified businesses.
7. Social accounts (Instagram + TikTok) — kit ready at `marketing/social/SOCIAL-SETUP.md`.
8. **Lawyer to review the rewritten T&C** and deliver the Supplier Agreement.

## Working notes for whoever picks this up
- Windows machine. **No LibreOffice** — convert Office docs via **Microsoft Word/Excel COM in
  PowerShell**, render PDFs to images with **PyMuPDF**. Chrome headless (`--print-to-pdf`) is
  what generates the brochures.
- PowerShell 5.1 mangles `git commit -m` messages containing double quotes — use plain text.
- `npm install` of native modules fails (no VS build tools) — the app uses Node's built-in
  `node:sqlite`, not better-sqlite3.
- Files drift between sessions — **grep before editing**, don't trust remembered line numbers.
- SQLite runs in WAL mode. `db.js` now checkpoints every 5 minutes and on shutdown — before
  that, `freshaf.db` was 4 KB while `freshaf.db-wal` held 1.4 MB, so **copying just the .db
  file would have restored an empty database**. Keep the checkpoint if you touch `db.js`.
- **Brand lockup.** The wordmark stands alone in the top bar (34px desktop, 28px mobile,
  vertically centred). **Do not stack a tagline under it** — `logo.svg` has a viewBox with its
  own baseline whitespace, so a stacked line never optically aligns no matter what the box
  measurements say. "Fresh and Fast" lives where centring makes alignment automatic: the boot
  splash and the footer. The pro and admin portals keep a short label as a **pill beside** the
  wordmark, where vertical centring is exact.
- **Motion system** lives at the bottom of `public/css/style.css` and in the MOTION block of
  `public/js/common.js`: scroll reveals, staggered groups, topbar condense, scroll-progress
  line, hero aurora, cursor-tracked card glow, count-ups, animated money totals. Two rules if
  you touch it: the hidden state is gated behind `.js-motion` (set by JS only once it knows it
  can reveal again, so a script failure never leaves a blank page), and `initMotion(node)` must
  be called for any view or markup rendered after load — `switchView` already does this.
- `.msg.error` and `.msg.ok` force `display:block`, so an empty placeholder used to render a
  bare coloured bar above every form. `.msg:empty` now hides them. Don't remove that rule.
- Inputs must stay **16px on screens under 700px**. Below that iOS Safari zooms the page on
  focus and the whole site then pans sideways on every swipe — that was the "moves left and
  right while swiping" bug.
- **Always visually verify generated images/PDFs** by rendering and reading them back. Evert
  will spot anything sloppy immediately, and has rejected AI imagery of cars and people before
  (use real CC0 photos for vehicles/people; AI is fine for textiles and tight hand shots).
