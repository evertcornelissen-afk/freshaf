// Security headers, including a Content-Security-Policy that is actually strict.
//
// The awkward part of a strict CSP on a static-file app is the inline <script> blocks:
// every page has at least one, and express.static cannot inject a per-request nonce into
// a file it is streaming off disk. The usual shortcut is script-src 'unsafe-inline',
// which switches the protection off and leaves the header as decoration.
//
// Instead this hashes every inline script at boot and lists the hashes in the policy.
// That gives a real policy with no build step and no templating, and it cannot drift:
// edit a page and the hash is recomputed on the next restart. If a page is edited and
// NOT restarted, that page's inline script stops running — loudly, in the console, which
// is the right failure direction for a security control.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Matches <script> blocks with no src attribute. Deliberately narrow: a block with a src
// is an external script and is governed by the source list below, not by a hash.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function hashInlineScripts(dir) {
  const hashes = new Set();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  } catch {
    return hashes; // no public dir is a different problem, and index.js will surface it
  }
  for (const file of files) {
    let html;
    try {
      html = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    for (const m of html.matchAll(INLINE_SCRIPT)) {
      // The browser hashes the element's exact text content, byte for byte. No trimming.
      const digest = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
      hashes.add(`'sha256-${digest}'`);
    }
  }
  return hashes;
}

/**
 * Builds the security-header middleware.
 * @param {string} publicDir the directory whose HTML holds the inline scripts
 */
function securityHeaders(publicDir) {
  const scriptHashes = [...hashInlineScripts(publicDir)];

  const policy = [
    "default-src 'self'",
    // Leaflet is the only third-party script. Named explicitly rather than allowing
    // https:, so a future injected <script src> to anywhere else is still refused.
    `script-src 'self' https://unpkg.com ${scriptHashes.join(' ')}`,
    // Styles keep 'unsafe-inline': Leaflet and the map markers set element styles
    // directly, and hashing cannot cover a style attribute. An injected stylesheet is a
    // far smaller prize than injected script, so this is a deliberate, bounded trade.
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // data: for the inline SVG icons, blob: for photo previews before upload,
    // tile.openstreetmap.org for the map itself.
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
    // Everything the browser calls is same-origin: the geocoder, Google Places and
    // Stitch are all reached from the server, never from the page.
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // No <form> posts anywhere but here. The Stitch hand-off is a navigation, not a
    // form submit, so it is unaffected.
    "form-action 'self'",
    // Belt and braces with X-Frame-Options, which older browsers use instead.
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  return function headers(req, res, next) {
    res.set('Content-Security-Policy', policy);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The app asks for location and notifications; nothing else should be reachable,
    // and an injected iframe or script inherits this.
    res.set('Permissions-Policy',
      'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), gyroscope=()');
    // Only meaningful over HTTPS; Render terminates TLS, so this reaches real browsers.
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

module.exports = { securityHeaders, hashInlineScripts };
