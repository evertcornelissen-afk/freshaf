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

*Checked against Google's own pricing page, 19 November 2026.*

Google's free monthly allowance is **10,000 calls per product**, and each product is counted
separately:

| What FreshAF uses | Free each month | Price after that |
|---|---|---|
| Map picture (Maps JavaScript API, Dynamic Maps) | 10,000 loads | $7.00 / 1,000 |
| Address suggestions (Autocomplete Essentials) | 10,000 | $2.83 / 1,000 |
| Driving distance (Compute Routes Essentials) | 10,000 | $5.00 / 1,000 |
| Pro business lookup (Text Search) | — | runs once per application, a handful a month |

Roughly per booking: one address session, one or two route calls, three to five map loads.
So **R0 up to about 2,000 bookings a month**, and only tens of dollars a month beyond that —
map loads cross the line first. Google adds 15% South African VAT, which FreshAF cannot claim
back (not VAT-registered), so treat any quoted price as price + 15%.

**The old $200 monthly free credit no longer exists.** Google replaced it with the per-product
allowances above in March 2025. Any advice that mentions the $200 credit is out of date.

Two things keep this safe, and they do different jobs:

- A **budget alert** only emails you. It does not stop spending. Useful, not protection.
- A **daily quota cap** actually refuses calls once hit. This is the real protection.

Caps are set to keep FreshAF inside the free allowance (see step 4). When a cap is hit the map
falls back to OpenStreetMap on its own via `gm_authFailure` in `public/js/map.js`, so a booking
can still be placed — a hit cap costs a nicer map, never a lost job.

## There is a US$30 toll at the door — correction, 19 November 2026

The "Cost" section above is about **usage**, and it is right: 10,000 free calls per product a
month, so FreshAF's running cost really is R0 for a long time. But opening the billing account
is not free, and this was only visible once the account existed.

Google closed the new billing account `01607A-E49E72-EB81FF` the moment it was created, with:

> "This billing account is closed. Reopen it to continue using linked projects."

and the reopen button disabled, explaining:

> "You can't reopen this billing account because this account is not in good standing."

The Payments Centre alerts give the real reason — three critical alerts on the profile:

| Alert | Google's wording | Action |
|---|---|---|
| **Payment pending** | "Google Cloud 01607A-E49E72-EB81FF: Your service requires a one-off payment of at least **US$30.00**…" | Pay now |
| **Payment method can't be used** | "Provide the missing details to use Visa ••••9801 to pay." | Update |
| **Verify your identity** | "Provide some info about yourself to continue." | Verify now |

So the real prerequisites are **identity verification plus a one-off US$30 payment**, not just a
card on file. Whether that US$30 is a deposit credited against usage or a non-refundable fee is
not stated in the alert — the "Pay now" screen will say, and it should be read before paying.

**This also explains the first failed attempt.** The account was not "never created": it was
created and immediately closed for the same reason. Any future attempt will fail the same way
until the three alerts are cleared.

All three are Evert's: they involve paying money and uploading identity documents.

## Setup — Google Cloud project `freshaf-514810` (already created)

**Evert (card, money):**
1. Billing → create a billing account (country **South Africa**, type **Business**, name
   **FreshAF (Pty) Ltd**), add the card, and link it to project **FreshAF**
   (`freshaf-514810`). Leave the VAT number blank — FreshAF is not VAT-registered.
   Then Billing → Budgets & alerts → budget **$10/month**, alerts at 50/90/100% to
   admin@freshaf.io.

   **The currency is locked to USD** — the create form offers no choice for South Africa. So
   the card is charged in dollars and the bank adds its own forex markup on top of the 15% VAT.
   Irrelevant at R0, worth knowing before the first real bill.

   *State on 19 November 2026: no billing account exists on the Google account at all, and
   none of the three Maps APIs are enabled yet. Only the default BigQuery/Storage APIs are on.
   This step is the only thing blocking the rest.*

### The payments profile is INDIVIDUAL and cannot be made a business one without a support ticket

*Learned the hard way on 19 November 2026, mid-flow.*

Google Cloud's "Set up your billing profile" page silently reuses the **existing personal
payments profile** — on this account that is `E CORNELISSEN`, type **Individual**, shared with
Google Play Apps, Google One and YouTube. Submitting with it would make the Google Cloud bill a
personal expense invoiced to a person, not to FRESHAF (PTY) LTD.

