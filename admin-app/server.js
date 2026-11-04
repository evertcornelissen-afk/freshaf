#!/usr/bin/env node
// FreshAF Admin — runs on your own machine, not on freshaf.io.
//
// It serves the dashboard at http://localhost:5858 and forwards every API call to the
// live site over HTTPS, adding the admin key that the public internet does not have.
//
// What this actually buys, stated honestly:
//   - The dashboard is no longer a page on the public site for anyone to find.
//   - ADMIN_API_KEY means a stolen admin password alone opens nothing: an attacker
//     needs the key too, and the key only exists on this machine.
//   - The key never reaches the browser. It is added here, server-side.
// What it does NOT buy: the admin API still exists on the live site. It has to, or this
// could not reach it. The key is the protection, not the hiding.
//
// Moving it to a server later: this is an ordinary Node app with no local state. Deploy
// the folder, set the same two environment variables, and put it behind your own login.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const path = require('path');

const PORT = Number(process.env.ADMIN_PORT || 5858);
const TARGET = (process.env.FRESHAF_URL || 'https://freshaf.io').replace(/\/$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const BIND = process.env.ADMIN_BIND || '127.0.0.1';

const app = express();
app.disable('x-powered-by');

// Everything the dashboard needs that is not an API call is served from here first,
// then falls through to the live site for shared assets (css, images, icons).
app.use(express.static(path.join(__dirname, 'public')));

// What this dashboard is actually reading. The header shows it, because a dashboard
// pointed at the wrong database looks exactly like one pointed at the right database.
app.get('/_admin/target', (req, res) => {
  const live = /^https:\/\/(www\.)?freshaf\.io$/i.test(TARGET);
  res.json({ target: TARGET, live, host: TARGET.replace(/^https?:\/\//, '') });
});

// One hop: browser -> this process -> freshaf.io. Bodies are streamed through as raw
// bytes so uploads (the database restore) and JSON both work without special cases.
app.use(async (req, res) => {
  const url = TARGET + req.originalUrl;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // host must be the target's, and hop-by-hop headers must not be forwarded.
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue;
    headers[k] = v;
  }
  if (ADMIN_API_KEY) headers['x-admin-key'] = ADMIN_API_KEY;

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(300000), // restores can be large
    });

    for (const [k, v] of upstream.headers) {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) continue;
      if (k === 'set-cookie') continue; // handled below
      res.setHeader(k, v);
    }
    // The live site sets a Secure cookie for its own domain. This runs on http://localhost,
    // so strip Secure and Domain or the browser silently discards the session and the
    // dashboard just looks broken after a correct login.
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) {
      res.setHeader('set-cookie', cookies.map((c) =>
        c.split(';').filter((p) => !/^\s*(secure|domain=)/i.test(p)).join(';')));
    }
    res.status(upstream.status);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error(`[admin] ${req.method} ${req.originalUrl} -> ${e.message}`);
    res.status(502).json({ error: `Could not reach ${TARGET}: ${e.message}` });
  }
});

app.listen(PORT, BIND, () => {
  console.log('');
  console.log('  FreshAF Admin');
  console.log(`  Dashboard : http://localhost:${PORT}`);
  console.log(`  Talking to: ${TARGET}`);
  console.log(`  Admin key : ${ADMIN_API_KEY ? 'set' : 'NOT SET — the live site must also have it unset, or every call returns 404'}`);
  console.log(`  Listening on ${BIND} only, so nothing on your network can reach it.`);
  console.log('');
});
