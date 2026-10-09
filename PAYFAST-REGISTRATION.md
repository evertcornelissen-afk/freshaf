# PayFast — registering a new merchant account for FreshAF (Pty) Ltd

*Updated 9 October 2026, after confirming the existing verified account belongs to a different
business.*

---

## ⚠️ Live right now: freshaf.io is charging cards through DENCITY's merchant account

`freshaf.io` is running with `payments_live: true` because `PAYFAST_MERCHANT_ID` and
`PAYFAST_MERCHANT_KEY` are set on Render — and **those keys belong to Dencity**, an unrelated
app with its own verified PayFast merchant account (18767813).

```js
const LIVE = Boolean(MERCHANT_ID && MERCHANT_KEY);   // server/payments.js
```

Two problems, and the second is worse than the first:

1. **The money lands in Dencity's account.** FreshAF has no record of the receipt, and the
   funds sit under a different entity.
2. **It puts Dencity's verified account at risk.** A PayFast merchant account is verified
   against a specific business and a specific website. Processing transactions for an unrelated
   site is exactly the kind of thing that gets a merchant account suspended or frozen pending
   review. Dencity's payments work today — this could break them.

There are zero FreshAF customers, so no transaction has actually run. But this must not survive
into supplier loading or any marketing push, and the risk is not only FreshAF's.

**Recommended until the new account is verified:** clear the three PayFast variables on Render.
The app then falls back to its built-in sandbox and **cash orders keep working perfectly** —
which is the only payment method you can honour at launch anyway. Say the word and I will do it.

| Variable | Action |
|---|---|
| `PAYFAST_MERCHANT_ID` | clear, then set to the new FreshAF ID once verified |
| `PAYFAST_MERCHANT_KEY` | clear, then set to the new FreshAF key |
| `PAYFAST_PASSPHRASE` | clear, then set to the new FreshAF passphrase |

Nothing in the code changes — swapping these three values is the whole switchover.

---

## Do this in order

The order matters: register the PayFast account **against a FreshAF email address**, not
`evert@mvps.co.za`, or you will be unpicking the same entity confusion a second time.

1. **Create `admin@freshaf.io`** — PayFast correspondence, verification and payout notices
   should land in a FreshAF mailbox that Nikki can also see.
2. **Activate the FNB account** with any deposit. The confirmation letter says it has never been
   activated, and it is the account PayFast will pay into.
3. **File Beneficial Ownership at CIPC** if outstanding (due ~9 September). PayFast's company
   route asks for it.
4. **Register the new PayFast account** at payfast.io as FreshAF (Pty) Ltd.
5. **Upload the FICA documents** below.
6. **Swap the three Render variables** once verified — I do this.
7. **Run one real R10 transaction** end to end before telling any customer card payments work.

---

## Company details for the application

Taken from your CIPC documents. These must match **exactly** — mismatches are the main cause of
PayFast rejections.

| Field | Value |
|---|---|
| Registered name | **FRESHAF (PTY) LTD** |
| Registration number | **2026/683087/07** |
| Date of incorporation | 26 August 2026 |
| Entity type | Private company |
| Directors | MERTENS, NIKKI · CORNELISSEN, EVERT |
| Registered office | 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights, Cape Town, Western Cape, 7570 |
| Financial year end | February |
| Bank | FNB Gold Business Account, Durbanville, branch **210203**, SWIFT FIRNZAJJ |
| Account holder | FRESHAF (PTY) LTD, 2026/683087/07 |
| Trading website | https://freshaf.io |

The FNB letter names the company and quotes the registration number exactly as CIPC has it.
That part is already clean.

---

## Documents to upload — company route

| # | Document | Status |
|---|---|---|
| 1 | CIPC registration documents (CoR 14.3 / CoR 15.1A) | ✅ `CoR15_1_A_9465133278.pdf` |
| 2 | Bank confirmation in the company name | ✅ `banking freshaf.pdf` — **activate the account first** |
| 3 | Proof of business physical address, **under 3 months old** | ⬜ needed |
| 4 | ID documents for **both** directors, **both sides**, high quality | ⬜ needed |
| 5 | Beneficial ownership information | ⬜ see step 3 above |

**On item 3:** the registered office is residential, so this means a utility bill, municipal
rates invoice or bank statement for 35 Sterappel Crescent, in a name that ties to the company or
a director.

**On item 4:** green barcoded ID or smart ID card. A cropped or blurry scan is one of the most
common rejection reasons.

### They may also ask for your terms

On the previous application PayFast asked for *"a copy of your terms"* before verifying. Yours
are live at **https://freshaf.io/terms** and now cover pro-set pricing, quoting, scheduling and
a dedicated section for pros. Send the link or a PDF when asked — having it ready saves a
round trip.

---

## Where to send everything

- PayFast Dashboard: **Account → Verification Documents**, or email PayFast support
- Phone: **021 300 4455**
- Expect an onboarding compliance specialist to reply by email, as happened last time

## What causes rejections

- Proof of address **older than three months**
- Details that do not match ID or CIPC records
- Blurry or one-sided ID scans
- Incomplete uploads

---

## The website side is already done

South African law (ECT Act section 43) requires an online supplier to publish its full name and
legal status, physical address and telephone number. That was missing; it is now live at
**https://freshaf.io/contact**, carrying the company name, registration number, directors,
registered office, phone, pricing in rand, delivery, refunds, complaints and governing law, and
linked from the footer.

| Requirement | Status |
|---|---|
| HTTPS on a live domain | ✅ |
| Terms & Conditions | ✅ /terms |
| Privacy policy (POPIA) | ✅ /privacy |
| Cancellation / refund terms | ✅ |
| Prices in ZAR, all fees disclosed before payment | ✅ |
| Legal name, registration number, physical address, phone | ✅ /contact |
| Support email on a domain you control | ⚠️ now `admin@freshaf.io` — **create the mailbox** |

**Note:** every support address in the app previously pointed at `support@freshaf.co.za`, which
belongs to an unrelated company ("Fresh AF – Culture relevance specialist agency"). All 13
references now point at `admin@freshaf.io`, which **bounces until the mailbox exists** — another
reason step 1 comes first.
