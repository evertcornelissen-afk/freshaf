# FreshAF — App Store & Play Store launch requirements

*Assumes PayFast is verified and suppliers are loaded. The app already runs as an
installable PWA at freshaf.io — the stores are an additional distribution channel,
not a prerequisite to operate.*

## The reality check first
FreshAF is a web app. To appear in the Apple App Store and Google Play it must be
**wrapped as a native app** (Capacitor) and pass each store's review. This is very
doable, but it introduces costs, accounts, and a Mac requirement that don't exist for
the PWA. Recommendation: **launch on the PWA, prove traction, then do the stores** once
demand justifies ~2-4 weeks of setup. Everything below is what "doing the stores" needs.

## 0. Do Android first, and do it as a TWA — added 3 November 2026

The plan below treats both stores as one job. They are not, and pretending otherwise
costs weeks.

**Google Play: cheap and quick.** A **Trusted Web Activity** wraps the existing PWA with
no second codebase, no Capacitor, and no Mac. $25 once, and Bubblewrap generates the
project from the manifest. The app is the site, so every deploy ships to the store app
too.

**Apple: expect a fight.** Guideline 4.2 rejects apps that are "just a website". A
wrapper around freshaf.io with nothing native is the textbook rejection. To pass, iOS
needs genuine native behaviour — background location for live pro tracking, native push,
camera for before/after photos — which is real work, $99/year, and a Mac. **Do not start
it until Play is live and there is demand to point at.**

### Done already (3 November 2026)
- **Icons fixed.** `icon-192.png` and `icon-512.png` were corrupt files since the first
  commit; every "Add to home screen" fell back to a browser-drawn icon.
- **A real maskable icon.** `icon-maskable-512.png` keeps the mark inside the 80% safe
  zone. The old entry declared the full-bleed mark as maskable, so Android launchers
  clipped the corners off the A and the F.
- **Manifest filled out** for store tooling: `id`, `description`, `lang`, `categories`,
  and two home-screen shortcuts that actually work signed-out.
- **`/.well-known/assetlinks.json`** is served, with an explicit route rather than
  relying on static-file dotfile behaviour. **It still needs the real fingerprint** —
  see below.

### What Play still needs from you
1. Play Console account, $25 once, **as FRESHAF (PTY) LTD**, with identity verification.
2. New personal accounts need a **20-tester closed test for 14 days** before production.
   Organisation accounts are usually exempt — another reason to enrol as the company.
3. Once Play issues the app signing key, paste its **SHA-256 fingerprint** into
   `public/.well-known/assetlinks.json` and redeploy. Until then the app opens with a
   browser address bar across the top, which looks exactly as unfinished as it sounds.
4. Store listing: screenshots at Play's required sizes, feature graphic, short and full
   description, Data Safety form, content rating.

## 1. Accounts & money — ONLY YOU can do these
| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | **$99 / year** | Enrol as the **Pty Ltd** (needs a free D-U-N-S number — allow 1-2 weeks) so the seller is the company, not "Evert Cornelissen". |
| Google Play Developer | **$25 once** | Organisation account also needs identity verification. New accounts face a 14-day / 20-tester closed-test requirement before production. |
| A Mac (or cloud Mac) | varies | **Apple requires macOS + Xcode to build/submit iOS.** You're on Windows. Options: borrow/buy a Mac, or use a cloud build service (Codemagic / EAS Build / Ionic Appflow ~ free-$30/mo) so no Mac needed. Android builds fine on Windows. |

## 2. The native wrapper — I BUILD this
- Add **Capacitor** to the project; bundle the front-end shell so it's a real app (Apple rejects apps that are just a website in a frame — Guideline 4.2).
- **Native push notifications:** migrate provider job-alerts from Web Push (VAPID) to **FCM (Android) + APNs (iOS)** via Capacitor. Needs a Firebase project (free) and an Apple push key.
- Native app icon + splash screen (assets already exist).
- Produce signed builds: Android **.aab** and iOS **.ipa**.
- Deep links so freshaf.io links open the app.

## 3. Store listing — I PRODUCE, you review/submit
- Screenshots for required device sizes (I generate from the app).
- Title, subtitle, description, keywords, category (I write; partner clears any claims).
- **Privacy Policy URL** — already live at freshaf.io/privacy (both stores require it).
- **Apple Privacy "Nutrition Label"** + **Google Data Safety form** — declare what we collect (location, name, contact, address). I draft; you confirm.
- Age rating questionnaire, content rating.
- **Reviewer demo account** — a test login so Apple/Google reviewers can use the app.

## 4. Compliance items that could bite — worth knowing NOW
- **Payments: you're fine.** Apple/Google take 15-30% only on *digital* goods. FreshAF sells **real-world services** (car wash, laundry) — the Uber/DoorDash exemption applies, so **Stitch is allowed** and no store commission applies to orders. Rewards for real services are fine too. (PayFast declined FreshAF; the gateway is Stitch Express — see `STITCH-SETUP.md`.)
- **In-app account deletion** — Apple hard-requires it. **Already built.** ✓
- **Backend must be reliable** — a store-launched app whose database wipes is a disaster. **Render must be on the paid plan with a persistent disk before store launch** (the "Render card" step).
- **Company entity** — register the Pty Ltd first so the store accounts, PayFast, and domain all sit under it (partner's workstream).

## 5. Rough timeline once you commit
- D-U-N-S + Apple/Google enrolment: **1-2 weeks** (mostly waiting on Apple/D-U-N-S).
- Capacitor wrapper + native push + builds: **~1 week** (my work).
- Store listings + review submission: **a few days to build, then 1-7 days review each.**
- **Realistic: 3-4 weeks from "go" to live in both stores**, most of it waiting on Apple.

## Bottom line
Nothing structural is missing from the *app* — it already does everything. The store
launch is an accounts + wrapper + review exercise. My recommendation stands: **PWA-first
to get real customers and revenue, stores second.** When you say go, I start the Capacitor
build in parallel with your account enrolments.