**Google cannot change a payments profile's account type after it is created.** Its own help
says so ([Set your account type](https://support.google.com/paymentscenter/answer/11543916),
[Create & manage your payments profile](https://support.google.com/paymentscenter/answer/9028746));
AdSense spells out the only remedy — cancel and open a new one
([AdSense](https://support.google.com/adsense/answer/10163?hl=en-GB)). So this is a one-way
door and it must be got right before pressing **Submit and enable billing**.

**A business profile is not self-service.** The Payments Centre shows an edit pencil next to
ACCOUNT TYPE, but clicking it only prints Google's refusal:

> "Your account type can't be changed since it's subject to specific tax laws and other
> regulations. If you're now registered as an organisation and would like to file taxes and
> receive invoices through your organisation, contact support to create a new account type."

So the only route to a business profile is a **Google support ticket**, which takes days. Google
Cloud's billing page also offers no profile chooser at all — it is locked to the single existing
profile, so a new one cannot be made from inside the Cloud flow either.

**Why this is not worth blocking on.** The payments profile is permanent, but a **Cloud project
can be moved between billing accounts at any time**. So when a business profile does exist, the
fix is: make a new billing account on it and relink the FreshAF project. Nothing is lost by
starting on the individual profile, and the money leaves the company account regardless because
the card is the company's.

**Decision, 19 November 2026:** proceed on the individual profile with the company card, and
raise the support ticket separately if the Google bill ever becomes material. At an expected R0
it is a bookkeeping nicety, not a problem.

If and when the support ticket is raised, these are the details to give:

| Field | Value |
|---|---|
| Account type | **Organisation / Business** (never Individual) |
| Name | **FRESHAF (PTY) LTD** |
| Address | 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights |
| City / Province / Code | Cape Town, Western Cape, **7570** |
| Country | South Africa |
| Tax / VAT number | **Leave blank** — FreshAF is not VAT-registered |
| Payment method | **FNB Gold Business Debit, Visa ••5406** (already on the account) |

**No card number ever needs typing.** Four cards are already saved on the Google account:

| Card | State |
|---|---|
| RMB Private Bank Debit, Visa ••8290 | the default — personal, do not use |
| **FNB Gold Business Debit, Visa ••5406** | **the one to use** — business, no warnings |
| FNB Platinum Business Debit, Visa ••0729 | Google warns: make sure it is active with enough funds |
| FNB Gold Business Debit, Visa ••9801 | Google warns: more card info needed |

The payment method **resets to the RMB personal card whenever the page reloads**, so check it
reads FNB Gold Business Debit ••5406 immediately before submitting.

**State at 19 Nov 2026:** billing account shell `01607A-E49E72-EB81FF` named "FreshAF (Pty) Ltd"
exists, the card is set to FNB Gold Business Debit ••5406, and everything is staged. It is
**not enabled** — nothing submitted, no money committed, project still unlinked. The one
remaining step is pressing **Submit and enable billing**, which Evert must click himself:
Claude's auto-mode classifier refuses to commit a payment method.

**Claude (after billing is linked):**
2. Enable: **Maps JavaScript API**, **Places API (New)**, **Routes API**.
3. Create **two keys** (names below). Nothing is pasted into chat.
   - `FreshAF server` → API restriction: Places API (New) + Routes API. No website
     restriction (Render's outgoing address changes). → Render `GOOGLE_MAPS_API_KEY`.
   - `FreshAF browser map` → API restriction: Maps JavaScript API only. Website restriction:
     `https://freshaf.io/*`, `https://www.freshaf.io/*`, `https://localhost/*` (Android app),
     `capacitor://localhost/*` (iPhone app), `http://localhost:5757/*` (testing).
     → Render `GOOGLE_MAPS_BROWSER_KEY`.
4. Quotas (the part that actually stops a bill): **300 per day** on each of Maps JavaScript
   API map loads, Places autocomplete requests and Routes compute-routes. 300/day is 9,300 a
   month, just inside the free 10,000, and still roughly 60-100 bookings a day of capacity.

   **Do not use the old 1,000/2,000/2,000 caps that used to be written here.** Over 30 days
   those permit about **$530 a month** while the budget alert claims $10. They were written
   when the $200 credit still existed. Corrected 19 November 2026.

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

*Rechecked 19 November 2026 by unzipping both files.*

| File | Built | Has the Google map code | What to do |
|---|---|---|---|
| Play Store bundle `app-release.aab` (release 13, in review) | 17 Nov | **Yes** (`google_key` present) | **Nothing.** It picks up Google Maps as soon as the keys are on Render — no rebuild, no resubmission. |
| Sideload APK at `/download/freshaf.apk` | 9 Nov | No | Leave it. |

The earlier note here said to rebuild and re-upload the APK alongside the keys. That is no
longer worth doing: the sideload APK is retired the day the Play release goes live (see the
comment on the `/download/freshaf.apk` route in `server/index.js`). Until then it keeps working,
just with OpenStreetMap's picture and Google's addresses.

**Nothing in either app needs a rebuild for Maps.** The browser key is fetched at runtime from
`/api/map-config`, which is why. Same reason the Stitch keys need no rebuild.
