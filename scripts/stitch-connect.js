#!/usr/bin/env node
// One command that does every Stitch Express setup step that does not need a human.
//
//   npm run stitch:check      credentials and configuration only, changes nothing
//   npm run stitch:connect    also registers the return URL and the webhook
//   npm run stitch:connect -- --test-payment   also creates a R1.00 payment link
//
// This targets the Stitch EXPRESS REST API (express.stitch.money/api/v1), which is a
// different product from the Stitch Enterprise GraphQL API at api.stitch.money.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const stitch = require('../server/stitch');

const BASE_URL = process.env.BASE_URL || 'https://freshaf.io';
const RETURN_URL = stitch.returnUrl(BASE_URL);
const WEBHOOK_URL = `${BASE_URL.replace(/\/$/, '')}/api/payments/stitch/webhook`;

const args = process.argv.slice(2);
const DO_CONNECT = args.includes('--connect');
const DO_TEST_PAYMENT = args.includes('--test-payment');

const tick = (s) => console.log(`  \x1b[32mOK\x1b[0m   ${s}`);
const cross = (s) => console.log(`  \x1b[31mFAIL\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33mWARN\x1b[0m ${s}`);
const info = (s) => console.log(`       ${s}`);
const head = (s) => console.log(`\n${s}`);

async function main() {
  console.log('\nStitch Express connection check');
  console.log(`  return URL:  ${RETURN_URL}`);
  console.log(`  webhook URL: ${WEBHOOK_URL}`);

  head('1. Credentials');
  const gaps = stitch.missing();
  if (!stitch.isConfigured()) {
    cross(`Not configured: ${gaps.join(', ')}`);
    info('Set them in .env locally, or in the Render environment, then run this again.');
    process.exitCode = 1;
    return;
  }
  try {
    await stitch.clientToken();
    tick(`Token issued — credentials are valid (${stitch.isTestMode() ? 'TEST mode' : 'LIVE mode'}).`);
  } catch (e) {
    cross(`Could not get a token: ${e.message}`);
    info('A 400 here almost always means the client secret was regenerated. Stitch');
    info('regenerates it every time someone clicks "View Client Secret" in the');
    info('dashboard, which silently breaks the secret already in your environment.');
    process.exitCode = 1;
    return;
  }
  if (gaps.length) warn(`Still unset: ${gaps.join(', ')}`);

  head('2. Return URL');
  // Stitch compares byte-for-byte after stripping the query and ONE trailing slash from
  // the incoming URL. A registered URL with a trailing slash can never match anything,
  // and the customer discovers this as a 404 after they have already paid.
  let registered = [];
  try {
    registered = await stitch.listRedirectUrls();
    info(`Registered: ${registered.length ? registered.join(', ') : '(none)'}`);
  } catch (e) {
    cross(`Could not list redirect URLs: ${e.message}`);
  }
  const bad = registered.filter((u) => u.endsWith('/'));
  if (bad.length) {
    cross(`These end in a trailing slash and will never match: ${bad.join(', ')}`);
    info('Delete them in the dashboard and re-add them without the slash.');
  }
  if (registered.includes(RETURN_URL)) {
    tick('Our return URL is registered exactly.');
  } else if (!DO_CONNECT) {
    warn('Our return URL is NOT registered. Run `npm run stitch:connect` to add it.');
  } else {
    try {
      const now = await stitch.registerRedirectUrl(RETURN_URL);
      tick(`Registered. Now: ${now.join(', ')}`);
    } catch (e) {
      cross(`Could not register the return URL: ${e.message}`);
    }
  }

  head('3. Webhook');
  if (!DO_CONNECT) {
    info('Run `npm run stitch:connect` to register the webhook endpoint.');
    info(process.env.STITCH_WEBHOOK_SECRET
      ? 'STITCH_WEBHOOK_SECRET is set.'
      : 'STITCH_WEBHOOK_SECRET is NOT set — every webhook will be rejected.');
  } else if (process.env.STITCH_WEBHOOK_SECRET) {
    info('STITCH_WEBHOOK_SECRET is already set; not registering a second endpoint.');
    info('Registering again would issue a new secret and leave a duplicate delivery.');
  } else {
    try {
      const res = await stitch.registerWebhook(WEBHOOK_URL);
      tick('Webhook registered.');
      const secret = res?.secret || res?.signingSecret || res?.webhook?.secret;
      if (secret) {
        info('Set this as STITCH_WEBHOOK_SECRET. It cannot be fetched again:');
        console.log(`\n       ${secret}\n`);
      } else {
        info(`Response: ${JSON.stringify(res).slice(0, 300)}`);
        info('No secret field recognised — copy it from the webhooks dashboard.');
      }
    } catch (e) {
      cross(`Could not register the webhook: ${e.message}`);
      info(`Add it by hand at ${process.env.STITCH_API_BASE || 'https://express.stitch.money'}/webhooks`);
      info(`pointing at ${WEBHOOK_URL}, subscribed to payment.paid.`);
    }
  }

  if (DO_TEST_PAYMENT) {
    head('4. Test payment (R1.00)');
    if (!stitch.isTestMode()) {
      warn('These are LIVE credentials. This would create a real R1.00 charge.');
      info('Re-run with the test- credentials if that is not what you want.');
    }
    try {
      const { url, requestId } = await stitch.createPaymentRequest(
        { id: 0 },
        { id: 0, name: 'FreshAF Test', email: process.env.ADMIN_NOTIFY_EMAIL || 'admin@freshaf.io' },
        { baseUrl: BASE_URL, amountCents: 100 },
      );
      tick(`Payment link created (${requestId}). Open this to pay R1.00:`);
      console.log(`\n       ${url}\n`);
      info('Order 0 does not exist, so the webhook will be acknowledged and ignored.');
    } catch (e) {
      cross(`Could not create a payment link: ${e.message}`);
    }
  }

  head('Next');
  info(`PAYMENTS_LIVE is ${process.env.PAYMENTS_LIVE === 'true' ? 'TRUE — card is live.' : 'not set — card stays off until you set it.'}`);
  console.log('');
}

main().catch((e) => { console.error('\nUnexpected error:', e.message); process.exitCode = 1; });
