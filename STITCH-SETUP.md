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
| `PAYMENTS_LIVE` | `true` — **safe while the credentials are the `test-` pair** |

Stitch Express settles into the bank account verified on the account, so there are **no
beneficiary variables**. The older advice to set `STITCH_BENEFICIARY_*` or
`STITCH_MERCHANT_ID` belonged to the Enterprise GraphQL API and does not apply here.

### Why `PAYMENTS_LIVE=true` is safe right now

Card is off while that is unset, which means the live site cannot exercise the real
payment path at all — and the webhook is registered against `https://freshaf.io`, so it
can never be proven from a laptop. Turning it on with the **test** credentials runs the
whole chain on the real domain while charging nobody. Swap in the live credentials only
once an end-to-end test has passed.

**While `PAYMENTS_LIVE` is unset, the app stays on cash and sandbox.** Nothing breaks, nothing
charges anyone. Flipping it to `true` is the single switch that turns card on, and only once
every value above is present.

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

- **No persistent disk on Render.** Orders and customers are wiped on every restart. Taking real
  card money into a database that forgets the order is worse than taking no card money. **Fix this
  before `PAYMENTS_LIVE=true`.**
- **Chargebacks are FreshAF's loss** now, and a pro may already have been paid. Set a payout delay.
- **`SUPPLIER-AGREEMENT-DRAFT.md` is unsigned.** The deadline moved: it was "before the first pro
  is approved", and acquiring clause 13.2 makes it **also "before the first card payment"**.
- **Set-off against card payouts** — the other half of the cash mechanic in `GETTING-PAID.md` —
  can be wired as soon as card revenue exists. `balance.settle()` is the hook.
