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

**Before real customers:** Claude removes the APK footer button and `/download/freshaf-test.apk`
(Play replaces it), and moves map tiles to a paid provider (OpenStreetMap's free servers do not
allow app traffic at volume — cost to approve then).
