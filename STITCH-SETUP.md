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

### 4. Ask Stitch to switch on two things

Neither can be done from the dashboard, and **the integration will not work without them**:

1. **Enable Card on the client.** Their docs say the card feature is enabled per client.
2. **Allowlist `https://freshaf.io`** for redirects. Stitch refuses to send a customer back to a
   domain that is not on the list, and production clients must be https.

### 5. Create a webhook subscription

Point it at:

```
https://freshaf.io/api/payments/stitch/webhook
```

Subscribe to the **`payment`** event type. Stitch returns a **signing secret** beginning `whsec_`
— that is `STITCH_WEBHOOK_SECRET` below. **The route is already built and tested**; it rejects
anything that is not correctly signed.

### 6. Set these on Render, then tell me

Render → freshaf service → Environment. **Do not paste any of these into chat** — set them
yourself and just tell me they are in.

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `stitch` |
| `STITCH_CLIENT_ID` | from the Stitch dashboard |
| `STITCH_CLIENT_SECRET` | from the Stitch dashboard |
| `STITCH_WEBHOOK_SECRET` | the `whsec_…` from step 3 |
| `STITCH_BENEFICIARY_NAME` | `FRESHAF (PTY) LTD` |
| `STITCH_BENEFICIARY_BANK_ID` | `fnb` |
| `STITCH_BENEFICIARY_ACCOUNT_NUMBER` | the FNB business account number |
| `PAYMENTS_LIVE` | **leave unset until a test payment has worked** |

If Stitch issues a **merchant id** instead, set `STITCH_MERCHANT_ID` and leave the three
beneficiary variables empty — the two approaches are mutually exclusive in their API.

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
