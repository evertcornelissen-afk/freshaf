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
| 4 | Pro signs up at **freshaf.io/supplier**: details, services, vehicles, equipment, banking, then uploads **ID, bank confirmation letter, police clearance** (and optionally proof of address, a setup photo, company registration) in the app | Pro | Pro gets an **"application received"** email with next steps. **admin@freshaf.io gets a "new pro application" email.** |
| 5 | Review in the **admin dashboard** (run `admin-app/start-admin.bat`). Each application shows a tick list of what is in and what is outstanding. Approve, **Request info** for anything still missing, or reject with a reason. | Evert | Approve/reject: pro gets an **email + push + in-app update**. **Request info** keeps them pending and sends the same tick list by email, push and in their app. |
| 6 | Pro switches on: **Add to Home Screen**, allow notifications, verify their WhatsApp number, set prices (or quote per job), set their travel radius, **go online** | Pro | Pro can now receive offers |
| 7 | First job: phone the customer afterwards; check the rating | Evert | Ratings collect automatically |

**Decision rule:** do not approve without the ID, the bank letter in the same name, a police
clearance for every person who will do jobs, and one reference you reached on the phone.

The dashboard enforces the first three for you: an application with any of them outstanding is
marked **"Cannot approve — N required items outstanding"**. The reference call is yours to judge,
so it is never ticked automatically — clear it by hand once you have made the call.

**If something is missing, do not reject.** Use **Request info**: tick what you need, add a note
("the ID photo is too blurry to read"), and the pro gets an email, a push notification and a tick
list in their own app, worded identically. They stay pending and keep their login. The moment the
last requested document is uploaded the request closes itself and admin@freshaf.io is emailed that
the application is ready for a decision again. Reject is for a pro you do not want, not for
paperwork you are still waiting on.

## Automatic background checks

Every application is checked the moment it arrives — nobody has to remember to do it.
The results sit on the application in the dashboard, with a **Re-run** button.

| Check | What it does | What it proves |
|---|---|---|
| **SA ID number** | Arithmetic: the 13th digit is a checksum over the first twelve. Also reads date of birth and citizenship, and flags under-18. | The number is **well formed**. It does **not** prove it belongs to the applicant — that needs paid Home Affairs verification. |
| **Company registration number** | Format `YYYY/NNNNNN/NN` and a possible year. | The format only. It deliberately does **not** say what the two-digit suffix means: the published tables contradict each other and CIPC's own notice could not be reached to settle it. |
| **Google Business listing** | Looks the business up by name and area: star rating, number of reviews, address, and whether Google shows it as closed. | A real trading presence. **No listing is not proof of anything** — plenty of honest one-person operations have none. Needs `GOOGLE_MAPS_API_KEY`. |

**CIPC is not automatic.** There is no free official CIPC API. The dashboard gives you a
one-click link to the register and three buttons to record what you found — **Verified**,
**Not found**, **Sole trader** — so the answer is stored against the application instead of
living in your head. "Not found" is a hard flag and shows on every review from then on.

A verdict of **problem** means something failed outright (a bad ID checksum, a company not on
the register). **Look closer** means a soft flag (a low rating, no reviews, an unusual age).
**Nothing flagged** is not a clearance — it means the free automatic checks found nothing.

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
