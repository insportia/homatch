#!/usr/bin/env node
/*
 * Splice the copy overhaul (scripts/stab-copy-i18n-data.mjs) into src/i18n/translations.ts, and
 * write the same values into whichever data script owns each key, so re-running that script can
 * never put the old copy back. Re-running this script is a no-op.
 *
 * STAB_COPY_STRINGS replaces whole keys in all six bundles (overwrite: these keys are meant to
 * change). STAB_COPY_KA replaces the Georgian value only.
 *
 * Owner scripts: every scripts/*.mjs that defines `key: [en, ka, ru, tr, ar, he]` or
 * `key: { en, ka, ... }` with literal values. An array is rewritten only when its script order is
 * confirmed by the scripts of its values (Georgian second, Cyrillic third, Arabic fifth, Hebrew
 * sixth); anything this script cannot prove is listed, never guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAB_COPY_KA, STAB_COPY_STRINGS } from './stab-copy-i18n-data.mjs';
import { LANGS, literal, splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'stab-copy-i18n';
const SELF = new Set(['stab-copy-i18n-data.mjs', 'stab-copy-i18n-apply.mjs']);

const HOLE = /\{\{\s*(\w+)\s*\}\}/g;
const holes = (v) => [...String(v).matchAll(HOLE)].map((m) => m[1]).sort().join(',');

/* ── Checks before a byte is written ── */
const problems = validate(STAB_COPY_STRINGS, TAG);
for (const [key, values] of Object.entries(STAB_COPY_STRINGS)) {
  if (key.endsWith('_e1029')) continue; // archived legal wording is kept exactly as published
  values.forEach((v, i) => { if (/[—]/.test(v)) problems.push(`[${TAG}] FATAL: ${key}[${LANGS[i]}] uses an em dash`); });
}
const source0 = fs.readFileSync(FILE, 'utf8');
const enStart = source0.indexOf('const en = {');
const enBody = source0.slice(enStart, source0.indexOf('\n};', enStart));
for (const key of Object.keys(STAB_COPY_KA)) if (key in STAB_COPY_STRINGS) problems.push(`[${TAG}] FATAL: ${key} is in both STAB_COPY_STRINGS and STAB_COPY_KA`);
for (const [key, value] of Object.entries(STAB_COPY_KA)) {
  const m = enBody.match(new RegExp(`^  ${key}: ((['"\`]).*\\2),$`, 'm'));
  if (!m) { problems.push(`[${TAG}] FATAL: ${key} has no English value`); continue; }
  const en = Function(`return ${m[1]}`)();
  if (holes(en) !== holes(value)) problems.push(`[${TAG}] FATAL: ${key} (ka) placeholders [${holes(value)}] differ from English [${holes(en)}]`);
  if (!value.trim()) problems.push(`[${TAG}] FATAL: ${key} (ka) is empty`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

/* ── The bundle ── */
const r = splice(FILE, STAB_COPY_STRINGS, { banner: 'COPY OVERHAUL (subscriptions, Verify states, legal 2026-10-30; owner 2026-10-30)', overwrite: true, tag: TAG });
let source = fs.readFileSync(FILE, 'utf8');
const kaOpener = 'const ka: Partial<Record<TranslationKey, string>> = {';
const kaStart = source.indexOf(kaOpener);
const kaEnd = source.indexOf('\n};', kaStart);
let kaBody = source.slice(kaStart, kaEnd);
let kaChanged = 0;
let kaMissing = 0;
for (const [key, value] of Object.entries(STAB_COPY_KA)) {
  const next = `  ${key}: ${literal(value)},`;
  const line = new RegExp(`^  ${key}: .*,$`, 'm');
  const found = kaBody.match(line);
  if (!found) { kaBody += `\n  ${key}: ${literal(value)},`; kaMissing += 1; continue; }
  if (found[0] === next) continue;
  kaBody = kaBody.replace(line, () => next);
  kaChanged += 1;
}
source = source.slice(0, kaStart) + kaBody + source.slice(kaEnd);
fs.writeFileSync(FILE, source, 'utf8');
console.log(`[${TAG}] bundle: ${r.added} added, ${r.replaced} replaced, ${r.unchanged} unchanged; ka-only ${kaChanged} replaced, ${kaMissing} added.`);

/* ── Owner data scripts ── */
const SCRIPT = { 1: /[ა-ჿ]/, 2: /[Ѐ-ӿ]/, 4: /[؀-ۿ]/, 5: /[֐-׿]/ };

/** The end index (exclusive) of the JS literal starting at `i`, or -1. Strings, arrays, objects. */
function literalEnd(src, i) {
  const open = src[i];
  if (open === "'" || open === '"' || open === '`') {
    for (let j = i + 1; j < src.length; j += 1) {
      if (src[j] === '\\') { j += 1; continue; }
      if (open === '`' && src[j] === '$' && src[j + 1] === '{') return -1;
      if (src[j] === open) return j + 1;
    }
    return -1;
  }
  if (open !== '[' && open !== '{') return -1;
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { const e = literalEnd(src, j); if (e < 0) return -1; j = e - 1; continue; }
    if (c === '/' && src[j + 1] === '/') { const nl = src.indexOf('\n', j); j = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
    if (c === '[' || c === '{') depth += 1;
    if (c === ']' || c === '}') { depth -= 1; if (depth === 0) return j + 1; }
  }
  return -1;
}

const wanted = new Map();
for (const [k, v] of Object.entries(STAB_COPY_STRINGS)) wanted.set(k, { full: v });
for (const [k, v] of Object.entries(STAB_COPY_KA)) wanted.set(k, { ...(wanted.get(k) ?? {}), ka: v });

const unpatched = [];
let patchedKeys = 0;
const touchedFiles = new Set();
for (const f of fs.readdirSync(here).filter((n) => n.endsWith('.mjs') && !SELF.has(n))) {
  const file = path.join(here, f);
  let src = fs.readFileSync(file, 'utf8');
  if (!/i18n|copy|COPY|STRINGS/.test(src)) continue;
  let changed = false;
  for (const [key, want] of wanted) {
    if (!src.includes(key)) continue;
    const re = new RegExp(`(^|\\n)([ \\t]*)(['"]?)${key}\\3\\s*:\\s*`, 'g');
    const edits = [];
    for (const m of src.matchAll(re)) {
      const start = m.index + m[0].length;
      const end = literalEnd(src, start);
      if (end < 0) { unpatched.push(`${f}: ${key} (not a literal)`); continue; }
      let value;
      try { value = Function(`return (${src.slice(start, end)})`)(); } catch { unpatched.push(`${f}: ${key} (unparseable)`); continue; }
      let next = null;
      if (Array.isArray(value) && value.length === 6 && value.every((x) => typeof x === 'string')) {
        /* Each slot may carry only its own script; at least one must carry it (brand-only rows like
           'VIP' prove nothing and are left alone unless another slot proves the order). */
        const slots = Object.entries(SCRIPT);
        const foreign = slots.some(([i]) => slots.some(([j, sc]) => j !== i && sc.test(value[i])));
        const proven = slots.some(([i, sc]) => sc.test(value[i]));
        if (foreign || !proven) { unpatched.push(`${f}: ${key} (array order not provable)`); continue; }
        const vals = want.full ? [...want.full] : [...value];
        if (want.ka) vals[1] = want.ka;
        if (vals.every((x, i) => x === value[i])) continue;
        next = `[${vals.map(literal).join(', ')}]`;
      } else if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ka === 'string') {
        const obj = { ...value };
        if (want.full) LANGS.forEach((l, i) => { if (l in obj || i === 0) obj[l] = want.full[i]; });
        if (want.ka) obj.ka = want.ka;
        if (Object.keys(obj).every((l) => obj[l] === value[l])) continue;
        next = `{ ${Object.entries(obj).map(([l, v]) => `${l}: ${literal(v)}`).join(', ')} }`;
      } else if (typeof value === 'string') {
        continue; // a lone string is not a locale entry (e.g. an English-only fixture)
      } else {
        unpatched.push(`${f}: ${key} (unknown shape)`);
        continue;
      }
      edits.push([start, end, next]);
    }
    for (const [s, e, n] of edits.sort((a, b) => b[0] - a[0])) { src = src.slice(0, s) + n + src.slice(e); changed = true; }
    if (edits.length) patchedKeys += 1;
  }
  if (changed) { fs.writeFileSync(file, src, 'utf8'); touchedFiles.add(f); }
}
console.log(`[${TAG}] owner scripts: ${patchedKeys} key definition(s) rewritten in ${touchedFiles.size} file(s).`);
if (unpatched.length) {
  console.log(`[${TAG}] not rewritten (left as they are; the bundle is still updated):`);
  for (const u of unpatched) console.log(`  ${u}`);
}
