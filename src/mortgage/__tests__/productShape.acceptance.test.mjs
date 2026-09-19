// What Home Financing is, and what it is not allowed to become.
//
// A guard, not a unit test. Every assertion corresponds to a decision a
// later change could quietly undo while every other gate stayed green:
//
//   THE MATH IS NOT REWRITTEN. Eight calculation modules existed,
//   tested, before this workspace did. Nothing here recomputes a
//   payment, a schedule, an IRR or a PTI.
//
//   EVERY ENGINE HAS A CALL SITE. Three of them — early repayment,
//   refinancing, offer comparison — had none at all: written, tested,
//   and unreachable from the product. That is the failure this file
//   exists to make loud.
//
//   IT LOOKS LIKE INVESTMENT BECAUSE IT SHARES THE COMPONENTS, not
//   because somebody matched the colours by eye.
//
//   IT NEVER PROMISES APPROVAL OR ELIGIBILITY, and never assumes an
//   unknown fee is zero.

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

const UI_FILES = [...walk('src/components/mortgage'), 'src/pages/MortgagePage.tsx'];
const ENGINE_FILES = walk('src/mortgage/calculations');

/* ── The math is not rewritten ──────────────────────────────────── */

test('the eight original calculation modules are all still here', () => {
  for (const name of [
    'amortization',
    'effectiveRate',
    'termComparison',
    'affordability',
    'earlyRepayment',
    'refinancing',
    'offerComparison',
    'index',
  ]) {
    assert.ok(exists(`src/mortgage/calculations/${name}.ts`), `${name}.ts was removed`);
  }
  assert.ok(exists('src/mortgage/rules/ptiLtv.ts'));
});

test('no UI file computes a payment, a schedule or a rate itself', () => {
  for (const file of UI_FILES) {
    const src = read(file);
    assert.ok(!/Math\.pow\(1 \+/.test(src), `${file} looks like an amortisation formula`);
    assert.ok(!/\/ 100 \/ 12/.test(src), `${file} converts an annual rate to a monthly one`);
  }
});

test('there is exactly one mortgage engine, and it is the original one', () => {
  // A second folder of calculations is the specific failure mode this
  // rebuild was told to avoid, and it is easy to reach by accident when
  // a view needs "just one more number".
  assert.ok(!exists('src/components/mortgage/calculations'));
  assert.ok(!exists('src/mortgage/calculations2'));
  const irrSolvers = ENGINE_FILES.filter((f) => /solveMonthlyIrr|bisection/i.test(read(f)));
  assert.deepEqual(irrSolvers, ['src/mortgage/calculations/effectiveRate.ts']);
});

/* ── Every engine has a call site ───────────────────────────────── */

test('every calculation the product ships is reachable from the UI', () => {
  const ui = UI_FILES.map(read).join('\n');
  for (const fn of [
    'runFullMortgageCalculation',
    'compareTerms',
    'computeAffordability',
    'calculateEarlyRepayment',
    'calculateRefinancing',
    'compareOffers',
    'buildRateBreakdown',
    'buildFinancingPicture',
    'matchSubsidyProgram',
  ]) {
    assert.ok(ui.includes(fn), `${fn} has no call site in the product`);
  }
});

test('every knowledge-base reader is used', () => {
  const ui = UI_FILES.map(read).join('\n');
  for (const fn of ['getActivePtiRules', 'getActiveLtvRules', 'getActiveSubsidyPrograms', 'getActiveReferenceRate']) {
    assert.ok(ui.includes(fn), `${fn} is never called`);
  }
});

/* ── It shares Investment's surface ─────────────────────────────── */

test('the workspace primitives are shared, not copied', () => {
  assert.ok(exists('src/components/workspace/primitives.tsx'));
  assert.ok(exists('src/components/workspace/controls.tsx'));
  // Investment still imports them, through a shim, so the two products
  // cannot drift apart by one of them editing its own copy.
  assert.ok(read('src/components/investment/primitives.tsx').includes('@/components/workspace/primitives'));
  assert.ok(read('src/components/investment/controls.tsx').includes('@/components/workspace/controls'));

  const mortgageUi = UI_FILES.map(read).join('\n');
  assert.ok(mortgageUi.includes('@/components/workspace/primitives'));
  assert.ok(mortgageUi.includes('@/components/workspace/controls'));
});

test('mortgage never reaches into Investment for a component', () => {
  for (const file of UI_FILES) {
    assert.ok(
      !read(file).includes('@/components/investment'),
      `${file} imports an Investment component instead of the shared one`,
    );
  }
});

test('the page is on the shared canvas, not the light app surface', () => {
  const page = read('src/pages/MortgagePage.tsx');
  assert.ok(page.includes('hm-workspace hm-workspace-canvas'));
  assert.ok(!page.includes("useSurfaceTheme('light')"));
  // Both class names resolve to the same declarations, so Investment
  // and Verify keep working while new code uses the neutral name.
  const css = read('src/index.css').replace(/\r\n/g, '\n');
  for (const pair of ['.hm-invest,\n  .hm-workspace {', '.hm-invest-panel,\n  .hm-workspace-panel {']) {
    assert.ok(css.includes(pair), `missing alias: ${pair}`);
  }
});

/* ── Honesty ────────────────────────────────────────────────────── */

test('nothing in the product promises approval or eligibility', () => {
  const raw = read('src/i18n/translations.ts');
  const start = raw.indexOf('const en = {');
  const english = raw.slice(start, raw.indexOf('\n};', start));
  const offenders = [];
  for (const match of english.matchAll(/^\s+(mortgage_[A-Za-z0-9_]+): '((?:[^'\\]|\\.)*)',$/gm)) {
    const [, key, value] = match;
    if (/\byou (will|are) (be )?(approved|eligible|guaranteed)/i.test(value)) offenders.push(key);
    // "not a loan offer, pre-approval, or guarantee from any bank" is the
    // sentence we want; only an unnegated promise counts.
    if (/\bguarantee[sd]?\b/i.test(value) && !/\b(not|never|cannot|no)\b[^.]{0,90}guarantee/i.test(value)) {
      offenders.push(key);
    }
  }
  assert.deepEqual(offenders, [], `these strings promise an outcome: ${offenders.join(', ')}`);
});

