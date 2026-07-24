# freshaf.io — GoDaddy DNS setup

Point freshaf.io at the FreshAF app on Render. Set these two records in GoDaddy
(**Domain → freshaf.io → DNS → Manage DNS**):

## 1. Apex domain (freshaf.io)
GoDaddy already has a default `A` record on `@` pointing at a parking IP — **EDIT it**,
don't add a second one.
| Field | Value |
|---|---|
| Type | A |
| Name / Host | @ |
| Value | `216.24.57.1` |
| TTL | 600 (or 1 hour) |

## 2. www (www.freshaf.io)
GoDaddy has a default `www` CNAME pointing to `@` — **EDIT it** to:
| Field | Value |
|---|---|
| Type | CNAME |
| Name / Host | www |
| Value | `freshaf.onrender.com` |
| TTL | 600 (or 1 hour) |

Delete any GoDaddy "parked"/"forwarding" entry if it blocks these.

## After saving
- DNS propagates in ~10–60 min (can be up to a few hours).
- Render then auto-verifies and issues a free SSL certificate (Let's Encrypt).
- Both `https://freshaf.io` and `https://www.freshaf.io` will serve the app with a padlock.

Nothing else to change — the app's `BASE_URL` is already `https://freshaf.io`.
