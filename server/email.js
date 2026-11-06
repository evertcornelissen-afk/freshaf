// Standing rule (Evert, 7 Nov 2026): emails are NEVER case-sensitive anywhere in FreshAF.
// Every email that comes in (sign-up, sign-in, reset, admin import, ADMIN_EMAIL) goes
// through normEmail before it is stored or looked up, and stored emails are lower-case.
// The users.email column is also COLLATE NOCASE, and db.js keeps a unique index on
// lower(email), so "Evert@..." and "evert@..." can never be two accounts.
function normEmail(e) {
  return String(e == null ? '' : e).trim().toLowerCase();
}

module.exports = { normEmail };
