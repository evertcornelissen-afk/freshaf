# Onboarding a FreshAF Pro, start to finish

*Written 14 October 2026. Section 8 rewritten 5 November 2026 for merchant-of-record pricing.*

## Where the documents live

Everything we send a pro is built into **`C:\Users\Evert\Desktop\FreshAF`** — the working
business folder, not this repo. The scripts that build them live here, so the wording stays
under version control, but only one copy of each document exists on disk and it is the copy
that gets emailed. That is deliberate: a second copy somewhere else is a copy that still says
10% after the terms change.

Change the destination in `marketing/outdir.py`.

| File | Use |
|---|---|
| `FreshAF Pro Vetting Questionnaire.xlsx` | **Send this one.** Dropdowns for every fixed choice, yellow cells for everything else, an example column, and a **Load** sheet that turns a completed form into the exact row the `suppliers` table takes. |
| `FreshAF Pro Vetting Questionnaire (fillable).pdf` | For a pro who would rather not open Excel. 48 typed fields, 82 tick boxes, the six "For FreshAF use only" fields locked. |
| `FreshAF Pro Vetting Questionnaire.pdf` | Flat version, for printing and completing by hand. |
| `FreshAF Pro Brochure - Car Wash.pdf` / `- Laundry.pdf` | Sent first, before the questionnaire. |

Rebuild:

```
python marketing/make-questionnaire.py        # flat PDF + fillable PDF
python marketing/make-questionnaire-xlsx.py   # the Excel form
python marketing/make-brochures.py            # both brochures
```

**Bank account numbers are not asked for on any of these forms.** A pro enters banking details
in the app, where they are encrypted at rest. The forms ask only for the bank and the account
holder's name, which is what we need in order to check it matches the ID. A spreadsheet that
travels by email is not a safe place for an account number.

**Answer cells in the workbook are formatted as Text on purpose.** A 13-digit SA ID number typed
into a General cell becomes `8.80513E+12` and the real number is gone; a phone number loses its
leading zero.

## The steps

| # | Step | Who | What happens in the app |
|---|---|---|---|
| 1 | Contact the business (brochure, cold call, WhatsApp) and send the **vetting questionnaire** | Evert | — |
| 2 | Pro returns the questionnaire + documents to admin@freshaf.io or WhatsApp 078 299 1050 | Pro | — |
| 3 | **Screening call** (10 min): confirm services, area, team size. Call both references. Check the name on the ID matches the bank letter. Check the police clearance is under 6 months old. | Evert | — |
| 4 | Pro signs up at **freshaf.io/supplier**: details, services, vehicles, equipment, banking, then uploads ID, proof of address and bank letter in the app | Pro | Pro gets an **"application received"** email with next steps. **admin@freshaf.io gets a "new pro application" email.** |
| 5 | Review in **freshaf.io/admin → Approvals** (documents and banking are visible there). Approve, or reject with a reason. | Evert | Pro gets an **email + push notification + in-app update** with the decision and the reason. |
| 6 | Pro switches on: **Add to Home Screen**, allow notifications, verify their WhatsApp number, set prices (or quote per job), set their travel radius, **go online** | Pro | Pro can now receive offers |
| 7 | First job: phone the customer afterwards; check the rating | Evert | Ratings collect automatically |

**Decision rule (suggested):** do not approve without the ID, the bank letter in the same name, a police
clearance for every person who will do jobs, and one reference you reached on the phone.

## How a pro is told about a job

A customer request reaches a pro by every channel below at the same time:

| Channel | Status | Notes |
|---|---|---|
| In-app live alert | **Live** | Only while FreshAF Pro is open |
| Web push (lock-screen notification) | **Live** | Android: works in Chrome. **iPhone: only after the pro adds FreshAF Pro to the Home Screen** (iOS 16.4+) and taps Allow |
| WhatsApp | **Built, dry run** | Needs a spare SIM, a Meta Business account and two approved templates (`WHATSAPP-SETUP.md`) |
| Email | Account events only | Too slow for a timed job offer. Used for: application received, approved, rejected/suspended, and alerting admin to a new pro |

## To switch email on (Evert)
Render → freshaf service → Environment → add `SMTP_PASS` = the admin@freshaf.io mailbox password.
Until then emails are only printed to the server log. Admin → Launch readiness shows "Account emails live" once it works.
