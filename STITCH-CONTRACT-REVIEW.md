# Stitch Acquiring Service Terms — what we are signing

*Read 2 November 2026, before signing up. Source: Stitch's Acquiring Service Terms and the
Stitch Express Terms & Conditions, linked from the signup form.*

> ⚠️ Not legal advice. Nikki should read clauses 7.7, 13, 20.2 and 21.3.6 herself.

---

## The headline: the restructure was not optional, it was required

Two clauses in the acquiring agreement would have failed FreshAF under the **old** facilitator
model, independently of anything PayFast said:

- **Cl. 7.7.4** bars submitting a transaction *"which was not undertaken directly between you and
  the Cardholder."* Under the old T&C the customer contracted with the Pro, so the transaction
  was **not** directly between FreshAF and the cardholder.
- **Cl. 20.2** requires the merchant to warrant that *"you have supplied … the goods or services."*
  Under the old model FreshAF supplied booking technology, not the wash.
- **Cl. 7.7.5** prohibits submitting transactions *"on behalf of a third party without the prior
  written consent"* of the acquirer.

As merchant of record, FreshAF satisfies all three: we contract with the customer, we supply the
service, and we submit our own transactions. **Signing this agreement under the old structure
would have been a misrepresentation.** It is accurate under the new one.

Note the counterparty: card acquiring is underwritten by **Efficacy**, and the Express terms also
reference **Capitec**. Stitch is the platform, not necessarily the acquirer of record.

---

## Three things to act on

### 1. ⚠️ The Supplier Agreement must be signed BEFORE card payments, not just before approving pros

**Clause 13** applies *"only to the extent that the Merchant operates as a"* marketplace — and
that is the acquirer's call, not ours. If Efficacy classes FreshAF as one:

- **Cl. 13.2:** the marketplace *"must enter into a written agreement with each Retailer before
  depositing"* transactions.
- **Cl. 13.6(a):** the marketplace *"is fully responsible and financially liable for each
  Transaction processed on behalf of a Retailer."*

`SUPPLIER-AGREEMENT-DRAFT.md` **is** that written agreement, and it is still unsigned. Previously
the deadline was "before the first pro is approved". **It is now also "before the first card
payment."** Full financial liability we already accept as merchant of record, so 13.6 costs us
nothing new.

### 2. ⚠️ The business description on the application is contractually binding

**Cl. 2.1.7** scopes the agreement to the Business *"as described in the Application"*, and
**cl. 7.7.3** bars transactions for *"goods or services which fall outside the description of your
Business"* without prior written approval.

So the description is not marketing copy. It must cover **both** car wash **and** laundry, and say
plainly that the work is subcontracted — if it only mentions car washing, every laundry order is
technically outside the agreement. The wording to use is in `STITCH-SETUP.md`.

**Cl. 21.3.6** allows immediate suspension or termination on *"any significant change … in your
business activities"*, and **cl. 16.10** requires us to report changes immediately. Practical
consequence: **do not quietly change the money flow back later.** If FreshAF ever reverts to
facilitating, that is a notifiable change and a termination event.

### 3. ⚠️ Settlement timing is not guaranteed — ask before going live

This is the risk I had not priced in, and it is a working-capital one.

- **Cl. 10.1** says Efficacy pays sums due into the nominated bank account, but **states no payout
  period.**
- **Cl. 10.2:** suspended payments *"may be retained by Efficacy until it has satisfied itself"*
  that transactions are legitimate.
- **Cl. 8.2:** Efficacy *"may hold the funds in a reserve account until a new limit is agreed"* —
  relevant if volume jumps.
- **Cl. 3.2** allows proceeds to be held until onboarding completes.
- No rolling reserve percentage or duration is specified anywhere.

**Why this bites FreshAF specifically:** we pay pros their full price out of our own account,
while our margin is only 20%. If settlement is held for a week, or a reserve is imposed on a new
merchant, FreshAF funds the pros' money in the meantime. **Get the settlement period and any new-
merchant reserve in writing before `PAYMENTS_LIVE=true`.**

---

## Confirms what we already decided

- **Chargebacks.** Cl. 11.2 lets Efficacy recover disputed amounts immediately and without notice;
  cl. 21.4 keeps us liable for chargebacks **after termination**; cl. 14.2 makes fees payable
  regardless of any later chargeback or refund. The payout delay in
  `SUPPLIER-AGREEMENT-DRAFT.md` clause 4.6 is necessary, not cautious.
- **Cl. 12.4:** debits are not presented to our account until **at least 14 days** after the
  transaction date.
- **Capitec Pay**, if enabled, states *"No payments to third-party accounts will be permitted"* —
  consistent with us paying pros from our own account rather than routing customer funds.
- **Cl. 7.8 / 9.4:** appointing any payment intermediary needs prior written approval. We have no
  reason to.
- Neither document publishes a prohibited-business list; mobile car wash and laundry are
  unremarkable low-risk retail services.

---

## Verified on the live site, 2 November 2026

What an underwriter reads, and what it says:

| Page | Says |
|---|---|
| `freshaf.io/terms` | "FreshAF supplies the service to you" · "your contract is with FreshAF" |
| `freshaf.io/contact` | "FreshAF is the supplier of the service and the merchant of record" · reg no. 2026/683087/07 |
| `freshaf.io/api/pricing` | `payments_live: false` — card is off, nothing can be charged yet |

The site, the T&C and the application description now tell one consistent story. That consistency
is the thing PayFast did not see.
