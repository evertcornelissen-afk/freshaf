# Getting Stitch live on freshaf.io

*Built 29 October 2026. The code is done and tested. What remains is an account, five
environment variables, and two things only Stitch can switch on.*

---

## Why Stitch Express is enough

When FreshAF was a facilitator, taking card money meant a **marketplace payments product** —
enterprise sales, custom pricing, a sponsoring bank conversation. **That is no longer the case.**
As merchant of record, FreshAF is an ordinary online business: money in from customers, money out
to suppliers. That is exactly what the self-serve tier is for.

Published Express pricing (VAT exclusive, **verify at signup** — these move):

| | |
|---|---|
| Local cards | **2.95%** |
| International cards | 3.4% |
| Monthly fee | none |
| Custom pricing above | ~R100k/month |

For comparison, PayFast's standard rate is around 3.5%, so this is no worse — and it is the
account FreshAF can actually get.

---

## Verification — where it stands

> **⚠️ UPDATED 19 Nov 2026, read from the live dashboard. The 3 November table below is
> OUT OF DATE and must not be used to decide anything.**
>
> `express.stitch.money/verification` now shows:
>
> | | |
> |---|---|
> | Status | **In progress** |
> | Integration submitted for review | **06 Nov 2026** - *"Our team will be in touch."* |
> | Verification submitted | **09 Nov 2026** |
> | Go live | *"Live payments switch on when your business is verified and your integration has passed review. Both are required."* |
>
> **Nothing on the dashboard is flagged as waiting on us.** The ID numbers, selfie, bank
> account and proof-of-address items listed below were all resolved before the 9 November
> submission. Both halves are sitting with Stitch and neither has come back.
>
> A chase was drafted on 19 Nov at `drafts/stitch-verification-chase.txt` for Evert to send.

### The original 3 November notes, kept for history


*3 November 2026. Five steps at https://express.stitch.money/verification. "We save as you go",
so it can be finished in any order.*

| # | Step | State |
|---|---|---|
| 1 | Your business | ✅ **Done.** CIPC lookup on the registration number returned FRESHAF, In Business, both directors. Trading name set to **FreshAF** — this is what customers see. |
| 2 | Verify yourself | Half done — role confirmed as Evert Cornelissen, Director. **Needs an ID number and a selfie.** |
| 3 | Directors and shareholders | **Needs both directors' ID numbers**, then "No, that's everyone" to the 25%-owner question. |
| 4 | Bank account | Bank set to **First National Bank (FNB)**, type **Cheque/Current**. **Needs the account number**, then a bank statement. |
| 5 | Address | Business address saved, spelling and suburb corrected. **Needs a proof-of-address document.** |

Nikki does **not** need Evert's login — the page says "Waiting on other people. They have their
own link." Stitch emails her directly.

### ⚠️ The two supporting documents on file do not fit what Stitch asks for

**Proof of address.** The form says *"This must match the document you upload."* The document
currently on file is for a different address from the one on the application, is in a personal
name rather than the company's, and is not one of the eleven types Stitch lists.

Accepted types: bank statement, utility bill, municipal rates notice, body corporate letter,
mobile phone account, home loan statement, insurance policy, motor vehicle registration, tax
certificate, lease agreement, property management statement. **Under 3 months old**, so dated on
or after **3 August 2026**.

Decide which address FreshAF declares, then obtain a listed document showing *that* address.
Changing the declared address means editing step 5 first.

**Bank statement.** Stitch wants a statement **"covering at least 3 months"**. The FNB business
account is recorded as a new account, so three months of statements may not exist yet. Ask Stitch
through the Support widget whether an account confirmation letter will do — now, rather than
discovering it at the end.

---

## What you do

> 📖 **Read `STITCH-CONTRACT-REVIEW.md` before signing.** Their acquiring terms contain two
> clauses the old FreshAF would have failed, one deadline that moved, and one risk we had not
> priced in (settlement timing).

### 1. Create the account — ~5 minutes

**https://express.stitch.money/signup**. Claude cannot do this step: it creates an account, sets a
password, and accepts the Acquiring Service Terms, which is a contract binding FreshAF.

