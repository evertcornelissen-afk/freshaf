# freshaf.io DNS — snapshot and rules

Captured from GoDaddy on **18 November 2026**, immediately after adding the Google site
verification record. If anything ever rewrites this zone, restore from here.

Registrar / DNS host: **GoDaddy** (nameservers ns51/ns52.domaincontrol.com).

## The records

| Type | Name | Data | TTL | What breaks if it goes |
|---|---|---|---|---|
| A | `@` | `216.24.57.1` | 1 hour | **freshaf.io stops resolving to Render. The app is down.** |
| CNAME | `www` | `freshaf.onrender.com.` | 1 hour | www.freshaf.io stops working |
| MX | `@` | `smtp.secureserver.net.` (priority 0) | 1 hour | **admin@freshaf.io stops receiving mail** |
| MX | `@` | `mailstore1.secureserver.net.` (priority 10) | 1 hour | backup mail delivery |
| TXT | `@` | `v=spf1 include:secureserver.net -all` | 1 hour | outbound mail starts failing SPF and lands in spam |
| CNAME | `secureserver1._domainkey` | `s1.dkim.freshaf_io.de6.onsecureserver.net.` | 1 hour | DKIM signing breaks, mail reputation drops |
| CNAME | `secureserver2._domainkey` | `s2.dkim.freshaf_io.de6.onsecureserver.net.` | 1 hour | as above |
| CNAME | `email` | `email.secureserver.net.` | 1 hour | webmail shortcut |
| SRV | `_autodiscover._tcp` | `0 0 443 autodiscover.secureserver.net.` | 1 hour | Outlook autodiscover |
| TXT | `@` | `google-site-verification=HyUUzeReit9Bj9MfG-oTjTOJkpL8q1CT34MjmpTjG6Y` | 1 hour | **Play Console loses website verification and apps can be pulled** |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com.` | 1 hour | GoDaddy's own auto-setup hook (see the rule below) |
| NS | `@` | `ns51.domaincontrol.com.` | 1 hour | GoDaddy-managed, not editable |
| NS | `@` | `ns52.domaincontrol.com.` | 1 hour | GoDaddy-managed, not editable |
| SOA | `@` | primary `ns51.domaincontrol.com.` | 1 hour | GoDaddy-managed |

GoDaddy reported **15 records**; 14 are listed above. One row could not be read out of the
page (the tooling returned "BLOCKED: Cookie/query string data" for it). Re-check that row by
hand at the GoDaddy DNS page and add it here.

## Rules for changing this zone

1. **Never use a provider's automatic / "connect" integration to change DNS on this domain.**
   On 18 Nov 2026, Google Search Console's "verify via GoDaddy.com" button opened GoDaddy Domain
   Connect with scope `domain-verification+gmail-setup`. A Gmail-setup template can rewrite the
   **MX records** — which carry admin@freshaf.io, now the login and the contact address for the
   Play developer account, the Apple enrolment, D&B and Stitch. Nothing was authorised, but the
   route was one click from real damage. **Add the single record by hand instead.**
2. **Read the scope of any OAuth or Domain Connect link before signing in to it.** The scope is in
   the URL. If it asks for more than the one thing being done, close it.
3. **Only ever add; never edit or delete** an existing record on this domain without checking the
   table above for what it carries.
4. **After any change, re-read the zone and confirm the A, both MX, SPF and both DKIM rows are
   unchanged** — then update this file in the same commit.
