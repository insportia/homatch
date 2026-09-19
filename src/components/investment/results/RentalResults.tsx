// HOMATCH INVESTMENT INTELLIGENCE — the buy-and-hold result.
//
// Every module here already existed. A rental analysis is the case the
// original engine was built around, so this file is composition and
// ordering, not arithmetic: income first, then what the money cost, then
// what it comes back as, then what breaks it.
//
// The exit modules only appear when the investor said there is an exit.
// A hold-forever landlord asked to read a sale scenario is being sold
// somebody else's strategy.

import React from 'react';
import type { InvestmentModel } from '@/investment/types';
import type { MarketComparableRange } from '@/investment/calculations/valuation';
import { IncomeAndYieldModule, ImpliedValueModule, PricePositionModule } from '../IncomeAndYield';
import { FinancingModule } from '../Financing';
import { MoneyBackModule } from '../MoneyBack';
import {
  BreakEvenModule,
  ExitDelayModule,
  HoldAndExitModule,
  ScenarioLabModule,
} from '../Scenarios';
import { CapitalFlowModule } from '../CapitalFlow';

export function RentalResults({
  model,
  missing,
  comparableRange,
  showExit,
  onVacancyChange,
  onBenchmarkChange,
  onHoldChange,
  onExitPriceChange,
  onResearch,
  researchAvailable,
}: {
  model: InvestmentModel;
  missing: string[];
  comparableRange: MarketComparableRange | null;
  showExit: boolean;
  onVacancyChange: (months: number) => void;
  onBenchmarkChange: (percent: number) => void;
  onHoldChange: (months: number) => void;
  onExitPriceChange: (price: number) => void;
  onResearch: () => void;
  researchAvailable: boolean;
}) {
  return (
    <>
      <IncomeAndYieldModule
        model={model}
        focused={false}
        missing={missing}
        onVacancyChange={onVacancyChange}
      />
      <FinancingModule model={model} focused={false} missing={missing} />
      <MoneyBackModule model={model} focused={false} missing={missing} />
      <ImpliedValueModule
        model={model}
        focused={false}
        missing={missing}
        onBenchmarkChange={onBenchmarkChange}
      />
      <PricePositionModule
        model={model}
        comparableRange={comparableRange}
        focused={false}
        onResearch={onResearch}
        researchAvailable={researchAvailable}
      />
      {showExit ? (
        <>
          <HoldAndExitModule
            model={model}
            focused={false}
            missing={missing}
            onHoldChange={onHoldChange}
            onExitPriceChange={onExitPriceChange}
          />
          <ExitDelayModule model={model} focused={false} />
        </>
      ) : null}
      <BreakEvenModule model={model} focused={false} />
      <ScenarioLabModule model={model} focused={false} />
      <CapitalFlowModule model={model} focused={false} />
    </>
  );
}
