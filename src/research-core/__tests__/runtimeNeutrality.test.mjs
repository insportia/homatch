// The Research Core has to run in three places: a Deno Edge Function, the
// Node test runner, and the Vite build's type-check. Nothing enforces that at
// runtime until the deploy, and a `node:crypto` import that slips in here does
// not fail the frontend build or the unit suite — it fails the edge function,
// in production, on the first request.
//
// So it is enforced here, by reading every file in the directory.
//
// The other four rules are checked the same way and for the same reason: each
// of them is invisible until the exact moment it costs something.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'research-core');

function sourceFiles(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      sourceFiles(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles();
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => file.slice(ROOT.length + 1).replace(/\\/g, '/');

/** Strip comments so a rule cannot be broken by a sentence describing it. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Balanced-paren extraction, because a regex cannot match nested types. */
function constructorParameterLists(text) {
  const lists = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('constructor(', from);
    if (at === -1) return lists;
    let depth = 0;
    let end = -1;
    for (let i = at + 'constructor'.length; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return lists;
    lists.push(text.slice(at + 'constructor('.length, end));
    from = end + 1;
  }
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if ('([{<'.includes(c)) depth += 1;
    if (')]}>'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

test('the directory is not empty — a passing scan of nothing proves nothing', () => {
  assert.ok(FILES.length > 30, `only ${FILES.length} source files found`);
});

test('no file imports a Node built-in', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/from\s+['"]node:/.test(body),
      `${rel(file)} imports a node: module, which does not exist in a Deno Edge Function`,
    );
    // Only a CommonJS module load counts. `require(id: ProfileId)` is a
    // perfectly ordinary method name and is not what this rule is about.
    assert.ok(!/\brequire\s*\(\s*['"]/.test(body), `${rel(file)} uses require('…')`);
  }
});

test('no file reaches for a runtime-specific global', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(!/\bprocess\.(env|stderr|stdout|argv)\b/.test(body), `${rel(file)} uses process.*`);
    assert.ok(!/\bDeno\./.test(body), `${rel(file)} uses Deno.*`);
    assert.ok(!/\bBuffer\b/.test(body), `${rel(file)} uses Buffer`);
    assert.ok(!/\b__dirname\b|\b__filename\b/.test(body), `${rel(file)} uses CommonJS globals`);
  }
});

test('no file uses TypeScript syntax that Node cannot strip', () => {
  // Node runs .ts in strip-only mode: it deletes types and executes the rest.
  // Anything that EMITS code — a parameter property, an enum, a namespace, a
  // decorator — is a hard load error. This is not a style rule; a single
  // `constructor(private readonly x: T)` makes every test that imports the
  // file fail to load, which is how it was found.
  for (const file of FILES) {
    const body = code(read(file));
    for (const params of constructorParameterLists(body)) {
      for (const param of splitTopLevel(params)) {
        // A parameter property is a modifier at the START of a parameter.
        // `profiles: readonly ResearchProfile[]` puts `readonly` after the
        // colon and is an ordinary readonly array type, not a field.
        assert.ok(
          !/^\s*(private|public|protected)\s/.test(param) &&
            !/^\s*readonly\s+[A-Za-z_$][\w$]*\s*\??\s*:/.test(param),
          `${rel(file)} uses a constructor parameter property: "${param.trim()}"`,
        );
      }
    }
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(body), `${rel(file)} declares an enum`);
    assert.ok(!/^\s*(export\s+)?namespace\s/m.test(body), `${rel(file)} declares a namespace`);
    assert.ok(!/^\s*@[A-Za-z]/m.test(body), `${rel(file)} uses a decorator`);
  }
});

// A raw control character in source is invisible in every editor and every
// diff, and for a separator used in cache and dedupe keys a dropped one would
// merge two things that are not the same. There is no check for it here
// because src/verify/__tests__/sourceHygiene.test.mjs already walks the whole
// of src/ for exactly that, research-core included, and a second copy of a
// working gate is one more thing to keep in step.

test('the core holds no database client', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/supabase-js|createClient\s*\(/.test(body),
      `${rel(file)} reaches for Supabase; persistence belongs behind a port`,
    );
    assert.ok(
      !/\bfrom\s*\(\s*['"](research_jobs|research_cache|intelligence_|cost_events|usage_events)/.test(body),
      `${rel(file)} names a table directly`,
    );
  }
});

test('the core contains no price, rate or currency conversion constant', () => {
  // A rate here would be a second answer to a question provider_price_book
  // already answers with an effective date attached.
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/\b(costPerUnit|pricePerToken|USD_PER|RATE_USD|EXCHANGE_RATE|FX_RATE)\b/.test(body),
      `${rel(file)} appears to hold a rate constant`,
    );
  }
});

