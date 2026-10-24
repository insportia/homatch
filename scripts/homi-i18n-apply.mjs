#!/usr/bin/env node
/*
 * Splice the HOMI workstream copy into src/i18n/translations.ts.
 *
 * Two passes through the shared applier (lib/i18nSplice.mjs, which checks
 * placeholder parity, untranslated non-Latin bundles and collisions):
 *   1. new keys, added only where absent;
 *   2. the HOMI rename, which deliberately replaces the "Homatch AI" copy of a
 *      small, named set of existing keys.
 * Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOMI_STRINGS as HOMI_CORE_STRINGS, HOMI_REBRAND_STRINGS as HOMI_CORE_REBRAND } from './homi-i18n-data.mjs';
import { HOMI_MORTGAGE_STRINGS } from './homi-mortgage-i18n-data.mjs';
import { HOMI_INVESTMENT_STRINGS, HOMI_INVESTMENT_REWRITES } from './homi-investment-i18n-data.mjs';
import { HOMI_EXPAT_STRINGS, HOMI_EXPAT_KA_FIXES } from './homi-expat-i18n-data.mjs';
import { HOMI_MORTGAGE2_STRINGS } from './homi-mortgage2-i18n-data.mjs';
import { HOMI_CONTRACT_STRINGS } from './homi-contract-i18n-data.mjs';
import { HOMI_NOTIFY_STRINGS, HOMI_NOTIFY_KA_FIXES } from './homi-notify-i18n-data.mjs';
import fs from 'node:fs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'homi-i18n';

/* A Georgian-only fix keeps the other five languages exactly as they are in the bundle. */
function kaOnly(fixes) {
  const src = fs.readFileSync(FILE, 'utf8');
  const openers = ['const en = {', ...['ka', 'ru', 'tr', 'ar', 'he'].map((l) => `const ${l}: Partial<Record<TranslationKey, string>> = {`)];
  const bodies = openers.map((o) => {
    const a = src.indexOf(o);
    if (a < 0) throw new Error(`bundle opener not found: ${o}`);
    return src.slice(a, src.indexOf('\n};', a));
  });
  const unquote = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
  const out = {};
  for (const [key, ka] of Object.entries(fixes)) {
    const re = new RegExp(`^\\s*${key}: '((?:[^'\\\\]|\\\\.)*)',?\\s*$`, 'm');
    const vals = bodies.map((b) => { const m = b.match(re); return m ? unquote(m[1]) : null; });
    if (vals.some((v) => v === null)) throw new Error(`${key}: not present in every bundle`);
    vals[1] = ka;
    out[key] = vals;
  }
  return out;
}
const HOMI_REBRAND_STRINGS = { ...HOMI_CORE_REBRAND, ...HOMI_INVESTMENT_REWRITES, ...kaOnly(HOMI_EXPAT_KA_FIXES), ...kaOnly(HOMI_NOTIFY_KA_FIXES) };
const HOMI_STRINGS = { ...HOMI_CORE_STRINGS, ...HOMI_MORTGAGE_STRINGS, ...HOMI_INVESTMENT_STRINGS, ...HOMI_EXPAT_STRINGS, ...HOMI_MORTGAGE2_STRINGS, ...HOMI_CONTRACT_STRINGS, ...HOMI_NOTIFY_STRINGS };

const problems = [...validate(HOMI_STRINGS, TAG), ...validate(HOMI_REBRAND_STRINGS, `${TAG}-rebrand`)];
for (const key of Object.keys(HOMI_REBRAND_STRINGS)) {
  if (key in HOMI_STRINGS) problems.push(`${key} is both new and a rebrand`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const added = splice(FILE, HOMI_STRINGS, { banner: 'HOMI ASSISTANT', overwrite: true }); // all keys are this workstream's own
const renamed = splice(FILE, HOMI_REBRAND_STRINGS, { banner: 'HOMI ASSISTANT (rename)', overwrite: true });
console.log(`[${TAG}] new: ${added.added} added, ${added.unchanged} unchanged; rename: ${renamed.replaced} replaced, ${renamed.added} added, ${renamed.unchanged} unchanged.`);
