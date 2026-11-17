# Publishing the admin dashboard

Decided 17 Nov 2026: the dashboard becomes an installable app at **admin.freshaf.io**, so
Evert and Nikki can review applications from their iPhones instead of one laptop.

## Read this first

Publishing this changes what protects it, and the change is not small.

On a laptop bound to `127.0.0.1`, the protection is that **nothing else can reach the
process**. It holds `ADMIN_API_KEY` and attaches it to every admin call, which is exactly
why it was safe only while unreachable.

Published, that reasoning inverts: anyone who finds the address would get the key attached
to their requests for free. "Admin password **and** key" collapses into "admin password" —
the second factor disappears at the moment it starts to matter.

So a publicly bound instance carries its own **front door**: one shared password, asked by
the browser before anything else loads, separate from each person's FreshAF login. Two
secrets again, and they do not travel together.

`server.js` **refuses to start** if `ADMIN_BIND` is not localhost and
`ADMIN_GATE_PASSWORD` is unset. A dashboard holding ID numbers and bank details must not
be one missing environment variable away from open.

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
| Health check path | `/healthz` (the one path in front of the gate; Render cannot send the front-door password) |

### Environment variables

| Key | Value |
|---|---|
| `ADMIN_BIND` | `0.0.0.0` — required, or Render cannot route to it |
| `ADMIN_PORT` | `10000` (Render's default port) |
| `FRESHAF_URL` | `https://freshaf.io` |
| `ADMIN_API_KEY` | **exactly** the same value as on the `freshaf` service |
| `ADMIN_GATE_USER` | `freshaf` (or anything; it is the Basic-auth username) |
| `ADMIN_GATE_PASSWORD` | a long random passphrase — this is the front door |

Generate the gate password:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

If `ADMIN_API_KEY` does not match the `freshaf` service exactly, every admin call returns
`404` and the dashboard looks empty rather than broken — check this first if that happens.

## The domain

Add a custom domain `admin.freshaf.io` on the service, then at GoDaddy add the CNAME
Render gives you. TLS is issued automatically once DNS resolves.

Until the domain is live, the `*.onrender.com` address Render assigns works fine.

## Sending it to someone

They need two things, **sent by two different routes**:

1. The front-door password (one shared passphrase — their browser will ask for it, and
   their password manager can remember it).
2. Their own FreshAF admin email and temporary password, from **Team access**.

Putting both in one WhatsApp message undoes the whole point of having two.

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
- The front door is one shared password rather than per-person. Removing one person from
  **Team access** stops their login but does not rotate the gate — change
  `ADMIN_GATE_PASSWORD` as well if someone leaves.
