# FreshAF: App Store and Google Play listing, review notes and reviewer accounts

*FreshAF is national: the copy says South Africa, never one city, and never promises a pro
in every town. The Google Play listing is at the end.*

*Ready to paste into App Store Connect. Every claim below is true of the app as built on
5 November 2026; if a feature changes, change this file in the same commit. Character
limits are Apple's and were checked when this was written (`node scripts/check-listing.js`).*

---

## App information

| Field | Value |
|---|---|
| **Name** (max 30) | FreshAF: Car Wash & Laundry |
| **Subtitle** (max 30) | Vetted pros come to you |
| **Bundle ID** | io.freshaf.app |
| **SKU** | freshaf-ios |
| **Primary category** | Lifestyle |
| **Secondary category** | Utilities |
| **Content rights** | Does not contain third-party content |
| **Age rating** | 4+ (answer "None" to every question) |
| **Price** | Free |
| **Availability** | South Africa only. Pros are being signed up nationwide; where no pro works yet, the app shows nobody available before anything is booked |
| **Copyright** | 2026 FreshAF (Pty) Ltd |
| **Support URL** | https://freshaf.io/contact |
| **Marketing URL** | https://freshaf.io |
| **Privacy Policy URL** | https://freshaf.io/privacy |

## Promotional text (max 170, can be changed without a new build)

Mobile car washes and laundry collection across South Africa. Compare vetted pros near you, book in under a minute, pay by card or cash.

## Keywords (max 100, comma-separated, no spaces after commas)

valet,mobile wash,laundromat,ironing,duvet,cleaning,detailing,wash and fold,South Africa,car valet

## Description (max 4000)

FreshAF brings the car wash and the laundromat to you.

Pick a service, drop a pin where your car is parked or where your laundry should be collected, and choose from the vetted pros near you. Every pro sets their own price, so you see who is available, what they charge and how far away they are before you book. The price you see is the price you pay.

CAR WASH, WHEREVER IT IS PARKED
• Express Wash: exterior hand wash and dry
• Wash & Vacuum: exterior wash, interior vacuum and wipe-down
• Full Valet: deep interior clean, wax and tyre shine
Sedans, SUVs, bakkies, minibuses and vans.

LAUNDRY, COLLECTED AND RETURNED
• Wash & Fold
• Wash, Dry & Iron
• Duvets & Bedding
Small, medium and large loads.

HOW IT WORKS
1. Choose the service and drop your pin.
2. Compare the pros near you and pick one, or ask several for a quote.
3. Pay by card or pay your pro in cash when the job is done.
4. Follow your pro from accepted to on the way to done, live in the app.

WHY FRESHAF
• Every pro is vetted and approved by FreshAF before they can take a job.
• One clear price, no surprise fees.
• Rewards on every completed order, to spend on your next one.
• Rate every job, so the best pros rise to the top.

FOR PROS
Run your own car wash or laundry business through FreshAF Pro: set your own prices, choose how far you travel, go online when you want work, and get job alerts on your phone.

FreshAF is signing up pros across South Africa. If no pro works near you yet, the app shows that before you book, so you never pay for a service nobody can do.

FreshAF (Pty) Ltd, South Africa.

---

## App Review notes (paste into "Notes" under App Review Information)

FreshAF is an on-demand marketplace for physical services: mobile car washes and laundry collection, carried out by independent pros at the customer's address, anywhere in South Africa where a pro works.

DEMO ACCOUNTS. The sign-in details are in the Sign-in Information fields. Two accounts are provided:
- a customer account, to book a service;
- a pro account, to see the pro side (job offers, prices, earnings).
Both are marked as demo accounts on our side: the demo customer is only ever matched with the demo pro, and card payments for the demo customer go to a test payment page. Nothing you do will send a real person to a real address or charge a real card.

TO TRY A BOOKING. Sign in as the demo customer, choose Car Wash, and use the address 1 Main Road, Durbanville, Cape Town (or drop the pin anywhere in Durbanville). The demo pro is online there and answers with a price straight away. You can choose Cash or Card; Card opens a test checkout where no real card is charged. If nobody works the job from the pro side, it moves itself along (on the way, in progress, done) within a few minutes. To see the job from the other side, sign in to the pro account on a second device.

