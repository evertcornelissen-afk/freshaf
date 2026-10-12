# PayFast application — answer sheet for FreshAF (Pty) Ltd

*Prepared 12 October 2026. Every value below is taken from your own CIPC and FNB documents and
cross-checked against the live site. Keep this open while you fill the form.*

Register at **payfast.io** → Sign up → choose **Company / registered business** (not sole trader).

---

## Business details

| Field | Answer |
|---|---|
| Account type | **Company** (private company) |
| Registered business name | **FRESHAF (PTY) LTD** |
| Trading name | FreshAF |
| Company registration number | **2026/683087/07** |
| Date of incorporation | 26 August 2026 |
| Country | South Africa |
| Financial year end | February |
| VAT number | *None — the company is not VAT registered* |
| Business type / industry | Online marketplace for mobile car washing and laundry services |
| Nature of goods or services | Booking platform connecting customers with independent, vetted service professionals who wash cars and collect, clean and deliver laundry |

## Address

| Field | Answer |
|---|---|
| Registered / physical address | 35 Sterappel Crescent, Essenhout Estate, Langeberg Heights |
| City | Cape Town |
| Province | Western Cape |
| Postal code | **7570** |
| Country | South Africa |

## Directors

| | |
|---|---|
| Director 1 | **MERTENS, NIKKI** — appointed 26/08/2026, ACTIVE |
| Director 2 | **CORNELISSEN, EVERT** — appointed 26/08/2026, ACTIVE |

Both ID numbers are on page 4 of `CoR15_1_A_9465133278.pdf`. Copy them from there rather than
from memory — a single wrong digit against CIPC records is a rejection.

## Contact

| Field | Answer |
|---|---|
| Contact person | Evert Cornelissen |
| Mobile | 078 299 1050 |
| Email | **⚠️ see the warning below** |

## Bank account (where PayFast pays you)

| Field | Answer |
|---|---|
| Bank | First National Bank (FNB) |
| Account type | Gold Business Account |
| Account holder | **FRESHAF (PTY) LTD** |
| Account number | On page 2 of `banking freshaf.pdf` |
| Branch | Durbanville |
| Branch code | **210203** |
| SWIFT | FIRNZAJJ |

The FNB letter names the company and quotes registration number 2026/683087/07 **exactly** as
CIPC has it. That match is the usual stumbling block, and yours is clean.

## Website

| Field | Answer |
|---|---|
| Website URL | **https://freshaf.io** |
| Terms & Conditions | https://freshaf.io/terms |
| Privacy policy | https://freshaf.io/privacy |
| Contact & company details | https://freshaf.io/contact |
| Refund / cancellation policy | https://freshaf.io/terms (section 6) |

On the previous application PayFast asked for *"a copy of your terms"* before verifying. Have
that link ready and you save a round trip.

---

## ⚠️ Three things that will stall this

### 1. You have 2 of the 5 required documents

Folder `Desktop\FreshAF\` currently holds:

| # | Document | Status |
|---|---|---|
| 1 | CIPC registration (CoR 15.1A / CoR 14.3) | ✅ `CoR15_1_A_9465133278.pdf` |
| 2 | Bank confirmation in the company name | ✅ `banking freshaf.pdf` |
| 3 | Proof of business physical address, **under 3 months old** | ❌ **missing** |
| 4 | ID copies for **both** directors, **both sides** | ❌ **missing** |
| 5 | Beneficial ownership information | ❌ **unknown** |

You can start the signup without these, but verification will not complete. Gathering them
first is the difference between a few days and a few weeks.

- **Item 3:** a utility bill, municipal rates invoice or bank statement for 35 Sterappel
  Crescent, dated within the last 3 months, in a name tied to the company or a director.
- **Item 4:** green barcoded ID or smart ID card for **Nikki and Evert**, scanned both sides,
  fully legible. Cropped or blurry scans are one of the most common rejection reasons.
- **Item 5:** Beneficial Ownership was due at CIPC within 10 business days of registration
  (around 9 September). Check CIPC eServices and file it if outstanding.

### 2. The FNB account may still be dormant

The confirmation letter states, in FNB's words, that the account *"has not yet been activated
with a deposit."* PayFast pays into this account. **Confirm you have deposited something.**
If not, do it before applying — a dormant payout account is an avoidable hold.

Also: that letter's verification reference is valid **3 months from 8 October**, so it expires
around **8 January 2027**. Use it well before then.

### 3. The contact email

The application should be registered against a **FreshAF** address, not `evert@mvps.co.za`.
`admin@freshaf.io` does not exist yet — `freshaf.io` has no mail hosting at all.

Two options:

- **Create `admin@freshaf.io` first** (cleanest — PayFast correspondence lands where Nikki can
  see it too, and it matches the domain on the application)
- **Apply with `evert@mvps.co.za` now and change it later.** Workable, but it is the same entity
  confusion that put another business's keys on this site, and PayFast may query why the contact domain
  does not match the trading domain.

Your call. If you want the mailbox first, I still need one answer: **existing Google Workspace
(free) or a new one for FreshAF (~R125/month)?**

---

## Still outstanding and unrelated to PayFast

- **PayFast keys that are not FreshAF's are still live on freshaf.io.** `payments_live` is `true`,
  yet FreshAF has no merchant account.
  I cannot clear them — Render has signed me out and signing in needs your password.
  Until then, freshaf.io would route card payments through the other account's merchant account, which
  risks that account being suspended for processing for an unrelated site.
- **No persistent disk on Render.** Customers and suppliers are still wiped on every restart.

---

## What I can and cannot do here

I **cannot create the PayFast account** — signing up for a service and entering credentials is
yours to do. Everything around it I can: this sheet, the website requirements, swapping the
merchant keys into Render once you are verified, and running the first real transaction with
you.
