/*
 * Splice copy into src/i18n/translations.ts, whole lines only.
 *
 * WHY THIS IS A SHARED MODULE NOW
 *
 * admin-i18n-apply, conversation-i18n-apply and expat-i18n-apply are the same
 * 160 lines three times, and the checks inside them are the interesting part:
 * placeholder parity with English, a non-Latin bundle that is byte-identical
 * to the English one, and a collision with another workstream's key. Copying
 * them a fourth time means the fourth copy is the one that quietly loses a
 * check. The three existing appliers are deliberately NOT rewritten to use
 * this — they work, and churning files another workstream may have open is
 * the exact failure the collision check exists to prevent.
 *
 * WHY IT ADDS RATHER THAN OVERWRITES
 *
 * If a key already exists with a different value, another workstream got
 * there first. Replacing their string silently is worse than failing, so a
 * collision is reported, the existing value is left alone, and the caller
 * exits non-zero so somebody has to look.
 *
 * WHY THE EMPTINESS CHECK IS ON CODE POINTS
 *
 * A gate written with \b and \w passes over Georgian without matching
 * anything, which this repository has already been bitten by twice.
 */
import fs from 'node:fs';

export const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/** A single-quoted TS literal, with the three things that can break one escaped. */
export function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

const HOLE = /\{\{\s*(\w+)\s*\}\}/g;
const holes = (v) => [...String(v).matchAll(HOLE)].map((m) => m[1]).sort().join(',');

/**
 * Everything that must be true before a byte is written.
 *
 * Returns the problems rather than exiting, so a caller can print them all at
 * once instead of one per run.
 */
export function validate(strings, tag) {
  const problems = [];
  const seen = new Set();

  for (const [key, values] of Object.entries(strings)) {
    if (seen.has(key)) problems.push(`${key} is defined twice`);
    seen.add(key);

    if (!Array.isArray(values) || values.length !== LANGS.length) {
      problems.push(`${key} has ${values?.length} values, expected ${LANGS.length}`);
      continue;
    }

    const expected = holes(values[0]);
    for (let i = 0; i < LANGS.length; i += 1) {
      const value = values[i];
      if (typeof value !== 'string' || value.trim().length === 0) {
        problems.push(`${key} has an empty ${LANGS[i]} value`);
        continue;
      }
      /*
       * t() substitutes {{name}} and nothing else. A single-braced {n} ships
       * its braces to the screen and every gate stays green, so parity is
       * checked against English rather than assumed.
       */
      if (holes(value) !== expected) {
        problems.push(`${key} (${LANGS[i]}) has placeholders [${holes(value)}], English has [${expected}]`);
      }
      /*
       * Georgian, Arabic and Hebrew share no code points with English, so a
       * byte-identical value is almost always a translation somebody forgot.
       * Short Latin-only strings are exempt: a product name legitimately
       * matches. Russian and Turkish are skipped for the same reason.
       */
      if ((LANGS[i] === 'ka' || LANGS[i] === 'ar' || LANGS[i] === 'he') && value === values[0]) {
        if (!/^[\p{Lu}\p{Ll}\s.,'’—–-]*$/u.test(value) || value.length > 24) {
          problems.push(`${key} (${LANGS[i]}) is identical to the English`);
        }
      }
    }
  }

  return problems.map((problem) => `[${tag}] FATAL: ${problem}`);
}

/**
 * Write the strings into every bundle.
 *
 * `banner` heads the block of newly added keys so the file stays readable
 * when six workstreams have appended to it.
 */
export function splice(file, strings, { banner, overwrite = false, tag = 'i18n' } = {}) {
  let source = fs.readFileSync(file, 'utf8');
  const entries = Object.entries(strings);
  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  const collisions = new Set();

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en'
      ? 'const en = {'
      : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) throw new Error(`[${tag}] could not find the ${lang} bundle opener`);
    const end = source.indexOf('\n};', start);
    if (end === -1) throw new Error(`[${tag}] could not find the end of the ${lang} bundle`);

    let body = source.slice(start, end);
    const fresh = [];

    for (const [key, values] of entries) {
      const next = `  ${key}: ${literal(values[langIndex])},`;
      const line = new RegExp(`^  ${key}: .*,$`, 'm');
      const found = body.match(line);
      if (!found) { fresh.push(next); added += 1; continue; }
      if (found[0] === next) { unchanged += 1; continue; }
      if (!overwrite) { collisions.add(key); continue; }
      body = body.replace(line, () => next);
      replaced += 1;
    }

    if (fresh.length) body += `\n\n  /* ── ${banner} ── */\n${fresh.join('\n')}`;
    source = source.slice(0, start) + body + source.slice(end);
  }

  fs.writeFileSync(file, source, 'utf8');
  return { added, replaced, unchanged, collisions: [...collisions], keys: entries.length };
}
