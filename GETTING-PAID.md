# How FreshAF actually gets its money

*28 October 2026. Margin set to 20%. Read `MERCHANT-OF-RECORD.md` first for why the structure
changed.*

---

## The short answer

**On card, the money is yours before anyone else touches it. On cash, it is in the pro's pocket
and you have to get it back.** Those are two completely different problems, and the second one is
the only one that is actually unsolved.

---

## Card — solved by the restructure itself

Example job: the pro quoted R250, SUV multiplier applies, so FreshAF pays them **R313**.
FreshAF sells it at **R376**.

1. Customer pays **R376 to FreshAF**. It lands in FreshAF's FNB account.
2. FreshAF pays the pro **R313** on the agreed payout run.
3. **FreshAF keeps R63.** Nothing to collect, nothing to chase.

This is a genuine upside of becoming the merchant of record that is easy to miss: **your margin
arrives first and you pay out second.** Under the old facilitator model the full R376 was never
really yours, and you had to invoice the pro for your fee after the fact.

It also means you control the timing. A payout delay of a few days covers chargebacks, which are
now FreshAF's loss (see `SUPPLIER-AGREEMENT-DRAFT.md`, clause 4.6).

**Blocked on:** PayFast approval. Nothing to build — `server/payments.js` is ready and card is
held off by `PAYMENTS_LIVE`.

## Cash — the real problem, open since July

Same job. The pro collects **R376 at the door**. R313 is theirs; **R63 is FreshAF's money sitting
in their hand.**

The app already tracks it: `orders.fee_settled`, surfaced in the pro's earnings as *"Owed to
FreshAF from cash jobs"*. **What does not exist is any way to make them pay it.**

One thing did get better. Under the old model this was a *fee the pro owed us* — an ordinary
debt. Now the pro collects **as FreshAF's collection agent** (T&C section 11, agreement clause
4.5), so it is **FreshAF's money that they are holding**. Failing to hand it over is
misappropriation, not a late invoice. That is a materially stronger position, and it is already
written into both documents.

### The options, worst to best for where FreshAF is now

| Option | Verdict |
|---|---|
| **Pro pre-funds a wallet**, cash jobs deduct from it, no balance = offline | Strongest control, **wrong for now**. Asking a car washer with no customers yet for R500 upfront kills supply at exactly the moment you have none. |
| **Debit order / DebiCheck mandate** on each pro | Works, but it is admin, a mandate per pro, and it frightens small operators. Revisit at scale. |
| **Set off against card payouts** — already in the T&C and clause 4.5 | Right answer eventually, **useless today**: it needs card volume, and card is not live. |
| **Cash-owed cap** — a pro accrues up to R X, then goes offline until they settle | Cheap, enforceable, and `fee_settled` is already tracked. **Build this one.** |
| **Card-only for new pros**, cash unlocked after a clean settlement record | The cleanest long-term rule. Eliminates the risk exactly where it lives: new, unknown supply. Needs card live first. |

### What was built — the Uber mechanic, 28 October 2026

I had recommended chasing by WhatsApp for the first three pros and building the cap later. **Evert
chose to do it the way Uber does it from the start**, which is the cap plus set-off. Built and
tested:

- **The balance accrues against the pro's account.** Every completed cash job adds FreshAF's
  margin to what that pro owes (`server/balance.js`).
- **At the cap, they come off the platform.** Default **R300**, admin-tunable via the
  `cash_owed_cap_cents` setting. Over it they cannot go online, cannot quote, and are filtered out
  of `eligiblePros` so an already-online pro simply stops being offered work.
- **They are told exactly why**, in their earnings screen, with the amount and the limit — not a
  silent dead end.
- **The admin sees it and clears it.** Each pro's row shows what they are holding and a
  **Settle cash** button; the modal warns to confirm only once the money is actually in the
  FreshAF account. Settling restores them immediately.

Verified end to end: clean pro offered work → four cash jobs (R252, under) still offered → fifth
job (R315, over) blocked and removed from dispatch → settled → offered work again.

**Still to wire, once card is live:** automatic set-off against card payouts, so the balance
clears itself instead of needing the admin. `balance.settle()` is the hook — the payout run calls
it and deducts the returned amount. There is no payout run yet because there is no card revenue.

⚠️ The risk this closes: without a cap, a pro could take R63 of your money on twenty cash jobs,
disappear owing R1,260, and you would have no realistic way to recover it. **R300 is now the most
any single pro can walk away with.** Raise it as you learn who is reliable.

---

## What 20% means after VAT

You are not VAT registered and nowhere near the R1m threshold, so today the margin is the full
R63 on that job.

Once you register, VAT applies to the **whole R376**, and the pro will almost certainly not be
VAT registered, so there is no input VAT to claim:

| | |
|---|---|
| Customer pays FreshAF | R376.00 |
| Output VAT (15/115) | −R49.04 |
| Paid to the pro | −R313.00 |
| **FreshAF keeps** | **R13.96** |

So 20% comfortably survives VAT registration, but the real margin drops from R63 to about R14 per
job. It is positive, which 10% was not. Plan on revisiting the number, or on preferring
VAT-registered pros, before you cross R1m in bookings.
