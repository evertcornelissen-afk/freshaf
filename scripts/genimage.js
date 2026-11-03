#!/usr/bin/env node
// Generate images through Pollinations.
//
//   node scripts/genimage.js scripts/prompts/icons.json
//   node scripts/genimage.js scripts/prompts/photos.json --force
//
// Why this provider: it needs no account, no API key and no SDK. It is one HTTPS GET.
// That matters more than image quality here — there is no credential to leak, nothing
// installed, nothing to be billed for, and nothing new that can break the build.
//
// A spec file is a JSON array of { file, prompt, width, height, seed, model }.
// Existing files are skipped unless --force, so re-running is cheap and only fills gaps.
const fs = require('fs');
const path = require('path');

const BASE = 'https://image.pollinations.ai/prompt/';
const args = process.argv.slice(2);
const SPEC = args.find((a) => !a.startsWith('--'));
const FORCE = args.includes('--force');

if (!SPEC) {
  console.error('Usage: node scripts/genimage.js <spec.json> [--force]');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const outDir = path.resolve(path.dirname(SPEC), spec.outDir || '.');
const items = spec.images || spec;
const defaults = spec.defaults || {};

function url(it) {
  const q = new URLSearchParams({
    width: String(it.width || defaults.width || 1024),
    height: String(it.height || defaults.height || 1024),
    model: it.model || defaults.model || 'flux',
    seed: String(it.seed ?? defaults.seed ?? 1),
    nologo: 'true',
    // Let the prompt stand as written; the "enhance" rewrite drifts away from a brief.
    enhance: 'false',
  });
  const prompt = [it.prompt, it.negative ? `. Avoid: ${it.negative}` : '', defaults.suffix || '']
    .filter(Boolean).join(' ');
  return `${BASE}${encodeURIComponent(prompt)}?${q}`;
}

// A JPEG that is really an error page opens as nothing. Check the magic bytes.
function looksLikeImage(buf) {
  if (buf.length < 1024) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  return jpg || png;
}

async function one(it, attempt = 1) {
  const dest = path.join(outDir, it.file);
  if (!FORCE && fs.existsSync(dest)) {
    console.log(`  skip  ${it.file} (exists)`);
    return true;
  }
  try {
    const r = await fetch(url(it), { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!looksLikeImage(buf)) throw new Error(`got ${buf.length} bytes that are not an image`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    console.log(`  ok    ${it.file}  ${(buf.length / 1024).toFixed(0)} KB`);
    return true;
  } catch (e) {
    if (attempt < 3) {
      console.log(`  retry ${it.file} (${e.message})`);
      await new Promise((r) => setTimeout(r, 2500 * attempt));
      return one(it, attempt + 1);
    }
    console.error(`  FAIL  ${it.file}: ${e.message}`);
    return false;
  }
}

(async () => {
  console.log(`\n${items.length} image(s) -> ${outDir}\n`);
  let ok = 0;
  // Sequential on purpose: the service is free and shared, and hammering it in parallel
  // is how a free service stops being available.
  for (const it of items) if (await one(it)) ok++;
  console.log(`\n${ok}/${items.length} done\n`);
  if (ok !== items.length) process.exitCode = 1;
})();
