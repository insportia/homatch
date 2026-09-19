// HOMATCH INVESTMENT INTELLIGENCE — the shapes the deterministic engine
// speaks.
//
// WHY THIS IS PLAIN TYPESCRIPT WITH NO IMPORTS BEYOND src/mortgage
//
// The same rule src/mortgage/types.ts states, for the same three consumers:
// the Vite build, Node's native test runner (type-stripping, so the tests
// import the REAL module rather than a copy of it), and the Deno Edge
// runtime, which imports these files by relative path with explicit `.ts`
// specifiers exactly as deal-room-ai already imports src/dealroom/domain.
// No React, no Supabase, no `node:` anything.
//
// WHAT AN `InvestmentInput` IS, AND WHAT IT IS NOT
//
// It is what somebody has actually told us or what Homatch already knew. It
// is NOT a filled-in form: every field beyond `purchasePrice`, `currency`
// and `holdMonths` is optional, and an absent field produces an absent
// answer with a named reason rather than a default that looks like a fact.
// A 5% vacancy nobody asked for is indistinguishable, once rendered, from a
// 5% vacancy somebody measured.
//
// PROVENANCE IS PART OF THE DATA, NOT A UI DECORATION
//
// Every number the consultation collects carries where it came from — the
// user said it, the property record carried it, research observed it, or the
// engine derived it. `ValueOrigin` is threaded through the CONTEXT (see
// consultant/context.ts) rather than through the calculation output, because
// a calculated figure is always DERIVED; what matters is the provenance of
// its inputs, and that is what the UI must be able to show beside each one.

/** Where a single input value came from. Never guessed, never widened. */
export type InvestmentValueOrigin =
  /** The person typed it or confirmed it. */
  | 'USER'
  /** Read off a Homatch property record the user attached. */
  | 'PROPERTY'
  /** Observed by the Research Core and EXPLICITLY applied by the user. */
  | 'RESEARCH'
  /** Computed by this engine from other inputs. */
  | 'DERIVED';

/**
 * Why a figure could not be produced.
 *
 * A null with a reason is the only acceptable "no answer" in this engine. A
 * zero, a dash, or an omitted key all read as "nothing to worry about", and
 * two of the three are lies.
 */
export type UnavailableReason =
  /** An input this figure is arithmetically made of was never supplied. */
  | 'MISSING_INPUT'
  /** The arithmetic exists but has no real-world meaning here. */
  | 'NOT_MEANINGFUL'
  /** Income is zero or negative, so a recovery period does not exist. */
  | 'NO_POSITIVE_INCOME'
  /** Cash flow never turns positive, so it never pays back. */
  | 'NEVER_RECOVERS'
  /** The scenario is not financed, so a debt figure has no subject. */
  | 'NOT_FINANCED';

/** A number that might legitimately not exist, with the reason when it does not. */
export interface Figure {
  value: number | null;
  unavailable: UnavailableReason | null;
  /** Machine-readable detail for the UI's explanation, never prose. */
  detail?: string;
}

export function figure(value: number): Figure {
  return { value, unavailable: null };
}

export function unavailable(reason: UnavailableReason, detail?: string): Figure {
  return { value: null, unavailable: reason, ...(detail ? { detail } : {}) };
}

/* ── Inputs ─────────────────────────────────────────────────────────── */

/**
 * The financing leg. Present only when the investor is actually borrowing.
 *
 * Mirrors what src/mortgage/types.ts MortgageInput needs, because that is
 * the mortgage authority and this engine does not compute a payment itself.
 */
export interface InvestmentFinancing {
  /** Exactly one of these two is used; percent wins when both are present. */
  downPaymentPercent?: number;
  downPaymentAmount?: number;
  annualRatePercent: number;
  termMonths: number;
  /** One-time, % of the loan. Passed straight through to the mortgage engine. */
  originationFeePercent?: number;
  originationFeeFlat?: number;
  monthlyFeeFlat?: number;
  annualFeeFlat?: number;
  valuationFeeFlat?: number;
  mandatoryInsuranceAnnualFlat?: number;
}

/**
 * The operating cost block.
 *
 * Every entry is optional and every absent entry is reported as a NAMED GAP
 * rather than as zero — see `OperatingExpenseBreakdown.knownGaps`. A net
 * yield computed over three of the eight costs a property really has is not
 * a net yield, and the only defence against presenting one as if it were is
 * to say which costs were never supplied.
 */