LOCATION. The app asks for location only when you tap "Use my location", to place the pickup pin. You can type an address instead. An address with no pro working nearby returns no pros; the demo pro works in Durbanville, Cape Town, so please use the address above.

PAYMENTS. Customers pay for a physical service performed outside the app, so payment is taken by our card provider on its own page or in cash on completion (Guideline 3.1.3(e)). There is nothing to buy inside the app itself.

ACCOUNT DELETION. Account > Delete account, confirmed with the password. Also available at https://freshaf.io/delete-account.

WHAT IS NATIVE. The app's screens ship inside the binary; only data comes from our server. It uses native push notifications for pros' job alerts, device location for the pickup pin, the native splash screen and status bar, haptic feedback, and stores the sign-in in native storage.

---

## Reviewer accounts: how to set them up (do this before submitting)

Apple's reviewers test from outside South Africa, at any hour. The accounts must work without anyone from FreshAF being awake.

1. **Email aliases:** make `review@freshaf.io` and `review-pro@freshaf.io` aliases of the admin mailbox, so any email the app sends them (including a password reset) reaches you.
2. **Admin dashboard > Store reviewer accounts > Create reviewer accounts.** One press makes both: a demo customer and a demo pro that is approved, priced at the suggested prices for car wash and laundry, and online in Durbanville with a 25 km radius. Both passwords are shown once: press **Copy sign-in details** and keep them in the password manager. Demo accounts only see each other.
3. **Pressing it again** resets both passwords and puts the pro back online (use it if a password is lost, or after the review). The card shows whether the pro is still online.
4. **Book one test order as the demo customer** and complete it from the pro side, so you have watched the whole flow work the way the reviewer will.
5. Put both email addresses and passwords into **App Store Connect > App Review Information > Sign-in Information** (and the pro one in the Notes, since that field takes one account). Never put them in this file or anywhere in the repository.
6. **Before submitting, check push is live:** the admin readiness screen must show iOS push
   as live (APNs key on Render, `APP-STORE-SUBMISSION.md` step B4). The review notes say pros
   get native job alerts; that must be true when the reviewer looks.
7. After approval, leave the accounts in place for the next update's review.

---

## App Privacy (App Store Connect > App Privacy)

Answer exactly as `APP-STORE-SUBMISSION.md` section D, which matches `ios/App/App/PrivacyInfo.xcprivacy`. In short: data is collected, linked to the user, used for App Functionality only, and **not used for tracking**.

---

## Google Play listing (Play Console > Grow > Store presence > Main store listing)

| Field | Value |
|---|---|
| **App name** (max 30) | FreshAF: Car Wash & Laundry |
| **Short description** (max 80) | Vetted pros wash your car and do your laundry, at your address. |
| **Full description** (max 4000) | Paste the Description section above, unchanged |
| **App icon** | `public/img/icon-512.png` (512×512) |
| **Feature graphic** | 1024×500, `marketing/play-feature-graphic.png` |
| **Phone screenshots** | At least 2, 1080×1920 or larger (APP-STORE-SUBMISSION.md section C) |
| **Category** | Lifestyle |
| **Tags** | Car wash, Laundry, Home services |
| **Contact email** | The FreshAF support mailbox (as on freshaf.io/contact) |
| **Website** | https://freshaf.io |
| **Privacy policy** | https://freshaf.io/privacy |
| **Account deletion URL** | https://freshaf.io/delete-account |
| **Countries** | South Africa only |
| **Price** | Free; no in-app purchases (real-world services are paid outside Play billing) |
| **Ads** | No, the app contains no ads |
| **Content rating** | IARC questionnaire: no violence, no user-generated public content, no gambling → Everyone |
| **Target audience** | 18 and over (bookings and payments) |
| **Data safety** | Exactly as APP-STORE-SUBMISSION.md section D |

**App access (Play Console > Policy > App content > App access):** "All or some functionality
is restricted" → add the demo customer and demo pro sign-ins, with the same instructions as
the App Review notes above (address 1 Main Road, Durbanville). The accounts are the same ones
Apple uses; set them up as in "Reviewer accounts" above.
