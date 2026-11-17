# FreshAF Admin

The dashboard no longer lives on freshaf.io. It runs here, on your own machine.

## Why it moved

A dashboard served from the public site is a page anyone can find and attack. But be
clear about what moving it does and does not achieve:

- **Does:** the page is gone from the public site, and `ADMIN_API_KEY` means a stolen
  admin password alone opens nothing — an attacker needs the key as well, and the key
  exists only on this computer.
- **Does not:** remove the admin API from the live site. It has to stay, or this could
  not reach it. **The key is the protection, not the hiding.**

Without the key, `/api/admin/*` returns `404`, not `403` — it does not confirm that
anything is there.

## Running it

Double-click **`start-admin.bat`**. It installs what it needs on first run, opens
<http://localhost:5858> and signs you in with your normal admin email and password.

It listens on `127.0.0.1` only, so nothing else on your network — or the internet — can
reach it, even on shared Wi-Fi.

## Setup, once

1. `copy .env.example .env`
2. Generate a key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
3. Put the same value in **both** places:
   - `admin-app/.env` as `ADMIN_API_KEY`
   - Render → freshaf → Environment as `ADMIN_API_KEY`
4. Set `FRESHAF_URL=https://freshaf.io` (use `http://localhost:5757` to work against your
   own machine instead).

If the two keys do not match exactly, every admin call returns 404 and the dashboard
looks empty. That is the expected failure, not a bug.

## Giving someone else access

Each person gets their **own login**. Never share one: every approval, rejection and
message is recorded under the name that sent it, and that record is worthless if two
people use the same account. You can also remove one person without changing your own
password.

In the dashboard, open **Team access**, enter their name and their own email address, and
press **Give access**. A temporary password is shown **once** — copy it straight away and
send it to them. They are forced to replace it the first time they sign in, and the
temporary one stops working the moment they do. Lost it? Press **New password** to issue
another; the old one dies immediately.

**Remove** signs them out everywhere at once, even if their browser still holds a valid
session, and blocks them signing in again. Their name stays on the decisions and messages
they already sent, so the history still reads properly. You cannot remove yourself, and
you cannot remove the last admin.

### Getting the dashboard onto their machine

Until it is hosted (see below), it runs on each person's own computer:

1. They install **Node.js** (LTS) from <https://nodejs.org>.
2. Copy the whole `admin-app` folder to their machine.
3. In that folder, `copy .env.example .env`, then set `FRESHAF_URL=https://freshaf.io`
   and paste the **same `ADMIN_API_KEY`** that is on Render.
4. Double-click `start-admin.bat`.

Send them the `ADMIN_API_KEY` by a different route than their password — the whole point
of the key is that a stolen password alone is not enough, which stops being true if both
travel in the same WhatsApp message.

This route is a laptop only. For phones, the dashboard has to be hosted.

## Moving it to a server later

This is an ordinary Node app and keeps no local state — it is a proxy with a key. To
host it: deploy this folder, set `FRESHAF_URL` and `ADMIN_API_KEY`, and set
`ADMIN_BIND=0.0.0.0`.

**Do not do that without putting your own authentication in front of it first.** Bound
to a public address it becomes exactly the thing you moved it off the website to avoid —
with the key helpfully attached to every request.
