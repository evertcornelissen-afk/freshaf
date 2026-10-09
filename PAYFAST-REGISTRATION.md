# PayFast — ALREADY VERIFIED (correction) + the real outstanding item

> ## ⚠️ Correction, 9 October 2026
>
> **The PayFast merchant account is already verified.** I wrote the pack below from the stale
> note in HANDOVER.md that said verification was pending. Evert's inbox proves otherwise.
>
> Email from **Ebrahim Salie, Onboarding Compliance Specialist, Payfast (Network Group)**,
> Monday 27 July 2026 13:30, subject `Re:[## 1766062 ##] 18767813 - Account verification`:
>
> > *"I am pleased to inform you that your account has been successfully verified and you will
> > receive an automated response to confirm this as well. You are now able to transact through
> > Payfast and payout to your nominated South African bank account."*
>
> Confirmed by a second mail the same day from `noreply@payfast.io`:
> *"Your Payfast account has been verified."*
>
> So **no FICA documents need submitting.** Skip the document list below unless the account has
> to be re-registered under the company.

---

## The real outstanding item: which entity and which bank account?

The dates do not line up, and this matters.

| Event | Date |
|---|---|
| Payfast account verified | **27 July 2026** |
| FreshAF (Pty) Ltd incorporated | **26 August 2026** |
| FNB business account opened | **8 October 2026** |

Payfast was verified **a month before the company existed** and **ten weeks before the FreshAF
bank account was opened**. So the "nominated South African bank account" Payfast pays into
**cannot be the FreshAF FNB account** — it is whatever account was nominated in July, most
likely Evert's personal account or MVP Sales (Pty) Ltd's.

**Consequence if left alone:** every rand a FreshAF customer pays lands in a different entity's
bank account. That is a tax and accounting problem, it undermines the separation the Pty Ltd was
registered to create, and it will be ugly to unwind after real trading starts.

### What to check in the Payfast dashboard

1. **Registered entity** on the merchant account — Evert personally, MVP Sales, or FreshAF (Pty) Ltd?
2. **Nominated payout bank account** — is it the FNB Gold Business account (branch 210203) in
   the name of FRESHAF (PTY) LTD?
3. If either is wrong, change it. Changing the registered entity to a newly registered company
   will almost certainly trigger **re-verification** — and that is when the document list below
   becomes relevant again.

### Still true regardless

