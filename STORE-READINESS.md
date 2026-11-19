# FreshAF — store readiness (Google Play + Apple App Store), 7 Nov 2026

One page: what is ready, where it is, and exactly what Evert does, in order. Details behind
each step: `APP-STORE-SUBMISSION.md` (sections A–F) and `APP-STORE-LISTING.md` (copy).
The Android APK link (freshaf.io footer + /download/freshaf.apk, old /download/freshaf-test.apk redirects) stays until the app is on Google Play. APK v12 (9 Nov, adds the pro return-trip rate) is signed with the upload key and installs over v11; phones with the pre-v11 APK uninstall it once first.

## Ready (done by Claude)

| Item | Where |
|---|---|
| App name, subtitle, short + full description, keywords, review notes (national copy) | `APP-STORE-LISTING.md` (checked against Apple's limits) |
| AF app icon: Android launcher (all densities, adaptive) + iOS 1024px (no alpha) | `android/app/src/main/res/mipmap-*`, `ios/App/App/Assets.xcassets/AppIcon.appiconset` |
| Store icon 512×512 / 1024×1024 | `public/img/icon-512.png`, `public/img/icon-1024.png` |
| Feature graphic 1024×500 (Play) | `marketing/play-feature-graphic.png` |
| Screenshots, 5 real screens (home, compare pros, live tracking, pro dashboard, laundry) | `marketing/store-screenshots/android-1080x1920`, `iphone-6.9-1320x2868`, `iphone-6.7-1290x2796` |
| Splash screens (AF mark) | Android `res/drawable*/splash.png`, iOS `Splash.imageset` |
| iPhone-only (no iPad screenshots or iPad review needed) | `TARGETED_DEVICE_FAMILY = 1` |
| Android release signing + versioning wired; signed `.aab` build proven | `android/app/build.gradle`, `scripts/build-release.ps1` |
| Upload-key script (Evert runs it; it asks him for the password) | `scripts/make-upload-key.ps1` |
| Cloud builds: iOS → TestFlight, Android → Play internal track | `codemagic.yaml` |
| Native push: Android LIVE and tested (7 Nov, booking #10); iOS code ready, needs the APNs key | `server/native-push.js` |
| Account deletion in app + web URL | Account → Delete account; `https://freshaf.io/delete-account` |
| Privacy policy URL | `https://freshaf.io/privacy` (store version approved + published 7 Nov) |
| Data safety / App Privacy answers (incl. push token as "Device or other IDs") | `APP-STORE-SUBMISSION.md` section D |
| Stays signed in, Settings (alerts, location), standard menu, Customer/Pro sign-in | app build v9 |

## Evert's steps, in this order

**Now (no developer account needed):**
1. ✅ **DONE 7 Nov 10:29.** Upload key `%USERPROFILE%\FreshAF-keys\freshaf-upload.jks`; upload-key
   certificate SHA-256 `8D:B4:CE:AC:7C:15:D6:06:70:E0:CB:22:DB:97:85:51:58:30:84:BC:1D:FA:6D:00:9D:3B:3C:ED:C2:75:1D:A5`
   (not secret; Play shows it under App signing). First signed bundle, versionCode 10:
   `Desktop\FreshAF-release\freshaf-1.0-vc10.aab`. Key file + password backed up in Evert's password manager (7 Nov). Original step:
   **Upload key:** `powershell -ExecutionPolicy Bypass -File scripts\make-upload-key.ps1`. Choose
   the password yourself; save the `.jks` file and the password in your password manager.
2. ✅ **DONE 7 Nov.** Privacy policy approved by Evert and published at https://freshaf.io/privacy.
3. ✅ **DONE 7 Nov 13:53.** Reviewer accounts created by Evert (script): demo customer review@freshaf.io and demo pro review-pro@freshaf.io, approved and ONLINE (Durbanville, 25 km, car wash + laundry). Logins in `REVIEWER-LOGINS.md` (git-ignored). Original step, kept for resets:
   - DONE 7 Nov: `review@freshaf.io` and `review-pro@freshaf.io` are aliases of admin@freshaf.io.
   - Either run `powershell -ExecutionPolicy Bypass -File scripts\make-reviewer-logins.ps1`
     (asks for the admin password, saves both logins to `REVIEWER-LOGINS.md` in the freshaf
     folder: git-ignored, readable only by Evert's Windows user, never printed), or:
   - Admin app → **Store reviewer accounts** → **Create reviewer accounts**. It makes a demo
     customer and a demo pro (approved, priced, car wash + laundry, ONLINE in Durbanville, 25 km)
     and shows both passwords once. **Copy sign-in details** → password manager.
   - Lost a password, or after review: press it again; it resets both and puts the pro online.
   - The two email/password pairs go only into Play "App access" (step 6) and Apple "Sign-in
     Information" (step 8).
4. **Real pros tomorrow:** reviewers book from outside SA, so the demo pro covers them; real pros
   are for real customers. Both stores reject an app that looks empty.

**D-U-N-S status:** requested via Apple's lookup tool (Evert, Fri 6 Nov); D&B acknowledged it to admin@freshaf.io on Sun 8 Nov 00:32 (donotreply@iresearch.dnb.com): **Tracking ID 11193219, Case 11252150, Request key 4NVGG9ZW9U**, submitted 7 Nov 22:31 UTC, type "Add business - Mini Inquiry" (new listing; the Duns field was still blank on 9 Nov). D&B promises contact within 5 business days, so by **Fri 13 Nov**. If nothing by then: Apple Developer support (developer.apple.com/contact > Membership and Account > Program Enrollment, phone callback) quoting the case number. The number is free: ignore paid "expedite" offers and anyone not from dnb.com / dnbsame.com.

**✅ D-U-N-S ISSUED 17 Nov 2026, 16:07.** "Your D&B D-U-N-S Number has been created - Case 35007250"
(D&B Notification, to admin@freshaf.io, landed in the GoDaddy spam folder):

| | |
|---|---|
| **D-U-N-S Number** | **588248848** |
| **Legal Business Name** | **FRESHAF (PTY) LTD** |

D&B's own instruction: *enter the number and business name exactly as provided* — so **FRESHAF (PTY)
LTD**, no space in FRESHAF, not "FreshAF (Pty) Ltd". The mail carries no address, so the registered
office is not restated there; CIPC's is 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights,
Cape Town 7570. This is our own case (35007250), not the one D&B wrongly closed against 654518140,
which belongs to a different company and must never be used.

⏳ **"Your newly-created DUNS number will be eligible for Apple Registration after 24-48 hours."**
Created 17 Nov 16:07, so Apple enrolment opens somewhere between **18 Nov evening and 19 Nov
afternoon**. Attempting it earlier risks burning one of the limited D-U-N-S attempts for nothing.

⚠️ **This mail went to spam and Outlook never showed it.** The Spam folder for admin@freshaf.io
reads 0 items on this PC even after a forced send/receive, so anything GoDaddy quarantines —
D&B, Stitch, Apple, a pro's reply — is invisible here. Re-subscribe that IMAP folder
(Outlook → Folder → IMAP Folders → Query → Subscribe to Spam) or check webmail by hand.

**Android: the account situation (found 17 Nov 2026).** Evert's Google account
(evertcornelissen@gmail.com) already holds a developer account — **"Social_Ideas", a PERSONAL
account, id 6471963390115743783, still unverified** ("Complete account verifications to create
apps"; pending: contact phone number, access to an Android device). Google allows **one developer
account per Google account**, so FreshAF cannot simply be added there as an organisation. Two routes:

- **Recommended — a second Google account for the business** (admin@freshaf.io can become a Google
  account; the mailbox already exists in Outlook) and a fresh **organisation** developer account
  under it, $25. Straight to organisation type, no personal identity verification, no 72-hour wait,
  Social_Ideas stays free for Evert's other apps, and Nikki can be given access without touching
  his personal Gmail.
- **Convert Social_Ideas to an organisation account.** Allowed, but only after that personal
  account is *fully verified* (his own ID), then freshaf.io verified as the organisation website on
  the About you tab, then Change account type with an organisation payments profile, then **72
  hours** before submitting apps. **It cannot be reversed**, and every later app Evert publishes
  from that account would be published by FreshAF (Pty) Ltd.

**When the D-U-N-S number is confirmed:**
5. **Google Play Console** (play.google.com/console): Organisation account as FreshAF (Pty) Ltd,
   **$25 once**, identity + organisation verification (D-U-N-S, registration 2026/683087/07).
   Sign in with the **business** Google account, not evertcornelissen@gmail.com — that one is used
   up by Social_Ideas (see above). Organisation verification asks for the registration number, the
   registered address and the D-U-N-S, and Google shows the business details it matched: **if the
   name or address shown is not FreshAF (Pty) Ltd at 35 Sterappel Crescent, stop and do not
   confirm.** Attempts at entering the D-U-N-S are limited.
6. **Play app setup:** Create app "FreshAF: Car Wash & Laundry" (app, free). Then:
   - Store listing: copy from `APP-STORE-LISTING.md` (Google Play section), icon 512, feature
     graphic, the 5 screenshots from `android-1080x1920`. Category Lifestyle. Country: South Africa.
   - App content: privacy policy URL, **App access** = the two reviewer accounts + the review
     notes, Ads = No, Content rating questionnaire (→ Everyone), Target audience 18+, Data safety
     (section D), account deletion URL.
   - Release → **Internal testing**: build `scripts\build-release.ps1 -VersionCode 10`, upload
     `android\app\build\outputs\bundle\release\app-release.aab`, accept **Play App Signing**.
   - Tell Claude "uploaded": Claude puts Play's SHA-256 into `assetlinks.json` (links open the app).
   - Test on your phone from the internal track, then **Promote to Production** → review.
7. **Apple Developer Program** (developer.apple.com/programs/enroll): Organisation, **$99/year**,
   D-U-N-S, legal entity FreshAF (Pty) Ltd. Apple may phone to verify. Apple fills the legal
   entity name and address **from the D-U-N-S record**, so read that screen before continuing: it
   must say FRESHAF (PTY) LTD at 35 Sterappel Crescent, 7570. Evert signs as the person with legal
   authority to bind the company (he is Managing Director). The enrolment reached this page once on
   11 Nov and was deliberately left unsubmitted because the D-U-N-S was wrong.
8. **App Store Connect:** New App → iOS, name "FreshAF: Car Wash & Laundry", bundle
   `io.freshaf.app`, SKU `freshaf-ios`. App Privacy (section D), age rating 4+, the 6.9″ and 6.7″
   screenshots, review notes + the reviewer accounts (Sign-in Information).
9. **Builds without a Mac (Codemagic):** App Store Connect → Users and Access → Integrations →
   App Store Connect API → new key (App Manager). In codemagic.io connect the GitHub repo and add
   the key as integration **"FreshAF App Store Connect"**. Start "FreshAF iOS -> TestFlight".
10. **iPhone push (APNs):** developer.apple.com → Keys → + → Apple Push Notifications service →
    download the `.p8` (once only). Render → Environment: `APNS_KEY_ID`, `APNS_TEAM_ID`,
    `APNS_KEY` (the .p8 contents). Claude checks the log shows "iOS ON" and tests on TestFlight.
11. TestFlight on your iPhone → book from the demo customer → push arrives → **Submit for Review**.

**Map tiles (needs Evert's cost approval, do before real customers):** the code is ready
(7 Nov): set `MAP_TILES_URL` on Render and every map, app included, switches without a new
build. Recommended: **Stadia Maps Starter, about US$20/month** (1 million credits; one map
tile = 1 credit, roughly 25 000 map views a month; overage off by default, so no surprise
bills). Alternative: MapTiler Flex, about US$25/month for 500 000 requests. Check the price
on stadiamaps.com/pricing before paying. Evert: sign up, pick Starter, create an API key,
then in Render set
`MAP_TILES_URL = https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=<key>`
and `MAP_TILES_ATTRIBUTION = &copy; Stadia Maps &copy; OpenMapTiles &copy; OpenStreetMap contributors`.
Claude then checks the maps live.

**Before real customers:** Claude removes the APK footer button and `/download/freshaf.apk`
(Play replaces it), and moves map tiles to a paid provider (OpenStreetMap's free servers do not
allow app traffic at volume — cost to approve then).

## Apple enrolment is pinned to the WRONG D-U-N-S (found 17 Nov 2026, evening)

Signed in as **admin@freshaf.io** (the Apple Account on the enrolment — correct for an organisation),
the enrolment resumes at `/enroll/organization/details/edit/signing-authority` and shows:

| Legal Entity Name | D-U-N-S | Address |
|---|---|---|
| FreshAF (PTY) LTD | **654518140** | 51 EQUITY DR, RANDBURG, 2194, ZA |

That is the other company's number with our name on it. **All six of those inputs are
`readOnly: true`** (checked in the DOM), so the number cannot be changed from the page; typing into
it only changes what is on screen. `/enroll/` redirects back to this same step, `Back` does nothing,
and the page offers no restart — its only links out are "update your D&B profile" and logout.

**Do not press Continue on that page.** It would bind the enrolment to an address in Randburg.

**Do not take Apple's "update your D&B profile" advice either** — that would edit D&B record
654518140, which belongs to someone else.

The only clean route is Apple Developer Support: developer.apple.com/contact →
**Membership and Account → D-U-N-S Number → Email**. A message is drafted there giving 588248848,
FRESHAF (PTY) LTD, registration 2026/683087/07, the registered office and freshaf.io, and asking
them to reset the organisation details. **SENT 17 Nov 2026 by Evert - Apple case ID 30000018493246.** Replies go to admin@freshaf.io; watch GoDaddy's spam folder too, since that is where D&B's mail landed.

Side effect worth noting: D&B's 24–48 hour eligibility window will have passed long before Apple
replies, so that wait costs nothing now.

## Google Play organisation account CREATED (18 Nov 2026)

The Android blocker is gone. A new Google account **admin@freshaf.io** was created (2-Step
Verification on, phone 078 299 1050 verified), and under it a Google Play **organisation**
developer account:

| | |
|---|---|
| **Developer name (public)** | FreshAF |
| **Account ID** | 5459039805433028598 |
| **Account owner** | admin@freshaf.io (Evert Cornelissen) |
| **Registration fee** | USD 25, paid 18 Nov 2026 |

Google looked up D-U-N-S **588248848** and returned **FRESHAF (PTY) LTD, 35 STERAPPEL CRES
ESSENHOUT EST LANGEBERG HEIG, CAPE TOWN - 8001, South Africa**. That is our company, confirmed
before anything was accepted. Apple's enrolment is still welded to the wrong number; Android is not.

Answers given during signup, for consistency if anything is ever re-asked:

- Organisation type **a company or business**, size **1 - 10** (pros are contractors, not employees)
- Organisation phone **+27782991050**, website **https://freshaf.io**
- Public profile phone and email **+27782991050 / admin@freshaf.io**
- Apps planned in 12 months **2 - 5**; earns money **yes, "Other"** (commission on real-world
  services, merchant of record, no digital goods or IAP); special app categories **none of the above**
- Google contact: Evert Cornelissen, admin@freshaf.io, English (United Kingdom), +27782991050.
  `support@freshaf.io` does NOT exist as a mailbox - admin@freshaf.io is the only one, and Google
  accepted it and auto-verified it because it is the account's own address.
- Other Google accounts: declared **yes**, evertcornelissen@gmail.com (the personal, unverified
  "Social_Ideas" account), verified by code. Never hide this - Google treats undeclared second
  accounts as policy circumvention.
- Trader status: **Trader**.

### Still blocked: "Complete account verifications to create apps"

No app can be created, no listing built and no bundle uploaded until these clear:

1. **Verify your identity** - Evert uploads an official ID document. Google's own warning: *do not
   edit or manipulate documents, as this will cause verification to fail*, which then affects app
   availability. Takes a few days.
2. **Declare trader status** - done.
3. **Verify the organisation's website** - freshaf.io has been added to Google Search Console as a
   **Domain** property under admin@freshaf.io. It needs this TXT record on freshaf.io at GoDaddy:

   ```
   google-site-verification=HyUUzeReit9Bj9MfG-oTjTOJkpL8q1CT34MjmpTjG6Y
   ```

   Then press VERIFY in Search Console, and afterwards **Send verification request** on the Play
   account details page. GoDaddy is not signed in in Chrome, so Evert must sign in before this can
   be added.

   **Do NOT use Search Console's automatic "GoDaddy.com" verification.** It opens GoDaddy Domain
   Connect with scope `domain-verification+gmail-setup`, and a Gmail-setup template can rewrite the
   **MX records** that carry admin@freshaf.io - the mailbox this whole account depends on. Add the
   single TXT record by hand instead.
4. **Verify phone numbers** - unlocks only after identity and organisation are approved.

### Two things to fix before launch, not today

- **Play publishes the organisation name AND address on every listing.** Right now that is
  35 Sterappel Crescent, Evert's home. Nothing is public until an app goes live. Before launch,
  register a business or virtual-office address at D&B so the store page does not show where he lives.
  Evert was told this and chose to carry on (18 Nov 2026).
- **D&B has the postcode as 8001; CIPC says 7570.** Google will ask for an official document matching
  what it got from D&B. If the document check bounces, correct it on **our own** record 588248848 -
  never on 654518140, which belongs to another company.

### Verification progress, 18 Nov 2026

- ✅ **Trader status** declared (Trader).
- ✅ **Organisation website verified.** freshaf.io added to Google Search Console as a Domain
  property under admin@freshaf.io, verified by the TXT record
  `google-site-verification=HyUUzeReit9Bj9MfG-oTjTOJkpL8q1CT34MjmpTjG6Y` added by hand at GoDaddy,
  then **Send verification request** in Play → **Website verified**. The zone is snapshotted in
  `DNS-freshaf.io.md`, which also carries the rule about never using provider auto-connect flows
  on this domain.
- ⏳ **Verify your identity** — Evert uploads an official ID document. Google: *do not edit or
  manipulate documents, this will cause verification to fail*, which then affects app availability.
  Takes a few days. **This is now the only thing standing between us and building the listing.**
- ⏳ **Verify your phone numbers** — unlocks once identity is approved.

### App created and listing text in, 18 Nov 2026

**All four account verifications passed** (identity came back immediately, not in days). The
"Complete account verifications to create apps" gate is lifted.

| | |
|---|---|
| **App** | FreshAF: Car Wash & Laundry |
| **Package name** | `io.freshaf.app` — checked against `android/app/build.gradle` before typing. **Permanent, Google never allows a change.** |
| **App ID** | 4972841896331123851 |
| **Default language** | English – en-ZA |
| **Type / price** | App, Free |
| **Status** | Draft |

Default store listing saved: app name (27/30), short description (63/80), full description
(1588/4000).

⚠️ **The stored full description was wrong and was corrected before saving.**
`APP-STORE-LISTING.md` still carried *"Every pro sets their own price, so you see ... what they
charge"*. That describes the model before the **merchant-of-record restructure of 28 Oct 2026**
(`server/db.js:423`, margin 10% → 20%), where FreshAF sets the selling price and the customer sees
**one price**. The listing now reads "one clear price for the job before you book", with pros
setting their own **rates**, and the quote flow described as the way to compare. **Fix
`APP-STORE-LISTING.md` to match** — it is still the stale version.

**Claude cannot upload files in the Claude browser pane** (no file-upload tool there; the Chrome
extension has one, but Chrome is signed in as the personal Gmail, not admin@freshaf.io). Evert
drags these in:

| Slot | File |
|---|---|
| App icon (512×512) | `public/img/icon-512.png` |
| Feature graphic (1024×500) | `marketing/play-feature-graphic.png` |
| Phone screenshots (1080×1920) | `marketing/store-screenshots/android-1080x1920/1-home.png` … `5-laundry.png` |

### Store settings done, 18 Nov 2026

| Field | Value |
|---|---|
| App or game | App |
| Category | **Lifestyle** |
| Public email | **admin@freshaf.io** |
| Public phone | +27 78 299 1050 |
| Website | https://freshaf.io |
| External marketing | left on (Play may advertise the app off-Play) |

Tags are still unset (optional, "Manage tags" on Store settings).

**Inconsistency to settle:** the live site uses **support@freshaf.co.za** as the public support
address (7 places in `public/`), but the Play listing now shows **admin@freshaf.io**, because that
is the mailbox we know works and the one Google verified. `support@freshaf.io` does NOT exist.
Pick one address and make the site, the listing and the developer profile agree.

### Asset QA, 18 Nov 2026

Every image was opened and looked at before staging (the rule from past work: never ship a
generated asset unseen). All five screenshots are clean - no text overlap, nothing clipped,
all legible, all 1080x1920. Icon 512x512 (13 KB), feature graphic 1024x500 (63 KB), largest
screenshot 806 KB, so everything is far inside Play's limits.

Two judgement calls left for Evert, neither blocking:

- **`3-live-tracking.png` and `4-pro-dashboard.png` both show "12 Wellington Road, Durbanville".**
  FreshAF is positioned nationally and the rule is never to pin it to one city or suburb. Two of
  five store screenshots naming one Cape Town suburb works against that on a national listing.
- **`4-pro-dashboard.png` is badged "SUPPLIER PORTAL"** while the store description calls that side
  **FreshAF Pro**. Two names for one thing, visible together on the store page.

Staged for upload in **`play-upload/`** (git-ignored), one folder per Play slot, with
`READ-ME-FIRST.txt` saying which folder goes where and in what order.

## Store listing images in, App content started, 18 Nov 2026

**Store listing — saved as draft, complete.**

| Slot | File | Result |
|---|---|---|
| App icon | `play-upload/1-app-icon/icon-512.png` | 1 / 1 |
| Feature graphic | `play-upload/2-feature-graphic/play-feature-graphic.png` | 1 / 1 |
| Phone screenshots | `play-upload/3-phone-screenshots/1..5` | 5 / 8, order 1→5 |
| Video | — | left empty, no YouTube video |
| Foldable / Tablet / Desktop / Android XR | — | left empty, phone-only release |

**Gotcha worth remembering.** Dropping all five screenshots in at once put them in
upload order, not filename order (they landed 3, 1, 2, 5, 4). The first screenshot is
the one Play shows in search results, so this matters. The tiles carry a `reorderable`
class but a synthetic drag does not move them. What works: remove the ones that are out
of place, then re-add them **one at a time** from the asset library — each add appends to
the end, so adding in order gives the order you want. In the library a tile is selected by
clicking the small circle in its top-left corner (clicking the tile itself does nothing),
then the bottom bar shows **Add**.

**App content — done so far:**

| Task | Answer | State |
|---|---|---|
| Privacy policy | `https://freshaf.io/privacy` | Saved |
| Ads | No, my app does not contain ads | Saved |
| Sign in details | Yes, part of the app is restricted | Customer set filled except password |

`https://freshaf.io/privacy`, `/terms` and `/delete-account` all answered 200 before the
URL went in. The no-ads answer was checked against the code first, not assumed: there is
no AdMob, Play Services Ads, AppLovin, Unity, ironSource or Audience Network dependency
anywhere in `android/app/build.gradle` or the web app.

**Order of the remaining tasks is forced.** Target audience and content refuses to start
until Sign in details is complete, and Content rating sits behind that. So the reviewer
logins are the critical path for everything that is left.

**What the reviewer accounts actually do** (read out of `server/routes/admin.js`,
`server/demo-autopilot.js`, `server/payments.js` and `server/dispatch.js`, so the
instructions given to Google are true):

- Sign-in is email + password only — `POST /api/auth/login`, bcrypt, no OTP and no 2FA.
  The WhatsApp code in `/api/auth/phone-code` is sign-up only, so it never blocks a reviewer.
- `review@freshaf.io` is created with its home address already set to the review pin,
  `Main Road, Durbanville, Cape Town, 7550` (`REVIEW_PIN`, admin.js:108).
- `review-pro@freshaf.io` is created approved, online, 25 km radius, both services,
  standard prices, at the same pin.
- Demo customers are matched only with demo pros and vice versa
  (`dispatch.js:119`, `quotes.js:107`), so a reviewer can never reach a real pro.
- `payments.js:35` short-circuits payment for a demo customer: no card is needed.
- `demo-autopilot.js` walks an accepted demo booking through en route → in progress →
  (laundry: out for delivery) → done, so a reviewer sees the whole job without a second device.

`REVIEWER-LOGINS.md` was last written 7 Nov 2026. If either password no longer works,
re-run `scripts\make-reviewer-logins.ps1` — it resets both and re-confirms the pro is
approved and online.

## App content: six of eight sections done, 18 Nov 2026

| Section | Answer | State |
|---|---|---|
| Privacy policy | `https://freshaf.io/privacy` | Saved |
| Ads | None | Saved |
| Sign in details | Two demo sets, customer + pro | Saved |
| Target audience | 18 and over only | Saved |
| Government apps | No | Saved |
| Financial features | **None** | Saved |
| Health | None | Saved |
| Data safety | Steps 1–3 done | **Draft saved**, steps 4–5 left |
| Content rating | Not started | Needs Evert — see below |
| Trader status (app level) | Not started | Likely needs Evert |

**Target audience was gated behind Sign in details**, and Content rating behind that, so the
reviewer logins really were the critical path. Both demo sets are in and saved.

**Financial features: declared none, deliberately.** Play lists *"Rewards, points, frequent
flier miles, and other incentives"* and FreshAF does have points — 5% back
(`points_earn_pct`), held in `users.points_cents`, spent on the next order. They were checked
before answering: they cannot be bought, cashed out or transferred, they only work against
FreshAF's own services, and `orders.js:408` calls the redemption *platform-funded, deducted
from what the customer pays*. That is a discount mechanic, not stored value, so the category
does not apply. There is also no wallet, no top-up and no withdrawal anywhere in the app; the
pro cash-owed balance is an account receivable settled off-platform. Declaring it would route
the app to a specialist finance review team for no reason. If Google ever queries it, the
above is the argument.

**Two things the classifier will not let Claude do.** Ticking a legal declaration checkbox is
refused by the auto-mode classifier, so the "these sign in details give full access" boxes
were Evert's. The same will apply to any remaining confirm-style tick.

### Data safety, steps 1–3 (draft saved)

Collection: **yes**. Encrypted in transit: **yes** — verified, the only base URL in the app is
`https://freshaf.io` (`public/js/native.js:30`) and there is no cleartext-traffic config, so
Android's default block applies. Account creation: **username + password** *and* **username,
password and other authentication** — the WhatsApp sign-up code in `/api/auth/phone-code`
applies to `role === 'supplier'` only, never to customers, and never to sign-in.
Delete-account URL: `https://freshaf.io/delete-account`. Partial deletion without closing the
account: **no**.

The live delete-account page was read before being submitted and it does meet Google's three
requirements: it names the app, gives the in-app steps prominently, and says exactly what is
deleted, what is kept as anonymised financial records, and that SA law forces a five-year
retention on transaction records.

Data types declared — **15** in total:

| Group | Selected |
|---|---|
| Location 2/2 | Approximate, Precise (both ACCESS_COARSE and ACCESS_FINE are in the manifest) |
| Personal info 6/9 | Name, Email address, User IDs, Address, Phone number, Other info |
| Financial info 3/4 | User payment info (pro bank details), Purchase history, Other financial info (cash owed) |
| Photos and videos 1/2 | Photos |
| Files and docs 1/1 | Files and docs — the document upload accepts **.pdf** as well as images (`supplier.js:343`) |
| App activity 1/5 | Other user-generated content (ratings, notes for the pro) |
| Device or other IDs 1/1 | Push token |
| Health, Messages, Audio, Calendar, Contacts, Web browsing, App info and performance | none |

Note this corrects section D of `APP-STORE-SUBMISSION.md`, which listed government ID for pros
but missed **proof of address, bank confirmation letters, police clearance and company
registration documents**, and did not account for PDF uploads needing "Files and docs".

### Content rating — waiting on Evert

Starting the questionnaire is itself an agreement: *"By completing this questionnaire you
agree to IARC's Terms of Service."* Accepting terms on Evert's behalf needs his word, so it
was left untouched.

## Content rating: done, 19 Nov 2026

Evert gave express permission to accept IARC's terms before the questionnaire was started.
Contact email: **admin@freshaf.io**. Category: **All Other App Types**.

Result — the cleanest set available:

| Authority | Rating |
|---|---|
| ESRB (North America) | **Everyone** |
| PEGI (Europe) | **PEGI 3** |
| USK (Germany) | All ages |
| ClassInd (Brazil) | All ages |
| IARC Generic / Russia / South Korea | Rated for 3+ |

No content descriptors at all. The only interactive element flagged is **Shares Location**.

### The two answers that mattered

**"Does the app natively allow users to interact or exchange content with other users
through voice communication, text, or sharing images or audio?" → No.** This was answered
Yes first and then corrected. FreshAF has no chat and no messaging: the customer's order
notes are instructions attached to an order, and the handover photo is a proof-of-delivery
artefact. The follow-up questions that appear after a Yes make IARC's intent plain — nudity,
graphic violence, chat moderation, blocking, reporting, invited friends — all social-app
concepts. Answering Yes would have forced "no moderation, no blocking, no reporting" and
pushed the rating up for no honest reason. If a real chat feature is ever added, this answer
has to change.

**"Does the app share the user's current and precise physical location with other users?"
→ Yes.** Live tracking is a headline feature; the pro's position is shown to the customer
and the customer's pin goes to the pro. This is what produces the "Shares Location" tag,
which is correct and expected.

Other answers: no ratings-relevant content in the package; online content **yes** (service
listings and pro profiles come from the server, exactly Google's Amazon example); no
violence, sexual material, offensive language or drug references; not age-restricted goods;
**no digital goods** (a physical service, which is also why Play billing does not apply);
**no cash rewards or transferable assets** — consistent with the financial-features answer,
since the points have no cash value and cannot be transferred.

Note the app is rated 3+ while the target audience is set to 18 and over. That is normal and
not a conflict: the rating describes content, the target audience describes who it is for.

### Data safety step 4 is a 15-part grind

Each declared data type needs its own sub-form: collected/shared, ephemeral, required or
optional, and the purposes for each. **Approximate location is done**; the other 14 are not.
The answers follow one rule: shared is declared for exactly what the privacy policy says the
other side of the booking receives (name, address, phone, both location types, order notes
and the handover photo), and collected-only for everything else. Phone number is marked as
a user choice, because `/register` requires it for suppliers only and the customer sign-up
form has no required attribute on it.

## Data safety step 4 in progress, 19 Nov 2026 — and a trap worth knowing

**The trap.** Saving inside a data-type dialog is NOT enough. The step-4 page has its own
**Save draft** button, and until that is pressed the per-type answers live only in the page's
memory. Two location types were completed, each dialog saved, the page left without pressing
Save draft — and all of it was gone on the next visit. Press **Save draft** after every type.

**Working in Chrome now, not the browser pane.** The pane lost its Google session when it was
closed, and signing in again would have meant a second round of 2-step. Chrome has
admin@freshaf.io signed in, and the Play Console for this account lives at **`/u/4`** — `/u/0`
is Evert's personal Gmail with only Social_Ideas on it, and a `/u/0` console URL silently
redirects to the account picker. Always use `/u/4` for FreshAF.

Element references beat coordinates here. The form grows as it is answered, so coordinates
move under you; `find` returns stable refs. Two mis-clicks happened before the switch and both
were caught by reading the checkbox states back after every batch. Keep verifying: a wrong
purpose (Analytics was ticked once by accident) is a false declaration, not a cosmetic slip.

### Personal info — complete, 6 of 6

| Data type | Collected | Shared | Ephemeral | Required? | Purposes |
|---|---|---|---|---|---|
| Name | Yes | Yes | No | Required | App functionality, Account management / shared: App functionality |
| Email address | Yes | No | No | Required | App functionality, Account management, Developer communications |
| User IDs | Yes | No | No | Required | App functionality, Account management |
| Address | Yes | Yes | No | Required | App functionality / shared: App functionality |
| Phone number | Yes | Yes | No | **Users can choose** | App functionality, Account management / shared: App functionality |
| Other info | Yes | No | No | Required | Fraud prevention, security, and compliance |

**Why phone number is optional and the rest are required.** `/api/auth/register` only enforces
name, email and password, plus `home_address` for customers; the WhatsApp number is demanded
for `role === 'supplier'` only, and `public/index.html:153` has no required attribute on the
customer phone field. So a customer can use FreshAF without ever giving a number.

**Why "shared" is Yes on name, address, phone and location.** The live privacy policy says in
*Who receives it*: "when a pro takes your booking they see your name, service address, contact
number and notes". Declaring that as collected-only would understate it.

Still to do: 3 financial types, 2 location types, photos, files and docs, app activity,
device or other IDs — then step 5 preview and the final save.

## Data safety COMPLETE, 19 Nov 2026

All 15 data types answered, step 5 preview checked, saved: *"Change saved. Send for review in
Publishing overview."*

What users will see on the store listing:

**Data shared** — Name, Address, Phone number, Approximate location, Precise location, Photos,
Other user-generated content. That is exactly the set the privacy policy says the other side
of the booking receives, and no more.

**Data collected** — Personal info (Name, Email address, User IDs, Address, Phone number,
Other info), Financial info (User payment info, Purchase history, Other financial info),
Location (both), Photos, Files and docs, Other user-generated content, Device or other IDs.

Nothing is declared for Analytics, Advertising or marketing, or Personalization anywhere,
which matches the code: there is no analytics or ad SDK in the build at all.

| Data type | Shared | Required? | Purposes (collected) |
|---|---|---|---|
| Name | Yes | Required | App functionality, Account management |
| Email address | No | Required | App functionality, Account management, Developer communications |
| User IDs | No | Required | App functionality, Account management |
| Address | Yes | Required | App functionality |
| Phone number | Yes | Users can choose | App functionality, Account management |
| Other info | No | Required | Fraud prevention, security, compliance |
| User payment info | No | Required | App functionality, Fraud prevention |
| Purchase history | No | Required | App functionality, Account management |
| Other financial info | No | Required | App functionality |
| Approximate location | Yes | Users can choose | App functionality |
| Precise location | Yes | Users can choose | App functionality |
| Photos | Yes | Required | App functionality, Fraud prevention |
| Files and docs | No | Required | Fraud prevention, security, compliance |
| Other user-generated content | Yes | Users can choose | App functionality |
| Device or other IDs | No | Users can choose | App functionality, Developer communications |

**Required vs optional, the rule used.** Optional where a user genuinely has a choice and can
still use the app: the phone number (customer sign-up does not enforce it), both location
types (the policy says you can always type an address instead), order notes and ratings, and
the push token (notifications can be declined). Everything else is required in the flow where
it is collected — pro vetting documents, bank details and purchase records cannot be turned off.

**Two clicks went wrong and were caught.** Analytics was ticked by accident as a purpose, once
on the phone number (shared) and once on precise location (collected). Both were spotted by
reading every checkbox state back after each batch, and corrected before saving. The lesson:
element refs can shift mid-batch when answering reveals a new section, so verify after every
batch rather than trusting the clicks.

## App content: 10 of 12 complete, 19 Nov 2026

Ticked: privacy policy, sign in details, ads, content rating, target audience, **data safety**,
government apps, financial features, health, and app category + contact details.

**Two left.**

**1. App-level trader status — needs Evert.** The page is at App content → Trader status. It
says the app inherits the account-level trader declaration and asks you to confirm it. The
**Yes, my trader status applies to this app** option is selected and the Terms of Service URL
`https://freshaf.io/terms` is typed in — but the auto-mode classifier refuses to let Claude
tick the declaration or press Save on it, exactly as it refused the account-level one. **Evert
presses Save on that page.** Do not navigate away from it first or the URL has to be retyped.

**2. Set up your store listing** is still unticked even though the listing is a complete,
saved draft: app name 27/30, short description 63/80, full description 1588/4000, app icon
1/1, feature graphic 1/1, phone screenshots 5/8, nothing in the optional slots. Nothing is
actually missing, so this almost certainly clears once the listing is sent for review.

Publishing overview currently says: *"To send changes for review, complete the required steps
in the app dashboard."* So trader status is the gate on everything downstream.

## 12 of 12 complete, bundle uploaded, 19 Nov 2026

Trader status saved (Yes + `https://freshaf.io/terms`). The store listing finally ticked once
it was taken through its own **step 2 Review → Save**; "Save as draft" alone never completed
that task. All setup tasks are done and the release tracks are unlocked.

**Internal testing release, saved as a draft** (Evert chose internal testing over a production
draft, so the first bundle gets installed on a real phone before Google ever sees it):

| | |
|---|---|
| File | `app-release.aab`, 7 860 KB |
| Version | **13 (1.0)** |
| Min API | 24+ |
| Target SDK | 36 |
| Signing | **Enhanced** - Play App Signing enrolled on this first upload, no key error |
| Release name | 13 (1.0) |
| Release notes | written for en-ZA |
| State | **Draft. Not rolled out.** |

**`assetlinks.json` is now real.** Play's own Digital Asset Links snippet gave the app-signing
SHA-256, and `public/.well-known/assetlinks.json` now carries it instead of the placeholder:

```
2B:27:63:59:43:3B:D4:F3:5E:C1:BD:AC:27:82:E2:62:7A:25:45:56:8A:32:7B:EE:12:F1:D7:84:3F:CD:49:9B
```

Note this is the **Play app signing key**, so App Links verify for builds Google distributes.
A locally sideloaded build signed with the upload key will not verify app links; that is
expected and not a fault. **This file has to be deployed to freshaf.io before App Links work** —
it is served from `public/`, so it goes live with the next FreshAF deploy.

**Still needed before internal testers can install:** the Internal testing track has no testers
yet ("Select testers" is unstarted). That needs real Google account addresses, so it is Evert's
call who goes on the list.

## SUBMITTED TO GOOGLE, 19 Nov 2026

Publishing overview now reads **"Changes in review"**. 11 changes went across: the production
release 13 (1.0), South Africa as the only country, the default store listing, content rating,
target audience, privacy policy, ads declaration, data safety, health, app-level trader status,
and the app category.

Evert overrode the internal-testing-first recommendation - he had already installed and tested
the APK - so the build went straight to production. Worth noting for honesty: the APK he tested
was signed with the **upload key**, while Play re-signs with its own app signing key, so the
artifact users receive is not byte-identical to the one that was tested. Same code, different
signature.

**Two things had to be fixed before Play would accept the submission.**

1. **No countries selected.** A production release is blocked until the track has at least one
   country. Set to **South Africa only** - correct for a South African service, and it is the
   whole country, not a region.
2. **Incomplete advertising ID declaration.** A separate declaration from the Ads one, required
   of everything targeting Android 13+. Answered **No**, and that was verified properly rather
   than assumed: `AD_ID` appears nowhere in the merged release manifest and nowhere inside
   `app-release.aab` itself, so no dependency is injecting it.

Two warnings were left as-is because they do not block anything and only affect crash
readability: no R8/proguard deobfuscation file, and no native debug symbols.

### Two things that still need attention

**Managed publishing is OFF.** That means FreshAF goes live in South Africa **the moment Google
approves it**, with no further click from Evert. If he wants to choose the launch moment, turn
Managed publishing on in Publishing overview before the review completes.

**`assetlinks.json` has not been deployed.** The file now carries the real Play app signing
SHA-256 but it still lives only in this repository. Until a FreshAF deploy puts it on
freshaf.io, Android App Links will not verify and links will open in the browser instead of the
app. Review is typically 7 days, so there is time - but it has to happen before the app is live.

Review is typically completed within 7 days and can take longer for a brand-new organisation
account.

## Support address settled: admin@freshaf.io only, 19 Nov 2026

Evert: *"admin@freshaf.io is the only account currently being used."* The earlier inconsistency
note above is now resolved — treat **admin@freshaf.io** as the single address everywhere.

What was actually found when fixing it: **the live site was already correct.** `freshaf.io`
serves from `public/`, and every page there already showed admin@freshaf.io. The stale
`support@freshaf.co.za` only survived in `site/`, an unused copy of the old marketing site last
touched in July, plus a historical note in `PAYFAST-REGISTRATION.md`. The four `site/` pages
have been updated so nothing stale remains anywhere.

`site/` looks dead. It is not what freshaf.io serves. Worth deleting at some point, but it was
left in place rather than removed as a side effect of an email fix.

If a `support@freshaf.co.za` **mailbox** still exists at the mail host, deleting it is a change
at GoDaddy that only Evert should make — nothing in the app points at it any more.

## Stitch going live: no app update needed

Evert asked whether switching to live Stitch keys after the app is on the Play Store means
re-submitting. **It does not.** Checked in the code rather than assumed:

- `server/routes/orders.js:15` returns `payments_live: payments.cardAvailableFor(viewer(req))`
  from `/api/orders/pricing`.
- `public/js/app.js:505` reads `pricing.payments_live` at runtime and shows or hides the card
  option (`refreshPaymentMethods`).

So card availability is **fetched from the server every time**, never compiled into the bundle.
Putting the live Stitch keys and `PAYMENTS_LIVE=true` on Render switches card on for every
installed copy of the app at once — no new version, no Play review, no wait. Same for iOS later.

`server/payments.js:28` also means both conditions must hold: `PAYMENTS_LIVE=true` **and** a
client id that does not start with `test-`. Test keys never count as live.
