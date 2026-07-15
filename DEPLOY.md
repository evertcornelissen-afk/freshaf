# FreshAF — Go-live runbook

The app is a single Node service (Express + built-in SQLite + SSE). It needs a host that runs
a **persistent Node process with a persistent disk**. Recommended: **Render.com** (simplest),
alternatives below.

## Deploy on Render (~10 minutes, ~$7/month)

1. Create an account at https://render.com (sign in with GitHub).
2. **New → Blueprint** → connect the `freshaf` GitHub repository.
   Render reads [render.yaml](render.yaml) automatically: web service + 1 GB persistent disk
   mounted at `data/` (the SQLite database survives restarts and deploys).
3. When prompted for environment variables, set:
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — **choose a strong password now**; the admin account is
     seeded on first boot only.
   - `BASE_URL` — the URL Render assigns (e.g. `https://freshaf.onrender.com`), update again if
     you attach a custom domain.
   - Leave the PayFast keys empty until you have a merchant account (card payments run in
     sandbox mode until then; cash orders are fully live).
4. Deploy. Health check: `GET /api/pricing` must return 200.
5. Custom domain (optional): Render → Settings → Custom Domains → add e.g. `freshaf.co.za`,
   then create the CNAME at your registrar (GoDaddy, same as your other sites). TLS is automatic.

> Why the paid Starter plan: the free tier has no persistent disk — every restart would wipe
> customers, suppliers and orders. R130/month is the cost of the database surviving.

## Going live with card payments (PayFast)

1. Register a merchant account at https://www.payfast.co.za (needs business/bank details — only you can do this).
2. In Render → Environment, set `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`.
3. Make sure `BASE_URL` is your public https URL — PayFast's webhook posts to
   `BASE_URL/api/payments/payfast/itn`.
4. Redeploy. The sandbox payment page switches itself off automatically.

## First 30 minutes after deploy

1. Log in at `/admin`, change nothing until you confirm the admin password works.
2. Marketplace settings: confirm commission %, callout pricing, rewards %.
3. Bulk-import your supplier contacts (Admin → Bulk import suppliers) and send each their
   temporary password. They sign in at `/supplier`, set their location, and go online.
4. Place one real cash order end-to-end yourself before announcing anything.

## Alternatives

- **Fly.io** — `fly launch` with the included [Dockerfile](Dockerfile), add a volume for `/app/data`.
- **Any VPS** (Hetzner ~€4/mo) — `docker build -t freshaf . && docker run -d -p 80:5757 -v freshaf-data:/app/data --env-file .env freshaf`, put Caddy/nginx in front for TLS.
- **Not suitable:** Netlify/Vercel serverless — no persistent process for SSE dispatch, no disk for SQLite.

## Store apps (after web go-live)

The app is already an installable PWA (manifest + service worker + icons). For the actual
Apple App Store / Google Play listings: wrap with Capacitor, and you'll need an Apple Developer
account ($99/yr) and Google Play account ($25 once). The in-app requirements (T&C, privacy
policy, account deletion) are already built.
