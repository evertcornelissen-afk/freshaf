// Encryption at rest for the personal information FreshAF is legally responsible for.
//
// What this protects and why it is not optional. A pro's onboarding gives us their South
// African ID number and their bank account number. Under POPIA both are personal
// information and FreshAF is the responsible party. Until now they sat in the SQLite
// file as plain text, which means a leaked database, a mislaid laptop, or one of the
// backups now written to a Desktop folder would expose every pro's identity and banking
// details in a form anyone can read with a free tool.
//
// AES-256-GCM, which authenticates as well as encrypts: a tampered value fails to
// decrypt rather than returning quietly wrong data. Node's built-in crypto, so no new
// dependency on a machine that cannot build native modules.
//
// Deliberately NOT encrypted: names, emails, phone numbers, addresses. They are personal
// information too, but every one of them is needed in a WHERE clause or shown on a
// dispatch screen many times a minute. Encrypting them would break lookups entirely and
// buy little, because an attacker holding the database file already has the orders those
// addresses belong to. The honest boundary is: encrypt what is dangerous on its own.
const crypto = require('crypto');

const PREFIX = 'v1:';
const ALGO = 'aes-256-gcm';

function loadKey() {
  const raw = process.env.DATA_KEY || '';
  if (!raw) return null;
  let key;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  if (key.length !== 32) return null;
  return key;
}

const KEY = loadKey();

function isConfigured() {
  return Boolean(KEY);
}

// Why this is a warning and not a crash: refusing to boot would take a live business
// offline over a key that only matters for new sign-ups. Refusing silently would be
// worse. So it is loud, and it is on the readiness panel.
if (!KEY) {
  if (process.env.DATA_KEY) {
    console.error('[FreshAF] DATA_KEY is set but is not 32 bytes of base64 — ID and bank '
      + 'numbers will be stored UNENCRYPTED. Generate one with: '
      + 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  } else {
    console.warn('[FreshAF] DATA_KEY is not set — ID numbers and bank details will be '
      + 'stored UNENCRYPTED. See SECRETS.md.');
  }
}

function encryptField(value) {
  if (value == null || value === '') return value;
  const text = String(value);
  if (!KEY) return text;              // stored plain; migrate() picks it up once a key exists
  if (text.startsWith(PREFIX)) return text; // already encrypted, never double-wrap
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

function decryptField(stored) {
  if (stored == null || stored === '') return stored;
  const text = String(stored);
  if (!text.startsWith(PREFIX)) return text; // written before the key existed
  if (!KEY) return null;                     // cannot read it; say so rather than guess
  try {
    const [ivB, tagB, ctB] = text.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return decipher.update(Buffer.from(ctB, 'base64'), undefined, 'utf8') + decipher.final('utf8');
  } catch {
    // Wrong key, or the value was tampered with. Both must look like failure, not data.
    return null;
  }
}

// An ID or account number is almost never needed in full. Showing the last four is
// enough for an admin to match a record against a document, and leaks far less if a
// screen is shoulder-surfed or screenshotted into a support thread.
function maskTail(value, keep = 4) {
  const plain = decryptField(value);
  if (plain == null) return null;
  const s = String(plain);
  if (s.length <= keep) return '•'.repeat(s.length);
  return '•'.repeat(Math.min(s.length - keep, 8)) + s.slice(-keep);
}

const ENCRYPTED_COLUMNS = ['id_number', 'bank_account', 'bank_branch'];

// Encrypt anything written before a key existed. Runs on boot, does nothing once clean,
// and is safe to run repeatedly because encryptField skips values already wrapped.
function migrate(db) {
  if (!KEY) return { migrated: 0, skipped: true };
  const rows = db.prepare(`SELECT user_id, ${ENCRYPTED_COLUMNS.join(', ')} FROM suppliers`).all();
  let migrated = 0;
  for (const row of rows) {
    const updates = [];
    const values = [];
    for (const col of ENCRYPTED_COLUMNS) {
      const v = row[col];
      if (v != null && v !== '' && !String(v).startsWith(PREFIX)) {
        updates.push(`${col} = ?`);
        values.push(encryptField(v));
      }
    }
    if (updates.length) {
      db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE user_id = ?`).run(...values, row.user_id);
      migrated++;
    }
  }
  if (migrated) console.log(`[FreshAF] Encrypted ID and bank details for ${migrated} supplier(s).`);
  return { migrated, skipped: false };
}

module.exports = { isConfigured, encryptField, decryptField, maskTail, migrate, ENCRYPTED_COLUMNS };
