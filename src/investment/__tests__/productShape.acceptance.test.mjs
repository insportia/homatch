// What Investment Intelligence is, and what it is not allowed to become.
//
// This file is a guard, not a unit test. Every assertion here corresponds
// to a product decision that a future change could quietly undo while every
// other gate stayed green:
//
//   IT IS NOT A CHAT PRODUCT. No message list, no composer, no "send". The
//   workspace is a structured form and a result. A redesign that reached
//   for a text box as the fastest way to collect something would put the
//   chat back one field at a time.
//
//   IT NEVER SPEAKS ITS OWN INTERNAL VOCABULARY TO A CUSTOMER. Not "the
//   AI", not "the engine", not "the provider", not "research core", not
//   "unavailable". An investor reads about their property and their money.
//
//   IT WORKS WITH NOTHING BEHIND IT. Every strategy produces its full
//   answer from arithmetic in the browser. Nothing on the path from a click
//   to a number touches the network.
//
//   THERE IS ONE ENGINE AND ONE MARKET LANE. No strategy carries a private
//   copy of a mortgage, a yield, or a way of asking what things cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) { walk(child, out); continue; }
    if (/\.(ts|tsx)$/.test(entry.name) && !child.includes('__tests__')) out.push(child);
  }
  return out;
}

const PRODUCT_FILES = [
  ...walk('src/components/investment'),
  ...walk('src/investment'),
  'src/pages/InvestmentPage.tsx',
];

/* ── Not a chat product ──────────────────────────────────────────── */

test('the chat panel is gone and has not come back under another name', () => {
  assert.ok(!exists('src/components/investment/ConsultantPanel.tsx'));
  for (const file of PRODUCT_FILES) {
    const src = read(file);
    assert.ok(!/\bmessages\s*[:=]/.test(src), `${file} keeps a message list`);
    assert.ok(!/<textarea/i.test(src), `${file} has a free-text composer`);
    assert.ok(!/role:\s*'(user|assistant)'/.test(src), `${file} carries chat turns`);
  }
});

test('the entry screen is the four strategies, not a prompt', () => {
  const page = read('src/pages/InvestmentPage.tsx');
  assert.ok(page.includes('StrategyHome'), 'the home is the strategy chooser');
  assert.ok(!page.includes('ConsultantPanel'));
  const home = read('src/components/investment/StrategyHome.tsx');
  assert.ok(home.includes('STRATEGY_ORDER'), 'the home renders the strategy table');
});

test('nothing in the product calls the conversational endpoint', () => {
  for (const file of PRODUCT_FILES) {
    assert.ok(
      !read(file).includes('investment-consultant'),
      `${file} still invokes the conversational endpoint`,
    );
  }
});

/* ── No internal vocabulary reaches the customer ─────────────────── */

const FORBIDDEN = [
  [/\bAI\b/, 'AI'],
  [/artificial intelligence/i, 'artificial intelligence'],
  [/\bthe model\b/i, 'the model'],
  [/model call/i, 'model call'],
  [/consultant/i, 'consultant'],
  [/\bchat\b/i, 'chat'],
  [/edge function/i, 'edge function'],
  [/\bprovider\b/i, 'provider'],
  [/research.core/i, 'research core'],
  [/deterministic/i, 'deterministic'],
  [/calculation engine/i, 'calculation engine'],
  [/\bengine\b/i, 'engine'],
  [/\bfallback\b/i, 'fallback'],
  [/\bAPI\b/, 'API'],
  [/rate limit/i, 'rate limit'],
  [/\brobots\b/i, 'robots'],
  [/\bcrawl/i, 'crawl'],
  [/\bsweep\b/i, 'sweep'],
  [/\bendpoint\b/i, 'endpoint'],
  [/\bunavailable\b/i, 'unavailable'],
  [/\btechnical\b/i, 'technical'],
];

/** Every investment string in the English bundle, key -> value. */
function englishInvestmentStrings() {
  const raw = read('src/i18n/translations.ts');
  const start = raw.indexOf('const en = {');
  const body = raw.slice(start, raw.indexOf('\n};', start));
  const out = [];
  for (const m of body.matchAll(/^\s+(inv_[A-Za-z0-9_]+): '((?:[^'\\]|\\.)*)',$/gm)) {
    out.push([m[1], m[2]]);
  }
  return out;
}

test('every customer-facing investment string exists', () => {
  assert.ok(englishInvestmentStrings().length > 500, 'the bundle was not parsed');
});

test('no customer-facing investment string speaks the product\'s own plumbing', () => {
  const offenders = [];
  for (const [key, value] of englishInvestmentStrings()) {
    for (const [re, word] of FORBIDDEN) {
      if (re.test(value)) { offenders.push(`${key} says "${word}"`); break; }
    }
  }
  assert.deepEqual(offenders, [], `internal vocabulary is on screen:\n  ${offenders.join('\n  ')}`);
});

