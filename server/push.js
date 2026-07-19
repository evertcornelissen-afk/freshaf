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
webpush.setVapidDetails('mailto:support@freshaf.co.za', keys.publicKey, keys.privateKey);

function publicKey() { return keys.publicKey; }

function subscribe(userId, subscription) {
  if (!subscription?.endpoint) throw new Error('Invalid subscription');
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription`)
    .run(userId, subscription.endpoint, JSON.stringify(subscription));
}

async function sendToUser(userId, payload) {
  const rows = db.prepare('SELECT id, subscription FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  for (const row of rows) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), body, { TTL: 120 });
    } catch (e) {
      // 404/410 = subscription expired or revoked — clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      }
    }
  }
}

module.exports = { publicKey, subscribe, sendToUser };