export interface InvestmentOperatingCosts {
  /** Management as a share of collected (effective) rent. */
  managementPercentOfCollectedRent?: number;
  managementFlatMonthly?: number;
  maintenanceAnnual?: number;
  repairsAnnual?: number;
  insuranceAnnual?: number;
  propertyTaxAnnual?: number;
  utilitiesPaidByOwnerAnnual?: number;
  /** Building service charge / HOA, as an annual figure. */
  hoaAnnual?: number;
  /**
   * Money set aside each year against the repair that has not happened yet.
   *
   * Separate from `repairsAnnual`, which is repairs actually expected. A
   * reserve is a deliberate provision and an investor who keeps one is
   * running a different, more honest set of numbers than one who does not —
   * so it is its own line rather than folded into maintenance.
   */
  repairsReserveAnnual?: number;
  otherOperatingAnnual?: number;
  /** Agency/letting fee charged once per new tenancy. */
  lettingFeePerTenancy?: number;
  /** How many new tenancies a year the scenario assumes. */
  tenanciesPerYear?: number;
}

export interface InvestmentSubject {
  /** Free text, exactly as the user or the property record has it. */
  city?: string;
  district?: string;
  address?: string;
  projectName?: string;
  propertyType?: string;
  rooms?: number;
  bedrooms?: number;
  floor?: number;
  areaSqm?: number;
  condition?: string;
  /** The Homatch property this scenario was attached to, when there is one. */
  propertyId?: string;
}

export interface InvestmentInput {
  currency: string;
  /** What the investor pays. Distinct from `askingPrice` on purpose. */
  purchasePrice: number;
  /** What the seller is asking, when that differs from the purchase scenario. */
  askingPrice?: number;

  subject?: InvestmentSubject;

  /* Income */
  monthlyRent?: number;
  /** Income that is not rent (parking let separately, storage). Annual. */
  otherAnnualIncome?: number;
  /**
   * Months of the year the unit is expected to be EMPTY. 0–12.
   *
   * Deliberately expressed as months rather than a percentage: "one month
   * between tenants" is how a landlord actually thinks about it, and 8.33%
   * is the same fact in a form nobody volunteers.
   */
  vacantMonthsPerYear?: number;

  operating?: InvestmentOperatingCosts;

  /* Capital going in */
  /** Notary, agency, registration. Absolute. */
  acquisitionCosts?: number;
  /** Same thing expressed against the purchase price. Absolute wins. */
  acquisitionCostPercent?: number;
  renovationCost?: number;
  furnishingCost?: number;

  financing?: InvestmentFinancing;

  /* Time and exit */
  /** How long the investor intends to hold, in months. */
  holdMonths?: number;
  /**
   * The exit price the USER is modelling. Never a forecast, never derived
   * from a trend, and labelled as a scenario everywhere it is shown.
   */
  exitPriceAssumption?: number;
  sellingCostPercent?: number;
  sellingCostAmount?: number;

  /**
   * The yield the investor treats as acceptable. Used for the income-implied
   * valuation lens and for nothing else — it never changes a cash figure.
   */
  benchmarkYieldPercent?: number;
}

/* ── Income and yield ───────────────────────────────────────────────── */

export interface OperatingExpenseLine {
  key: string;
  annual: number;
}

export interface OperatingExpenseBreakdown {
  lines: OperatingExpenseLine[];
  totalAnnual: number;
  /**
   * Cost categories the scenario carries NO figure for.
   *
   * This is the difference between "this property has no property tax" and
   * "nobody told us what the property tax is", and the net yield beside it
   * means something different in each case.
   */
  knownGaps: string[];
}

export interface IncomeModel {
  /** Twelve months of rent plus other income. Nothing deducted. */
  grossPotentialAnnualIncome: Figure;
  /** Rent lost to the vacant months the scenario assumes. */
  vacancyLossAnnual: Figure;
  /** What is actually collected: gross potential less vacancy. */
  effectiveGrossIncome: Figure;
  operatingExpenses: OperatingExpenseBreakdown | null;
  /** Effective gross income less operating costs. Before any debt. */
  netOperatingIncome: Figure;
  /** Months of the year the model assumes rent is collected. */
  occupiedMonths: number;
  occupancyRate: Figure;
}

