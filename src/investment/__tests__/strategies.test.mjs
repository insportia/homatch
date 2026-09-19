// The four products, their click-first inputs, and the questions they know
// not to ask.
//
// Two properties matter most here and neither is visible by reading a form:
//
//   A GATED-AWAY FIELD IS NEVER "MISSING". Somebody buying for cash has not
//   failed to supply an interest rate; they were never asked. If the
//   completeness check disagreed with the renderer, the product would sit
//   at "incomplete" forever with nothing on screen to fix.
//
//   A PRESET MUST KNOW WHAT IS ALREADY ANSWERED. Offering "$600/m²" when
//   the area is 80 m² is worse than offering "$48,000" — it hands the
//   investor the arithmetic this product exists to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGIES,
  STRATEGY_IDS,
  STRATEGY_ORDER,
  analysisState,
  fieldsOf,
  isFieldVisible,
  isStrategyId,
  isStrategyReady,
  missingRequiredFields,
  nextUnansweredField,
  visibleFieldsOf,
  visibleGroupsOf,
} from '../strategies/definitions.ts';
import { RENOVATION_RATES, derivedValueFor, derivedValues, presetsFor } from '../strategies/presets.ts';
import {
  applyGateEffects,
  monthsAfterCompletionFor,
  resolveConstructionInput,
  resolveInvestmentInput,
  totalOrPerSqm,
} from '../strategies/resolve.ts';
import { applyPatch } from '../consultant/context.ts';

const ctx = (patch) => applyPatch({}, patch, 'USER', { at: '2026-09-19T00:00:00.000Z' }).context;

/** The plain values behind a context, for building the next one from it. */
const plainValues = (context) =>
  Object.fromEntries(Object.entries(context).map(([field, entry]) => [field, entry.value]));
const valueOfFor = (context) => (field) => context[field]?.value;

/* ── The four products exist and are distinct ───────────────────────── */

test('there are exactly four strategies and the order matches the set', () => {
  assert.equal(STRATEGY_IDS.length, 4);
  assert.deepEqual([...STRATEGY_ORDER].sort(), [...STRATEGY_IDS].sort());
  for (const id of STRATEGY_IDS) assert.equal(STRATEGIES[id].id, id);
});

test('every strategy declares a name, a business model and a description', () => {
  for (const id of STRATEGY_IDS) {
    const strategy = STRATEGIES[id];
    assert.ok(strategy.titleKey.startsWith('inv_'));
    assert.ok(strategy.flowKey.startsWith('inv_'));
    assert.ok(strategy.descriptionKey.startsWith('inv_'));
    assert.ok(strategy.groups.length >= 2, `${id} should have several sections`);
  }
});

test('every strategy has at least one required field, so none is a blank page', () => {
  for (const id of STRATEGY_IDS) {
    assert.ok(fieldsOf(id).some((f) => f.required), `${id} requires nothing`);
  }
});

test('only genuinely property-specific numbers are typed; the rest are chosen', () => {
  // The click-first rule, asserted rather than trusted: every field either
  // offers options, is a choice, or is one of the handful that is truly
  // this property's own — and even those are suggested from the area or the
  // price wherever one is already known, so the set is only about what has
  // nothing to be suggested FROM.
  const TYPED_BY_NATURE = new Set(['projectName']);
  for (const id of STRATEGY_IDS) {
    for (const definition of fieldsOf(id)) {
      if (definition.control !== 'chips') continue;
      if (TYPED_BY_NATURE.has(definition.field)) continue;
      const options = presetsFor(
        definition.field,
        // A context far enough along that every contextual preset can fire.
        // renovationCost deliberately offers nothing until a quality is
        // chosen — amounts, not rates — so the probe chooses one.
        ctx({ purchasePrice: 100000, areaSqm: 80, monthlyRent: 800, renovationQuality: 'STANDARD' }),
      );
      assert.ok(
        options.length > 0,
        `${id}.${definition.field} is a chip control with nothing to click`,
      );
    }
  }
});

