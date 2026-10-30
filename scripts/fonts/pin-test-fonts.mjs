#!/usr/bin/env node
/*
 * Pins the production web fonts for the browser tests (tests/mobile/fonts).
 *
 * Production loads Inter, Manrope and Noto Sans Georgian / Hebrew / Arabic
 * from the Google Fonts stylesheet in src/index.css. The mobile tests stub the
 * network, so without these copies no web font ever loads and every width
 * measurement is taken in whatever system font the machine happens to have
 * (Segoe UI on Windows, DejaVu/Noto on a Linux runner): two machines measure
 * two different layouts and neither is the one customers see.
 *
 *   node scripts/fonts/pin-test-fonts.mjs          fetch the stylesheet + every file it names, write MANIFEST.json
 *   node scripts/fonts/pin-test-fonts.mjs --check  verify the pinned files against MANIFEST.json and src/index.css (no network)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'tests', 'mobile', 'fonts');
// Google serves woff2 with unicode-range subsets only to a modern browser user agent.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function productionStylesheetUrl() {
  const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
  const m = /@import url\('(https:\/\/fonts\.googleapis\.com\/css2\?[^']+)'\)/.exec(css);
  if (!m) throw new Error('src/index.css no longer imports a Google Fonts stylesheet');
  return m[1];
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const filesOf = (css) => [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];

async function pin() {
  const url = productionStylesheetUrl();
  const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
  if (!css.includes('@font-face')) throw new Error('the stylesheet answer has no @font-face');
  mkdirSync(join(DIR, 'google'), { recursive: true });
  writeFileSync(join(DIR, 'google', 'css2.css'), css);
  const files = {};
  for (const u of filesOf(css)) {
    const rel = u.replace('https://fonts.gstatic.com/', '');
    const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
    mkdirSync(dirname(join(DIR, 'google', rel)), { recursive: true });
    writeFileSync(join(DIR, 'google', rel), buf);
    files[rel] = { bytes: buf.length, sha256: sha(buf) };
  }
  const manifest = { source: url, userAgent: UA, fetchedAt: new Date().toISOString().slice(0, 10), stylesheetSha256: sha(Buffer.from(css)), files };
  writeFileSync(join(DIR, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`pinned ${Object.keys(files).length} files from ${url}`);
}

export function checkPinned() {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(DIR, 'MANIFEST.json'), 'utf8'));
  if (manifest.source !== productionStylesheetUrl()) problems.push('src/index.css loads a different stylesheet than the pinned one: run node scripts/fonts/pin-test-fonts.mjs');
  const css = readFileSync(join(DIR, 'google', 'css2.css'));
  if (sha(css) !== manifest.stylesheetSha256) problems.push('google/css2.css differs from MANIFEST.json');
  for (const u of filesOf(css.toString())) {
    const rel = u.replace('https://fonts.gstatic.com/', '');
    const f = join(DIR, 'google', rel);
    if (!existsSync(f)) { problems.push(`missing ${rel}`); continue; }
    if (sha(readFileSync(f)) !== manifest.files[rel]?.sha256) problems.push(`hash mismatch ${rel}`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const p = checkPinned();
    if (p.length) { console.error(p.join('\n')); process.exit(1); }
    console.log('pinned test fonts match MANIFEST.json and src/index.css');
  } else {
    await pin();
  }
}
