// HOMATCH INVESTMENT INTELLIGENCE — the same six slots, whatever ran.
//
// WHY SIX, AND WHY ALWAYS THE SAME SIX
//
// An investor who has read one Homatch result should be able to read the
// next one without re-learning the layout. So every strategy answers the
// same six questions, in the same order and the same positions:
//
//   1  what it costs them          invested capital
//   2  what they get               expected profit / annual return
//   3  the return on 2 over 1      ROI
//   4  the same, per year          annualized
//   5  where it stops working      break-even
//   6  how much room to 5          margin of safety
//
// The LABELS change per strategy, because "expected profit" on a flip and
// "annual net income" on a rental are not the same claim and must not wear
// the same word. The POSITIONS never change.
//
// Slot 6 is the one most products omit, which is exactly why it is fixed
// here: a return with no stated distance to failure is half an answer.

import type { Figure } from '../types.ts';
import { figure, unavailable } from '../types.ts';
import type { StrategyRun } from './run.ts';

export interface SummarySlot {
  labelKey: string;
  figure: Figure;
  kind: 'money' | 'percent' | 'years' | 'months' | 'ratio' | 'number';
  emphasis?: boolean;
  noteKey?: string;
  decimals?: number;
}

const MISSING: Figure = unavailable('MISSING_INPUT');

export function summarySlots(run: StrategyRun): SummarySlot[] {
  switch (run.strategy) {
    case 'RENOVATE_RESELL': {
      const flip = run.flip;
      return [
        {
          labelKey: 'inv_sum_invested_capital',
          figure: flip ? figure(flip.costs.totalInvestedCapital) : MISSING,
          kind: 'money',
        },
        {
          labelKey: 'inv_sum_expected_profit',
          figure: flip?.netProfit ?? MISSING,
          kind: 'money',
          emphasis: true,
        },
        { labelKey: 'inv_sum_roi', figure: flip?.returnOnInvestedCashPercent ?? MISSING, kind: 'percent', decimals: 1 },
        { labelKey: 'inv_sum_annualized', figure: flip?.annualizedReturnPercent ?? MISSING, kind: 'percent', decimals: 1 },
        {
          labelKey: 'inv_sum_breakeven_sale',
          figure: flip?.breakEvenSalePrice ?? MISSING,
          kind: 'money',
          noteKey: 'inv_sum_breakeven_sale_note',
        },
        {
          labelKey: 'inv_sum_margin',
          figure: flip?.marginOfSafetyPercent ?? MISSING,
          kind: 'percent',
          decimals: 1,
          noteKey: 'inv_sum_margin_note',
        },
      ];
    }

    case 'CONSTRUCTION_RESALE': {
      const model = run.construction;
      return [
        {
          labelKey: 'inv_sum_cash_deployed',
          figure: model?.investorCashDeployed ?? MISSING,
          kind: 'money',
          noteKey: 'inv_sum_cash_deployed_note',
        },
        {
          labelKey: 'inv_sum_expected_profit',
          figure: model?.netProfit ?? MISSING,
          kind: 'money',
          emphasis: true,
        },
        { labelKey: 'inv_sum_roi', figure: model?.returnOnInvestorCashPercent ?? MISSING, kind: 'percent', decimals: 1 },
        { labelKey: 'inv_sum_annualized', figure: model?.annualizedReturnPercent ?? MISSING, kind: 'percent', decimals: 1 },
        {
          labelKey: 'inv_sum_breakeven_completed',
          figure: model?.breakEvenExitPrice ?? MISSING,
          kind: 'money',
          noteKey: 'inv_sum_breakeven_completed_note',
        },
        {
          labelKey: 'inv_sum_margin',
          figure: model?.marginOfSafetyPercent ?? MISSING,
          kind: 'percent',
          decimals: 1,
          noteKey: 'inv_sum_margin_note',
        },
      ];
    }

    case 'RENTAL_INVESTMENT': {
      const model = run.model;
      return [
        {
          labelKey: 'inv_sum_your_cash',
          figure: model ? figure(model.capital.investorCashInvested) : MISSING,
          kind: 'money',
        },
        {
          labelKey: 'inv_sum_annual_net_income',
          figure: model?.income.netOperatingIncome ?? MISSING,
          kind: 'money',
          emphasis: true,
          noteKey: 'inv_sum_annual_net_income_note',
        },
        {
          labelKey: 'inv_sum_cash_on_cash',
          figure: model?.yields.cashOnCashReturn ?? MISSING,
          kind: 'percent',
          decimals: 2,
        },
        {
          labelKey: 'inv_sum_net_yield',
          figure: model?.yields.netYieldOnPurchasePrice ?? MISSING,
          kind: 'percent',
          decimals: 2,
        },
        {
          labelKey: 'inv_sum_breakeven_rent',
          figure: model?.breakEven.minimumRentForZeroCashFlow ?? MISSING,
          kind: 'money',
          noteKey: 'inv_sum_breakeven_rent_note',
        },
        {
          labelKey: 'inv_sum_rent_headroom',
          figure: rentHeadroom(model),
          kind: 'percent',
          decimals: 1,
          noteKey: 'inv_sum_rent_headroom_note',
        },
      ];
    }

    case 'INVESTMENT_VALUE': {
      const value = run.value;
      return [
        {
          labelKey: 'inv_sum_target_entry',
          figure: value?.targetEntryPrice ?? MISSING,
          kind: 'money',
          emphasis: true,
          noteKey: 'inv_sum_target_entry_note',
        },
        { labelKey: 'inv_sum_maximum_price', figure: value?.maximumPrice ?? MISSING, kind: 'money' },
        {
          labelKey: 'inv_sum_breakeven_price',
          figure: value?.breakEvenPrice ?? MISSING,
          kind: 'money',
          noteKey: 'inv_sum_breakeven_price_note',
        },
        {
          labelKey: 'inv_sum_profit_at_price',
          figure: value?.profitAtProposedPrice ?? MISSING,
          kind: 'money',
        },
        {
          labelKey: 'inv_sum_return_at_price',
          figure: value?.returnAtProposedPricePercent ?? MISSING,
          kind: 'percent',
          decimals: 1,
        },
        {
          labelKey: 'inv_sum_margin',
          figure: value?.marginOfSafetyPercent ?? MISSING,
          kind: 'percent',
          decimals: 1,
          noteKey: 'inv_sum_margin_note',
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * How far the rent can fall before the deal stops covering itself.
 *
 * The rental equivalent of a flip's margin of safety, and computed the same
 * way: distance from the expectation to the break-even, as a share of the
 * expectation. Reported only when both exist — a headroom of "100%" because
 * there is no mortgage to miss would be a flattering accident, not a fact,
 * so an unfinanced deal with no break-even rent says so instead.
 */
function rentHeadroom(model: StrategyRun['model']): Figure {
  if (!model) return MISSING;
  const rent = model.input.monthlyRent;
  const floor = model.breakEven.minimumRentForZeroCashFlow.value;
  if (typeof rent !== 'number' || !Number.isFinite(rent) || rent <= 0) {
    return unavailable('MISSING_INPUT');
  }
  if (floor === null) return model.breakEven.minimumRentForZeroCashFlow;
  return figure(((rent - floor) / rent) * 100);
}