test('walking a strategy from empty, every question is answerable by clicking', () => {
  /*
   * The stronger form of the check above. A preset table can satisfy "every
   * field has options in a fully populated context" and still hand the
   * investor an empty box at the moment the question is actually asked,
   * because the thing its options are computed FROM has not been asked yet.
   * This walks each strategy the way a person does — always answering the
   * next question, always with the first option offered — and fails if any
   * step has nothing to click.
   */
  for (const id of STRATEGY_IDS) {
    let context = ctx({});
    const answered = [];

    for (let step = 0; step < 40; step += 1) {
      const next = nextUnansweredField(id, valueOfFor(context));
      if (!next) break;
      answered.push(next.field);

      if (next.control === 'chips') {
        const options = presetsFor(next.field, context, id);
        assert.ok(
          options.length > 0,
          `${id}: "${next.field}" is asked at step ${step} with nothing to click.
` +
            `  answered so far: ${answered.slice(0, -1).join(', ') || '(nothing)'}`,
        );
        context = ctx({ ...plainValues(context), [next.field]: options[0].value });
        continue;
      }

      if (next.options?.length) {
        context = ctx({ ...plainValues(context), [next.field]: next.options[0].value });
        continue;
      }

      // Free text is the one control with nothing to offer, by design.
      assert.equal(next.control, 'text', `${id}.${next.field} has no way to answer it`);
      context = ctx({ ...plainValues(context), [next.field]: 'x' });
    }

    assert.equal(
      nextUnansweredField(id, valueOfFor(context)),
      null,
      `${id} never finished: got as far as ${answered.join(', ')}`,
    );
    assert.equal(analysisState(id, valueOfFor(context)), 'COMPLETE', id);
  }
});

/* ── Gating ─────────────────────────────────────────────────────────── */

test('a cash buyer is never asked for an interest rate', () => {
  const cash = ctx({ purchasePrice: 100000, financingMode: 'CASH' });
  const visible = visibleFieldsOf('RENTAL_INVESTMENT', valueOfFor(cash)).map((f) => f.field);
  assert.ok(!visible.includes('mortgageAnnualRatePercent'));
  assert.ok(!visible.includes('downPaymentPercent'));
  assert.ok(visible.includes('financingMode'));
});

test('choosing a mortgage reveals exactly the three loan questions', () => {
  const financed = ctx({ purchasePrice: 100000, financingMode: 'MORTGAGE' });
  const visible = visibleFieldsOf('RENTAL_INVESTMENT', valueOfFor(financed)).map((f) => f.field);
  for (const field of ['downPaymentPercent', 'mortgageAnnualRatePercent', 'mortgageTermMonths']) {
    assert.ok(visible.includes(field), `${field} should appear once a mortgage is chosen`);
  }
});

test('an already-renovated flat is never asked for a renovation budget', () => {
  const done = ctx({ purchasePrice: 100000, renovationNeeded: 'NO' });
  const visible = visibleFieldsOf('RENTAL_INVESTMENT', valueOfFor(done)).map((f) => f.field);
  assert.ok(!visible.includes('renovationCost'));

  const needed = ctx({ purchasePrice: 100000, renovationNeeded: 'YES' });
  assert.ok(
    visibleFieldsOf('RENTAL_INVESTMENT', valueOfFor(needed))
      .map((f) => f.field)
      .includes('renovationCost'),
  );
});

test('a gated-away field is never counted as missing', () => {
  const cash = ctx({ purchasePrice: 100000, areaSqm: 70, monthlyRent: 800, financingMode: 'CASH' });
  const missing = missingRequiredFields('RENTAL_INVESTMENT', valueOfFor(cash)).map((f) => f.field);
  assert.ok(!missing.includes('mortgageAnnualRatePercent'));
  assert.equal(missing.length, 0, `unexpectedly missing: ${missing.join(', ')}`);
  assert.equal(isStrategyReady('RENTAL_INVESTMENT', valueOfFor(cash)), true);
});

