/*
 * EVERY NAMED IMPORT AN EDGE FUNCTION MAKES MUST EXIST.
 *
 * 2026-10-29: verify-synthesis imported `deterministicAdvertisingAssessment`
 * from src/verify/developerAds.ts, which did not export it. `check:edge` only
 * parses and resolves paths, the type check does not cover supabase/functions,
 * and the deploy uploaded the bundle: the function then failed to BOOT in
 * production (SyntaxError, HTTP 503) and every Verify report stopped at
 * synthesis. A green deploy is not proof that a function boots.
 *
 * This walks the relative import graph of every deployed edge function and
 * checks each named import against the exports of the module it names
 * (export function/const/let/class/interface/type/enum, export { a as b },
 * export * from ... followed recursively). A missing name fails here, before
 * anything is deployed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FN_DIR = path.join(ROOT, 'supabase/functions');

const read = (f) => fs.readFileSync(f, 'utf8');
/* Whole-line comments only: a block-comment regex would also eat glob strings such
   as 'src/**' and hide real exports. */
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return undefined;
}

const exportCache = new Map();
function exportsOf(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = stripComments(read(file));
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  if (/export\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(file, m[1]);
    if (target) for (const n of exportsOf(target, seen)) names.add(n);
  }
  exportCache.set(file, names);
  return names;
}

function namedImports(file) {
  const src = stripComments(read(file));
  const out = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((p) => p.trim()).filter(Boolean)
      .filter((p) => !p.startsWith('type '))
      .map((p) => p.split(/\s+as\s+/)[0].trim());
    out.push({ spec: m[2], names });
  }
  for (const m of src.matchAll(/(?:import|export)\s+[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ spec: m[1] ?? m[2], names: [] });
  }
  return out;
}

const fnEntries = fs.readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => path.join(FN_DIR, d.name, 'index.ts'))
  .filter((f) => fs.existsSync(f));

test('every named import of every edge function exists in the module it names', () => {
  assert.ok(fnEntries.length > 50, `found ${fnEntries.length} edge functions`);
  const missing = [];
  const visited = new Set();
  const queue = [...fnEntries];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const { spec, names } of namedImports(file)) {
      const target = resolveSpec(file, spec);
      if (target === null) continue; // npm:, jsr:, https: and bare specifiers are the bundler's
      if (target === undefined) { missing.push(`${path.relative(ROOT, file)}: cannot resolve ${spec}`); continue; }
      const exported = exportsOf(target);
      for (const n of names) {
        if (!exported.has(n)) missing.push(`${path.relative(ROOT, file)}: '${n}' is not exported by ${path.relative(ROOT, target)}`);
      }
      queue.push(target);
    }
  }
  assert.deepEqual(missing, [], `edge functions would fail to boot:\n${missing.join('\n')}`);
});

test('the checker catches the failure that took Verify down', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(path.join(ROOT, 'node_modules', '..')), '.edge-import-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'lib.ts'), 'export function present() { return 1; }\n');
    fs.writeFileSync(path.join(dir, 'fn.ts'), "import { present, absent } from './lib.ts';\n");
    const target = resolveSpec(path.join(dir, 'fn.ts'), './lib.ts');
    const names = namedImports(path.join(dir, 'fn.ts'))[0].names;
    assert.deepEqual(names.filter((n) => !exportsOf(target).has(n)), ['absent']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
