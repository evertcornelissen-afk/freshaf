# Onboarding a FreshAF Pro, start to finish

*Written 14 October 2026. Section 8 rewritten 5 November 2026 for merchant-of-record pricing.*

## Where the documents live

`python marketing/make-questionnaire.py` builds both versions into **`freshaf/forms/`**, which is
the only place they live — there is deliberately no Desktop copy, so an out-of-date form cannot be
attached to an email by accident after the terms change.

| File | Use |
|---|---|
| `FreshAF Pro Vetting Questionnaire (fillable).pdf` | **Send this one.** 48 typed fields and 82 tick boxes; the Pro completes it on a phone or laptop and emails it back without printing anything. The six "For FreshAF use only" fields are locked. |
| `FreshAF Pro Vetting Questionnaire.pdf` | The flat version, for printing and completing by hand. |
| `FreshAF Pro Brochure - Car Wash.pdf` / `- Laundry.pdf` | Sent first, before the questionnaire. Built by `marketing/make-brochures.py`. |

Field names in the fillable PDF are taken from the printed labels (`p1_Full_name_as_on_ID`,
`p1_Mobile_number`, …), so a returned form can be read straight into the bulk loader rather than
retyped.

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