| Field | Value |
|---|---|
| First name | `Evert` |
| Last name | `Cornelissen` |
| Phone number | `078 299 1050` |
| Email address | `admin@freshaf.io` — **not** a personal address; Nikki shares this mailbox |
| Password | yours; put it in the password manager, not in chat |
| Terms and Conditions + Privacy Policy | tick — required |
| **Acquiring Service Terms** | tick — required. **This is the card contract.** See the review doc |
| Marketing communication | optional; leave unticked |

### 2. The business description — get this exactly right

Clause 7.7.3 of the acquiring terms bars transactions for *"goods or services which fall outside
the description of your Business"* without prior written approval, so **what you type here is
contractually binding**, not marketing copy. It must name **both** services:

> FreshAF (Pty) Ltd sells on-demand mobile car wash and laundry services to consumers in South
> Africa. Customers book and pay FreshAF online; we set the price, invoice in our own name, and
> are responsible to the customer for the service. The work is performed at the customer's
> address by independent service professionals whom FreshAF engages and pays as our
> subcontractors. FreshAF is the merchant of record and does not hold or disburse funds on
> behalf of third parties.

If they want to see it, send them **https://freshaf.io/terms** and **https://freshaf.io/contact**
— both say exactly this, verified 2 Nov 2026.

### 3. Company details

Go to **https://express.stitch.money** and sign up as **FRESHAF (PTY) LTD**.

When they ask what the business does, describe it the way the restructure made true. **This
wording matters** — it is the thing PayFast rejected:

> FreshAF sells on-demand mobile car wash and laundry services to consumers in South Africa.
> We contract with the customer, set the price and invoice in our own name. The work is carried
> out by independent service professionals we engage and pay as our subcontractors. We are the
> merchant of record. We do not hold or disburse funds on behalf of third parties.

Point them at **https://freshaf.io/terms** and **https://freshaf.io/contact** if they want to see
it. Both now say exactly this.

Documents are the same set the PayFast application needed — see `PAYFAST-APPLICATION-SHEET.md`
for the field-by-field answers, they transfer directly.

> ⚠️ Still outstanding from that list: proof of business address under 3 months, both directors'
> IDs (both sides), and Beneficial Ownership filed at CIPC. Expect Stitch to ask for the same.

### 4. Card is self-serve — but only after verification

**Corrected 3 November 2026, from the live dashboard.** An earlier version of this document said
to ask support to enable Card. That is wrong. Card is a toggle you flip yourself, under
**Payment experience → Payment methods** (it reads "0 of 4 methods on" until you do). The same
page holds **Branding**, which is where the logo goes.

The catch: that entire page is locked behind a "Verify your business to set up your payment
experience" gate. **Nothing about the payment experience can be configured until verification
passes** — not the logo, not Card, not Apple Pay or Google Pay.

Redirect allowlisting was not visible anywhere before verification. Check that page once it
unlocks; if `https://freshaf.io` cannot be allowlisted there, ask support then.

### 5. Create a webhook subscription — **one command, not by hand**

Once the client id and secret are set (locally in `.env`, or on Render), run:

```bash
npm run stitch:check
```

It reaches Stitch's live token endpoint and tells you, in order: whether the credentials
work, whether **Card is enabled on your client**, and what your schema's `clientWebhookAdd`
actually takes. It changes nothing. Then:

```bash
npm run stitch:connect
```

That registers the subscription against `https://freshaf.io/api/payments/stitch/webhook` and
**prints the signing secret** to paste into Render. Add `-- --test-payment` to also get a live
R1.00 card link you can pay yourself to prove the whole chain.

It introspects your live schema rather than assuming a shape, because Stitch's published
examples of this mutation disagree between API generations.

<details><summary>If the scope is missing, do it by hand instead</summary>

### 5b. Manual webhook subscription

Point it at:

```
https://freshaf.io/api/payments/stitch/webhook
```

Subscribe to the **`payment`** event type. Stitch returns a **signing secret** beginning `whsec_`
— that is `STITCH_WEBHOOK_SECRET` below. **The route is already built and tested**; it rejects
anything that is not correctly signed.

</details>

### 6. Set these on Render, then tell me

Render → freshaf service → Environment. **Do not paste any of these into chat** — set them
yourself and just tell me they are in.

