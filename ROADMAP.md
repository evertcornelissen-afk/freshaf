# FreshAF — Operating Roles, Levers & Growth Roadmap

*Working document — v1, July 2026. Decisions marked (E) Evert, (P) Partner, (C) Claude, or combinations.*

## 1. The business levers — who sets what, with starting values

| Lever | Current value | Recommendation | Owner |
|---|---|---|---|
| Commission on orders | 15% | Keep 15% for pilot (supply is scarce — don't scare pros); move to 20% once you refuse pros for capacity. Uber-type platforms take 20–30%. | E decides, P checks contract wording |
| Callout fee | Free ≤5 km, R10/km, cap R150 | Keep. Revisit cap if pros refuse far jobs. | E |
| Package prices | R180/R280/R650 wash · R220/R320/R380 laundry | Hold for pilot; review after 100 orders against completion times pros report. | E |
| Vehicle/load multipliers | ×1 / ×1.25 / ×1.5 (wash) · ×1 / ×1.5 / ×2 (laundry) | Keep. | E |
| Rewards earn rate | 5% of order value | 5% is generous (it's ⅓ of your commission). Fine as launch promo; plan to drop to 3% after month 3 — CPA requires notice, P advises. | E + P |
| Cancellation policy | Free until pro starts travelling | Add a R50 late-cancel fee (pro en route) in v2 — pros burn petrol. P validates CPA compliance. | E + P |
| Cash commission settlement | **Unsolved** — pro keeps 100% of cash, owes 15% | Decide: (a) weekly invoice, (b) card-only until wallet feature, (c) wallet deductions from card jobs. Recommend (c) — C builds it. | E + P decide, C builds |
| Supplier vetting bar | ID + docs + admin approval | Add: proof of address mandatory, references optional, 3-strike rating rule (<4.0 avg after 10 jobs = suspension). | E |
| Refunds | Manual via admin | E handles case-by-case in pilot; policy hardens after real cases. | E + P |
| Surge/peak pricing | None | Not before Phase 3. Complexity before density is a tax. | E later |

## 2. Marketing — who, where, what budget

**Owner: Evert.** Claude builds the assets and measurement; Partner clears promo wording (CPA on promos/loyalty).

### Supply side (do this FIRST — demand without pros is refunds)
- Your existing contacts → bulk importer (built).
- In-person: car-wash strips, informal washers at malls/taxi ranks, laundromats with idle capacity. Pitch: "phone rings with jobs, you keep 85%."
- WhatsApp/Facebook groups for car-wash workers and domestic services (free).
- Target: **10 wash pros + 3 laundry pros in ONE suburb** before spending a rand on demand.

### Demand side (hyperlocal, one suburb at a time)
- Complex/estate WhatsApp groups + body-corporate noticeboards (free, highest trust).
- Gym + office-park partnerships: "wash while you train/work" — pilot deals with 2 locations.
- Geo-targeted Meta ads (5 km radius, R150/day cap to start) + Google "mobile car wash sandton".
- QR flyers at complexes/gyms → straight to the demo/app.
- Launch promo: first wash R99 (loss-leader, capped 100 uses) OR double rewards month one — pick one, not both.
- Referral programme (C builds): give R50, get R50 in rewards.

### Measurement (C builds, E reads weekly)
- CAC per channel, fill rate (orders accepted/total), time-to-accept, repeat rate at 30 days, rating distribution.

## 3. Full role split

| Area | Evert | Partner | Claude |
|---|---|---|---|
| Pricing & levers | **Decides** | Compliance check | Implements same-day, builds A/B tooling |
| Marketing | **Owns channels, budget, partnerships** | Promo/ad wording compliance | Landing pages, SEO, referral feature, OG assets, analytics |
| Supply ops | **Recruits, approves, disciplines pros** | Supplier Agreement, disputes | Onboarding flow, bulk import, rating enforcement automation |
| Customer support | **Day 1: your WhatsApp number**; hire at ~30 orders/day | Escalated disputes | Admin tools, canned-response tooling, support inbox later |
| Finance | **Banking, payouts, VAT, PayFast** | Tax/VAT structure advice | Payout reports, wallet/settlement feature, revenue dashboards |
| Product | Priorities & final say | Legal constraints in | **Everything technical: build, deploy, secure, maintain** |
| Legal/compliance | Signs | **Owns entirely** | Implements changes (T&C text, consent flows, notices) |
| Data/POPIA | Accountable (Information Officer likely you) | Registration, policy | Security, retention automation, breach tooling |

## 4. Growth roadmap with gates

### Phase 0 — Close the loop (this week)
Render card + disk (E) · PayFast verification (E) · buy freshaf.io (E) · point domain (C) · Pty Ltd + founders' agreement started (E+P) · Supplier Agreement draft (P) · flip public site to real app (C, after disk).
**Gate: a stranger can pay real money and the data survives a restart.**

### Phase 1 — Pilot: one suburb, 4 weeks
10 wash + 3 laundry pros live (E) · 50 completed orders · E personally checks every order's quality · support via WhatsApp (E) · weekly metrics email (C builds).
**Gate: fill rate >70%, repeat rate >25%, ratings avg >4.3. If supply keeps missing jobs — fix supply, do NOT spend on demand.**

### Phase 2 — Prove economics (months 2–3)
Referral programme + cash-settlement wallet + scheduled bookings + rating enforcement (C) · 200 orders/month · first 2 B2B deals: gym/office park (E) · unit economics reviewed: contribution margin per order after rewards + payment fees (E+P).
**Gate: contribution margin positive and CAC < 2× first-order margin.**

### Phase 3 — Scale Johannesburg (months 4–6)
3–5 suburbs · Capacitor apps in Apple/Google stores (C; needs E's developer accounts) · live pro GPS tracking + push for customers (C) · automated EFT payout batches (C) · paid ads scaled to CAC target (E) · consider commission 15→20% (E).
**Gate: 1,000 orders/month, <5% orders needing support intervention.**

### Phase 4 — New territory (months 6–12)
Pretoria, then Cape Town — each city = repeat Phase 1 playbook, never skip the supply-first rule · fleet/corporate contracts (E+P) · resist new verticals until 2 cities are dense — density beats breadth.

## 5. Standing risks (reread monthly)
1. Contractor reclassification — the lawsuit that kills gig platforms. Supplier Agreement + genuine independence (pros set hours, own equipment).
2. Cash leakage — pros doing repeat customers off-platform. Mitigate: rewards lock-in, response speed, don't over-tax with commission.
3. Quality variance — one shrunk wardrobe on a community WhatsApp group undoes a month of ads. Vet hard, refund fast, suspend at 3 strikes.
4. Spending on demand before supply — the classic marketplace death. The gates above exist for this.