export interface YieldModel {
  /** Gross potential income over the PURCHASE PRICE. */
  grossYieldOnPurchasePrice: Figure;
  /** Gross potential income over every currency unit actually invested. */
  grossYieldOnInvestedCapital: Figure;
  /** Net operating income over the purchase price. */
  netYieldOnPurchasePrice: Figure;
  netYieldOnInvestedCapital: Figure;
  /** Net operating income less debt service, over the investor's own cash. */
  cashOnCashReturn: Figure;
}

/* ── Valuation lens ─────────────────────────────────────────────────── */

/** Which income figure an implied value was computed from. Never blended. */
export type IncomeBasis =
  | 'GROSS_POTENTIAL'
  | 'EFFECTIVE_GROSS'
  | 'NET_OPERATING';

export interface ImpliedValuePoint {
  requiredYieldPercent: number;
  impliedValue: number;
}

export interface ImpliedValuation {
  basis: IncomeBasis;
  annualIncome: number;
  /** At the investor's own benchmark, when they gave one. */
  atBenchmark: Figure;
  /** The whole curve, so the inverse relationship is visible rather than told. */
  spectrum: ImpliedValuePoint[];
}

/* ── Capital and recovery ───────────────────────────────────────────── */

export interface InvestedCapital {
  purchasePrice: number;
  acquisitionCosts: number;
  renovationCost: number;
  furnishingCost: number;
  /** Everything the property costs to own, financed or not. */
  totalPropertyCapital: number;
  /** The investor's own cash: equity plus every cost debt does not cover. */
  investorCashInvested: number;
  /** One-time financing charges, included in investorCashInvested. */
  financingUpfrontCosts: number;
  loanAmount: number;
}

export interface RecoveryPoint {
  month: number;
  cumulativeNetCashFlow: number;
  /** Principal repaid to date. Equity built, not cash received. */
  cumulativePrincipalRepaid: number;
}

export interface PaybackModel {
  /**
   * Total property capital divided by unlevered net income.
   *
   * The question "when does the PROPERTY pay for itself" — independent of
   * who financed it.
   */
  propertyPaybackYears: Figure;
  /**
   * The investor's own cash divided by the cash the investor actually
   * receives after debt service. A different question with a different
   * answer, and conflating the two is the most common way a leveraged deal
   * is oversold.
   */
  equityPaybackYears: Figure;
  /** Month at which cumulative net cash flow first covers the cash invested. */
  equityRecoveryMonth: Figure;
  /** Monthly, for the timeline. Capped at 40 years. */
  timeline: RecoveryPoint[];
}

/* ── Financing ──────────────────────────────────────────────────────── */

export interface LeverageModel {
  financed: boolean;
  loanAmount: Figure;
  downPayment: Figure;
  loanToValuePercent: Figure;
  monthlyPayment: Figure;
  annualDebtService: Figure;
  /** Over the hold period, not over the whole term. */
  interestPaidOverHold: Figure;
  principalRepaidOverHold: Figure;
  remainingDebtAtExit: Figure;
  /** Net operating income divided by debt service. Below 1 means a top-up. */
  debtServiceCoverageRatio: Figure;
  /** Net operating income less debt service, per year. */
  annualNetCashFlowAfterDebt: Figure;
  /** Effective annual rate, when the mortgage engine could compute one. */
  effectiveAnnualRatePercent: Figure;
}

/* ── Hold and exit ──────────────────────────────────────────────────── */

export interface HoldAndExitModel {
  holdMonths: number;
  /** Rent actually collected across the hold, vacancy already removed. */
  rentCollectedOverHold: Figure;
  operatingCostsOverHold: Figure;
  debtServiceOverHold: Figure;
  /** Collected rent less operating costs less debt service. */
  netCashFlowOverHold: Figure;

  /** The USER'S exit scenario. Never a forecast. */
  exitPrice: Figure;
  sellingCosts: Figure;
  debtPayoff: Figure;
  /** Exit price less selling costs less debt payoff. */
  netSaleProceeds: Figure;

  totalCashInvested: Figure;
  /** Operating cash flow plus net sale proceeds. */
  totalCashReturned: Figure;
  profit: Figure;
  returnOnInvestedCashPercent: Figure;
  /** Only when the arithmetic is valid; null with a reason otherwise. */
  annualizedReturnPercent: Figure;

