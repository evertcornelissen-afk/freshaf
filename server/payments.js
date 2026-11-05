// Payment adapter. FreshAF is the merchant of record, so this is an ordinary card
// acquirer integration: the customer pays FreshAF, and FreshAF pays pros separately as
// its own suppliers. No marketplace or split-payment product is involved.
//
// The provider is chosen with PAYMENT_PROVIDER (stitch | payfast). Without credentials,
// or without PAYMENTS_LIVE=true, it runs in sandbox mode — an internal payment page
// simulates the redirect so the whole order lifecycle works end to end before a
// merchant account exists.
const crypto = require('crypto');
const stitch = require('./stitch');

const PROVIDER = (process.env.PAYMENT_PROVIDER || 'stitch').toLowerCase();

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || '';
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || '';
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5757';

// Card payments stay off unless someone explicitly turns them on. Credentials left in
// the environment must never be enough on their own to start taking real money.
const ENABLED = process.env.PAYMENTS_LIVE === 'true';
const PAYFAST_READY = Boolean(MERCHANT_ID && MERCHANT_KEY);
// Stitch issues test keys (client id "test-...") and live keys. Test keys move no money: a
// real customer's card is declined or only simulated, and anyone with Stitch's published
// test card numbers would get a "paid" booking for free. So test keys never count as live.
// They still work for demo accounts, which is how the real card checkout gets tested.
const STITCH_TEST = PROVIDER === 'stitch' && stitch.isConfigured() && stitch.isTestMode();
const LIVE = ENABLED && (PROVIDER === 'stitch' ? stitch.isConfigured() && !STITCH_TEST : PAYFAST_READY);
const TEST_GATEWAY = ENABLED && STITCH_TEST;

// Whether card is offered to this person. Real customers: only when real money can move.
// Demo accounts: always, through the gateway's test mode when there is one, otherwise
// through the internal test page, and never through live keys.
function cardAvailableFor(customer) {
  if (customer?.is_demo) return true;
  return LIVE;
}

function payfastSignature(params, passphrase) {
  const keys = Object.keys(params);
  let str = keys.map((k) => `${k}=${encodeURIComponent(String(params[k]).trim()).replace(/%20/g, '+')}`).join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

function payfastUrl(order, customer, amountCents) {
  const params = {
    merchant_id: MERCHANT_ID,
    merchant_key: MERCHANT_KEY,
    return_url: `${BASE_URL}/?paid=${order.id}`,
    cancel_url: `${BASE_URL}/?cancelled=${order.id}`,
    notify_url: `${BASE_URL}/api/payments/payfast/itn`,
    name_first: customer.name,
    email_address: customer.email,
    m_payment_id: String(order.id),
    amount: (amountCents / 100).toFixed(2),
    item_name: `FreshAF order #${order.id}`,
  };
  const signature = payfastSignature(params, PASSPHRASE);
  const qs = new URLSearchParams({ ...params, signature }).toString();
  return `https://www.payfast.co.za/eng/process?${qs}`;
}

// Returns { url } the customer should be redirected to for payment.
async function createPayment(order, customer) {
  const amountCents = order.price_cents - (order.points_used_cents || 0);
  if (customer?.is_demo) {
    // A demo account goes through Stitch's test checkout when the keys are test keys, so
    // the real card flow can be rehearsed end to end. With live keys it never touches
    // the gateway: a reviewer's or tester's card is never charged.
    if (!TEST_GATEWAY) return { url: `/pay/${order.id}`, mode: 'sandbox' };
  } else if (!LIVE) {
    throw new Error('Card payments are not available yet');
  }

  if (PROVIDER === 'stitch') {
    const { url, requestId } = await stitch.createPaymentRequest(order, customer, {
      baseUrl: BASE_URL, amountCents,
    });
    return { url, mode: 'live', provider: 'stitch', reference: requestId };
  }
  return { url: payfastUrl(order, customer, amountCents), mode: 'live', provider: 'payfast' };
}

// What the admin readiness panel says about card payments.
function statusDetail() {
  if (LIVE) return `Card gateway is live (${PROVIDER}).`;
  if (TEST_GATEWAY) {
    return 'Stitch is connected with TEST keys, so card is hidden from real customers (cash only). '
      + 'Demo accounts can rehearse the card checkout. Put the live Stitch keys on Render to switch card on.';
  }
  if (!ENABLED) return 'Off until PAYMENTS_LIVE=true. Cash orders work fully.';
  if (PROVIDER === 'stitch') return `Stitch selected but not configured: ${stitch.missing().join(', ')}. Cash orders work fully.`;
  return 'PayFast selected but has no merchant keys. Cash orders work fully.';
}

module.exports = { createPayment, payfastSignature, statusDetail, cardAvailableFor, LIVE, TEST_GATEWAY, PROVIDER };
