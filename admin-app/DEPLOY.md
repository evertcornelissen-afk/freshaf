# Publishing the admin dashboard

Decided 17 Nov 2026: the dashboard becomes an installable app at **admin.freshaf.io**, so
Evert and Nikki can review applications from their iPhones instead of one laptop.

## Read this first

Publishing changes what protects this, and it is worth being exact about how.

The process holds `ADMIN_API_KEY`. On a laptop bound to `127.0.0.1` the protection was
that nothing else could reach it, so the key was a genuine second factor: a stolen admin
password alone could not reach a dashboard that held the key.

Published, that cannot be true any more. What it does instead is narrower and still
sound: **the key is attached only to `/api/admin/*` calls, and only after asking
freshaf.io whether the caller is already a signed-in admin.** A stranger who finds the
address gets the sign-in page and `403` on everything else. The key never helps anyone who
does not already hold an admin password.

So there is **one password per person** and nothing shared. What now stands between a
guessed password and the data is the live site's rate limiting on admin sign-ins, by IP
and by address.

An earlier version put a shared Basic-auth password in front of the whole site as well.
It worked, but two passwords sent by two routes was confusing enough to get wrong, and a
control people get wrong is not a control.

## The service

A second Render web service, separate from `freshaf`. No disk, no database — it holds no
state of its own.

| Setting | Value |
|---|---|
| Name | `freshaf-admin` |
| Root directory | `admin-app` |
| Build command | `npm install --omit=dev` |
| Start command | `node server.js` |
| Plan | Starter (the free plan sleeps, and a dashboard that takes 50 seconds to wake is a dashboard nobody opens) |
| Health check path | `/healthz` |

### Environment variables

| Key | Value |
|---|---|
| `ADMIN_BIND` | `0.0.0.0` — required, or Render cannot route to it |
| `ADMIN_PORT` | `10000` (Render's default port) |
| `FRESHAF_URL` | `https://freshaf.io` |
| `ADMIN_API_KEY` | **exactly** the same value as on the `freshaf` service |

If `ADMIN_API_KEY` does not match the `freshaf` service exactly, every admin call returns
`404` and the dashboard looks empty rather than broken — check this first if that happens.

## The domain

Add a custom domain `admin.freshaf.io` on the service, then at GoDaddy add the CNAME
Render gives you. TLS is issued automatically once DNS resolves.

Until the domain is live, the `*.onrender.com` address Render assigns works fine.

## Giving someone access

In **Team access**: their name, their own email, and a password you choose for them. Tell
them the three things — the address, their email, that password. That is all.

Leave the password box blank instead and one is generated, shown once, and they are made
to replace it on first sign-in. Either is fine; choosing it yourself is simpler to explain.

## Installing it as an app

Once it is on HTTPS:

- **iPhone:** open it in Safari, Share, **Add to Home Screen**. It opens full screen with
  the FreshAF icon.
- **Windows:** open it in Chrome or Edge, then the install icon in the address bar.

The service worker caches **nothing** on purpose. It exists only because Chrome will not
offer "Install" without one. An admin tool that serves a stale copy of itself is how
someone ends up approving an application against yesterday's information.

## What is still not done

- No audit page yet. Actions are recorded (`supplier_messages` carries who sent what), but
  there is no screen that shows the log.
- Removing someone in **Team access** signs them out everywhere and blocks them signing
  in again. There is no shared secret left to rotate.
