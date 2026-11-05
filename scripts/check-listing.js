#!/usr/bin/env node
// Checks APP-STORE-LISTING.md against Apple's field limits, so a paste into App Store
// Connect is never refused for being a few characters over.
//   node scripts/check-listing.js
const fs = require('fs');
const path = require('path');

const md = fs.readFileSync(path.join(__dirname, '..', 'APP-STORE-LISTING.md'), 'utf8');

function row(label) {
  // A table row like: | **Name** (max 30) | FreshAF: Car Wash & Laundry |
  const m = new RegExp(String.raw`\|\s*\*\*${label}\*\*[^|]*\|\s*([^|]+?)\s*\|`).exec(md);
  return m ? m[1] : null;
}
function section(heading) {
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const body = md.slice(md.indexOf('\n', start) + 1);
  const end = body.search(/\n(## |---)/);
  return (end < 0 ? body : body.slice(0, end)).trim();
}

const checks = [
  ['Name', row('Name'), 30],
  ['Subtitle', row('Subtitle'), 30],
  ['Promotional text', section('Promotional text'), 170],
  ['Keywords', section('Keywords'), 100],
  ['Description', section('Description'), 4000],
  ['Review notes', section('App Review notes'), 4000],
];

let bad = 0;
for (const [name, value, max] of checks) {
  if (value == null) { console.log(`MISSING  ${name}`); bad++; continue; }
  // Apple counts characters, not bytes.
  const n = [...value].length;
  const okay = n <= max;
  if (!okay) bad++;
  console.log(`${okay ? 'ok      ' : 'TOO LONG'} ${name.padEnd(17)} ${String(n).padStart(4)} / ${max}`);
}
const kw = section('Keywords') || '';
if (/,\s/.test(kw)) { console.log('FIX      Keywords: no spaces after commas (they count against the 100)'); bad++; }
process.exit(bad ? 1 : 0);
