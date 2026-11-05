# FreshAF: App Store listing, review notes and reviewer accounts

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
| **Availability** | South Africa only, to start. Every order is fulfilled in Cape Town |
| **Copyright** | 2026 FreshAF (Pty) Ltd |
| **Support URL** | https://freshaf.io/contact |
| **Marketing URL** | https://freshaf.io |
| **Privacy Policy URL** | https://freshaf.io/privacy |

## Promotional text (max 170, can be changed without a new build)

Mobile car washes and laundry collection across Cape Town's Northern Suburbs. Compare vetted pros, book in under a minute, pay by card or cash.

## Keywords (max 100, comma-separated, no spaces after commas)

valet,mobile wash,laundromat,ironing,duvet,cleaning,Cape Town,Durbanville,Bellville,detailing

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

Serving Bellville, Durbanville, Brackenfell, Kraaifontein, Kuils River, Parow, Goodwood, Tygervalley, Plattekloof, Welgemoed, Edgemead, Bothasig, Monte Vista, Vredekloof and Stikland, with more of Cape Town to follow.

FreshAF (Pty) Ltd, Cape Town.

---

## App Review notes (paste into "Notes" under App Review Information)

FreshAF is an on-demand marketplace for physical services: mobile car washes and laundry collection, carried out by independent pros at the customer's address in Cape Town, South Africa.

DEMO ACCOUNTS. The sign-in details are in the Sign-in Information fields. Two accounts are provided:
- a customer account, to book a service;
- a pro account, to see the pro side (job offers, prices, earnings).
Both are marked as demo accounts on our side: the demo customer is only ever matched with the demo pro, and card payments for the demo customer go to a test payment page. Nothing you do will send a real person to a real address or charge a real card.

TO TRY A BOOKING. Sign in as the demo customer, choose Car Wash, and use the address 1 Main Road, Durbanville, Cape Town (or drop the pin anywhere in Durbanville). The demo pro is online there and appears in the list. You can choose Cash or Card; Card opens the test payment page. To see the job from the other side, sign in to the pro account on a second device.

LOCATION. The app asks for location only when you tap "Use my location", to place the pickup pin. You can type an address instead. Addresses outside Cape Town's Northern Suburbs return no pros, because that is where we operate.

PAYMENTS. Customers pay for a physical service performed outside the app, so payment is taken by our card provider on its own page or in cash on completion (Guideline 3.1.3(e)). There is nothing to buy inside the app itself.

ACCOUNT DELETION. Account > Delete account, confirmed with the password. Also available at https://freshaf.io/delete-account.

WHAT IS NATIVE. The app's screens ship inside the binary; only data comes from our server. It uses native push notifications for pros' job alerts, device location for the pickup pin, the native splash screen and status bar, haptic feedback, and stores the sign-in in native storage.

---

## Reviewer accounts: how to set them up (do this before submitting)

Apple's reviewers test from outside South Africa, at any hour. The accounts must work without anyone from FreshAF being awake.

1. **Create two accounts on freshaf.io** in the normal way: one customer (sign up on the site) and one pro (apply on freshaf.io/supplier). Use addresses you control, for example `appreview@freshaf.io` and `appreview-pro@freshaf.io` as aliases of the admin mailbox, so any email the app sends them reaches you.
2. **Admin dashboard:** approve the pro, then press **Make demo** on both accounts (Suppliers and Customer sign-ups lists). From then on they only see each other, and the demo customer's card payments go to the test page.
3. **Sign in as the demo pro** once on a phone: set prices for every package, set the travel radius to 25 km, drop the location pin in Durbanville, and go **online**. Leave it online for the review period.
4. **Book one test order as the demo customer** and complete it from the pro side, so you have watched the whole flow work the way the reviewer will.
5. Put both email addresses and passwords into **App Store Connect > App Review Information > Sign-in Information** (and the pro one in the Notes, since that field takes one account). Never put them in this file or anywhere in the repository.
6. **Before submitting, check push is live:** the admin readiness screen must show iOS push
   as live (APNs key on Render, `APP-STORE-SUBMISSION.md` step B4). The review notes say pros
   get native job alerts; that must be true when the reviewer looks.
7. After approval, leave the accounts in place for the next update's review.

---

## App Privacy (App Store Connect > App Privacy)

Answer exactly as `APP-STORE-SUBMISSION.md` section D, which matches `ios/App/App/PrivacyInfo.xcprivacy`. In short: data is collected, linked to the user, used for App Functionality only, and **not used for tracking**.
