# Moving FreshAF between servers without losing a customer

*Written 3 November 2026. Read `SECRETS.md` first — half of a migration is secrets, not data.*

---

## The three things that must survive a move

Everything else is replaceable in minutes.

1. **`data/freshaf.db`** — every customer, pro, order, quote, rating and reward balance.
   One SQLite file. This is the business.
2. **The secrets** — listed in `SECRETS.md`.
3. **The domain** — `freshaf.io` pointing at the right machine.

The code is not on that list. It is in GitHub and can be redeployed anywhere in minutes.

---

## Before anything else: the backup habit

A migration is just a restore you planned. The restore only works if backups exist, and
until today **nothing was making any** — the admin panel could download one, but only if
somebody remembered to click.

```bash
npm run backup
```

Logs in to the live site, downloads a consistent snapshot, **opens it and counts the
rows**, and keeps the newest 30. Needs `BACKUP_EMAIL` and `BACKUP_PASSWORD` in `.env` —
an admin login on freshaf.io.

Backups land in **`Desktop\FreshAF\backups\`**, set by `BACKUP_DIR` in `.env`. That is
deliberately outside the code folder: deleting or re-cloning the repository then cannot
take the only copy of production with it. Add `--local` to snapshot this machine's own
database instead of the live one.

> This is one folder on one laptop. It is a real backup — it is not yet a *safe* one.
> When the business has paying customers in it, get a copy off this machine: cloud
> storage only you can read, or an external drive kept somewhere else. The file contains
> every customer's name, address and phone number, so treat it accordingly (`SECRETS.md`).

Run it: before any deploy you are nervous about, before any server move, and otherwise
weekly. It takes seconds and the file is well under a megabyte today.

> A backup nobody has opened is not a backup, it is a file. That is why the script
> verifies every one and deletes any that fails.

**Right now the single biggest risk to this business is not the migration.** It is that
the Render service may still have no persistent disk attached, in which case the database
is wiped on every restart. Taking card money into a database that forgets the order is
worse than taking no card money. Confirm the disk before `PAYMENTS_LIVE=true`.

---

## Stage 0 — now: Render, with a disk and real backups

Do not move servers yet. Get this right first, because every later stage restores from
the backup this stage produces.

- [ ] Confirm the persistent disk is attached and `data/` survives a restart.
- [ ] `BACKUP_EMAIL` / `BACKUP_PASSWORD` set, `npm run backup` runs clean.
- [ ] Every secret in `SECRETS.md` is in the password manager.

---

## Stage 1 — a rented server, when Render stops fitting

**Do not move because owning feels better.** Move when there is a reason you can name:

- **Cost.** Render's starter plan plus a disk is fine at this size. A VPS costs less at
  scale, and more at this one once your time is priced in.
- **Latency.** Render has no South African region. Customers in Cape Town are talking to
  a server in Europe or the US. At FreshAF's traffic nobody will notice; it becomes real
  when the pro app is polling location.
- **Control.** Shell access, cron, your own TLS, no platform limits.

Latency is the honest one. The other two are not yet true.

### What a VPS actually costs you

Render gives you managed TLS, deploy-on-push, health checks and restarts. On a VPS you
own all of that. Budget a day to set up and a few hours a month forever: Caddy or nginx
for TLS, systemd for restarts, a deploy script, unattended security upgrades, a firewall.

### Cutover, with no lost orders

The only safe way with a single SQLite file is a short planned window. Twenty minutes,
late at night. Trying to avoid the window is how people lose orders.

1. **A day before:** drop the DNS TTL on `freshaf.io` to 300 seconds. This is the step
   everyone forgets, and skipping it turns a 20-minute window into a 24-hour one.
2. Build the new server, deploy the code, set every environment variable, get TLS working
   on a temporary hostname. Test it with a throwaway order against its own empty database.
3. **Open the window.** Tell the pros. Put the Render service in maintenance (scale to
   zero, or stop it) so nothing can write.
4. `npm run backup` — the final snapshot. Check the row counts look like production.
5. Copy that file to the new server as `data/restore.db` and start the service. It swaps
   the file in on boot and logs `Restored the database from an uploaded backup`. (Or use
   the admin panel's restore upload, which stages the same file.)
6. **Verify before switching DNS:** sign in as admin, check the order count matches the
   backup, open a customer account, confirm `/api/pricing` responds.
7. Point DNS at the new server. Wait out the TTL.
8. **Leave the old server stopped but intact for a week.** Not deleted. If something
   surfaces on day three, you want the old disk, not a backup of it.

### What does NOT need to change if the domain stays the same

- Stitch redirect URLs and the webhook endpoint — both are `https://freshaf.io/...`, and
  Stitch only cares about the URL, not what answers it.
- The Google Maps key — it is server-side and restricted by API, not by IP, precisely so
  a server move does not break it.

If the domain **does** change, all of those must be re-registered, and the Stitch
redirect URL must match byte-for-byte with no trailing slash or customers get a 404
*after* paying.

---

## Stage 2 — your own hardware

Honest answer: **for a business that takes card payments, this is probably the wrong
destination, and it is worth saying so before you spend money on it.**

A machine in your office means you personally own:

- **Power.** Load-shedding takes the business offline on someone else's schedule. A UPS
  covers the server, not the fibre ONT, not the router, not the upstream exchange.
- **Connectivity.** A residential or small-office line has no SLA, usually no static IP,
  and upstream bandwidth a fraction of the down.
- **Physical risk.** Theft, water, a lightning strike on the fibre — all of them are
  total losses, not outages.
- **Everything from Stage 1, plus the hardware.** Disks fail. At 2am.

What you would gain over a rented VPS: a one-off capital cost instead of a monthly one,
and the data physically on your premises.

**When own hardware does make sense:** a contractual or regulatory requirement that data
stays on your premises, or compute so heavy that renting it is genuinely expensive.
Neither is true of a car wash booking app, and neither is likely to become true.

**The recommendation:** treat a rented server in a South African data centre as the
destination, not a stepping stone. If you still want hardware, buy it for development
and staging, where an outage costs nothing, and leave production rented.

If you go ahead anyway, the cutover is identical to Stage 1, plus: a static IP, port 443
reachable from outside, a UPS, a second machine or disk that is not in the same room, and
`npm run backup` on a schedule to somewhere off-site — because at that point nobody else
is keeping a copy for you.

---

## If a migration goes wrong

1. **Do not delete anything.** The old server stays until you are certain.
2. Point DNS back. It is the fastest rollback there is, which is what the low TTL bought.
3. Restore the last good backup onto the old server if it was written to in the meantime.
4. Work out what broke before trying again.

The restore path is already built and is the same one a migration uses, so it is
exercised every time you move. Use it once in a non-emergency before you need it in one.
