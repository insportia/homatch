// totalBudget.ts — TOTAL PROPERTY BUDGET.
//
// Answers the question a listing price never does:
//
//   "This $160,000 apartment — how much capital do I actually need to buy it
//    and make it usable?"
//
// HARD RULE: only KNOWN or USER-ENTERED amounts are included. No invented
// taxes, no assumed agent fees, no jurisdiction-specific charges that were not
// explicitly configured. A number the customer cannot verify is worse than an
// absent one, because it silently changes their decision. Anything unknown is
// reported as unknown and EXCLUDED from the total.
//
// Renovation is NOT assumed to be mortgage-financed. Unless a financing
// product explicitly supports it, renovation is cash the buyer needs on top of
// the down payment — which is precisely the trap this screen exists to expose.

export type Currency = 'GEL' | 'USD';

export interface CostLine {
  key: string;
  label: string;
  amount: number;
  currency: Currency;
  /** Where the number came from. 'UNKNOWN' lines are shown but not summed. */
  origin: 'USER_ENTERED' | 'FROM_VERIFY' | 'FROM_RENOVATION' | 'FROM_MORTGAGE' | 'UNKNOWN';
  /** True when this amount must be paid in cash rather than financed. */
  cash: boolean;
  note?: string;
}

export interface MortgageContext {
  purchasePrice: number;
  downPayment: number;
  loanAmount: number;
  monthlyPayment: number;
  currency: Currency;
  /** Only true when an actual product finances renovation. */
  financesRenovation?: boolean;
}

export interface BudgetInput {
  currency: Currency;
  purchasePrice?: number | null;
  parkingPrice?: number | null;
  renovation?: { planningBudget: number; currency: Currency; provisional: boolean } | null;
  mortgage?: MortgageContext | null;
  /** Explicitly configured, verifiable extra costs only. */
  otherCosts?: { key: string; label: string; amount: number }[];
  /** FX only used when a figure is genuinely in the other currency. */
  usdPerGel?: number | null;
}

export interface TotalBudget {
  currency: Currency;
  lines: CostLine[];
  /** Everything the purchase costs, financed or not. */
  totalAcquisitionCost: number;
  /** What the buyer must actually have in cash. */
  cashRequired: number;
  financed: number;
  monthlyPayment: number | null;
  /** Items we know exist but cannot price — listed, never guessed. */
  unknowns: string[];
  provisional: boolean;
}

function convert(amount: number, from: Currency, to: Currency, usdPerGel: number | null | undefined): number | null {
  if (from === to) return amount;
  if (!usdPerGel || usdPerGel <= 0) return null; // no rate: refuse rather than guess
  return from === 'GEL' ? amount * usdPerGel : amount / usdPerGel;
}

export function buildTotalBudget(input: BudgetInput): TotalBudget {
  const currency = input.currency;
  const lines: CostLine[] = [];
  const unknowns: string[] = [];
  let provisional = false;

  const add = (line: CostLine) => lines.push(line);

  // ---- purchase ----------------------------------------------------------
  if (typeof input.purchasePrice === 'number' && input.purchasePrice > 0) {
    add({
      key: 'purchase',
      label: 'ქონების ფასი',
      amount: input.purchasePrice,
      currency,
      origin: 'USER_ENTERED',
      cash: !input.mortgage,
    });
  } else {
    unknowns.push('ქონების ფასი');
  }

  if (typeof input.parkingPrice === 'number' && input.parkingPrice > 0) {
    add({ key: 'parking', label: 'პარკინგი', amount: input.parkingPrice, currency, origin: 'USER_ENTERED', cash: true });
  }

  // ---- renovation --------------------------------------------------------
  if (input.renovation && input.renovation.planningBudget > 0) {
    const converted = convert(input.renovation.planningBudget, input.renovation.currency, currency, input.usdPerGel);
    if (converted === null) {
      unknowns.push('რემონტის ბიუჯეტი (ვალუტის კურსი მითითებული არ არის)');
    } else {
      provisional = provisional || input.renovation.provisional;
      add({
        key: 'renovation',
        label: 'რემონტის სავარაუდო ბიუჯეტი',
        amount: converted,
        currency,
        origin: 'FROM_RENOVATION',
        // Renovation is cash unless a product explicitly finances it.
        cash: !input.mortgage?.financesRenovation,
        note: input.renovation.provisional ? 'წინასწარი შეფასება' : undefined,
      });
    }
  } else {
    unknowns.push('რემონტის ბიუჯეტი');
  }

  // ---- explicitly configured extras only ---------------------------------
  for (const c of input.otherCosts ?? []) {
    if (typeof c.amount === 'number' && c.amount > 0) {
      add({ key: c.key, label: c.label, amount: c.amount, currency, origin: 'USER_ENTERED', cash: true });
    }
  }

  // ---- totals ------------------------------------------------------------
  const totalAcquisitionCost = round2(lines.reduce((s, l) => s + l.amount, 0));

  let cashRequired: number;
  let financed = 0;
  const m = input.mortgage;
  if (m) {
    const loan = convert(m.loanAmount, m.currency, currency, input.usdPerGel) ?? 0;
    financed = round2(loan);
    // Everything except the financed portion is cash.
    cashRequired = round2(Math.max(0, totalAcquisitionCost - financed));
  } else {
    cashRequired = totalAcquisitionCost;
  }

  return {
    currency,
    lines,
    totalAcquisitionCost,
    cashRequired,
    financed,
    monthlyPayment: m ? (convert(m.monthlyPayment, m.currency, currency, input.usdPerGel) ?? null) : null,
    unknowns,
    provisional,
  };
}

/**
 * Customer-facing rounding. A total assembled from a preliminary renovation
 * estimate cannot be exact, so it must not look exact.
 */
export function displayTotal(budget: TotalBudget): { total: number; cash: number; step: number } {
  const step = budget.totalAcquisitionCost >= 100000 ? 5000 : budget.totalAcquisitionCost >= 20000 ? 1000 : 500;
  return {
    total: Math.round(budget.totalAcquisitionCost / step) * step,
    cash: Math.round(budget.cashRequired / step) * step,
    step,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
