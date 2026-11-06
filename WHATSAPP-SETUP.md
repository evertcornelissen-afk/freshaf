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

## Step 2 — submit the message templates

**Status 6 Nov 2026 (test number, unverified business):** `freshaf_job_booked`,
`freshaf_ops_alert` and `freshaf_job_alert` submitted. `freshaf_verify_code` was REFUSED:
Meta only allows Authentication templates once the business is verified. Until then the
server runs with codes off (see "Verification codes" below).

WhatsApp will not let a business start a conversation with free text, so both messages have
to be pre-approved templates. In WhatsApp Manager → Message templates → Create template,
create these **exactly** — the variable order is what the code sends.

### Template 1

- **Name:** `freshaf_job_alert`
- **Category:** Utility
- **Language:** English

**Body:**

```
Customer request for your FreshAF Pro account.

Service: {{1}}
Your earnings: {{2}}
Distance from you: {{3}}
Address: {{4}}

Accept or decline in FreshAF Pro. This request closes in {{5}} minutes.
```

(The first wording, "New {{1}} job available", was flagged by Meta's checker as Marketing.
Keep this one: Marketing messages cost more and pros can mute them.)

**Sample values** (Meta asks for these): `Car wash`, `R275`, `3.4 km`,
`12 Durban Road, Bellville`, `1`

**Buttons:** add one **Call to action → Visit website**, type **Dynamic**, label
`Open FreshAF Pro`, URL `https://freshaf.io/supplier?offer={{1}}`

### Template 3 (booking confirmed: the job is the pro's)

Sent the moment a customer books a pro (cash) or pays for the booking (card). A published
price is quoted automatically, so this is often the first the pro hears of the job.

- **Name:** `freshaf_job_booked`
- **Category:** Utility
- **Language:** English

**Body:**

```
You have a new FreshAF booking.

Order: #{{1}}
Service: {{2}}
When: {{3}}
Address: {{4}}
You earn: {{5}}
Payment: {{6}}

Open FreshAF Pro to start the job.
```

**Sample values:** `42`, `Car Wash`, `As soon as possible`, `12 Durban Road, Bellville`,
`R275`, `Collect R330 cash`

**Buttons:** one **Call to action → Visit website**, type **Dynamic**, label
`Open FreshAF Pro`, URL `https://freshaf.io/supplier?job={{1}}`

Environment variable (optional, this is the default): `WHATSAPP_TEMPLATE_BOOKED=freshaf_job_booked`

### Template 2

- **Name:** `freshaf_verify_code`
- **Category:** Authentication
- **Language:** English
- Use Meta's authentication template with the **copy code** button. The code is the single
  variable. If Meta's builder gives you fixed wording for this category, accept it — the
  code only needs to arrive.

### Template 4 (to the FreshAF team: a booking the pro has not started)

- **Name:** `freshaf_ops_alert`
- **Category:** Utility
- **Language:** English
- **Body:**

```
FreshAF booking not started.

Order: #{{1}}
Service: {{2}}
Pro: {{3}}, {{4}}
Status: {{5}}

The pro has not tapped On my way. Phone them, or cancel the booking in the admin app so the customer can book someone else.
```

Sample values for Meta's review: `57`, `Car wash`, `Sipho Dlamini`, `082 555 1234`,
`booked 5 min ago, not on the way yet`. No button.

Sent only to the number in `ADMIN_ALERT_PHONE`, when an ASAP booking is still not on the way
5 minutes after it was booked, or a scheduled one 5 minutes after its start time. The same
alert always goes to the FreshAF inbox by email, and the pro gets a second priority push.

Approval is usually minutes for Utility and Authentication templates.

## Step 3 — set the environment variables on Render

In the Render dashboard → your service → Environment:

```
WHATSAPP_PHONE_NUMBER_ID=<the phone number ID from step 1>
WHATSAPP_TOKEN=<the permanent system-user token>
WHATSAPP_TEMPLATE_JOB=freshaf_job_alert
WHATSAPP_TEMPLATE_CODE=freshaf_verify_code
ADMIN_ALERT_PHONE=<the FreshAF team WhatsApp number that gets late-booking alerts>
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

## Verification codes

`WHATSAPP_VERIFY_CODES` (Render env): unset or `off` in production means no codes. The
number a pro gives at sign-up (labelled "new bookings are sent here") gets alerts straight
away, and pros change it in FreshAF Pro without a code. Once Meta has verified the business
and approved `freshaf_verify_code` (Authentication, copy-code button), set
`WHATSAPP_VERIFY_CODES=on`: sign-up then asks for the WhatsApp code and only verified
numbers get alerts.

## How it behaves

- **Pro sign-up asks for the WhatsApp code** once WhatsApp is connected, so every new pro is
  verified from the first booking. If WhatsApp cannot reach the number (for example while
  only Meta's test number is connected, which delivers to 5 listed numbers only), the pro
  may still apply and confirm the number later in FreshAF Pro.

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
