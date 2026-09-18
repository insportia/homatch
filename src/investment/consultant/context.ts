// HOMATCH INVESTMENT INTELLIGENCE — the consultation context.
//
// WHAT THIS IS
//
// Everything the consultation has established, with WHERE EACH VALUE CAME
// FROM attached to it. The deterministic engine takes a plain
// InvestmentInput; this is the layer above, and the reason it exists is a
// single product rule:
//
//   NEVER SILENTLY REPLACE A USER'S ASSUMPTION WITH RESEARCHED DATA.
//
// A context where `monthlyRent` is 500 because the investor said so and a
// context where it is 565 because a portal sweep found it are materially
// different, and the difference has to survive all the way to the screen.
// It cannot survive if the value is a bare number, so it is not one.
//
// WHY A PATCH, AND WHY IT IS VALIDATED HERE
//
// The AI Consultant's job is to turn "$100k flat, rents for $500, I have
// 35%" into fields. That means a language model proposes writes to the
// scenario, which is exactly the kind of thing that must not be trusted
// blind. `applyPatch` is the only door: it accepts a fixed key set, coerces
// and range-checks every value, drops anything it does not recognise, and
// stamps the origin itself rather than letting the caller claim one. A model
// cannot mark its own guess as RESEARCH, because the origin is not an input
// to this function for AI patches — it is an argument the SERVER supplies.

import type {
  InvestmentFinancing,
  InvestmentInput,
  InvestmentOperatingCosts,
  InvestmentSubject,
  InvestmentValueOrigin,
} from '../types.ts';

/** A value plus its provenance. The unit this layer works in. */
export interface Provenanced<T> {
  value: T;
  origin: InvestmentValueOrigin;
  /** ISO timestamp of when it was established. */
  at: string;
  /** Short, checkable: 'user message', 'property 3f2…', 'ss.ge sweep'. */
  source?: string;
}

/**
 * Every scalar the consultation can hold, flat.
 *
 * Flat rather than nested because provenance is per-VALUE, and a nested
 * shape would force either a provenance per branch (wrong: two fields in
 * one object can have different origins) or a parallel tree (a second thing
 * to keep in sync).
 */
export const CONTEXT_NUMERIC_FIELDS = [
  'purchasePrice',
  'askingPrice',
  'monthlyRent',
  'otherAnnualIncome',
  'vacantMonthsPerYear',
  'acquisitionCosts',
  'acquisitionCostPercent',
  'renovationCost',
  'furnishingCost',
  'holdMonths',
  'exitPriceAssumption',
  'sellingCostPercent',
  'sellingCostAmount',
  'benchmarkYieldPercent',
  'downPaymentPercent',
  'downPaymentAmount',
  'mortgageAnnualRatePercent',
  'mortgageTermMonths',
  'originationFeePercent',
  'managementPercentOfCollectedRent',
  'managementFlatMonthly',
  'maintenanceAnnual',
  'repairsAnnual',
  'insuranceAnnual',
  'propertyTaxAnnual',
  'utilitiesPaidByOwnerAnnual',
  'otherOperatingAnnual',
  'lettingFeePerTenancy',
  'tenanciesPerYear',
  'areaSqm',
  'rooms',
  'bedrooms',
  'floor',
] as const;

export type ContextNumericField = (typeof CONTEXT_NUMERIC_FIELDS)[number];

export const CONTEXT_TEXT_FIELDS = [
  'currency',
  'city',
  'district',
  'address',
  'projectName',
  'propertyType',
  'condition',
  'propertyId',
] as const;

export type ContextTextField = (typeof CONTEXT_TEXT_FIELDS)[number];

/**
 * Per-field bounds.
 *
 * These are not UI validation — they are the guard between a language model
 * and the scenario. A model that hallucinates a rent of 5,000,000 or a
 * mortgage term of 9,000 months must not be able to write it, and silently
 * clamping would be worse than rejecting, because the resulting model would
 * look plausible and be about a different property.
 */
