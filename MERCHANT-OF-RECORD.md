# FreshAF is now the merchant of record

*Decision taken 26 October 2026, after PayFast declined FreshAF for being a third party.
Background and the alternatives considered: `PAYMENTS-STRATEGY.md`.*

---

## The change in one line

**Before:** the customer contracted with the Pro, at the Pro's price, and FreshAF added a 10%
service fee for arranging it. FreshAF collected money belonging to someone else — a Third Party
Payment Provider under the NPS Act, which no ordinary gateway will underwrite.

**After:** the customer contracts with **FreshAF**. FreshAF sells the wash or the laundry at
FreshAF's price, and **buys the work from the Pro** as a subcontractor. The money FreshAF collects
is its own revenue, and paying Pros is paying its own suppliers. **No third-party collection, so
no TPPP question.** This is the Uber structure.

---

## What stays exactly the same — deliberately

| | |
|---|---|
| **Pros set their own price** | Unchanged, and this matters more than ever. It is the single strongest fact against a Pro later being found to be an employee. |
| **Pros are paid their price in full** | Unchanged. FreshAF's margin is added when pricing to the customer, never deducted from the Pro. |
| **Pros choose jobs, hours, radius, equipment** | Unchanged, and now written into the T&C explicitly, including the right to work for competitors. |
| **The customer still picks their Pro** | Unchanged. They see business name, rating, distance, availability. |
| **Cash still works end to end** | The Pro now collects **as FreshAF's collection agent** rather than for themselves. Same money, correct characterisation. |

## What actually changed

**Code**

- `server/quotes.js` — the customer API no longer returns `supplier_price_cents`,
  `platform_fee_cents` or `callout_fee_cents`. They stay in the database, because they are
  FreshAF's cost of sale and margin and the accounts need them. They are simply not the
  customer's business, and itemising them on a customer's bill was the clearest evidence that
  FreshAF was acting as an intermediary.
- `public/js/app.js` — one price per Pro, "all in, nothing added". No breakdown line on the
  quote card, the total, or the order tracker.
- `public/js/supplier.js`, `public/supplier.html` — the Pro screens now say FreshAF **pays them
  their price for the job**, and no longer advertise FreshAF's margin to them. The cash balance
  reads "Owed to FreshAF from cash jobs".
- `server/payments.js` — unrelated but adjacent: card payments now require `PAYMENTS_LIVE=true`
  as well as merchant keys.

**Legal pages**

- `public/terms.html` — sections 1, 3, 4, 5, 6, 8, 9, **11** and 12 rewritten. Section 1 now says
  the contract is with FreshAF. Section 11 recasts the Pro as an independent subcontractor who
  sells to FreshAF, and adds an indemnity in FreshAF's favour.
- `public/contact.html` — the ECT Act s43 disclosures now state plainly that FreshAF is the
  supplier and the merchant of record.
- `public/privacy.html` — wording only.

**Still to be drafted and signed**

- `SUPPLIER-AGREEMENT-DRAFT.md` — the FreshAF ↔ Pro contract. The T&C refers to it and says it
  prevails, so it must exist before the first Pro is approved.

---

## ⚠️ The one thing that will bite you: VAT

This is the real cost of the restructure, and it is arithmetic, not opinion.

As a facilitator, FreshAF's taxable turnover was the 10% fee. **As merchant of record it is the
full order value.** Two consequences:

**1. The R1m VAT threshold arrives about eleven times sooner.** R1m of *fees* meant roughly R11m
of bookings. R1m of *bookings* is around 4,500 jobs — about 12 a day for a year.

**2. At a 10% margin, VAT registration makes every job loss-making.** Most small car washers and
laundries are not VAT registered, so they invoice FreshAF with no VAT and there is **no input VAT
to claim back**:

| On a job where the Pro is paid R200 | 10% margin | 15% margin | 25% margin |
|---|---|---|---|
| FreshAF's price to customer | R220 | R230 | R250 |
| Output VAT (15/115 of price) | R28.70 | R30.00 | R32.61 |
| Paid to Pro | R200 | R200 | R200 |
| **FreshAF keeps** | **−R8.70** | **R0.00** | **R17.39** |

**15% is break-even. You need about 26.5% to actually keep 10%.** Uber charges ~25%. That is not
a coincidence.

### Recommendation

**Set the margin to 25% now, before the first customer and the first approved Pro.** It costs
nothing today and it is the cheapest moment this company will ever have to change it. Raising it
later means telling Pros their jobs are worth less and telling customers prices went up 15%.

It is one admin setting, `platform_fee_pct`. Nothing in the customer-facing app changes, because
the customer only ever sees one number.

Mitigations worth knowing:

- A **VAT-registered Pro** solves it for their jobs — FreshAF claims the input VAT. Worth
  preferring them as volume grows, and worth asking at onboarding.
- Registering for VAT voluntarily and early means prices rise once, cleanly, rather than margin
  quietly inverting the month you cross R1m.
- Below R1m of bookings none of this applies. **You are nowhere near it.** It is not urgent; it is
  just much cheaper to decide now than later.

---

## Other consequences Nikki should sign off

- **Consumer Protection Act.** FreshAF now supplies the service, so quality, damage and refund
  claims come to FreshAF. The T&C routes them to us and the Supplier Agreement pushes them back
  to the Pro by indemnity — but an indemnity against a sole trader with no assets is worth little.
  **Public liability insurance covering subcontracted work is now a real requirement, not a
  nice-to-have.**
- **Employment risk.** "We sell their services as our own" moves FreshAF closer to the control
  that triggers the employee presumptions in LRA s200A. The defences are preserved on purpose:
  the Pro sets the price, accepts or declines freely, sets their own radius, supplies their own
  equipment and may work for competitors. **Do not erode those to improve the product.** Uber has
  fought this exact fight in South Africa.
- **Chargebacks** are now FreshAF's loss, and FreshAF may already have paid the Pro. Set a payout
  delay, or hold a reserve, before card volume is meaningful.
- **Invoicing.** Pros must invoice FreshAF, or agree to a self-billed statement. The T&C allows
  both; the mechanism is not built yet.

---

## What this unlocks

PayFast's objection is gone: FreshAF is no longer collecting for third parties. **The existing
PayFast application can be resubmitted under the correct description** — "we sell mobile car wash
and laundry services and subcontract the work" — and the same is true of Yoco, Peach or Stitch
Express at self-serve rates. No marketplace product, no enterprise sales cycle, no sponsoring bank.

Before resubmitting, make sure the live site matches the story: `freshaf.io/terms` and
`freshaf.io/contact` are the first things an underwriter reads.
