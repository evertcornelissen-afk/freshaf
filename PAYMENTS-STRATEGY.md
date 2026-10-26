# Card payments — the real blocker is regulatory, not the gateway

*Written 26 October 2026, after PayFast declined FreshAF on the grounds that we are a
"third party".*

---

## What actually happened

PayFast did not reject the paperwork. They rejected **the money flow**.

FreshAF takes money from a customer and pays a different business (the pro). In South Africa
that makes you a **Third Party Payment Provider (TPPP)**. PASA's own test is explicit: you must
register, through a sponsoring bank, if you *accept payments from multiple parties on behalf of
a client, or disburse payments to multiple parties for a client*. The legal basis is the
National Payment System Act 78 of 1998 and SARB Third Party Provider Directive 1 of 2007.

A standard merchant account does not permit this. **No standard gateway will approve this money
flow** — not PayFast, not Yoco, not Peach, not a second PayFast application. Reapplying
elsewhere with the same structure gets the same answer.

> ⚠️ A SARB draft directive would replace PASA registration with direct SARB authorisation.
> Whether it is finalised was not confirmed. Nikki should check the current position before
> anyone relies on timing.

---

## Three ways out. Only three.

### Route A — Use a provider licensed to do the splitting

Let a licensed party hold the regulatory burden. Stitch markets exactly this: a
**marketplace and e-hailing** product with pay-ins, **automated payouts, split payments and
variable disbursements** through one integration. That is FreshAF's shape precisely.

| | |
|---|---|
| **Fit** | Best of the three. Purpose-built for this money flow. |
| **Cost** | Express self-serve is 2.95% local cards, no monthly fee, R2 standard payout. The marketplace product is **not** the self-serve tier — expect enterprise onboarding, 2–5 days, custom pricing. |
| **Risk** | Marketplace products are sold to businesses with volume. **FreshAF has zero pros and zero customers.** Expect to be asked about transaction volumes we cannot answer. |
| **Also verify** | Stitch's marketplace page is roughly three years old. Confirm the product still exists in this form, and ask directly whether *they* carry the TPPP authorisation or whether FreshAF still needs its own. |

### Route B — Stop being a third party: FreshAF becomes the seller

Restructure so the customer buys **from FreshAF**, and the pro is a **supplier FreshAF pays**.
No third-party collection, no TPPP, and **any ordinary gateway works** — including the PayFast
application already half-completed.

Costs nothing. But it is a real change, not a wording trick:

- **It contradicts the current T&C.** Section 1 says *"When you place an order you contract with
  the Pro you selected, at that Pro's price"*, and section 11 frames pros as independent
  contractors. That framing is exactly what PayFast objected to.
- **VAT.** As seller, FreshAF's turnover becomes the **full order value**, not the 10% fee.
  The R1m VAT registration threshold arrives far sooner, and output VAT applies to the whole sale.
- **Liability.** Selling the service makes FreshAF answerable for it under the Consumer
  Protection Act, rather than facilitating between two parties.
- **The pro's pricing freedom still works** — they quote, FreshAF sells at that price. But it
  becomes FreshAF's price to the customer.

**This is a lawyer decision, not a developer decision.** Nikki is a director and the legal lead.

### Route C — Cash only, properly

Cash never touches a gateway. The pro collects the full amount and owes FreshAF its 10%, which
FreshAF invoices. **No TPPP issue at all.**

Already built and working: the app hides the card option whenever no gateway is configured, and
cash orders bypass the payment adapter entirely. The fee-owed balance is already tracked per pro.

The gap is the one that has been open since July: **there is still no mechanism to collect the
10% from cash jobs.** That is a business decision, not a build.

---

## DECIDED — 26 October 2026: Route B

Evert chose **Route B, the Uber structure**: FreshAF sells the service and buys the work from the
Pro. Reason: the Pros were sitting unapproved waiting for payments to be solved, and Route B
unblocks them without an enterprise sales cycle or a sponsoring bank.

Implemented the same day — code, T&C, ECT disclosures and a draft Supplier Agreement. See
**`MERCHANT-OF-RECORD.md`**, which also carries the VAT arithmetic that now decides what the
margin has to be.

Route A (Stitch) is parked, not dead: if FreshAF ever wants Pros paid automatically out of each
transaction rather than from its own account, that is a marketplace-payments product again.

---

## Recommendation (as written before the decision)

**Launch on Route C. Decide between A and B while real orders are happening.**

Reasons, in order of weight:

1. **There are zero approved pros and zero customers.** No payment provider changes that. A
   marketplace payments contract for a business with no transactions is a conversation you are
   not ready to have.
2. **The persistent disk is still not attached** — since August. Every customer and pro is wiped
   on restart. Card payments into a database that forgets the order is worse than no card payments.
3. Route B is free and may be the right long-term answer anyway, but it carries VAT and liability
   consequences that need Nikki, not urgency.
4. Switching the gateway is genuinely cheap when the time comes — only `server/payments.js` and
   `server/routes/orders.js` touch PayFast, and `payments.js` is already an adapter with a
   sandbox fallback. **A Stitch adapter is roughly half a day.**

---

## If you want Stitch anyway

Ask them these before signing anything:

1. Does the marketplace product still exist, and is it available at self-serve tier or enterprise only?
2. **Does Stitch hold the TPPP / SARB authorisation for the disbursement leg, or does FreshAF still need its own?** This is the whole question — get it in writing.
3. Minimum monthly volume or minimum fees?
4. What KYC do the *pros* need, as payout beneficiaries? If each pro must be individually
   verified, that becomes onboarding friction on the supply side, which is already the bottleneck.
5. Settlement timing to the pros, and who carries chargeback liability.

Answers to 2 and 4 decide whether Stitch actually solves this or just moves it.
