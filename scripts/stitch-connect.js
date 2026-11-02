#!/usr/bin/env node
// One command that does every Stitch setup step that does not need a human.
//
//   npm run stitch:check      credentials only, changes nothing
//   npm run stitch:connect    also registers the webhook subscription
//   npm run stitch:connect -- --test-payment   also creates a R1 payment link
//
// Why it introspects instead of hardcoding: Stitch's published examples of
// clientWebhookAdd disagree between API generations (one supplies a secret, a newer one
// takes filterTypes and returns a Svix secret). Rather than guess which your client
// speaks, this asks your live schema and adapts.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN_URL = 'https://secure.stitch.money/connect/token';
const API_URL = 'https://api.stitch.money/graphql';

const CLIENT_ID = process.env.STITCH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.STITCH_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'https://freshaf.io';
const WEBHOOK_URL = `${BASE_URL.replace(/\/$/, '')}/api/payments/stitch/webhook`;

const args = process.argv.slice(2);
const DO_CONNECT = args.includes('--connect');
const DO_TEST_PAYMENT = args.includes('--test-payment');

const tick = (s) => console.log(`  \x1b[32mOK\x1b[0m   ${s}`);
const cross = (s) => console.log(`  \x1b[31mFAIL\x1b[0m ${s}`);
const info = (s) => console.log(`       ${s}`);
const head = (s) => console.log(`\n${s}`);

async function token(scope) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope,
    audience: TOKEN_URL,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text).access_token;
}

async function gql(accessToken, query, variables) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`non-JSON (${r.status}): ${text.slice(0, 300)}`); }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

// What does THIS client's schema say clientWebhookAdd takes?
const INTROSPECT = `
query { __schema { mutationType { fields {
  name
  args { name type { kind name ofType { kind name ofType { kind name } } } }
} } } }`;

const INPUT_FIELDS = `
query ($name: String!) { __type(name: $name) {
  name
  inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
} }`;

function typeName(t) {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return `${typeName(t.ofType)}!`;
  if (t.kind === 'LIST') return `[${typeName(t.ofType)}]`;
  return t.name || typeName(t.ofType);
}

