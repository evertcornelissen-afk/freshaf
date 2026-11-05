// Tests the three controls added for app-store readiness and basic safety:
// rate limiting, the Content-Security-Policy, and the rest of the security headers.
//
// These are worth a test precisely because they fail silently. A CSP typo does not throw;
// it just stops protecting, and the app keeps working so nobody notices. A limiter wired
// to the wrong route does not throw either. Both only show up when someone is attacking.
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 5759;
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const checks = [];
  const check = (name, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    checks.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${JSON.stringify(actual)}`);
  };

  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch(`${BASE}/api/pricing`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }

    // ---- security headers -------------------------------------------------
    const home = await fetch(`${BASE}/`);
    const csp = home.headers.get('content-security-policy') || '';

    check('CSP is sent', csp.length > 0, true);
    check("CSP default-src is 'self'", csp.includes("default-src 'self'"), true);
    check('CSP forbids framing', csp.includes("frame-ancestors 'none'"), true);
    check("CSP forbids plugins", csp.includes("object-src 'none'"), true);
    // The whole point of hashing inline scripts is to avoid this. If a future change
    // reintroduces it, the policy is decoration and this test says so.
    check("script-src does NOT allow 'unsafe-inline'",
      /script-src[^;]*'unsafe-inline'/.test(csp), false);
    // Every page has an inline <script>; if hashing silently produced nothing, the app
    // would break in a browser but still pass a naive "is the header present" check.
    check('inline scripts are hashed into script-src',
      (csp.match(/'sha256-/g) || []).length > 0, true);
    check('nosniff is set', home.headers.get('x-content-type-options'), 'nosniff');
    check('framing denied', home.headers.get('x-frame-options'), 'DENY');
    check('referrer policy set', home.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    check('permissions policy disables microphone',
      (home.headers.get('permissions-policy') || '').includes('microphone=()'), true);

    // ---- rate limiting ----------------------------------------------------
    const login = (email, password) => fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // Per-account limiter: 10 per 15 min. Attempt 11 against the SAME address must be
    // refused, which is the brute-force case.
    const victim = `victim-${Date.now()}@example.test`;
    let statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await login(victim, `guess${i}`)).status);
    check('first 10 attempts reach the password check', statuses.slice(0, 10).every((s) => s === 401), true);
    check('attempt 11 is rate limited', statuses[10], 429);
    check('attempt 12 is still rate limited', statuses[11], 429);

    const blocked = await login(victim, 'guess');
    check('429 carries Retry-After', Number(blocked.headers.get('retry-after')) > 0, true);
    check('429 carries RateLimit-Remaining 0', blocked.headers.get('ratelimit-remaining'), '0');
    const body = await blocked.json();
    check('429 explains itself in plain language', /too many/i.test(body.error || ''), true);

    // A DIFFERENT account from the same address must still work until the address budget
    // (20) is spent. Without this, locking one account would lock the whole household.
    const other = `other-${Date.now()}@example.test`;
    check('a different account is not collaterally blocked', (await login(other, 'x')).status, 401);

    // Registration is limited separately, so exhausting login must not close signup.
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'customer' }), // deliberately invalid
    });
    check('register uses its own budget, not login\'s', reg.status !== 429, true);

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
    if (passed !== checks.length) {
      console.log('\n--- server log ---\n' + log.slice(-1500));
      process.exitCode = 1;
    }
  } finally {
    server.kill();
  }
})();