  /** The part of the profit that came from the price, not from the rent. */
  capitalGainComponent: Figure;
  /** The part that came from rent, net of costs and debt service. */
  incomeComponent: Figure;
}

/* ── Break-even ─────────────────────────────────────────────────────── */

export interface BreakEvenModel {
  /** Monthly rent at which net operating income reaches zero. */
  minimumRentForZeroNoi: Figure;
  /** Monthly rent at which cash flow after debt service reaches zero. */
  minimumRentForZeroCashFlow: Figure;
  /** Occupied months a year needed for cash flow after debt to reach zero. */
  minimumOccupiedMonths: Figure;
  /** Exit price at which the whole hold-and-sell scenario breaks even. */
  breakEvenExitPrice: Figure;
  breakEvenExitPricePerSqm: Figure;
  /** The largest renovation spend that still leaves the scenario at zero. */
  maximumRenovationBudget: Figure;
  /** First month cumulative cash flow after debt turns positive. */
  cashFlowBreakEvenMonth: Figure;
}

/* ── Scenario / sensitivity ─────────────────────────────────────────── */

export type SensitivityAxis =
  | 'EXIT_PRICE'
  | 'HOLD_MONTHS'
  | 'VACANT_MONTHS'
  | 'MONTHLY_RENT'
  | 'INTEREST_RATE'
  | 'RENOVATION_COST';

export type SensitivityMetric =
  | 'PROFIT'
  | 'RETURN_ON_INVESTED_CASH'
  | 'ANNUALIZED_RETURN'
  | 'NET_YIELD'
  | 'ANNUAL_NET_CASH_FLOW'
  | 'EQUITY_PAYBACK_YEARS';

export interface SensitivityCell {
  rowValue: number;
  columnValue: number | null;
  metric: Figure;
}

export interface SensitivityGrid {
  metric: SensitivityMetric;
  rowAxis: SensitivityAxis;
  columnAxis: SensitivityAxis | null;
  rowValues: number[];
  columnValues: number[];
  cells: SensitivityCell[];
  /** Base-case metric, so every cell can be read as a movement from it. */
  baseline: Figure;
}

export interface ExitDelayRow {
  delayMonths: number;
  holdMonths: number;
  additionalInterest: Figure;
  additionalOperatingCosts: Figure;
  additionalRentCollected: Figure;
  remainingDebtAtExit: Figure;
  profit: Figure;
  returnOnInvestedCashPercent: Figure;
  /** Profit change against the on-time exit. Negative is a cost of waiting. */
  profitDelta: Figure;
}

/* ── Capital flow ───────────────────────────────────────────────────── */

export type CapitalFlowNodeKind =
  | 'SOURCE'
  | 'COST'
  | 'ASSET'
  | 'INCOME'
  | 'DEBT'
  | 'EXIT'
  | 'RESULT';

export interface CapitalFlowNode {
  id: string;
  kind: CapitalFlowNodeKind;
  /** i18n key. This engine emits no customer-facing prose. */
  labelKey: string;
  amount: number | null;
  /** Negative amounts are money leaving the investor. */
  signed: boolean;
}

export interface CapitalFlowEdge {
  from: string;
  to: string;
  amount: number;
}

export interface CapitalFlowModel {
  nodes: CapitalFlowNode[];
  edges: CapitalFlowEdge[];
}

/* ── The whole model ────────────────────────────────────────────────── */

export interface InvestmentValidationError {
  field: keyof InvestmentInput | 'general';
  /** i18n key. Resolved by the UI; this engine renders no text. */
  messageKey: string;
}

export interface InvestmentModel {
  input: InvestmentInput;
  currency: string;
  income: IncomeModel;
  yields: YieldModel;
  capital: InvestedCapital;
  /** One entry per income basis, so nothing is silently chosen for the user. */
  impliedValuations: ImpliedValuation[];
  payback: PaybackModel;
  leverage: LeverageModel;
  holdAndExit: HoldAndExitModel | null;
  breakEven: BreakEvenModel;
  capitalFlow: CapitalFlowModel | null;
  /**
   * Inputs this model needed and did not have, as i18n keys.
   *
   * Shown to the user as the Consultant's next questions, and handed to the
   * AI so it asks about what is genuinely missing rather than about whatever
   * occurs to it.
   */
  missingInputs: string[];
}
