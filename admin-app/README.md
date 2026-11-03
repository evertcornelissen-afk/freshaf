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

## Moving it to a server later

This is an ordinary Node app and keeps no local state — it is a proxy with a key. To
host it: deploy this folder, set `FRESHAF_URL` and `ADMIN_API_KEY`, and set
`ADMIN_BIND=0.0.0.0`.

**Do not do that without putting your own authentication in front of it first.** Bound
to a public address it becomes exactly the thing you moved it off the website to avoid —
with the key helpfully attached to every request.