test('the value flow asks only the questions its chosen business model needs', () => {
  const rental = ctx({ valueStrategy: 'RENTAL_INVESTMENT' });
  const rentalFields = visibleFieldsOf('INVESTMENT_VALUE', valueOfFor(rental)).map((f) => f.field);
  assert.ok(rentalFields.includes('monthlyRent'));
  assert.ok(rentalFields.includes('benchmarkYieldPercent'));
  assert.ok(!rentalFields.includes('expectedCompletedPrice'));
  assert.ok(!rentalFields.includes('exitPriceAssumption'));

  const flip = ctx({ valueStrategy: 'RENOVATE_RESELL' });
  const flipFields = visibleFieldsOf('INVESTMENT_VALUE', valueOfFor(flip)).map((f) => f.field);
  assert.ok(flipFields.includes('exitPriceAssumption'));
  assert.ok(flipFields.includes('targetReturnPercent'));
  assert.ok(!flipFields.includes('monthlyRent'));
  assert.ok(!flipFields.includes('benchmarkYieldPercent'));
});

test('before a business model is chosen, only that question is on screen', () => {
  const empty = ctx({});
  const groups = visibleGroupsOf('INVESTMENT_VALUE', valueOfFor(empty));
  const fields = groups.flatMap((g) => g.fields).map((f) => f.field);
  assert.deepEqual(fields, ['valueStrategy']);
});

test('an empty section is not rendered as a section', () => {
  const rental = ctx({ valueStrategy: 'RENTAL_INVESTMENT' });
  const ids = visibleGroupsOf('INVESTMENT_VALUE', valueOfFor(rental)).map((g) => g.id);
  assert.ok(!ids.includes('construction_inputs'));
  assert.ok(!ids.includes('resale_inputs'));
  assert.ok(ids.includes('rental_inputs'));
});

/* ── Completeness ───────────────────────────────────────────────────── */

test('a strategy with nothing entered is MISSING_INPUT and names what it needs', () => {
  const empty = ctx({});
  assert.equal(analysisState('RENOVATE_RESELL', valueOfFor(empty)), 'MISSING_INPUT');
  const missing = missingRequiredFields('RENOVATE_RESELL', valueOfFor(empty)).map((f) => f.field);
  /*
   * The AREA is asked first, ahead of the price, and the order is the
   * point rather than an accident. A purchase price with nothing known
   * behind it has no honest suggestions and falls back to typing seven
   * digits; once the area exists it can be offered as four brackets per
   * m². Asking in the other order makes the product's first question its
   * worst one.
   */
  assert.deepEqual(missing, [
    'areaSqm',
    'purchasePrice',
    'renovationQuality',
    'renovationCost',
    'holdMonths',
    'exitPriceAssumption',
  ]);
});

test('required answers alone give an ESTIMATED result, never a COMPLETE one', () => {
  const partial = ctx({
    purchasePrice: 100000,
    areaSqm: 70,
    renovationQuality: 'STANDARD',
    renovationCost: 20000,
    holdMonths: 6,
    exitPriceAssumption: 150000,
  });
  assert.equal(isStrategyReady('RENOVATE_RESELL', valueOfFor(partial)), true);
  assert.equal(analysisState('RENOVATE_RESELL', valueOfFor(partial)), 'ESTIMATED');
});

test('answering every non-advanced question reaches COMPLETE', () => {
  const full = ctx({
    purchasePrice: 100000,
    areaSqm: 70,
    acquisitionCostPercent: 2,
    renovationQuality: 'STANDARD',
    renovationCost: 20000,
    furnishingCost: 3000,
    renovationDurationMonths: 3,
    holdMonths: 6,
    monthlyHoldingCosts: 200,
    financingMode: 'CASH',
    exitPriceAssumption: 150000,
    sellingCostPercent: 3,
    targetReturnPercent: 20,
  });
  assert.equal(analysisState('RENOVATE_RESELL', valueOfFor(full)), 'COMPLETE');
});

