// The owner's mortgage round: a page per term, any currency in, selectable
// answers that look selectable, and "my mortgages" only on the landing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GLOSSARY_TERMS } from '../glossary.ts';
import { MISSING_PAGES, TERM_PAGES, termPageBySlug, termPageKeys, termPath } from '../termPages.ts';
import { cleanEntries, convertAmount, entryInLoanCurrency, isRateOld, toTable } from '../fx.ts';
import { UX_MORTGAGE_STRINGS as S } from '../../../scripts/ux-mortgage-i18n-data.mjs';

const read = (p) => fs.readFileSync(p, 'utf8');
const bundle = read('src/i18n/translations.ts');
const enBlock = bundle.slice(0, bundle.indexOf('\nconst ka'));

/* ── Term pages ─────────────────────────────────────────────────── */

test('every term the calculator labels has its own page', () => {
  assert.deepEqual(MISSING_PAGES, []);
  for (const term of GLOSSARY_TERMS) assert.ok(TERM_PAGES.some((p) => p.term === term), term);
  for (const extra of ['LOAN_TERM', 'ANNUITY', 'DIFFERENTIATED', 'GRACE_PERIOD', 'EXCHANGE_RATE', 'NBG_LIMITS']) {
    assert.ok(TERM_PAGES.some((p) => p.term === extra), `${extra} page missing`);
  }
});

test('slugs are unique, resolve back, and related links point at real pages', () => {
  const slugs = TERM_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const p of TERM_PAGES) {
    assert.match(p.slug, /^[a-z]+(-[a-z]+)*$/);
    assert.equal(termPageBySlug(p.slug), p);
    assert.equal(termPath(p.term), `/mortgage/terms/${p.slug}`);
    for (const r of p.related) {
      assert.notEqual(r, p.term, `${p.term} links to itself`);
      assert.ok(TERM_PAGES.some((x) => x.term === r), `${p.term} → ${r}`);
    }
  }
  assert.equal(termPageBySlug('no-such-term'), null);
});

test('every term page section exists in all six languages, in the bundle', () => {
  for (const p of TERM_PAGES) {
    for (const key of termPageKeys(p.term)) {
      assert.ok(enBlock.includes(`\n  ${key}: `), `${key} not in the English bundle`);
      if (!key.endsWith('_title') && !key.endsWith('_body') || key in S) {
        if (!(key in S)) continue; // the 25 original titles/summaries come from the earlier copy file
        assert.equal(S[key].length, 6);
        S[key].forEach((v, i) => assert.ok(v.trim().length > 2, `${key}[${i}] empty`));
      }
    }
  }
});

test('the copy is plain: no dashes as punctuation, placeholders intact', () => {
  for (const [key, values] of Object.entries(S)) {
    values.forEach((v, i) => assert.ok(!/[–—]/.test(v), `${key}[${i}] uses a dash`));
    const holes = (v) => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join();
    values.forEach((v, i) => assert.equal(holes(v), holes(values[0]), `${key}[${i}] placeholders`));
  }
});

test('the National Bank figures in the copy match the knowledge base (GEL 25/50, FX 20/30, LTV 90/70)', () => {
  const how = S.mortgage_tp_nbg_limits_how[0];
  for (const n of ['50%', '25%', '90%', '30%', '20%', '70%', '1,500']) assert.ok(how.includes(n), n);
  const kb = read('supabase/migrations/20260919122649_mortgage_kb_reverified_data_2026_09_19.sql');
  assert.ok(kb.includes('GEL 25/50, FX 20/30') && kb.includes('LTV 90 GEL / 70 FX'));
});

test('the term pages are public routes that wait for the mortgage strings', () => {
  const routes = read('src/routes.tsx');
  assert.match(routes, /path: '\/mortgage\/terms',\s+element: <MortgageTermsPage \/>, public: true/);
  assert.match(routes, /path: '\/mortgage\/terms\/:slug',\s+element: <MortgageTermPage \/>,\s+public: true/);
  assert.match(routes, /lazyRoute\(withFeatureStrings\(\(\) => import\('\.\/pages\/MortgageTermPage'\)\)\)/);
  assert.ok(read('src/site/registry.ts').includes("'/mortgage/terms/:slug'"));
});

/* ── Any currency in ────────────────────────────────────────────── */

const table = toTable([
  { currency: 'USD', gelPerUnit: 2.7, rateDate: '2026-10-24' },
  { currency: 'EUR', gelPerUnit: 3.0, rateDate: '2026-10-23' },
  { currency: 'GEL', gelPerUnit: 1, rateDate: '2026-10-24' },
  { currency: 'XXX', gelPerUnit: 0, rateDate: '2026-10-24' },
]);