test('every relative import carries an explicit .ts extension', () => {
  // Deno resolves no extensions. An import that works under the bundler and
  // not under Deno is the exact failure this whole file exists to prevent.
  for (const file of FILES) {
    const body = read(file);
    const specifiers = [...body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      assert.ok(
        specifier.endsWith('.ts'),
        `${rel(file)} imports "${specifier}" without a .ts extension`,
      );
    }
  }
});

test('the core is consumed only through its deliberate integration points', () => {
  /*
   * This assertion used to read "nothing outside the core imports it yet",
   * which was right while the core was vendored and unwired. It is now wired
   * into Verify deliberately, so the property worth guarding has changed: the
   * core must be reached from a SMALL, NAMED set of seams, not from wherever
   * a feature happened to need a helper.
   *
   * The distinction matters because the core's value is that it is runtime
   * neutral and has one way in. A component importing a fetch primitive
   * directly would bypass the network policy, the rate limits and the cost
   * accounting, and nothing would notice until production.
   *
   * Adding a seam here is meant to be a deliberate edit, the same way the old
   * assertion was.
   */
  const ALLOWED = new Set([
    // The Verify market lane and the seed it is built from.
    'src/verify/marketLane.ts',
    'src/verify/researchSeed.ts',
    'src/verify/__tests__/marketLane.test.mjs',
    'src/verify/__tests__/researchSeed.test.mjs',
    // What the lane learned about its sources, written back to the registry.
    'src/verify/sourceHealth.ts',
    'src/verify/__tests__/sourceHealth.test.mjs',
    // The one server that runs research.
    'supabase/functions/research-agent/index.ts',
    /*
     * HOMATCH INVESTMENT INTELLIGENCE — the second consumer, and a
     * deliberate seam rather than an incidental one.
     *
     * lane.ts is the whole of it. It builds a ResearchSeed from an
     * investment consultation, calls discoverComparables for a sale sweep
     * and a rent sweep, and reduces what comes back with the core's OWN
     * pooling, dedupe and independence functions. It implements no
     * statistic, no cache, no fetch path and no source registry; it does
     * not touch HttpClient, NetworkPolicy or any flow-control primitive
     * directly. Every one of those reaches it through createPortalRuntime,
     * which is the same single door Verify's market lane goes through.
     *
     * The edge function is listed for one reason: it calls
     * createPortalRuntime to build that door. It holds no research logic.
     *
     * If a component ever appears in this list, that is the signal the seam
     * has stopped being a seam.
     */
    'src/investment/evidence/lane.ts',
    'supabase/functions/investment-research/index.ts',
  ]);

  const roots = ['src', 'supabase/functions', 'official-worker/src'];
  const offenders = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry === 'research-core') continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry)) continue;
      /*
       * AN IMPORT, NOT A MENTION.
       *
       * This used to test the raw file text for the string "research-core",
       * which flags any file that so much as NAMES the core in a comment —
       * including a test whose entire subject is explaining which files are
       * allowed to reach it. Prose is not a dependency, and a guard that
       * cannot tell the difference teaches people to stop writing the
       * comment rather than to stop writing the import.
       *
       * Comments are stripped and only a real module specifier counts, so
       * the check now means what its name says. Everything in ALLOWED is
       * still caught: each one genuinely imports.
       */
      const body = code(readFileSync(full, 'utf8'));
      const importsCore =
        /(?:from|import)\s*\(?\s*['"][^'"]*research-core\/[^'"]*['"]/.test(body);
      if (!importsCore) continue;
      // rel() is relative to the CORE; these files are outside it, so the
      // comparison is made against the repository root instead.
      const relative = full
        .slice(process.cwd().length + 1)
        .split(String.fromCharCode(92))
        .join('/');
      if (!ALLOWED.has(relative)) offenders.push(relative);
    }
  };

  for (const root of roots) walk(join(process.cwd(), root));
  assert.deepEqual(
    offenders,
    [],
    `research-core reached from outside its integration seams: ${offenders.join(', ')}`,
  );
});

test('the public surface exports the bridge, not a second research system', () => {
  const index = read(join(ROOT, 'index.ts'));
  // Things that must be reachable.
  for (const name of ['toEvidenceItem', 'toActualUsage', 'budgetFor', 'documentFingerprint']) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `index.ts does not export ${name}`);
  }
  // Things that must NOT exist at all.
  for (const forbidden of ['EvidenceRecord', 'RESEARCH_SCHEMA_SQL', 'SqlResearchStore', 'DEFAULT_COST_MODEL']) {
    assert.ok(
      !index.includes(forbidden),
      `index.ts exports ${forbidden}, which would duplicate an existing Homatch system`,
    );
  }
});