test('the next question is the first required one, then the first optional one', () => {
  const empty = ctx({});
  assert.equal(nextUnansweredField('RENOVATE_RESELL', valueOfFor(empty)).field, 'areaSqm');

  const required = ctx({
    purchasePrice: 100000,
    areaSqm: 70,
    renovationQuality: 'STANDARD',
    renovationCost: 20000,
    holdMonths: 6,
    exitPriceAssumption: 150000,
  });
  const next = nextUnansweredField('RENOVATE_RESELL', valueOfFor(required));
  assert.ok(next !== null);
  assert.equal(next.required, false);
});

test('an alternative unit satisfies the requirement it stands in for', () => {
  const perSqm = ctx({
    purchasePrice: 100000,
    areaSqm: 70,
    renovationQuality: 'STANDARD',
    renovationCost: 20000,
    holdMonths: 6,
    expectedResalePricePerSqm: 2100,
  });
  const missing = missingRequiredFields('RENOVATE_RESELL', valueOfFor(perSqm)).map((f) => f.field);
  assert.ok(!missing.includes('exitPriceAssumption'), 'a resale per m2 answers the resale question');
});

/* ── Presets ────────────────────────────────────────────────────────── */

test('renovation presets are AMOUNTS once quality and area are known', () => {
  const context = ctx({ areaSqm: 80, renovationQuality: 'PREMIUM' });
  const options = presetsFor('renovationCost', context);
  assert.deepEqual(options.map((o) => o.value), [48000, 60000, 72000]);
  assert.ok(options.every((o) => o.kind === 'EXAMPLE'), 'these are illustrations, not measurements');
  assert.deepEqual(RENOVATION_RATES.PREMIUM, [600, 750, 900]);
});

test('renovation presets are withheld rather than wrong when the area is unknown', () => {
  assert.deepEqual(presetsFor('renovationCost', ctx({ renovationQuality: 'PREMIUM' })), []);
});

test('rent presets are framed as the yield they would represent', () => {
  const options = presetsFor('monthlyRent', ctx({ purchasePrice: 120000 }));
  assert.equal(options.length, 4);
  // 6% of 120,000 over twelve months is 600.
  assert.ok(options.some((o) => o.value === 600));
  assert.ok(options.every((o) => o.kind === 'CALCULATED'));
});

test('resale presets are movements from the price actually being paid', () => {
  const options = presetsFor('exitPriceAssumption', ctx({ purchasePrice: 100000 }));
  assert.deepEqual(options.map((o) => o.value), [110000, 120000, 130000, 140000]);
});

test('a preset that depends on an unknown is absent, not guessed', () => {
  assert.deepEqual(presetsFor('exitPriceAssumption', ctx({})), []);
  assert.deepEqual(presetsFor('monthlyRent', ctx({})), []);
});

test('occupancy is offered in the words a landlord uses, stored as vacant months', () => {
  const options = presetsFor('vacantMonthsPerYear', ctx({}));
  assert.equal(options[0].value, 0);
  assert.equal(options[0].labelKey, 'inv_occ_100');
  // 95% occupancy is 0.6 of a month empty.
  assert.equal(options[1].value, 0.6);
});

test('a convention is labelled as a convention, not as market evidence', () => {
  const selling = presetsFor('sellingCostPercent', ctx({}));
  assert.ok(selling.every((o) => o.kind === 'CONVENTION'));
  const area = presetsFor('areaSqm', ctx({}));
  assert.ok(area.every((o) => o.kind === 'EXAMPLE'));
  // MARKET is never produced here — only the evidence lane may claim it.
  for (const field of ['areaSqm', 'monthlyRent', 'renovationCost', 'sellingCostPercent']) {
    const options = presetsFor(field, ctx({ purchasePrice: 100000, areaSqm: 80, renovationQuality: 'BASIC' }));
    assert.ok(options.every((o) => o.kind !== 'MARKET'), `${field} must not claim market evidence`);
  }
});

/* ── Derived values ─────────────────────────────────────────────────── */

test('price per m2 is shown, never asked', () => {
  const derived = derivedValueFor('purchasePricePerSqm', ctx({ purchasePrice: 100000, areaSqm: 80 }));
  assert.equal(derived.value, 1250);
  assert.deepEqual(derived.fromFields, ['purchasePrice', 'areaSqm']);
});

