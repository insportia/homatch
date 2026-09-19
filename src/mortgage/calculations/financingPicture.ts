// src/mortgage/calculations/financingPicture.ts — DETERMINISTIC MATH ONLY.
//
// §12's "Your financing picture": one compact summary assembled from
// outputs that already exist, plus three lists — what looks comfortable,
// what deserves attention, and what is still missing.
//
// THE RULE THAT SHAPES THIS WHOLE FILE
//
// No score. No "good loan" / "bad loan". Every line in every list is
// produced by a single named, factual criterion that can be printed next
// to it, and a criterion that needs a number the borrower has not given
// produces a MISSING line rather than an opinion.
//
// That is why there is no weighting, no traffic light and no total out of
// ten: a composite would have to decide that being 4 points inside the
// PTI limit outweighs an unknown early-repayment fee, and nothing in this
// product knows that. The borrower does.
import type {
  AffordabilityResult,
  MortgageCalculationResult,
  MortgageInput,
  MortgageRule,
  LtvLimitRuleData,
  PtiLimitRuleData,
  RateType,
} from '../types.ts';
import { roundCurrency } from './amortization.ts';
import type { RateBreakdown } from './rateBreakdown.ts';

/**
 * One observation about the scenario.
 *
 * `criterionKey` is the rule that produced it, stated in the same breath
 * as the observation itself — a finding whose reason is not printed is an
 * opinion wearing a number's clothes.
 */
export interface PictureNote {
  key: string;
  criterionKey: string;
  vars?: Record<string, string | number>;
  /**
   * Variables whose value is itself a translation key.
   *
   * A rate type is an enum in the engine and a word on the screen. Put
   * through `vars` it reached a Hebrew reader as "INDEXED" in the middle
   * of a Hebrew sentence; the renderer translates these before it
   * interpolates them.
   */
  varKeys?: Record<string, string>;
}

export interface FinancingPicture {
  currency: string;
  propertyPrice: number;
  downPayment: number;
  downPaymentPercent: number;
  loanAmount: number;
  monthlyPayment: number;
  effectiveAnnualRatePercent: number | null;
  totalFinancingCost: number;
  ptiPercent: number | null;
  ltvPercent: number | null;

  comfortable: PictureNote[];
  attention: PictureNote[];
  missing: PictureNote[];
}

/**
 * How much headroom counts as comfortable against a published limit.
 *
 * Five percentage points, and it is a DISPLAY threshold, not a rule: a
 * scenario one point inside the PTI ceiling is within the limit and this
 * product says so, but calling it "comfortable" would be the product
 * adding a reassurance the regulator did not. Anything between the limit
 * and the limit minus this margin is reported as within the limit and
 * also as deserving attention.
 */
export const COMFORT_MARGIN_POINTS = 5;

/** The words for the three rate types, so a note can say one out loud. */
const RATE_TYPE_LABEL_KEYS: Record<RateType, string> = {
  FIXED: 'mortgage_rate_type_fixed',
  VARIABLE: 'mortgage_rate_type_variable',
  INDEXED: 'mortgage_rate_type_indexed',
};

export interface PictureInputs {
  input: MortgageInput;
  result: MortgageCalculationResult;
  breakdown: RateBreakdown;
  affordability: AffordabilityResult | null;
  ptiRule: MortgageRule<PtiLimitRuleData> | null;
  ltvRule: MortgageRule<LtvLimitRuleData> | null;
  /** True only when the borrower has confirmed the bank's contractual fee. */
  earlyRepaymentFeeKnown: boolean;
}

