// THE INVESTMENT CLOSURE HAS TO LOAD IN A DENO EDGE FUNCTION.
//
// supabase/functions/investment-consultant imports src/investment/calculations
// by relative path, exactly as deal-room-ai imports src/dealroom/domain, and
// the Supabase CLI bundles the whole transitive closure. Deno resolves NO
// extensions: a value import written `from '../types'` works under Vite and
// under Node's resolver and fails at deploy time with a module-not-found that
// no gate in this repository would have caught.
//
// Nothing else checks this. runtimeNeutrality covers src/research-core and
// stops at its own directory; check-edge-functions parses with --noResolve,
// which is what lets it tolerate `jsr:` and URL imports and is also why it
// cannot follow a relative one. So the first thing that would notice is the
// deploy, and the deploy's own comments in .github/workflows/deploy.yml are
// a record of exactly that failure mode happening before.
//
// TYPE IMPORTS ARE EXEMPT, AND THAT IS NOT A LOOPHOLE
//
// `import type { X } from '../types'` is erased before the module is ever
// resolved, so Deno never looks for the file. src/mortgage relies on this —
// amortization.ts and effectiveRate.ts both reach for '../types' without an
// extension, and both are type-only. The distinction is the whole point of
// the check: it must flag a value import and must not flag a type one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Every .ts file under a directory, tests excluded. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const rel = (file) => file.slice(ROOT.length + 1).split('\\').join('/');

/*
 * The closure the two edge functions actually pull in.
 *
 * src/mortgage is in it because the investment engine calls into it for every
 * payment and every amortisation row — deliberately, so the two products
 * cannot disagree — which means a Deno-unsafe import there breaks Investment
 * Intelligence even though /mortgage itself is browser-only.
 */
const FILES = [
  ...sourceFiles(join(ROOT, 'src', 'investment')),
  ...sourceFiles(join(ROOT, 'src', 'mortgage')),
];

test('the closure is not empty — a passing scan of nothing proves nothing', () => {
  assert.ok(FILES.length > 15, `only ${FILES.length} files found`);
});

test('every relative VALUE import in the closure carries an explicit .ts', () => {
  const offenders = [];
  for (const file of FILES) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(/^\s*import\s+([\s\S]*?)\s*from\s*['"](\.[^'"]+)['"]/gm)) {
      const clause = match[1];
      const specifier = match[2];
      // `import type { … }` and `import type X` are erased; Deno never
      // resolves them. A per-specifier `{ type X }` inside a value import is
      // NOT exempt — the module itself is still loaded.
      if (/^type\b/.test(clause.trim())) continue;
      if (!specifier.endsWith('.ts')) {
        offenders.push(`${rel(file)} imports "${specifier}" with no .ts extension`);
      }
    }
    // `export … from` resolves the module too.
    for (const match of body.matchAll(/^\s*export\s+(?!type\b)[\s\S]*?\s*from\s*['"](\.[^'"]+)['"]/gm)) {
      if (!match[1].endsWith('.ts')) {
        offenders.push(`${rel(file)} re-exports "${match[1]}" with no .ts extension`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these would fail to resolve in a Deno Edge Function:\n${offenders.join('\n')}`,
  );
});

test('no file in the closure reaches for a Node built-in or a runtime global', () => {
  for (const file of FILES) {
    const body = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    assert.ok(!/from\s+['"]node:/.test(body), `${rel(file)} imports a node: module`);
    assert.ok(!/\bDeno\./.test(body), `${rel(file)} uses Deno.*`);
    assert.ok(!/\bprocess\.(env|argv|stdout|stderr)\b/.test(body), `${rel(file)} uses process.*`);
    assert.ok(!/\bBuffer\b/.test(body), `${rel(file)} uses Buffer`);
    assert.ok(!/\bdocument\.|\bwindow\./.test(body), `${rel(file)} touches the DOM`);
  }
});

test('no file in the closure uses TypeScript syntax Node cannot strip', () => {
  // Node runs these .ts files in strip-only mode for the unit suite. A
  // parameter property, an enum or a namespace EMITS code and is a hard load
  // error — which would take out every test that imports the file.
  for (const file of FILES) {
    const body = readFileSync(file, 'utf8');
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(body), `${rel(file)} declares an enum`);
    assert.ok(!/^\s*(export\s+)?namespace\s/m.test(body), `${rel(file)} declares a namespace`);
    assert.ok(
      !/constructor\s*\([^)]*\b(private|public|protected|readonly)\s+\w+\s*[:)]/.test(body),
      `${rel(file)} uses a constructor parameter property`,
    );
  }
});

test('the engine imports the mortgage authority rather than reimplementing it', () => {
  // The reason src/mortgage is inside this closure at all. If this stops
  // being true, /investment and /mortgage have two answers for one payment.
  const leverage = readFileSync(join(ROOT, 'src/investment/calculations/leverage.ts'), 'utf8');
  assert.match(leverage, /from '\.\.\/\.\.\/mortgage\/calculations\/amortization\.ts'/);
  assert.match(leverage, /buildAmortizationSchedule/);
  assert.match(leverage, /calculateMortgage/);

  // And nothing under src/investment computes an annuity payment itself.
  for (const file of sourceFiles(join(ROOT, 'src', 'investment'))) {
    const body = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    assert.ok(
      !/Math\.pow\(\s*1\s*\+\s*(monthlyRate|r)\b/.test(body),
      `${rel(file)} looks like a second amortisation formula`,
    );
  }
});
