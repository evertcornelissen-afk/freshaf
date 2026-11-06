// Web Push for provider job alerts. VAPID keys are generated once and persisted,
// so subscriptions survive restarts.
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const KEYS_FILE = path.join(__dirname, '..', 'data', 'vapid.json');

let keys;
if (fs.existsSync(KEYS_FILE)) {
  keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
} else {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys));
}
webpush.setVapidDetails('mailto:admin@freshaf.io', keys.publicKey, keys.privateKey);

function publicKey() { return keys.publicKey; }

function subscribe(userId, subscription) {
  if (!subscription?.endpoint) throw new Error('Invalid subscription');
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription`)
    .run(userId, subscription.endpoint, JSON.stringify(subscription));
}

async function sendToUser(userId, payload) {
  // The apps first: a Pro with the app installed is the case that matters most, and a
  // slow web-push endpoint must not hold up the alert to their phone.
  require('./native-push').sendToUser(userId, payload)
    .catch((e) => console.warn(`[FreshAF][push] native send failed: ${e.message}`));
  const rows = db.prepare('SELECT id, subscription FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  // priority: a job the pro must act on. Sent with high urgency, so a phone in battery saver
  // still wakes for it, and it stays on screen until tapped (see sw.js). ttl: how long the
  // push service keeps trying a phone that is offline — long for a booking (still worth
  // knowing an hour later), short for an offer that expires in a minute.
  const options = {
    TTL: Number.isFinite(payload.ttl) ? payload.ttl : 120,
    urgency: payload.priority ? 'high' : 'normal',
  };
  for (const row of rows) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), body, options);
    } catch (e) {
      // 404/410 = subscription expired or revoked — clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      }
    }
  }
}

module.exports = { publicKey, subscribe, sendToUser };
