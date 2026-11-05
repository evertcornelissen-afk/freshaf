# Getting FreshAF onto the App Store and Google Play

*Written 5 November 2026. Requirements verified against Apple's App Store Review Guidelines
and Google's Play Console help pages on that date — both stores change rules, so re-check the
two official links at the bottom before you submit.*

---

## The one hard constraint

**You cannot build or submit an iOS app from Windows.** Apple requires Xcode, which runs only
on macOS, and the upload to App Store Connect goes through it. This is Apple's rule, not a gap
in our build. Three ways round it:

| Option | Cost | Notes |
|---|---|---|
| Borrow or buy a Mac | Mac mini from ~R12 000 | Simplest. Any Apple Silicon Mac does it. |
| Rent a cloud Mac | ~R400–900/month | MacStadium, Scaleway. You remote in and run Xcode. |
| CI build service | ~R0–R1 500/month | Codemagic or Ionic Appflow build and upload the iOS app for you. Codemagic has a free tier that covers a launch. |

**Android needs none of this.** The whole Play submission can be done from this machine.

---

## Where FreshAF stands today

### Both stores

| Requirement | Status |
|---|---|
| App works without crashing (Apple 2.1 — the single biggest rejection reason) | ✅ Crash handlers added; 62 tests passing |
| Privacy policy at a public URL | ✅ `freshaf.io/privacy` |
| Support/contact URL | ✅ `freshaf.io/contact` |
| Terms of service | ✅ `freshaf.io/terms` |
| **In-app account deletion** | ✅ Account → Delete account, password-confirmed |
| **Web account-deletion URL** (Play requires one outside the app) | ✅ `freshaf.io/delete-account` |
| HTTPS everywhere | ✅ |
| Rate limiting / brute-force protection | ✅ Added 5 Nov 2026 |
| Content-Security-Policy and security headers | ✅ Added 5 Nov 2026 |
| App icon 512×512 | ✅ `public/img/icon-512.png` |
| **App icon 1024×1024** (App Store needs this exact size, no alpha channel) | ✅ `public/img/icon-1024.png` |
| **Screenshots** | ❌ **Outstanding** — see below |
| **A working demo account for the reviewer** | ❌ **Outstanding** — and see the warning below |

### Google Play only

| Requirement | Status |
|---|---|
| Native Android project | ✅ `android/`, Capacitor |
| `targetSdkVersion 36` (Android 16) — mandatory since 31 Aug 2026 | ✅ 36 |
| `minSdkVersion` | ✅ 24 (Android 7, ~98% of devices) |
| Package name fixed and unique | ✅ `io.freshaf.app` |
| Signed AAB (Android App Bundle, not APK) | ❌ Needs a signing key — step A3 |
| Play Console account | ❌ **$25 one-off** |
| Organisation account verification (D-U-N-S) | ❌ Needed to publish as FreshAF (Pty) Ltd |
| Data safety form | ❌ Answers pre-written below |
| Content rating (IARC questionnaire) | ❌ 5 minutes |
| `assetlinks.json` SHA-256 fingerprint | ⚠️ Still the literal placeholder — step A5 |

### App Store only

| Requirement | Status |
|---|---|
| Native iOS project | ✅ `ios/`, Capacitor |
| iOS deployment target | ✅ 15.0 |
| **Guideline 4.2 — more than a repackaged website** | ✅ See below |
| Apple Developer Program | ❌ **$99/year** |
| D-U-N-S number to enrol as a company | ❌ Free, takes 5–14 days |
| App privacy "nutrition labels" | ❌ Answers pre-written below |
| Export compliance declaration | ❌ One question; answer is "uses HTTPS only" |
| Age rating | ❌ 4+ |

---

## Guideline 4.2, and why this build passes where a wrapper would not

Apple rejects apps that are "a repackaged website". This is the rejection that kills most
small-business apps, and it is the reason this is **not** a Trusted Web Activity or a WebView
pointed at freshaf.io.

What we built instead, and what to say in the review notes:

- **The app ships its own interface.** The HTML, CSS and JavaScript are inside the binary.
  Nothing is downloaded from freshaf.io to draw a screen — only data. The app is a client of
  an API, which is exactly how most native apps work.
- **Real native capabilities**, wired in `public/js/native.js`:
  native push notifications, device geolocation for the pickup pin, the camera for job photos,
  haptic feedback on primary actions, a native splash screen and status bar, and Android
  hardware-back handling.
- **It is not a browser.** There is no address bar, no tabs, no way to navigate off FreshAF.

⚠️ **Do not submit until there are Pros on the platform.** A reviewer will create an order and
see *"No pros are online near you right now."* That is an automatic rejection under Guideline
2.1 (App Completeness), and a rejection is logged against your account. This is the single
most likely reason FreshAF gets turned down, and no amount of code fixes it.

---

## A. Google Play, step by step

### A1. Create the account
1. Go to **play.google.com/console** and pay the **$25 one-off** fee.
2. Choose **Organisation**, not Personal — you are publishing as FreshAF (Pty) Ltd.
3. Google will verify the company. Have ready: registration number **2026/683087/07**, the
   registered address, and a **D-U-N-S number** (free from dnb.com, 5–14 days — **start this
   first, it is the longest pole**).

### A2. Build the app bundle
From this machine, in `freshaf/`:

```bash
npx cap sync android
```

Then open the project in Android Studio:

```bash
npx cap open android
```

In Android Studio: **Build → Generate Signed App Bundle / APK → Android App Bundle**.

### A3. Create the signing key — and never lose it
Android Studio offers to create one. **Back the keystore file and its password up in two
places.** If you lose it you cannot ever update the app; you have to publish a brand-new
listing and every install is orphaned. Put it in your password manager, not in this repo.

