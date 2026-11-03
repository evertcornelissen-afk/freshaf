# FreshAF secrets — what they are, where they live, what to do when one is lost

*Written 3 November 2026.*

---

## First, the question that prompted this

**The Stitch client secret is not a login, and it is not customer data.**

Three different things get called "credentials" and they are not interchangeable:

| | What it is | Who uses it | What it can do |
|---|---|---|---|
| **Your Stitch account login** | Your email, password and 2FA for express.stitch.money | A human, in a browser | Everything: change the bank account, withdraw money, close the account |
| **The client id + client secret** | A machine password that lets *the FreshAF server* prove it is FreshAF when it calls Stitch's API | Our server, automatically | Create payment links, read payments, register webhooks |
| **Customer data** | Names, addresses, phone numbers, order history | Our database | Nothing by itself — it *is* the thing being protected |

The client secret holds **no customer data whatsoever**. It is closer to a house key than
to a filing cabinet: it opens a door, it does not contain anything.

**If it leaked**, someone could create payment links in FreshAF's name and read FreshAF's
payment records. They could **not** move money to themselves — Stitch settles only into
the bank account verified on the account, which changing requires the human login above.
Bad, not fatal. Rotate it and move on.

**If you lose it**, nothing is destroyed. Click "View Client Secret" and get a new one.
Which leads to the single most important fact on this page:

> ⚠️ **Viewing the Stitch client secret regenerates it.** The previous secret stops
> working the instant you look. If the live site is using the old one, card payments
> break immediately and silently — the symptom is a 400 `invalid_credentials` from the
> token endpoint. So: only look at it when you are ready to paste it everywhere it
> needs to go, and update Render in the same sitting.

---

## Where each secret lives

Three places, with one rule: **the password manager is the master copy. Everywhere else
is a working copy that can be regenerated or re-pasted.**

| Secret | Master copy | Working copies | If lost |
|---|---|---|---|
| Stitch client id | Password manager | `.env`, Render | Visible in the dashboard, not secret |
| Stitch **client secret** | Password manager | `.env`, Render | Re-view it (regenerates), update both copies |
| Stitch **webhook signing secret** | Password manager | Render | **Cannot be re-fetched.** Delete the endpoint and make a new one |
| `JWT_SECRET` | Password manager | `.env`, Render | Generate a new one; everyone gets logged out, nothing else breaks |
| Live admin password | Password manager | nowhere | Reset through the database |
| Google Maps API key | Password manager | Render | Regenerate in Google Cloud |
| SMTP password | Password manager | Render | Reset in the mail provider |
| **`DATA_KEY`** | Password manager | Render, `.env` | **Nothing can recover the data.** See below |

`DATA_KEY` is the one whose loss destroys data rather than access. It encrypts every
supplier's ID number and bank account in the database. Lose it and those fields are
gone — not just from the live database but from every backup, because the backups
contain the same ciphertext. No reset, no support ticket, no recovery. **Put it in
the password manager before it goes anywhere near Render.**

The webhook signing secret is the only *access* credential that is genuinely
**unrecoverable**. Everything else can be reissued. Put it in the password manager the
moment it appears on screen, before you do anything else.

### What NOT to do

- **Do not keep secrets in chat, email or WhatsApp.** They persist in places you do not
  control and cannot un-send.
- **Do not commit `.env`.** It is in `.gitignore`; leave it there. A secret pushed to
  GitHub is compromised even after you delete the commit — bots scrape new commits
  within seconds.
- **Do not put the Maps key in a web page.** It is server-side only in this codebase for
  exactly that reason: a key in a page gets scraped and spent by someone else.
- **Do not treat `.env` as a backup.** If this laptop is stolen or wiped, that file is
  gone. That is what the password manager is for.

---

## The local `.env`

`freshaf/.env` exists now, filled in except for the secrets. It is git-ignored, and it
affects **only this machine** — freshaf.io reads its own copy from Render. Breaking
something locally cannot break production.

To run a card payment end to end locally, exactly one value is missing:
`STITCH_CLIENT_SECRET`.

---

## Rotating a secret safely

The order matters, because for a short window two values are in play.

1. Generate or view the new value.
2. **Password manager first.** If you are interrupted after this step, nothing is lost.
3. Paste into Render and let it redeploy.
4. Paste into local `.env`.
5. Verify: `npm run stitch:check` for Stitch, or watch an order through for the rest.

Rotate immediately if a secret was pasted into chat or a ticket, appeared in a
screenshot or a screen share, was on a lost device, or a contractor who had it has left.

---

## Backups are a secret problem too

A database backup contains **every customer's name, address and phone number**. Under
POPIA that is personal information and FreshAF is the responsible party for it.

Backups are written to `Desktop\FreshAF\backups\` — outside the repository, so a
re-clone cannot take them with it, and nothing git-tracked can ever contain one. Treat a
backup file with the same care as the database itself: do not email it, do not drop it
in a shared folder, and if you put it in cloud storage, put it somewhere only you can
read.

`npm run backup` is the only thing that produces one. See `MIGRATION.md`.

---

## What is encrypted, and what is not

Supplier **ID numbers** and **bank account and branch numbers** are encrypted in the
database with AES-256-GCM, and shown masked (`••••••••0087`) on admin screens. Verified
by searching the raw database file: the plain values are not in it.

Names, emails, phone numbers and addresses are **not** encrypted. That is a deliberate
line, not an oversight. Every one of them is used in a lookup or shown on a dispatch
screen many times a minute, so encrypting them would break the app while buying little —
an attacker holding the database already has the orders those addresses belong to. The
boundary is: encrypt what is dangerous on its own.

Under POPIA FreshAF is the responsible party for all of it. The practical consequences:

- **Backups contain personal information.** `Desktop\FreshAFackups\` is not a neutral
  folder of files. Do not email one, do not put it in a shared drive.
- **Masking is not access control.** An admin can still see full numbers through the API
  if they need to; masking stops them leaking into screenshots and support threads.
- **A breach of ID numbers or bank details is reportable** to the Information Regulator
  and to the people affected. Encryption at rest is what makes that unlikely rather than
  inevitable.
