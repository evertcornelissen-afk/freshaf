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
- **Payments: you're fine.** Apple/Google take 15-30% only on *digital* goods. FreshAF sells **real-world services** (car wash, laundry) — the Uber/DoorDash exemption applies, so **PayFast is allowed** and no store commission applies to orders. Rewards for real services are fine too.
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