Then tick **Export encrypted key** and enrol in **Play App Signing**, which lets Google
re-sign on your behalf if the worst happens.

### A4. Fill in the Play Console
- **Store listing:** name, short description (80 chars), full description (4 000), the icon,
  a 1024×500 feature graphic, and at least **2 phone screenshots** (see section C).
- **Data safety:** answers in section D below.
- **Content rating:** take the IARC questionnaire. FreshAF is a service-booking app with no
  user-generated public content → rated for everyone.
- **App access:** you must give a **demo account** (email and password) so the reviewer can get
  past the sign-in screen. Make a real customer account on freshaf.io and hand over those
  credentials.
- **Account deletion:** enter `https://freshaf.io/delete-account`.
- **Privacy policy:** `https://freshaf.io/privacy`.

### A5. Fix the deep-link fingerprint
After the first upload, Play Console shows your app's signing certificate under
**Release → Setup → App signing**. Copy the **SHA-256 certificate fingerprint** and replace the
placeholder in `public/.well-known/assetlinks.json`:

```json
"sha256_cert_fingerprints": [ "AB:CD:EF:..." ]
```

Commit and deploy. Until then, links to freshaf.io open in a browser instead of the app.

### A6. Release
Start with **Internal testing** (instant, up to 100 testers, no review). Put it on your own
phone and Nikki's, run a real order through, then promote to Production. First production
review is typically a few days.

---

## B. App Store, step by step *(needs a Mac)*

### B1. Enrol
1. **developer.apple.com/programs** — $99/year.
2. Enrol as an **Organization**, which needs the same **D-U-N-S number** as Play. One D-U-N-S
   serves both, so get it once.

### B2. Build
On the Mac, with the repo cloned and Xcode installed:

```bash
npm install
```

```bash
npx cap sync ios
```

```bash
npx cap open ios
```

In Xcode: set the Team to FreshAF (Pty) Ltd, set the bundle identifier to `io.freshaf.app`,
then **Product → Archive → Distribute App → App Store Connect**.

### B3. App Store Connect
- Create the app record, bundle id `io.freshaf.app`.
- **App privacy** labels: section D below.
- **Screenshots**: required for 6.7" and 6.5" iPhone. Section C.
- **Review notes**: paste the Guideline 4.2 paragraph from this document, plus the demo
  account, plus a line saying the service area is Cape Town's Northern Suburbs so the reviewer
  knows why an address elsewhere returns nothing.
- **Export compliance**: "uses only standard HTTPS encryption" → exempt.

---

## C. Screenshots

Both stores need real screenshots and will reject obvious mock-ups.

Sizes: **Play** — minimum 2, 1080×1920 or larger. **Apple** — 6.7" (1290×2796) and 6.5"
(1242×2688).

The five that sell the app: the home screen with both services, the price comparison showing
several Pros, live order tracking, the Pro's job screen, and the rewards/account screen.

Take them on a real device once there are real Pros, so the screens are not empty. Android
Studio's emulator screenshots are acceptable to both stores if the content is genuine.

---

## D. Data safety and privacy labels — pre-written answers

These come from the actual database schema, not guesswork. Answer them identically on both
stores; a mismatch between what you declare and what the app does is grounds for removal.

**Does the app collect or share user data?** Yes, collects. **Shares with third parties?** No —
the payment provider is a processor, not a recipient, and nothing is sold or used for ads.

| Data type | Collected | Why | Required? |
|---|---|---|---|
| Name | Yes | Account, and so the Pro knows who to meet | Required |
| Email address | Yes | Account, receipts, order notifications | Required |
| Phone number | Yes | The Pro calls you on arrival | Required |
| Physical address + precise location | Yes | The job happens at your address | Required |
| Government ID (Pros only) | Yes | Vetting; **encrypted at rest** | Required for Pros |
| Bank details (Pros only) | Yes | Paying the Pro; **encrypted at rest** | Required for Pros |
| Purchase history | Yes | Order history, receipts, tax records | Required |
| Photos (optional) | Yes | Job condition photos | Optional |
| Payment card details | **No** | Entered on the provider's own pages; never reach FreshAF | — |
| Advertising ID / tracking | **No** | No ads, no third-party analytics, no tracking | — |

**Security practices to declare:** data encrypted in transit (HTTPS); users can request
deletion (`freshaf.io/delete-account`); ID and banking data encrypted at rest.

**Apple's "Tracking" section:** answer **No**. FreshAF does not track users across other
companies' apps or websites, so no App Tracking Transparency prompt is required.

---

## E. The order to do this in

1. **Get a D-U-N-S number** — free, 5–14 days, needed by *both* stores. Start today.
2. **Get Pros onto the platform.** Submitting with zero Pros fails Guideline 2.1.
3. Play Console account ($25) → internal testing build → real order on a real phone.
4. Screenshots, once the app has real content in it.
5. Play production release.
6. Apple Developer Program ($99) + Mac access → App Store.

Android first is deliberate: it is cheaper, it needs no Mac, and most South African customers
are on Android anyway. Apple can follow once Play is live and you have real reviews.

---

## F. What this costs

| | |
|---|---|
| Google Play Console | $25 once (~R450) |
| Apple Developer Program | $99/year (~R1 800) |
| D-U-N-S number | Free |
| Mac access, if you do not have one | R0–R12 000 |

---

## Official references — check these before submitting

- Apple: `developer.apple.com/app-store/review/guidelines`
- Apple account deletion: `developer.apple.com/support/offering-account-deletion-in-your-app`
- Play target API levels: `support.google.com/googleplay/android-developer/answer/11926878`
- Play user data policy: `support.google.com/googleplay/android-developer/answer/10144311`