**All four values are already in your local `freshaf/.env`.** Open that file and copy them
across — do not re-view the client secret in the Stitch dashboard, because that
regenerates it and would break the copy you already have.

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `stitch` |
| `STITCH_CLIENT_ID` | copy from `.env` (starts `test-` while testing) |
| `STITCH_CLIENT_SECRET` | copy from `.env` |
| `STITCH_WEBHOOK_SECRET` | copy from `.env` (starts `whsec_`) |
| `PAYMENTS_LIVE` | `true` — **safe only while the client id starts with `test-`** |

Stitch Express settles into the bank account verified on the account, so there are **no
beneficiary variables**. The older advice to set `STITCH_BENEFICIARY_*` or
`STITCH_MERCHANT_ID` belonged to the Enterprise GraphQL API and does not apply here.

### Why `PAYMENTS_LIVE=true` is safe right now

Card is off while that is unset, which means the live site cannot exercise the real
payment path at all — and the webhook is registered against `https://freshaf.io`, so it
can never be proven from a laptop. Turning it on with the **test** credentials runs the
whole chain on the real domain while charging nobody.

This is safe **only while `STITCH_CLIENT_ID` starts with `test-`**. Test keys move no
money, and real customers still see cash. The moment the client id is a live one,
`PAYMENTS_LIVE=true` is not safe on its own. Live card charges also require
`PAYOUTS_READY=true`, and the go-live steps below turn `PAYMENTS_LIVE` **off before the
keys are swapped**, so a deploy cannot charge anyone in the gap. Do not skip that step
because the second flag exists.

**While `PAYMENTS_LIVE` is unset, the app stays on cash and sandbox.** Nothing breaks, nothing
charges anyone. With test keys, flipping it to `true` turns the rehearsal on. With live
keys it is one of two switches, and `PAYOUTS_READY` is the other.

### 7. Clear the dead PayFast variables

`PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`. They are not FreshAF's, they
are not used now that the provider is Stitch, and they should not be sitting there.

---

## What is already built

| | |
|---|---|
| `server/stitch.js` | Token fetch and caching, payment-request creation, webhook signature verification, payload parsing. |
| `server/payments.js` | Provider dispatch (`stitch` \| `payfast` \| sandbox) behind the `PAYMENTS_LIVE` switch. |
| `server/routes/orders.js` | `POST /api/payments/stitch/webhook`, and payment creation that fails loudly instead of stranding an order. |
| `server/index.js` | Raw body parsing on the webhook path only — Stitch signs the unmodified bytes. |
| `test/` | `npm test` runs both. |

**Tested, not assumed:**

- Signature verification passes **Svix's own published test vector**, and rejects a tampered body,
  a wrong signature, missing headers and a replayed old delivery. It accepts a valid signature
  among several during secret rotation.
- Over real HTTP: a forged webhook is refused with 400 and leaves the order untouched; a correctly
  signed one marks the order paid; cancellations and unknown orders are acknowledged so Stitch
  stops retrying them.

**Deliberate:** the browser redirect carries a `status` parameter that anyone can edit, so it is
ignored. **Only the signed webhook marks an order paid.**

---

## How to tell it is working

Once the variables are in and `PAYMENTS_LIVE=true`:

```bash
curl -s https://freshaf.io/api/pricing | grep -o '"payments_live":[a-z]*'
```

`true` means every variable is present and card is live. `false` means something is missing —
the admin dashboard's readiness panel names which one.

Then place one real low-value order and pay it. Check that:

1. The money arrives in the FNB account.
2. The order shows **paid** in admin without anyone touching it — that is the webhook working.
3. The pro is dispatched automatically.

---

## Stitch's review test — what they will see (checked 12 Nov 2026)

`npm run stitch:e2e` rehearses the reviewer against the **real Stitch test API**: demo customer
signs in → instant quote from the demo pro (offline, nobody awake) → Card → real Stitch test
link (amount checked in cents) → signed `payment.paid` → order paid and booked → the same
webhook again is harmless → return page loads → can book again. **16/16 passed.** Live site the
same day: `/api/health` return URL is exactly `https://freshaf.io/payment-complete`, data
survives restarts, forged webhooks get 400, `/terms` `/privacy` `/contact` all 200.

**The one thing that will fail them:** a visitor who is *not* signed in as a demo account sees
"Pay cash on completion" and no Card button (test keys never open card to the public). Stitch
must be given the **demo customer login** with the steps below, or they will report that
Stitch is not on the checkout.

