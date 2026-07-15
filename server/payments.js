// Payment adapter. Production: PayFast (South Africa). Without merchant keys in .env
// it runs in sandbox mode — an internal payment page simulates the redirect flow so
// the whole order lifecycle works end-to-end before you have a merchant account.
const crypto = require('crypto');

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || '';
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || '';
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5757';

const LIVE = Boolean(MERCHANT_ID && MERCHANT_KEY);

function payfastSignature(params, passphrase) {
  const keys = Object.keys(params);
  let str = keys.map((k) => `${k}=${encodeURIComponent(String(params[k]).trim()).replace(/%20/g, '+')}`).join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

// Returns { url } the customer should be redirected to for payment.
function createPayment(order, customer) {
  if (!LIVE) {
    return { url: `/pay/${order.id}`, mode: 'sandbox' };
  }
  const params = {
    merchant_id: MERCHANT_ID,
    merchant_key: MERCHANT_KEY,
    return_url: `${BASE_URL}/?paid=${order.id}`,
    cancel_url: `${BASE_URL}/?cancelled=${order.id}`,
    notify_url: `${BASE_URL}/api/payments/payfast/itn`,
    name_first: customer.name,
    email_address: customer.email,
    m_payment_id: String(order.id),
    amount: ((order.price_cents - (order.points_used_cents || 0)) / 100).toFixed(2),
    item_name: `FreshAF order #${order.id}`,
  };
  const signature = payfastSignature(params, PASSPHRASE);
  const qs = new URLSearchParams({ ...params, signature }).toString();
  return { url: `https://www.payfast.co.za/eng/process?${qs}`, mode: 'live' };
}

module.exports = { createPayment, payfastSignature, LIVE };
