// HOMATCH INVESTMENT INTELLIGENCE — the capital flow, as data.
//
// This file emits a graph and no pixels: nodes with i18n keys and signed
// amounts, edges with the amount that travels along them. The renderer
// decides what that looks like, and because the amounts are real the
// drawing can be proportional rather than decorative — a ribbon whose width
// is the money is worth looking at; one whose width is a constant is a
// flowchart with a gradient on it.
//
// SIGN CONVENTION
//
// `signed: true` means the amount is money LEAVING the investor and the
// renderer should show it as an outflow. The engine does not negate the
// numbers itself, because a cost is naturally quoted positive and a
// renderer that has to remember which fields are pre-negated will
// eventually forget.
//
// Nodes whose amount is null are part of the structure but have no figure
// yet — the exit column before the investor has named an exit price. They
// are returned rather than omitted so the diagram keeps its shape while the
// consultation fills it in, which is the whole visual idea: the same
// picture, progressively becoming real.

import type {
  CapitalFlowEdge,
  CapitalFlowModel,
  CapitalFlowNode,
  HoldAndExitModel,
  IncomeModel,
  InvestedCapital,
  LeverageModel,
} from '../types.ts';

export function buildCapitalFlow(args: {
  capital: InvestedCapital;
  income: IncomeModel;
  leverage: LeverageModel;
  holdAndExit: HoldAndExitModel | null;
}): CapitalFlowModel {
  const { capital, income, leverage, holdAndExit } = args;
  const nodes: CapitalFlowNode[] = [];
  const edges: CapitalFlowEdge[] = [];

  const node = (
    id: string,
    kind: CapitalFlowNode['kind'],
    labelKey: string,
    amount: number | null,
    signed = false,
  ) => {
    nodes.push({ id, kind, labelKey, amount, signed });
  };
  const edge = (from: string, to: string, amount: number | null) => {
    if (amount === null || !Number.isFinite(amount) || amount === 0) return;
    edges.push({ from, to, amount: Math.abs(amount) });
  };

  /* ── What goes in ─────────────────────────────────────────────── */
  const equity = leverage.downPayment.value ?? capital.purchasePrice;
  node('investorCash', 'SOURCE', 'inv_flow_investor_cash', capital.investorCashInvested, true);
  node('equity', 'SOURCE', 'inv_flow_equity', equity, true);

  if (leverage.financed && (leverage.loanAmount.value ?? 0) > 0) {
    node('loan', 'DEBT', 'inv_flow_loan', leverage.loanAmount.value, false);
    edge('loan', 'property', leverage.loanAmount.value);
  }

  node('acquisition', 'COST', 'inv_flow_acquisition', capital.acquisitionCosts, true);
  if (capital.renovationCost > 0) {
    node('renovation', 'COST', 'inv_flow_renovation', capital.renovationCost, true);
    edge('investorCash', 'renovation', capital.renovationCost);
    edge('renovation', 'property', capital.renovationCost);
  }
  if (capital.furnishingCost > 0) {
    node('furnishing', 'COST', 'inv_flow_furnishing', capital.furnishingCost, true);
    edge('investorCash', 'furnishing', capital.furnishingCost);
    edge('furnishing', 'property', capital.furnishingCost);
  }

  edge('investorCash', 'equity', equity);
  edge('equity', 'property', equity);
  edge('investorCash', 'acquisition', capital.acquisitionCosts);
  edge('acquisition', 'property', capital.acquisitionCosts);

  /* ── The asset ────────────────────────────────────────────────── */
  node('property', 'ASSET', 'inv_flow_property', capital.totalPropertyCapital, false);

  /* ── What it produces, and what that costs ────────────────────── */
  node('rent', 'INCOME', 'inv_flow_rent_collected', income.effectiveGrossIncome.value, false);
  edge('property', 'rent', income.effectiveGrossIncome.value);

  if (income.operatingExpenses) {
    node('operating', 'COST', 'inv_flow_operating', income.operatingExpenses.totalAnnual, true);
    edge('rent', 'operating', income.operatingExpenses.totalAnnual);
  }

  if (leverage.financed) {
    node('interest', 'DEBT', 'inv_flow_interest', leverage.interestPaidOverHold.value, true);
    node('principal', 'DEBT', 'inv_flow_principal', leverage.principalRepaidOverHold.value, false);
    edge('rent', 'interest', leverage.interestPaidOverHold.value);
    edge('rent', 'principal', leverage.principalRepaidOverHold.value);
  }

  node(
    'netCashFlow',
    'INCOME',
    'inv_flow_net_cash_flow',
    holdAndExit?.netCashFlowOverHold.value ?? leverage.annualNetCashFlowAfterDebt.value ?? null,
    false,
  );
  edge('rent', 'netCashFlow', holdAndExit?.netCashFlowOverHold.value ?? null);

  /* ── The exit ─────────────────────────────────────────────────── */
  node('exit', 'EXIT', 'inv_flow_sale', holdAndExit?.exitPrice.value ?? null, false);
  node('sellingCosts', 'COST', 'inv_flow_selling_costs', holdAndExit?.sellingCosts.value ?? null, true);
  node('debtPayoff', 'DEBT', 'inv_flow_debt_payoff', holdAndExit?.debtPayoff.value ?? null, true);
  node('equityReturned', 'RESULT', 'inv_flow_equity_returned', holdAndExit?.netSaleProceeds.value ?? null, false);
  node('finalResult', 'RESULT', 'inv_flow_final_result', holdAndExit?.profit.value ?? null, false);

  edge('property', 'exit', holdAndExit?.exitPrice.value ?? null);
  edge('exit', 'sellingCosts', holdAndExit?.sellingCosts.value ?? null);
  edge('exit', 'debtPayoff', holdAndExit?.debtPayoff.value ?? null);
  edge('exit', 'equityReturned', holdAndExit?.netSaleProceeds.value ?? null);
  edge('equityReturned', 'finalResult', holdAndExit?.netSaleProceeds.value ?? null);
  edge('netCashFlow', 'finalResult', holdAndExit?.netCashFlowOverHold.value ?? null);

  return { nodes, edges };
}