const NUMERIC_BOUNDS: Record<ContextNumericField, { min: number; max: number }> = {
  purchasePrice: { min: 1, max: 1_000_000_000 },
  askingPrice: { min: 0, max: 1_000_000_000 },
  monthlyRent: { min: 0, max: 10_000_000 },
  otherAnnualIncome: { min: 0, max: 10_000_000 },
  vacantMonthsPerYear: { min: 0, max: 12 },
  acquisitionCosts: { min: 0, max: 100_000_000 },
  acquisitionCostPercent: { min: 0, max: 50 },
  renovationCost: { min: 0, max: 100_000_000 },
  furnishingCost: { min: 0, max: 100_000_000 },
  holdMonths: { min: 1, max: 600 },
  exitPriceAssumption: { min: 0, max: 1_000_000_000 },
  sellingCostPercent: { min: 0, max: 50 },
  sellingCostAmount: { min: 0, max: 100_000_000 },
  benchmarkYieldPercent: { min: 0.1, max: 100 },
  downPaymentPercent: { min: 0, max: 100 },
  downPaymentAmount: { min: 0, max: 1_000_000_000 },
  mortgageAnnualRatePercent: { min: 0, max: 100 },
  mortgageTermMonths: { min: 1, max: 600 },
  originationFeePercent: { min: 0, max: 20 },
  managementPercentOfCollectedRent: { min: 0, max: 100 },
  managementFlatMonthly: { min: 0, max: 1_000_000 },
  maintenanceAnnual: { min: 0, max: 10_000_000 },
  repairsAnnual: { min: 0, max: 10_000_000 },
  insuranceAnnual: { min: 0, max: 10_000_000 },
  propertyTaxAnnual: { min: 0, max: 10_000_000 },
  utilitiesPaidByOwnerAnnual: { min: 0, max: 10_000_000 },
  otherOperatingAnnual: { min: 0, max: 10_000_000 },
  lettingFeePerTenancy: { min: 0, max: 1_000_000 },
  tenanciesPerYear: { min: 0, max: 12 },
  areaSqm: { min: 1, max: 100_000 },
  rooms: { min: 1, max: 60 },
  bedrooms: { min: 0, max: 60 },
  floor: { min: -10, max: 300 },
};

const TEXT_MAX_LENGTH = 200;

/** Currencies the app already formats. Anything else is refused rather than
 *  passed to Intl, which would throw at render time in six locales at once. */
export const SUPPORTED_CURRENCIES = ['USD', 'GEL', 'EUR', 'GBP', 'TRY', 'RUB', 'AED', 'ILS'] as const;

export type InvestmentContext = {
  [K in ContextNumericField]?: Provenanced<number>;
} & {
  [K in ContextTextField]?: Provenanced<string>;
};

export interface ContextPatch {
  [key: string]: number | string | null | undefined;
}

export interface PatchOutcome {
  context: InvestmentContext;
  /** Fields actually written, for the UI's "the Consultant understood" line. */
  applied: ContextNumericField[] | ContextTextField[] | string[];
  /** Fields refused, with why, so nothing is dropped silently. */
  rejected: Array<{ field: string; reason: 'UNKNOWN_FIELD' | 'OUT_OF_RANGE' | 'NOT_A_NUMBER' | 'TOO_LONG' }>;
}

const NUMERIC_SET = new Set<string>(CONTEXT_NUMERIC_FIELDS);
const TEXT_SET = new Set<string>(CONTEXT_TEXT_FIELDS);

/**
 * The only way a value enters the context.
 *
 * `origin` is an ARGUMENT, supplied by whatever is calling — the UI passes
 * USER, the property importer passes PROPERTY, the evidence applier passes
 * RESEARCH. A patch produced by a language model cannot name its own origin,
 * which is the point: the model proposes values, the server decides what
 * they are.
 */