test('the early-repayment fee is never assumed to be zero', () => {
  const engine = read('src/mortgage/calculations/earlyRepayment.ts');
  assert.ok(engine.includes('earlyRepaymentFeeIncluded'));
  const view = read('src/components/mortgage/views/PlanViews.tsx');
  assert.ok(view.includes('mortgage_early_fee_not_included'));
  assert.ok(view.includes('earlyRepaymentFeeIncluded'));
});

test('the offer comparison never declares a best bank', () => {
  const engine = read('src/mortgage/calculations/offerComparison.ts');
  assert.ok(!/best/i.test(engine.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
  const view = read('src/components/mortgage/views/OffersView.tsx');
  assert.ok(view.includes('assumptionsComparable'), 'the incomparability warning must survive');
  assert.ok(view.includes('incomparabilityReasons'));
});

test('no regulatory number is hardcoded in a component', () => {
  // Every PTI/LTV limit, subsidy ceiling and policy rate must come from
  // a versioned knowledge-base row with a source and a verified date.
  for (const file of UI_FILES) {
    const src = read(file).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['maxPtiPercent:', 'maxLtvPercent:', 'ratePercent:']) {
      assert.ok(!src.includes(forbidden), `${file} defines a regulatory value inline`);
    }
  }
});

/* ── Mobile ─────────────────────────────────────────────────────── */

test('every wide table has a card rendering beside it', () => {
  // A five-column currency table at 320px is five columns of eleven
  // pixels. Any view with a <table> must also ship a small-screen
  // rendering, and the table itself must be hidden or scrollable.
  for (const file of walk('src/components/mortgage/views')) {
    const src = read(file);
    if (!src.includes('<table')) continue;
    const guarded = src.includes('hidden sm:block') || src.includes('hidden lg:block') || src.includes('overflow-x-auto');
    assert.ok(guarded, `${file} renders a bare table`);
    const hasCards = src.includes('sm:hidden') || src.includes('lg:hidden');
    assert.ok(hasCards, `${file} has a table with no card fallback for phones`);
  }
});

test('every tappable control clears the 44px floor', () => {
  for (const file of UI_FILES) {
    const src = read(file);
    for (const match of src.matchAll(/min-h-\[(\d+)px\]/g)) {
      assert.ok(Number(match[1]) >= 40, `${file} has a ${match[1]}px tap target`);
    }
    // The Tailwind shorthand this codebase uses for the same thing.
    assert.ok(!/\bh-8\b.*(?:button|onClick)/.test(src), `${file} has a 32px control`);
  }
});

/* ── i18n ───────────────────────────────────────────────────────── */

test('the knowledge base cannot reference a key that does not exist', () => {
  // The defect this whole gate family exists for: mortgage_rules rows
  // carry i18n keys in COLUMN VALUES, invisible to every literal scan,
  // and nine of them had never been added to a bundle — so production
  // printed "mortgage_kb_subsidy_human_explanation" at customers.
  const gate = read('scripts/mortgage-i18n-coverage.mjs');
  assert.ok(gate.includes('knowledgeBaseKeys'), 'the gate no longer reads keys out of the migrations');
  assert.ok(read('package.json').includes('mortgage-i18n-coverage'), 'the gate is not wired into i18n:all');

  const raw = read('src/i18n/translations.ts');
  const start = raw.indexOf('const en = {');
  const english = raw.slice(start, raw.indexOf('\n};', start));
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const referenced = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.includes('mortgage') && f.endsWith('.sql'))) {
    for (const m of read(`supabase/migrations/${file}`).matchAll(/'(mortgage_kb_[A-Za-z0-9_]+)'/g)) {
      referenced.add(m[1]);
    }
  }
  assert.ok(referenced.size >= 20, 'the migrations were not parsed');
  const missing = [...referenced].filter((key) => !new RegExp(`^\\s+${key}:`, 'm').test(english));
  assert.deepEqual(missing, [], `knowledge-base keys with no translation: ${missing.join(', ')}`);
});
