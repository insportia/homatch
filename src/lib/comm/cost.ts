// HOMATCH Communications — what a call or a conversation actually cost, and
// what the customer is charged for it.
//
// §44 and §45. Two separate questions, and conflating them is how a margin
// silently goes negative:
//
//   COGS      what Homatch paid providers. Measured, then reconciled against
//             an invoice. Never a guess once an actual exists.
//   PRICE     what the customer pays. COGS + markup + tax, at the rates that
//             were in force on the day the usage happened.
//
// WHY NO NUMBER IN THIS FILE IS A PRICE
//
// The same rule _shared/billing.ts already states: every rate arrives as an
// argument. There is no VAT rate, no markup and no provider rate card
// compiled into this module. 18% VAT is today's Georgian rate and it is
// current COMMERCIAL MODELLING, not a constant — it belongs in
// pricing_versions and admin_settings, effective-dated, so that a rate change
// in March does not silently re-price February.

export type CostSource = 'PROVIDER_ACTUAL' | 'PROVIDER_INVOICE' | 'CONFIGURED_PRICE' | 'FALLBACK_ESTIMATE';

/**
 * The order §44 requires. A lower number is more authoritative, and a cost row
 * is only ever overwritten by something at least as authoritative as what is
 * already there.
 */
const SOURCE_RANK: Record<CostSource, number> = {
  PROVIDER_INVOICE: 0,
  PROVIDER_ACTUAL: 1,
  CONFIGURED_PRICE: 2,
  FALLBACK_ESTIMATE: 3,
};

export function isBetterCostSource(incoming: CostSource, existing: CostSource | null | undefined): boolean {
  if (!existing) return true;
  return SOURCE_RANK[incoming] < SOURCE_RANK[existing];
}

/**
 * One line of provider spend.
 *
 * `bundledWith` is the double-count guard §44 demands, and it exists because
 * of a specific, real shape: an orchestrator like Vapi bills ONE per-minute
 * figure that already contains the STT, the LLM and the TTS it used. If the
 * STT provider also reports that minute — because we asked it directly, or
 * because its own dashboard is being reconciled — the same second of speech is
 * paid for twice in our books and the margin report is wrong. A component that
 * names the component it is bundled inside is dropped when that one is present.
 */
export interface CostComponent {
  component: 'TELEPHONY' | 'ORCHESTRATION' | 'STT' | 'LLM' | 'TTS' | 'RECORDING' | 'STORAGE' | 'MESSAGING' | 'OTHER';
  provider: string;
  /** Minor units, USD cents. Fractional cents are normal and are kept. */
  cents: number;
  source: CostSource;
  units?: number;
  unit?: string;
  /** When present and that component is also in the list, this line is dropped. */
  bundledWith?: CostComponent['component'];
  providerRequestId?: string;
}

export interface CogsResult {
  totalCents: number;
  /** The lines that counted. */
  components: CostComponent[];
  /** The lines that were dropped, and why — so a margin report can be explained. */
  suppressed: Array<CostComponent & { suppressedBecause: string }>;
  /** The weakest source that contributed. A total is only as good as this. */
  source: CostSource;
}

/** Sum provider spend, dropping anything already paid for inside something else. */
export function computeCogs(components: CostComponent[]): CogsResult {
  const present = new Set(components.map((c) => c.component));
  const kept: CostComponent[] = [];
  const suppressed: Array<CostComponent & { suppressedBecause: string }> = [];

  // A component can only be dropped by a line that is itself kept, so a
  // bundle that is not actually present cannot swallow its children.
  for (const c of components) {
    if (c.bundledWith && present.has(c.bundledWith)) {
      suppressed.push({ ...c, suppressedBecause: `already billed inside ${c.bundledWith}` });
      continue;
    }
    kept.push(c);
  }

  // The same provider request id appearing twice is a duplicate webhook that
  // got past the event-level guard, not two real charges.
  const seen = new Map<string, CostComponent>();
  const deduped: CostComponent[] = [];
  for (const c of kept) {
    const key = c.providerRequestId ? `${c.provider}:${c.component}:${c.providerRequestId}` : '';
    if (key && seen.has(key)) {
      suppressed.push({ ...c, suppressedBecause: `duplicate of provider request ${c.providerRequestId}` });
      continue;
    }
    if (key) seen.set(key, c);
    deduped.push(c);
  }

  const totalCents = deduped.reduce((sum, c) => sum + (Number.isFinite(c.cents) ? c.cents : 0), 0);
  const source = deduped.reduce<CostSource>(
    (worst, c) => (SOURCE_RANK[c.source] > SOURCE_RANK[worst] ? c.source : worst),
    'PROVIDER_INVOICE',
  );

  return { totalCents: round6(totalCents), components: deduped, suppressed, source };
}

export interface PriceInput {
  cogsCents: number;
  /** Basis points over COGS. 3000 = 30%. From billable_products / pricing_versions. */
  markupBps: number;
  /** Basis points. 1800 = 18%. From admin_settings, effective-dated. */
  taxBps: number;
  /** Floor the product refuses to go below, from billable_products.min_gross_margin_bps. */
  minGrossMarginBps?: number;
  /** A product with a fixed retail price ignores markup and prices from this. */
  fixedRetailCents?: number | null;
}