export function applyPatch(
  context: InvestmentContext,
  patch: ContextPatch,
  origin: InvestmentValueOrigin,
  options: { at?: string; source?: string } = {},
): PatchOutcome {
  const at = options.at ?? new Date().toISOString();
  const next: InvestmentContext = { ...context };
  const applied: string[] = [];
  const rejected: PatchOutcome['rejected'] = [];

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = rawKey.trim();
    if (rawValue === null || rawValue === undefined) {
      // An explicit null clears the field. The consultation has to be able
      // to take something back — "actually I am not borrowing after all".
      if (NUMERIC_SET.has(key) || TEXT_SET.has(key)) {
        delete (next as Record<string, unknown>)[key];
        applied.push(key);
      } else {
        rejected.push({ field: key, reason: 'UNKNOWN_FIELD' });
      }
      continue;
    }

    if (NUMERIC_SET.has(key)) {
      const numeric = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).replace(/[\s,]/g, ''));
      if (!Number.isFinite(numeric)) {
        rejected.push({ field: key, reason: 'NOT_A_NUMBER' });
        continue;
      }
      const bounds = NUMERIC_BOUNDS[key as ContextNumericField];
      if (numeric < bounds.min || numeric > bounds.max) {
        rejected.push({ field: key, reason: 'OUT_OF_RANGE' });
        continue;
      }
      (next as Record<string, unknown>)[key] = {
        value: numeric,
        origin,
        at,
        ...(options.source ? { source: options.source } : {}),
      };
      applied.push(key);
      continue;
    }

    if (TEXT_SET.has(key)) {
      const text = String(rawValue).trim();
      if (!text) {
        delete (next as Record<string, unknown>)[key];
        applied.push(key);
        continue;
      }
      if (text.length > TEXT_MAX_LENGTH) {
        rejected.push({ field: key, reason: 'TOO_LONG' });
        continue;
      }
      if (key === 'currency') {
        const code = text.toUpperCase();
        if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(code)) {
          rejected.push({ field: key, reason: 'OUT_OF_RANGE' });
          continue;
        }
        (next as Record<string, unknown>)[key] = {
          value: code,
          origin,
          at,
          ...(options.source ? { source: options.source } : {}),
        };
        applied.push(key);
        continue;
      }
      (next as Record<string, unknown>)[key] = {
        value: text,
        origin,
        at,
        ...(options.source ? { source: options.source } : {}),
      };
      applied.push(key);
      continue;
    }

    rejected.push({ field: key, reason: 'UNKNOWN_FIELD' });
  }

  return { context: next, applied, rejected };
}

function num(context: InvestmentContext, key: ContextNumericField): number | undefined {
  return context[key]?.value;
}

function text(context: InvestmentContext, key: ContextTextField): string | undefined {
  return context[key]?.value;
}

/** True when the context carries enough to run the engine at all. */
export function isModellable(context: InvestmentContext): boolean {
  const price = num(context, 'purchasePrice');
  return typeof price === 'number' && price > 0;
}

/**
 * Flatten the provenanced context into the engine's plain input.
 *
 * Every conditional below is "was this actually established", never "what is
 * a reasonable default" — with the single exception of the currency, which
 * defaults to USD because the engine needs a code to format against and USD
 * is what the Georgian market quotes property in. That default is visible in
 * the UI as an editable field rather than buried here.
 */
