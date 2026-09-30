// The entry chunk carries English only; each other language is its own chunk
// (vite.config.ts, i18nLanguageChunks). One value import of translations.ts —
// or of appContent.ts, which imports it — from code the entry reaches puts
// all six languages back. Types are free; values are not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
/* The two modules allowed to hold every language: the source itself, and the
   App Content editor's model (reached only from its lazy admin route). */
const ALLOWED = new Set(['src/i18n/translations.ts', 'src/i18n/appContent.ts', 'src/pages/admin/AppContentPage.tsx']);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p, out); } else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

test('no runtime module value-imports every language', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*import\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
      const [, what, from] = m;
      if (!/i18n\/(translations|appContent)(\.ts)?$|^\.\/(translations|appContent)(\.ts)?$/.test(from)) continue;
      // `import { type A, type B } from …` is types only.
      const names = what.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      if (names.every((n) => n.startsWith('type '))) continue;
      offenders.push(`${rel}: import ${what} from '${from}'`);
    }
  }
  assert.deepEqual(offenders, [], 'use @/i18n/bundles or @/i18n/locales instead');
});

test('the runtime reads languages through the bundle registry, and renders after the visitor\'s language', () => {
  const ctx = readFileSync(join(SRC, 'contexts/LanguageContext.tsx'), 'utf8');
  assert.match(ctx, /from '@\/i18n\/bundles'/);
  const bundles = readFileSync(join(SRC, 'i18n/bundles.ts'), 'utf8');
  for (const l of ['ka', 'ru', 'tr', 'ar', 'he']) {
    assert.match(bundles, new RegExp(`${l}: \\(\\) => import\\('virtual:homatch-i18n/${l}'\\)`), `${l} is its own chunk`);
  }
  assert.match(bundles, /^import en from 'virtual:homatch-i18n\/en';$/m, 'English is in the entry');
  const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
  assert.match(main, /preloadLanguage\(\)\.then\(\(\) => \{\s*createRoot\(/, 'the first render waits for the language');
  const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
  assert.match(vite, /i18nLanguageChunks\(\),/, 'the plugin is registered');
});
