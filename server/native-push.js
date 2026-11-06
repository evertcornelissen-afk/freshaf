// Native push for the iOS and Android apps.
//
// Web Push (server/push.js) does not work inside an app: an iOS app has no service worker
// to receive it. The apps instead register with Apple (APNs) or Google (Firebase Cloud
// Messaging), hand their device token to us, and we send through those services directly.
// No SDK is used for either: APNs is one HTTP/2 request signed with a JWT, and FCM is one
// HTTPS request with an OAuth token minted from a service account. Fewer dependencies,
// nothing that phones home.
//
// Each platform switches on by itself once its credentials are set on the server, and the
// apps ask the server first (GET /api/push/native-config), so a phone is never asked for
// notification permission that we cannot yet honour.
//
//   iOS      APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY (the .p8 file's contents, or base64 of it)
//            APNS_BUNDLE_ID defaults to io.freshaf.app
//   Android  FCM_SERVICE_ACCOUNT (the Firebase service-account JSON, or base64 of it)
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'io.freshaf.app';
// TestFlight and App Store builds use Apple's production service; a build run straight
// from Xcode uses the sandbox. A token only works against the one it came from, so we try
// production first, fall back to the sandbox on BadDeviceToken, and remember the answer.
const APNS_HOSTS = {
  production: process.env.APNS_HOST || 'https://api.push.apple.com',
  sandbox: process.env.APNS_SANDBOX_HOST || 'https://api.sandbox.push.apple.com',
};
const FCM_TOKEN_URL = process.env.FCM_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const FCM_BASE = process.env.FCM_BASE || 'https://fcm.googleapis.com';

// Accepts a secret pasted as-is, or base64 of it. JSON is returned untouched: a Firebase
// service-account file carries its private key with literal "\n" escapes, and turning those
// into real line breaks makes the JSON invalid, which silently switched Android push off.
// The JSON parser unescapes them itself. A bare PEM pasted on one line gets its "\n"s
// restored, since environment-variable fields often flatten line breaks.
function decodeSecret(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (v.startsWith('{')) return v;
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  try {
    const d = Buffer.from(v, 'base64').toString('utf8').trim();
    return d.startsWith('{') ? d : d.replace(/\\n/g, '\n');
  } catch { return ''; }
}

const APNS_KEY = decodeSecret(process.env.APNS_KEY);
const APNS_KEY_ID = (process.env.APNS_KEY_ID || '').trim();
const APNS_TEAM_ID = (process.env.APNS_TEAM_ID || '').trim();

let FCM = null;
try {
  const raw = decodeSecret(process.env.FCM_SERVICE_ACCOUNT);
  if (raw) {
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key && j.project_id) FCM = j;
  }
} catch {
  console.error('[FreshAF][push] FCM_SERVICE_ACCOUNT is set but is not valid service-account JSON');
}

function configured() {
  return {
    ios: !!(APNS_KEY && APNS_KEY_ID && APNS_TEAM_ID),
    android: !!FCM,
  };
}

/* ---------- device registry ---------- */

const TOKEN_RE = /^[A-Za-z0-9:_\-.]{20,4096}$/;

// One token belongs to one account at a time. A phone that changes hands, or where a
// different person signs in, moves the token to the new account: the previous owner's
// job alerts must never arrive on someone else's phone.
function register(userId, platform, token) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Unknown platform');
  if (!TOKEN_RE.test(String(token || ''))) throw new Error('That is not a push token');
  db.prepare(`INSERT INTO device_tokens (user_id, platform, token) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
      last_seen_at = datetime('now')`).run(userId, platform, token);
}

function unregister(userId, token) {
  return db.prepare('DELETE FROM device_tokens WHERE user_id = ? AND token = ?').run(userId, String(token || '')).changes;
}

function forgetUser(userId) {
  db.prepare('DELETE FROM device_tokens WHERE user_id = ?').run(userId);
}

const drop = (id) => db.prepare('DELETE FROM device_tokens WHERE id = ?').run(id);

/* ---------- APNs ---------- */

let apnsJwt = null;
let apnsJwtAt = 0;
function apnsToken() {
  // Apple accepts a provider token for an hour and rejects one refreshed too often, so it
  // is reused for fifty minutes.
  const now = Math.floor(Date.now() / 1000);
  if (!apnsJwt || now - apnsJwtAt > 50 * 60) {
    apnsJwt = jwt.sign({ iss: APNS_TEAM_ID, iat: now }, APNS_KEY,
      { algorithm: 'ES256', header: { alg: 'ES256', kid: APNS_KEY_ID }, noTimestamp: true });
    apnsJwtAt = now;
  }
  return apnsJwt;
}

