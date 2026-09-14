import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * AN EXCLUSION IS AN ARGUMENT, NOT AN ESCAPE HATCH.
 *
 * Site Studio's coverage is measured against the rendered page, so a string
 * nobody can edit is a miss — unless somebody declared, on the element, why
 * it must stay that way. That declaration is the one thing in the system that
 * can turn a failure into a pass, which makes it the one thing worth
 * defending.
 *
 * Three defences, and this file is all three:
 *
 *   The vocabulary is closed, and the two places that name it — the runtime
 *   in content.tsx and the measuring script — must name the same six. They
 *   are separate files because the script runs in node with no bundler, and
 *   two lists that drift produce a reason the page claims and the report does
 *   not recognise.
 *
 *   Nothing writes the attribute by hand. useNotEditable takes a typed
 *   reason, so a typo is a compile error; a raw `data-hm-exclude="..."` in
 *   JSX would sail past the compiler and past the report.
 *
 *   The count stays small enough to read. Not a style rule: the moment
 *   exclusions outnumber what a person will actually check, "100% editable"
 *   goes back to meaning nothing.
 */

const CONTENT = readFileSync('src/site/content.tsx', 'utf8');
const SCRIPT = readFileSync('scripts/studio-coverage.mjs', 'utf8');

/** The reasons as the application declares them. */
function runtimeReasons() {
  const block = CONTENT.match(/export const EXCLUSION_REASONS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'EXCLUSION_REASONS is no longer declared in src/site/content.tsx');
  return [...block[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
}

/** The reasons as the coverage script will accept them. */
function scriptReasons() {
  const block = SCRIPT.match(/const REASONS = \[([\s\S]*?)\];/);
  assert.ok(block, 'the coverage script no longer declares its reason list');
  return [...block[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
}

test('the six reasons are the six reasons, in both places', () => {
  const runtime = runtimeReasons();
  assert.deepEqual(runtime.slice().sort(), [
    'ACCESSIBILITY_ONLY', 'DYNAMIC_DATA', 'NOT_CUSTOMER_VISIBLE',
    'SECURITY_SENSITIVE', 'STRUCTURAL_SYMBOL', 'SYSTEM_GENERATED',
  ], 'the exclusion vocabulary changed — that is a decision, not a refactor');
  assert.deepEqual(scriptReasons().slice().sort(), runtime.slice().sort(),
    'the coverage script and the runtime disagree about what a valid reason is');
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('nothing writes the exclusion attribute by hand', () => {
  const offenders = [];
  for (const file of walk('src')) {
    /* content.tsx is where the attribute is produced; everywhere else must
       go through useNotEditable, whose argument the compiler checks. */
    if (file.replace(/\\/g, '/').endsWith('src/site/content.tsx')) continue;
    if (/data-hm-exclude\s*=/.test(readFileSync(file, 'utf8'))) {
      offenders.push(file.replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(offenders, [],
    `these set data-hm-exclude directly, so their reason is never type-checked:\n${offenders.join('\n')}`);
});

test('the reasons an admin is actually given are few enough to audit', () => {
  const calls = [...walk('src')
    .map(f => readFileSync(f, 'utf8'))
    .join('\n')
    .matchAll(/notEditable\('([A-Z_]+)'\)/g)].map(m => m[1]);

  for (const reason of calls) {
    assert.ok(runtimeReasons().includes(reason), `"${reason}" is not one of the six`);
  }
  /*
   * Twelve call sites, not twelve strings: one element can cover a control
   * that renders several. The real number the report prints is smaller. This
   * is a tripwire for the drift where exclusion becomes the easy answer —
   * raise it deliberately, with the reason in the commit.
   */
  assert.ok(calls.length <= 12,
    `${calls.length} exclusions declared; coverage is being bought rather than earned`);
});
