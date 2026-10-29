// Stitch (stitch.money) card payments.
//
// FreshAF is the merchant of record, so this is an ordinary card acquirer integration:
// the customer pays FreshAF, the money settles into FreshAF's own bank account, and we
// pay pros separately as our suppliers. No marketplace or split-payment product needed.
//
// Flow, per https://docs.stitch.money/payment-products/payins/card/once-off/hosted-ui
//   1. POST client_credentials to the token endpoint (cached until it expires).
//   2. clientPaymentInitiationRequestCreate over GraphQL -> { id, url }.
//   3. Redirect the customer to url + ?redirect_uri=<our return page>.
//   4. Trust ONLY the signed webhook for marking an order paid. The status query
//      parameter on the return is attacker-controllable.
const crypto = require('crypto');

const TOKEN_URL = 'https://secure.stitch.money/connect/token';
const API_URL = 'https://api.stitch.money/graphql';

const CLIENT_ID = process.env.STITCH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.STITCH_CLIENT_SECRET || '';
const SCOPE = process.env.STITCH_SCOPE || 'client_paymentrequest';
const WEBHOOK_SECRET = process.env.STITCH_WEBHOOK_SECRET || '';

// Either settle into our own bank account, or against a Stitch merchant id if they
// issue us one. The two are mutually exclusive in their API.
const MERCHANT_ID = process.env.STITCH_MERCHANT_ID || '';
const BENEFICIARY_NAME = process.env.STITCH_BENEFICIARY_NAME || '';
const BENEFICIARY_BANK_ID = process.env.STITCH_BENEFICIARY_BANK_ID || 'fnb';
const BENEFICIARY_ACCOUNT = process.env.STITCH_BENEFICIARY_ACCOUNT_NUMBER || '';

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && (MERCHANT_ID || (BENEFICIARY_NAME && BENEFICIARY_ACCOUNT)));
}

// What is missing, in words, so the admin readiness panel can say something useful.
function missing() {
  const gaps = [];
  if (!CLIENT_ID) gaps.push('STITCH_CLIENT_ID');
  if (!CLIENT_SECRET) gaps.push('STITCH_CLIENT_SECRET');
  if (!MERCHANT_ID && !(BENEFICIARY_NAME && BENEFICIARY_ACCOUNT)) {
    gaps.push('STITCH_MERCHANT_ID, or STITCH_BENEFICIARY_NAME + STITCH_BENEFICIARY_ACCOUNT_NUMBER');
  }
  if (!WEBHOOK_SECRET) gaps.push('STITCH_WEBHOOK_SECRET');
  return gaps;
}

/* ---------- client token ---------- */
// Stitch asks that tokens be cached rather than minted per request.
let cached = { token: null, expiresAt: 0 };

async function clientToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE,
    audience: TOKEN_URL,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Stitch token request failed (${r.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('Stitch token response had no access_token');
  // Expire a minute early so a token never dies mid-request.
  cached = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}

/* ---------- payment request ---------- */
const CREATE_PAYMENT = `
mutation CreatePaymentRequest(
  $amount: MoneyInput!, $externalReference: String, $payerReference: String!,
  $beneficiaryReference: String!, $expireAt: Date, $payerInformation: PayerInformationInput,
  $beneficiary: BeneficiaryInput, $merchantId: String
) {
  clientPaymentInitiationRequestCreate(input: {
    amount: $amount,
    externalReference: $externalReference,
    payerReference: $payerReference,
    beneficiaryReference: $beneficiaryReference,
    beneficiary: $beneficiary,
    merchantId: $merchantId,
    expireAt: $expireAt,
    payerInformation: $payerInformation,
    paymentMethods: { card: { enabled: true } }
  }) {
    paymentInitiationRequest { id url }
  }
}`;

// Bank statement references are short and alphanumeric; anything else gets rejected.
function reference(prefix, orderId) {
  return `${prefix}${orderId}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
}

async function graphql(query, variables) {
  const token = await clientToken();
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Stitch returned non-JSON (${r.status}): ${text.slice(0, 300)}`);
  }
  if (data.errors?.length) throw new Error(`Stitch API error: ${data.errors.map((e) => e.message).join('; ')}`);
  if (!r.ok) throw new Error(`Stitch API failed (${r.status})`);
  return data.data;
}

// amountCents -> Stitch wants a decimal amount in rand, e.g. 376.00, not cents.
async function createPaymentRequest(order, customer, { baseUrl, amountCents }) {
  const beneficiary = MERCHANT_ID ? undefined : {
    bankAccount: {
      name: BENEFICIARY_NAME,
      bankId: BENEFICIARY_BANK_ID,
      accountNumber: BENEFICIARY_ACCOUNT,
    },
  };
  const variables = {
    amount: { quantity: Number((amountCents / 100).toFixed(2)), currency: 'ZAR' },
    externalReference: String(order.id),
    payerReference: reference('FreshAF', order.id),
    beneficiaryReference: reference('Order', order.id),
    beneficiary,
    merchantId: MERCHANT_ID || undefined,
    // A payment page left open forever is a reconciliation problem later.
    expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    payerInformation: {
      payerId: String(customer.id),
      fullName: customer.name || undefined,
      email: customer.email || undefined,
    },
  };
  const data = await graphql(CREATE_PAYMENT, variables);
  const pr = data?.clientPaymentInitiationRequestCreate?.paymentInitiationRequest;
  if (!pr?.url) throw new Error('Stitch did not return a payment URL');

  const redirect = `${baseUrl}/?paid=${order.id}`;
  const failure = `${baseUrl}/?cancelled=${order.id}`;
  const url = `${pr.url}?redirect_uri=${encodeURIComponent(redirect)}`
    + `&failure_redirect_uri=${encodeURIComponent(failure)}`;
  return { url, requestId: pr.id };
}

/* ---------- webhooks ---------- */
// Stitch delivers through Svix. Verify against the RAW body — re-serialised JSON will
// not match. https://docs.stitch.money/webhooks/using_webhooks
function verifyWebhook(rawBody, headers) {
  if (!WEBHOOK_SECRET) return false;
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatureHeader = headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject replays of an old, legitimately signed delivery.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const secretBytes = Buffer.from(WEBHOOK_SECRET.split('_')[1] || '', 'base64');
  const expected = crypto.createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${body}`).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // The header carries space-delimited "v1,<signature>" entries; several during rotation.
  return String(signatureHeader).split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const given = Buffer.from(sig);
    return given.length === expectedBuf.length && crypto.timingSafeEqual(given, expectedBuf);
  });
}

// Pull the order id and outcome out of a payment webhook payload.
function readPaymentEvent(payload) {
  const node = payload?.data?.client?.paymentInitiationRequests?.node;
  if (!node) return null;
  const state = node.state?.__typename || '';
  return {
    orderId: Number(node.externalReference),
    requestId: node.id,
    state,
    paid: state === 'PaymentInitiationRequestCompleted',
  };
}

module.exports = {
  isConfigured, missing, createPaymentRequest, verifyWebhook, readPaymentEvent,
  clientToken, reference,
};