export function buildFinancingPicture(args: PictureInputs): FinancingPicture {
  const { input, result, breakdown, affordability, ptiRule, ltvRule } = args;

  const comfortable: PictureNote[] = [];
  const attention: PictureNote[] = [];
  const missing: PictureNote[] = [];

  /* ── PTI against the published limit ── */
  if (affordability && ptiRule) {
    const limit = ptiRule.data.maxPtiPercent;
    const pti = affordability.ptiPercent;
    const vars = { pti: pti.toFixed(1), limit };
    if (pti > limit) {
      attention.push({ key: 'mortgage_picture_pti_over', criterionKey: 'mortgage_picture_crit_pti', vars });
    } else if (pti > limit - COMFORT_MARGIN_POINTS) {
      attention.push({ key: 'mortgage_picture_pti_near', criterionKey: 'mortgage_picture_crit_pti', vars });
    } else {
      comfortable.push({ key: 'mortgage_picture_pti_under', criterionKey: 'mortgage_picture_crit_pti', vars });
    }
  } else if (!affordability) {
    missing.push({ key: 'mortgage_picture_missing_income', criterionKey: 'mortgage_picture_crit_pti' });
  } else {
    missing.push({ key: 'mortgage_picture_missing_pti_rule', criterionKey: 'mortgage_picture_crit_pti' });
  }

  /* ── LTV against the published limit ── */
  if (result.ltvPercent !== null && ltvRule) {
    const limit = ltvRule.data.maxLtvPercent;
    const ltv = result.ltvPercent;
    const vars = { ltv: ltv.toFixed(1), limit };
    if (ltv > limit) {
      attention.push({ key: 'mortgage_picture_ltv_over', criterionKey: 'mortgage_picture_crit_ltv', vars });
    } else if (ltv > limit - COMFORT_MARGIN_POINTS) {
      attention.push({ key: 'mortgage_picture_ltv_near', criterionKey: 'mortgage_picture_crit_ltv', vars });
    } else {
      comfortable.push({ key: 'mortgage_picture_ltv_under', criterionKey: 'mortgage_picture_crit_ltv', vars });
    }
  } else if (result.ltvPercent !== null) {
    missing.push({ key: 'mortgage_picture_missing_ltv_rule', criterionKey: 'mortgage_picture_crit_ltv' });
  }

  /* ── The gap between the advertised rate and the real one ── */
  if (breakdown.gapPoints !== null) {
    const vars = { gap: breakdown.gapPoints.toFixed(2) };
    /*
     * One percentage point. Chosen because monthly compounding alone
     * accounts for roughly 0.6–0.8 points at Georgian mortgage rates —
     * below that threshold the gap says nothing about the bank's fees,
     * only about how interest is counted, and flagging it would train
     * people to ignore the flag.
     */
    if (breakdown.gapPoints >= 1) {
      attention.push({ key: 'mortgage_picture_rate_gap', criterionKey: 'mortgage_picture_crit_rate_gap', vars });
    } else {
      comfortable.push({ key: 'mortgage_picture_rate_close', criterionKey: 'mortgage_picture_crit_rate_gap', vars });
    }
  }

  /* ── Costs nobody has told us about ── */
  if (breakdown.unknownCosts.length) {
    missing.push({
      key: 'mortgage_picture_missing_costs',
      criterionKey: 'mortgage_picture_crit_unknown_costs',
      vars: { n: breakdown.unknownCosts.length },
    });
  }

  /* ── Rate type: an unstated rate type is not a fixed rate ── */
  if (!input.rateType) {
    missing.push({ key: 'mortgage_picture_missing_rate_type', criterionKey: 'mortgage_picture_crit_rate_type' });
  } else if (input.rateType !== 'FIXED') {
    attention.push({
      key: 'mortgage_picture_rate_not_fixed',
      criterionKey: 'mortgage_picture_crit_rate_type',
      varKeys: { type: RATE_TYPE_LABEL_KEYS[input.rateType] },
    });
  } else {
    comfortable.push({ key: 'mortgage_picture_rate_fixed', criterionKey: 'mortgage_picture_crit_rate_type' });
  }

  /* ── Borrowing in a currency you are not paid in ── */
  if (input.propertyCurrency.toUpperCase() !== 'GEL') {
    attention.push({
      key: 'mortgage_picture_fx',
      criterionKey: 'mortgage_picture_crit_fx',
      vars: { currency: input.propertyCurrency },
    });
  }

  /* ── The fee that decides whether paying early is worth it ── */
  if (!args.earlyRepaymentFeeKnown) {
    missing.push({
      key: 'mortgage_picture_missing_early_fee',
      criterionKey: 'mortgage_picture_crit_early_fee',
    });
  }

  return {
    currency: result.currency,
    propertyPrice: input.propertyPrice,
    downPayment: input.downPayment,
    downPaymentPercent: result.downPaymentPercent,
    loanAmount: result.loanAmount,
    monthlyPayment: result.monthlyPayment,
    effectiveAnnualRatePercent: result.effectiveAnnualRatePercent,
    totalFinancingCost: roundCurrency(result.totalRepayment - result.loanAmount),
    ptiPercent: affordability?.ptiPercent ?? null,
    ltvPercent: result.ltvPercent,
    comfortable,
    attention,
    missing,
  };
}
