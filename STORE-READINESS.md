# FreshAF — store readiness (Google Play + Apple App Store), 7 Nov 2026

One page: what is ready, where it is, and exactly what Evert does, in order. Details behind
each step: `APP-STORE-SUBMISSION.md` (sections A–F) and `APP-STORE-LISTING.md` (copy).
The test APK link (freshaf.io footer + /download/freshaf-test.apk) stays until launch.

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
| Privacy policy URL | `https://freshaf.io/privacy` (update drafted, see step 2) |
| Data safety / App Privacy answers (incl. push token as "Device or other IDs") | `APP-STORE-SUBMISSION.md` section D |
| Stays signed in, Settings (alerts, location), standard menu, Customer/Pro sign-in | app build v9 |

## Evert's steps, in this order

**Now (no developer account needed):**
1. ✅ **DONE 7 Nov 10:29.** Upload key `%USERPROFILE%\FreshAF-keys\freshaf-upload.jks`; upload-key
   certificate SHA-256 `8D:B4:CE:AC:7C:15:D6:06:70:E0:CB:22:DB:97:85:51:58:30:84:BC:1D:FA:6D:00:9D:3B:3C:ED:C2:75:1D:A5`
   (not secret; Play shows it under App signing). First signed bundle, versionCode 10:
   `Desktop\FreshAF-release\freshaf-1.0-vc10.aab`. Original step:
   **Upload key:** `powershell -ExecutionPolicy Bypass -File scripts\make-upload-key.ps1`. Choose
   the password yourself; save the `.jks` file and the password in your password manager.
2. **Approve the privacy policy update** in `PRIVACY-DRAFT-stores.md` (or send it to the lawyer).
   Claude publishes it once you say "approved". Both stores compare it with the privacy answers.
3. **Reviewer accounts** (reviewers must be able to sign in without anyone awake):
   - On freshaf.io create one **customer** and one **pro** with addresses you control (not your
     own daily accounts), e.g. a new Gmail or `review@`/`review-pro@` aliases of admin@freshaf.io.
   - Admin app: **approve** the pro, then **Make demo** on both. Sign in as the pro once: set
     prices, location pin in Durbanville, radius 25 km, **go online**, leave online.
   - Keep the two email/password pairs for steps 6 and 8 only (never in chat or the code).
4. **Real pros tomorrow:** reviewers book from outside SA, so the demo pro covers them; real pros
   are for real customers. Both stores reject an app that looks empty.

**When the D-U-N-S number arrives (D&B email):**
5. **Google Play Console** (play.google.com/console): Organisation account as FreshAF (Pty) Ltd,
   **$25 once**, identity + organisation verification (D-U-N-S, registration 2026/683087/07).
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
   D-U-N-S, legal entity FreshAF (Pty) Ltd. Apple may phone to verify.
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

**Before real customers:** Claude removes the APK footer button and `/download/freshaf-test.apk`
(Play replaces it), and moves map tiles to a paid provider (OpenStreetMap's free servers do not
allow app traffic at volume — cost to approve then).
