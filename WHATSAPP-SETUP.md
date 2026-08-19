# WhatsApp job alerts — setup

The code is built and tested. Until the four environment variables below are set, the app
runs in **dry run**: every alert it would have sent is written to the `whatsapp_log` table
and printed to the server log, and the pro-facing screens say "test mode". Nothing else
changes, so you can leave it exactly as it is until you are ready.

## Before you start — two things that catch people out

1. **You need a spare phone number.** A number connected to the WhatsApp Cloud API can no
   longer be used in the normal WhatsApp or WhatsApp Business app. **Do not use
   078 299 1050** — that is the recruitment number on your brochures and you need it to
   stay a normal WhatsApp. Buy a new prepaid SIM for this.
2. **You do not need the Pty Ltd to start.** An unverified business can send roughly
   250 business-initiated conversations per 24 hours. That is enough for a pilot of ten
   pros. You need Meta Business Verification (which needs company registration documents)
   only to go beyond that, so register the company before you scale supply, not before you
   switch this on.

Cost: utility template messages to South African numbers are cents each. At ten pros and
a few jobs a day this is a rounding error, but it is not zero.

## Step 1 — create the Meta assets

1. Go to <https://business.facebook.com> and create a Meta Business account.
2. At <https://developers.facebook.com> create an app of type **Business**, then add the
   **WhatsApp** product to it.
3. In WhatsApp → API Setup, add your spare number as the sender and verify it by SMS.
4. Note the **Phone number ID** (a long number shown on that page — *not* the phone number).
5. Generate a **permanent access token**: Business Settings → Users → System Users → add a
   system user with admin rights, assign it the app and the WhatsApp account, then generate
   a token with the `whatsapp_business_messaging` scope and **no expiry**. The temporary
   24-hour token on the API Setup page is only good for a first test.

## Step 2 — submit the two message templates

WhatsApp will not let a business start a conversation with free text, so both messages have
to be pre-approved templates. In WhatsApp Manager → Message templates → Create template,
create these two **exactly** — the variable order is what the code sends.

### Template 1

- **Name:** `freshaf_job_alert`
- **Category:** Utility
- **Language:** English

**Body:**

```
New {{1}} job available.

You earn: {{2}}
Distance: {{3}}
Address: {{4}}

Accept within {{5}} minutes or it goes back to the customer.
```

**Sample values** (Meta asks for these): `Car wash`, `R275`, `3.4 km`,
`12 Durban Road, Bellville`, `1`

**Buttons:** add one **Call to action → Visit website**, type **Dynamic**, label
`Open FreshAF Pro`, URL `https://freshaf.io/supplier?offer={{1}}`

### Template 2

- **Name:** `freshaf_verify_code`
- **Category:** Authentication
- **Language:** English
- Use Meta's authentication template with the **copy code** button. The code is the single
  variable. If Meta's builder gives you fixed wording for this category, accept it — the
  code only needs to arrive.

Approval is usually minutes for Utility and Authentication templates.

## Step 3 — set the environment variables on Render

In the Render dashboard → your service → Environment:

```
WHATSAPP_PHONE_NUMBER_ID=<the phone number ID from step 1>
WHATSAPP_TOKEN=<the permanent system-user token>
WHATSAPP_TEMPLATE_JOB=freshaf_job_alert
WHATSAPP_TEMPLATE_CODE=freshaf_verify_code
```

`WHATSAPP_TEMPLATE_LANG` defaults to `en` — set it only if you registered the templates
under a different language code (`en_US` is a common trap).

Redeploy after saving. Remember Render does not deploy on push:

```bash
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-d9eavarrjlhs73c2u3ag/deploys
```

## Step 4 — check it

1. Sign in to FreshAF Pro as a test pro. The **WhatsApp job alerts** card asks for a number.
2. Enter your own WhatsApp number, tap **Send me a code**, and the code should arrive on
   WhatsApp within seconds. Enter it.
3. The card should now show the number as verified with a toggle.
4. Place a test order choosing that pro. The alert should arrive on WhatsApp.

If nothing arrives, the reason is recorded — check the `whatsapp_log` table, or the server
log, which prints the exact error Meta returned.

## How it behaves

- A pro only gets WhatsApp alerts once they have **verified** the number, and only while
  their toggle is on. Web Push keeps working independently — WhatsApp is added, not swapped.
- Verification codes are six digits, expire after ten minutes, allow five wrong attempts,
  and can only be re-sent once a minute.
- A failed WhatsApp send never blocks dispatch. The job offer still goes out.
- Admin can switch the whole channel off with the `whatsapp_alerts_enabled` setting.

## One thing to change when you go live

Offers currently expire after **60 seconds**. That is fine for an in-app push, but it is
tight for someone who has to read a WhatsApp, tap through and accept. Once WhatsApp alerts
are on, raise **Offer timeout** in Admin → Marketplace settings to **120–180 seconds**,
otherwise pros will lose jobs they genuinely wanted.