export function toInvestmentInput(context: InvestmentContext): InvestmentInput | null {
  const purchasePrice = num(context, 'purchasePrice');
  if (typeof purchasePrice !== 'number' || purchasePrice <= 0) return null;

  const operating: InvestmentOperatingCosts = {};
  const operatingKeys: Array<[keyof InvestmentOperatingCosts, ContextNumericField]> = [
    ['managementPercentOfCollectedRent', 'managementPercentOfCollectedRent'],
    ['managementFlatMonthly', 'managementFlatMonthly'],
    ['maintenanceAnnual', 'maintenanceAnnual'],
    ['repairsAnnual', 'repairsAnnual'],
    ['insuranceAnnual', 'insuranceAnnual'],
    ['propertyTaxAnnual', 'propertyTaxAnnual'],
    ['utilitiesPaidByOwnerAnnual', 'utilitiesPaidByOwnerAnnual'],
    ['otherOperatingAnnual', 'otherOperatingAnnual'],
    ['lettingFeePerTenancy', 'lettingFeePerTenancy'],
    ['tenanciesPerYear', 'tenanciesPerYear'],
  ];
  for (const [target, sourceKey] of operatingKeys) {
    const value = num(context, sourceKey);
    if (value !== undefined) (operating as Record<string, number>)[target] = value;
  }

  const subject: InvestmentSubject = {};
  const city = text(context, 'city');
  if (city) subject.city = city;
  const district = text(context, 'district');
  if (district) subject.district = district;
  const address = text(context, 'address');
  if (address) subject.address = address;
  const projectName = text(context, 'projectName');
  if (projectName) subject.projectName = projectName;
  const propertyType = text(context, 'propertyType');
  if (propertyType) subject.propertyType = propertyType;
  const condition = text(context, 'condition');
  if (condition) subject.condition = condition;
  const propertyId = text(context, 'propertyId');
  if (propertyId) subject.propertyId = propertyId;
  for (const key of ['areaSqm', 'rooms', 'bedrooms', 'floor'] as const) {
    const value = num(context, key);
    if (value !== undefined) (subject as Record<string, number>)[key] = value;
  }

  /*
   * THE FINANCING LEG ONLY EXISTS WHEN THERE IS A LOAN TO MODEL.
   *
   * A rate with no term, or a deposit with neither, is somebody part way
   * through telling us about a mortgage. Building a financing object out of
   * it would make the engine model a loan nobody described; leaving it out
   * makes the missing pieces show up in `missingInputs`, which is where the
   * Consultant's next question comes from.
   */
  const ratePercent = num(context, 'mortgageAnnualRatePercent');
  const termMonths = num(context, 'mortgageTermMonths');
  const downPercent = num(context, 'downPaymentPercent');
  const downAmount = num(context, 'downPaymentAmount');
  const hasEquity = downPercent !== undefined || downAmount !== undefined;
  let financing: InvestmentFinancing | undefined;
  if (ratePercent !== undefined && termMonths !== undefined && hasEquity) {
    financing = {
      annualRatePercent: ratePercent,
      termMonths: Math.round(termMonths),
      ...(downPercent !== undefined ? { downPaymentPercent: downPercent } : {}),
      ...(downAmount !== undefined ? { downPaymentAmount: downAmount } : {}),
      ...(num(context, 'originationFeePercent') !== undefined
        ? { originationFeePercent: num(context, 'originationFeePercent') }
        : {}),
    };
  }

  const input: InvestmentInput = {
    currency: text(context, 'currency') ?? 'USD',
    purchasePrice,
  };

  const direct: Array<[keyof InvestmentInput, ContextNumericField]> = [
    ['askingPrice', 'askingPrice'],
    ['monthlyRent', 'monthlyRent'],
    ['otherAnnualIncome', 'otherAnnualIncome'],
    ['vacantMonthsPerYear', 'vacantMonthsPerYear'],
    ['acquisitionCosts', 'acquisitionCosts'],
    ['acquisitionCostPercent', 'acquisitionCostPercent'],
    ['renovationCost', 'renovationCost'],
    ['furnishingCost', 'furnishingCost'],
    ['holdMonths', 'holdMonths'],
    ['exitPriceAssumption', 'exitPriceAssumption'],
    ['sellingCostPercent', 'sellingCostPercent'],
    ['sellingCostAmount', 'sellingCostAmount'],
    ['benchmarkYieldPercent', 'benchmarkYieldPercent'],
  ];
  for (const [target, sourceKey] of direct) {
    const value = num(context, sourceKey);
    if (value !== undefined) (input as unknown as Record<string, unknown>)[target] = value;
  }

  if (Object.keys(operating).length) input.operating = operating;
  if (Object.keys(subject).length) input.subject = subject;
  if (financing) input.financing = financing;

  return input;
}

/** Every field the context holds, for the provenance panel. */
export function provenanceEntries(
  context: InvestmentContext,
): Array<{ field: string; value: number | string; origin: InvestmentValueOrigin; at: string; source?: string }> {
  const out: Array<{ field: string; value: number | string; origin: InvestmentValueOrigin; at: string; source?: string }> = [];
  for (const [field, entry] of Object.entries(context)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Provenanced<number | string>;
    out.push({ field, value: e.value, origin: e.origin, at: e.at, ...(e.source ? { source: e.source } : {}) });
  }
  return out.sort((a, b) => a.field.localeCompare(b.field));
}