const sessions = {};
function session(env) {
  const s = sessions[env];
  if (s && !s.closed && !s.destroyed) return s;
  const fresh = http2.connect(APNS_HOSTS[env]);
  fresh.on('error', () => { delete sessions[env]; });
  fresh.on('close', () => { delete sessions[env]; });
  fresh.setTimeout(5 * 60_000, () => fresh.close());
  sessions[env] = fresh;
  return fresh;
}

function apnsSend(env, token, payload) {
  return new Promise((resolve) => {
    let req;
    try {
      req = session(env).request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${apnsToken()}`,
        'apns-topic': BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // A job offer is worthless after its window closes; do not deliver it late.
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 120),
        'content-type': 'application/json',
      });
    } catch (e) {
      resolve({ status: 0, reason: e.message });
      return;
    }
    let status = 0;
    let body = '';
    req.setTimeout(10_000, () => { req.close(); resolve({ status: 0, reason: 'timeout' }); });
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let reason = '';
      try { reason = JSON.parse(body).reason || ''; } catch {}
      resolve({ status, reason });
    });
    req.on('error', (e) => resolve({ status: 0, reason: e.message }));
    req.end(JSON.stringify({
      aps: {
        alert: { title: payload.title || 'FreshAF', body: payload.body || '' },
        sound: 'default',
        'thread-id': payload.tag || 'freshaf',
      },
      url: payload.url || null,
    }));
  });
}

async function sendIos(row, payload) {
  const first = row.apns_env || 'production';
  let r = await apnsSend(first, row.token, payload);
  if (r.status === 400 && r.reason === 'BadDeviceToken' && !row.apns_env) {
    r = await apnsSend('sandbox', row.token, payload);
    if (r.status === 200) db.prepare("UPDATE device_tokens SET apns_env = 'sandbox' WHERE id = ?").run(row.id);
  } else if (r.status === 200 && !row.apns_env) {
    db.prepare("UPDATE device_tokens SET apns_env = 'production' WHERE id = ?").run(row.id);
  }
  // 410: the app was uninstalled or notifications switched off. BadDeviceToken after both
  // environments: the token is not ours to use. Either way, stop sending to it.
  if (r.status === 410 || (r.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(r.reason))) {
    drop(row.id);
  } else if (r.status !== 200) {
    console.warn(`[FreshAF][push] APNs ${r.status} ${r.reason}`);
  }
  return r.status === 200;
}

/* ---------- FCM ---------- */

let fcmAccess = null;
let fcmAccessExp = 0;
async function fcmToken() {
  const now = Math.floor(Date.now() / 1000);
  if (fcmAccess && now < fcmAccessExp - 120) return fcmAccess;
  const assertion = jwt.sign({
    iss: FCM.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: FCM_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }, FCM.private_key, { algorithm: 'RS256' });
  const r = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`FCM sign-in failed (${r.status})`);
  fcmAccess = j.access_token;
  fcmAccessExp = now + Number(j.expires_in || 3600);
  return fcmAccess;
}

async function sendAndroid(row, payload) {
  let r;
  try {
    r = await fetch(`${FCM_BASE}/v1/projects/${FCM.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await fcmToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          notification: { title: payload.title || 'FreshAF', body: payload.body || '' },
          data: { url: String(payload.url || ''), tag: String(payload.tag || '') },
          android: {
            priority: 'HIGH',
            ttl: '120s',
            notification: { tag: payload.tag || 'freshaf', sound: 'default' },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`[FreshAF][push] FCM request failed: ${e.message}`);
    return false;
  }
  if (r.ok) return true;
  const j = await r.json().catch(() => ({}));
  const code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status || '';
  if (r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
    drop(row.id);
    console.warn(`[FreshAF][push] FCM ${r.status} ${code}: Android token for user ${row.user_id} dropped`);
  } else console.warn(`[FreshAF][push] FCM ${r.status} ${code}`);
  return false;
}

/* ---------- entry point ---------- */

async function sendToUser(userId, payload) {
  const on = configured();
  if (!on.ios && !on.android) return 0;
  const rows = db.prepare('SELECT * FROM device_tokens WHERE user_id = ?').all(userId);
  let sent = 0;
  for (const row of rows) {
    try {
      if (row.platform === 'ios' && on.ios) sent += (await sendIos(row, payload)) ? 1 : 0;
      else if (row.platform === 'android' && on.android) sent += (await sendAndroid(row, payload)) ? 1 : 0;
    } catch (e) {
      console.warn(`[FreshAF][push] ${row.platform} send failed: ${e.message}`);
    }
  }
  if (rows.length) console.log(`[FreshAF][push] "${payload.title || ''}" -> user ${userId}: ${sent}/${rows.length} phone(s) accepted`);
  return sent;
}

const c = configured();
console.log(`[FreshAF][push] native: iOS ${c.ios ? 'ON' : 'off (APNS_* not set)'}, Android ${c.android ? 'ON' : 'off (FCM_SERVICE_ACCOUNT not set)'}`);

module.exports = { configured, register, unregister, forgetUser, sendToUser };
