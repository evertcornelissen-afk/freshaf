# Where FreshAF should live, and what each option really costs

*Written 3 November 2026, after `/api/health` on the live site returned
`"data_persisted": false` — proof that every account is being deleted on each deploy.*

---

## The thing worth knowing first

**Nobody is using freshaf.io yet.** Zero approved pros, no real customers, card payments
off. So the wipe currently destroys nothing of value.

That changes the question completely. It is not *"how do I stop losing data today"*, it
is *"what must be true the day I take the first real booking"* — and the answer is:
data survives a restart, and no sooner.

**So: do not pay for hosting yet. Build on this PC, where data already persists for
free. Pay the day before the first customer.** The two things that must happen together
are the persistent disk and `PAYMENTS_LIVE=true`. Never one without the other.

---

## How the other MVP apps avoid this

Worth knowing, because the comparison is instructive. **FMK** and **MVP CRM** run on
**Netlify Functions with Netlify Blobs** — a managed key-value store. Their data never
touches a server filesystem, so there is no disk to lose.

**That approach does not transfer to FreshAF**, and the reason is not stubbornness:

- Those apps store documents — a game round, a quote record. Blobs suits that.
- FreshAF is relational. Orders join to suppliers, quotes to requests, ratings to pros,
  balances to settled fees. The code is full of SQL that does that work in one query.
- Porting to a key-value store means rewriting every one of those as hand-rolled lookups
  and in-memory joins. It is a rewrite of the entire data layer, in a payment app, to
  save seven dollars.

---

## The real options, honestly costed

### 1. Render Starter — ~$7/month (≈R130)

Instance type → Starter, add a 1 GB disk at `/opt/render/project/src/data`. Five minutes.
Nothing else changes: same deploys, managed TLS, restarts handled.

**One car wash a month covers it.** When there are real customers this is not a decision,
it is a rounding error.

### 2. This PC, for now — free

Already works. `data/freshaf.db` sits on a real disk, so accounts persist across restarts
with no configuration at all. Run `start-freshaf.bat` or the desktop shortcut.

Right for: building, testing, demonstrating to a pro across a table.

**Not right for a public payment-taking site, and the reasons are not theoretical:**

- **Load-shedding.** The business goes offline on someone else's schedule. A UPS keeps
  the PC up, not the fibre ONT, not the router, not the exchange.
- **The PC must never sleep.** Windows updates reboot it. You close the laptop, FreshAF
  is down.
- **Stitch webhooks must reach it.** If they cannot, a customer's card is charged and
  their order is never marked paid — the worst failure in the whole system.
- **A home line has no SLA**, usually no static IP, and modest upload.

To expose it publicly you would also need a Cloudflare Tunnel (free, no port forwarding)
and to move freshaf.io's nameservers to Cloudflare. **That last step can break
admin@freshaf.io** if the GoDaddy MX records are not copied across exactly — so it is not
a five-minute change, and email breaking is a worse day than $7.

### 3. Oracle Cloud Always Free — free, permanently

A genuinely free VM with real disk. Not a trial. Card needed for identity, never charged
while on Always Free tier.

Right if you would rather spend half a day than $7/month — and you then own TLS renewal,
security updates, deploys and restarts, forever. The cost is your time, every month.

### 4. A rented VPS — later

The destination. See `MIGRATION.md` for the cutover that does not lose orders.

---

## The recommendation

**Build on this PC. Keep freshaf.io on Render free as a shop window — it may wipe, and
today that costs nothing. The day a real pro is approved and you are ready to take a real
booking, switch Render to Starter, attach the disk, restore a backup, and only then set
`PAYMENTS_LIVE=true`.**

That sequence costs nothing until the week it matters, and it never puts a customer's
money into a database that forgets them.

---

## Running it on this PC

Double-click **`start-freshaf.bat`** (or the desktop shortcut). The app is at
<http://localhost:5757>; the admin dashboard is separate — see `admin-app/README.md`.

Data lives in `freshaf/data/freshaf.db`. Back it up with:

```
npm run backup -- --local
```

which writes a verified snapshot to `Desktop\FreshAF\backups\`.

**That file is the business.** Whatever you host on later, it moves with you.
