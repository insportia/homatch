import { parseNumber, round } from './numbers.ts';

export type AreaUnit = 'sqm' | 'sqft' | 'ha' | 'acre';

export interface Area {
  value: number;
  unit: AreaUnit;
}

const TO_SQM: Record<AreaUnit, number> = {
  sqm: 1,
  sqft: 0.09290304,
  ha: 10_000,
  acre: 4046.8564224,
};

/**
 * Unit aliases across the languages a Georgian listing actually appears in:
 * English, Georgian and Russian.
 */
const UNIT_PATTERNS: Array<[RegExp, AreaUnit]> = [
  [/^(?:m2|m²|sqm|sq\.?\s?m\.?|кв\.?\s?м\.?|кв\.метр\w*|მ2|მ²|კვ\.?\s?მ\.?)$/i, 'sqm'],
  [/^(?:ft2|ft²|sqft|sq\.?\s?ft\.?|square\s?feet)$/i, 'sqft'],
  [/^(?:ha|hectares?|га|гектар\w*)$/i, 'ha'],
  [/^(?:acres?)$/i, 'acre'],
];

const AREA_TOKEN =
  /([0-9][0-9\s.,'  ]*)\s*(m2|m²|sqm|sq\.?\s?m\.?|кв\.?\s?м\.?|მ2|მ²|კვ\.?\s?მ\.?|ft2|ft²|sqft|sq\.?\s?ft\.?|ha|га|acres?)/gi;

export function normalizeAreaUnit(raw: string): AreaUnit | null {
  const token = raw.trim().toLowerCase();
  for (const [pattern, unit] of UNIT_PATTERNS) {
    if (pattern.test(token)) return unit;
  }
  return null;
}

export function parseArea(text: string): Area | null {
  AREA_TOKEN.lastIndex = 0;
  const match = AREA_TOKEN.exec(text);
  if (!match) return null;
  return buildArea(match[1] as string, match[2] as string);
}

/**
 * Resolve a numeric token against its unit.
 *
 * "97,2 m2" is unambiguous. "1,046 sqft" and "97.200 m2" are not: a single
 * separator followed by exactly three digits could be a decimal point or a
 * thousands separator. Rather than picking a global default and being wrong
 * half the time, we evaluate both readings and keep the one that is physically
 * plausible for the unit. Only when both or neither are plausible do we fall
 * back to the documented default.
 */
function buildArea(rawValue: string, rawUnit: string): Area | null {
  const unit = normalizeAreaUnit(rawUnit);
  if (!unit) return null;

  const asDecimal = parseNumber(rawValue, { ambiguousTripleGroup: 'decimal' });
  const asGroup = parseNumber(rawValue, { ambiguousTripleGroup: 'group' });

  if (asDecimal === null && asGroup === null) return null;
  if (asDecimal !== null && asGroup !== null && asDecimal !== asGroup) {
    const decimalPlausible = asDecimal > 0 && isPlausibleResidentialArea({ value: asDecimal, unit });
    const groupPlausible = asGroup > 0 && isPlausibleResidentialArea({ value: asGroup, unit });
    if (decimalPlausible !== groupPlausible) {
      const chosen = decimalPlausible ? asDecimal : asGroup;
      return { value: round(chosen, 2), unit };
    }
  }

  // Unambiguous, or ambiguous in a way plausibility cannot settle: sqm values
  // are usually written with a decimal, sqft values with a thousands separator.
  const fallback = unit === 'sqm' ? asDecimal : asGroup;
  const value = fallback ?? asDecimal ?? asGroup;
  if (value === null || value <= 0) return null;
  return { value: round(value, 2), unit };
}

/** Every area mentioned in the text, in document order. */
export function extractAreas(text: string): Area[] {
  AREA_TOKEN.lastIndex = 0;
  const out: Area[] = [];
  let match: RegExpExecArray | null;
  while ((match = AREA_TOKEN.exec(text)) !== null) {
    const area = buildArea(match[1] as string, match[2] as string);
    if (area) out.push(area);
  }
  return out;
}

export function toSqm(area: Area): number {
  return round(area.value * TO_SQM[area.unit], 2);
}

export function convertArea(area: Area, to: AreaUnit): Area {
  const sqm = area.value * TO_SQM[area.unit];
  return { value: round(sqm / TO_SQM[to], 2), unit: to };
}

/**
 * Price per square metre. Returns null instead of guessing when the inputs are
 * not comparable, because a wrong price/sqm silently poisons every comparable.
 */
export function pricePerSqm(priceAmount: number, area: Area): number | null {
  const sqm = toSqm(area);
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) return null;
  if (!Number.isFinite(sqm) || sqm <= 0) return null;
  return round(priceAmount / sqm, 2);
}

/**
 * Sanity band for a residential unit. Values outside it usually mean we parsed
 * a plot size, a building total or a typo rather than the unit area.
 */
export function isPlausibleResidentialArea(area: Area): boolean {
  const sqm = toSqm(area);
  return sqm >= 8 && sqm <= 2000;
}