> To test a card payment: sign in at https://freshaf.io with the demo customer account below.
> Choose Car Wash, use the address 1 Main Road, Durbanville (any address works for this
> account), and request a quote. The demo pro answers straight away. Accept it, choose Card,
> and you are taken to the Stitch test checkout. After paying with a Stitch test card you
> return to FreshAF and the booking shows as paid within about a minute (our webhook marks it
> paid; the browser redirect alone never does). The demo account can book as often as needed
> and never involves a real person.

Demo login: admin app → **Store reviewer accounts** (shows whether the demo pro is approved and
online). Pressing **Create** again resets both passwords — if Apple/Google already have them,
give Stitch the same ones instead.

## Pre-flight verified from the live dashboard, 19 Nov 2026

Checked while chasing Stitch. **Nothing is outstanding on our side** — every item below was
read off the account, not assumed:

| Check | State |
|---|---|
| Submit your verification | ✅ green tick, submitted **09 Nov 2026** |
| Build your integration — all 4 items | ✅ all four green-ticked (payment link, redirect URL, test payment, webhook) |
| Submit your integration for review | ✅ green tick, submitted **06 Nov 2026**, *"Our team will be in touch"* |
| Go Live | ⬜ step 4, not reached — needs Stitch to verify + pass review |
| Redirect URLs registered | `https://freshaf.io/payment-complete` **and** `http://localhost:5757/payment-complete` |
| Webhook endpoint | `https://freshaf.io/api/payments/stitch/webhook` — *"FreshAF order payment confirmations"*, **error rate 0.0%** |
| Client ID | `test-45a2e8dd-…` — still a test client, so card stays hidden from real customers |
| `GET https://freshaf.io/api/pricing` (public, no auth) | `"payments_live": false` ✅ matches |

So the production redirect and webhook are **already registered and healthy**. The only thing
between FreshAF and live card payments is Stitch activating the account.

A chase was sent 19 Nov 2026 (draft kept at `drafts/stitch-verification-chase.txt`), quoting
both submission dates and the silence since.

Note for step 4 of the runbook below: the public endpoint is **`/api/pricing`**, not
`/api/orders/pricing` — the latter is the router path and answers 401 when signed out.

## When Stitch approves — switching to live keys

Live keys are a **separate Stitch client**. Assume the test client's return URL and webhook
do **not** carry over, and its webhook secret is different.

**Turn card off before the keys change.** `PAYMENTS_LIVE=true` is in the test-key table
above because test keys charge nobody. If it is still `true` when the live client id is
saved, that deploy is the one that can charge a real card. The app also refuses live
charges until `PAYOUTS_READY=true`. That is a second lock, not a reason to skip this step.

1. Render → Environment. If `PAYMENTS_LIVE` is `true`, set it to `false` (or clear it)
   and deploy. Wait until this shows `false` **before** you change `STITCH_CLIENT_ID`:

   ```bash
   curl -s https://freshaf.io/api/pricing | grep -o '"payments_live":[a-z]*'
   ```

   On the same day, `curl -s https://freshaf.io/api/health` must show `"data_persisted":true`.
   Card money into a database that forgets the order is worse than no card money.
2. Put the live client id + secret in local `.env` **and** set `BASE_URL=https://freshaf.io`
   and remove `STITCH_WEBHOOK_SECRET` from `.env` for this one run. Leave `PAYMENTS_LIVE`
   unset in `.env` too.
3. `npm run stitch:connect` — registers `https://freshaf.io/payment-complete` (exact, no
   trailing slash) and the webhook, and prints the **new** `whsec_` secret once. Run it
   yourself; never paste the output into chat.
4. Render → Environment: replace `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET`,
   `STITCH_WEBHOOK_SECRET` (use `scripts/copy-render-env.ps1`). **Leave `PAYMENTS_LIVE`
   false. Leave `PAYOUTS_READY` unset.** One deploy, outside busy hours (each deploy =
   ~1 min of 502).
5. Check: the same `curl` still shows `"payments_live":false` signed out. The admin
   readiness panel should say live keys are present and card is still off.
6. Open **Payouts** in the admin app and confirm the balances screen loads. Stitch cannot
   pay a pro. That screen is the payout run — how it works is below.