- The FNB account **has not been activated with a deposit** (FNB's own words on the letter).
  Payfast cannot pay into a dormant account. Deposit R10.
- **Beneficial Ownership** at CIPC was due around 9 September and may be outstanding.

---

*Checked against your actual documents on 9 October 2026. Merchant account 18767813 already
exists and the app is running in **live mode** (`payments_live: true`), so nothing needs
re-integrating. What is missing is FICA verification.*

Payfast has rebranded under **Network International**; the Payfast name and the sign-up
journey stay the same.

---

## What you have — verified

**The company is registered, and the bank account matches it exactly.** That is the hard part
done, and it means you go the **company route**, not sole trader.

| | |
|---|---|
| Legal name | **FRESHAF (PTY) LTD** |
| Registration number | **2026/683087/07** |
| Incorporated | 26 August 2026 (certificate issued 27 August) |
| Type | Private company, MOI type STANDARD (CoR 15.1A) |
| Status | IN BUSINESS |
| Directors | MERTENS, NIKKI · CORNELISSEN, EVERT (both ACTIVE from 26/08/2026) |
| Registered office | 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights, Cape Town, Western Cape, 7570 |
| Financial year end | February |
| Bank | FNB **Gold Business Account**, Durbanville (branch 210203), opened 08/10/2026 |
| Account holder on the letter | **FRESHAF (PTY) LTD, registration number 2026/683087/07** |

The FNB letter names the company and quotes the registration number **exactly** as CIPC has it.
Mismatched details are the single most common cause of Payfast rejections, and yours match.

---

## ⚠️ Two things to fix before you upload

### 1. The bank account is not activated

The FNB letter says, in its own words:

> *"New Account - The account is currently open but has not yet been activated with a deposit."*

Payfast settles your takings **into this account**. An account that has never been activated is
a payout failure waiting to happen, and a reviewer reading that status line may hold the
verification.

**Fix: deposit anything into it — R10 is enough — then carry on.** Consider pulling a fresh
confirmation letter afterwards so the status line reads clean.

### 2. Beneficial Ownership looks overdue

The CIPC letter in your pack states:

> *"You are also required to submit the company's Beneficial Ownership information within
> 10 business days of registration with the CIPC."*

You registered on **26 August**. That deadline passed around **9 September** — roughly a month
ago. I cannot tell from these documents whether it was filed.

This matters twice over: CIPC can impose administrative penalties for non-compliance, **and
Payfast's company route explicitly asks for beneficial ownership information**. Check CIPC
eServices and file it if it is outstanding.

### Also worth knowing

- **CIPC has `RPELLETDP@GMAIL.COM` as the company's contact email**, not yours. Annual return
  reminders and deregistration warnings go there. If that is not an address you or Nikki watch
  daily, change it — companies get deregistered because nobody saw the notice.
- **The FNB letter expires.** Its verification reference is valid **3 months from 8 October**,
  so until roughly **8 January 2027**. Upload it well before then or pull a fresh one.

---

## Documents to upload — company route

| # | Document | Status |
|---|---|---|
| 1 | CIPC registration documents (CoR 14.3 certificate / CoR 15.1A) | ✅ `CoR15_1_A_9465133278.pdf` |
| 2 | Bank account confirmation in the company name | ✅ `banking freshaf.pdf` — **activate the account first** |
| 3 | Proof of business physical address | ⬜ **You still need this** |
| 4 | ID documents for **every** director | ⬜ Both Nikki's and yours, both sides, high quality |
| 5 | Beneficial ownership information | ⬜ See above |

**On item 3:** the registered office is a residential address, so proof of address means a
utility bill, municipal rates invoice or bank statement for 35 Sterappel Crescent, **less than
3 months old**, in a name that ties to the company or a director.

**On item 4:** green barcoded ID or smart ID card, scanned **both sides**, fully legible. A
cropped or blurry scan is the second most common rejection reason.

---

## Where to send them

- Payfast Dashboard: **Account → Verification Documents**, or email Payfast support
- Phone: **021 300 4455**

## What causes rejections

Payfast's own guidance says nearly all delays are avoidable:

- Proof of address **older than three months**
- Details that **do not match** ID or CIPC records — yours match, keep it that way
- Blurry or one-sided ID scans
- Incomplete uploads

---

## Website disclosures — now done

South African law (ECT Act section 43) requires an online supplier to publish its full name and
legal status, physical address and telephone number. The site previously showed only an email
address. **A `/contact` page is now built** carrying the company name, registration number,
directors, registered office, phone, pricing and refund terms, and it is linked from the footer.

| Requirement | Status |
|---|---|
| HTTPS on a live domain | ✅ freshaf.io |
| Terms & Conditions | ✅ /terms |
| Privacy policy (POPIA) | ✅ /privacy |
| Cancellation / refund terms | ✅ T&C section 6, restated on /contact |
| Prices in ZAR, all fees disclosed before payment | ✅ |
| Full legal name, registration number, legal status | ✅ /contact |
| Physical address | ✅ /contact — **see the note below** |
| Telephone number | ✅ 078 299 1050 — **confirm this is the right public number** |
| VAT number | ⬜ Only if the company is VAT registered |

**One judgement call for you:** the registered office is **Nikki's home address**. It is already
public on the CIPC register and the ECT Act requires a physical address, so publishing it is
lawful and normal. But it is her house on a consumer website. If either of you would rather not,
say so and I will swap it for a business or service address in minutes.

---

## Order of operations

1. **Deposit into the FNB account to activate it** *(you — today)*
2. **Check and file Beneficial Ownership at CIPC** if outstanding *(you)*
3. Gather proof of address and both directors' IDs *(you)*
4. Upload all five items to Payfast *(you)*
5. Wait for verification *(Payfast)*
6. **Run one real R10 transaction end to end** *(me + you)*

**Step 6 is not optional.** The keys are set and the app reports live mode, but no real rand has
ever gone through it. Do not discover a broken payment on a paying customer.
