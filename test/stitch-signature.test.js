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

console.log('\npayload parsing');
const completed = {
  data: { client: { paymentInitiationRequests: { node: {
    __typename: 'PaymentInitiationRequest',
    id: 'cGF5cmVxLzk2YjUyODU1',
    externalReference: '4821',
    amount: { currency: 'ZAR', quantity: '376.00' },
    state: { __typename: 'PaymentInitiationRequestCompleted' },
  } } } },
};
const cancelled = JSON.parse(JSON.stringify(completed));
cancelled.data.client.paymentInitiationRequests.node.state.__typename = 'PaymentInitiationRequestCancelled';

const a = stitch.readPaymentEvent(completed);
check('completed -> orderId 4821', a.orderId, 4821);
check('completed -> paid true', a.paid, true);
check('cancelled -> paid false', stitch.readPaymentEvent(cancelled).paid, false);
check('unrelated shape -> null', stitch.readPaymentEvent({ hello: 'world' }), null);

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
if (passed !== checks.length) process.exitCode = 1;
