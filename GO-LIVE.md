# Go-live runbook — the persistent disk cutover

Everything below is prepared and tested. Tomorrow you add a card and say **go**.

## The one thing that has to be right

Attaching a disk mounts it **empty**. Whatever production holds at that moment is gone unless
it is backed up first. That is why the backup and restore buttons exist in Admin, and why the
order below matters.

Tested locally end to end on 19 Aug: wiped the database completely, uploaded the backup,
restarted — 19 customers, 15 orders and 10 approved pros all came back.

## Steps

**You (needs a card — I cannot do this part):**

1. <https://dashboard.render.com/billing> → add your card.

**Then say "go" and I do the rest:**

2. **Back up first.** Admin → Launch readiness → **Download backup**. Keep the `.db` file.
3. **Settings → Instance Type → Update → Starter.**
4. **Disk** (left sidebar) → add a disk:
   - Mount path: `/opt/render/project/src/data` — exactly this, nothing else
   - Size: **1 GB**
5. Render restarts onto the empty disk. The site comes up with no data — expected.
6. Admin → **Upload a backup to restore** → pick the `.db` file from step 2.
7. Redeploy (or restart). On boot the app swaps the backup in and logs
   `Restored the database from an uploaded backup.`
8. Admin → Launch readiness → **Persistent disk attached** should now read **ready**.

## Why the mount path is not negotiable

`server/db.js` writes everything into that folder:

| File | What breaks if it is lost |
|---|---|
| `freshaf.db` | Every customer, pro, order and quote |
| `jwt.secret` | *(already pinned via the `JWT_SECRET` env var — safe)* |
| `vapid.json` | Every pro's push-notification subscription |
| `uploads/` | Every uploaded ID copy, proof of address and work photo |

Mount it anywhere else and the disk fills with nothing while the real data keeps vanishing.

## What is already done and needs nothing tomorrow

- `JWT_SECRET` pinned in Render — sessions survive deploys
- Auto-deploy working through Render's GitHub app — one deploy per push, no manual click
- Hybrid quoting, "from" pricing, the whole polished front end — live
- Backup, restore-on-boot and the readiness panel — live
- WAL checkpointing, so a backup is never missing recent writes

## Still outstanding after the disk, in order

1. **Load suppliers.** Nothing else matters without supply. Brochures, tracker and call script
   are ready; `SUPPLY-TARGETS-NORTHERN-SUBURBS.md` has 20 researched businesses.
2. **PayFast verification** — their side. Cash works fully in the meantime.
3. **WhatsApp alerts** — needs a spare SIM and a Meta business account. See `WHATSAPP-SETUP.md`.
4. **Lawyer reviews the T&C** — rewritten twice this week; sections 3, 4 and 11 are the new ones.
5. Register the Pty Ltd and move the domain, PayFast and accounts into it.

## Note on `uploads/`

The backup covers the **database only**. Uploaded pro documents live in `data/uploads/` and are
not in the `.db` file. Right now that folder is effectively empty, so nothing is at risk today —
but once pros start uploading IDs, do the disk cutover *before* letting that build up, or those
files will need their own copy.