async function main() {
  console.log('\nStitch connection check');
  console.log(`  target: ${WEBHOOK_URL}`);

  head('1. Credentials');
  if (!CLIENT_ID || !CLIENT_SECRET) {
    cross('STITCH_CLIENT_ID / STITCH_CLIENT_SECRET are not set.');
    info('Set them in .env locally, or in the Render environment, then run this again.');
    process.exitCode = 1;
    return;
  }
  let payToken;
  try {
    payToken = await token(process.env.STITCH_SCOPE || 'client_paymentrequest');
    tick('client_paymentrequest token issued — client id and secret are valid.');
  } catch (e) {
    cross(`Could not get a payment token: ${e.message}`);
    if (/invalid_client/.test(e.message)) {
      info('invalid_client: the client id or secret is wrong, or belongs to a different');
      info('Stitch environment than the one you copied it from.');
    } else if (/invalid_scope/.test(e.message)) {
      info(`invalid_scope: Stitch has not enabled "${process.env.STITCH_SCOPE || 'client_paymentrequest'}"`);
      info('on this client. Ask support to add it, quoting your client id.');
    } else {
      info('Check the client id and secret, and that Stitch has finished onboarding you.');
    }
    process.exitCode = 1;
    return;
  }

  head('2. Is Card enabled on this client?');
  // Stitch enables Card per client. Asking the schema is cheaper than a failed payment.
  try {
    const d = await gql(payToken, INPUT_FIELDS, { name: 'PaymentMethodsInput' });
    const fields = (d.__type?.inputFields || []).map((f) => f.name);
    if (!d.__type) {
      info('Could not read PaymentMethodsInput — check it in the Stitch dashboard instead.');
    } else if (fields.includes('card')) {
      tick(`Card is present in the schema (payment methods: ${fields.join(', ')}).`);
      info('Schema visibility is not the same as entitlement — if a real payment is');
      info('rejected, ask Stitch to enable Card on the client.');
    } else {
      cross(`Card not offered on this client. Available: ${fields.join(', ') || 'none'}.`);
      info('Ask Stitch support to enable the Card feature, quoting your client id.');
    }
  } catch (e) {
    info(`Could not introspect payment methods: ${e.message}`);
  }

  head('3. Webhook subscription');
  let webhookToken = null;
  try {
    webhookToken = await token('client_webhook_manage');
    tick('client_webhook_manage token issued.');
  } catch (e) {
    cross(`No webhook-management scope: ${e.message}`);
    info('Ask Stitch to add client_webhook_manage, or create the subscription by hand');
    info(`in the dashboard pointing at ${WEBHOOK_URL} for the "payment" event.`);
  }

  if (webhookToken) {
    let inputTypeName = null;
    try {
      const d = await gql(webhookToken, INTROSPECT, {});
      const f = (d.__schema?.mutationType?.fields || []).find((x) => x.name === 'clientWebhookAdd');
      if (!f) {
        cross('clientWebhookAdd is not in this schema.');
      } else {
        const arg = f.args[0];
        inputTypeName = typeName(arg.type).replace(/[!\[\]]/g, '');
        tick(`clientWebhookAdd(${arg.name}: ${typeName(arg.type)})`);
      }
    } catch (e) {
      info(`Could not introspect the mutation: ${e.message}`);
    }

    if (inputTypeName) {
      try {
        const d = await gql(webhookToken, INPUT_FIELDS, { name: inputTypeName });
        const fields = d.__type?.inputFields || [];
        info(`${inputTypeName} fields: ${fields.map((x) => `${x.name}: ${typeName(x.type)}`).join(', ')}`);

        if (!DO_CONNECT) {
          info('Run `npm run stitch:connect` to create the subscription.');
        } else {
          const names = fields.map((x) => x.name);
          const input = { url: WEBHOOK_URL };
          // Newer schema filters by event type; older one takes a secret we supply.
          if (names.includes('filterTypes')) input.filterTypes = ['payment'];
          if (names.includes('secret')) {
            input.secret = process.env.STITCH_WEBHOOK_SECRET
              || `whsec_${require('crypto').randomBytes(24).toString('base64')}`;
          }
          const sel = 'webhook { id url ' + (fields.some((x) => x.name === 'secret') ? '' : 'secret ') + '}';
          const mutation = `mutation ($input: ${inputTypeName}!) { clientWebhookAdd(input: $input) { ${sel} } }`;
          const res = await gql(webhookToken, mutation, { input });
          const wh = res?.clientWebhookAdd?.webhook || {};
          tick(`Subscription created: ${wh.id || '(no id returned)'}`);
          const secret = wh.secret || input.secret;
          if (secret) {
            info('Set this on Render as STITCH_WEBHOOK_SECRET:');
            console.log(`\n       ${secret}\n`);
          } else {
            info('No signing secret returned — copy it from the Stitch dashboard.');
          }
        }
      } catch (e) {
        cross(`Webhook step failed: ${e.message}`);
      }
    }
  }

  if (DO_TEST_PAYMENT) {
    head('4. Test payment (R1.00)');
    try {
      const stitch = require('../server/stitch');
      const { url } = await stitch.createPaymentRequest(
        { id: 0 }, { id: 0, name: 'Test', email: process.env.ADMIN_NOTIFY_EMAIL || 'admin@freshaf.io' },
        { baseUrl: BASE_URL, amountCents: 100 },
      );
      tick('Payment request created. Open this to test a real R1 card payment:');
      console.log(`\n       ${url}\n`);
      info('Order id 0 does not exist, so the webhook will be acknowledged and ignored.');
    } catch (e) {
      cross(`Could not create a payment request: ${e.message}`);
    }
  }

  head('Next');
  info(`PAYMENTS_LIVE is ${process.env.PAYMENTS_LIVE === 'true' ? 'TRUE — card is live.' : 'not set — card stays off until you set it.'}`);
  console.log('');
}

main().catch((e) => { console.error('\nUnexpected error:', e.message); process.exitCode = 1; });