test('the pair works in both directions', () => {
  const fromRate = derivedValueFor('purchasePrice', ctx({ purchasePricePerSqm: 1250, areaSqm: 80 }));
  assert.equal(fromRate.value, 100000);
});

test('a resale entered as a total shows its per-m2 figure and vice versa', () => {
  const totals = derivedValues(ctx({ areaSqm: 80, exitPriceAssumption: 130000 }));
  assert.ok(totals.some((d) => d.field === 'expectedResalePricePerSqm' && d.value === 1625));
});

test('nothing is derived when both halves were entered', () => {
  const both = derivedValues(ctx({ areaSqm: 80, purchasePrice: 100000, purchasePricePerSqm: 1300 }));
  assert.ok(!both.some((d) => d.field === 'purchasePrice' || d.field === 'purchasePricePerSqm'));
});

/* ── Resolution into the engines ────────────────────────────────────── */

test('a total wins over a rate when both were supplied', () => {
  assert.equal(totalOrPerSqm(100000, 1300, 80), 100000);
  assert.equal(totalOrPerSqm(undefined, 1300, 80), 104000);
  assert.equal(totalOrPerSqm(undefined, 1300, undefined), undefined);
});

test('a price given only per m2 still produces a runnable model', () => {
  const input = resolveInvestmentInput(ctx({ purchasePricePerSqm: 1250, areaSqm: 80 }));
  assert.equal(input.purchasePrice, 100000);
});

test('switching back to cash removes the loan the engine would otherwise model', () => {
  const financed = ctx({
    purchasePrice: 100000,
    downPaymentPercent: 30,
    mortgageAnnualRatePercent: 12,
    mortgageTermMonths: 240,
  });
  assert.ok(resolveInvestmentInput(financed).financing, 'a described loan should be modelled');

  const switched = applyPatch(financed, { financingMode: 'CASH' }, 'USER').context;
  assert.equal(
    resolveInvestmentInput(switched).financing,
    undefined,
    'a stale rate must not keep modelling a loan the investor cancelled',
  );
});

test('saying the flat needs no work removes a stale renovation figure', () => {
  const withWork = ctx({ purchasePrice: 100000, renovationCost: 20000, renovationNeeded: 'NO' });
  assert.equal(resolveInvestmentInput(withWork).renovationCost, undefined);
});

test('declining an exit scenario removes a stale future sale price', () => {
  const declined = ctx({
    purchasePrice: 100000,
    exitPriceAssumption: 150000,
    includeExitScenario: 'NO',
  });
  assert.equal(resolveInvestmentInput(declined).exitPriceAssumption, undefined);
});

test('the exit-timing choice sets the months, and only Custom asks for them', () => {
  assert.equal(monthsAfterCompletionFor(ctx({ exitTiming: 'AT_COMPLETION' })), 0);
  assert.equal(monthsAfterCompletionFor(ctx({ exitTiming: 'PLUS_6' })), 6);
  assert.equal(monthsAfterCompletionFor(ctx({ exitTiming: 'PLUS_12' })), 12);
  assert.equal(
    monthsAfterCompletionFor(ctx({ exitTiming: 'CUSTOM', additionalMonthsToSale: 9 })),
    9,
  );
});

test('the construction resolver carries the timing choice into the model', () => {
  const context = ctx({
    purchasePrice: 80000,
    areaSqm: 60,
    monthsToCompletion: 24,
    exitTiming: 'PLUS_6',
  });
  assert.equal(resolveConstructionInput(context).additionalMonthsToSale, 6);
});

test('gate effects never mutate the input they were handed', () => {
  const context = ctx({ purchasePrice: 100000, financingMode: 'CASH' });
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    financing: { annualRatePercent: 10, termMonths: 240, downPaymentPercent: 20 },
  };
  const snapshot = JSON.stringify(input);
  applyGateEffects(context, input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('a field with no gate is always visible', () => {
  const definition = { field: 'purchasePrice', labelKey: 'x', kind: 'money', control: 'chips', required: true };
  assert.equal(isFieldVisible(definition, () => undefined), true);
});