test('the retired chat-era strings are not shipped in any language', () => {
  const raw = read('src/i18n/translations.ts');
  for (const prefix of ['inv_consultant_', 'inv_composer_', 'inv_entry_', 'inv_snap_']) {
    assert.ok(!raw.includes(`  ${prefix}`), `${prefix}* is still in the bundle`);
  }
});

/* ── Usable with nothing behind it ───────────────────────────────── */

test('no calculation reaches for the network', () => {
  for (const file of walk('src/investment')) {
    const src = read(file);
    assert.ok(!/\bfetch\s*\(/.test(src), `${file} performs a request`);
    assert.ok(!src.includes('supabase'), `${file} reaches for the database`);
  }
});

test('the result views render from the model alone', () => {
  for (const file of walk('src/components/investment/results')) {
    const src = read(file);
    assert.ok(!/\bfetch\s*\(/.test(src), `${file} performs a request`);
    assert.ok(!/useEffect/.test(src), `${file} has a side effect`);
  }
});

/* ── One engine, one market lane ─────────────────────────────────── */

test('nothing outside src/mortgage computes a mortgage payment', () => {
  for (const file of walk('src/investment')) {
    if (file.endsWith('leverage.ts')) continue;
    const src = read(file);
    assert.ok(!/Math\.pow\(1 \+ /.test(src), `${file} looks like a second amortisation`);
  }
});

test('the market lane is the one that already existed', () => {
  const session = read('src/components/investment/useInvestmentSession.ts');
  const calls = [...session.matchAll(/functions\.invoke\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['investment-research'], 'a second market path appeared');
  assert.ok(!exists('src/investment/research'), 'a second research system appeared');
});

test('every strategy is described by the one table, with no code of its own', () => {
  const definitions = read('src/investment/strategies/definitions.ts');
  for (const id of ['RENOVATE_RESELL', 'CONSTRUCTION_RESALE', 'RENTAL_INVESTMENT', 'INVESTMENT_VALUE']) {
    assert.ok(definitions.includes(`${id}:`), `${id} is missing from the strategy table`);
  }
  /*
   * Exactly two files branch on the strategy, and they answer two
   * different questions: run.ts picks the calculator, summary.ts picks the
   * six labels its answer wears. A third would mean a component had
   * started deciding something about a strategy on its own, which is how
   * four products drift apart one `if` at a time.
   */
  const deciders = PRODUCT_FILES.filter((f) => /case 'CONSTRUCTION_RESALE'/.test(read(f)));
  assert.deepEqual(deciders, [
    'src/investment/strategies/run.ts',
    'src/investment/strategies/summary.ts',
  ]);
});

/* ── Click-first ─────────────────────────────────────────────────── */

test('almost every question is answered by clicking, not typing', () => {
  const definitions = read('src/investment/strategies/definitions.ts');
  const controls = [...definitions.matchAll(/control: '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(controls.length > 40, 'the strategy table was not parsed');
  const typed = controls.filter((c) => c === 'text').length;
  assert.ok(
    typed / controls.length < 0.05,
    `${typed} of ${controls.length} fields are free text; this product is click-first`,
  );
});

test('there is no Calculate button, because there is nothing to submit', () => {
  for (const file of PRODUCT_FILES) {
    const src = read(file);
    assert.ok(!/type="submit"/.test(src), `${file} has a submit control`);
    assert.ok(!/inv_calculate/.test(src), `${file} has a Calculate action`);
  }
});

test('a market figure and an illustration never wear the same label', () => {
  // The vocabulary moved to src/components/workspace/sources.ts when Home
  // Financing needed the same badges, and Investment's controls.tsx became
  // a re-export. The guarantee is unchanged — five distinct sources, five
  // distinct labels — so the test follows the code rather than pinning it.
  assert.ok(
    read('src/components/investment/controls.tsx').includes('@/components/workspace/controls'),
    'Investment no longer shares the workspace controls',
  );
  const sources = read('src/components/workspace/sources.ts');
  for (const kind of ['MARKET', 'CALCULATED', 'CONVENTION', 'EXAMPLE', 'USER']) {
    assert.ok(sources.includes(kind), `the ${kind} source has no badge of its own`);
  }
  const labels = new Set();
  for (const [key, value] of englishInvestmentStrings()) {
    if (!/^inv_src_/.test(key)) continue;
    assert.ok(!labels.has(value), `two sources share the label "${value}"`);
    labels.add(value);
  }
  assert.equal(labels.size, 5);
});