export interface PriceResult {
  cogsCents: number;
  markupCents: number;
  netCents: number;
  taxCents: number;
  /** What the customer pays. The only figure a non-admin ever sees. */
  grossCents: number;
  /** Basis points actually achieved, after any floor was applied. */
  realisedMarginBps: number;
  marginFloorApplied: boolean;
}

/**
 * raw eligible COGS + markup + tax = customer charge (§45).
 *
 * Tax is applied to the NET, which is how VAT works: it is a tax on the price
 * Homatch charges, not an extra margin on top of one. Charging markup on tax
 * would inflate the bill and misstate the liability.
 */
export function computePrice(input: PriceInput): PriceResult {
  const cogs = Math.max(0, Number(input.cogsCents) || 0);

  let net: number;
  let marginFloorApplied = false;

  if (input.fixedRetailCents != null) {
    net = Math.max(0, input.fixedRetailCents);
  } else {
    net = cogs * (1 + Math.max(0, input.markupBps) / 10_000);
  }

  // The floor is a margin the product will not sell below. It matters when a
  // provider's actual cost came in above the reference the price was set from
  // — the customer is charged the floor rather than Homatch quietly selling at
  // a loss, and the flag says it happened so finance can see it.
  if (input.minGrossMarginBps && cogs > 0) {
    const floorNet = cogs / (1 - Math.min(9_500, input.minGrossMarginBps) / 10_000);
    if (floorNet > net) {
      net = floorNet;
      marginFloorApplied = true;
    }
  }

  const tax = net * (Math.max(0, input.taxBps) / 10_000);
  const gross = net + tax;
  const realisedMarginBps = net > 0 ? Math.round(((net - cogs) / net) * 10_000) : 0;

  return {
    cogsCents: round6(cogs),
    markupCents: round6(net - cogs),
    netCents: round6(net),
    taxCents: round6(tax),
    grossCents: round6(gross),
    realisedMarginBps,
    marginFloorApplied,
  };
}

/**
 * What to tell a customer BEFORE they press launch (§110).
 *
 * Deliberately a range for calls. Homatch does not know how long a stranger
 * will stay on the phone, and a single confident number there would be a lie
 * that becomes an invoice dispute. WhatsApp is different: Meta charges per
 * conversation and the recipient count is known, so its estimate is tight.
 */
export interface EstimateInput {
  channel: 'AI_CALL' | 'WHATSAPP' | 'SMS' | 'EMAIL';
  reachableRecipients: number;
  /** Per-unit net price in cents, from configured pricing. Never invented here. */
  unitNetCents: number;
  taxBps: number;
  /** Calls only. The observed answer rate for this account, or a stated default. */
  expectedAnswerRate?: number;
  /** Calls only. Range of plausible answered-call durations, in seconds. */
  durationRangeSec?: [number, number];
}

export interface EstimateResult {
  minGrossCents: number;
  maxGrossCents: number;
  /** True when min and max differ, so the UI shows a range rather than a figure. */
  isRange: boolean;
  basis: string;
}

export function estimateCampaignCost(input: EstimateInput): EstimateResult {
  const n = Math.max(0, input.reachableRecipients);
  const withTax = (cents: number) => cents * (1 + Math.max(0, input.taxBps) / 10_000);

  if (input.channel === 'AI_CALL') {
    const answerRate = clamp(input.expectedAnswerRate ?? 0.25, 0, 1);
    const [minSec, maxSec] = input.durationRangeSec ?? [45, 180];
    // unitNetCents is per minute for a call.
    const answered = n * answerRate;
    const min = withTax(answered * (minSec / 60) * input.unitNetCents);
    const max = withTax(answered * (maxSec / 60) * input.unitNetCents);
    return {
      minGrossCents: round6(min),
      maxGrossCents: round6(max),
      isRange: true,
      basis: `${n} reachable × ${Math.round(answerRate * 100)}% expected answer × ${minSec}-${maxSec}s`,
    };
  }

  const flat = withTax(n * input.unitNetCents);
  return {
    minGrossCents: round6(flat),
    maxGrossCents: round6(flat),
    isRange: false,
    basis: `${n} recipients`,
  };
}

/**
 * How much to HOLD before a campaign starts (§46, §111).
 *
 * The maximum, not the expectation. A reservation that only covers the likely
 * cost is a reservation that runs out mid-campaign, and a campaign that stops
 * halfway because the wallet emptied is worse for the customer than one that
 * never started. Release returns whatever was not used.
 */
export function reservationForCampaign(estimate: EstimateResult, userCapCents: number | null): number {
  const needed = estimate.maxGrossCents;
  if (userCapCents == null) return round6(needed);
  return round6(Math.min(needed, Math.max(0, userCapCents)));
}

/**
 * Can one more unit start without overshooting a ceiling?
 *
 * `inFlightCents` is the conservative part: calls already connected will keep
 * costing money for as long as they last, and pretending otherwise is how a
 * cap is exceeded by exactly the amount that was already on the wire.
 */
export function canDispatchWithinCap(params: {
  spentCents: number;
  inFlightCents: number;
  nextUnitMaxCents: number;
  capCents: number | null;
}): boolean {
  if (params.capCents == null) return true;
  return params.spentCents + params.inFlightCents + params.nextUnitMaxCents <= params.capCents;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Money is kept to six decimal places of a cent, matching numeric(12,6) in the schema. */
function round6(n: number): number {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}
