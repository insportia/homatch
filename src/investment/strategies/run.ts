// HOMATCH INVESTMENT INTELLIGENCE — one strategy, one bundle of answers.
//
// WHY THIS IS NOT IN THE REACT HOOK
//
// "Which engine does this strategy run, and what does its headline mean?"
// is a question about the product, not about the browser. Putting it in a
// component would make it untestable without a DOM and would let the four
// strategies drift apart one `if` at a time.
//
// NOTHING HERE CALCULATES ANYTHING
//
// Every figure below comes out of `src/investment/calculations`. This file
// chooses which of those to call and which six numbers lead the result.
// If a formula appears here, it is in the wrong file.

import type { InvestmentModel } from '../types.ts';
import type { InvestmentContext } from '../consultant/context.ts';
import { runInvestmentModel } from '../calculations/index.ts';
import { buildInvestedCapital } from '../calculations/capital.ts';
import { buildIncomeModel } from '../calculations/income.ts';
import { buildDebtLeg } from '../calculations/leverage.ts';
import {
  buildRenovateResellModel,
  buildRenovateScenarios,
  buildRenovateTimings,
  type RenovateResellModel,
  type RenovateScenarioRow,
  type RenovateTimingRow,
} from '../calculations/renovate.ts';
import {
  buildCompletedPriceScenarios,
  buildConstructionDelayLadder,
  buildConstructionModel,
  type CompletedPriceScenario,
  type ConstructionDelayRow,
  type ConstructionModel,
} from '../calculations/construction.ts';
import {
  constructionAcquisitionValue,
  renovationAcquisitionValue,
  rentalAcquisitionValue,
  type AcquisitionValueResult,
} from '../calculations/acquisitionValue.ts';
import type { StrategyId } from './definitions.ts';
import {
  resolveConstructionInput,
  resolveConstructionValueInput,
  resolveInvestmentInput,
  resolveRenovationExtras,
  resolveRenovationValueInput,
  resolveRentalValueInput,
  resolveValueStrategy,
  withResolvedRenovation,
} from './resolve.ts';

export interface StrategyRun {
  strategy: StrategyId;
  /** The shared engine model. Present whenever a price is known. */
  model: InvestmentModel | null;
  flip: RenovateResellModel | null;
  /** The flip re-run at other resale prices, and at other timings. */
  flipScenarios: RenovateScenarioRow[];
  flipTimings: RenovateTimingRow[];
  construction: ConstructionModel | null;
  delays: ConstructionDelayRow[];
  priceScenarios: CompletedPriceScenario[];
  value: AcquisitionValueResult | null;
}

const EMPTY: Omit<StrategyRun, 'strategy'> = {
  model: null,
  flip: null,
  flipScenarios: [],
  flipTimings: [],
  construction: null,
  delays: [],
  priceScenarios: [],
  value: null,
};

const num = (context: InvestmentContext, field: string): number | undefined =>
  (context as Record<string, { value?: unknown } | undefined>)[field]?.value as number | undefined;

/**
 * The shared model, for strategies that build on it.
 *
 * Wrapped because `validateInvestmentInput` throws on an input the context
 * door should have rejected, and a half-built model shown to an investor is
 * worse than no model at all.
 */
function safeModel(input: ReturnType<typeof resolveInvestmentInput>): InvestmentModel | null {
  if (!input) return null;
  try {
    return runInvestmentModel(input);
  } catch {
    return null;
  }
}

export function runStrategy(strategy: StrategyId, context: InvestmentContext): StrategyRun {
  switch (strategy) {
    case 'RENTAL_INVESTMENT':
      return { strategy, ...EMPTY, model: safeModel(resolveInvestmentInput(context)) };

    case 'RENOVATE_RESELL': {
      const base = resolveInvestmentInput(context);
      if (!base) return { strategy, ...EMPTY };
      const input = withResolvedRenovation(base, context);
      const model = safeModel(input);
      if (!model) return { strategy, ...EMPTY };
      /*
       * The flip summary is built from the SAME capital, income and debt
       * objects the model was built from, not from a second pass over the
       * input. Two passes would be two chances to disagree about what the
       * renovation cost.
       */
      const capital = buildInvestedCapital(input);
      const income = buildIncomeModel(input);
      const debt = buildDebtLeg(input, capital);
      const args = { input, capital, income, debt, ...resolveRenovationExtras(context) };
      return {
        strategy,
        ...EMPTY,
        model,
        flip: buildRenovateResellModel(args),
        flipScenarios: buildRenovateScenarios(args),
        flipTimings: buildRenovateTimings(args),
      };
    }

    case 'CONSTRUCTION_RESALE': {
      const input = resolveConstructionInput(context);
      if (!input) return { strategy, ...EMPTY };
      const construction = buildConstructionModel(input);
      return {
        strategy,
        ...EMPTY,
        construction,
        delays: buildConstructionDelayLadder(input),
        priceScenarios: buildCompletedPriceScenarios(input),
      };
    }

    case 'INVESTMENT_VALUE': {
      const chosen = resolveValueStrategy(context);

      if (chosen === 'RENOVATE_RESELL') {
        const input = resolveRenovationValueInput(context);
        return {
          strategy,
          ...EMPTY,
          value: input ? renovationAcquisitionValue(input) : null,
        };
      }

      if (chosen === 'CONSTRUCTION_RESALE') {
        const input = resolveConstructionValueInput(context);
        return {
          strategy,
          ...EMPTY,
          value: input ? constructionAcquisitionValue(input) : null,
        };
      }

      /*
       * The rental backsolve needs a net operating income, and NOI is the
       * engine's own answer — rent less the operating stack, after vacancy.
       * Recomputing it here from the raw fields would be a second NOI, and
       * the whole point of the backsolve is that it inverts THE model.
       *
       * The price the engine needs to run at all is irrelevant to the
       * answer — the solve replaces it — so a nominal one is supplied where
       * the investor has not proposed anything to score.
       */
      const probe = resolveInvestmentInput({
        ...context,
        purchasePrice: context.purchasePrice ?? {
          value: num(context, 'proposedPrice') ?? 100_000,
          origin: 'DERIVED',
          at: new Date().toISOString(),
        },
      } as InvestmentContext);
      const model = safeModel(probe);
      const noi = model?.income.netOperatingIncome.value ?? null;
      if (noi === null) return { strategy, ...EMPTY };
      return {
        strategy,
        ...EMPTY,
        value: rentalAcquisitionValue(resolveRentalValueInput(context, noi)),
      };
    }

    default:
      return { strategy, ...EMPTY };
  }
}