7. Set `PAYOUTS_READY=true` and deploy. Then set `PAYMENTS_LIVE=true` and deploy again.
   Two steps on purpose: the first arms the lock, the second opens card.
8. Check: `curl -s https://freshaf.io/api/pricing` shows `"payments_live":true` signed out.
9. `npm run stitch:test` makes a live **R1.00** link. Pay it with your own card: R1 should
   reach FNB and the Stitch webhooks page should show a 200 from freshaf.io.
   That R1 is not a pro job. Nothing is owed to a pro for it.
10. From then on demo accounts use FreshAF's internal test page, never Stitch — a reviewer's
    card is never charged with live keys.

### How pros get paid

Stitch Express has no payout to a third party. Checked against the live OpenAPI
(`https://express.stitch.money/api/openapi.json`): the payment routes are payment links,
refunds and `POST /api/v1/withdrawal`. Withdrawal moves FreshAF's own Stitch balance into
the bank account verified on the Stitch account — FreshAF's FNB — either within the hour
(`INSTANT`) or within three working days (`DEFAULT`). It does not take a beneficiary.
The marketplace product that pays pros is a different API (`api.stitch.money`), and this
account is not on it. Routing customer funds to pros inside Stitch would also cut against
the acquiring terms (clause 7.7.5, and Capitec's "no payments to third-party accounts").

So the payout is an EFT FreshAF sends itself, recorded in `server/payouts.js`:

- A **paid card job**, once the pro marks it complete, credits the pro with their price
  plus the callout plus any laundry return trip. FreshAF's margin stays with FreshAF.
  The same figure the pro already sees as what they earned. A webhook retry cannot
  credit it twice.
- The credit sits for `payout_hold_days` (default **7**, changed on the Payouts screen,
  0–30) so a refund can land before the money leaves.
- **Cash commission is set off** when you create a batch. The pro's cash debt drops by
  the same amount, oldest job first, and a job that is only partly covered stays open.
  If the debt is larger than the card earnings, the batch pays R0 and the rest of the
  debt stays. Creating the batch does not send money.
- Download the CSV, pay it at the bank, then **Mark paid** with the bank reference.
  Marking paid records that you did. It does not move money. Void an unpaid batch if
  you have not sent it — the set-off is put back.
- A refund recorded in the admin app (**Mark refunded**, including on a completed card
  job) **voids** an earning that is not in a batch, and **deducts it from the next
  payout** if the pro was already paid. An earning sitting in an open batch has to be
  taken out by voiding that batch first.
- `PAYOUTS_READY` is not a Stitch setting. It is the confirmation that this is how pros
  will be paid. Without it, live keys cannot charge a real customer. Test keys ignore it.

## Ask them these before going live

From `STITCH-CONTRACT-REVIEW.md` — the acquiring terms leave all three open:

1. **What is the settlement period?** Cl. 10.1 states none. FreshAF pays pros their full price out
   of its own account on a 20% margin, so a week's hold means funding the pros' money ourselves.
2. **Is a reserve or rolling reserve applied to a new merchant, and at what percentage and for how
   long?** Cl. 8.2 and 10.2 allow one; no figure is published.
3. **Confirm in writing that FreshAF is onboarded as a merchant of record**, not as a marketplace
   under clause 13. If they do treat us as a marketplace, cl. 13.2 requires a signed written
   agreement with every pro **before** depositing transactions.

## Still open, and not Stitch's fault

- **Persistent disk is on.** `GET /api/health` reports `data_persisted: true` — the data folder
  has survived restarts. The older note that Render has no persistent disk is out of date.
  Still read that field on the day you switch keys. If it is ever `false` again, do not take
  card money.
- **Chargebacks are FreshAF's loss** once a pro has been paid. The payout hold (default 7 days)
  is the delay. A refund recorded after the pro was paid is deducted from their next payout.
  A chargeback that arrives and is never recorded in the admin app is still FreshAF's loss.
- **`SUPPLIER-AGREEMENT-DRAFT.md` is unsigned.** The deadline moved: it was "before the first pro
  is approved", and acquiring clause 13.2 makes it **also "before the first card payment"**.
- **Settlement timing and any reserve** are still unanswered by Stitch (the three questions
  above). The payout run pays pros from FreshAF's own account, so a long hold is working
  capital, not a software gap.
