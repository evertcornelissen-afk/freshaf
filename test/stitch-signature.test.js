// Verifies the Stitch (Svix) webhook signature check against Svix's own published test
// vector, then against tampering and replay. Nothing here touches the network or the DB.

// Svix's documented example.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const MSG_ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TIMESTAMP = '1614265330';
const PAYLOAD = '{"test": 2432232314}';
const EXPECTED_SIG = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

process.env.STITCH_WEBHOOK_SECRET = SECRET;
const stitch = require('../server/stitch');

// The vector is from 2021, so freeze the clock inside the replay window.
const realNow = Date.now;
Date.now = () => Number(TIMESTAMP) * 1000;

const headers = (over = {}) => ({
  'svix-id': MSG_ID,
  'svix-timestamp': TIMESTAMP,
  'svix-signature': EXPECTED_SIG,
  ...over,
});

const checks = [];
const check = (name, actual, want) => {
  checks.push(actual === want);
  console.log(`${actual === want ? 'ok  ' : 'FAIL'}  ${name} -> ${actual}`);
};

console.log('signature verification');
check('Svix published vector accepted', stitch.verifyWebhook(PAYLOAD, headers()), true);
check('same payload as a Buffer', stitch.verifyWebhook(Buffer.from(PAYLOAD), headers()), true);
check('tampered body rejected', stitch.verifyWebhook('{"test": 1}', headers()), false);
check('wrong signature rejected',
  stitch.verifyWebhook(PAYLOAD, headers({ 'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })), false);
check('missing headers rejected', stitch.verifyWebhook(PAYLOAD, {}), false);
check('rotation: good signature among several accepted',
  stitch.verifyWebhook(PAYLOAD, headers({ 'svix-signature': `v1,AAAA= ${EXPECTED_SIG}` })), true);

Date.now = realNow;
check('replayed old delivery rejected (clock restored)', stitch.verifyWebhook(PAYLOAD, headers()), false);

console.log('\npayload parsing (Stitch Express payment.paid)');
// Shape taken from the Event Catalog in the Stitch Express dashboard. Note there is no
// merchantReference on it: the order is matched by linkId, not by anything in here.
const paid = {
  amount: 37600,
  id: '5A26F599-A473-4672-A232-2171483F999A',
  linkId: 'DjbyqE',
  status: 'PAID',
  type: 'LINK',
};
const a = stitch.readPaymentEvent(paid);
check('paid -> paid true', a.paid, true);
check('paid -> linkId carried', a.linkId, 'DjbyqE');
check('paid -> amount stays in CENTS', a.amountCents, 37600);
check('settled -> paid true', stitch.readPaymentEvent({ ...paid, status: 'SETTLED' }).paid, true);
check('unknown status -> paid false', stitch.readPaymentEvent({ ...paid, status: 'EXPIRED' }).paid, false);
check('no id -> null', stitch.readPaymentEvent({ status: 'PAID' }), null);
check('unrelated shape -> null', stitch.readPaymentEvent({ hello: 'world' }), null);

console.log('\nreference round-trip');
check('merchantReference for order 4821', stitch.merchantReference(4821), 'FRESHAF-4821');
check('reference parses back', stitch.orderIdFromReference('FRESHAF-4821'), 4821);
check('foreign reference rejected', stitch.orderIdFromReference('ORDER-4821'), null);

console.log('\nreturn URL');
// A trailing slash on the registered URL never matches, so never produce one.
check('no trailing slash', stitch.returnUrl('https://freshaf.io/'), 'https://freshaf.io/payment-complete');
check('payerName falls back when too short', stitch.payerName({ name: 'Al' }), 'FreshAF Customer');
check('payerPhone normalises to E.164', stitch.payerPhone({ phone: '078 299 1050' }), '+27782991050');

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
if (passed !== checks.length) process.exitCode = 1;