test('lari is the hub; the rate and the older date travel with the result', () => {
  assert.deepEqual(convertAmount(100_000, 'USD', 'GEL', table), { value: 270_000, rate: 2.7, rateDate: '2026-10-24' });
  assert.equal(convertAmount(270_000, 'GEL', 'USD', table).value, 100_000);
  const usdEur = convertAmount(100, 'USD', 'EUR', table);
  assert.equal(usdEur.value, 90);
  assert.equal(usdEur.rateDate, '2026-10-23');
  assert.deepEqual(convertAmount(5, 'GEL', 'GEL', {}), { value: 5, rate: 1, rateDate: null });
});

test('no rate means no number: never zero, never the typed amount', () => {
  assert.equal(convertAmount(100, 'JPY', 'GEL', table), null);
  assert.equal(convertAmount(100, 'XXX', 'GEL', table), null, 'a zero rate is not a rate');
  assert.equal(convertAmount(100, 'USD', 'GEL', {}), null);
  assert.equal(entryInLoanCurrency({ amount: null, currency: 'USD' }, 'GEL', table), null);
  assert.ok(!('GEL' in table), 'GEL is the hub, never a row');
});

test('stored entries are re-validated and old rates are flagged', () => {
  assert.deepEqual(cleanEntries({ a: { amount: 5, currency: 'USD' }, b: { amount: 'x', currency: 'USD' }, c: { amount: null, currency: 'EUR' }, d: { amount: 1, currency: 'usd' } }),
    { a: { amount: 5, currency: 'USD' }, c: { amount: null, currency: 'EUR' } });
  assert.deepEqual(cleanEntries(null), {});
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(isRateOld('2026-10-24', now), false);
  assert.equal(isRateOld('2026-10-15', now), true);
});

test('rates live in their own public table, written only by the Edge Function, never in billing fx_rates', () => {
  const sql = read('supabase/migrations/20261204101000_mortgage_fx_rates.sql');
  assert.match(sql, /create table if not exists public\.mortgage_fx_rates/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to anon, authenticated using \(true\)/);
  assert.ok(!/for (insert|update|delete|all)/i.test(sql), 'no browser write policy');
  assert.ok(!/public\.fx_rates\b/.test(sql.replace(/--.*$/gm, '')), 'billing rates untouched');
  const fn = read('supabase/functions/mortgage-fx-rates/index.ts');
  assert.ok(fn.includes("from('mortgage_fx_rates')") && !fn.includes("from('fx_rates')"));
  assert.ok(read('.github/workflows/deploy.yml').includes('"mortgage-fx-rates"'), 'the function is deployable');
});

test('every money input carries a currency picker', () => {
  const calc = read('src/components/mortgage/SimpleCalculator.tsx');
  assert.ok(calc.includes('persistKey="propertyPrice"') && calc.includes('persistKey="downPayment"'));
  const fields = read('src/components/mortgage/fields.tsx');
  assert.match(fields, /kind === 'money' \? \(/);
  assert.ok(read('src/components/mortgage/ReadinessAssessment.tsx').includes('<MoneyField'));
});

/* ── Selectable answers, and the list on the landing only ───────── */

test('questionnaire answers are framed radio cards with keyboard support', () => {
  const cards = read('src/components/mortgage/OptionCards.tsx');
  for (const s of ['role="radiogroup"', 'role="radio"', 'aria-checked={checked}', "case 'ArrowDown'", 'focus-visible:ring-2', 'tabIndex={i === focusIndex ? 0 : -1}']) {
    assert.ok(cards.includes(s), s);
  }
  const rd = read('src/components/mortgage/ReadinessAssessment.tsx');
  assert.ok(!/ChoiceField|YesNoField/.test(rd), 'the old segmented controls are gone from the questionnaire');
  assert.ok(rd.includes('<OptionCards') && rd.includes('<YesNoCards'));
});

test('"my mortgages" steps aside while a scenario is being edited or calculated', () => {
  const ws = read('src/components/mortgage/MortgageWorkspace.tsx');
  assert.ok(ws.includes('const flow = inFlow || current !== null;'));
  assert.ok(ws.includes('{!flow ? (<>'), 'the list renders only on the landing');
  assert.ok(ws.includes("t('mortgage_flow_back_to_list')"));
  assert.match(read('src/pages/MortgagePage.tsx'), /inFlow=\{showResult\}/);
});
