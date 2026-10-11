/*
 * PROJECT MATHEMATICS — the building's numbers, worked through in the open.
 *
 * A buyer is told "K-2 = 2.4" and has no way to know what it means or whether
 * it adds up. This module takes the documented specifications
 * (technicalSpecs.ts) and does only the arithmetic the numbers themselves
 * support:
 *
 *   K-n = K-n calculation area ÷ plot area      only when both exist, the
 *                                               area is not larger than the
 *                                               plot (for K-1), and the two
 *                                               come from the same standing
 *   residential / office / commercial split     shares of the documented use
 *                                               areas, never of a guess
 *   gross area breakdown                        the documented parts against
 *                                               the documented total
 *
 * WHAT IT REFUSES TO DO.
 *   - It never derives saleable area from a coefficient. Gross construction
 *     area, the K-2 (permitted floor) area, net internal area and saleable
 *     area are four different things; the last two are not on the city form.
 *   - It never computes with a value that contradicts another (the .601 form
 *     lists a 7 793.7 m² "built-up area" on a 2 145 m² plot; a footprint
 *     cannot exceed its plot). Such a value is FLAGGED, not used.
 *   - When an input is missing it says which one, by key.
 *
 * Pure and deterministic. The component renders ids and numbers through i18n.
 */

export type MathStatus = 'APPROVED' | 'PROPOSED' | 'UNKNOWN';

export interface MathInput {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  status: MathStatus;
  caseRef: string | null;
  date: string | null;
}

export interface CoefficientCalc {
  id: 'K1' | 'K2' | 'K3';
  /** The coefficient's calculation area (m²). */
  area: MathInput;
  land: MathInput;
  /** area ÷ land, two decimals. */
  result: number;
  /** The coefficient the document itself states, when it does. */
  stated: number | null;
  /** null when no stated value exists to compare with. */
  consistent: boolean | null;
}

export interface UseShare {
  key: 'residentialArea' | 'officeArea' | 'commercialArea';
  area: number;
  /** Share of the documented use areas, one decimal. */
  share: number;
}

export interface GrossBreakdown {
  parts: Array<{ key: string; area: number }>;
  sum: number;
  total: number;
  /** The parts add up to the total within 0.5 %. */
  consistent: boolean;
}

export type MathFlagId =
  | 'K1_AREA_EXCEEDS_LAND'
  | 'K_AREA_EXCEEDS_GROSS'
  | 'COEFF_MISMATCH'
  | 'MIXED_STANDING'
  | 'BUILT_UP_NOT_FOOTPRINT'
  | 'BREAKDOWN_MISMATCH';

export interface MathFlag {
  id: MathFlagId;
  keys: string[];
  values: Record<string, number | string>;
}

export type MissingId = 'K1' | 'K2' | 'K3' | 'USES' | 'SALEABLE';
export interface MissingInput {
  id: MissingId;
  /** Spec keys (or 'SALES_PLAN') that would be needed. */
  needs: string[];
}

export interface ProjectMath {
  land: MathInput | null;
  gross: MathInput | null;
  k2Area: MathInput | null;
  coefficients: CoefficientCalc[];
  uses: UseShare[];
  usesTotal: number | null;
  breakdown: GrossBreakdown | null;
  /** Gross construction area minus the K-2 calculation area (what K-2 does not count). */
  grossMinusK2: number | null;
  parking: MathInput | null;
  summer: MathInput | null;
  flags: MathFlag[];
  missing: MissingInput[];
  /** The case most of the inputs come from. */
  basis: { caseRef: string | null; date: string | null; status: MathStatus } | null;
}

const COEFF_AREA_KEY: Record<'K1' | 'K2' | 'K3', string> = { K1: 'k1Area', K2: 'k2CalculationArea', K3: 'landscapingArea' };
const USE_KEYS = ['residentialArea', 'officeArea', 'commercialArea'] as const;
const BREAKDOWN_KEYS = ['residentialArea', 'officeArea', 'commercialArea', 'summerArea', 'stairArea', 'auxiliaryArea', 'parkingArea'];
/* The city rounds coefficients to one decimal on the form. */
const COEFF_TOLERANCE = 0.06;

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function readInputs(specs: unknown): Map<string, MathInput> {
  const out = new Map<string, MathInput>();
  if (!Array.isArray(specs)) return out;
  const rank = (s: MathStatus) => (s === 'APPROVED' ? 0 : s === 'UNKNOWN' ? 1 : 2);
  for (const raw of specs as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const key = typeof raw.key === 'string' ? raw.key : '';
    const value = typeof raw.numeric === 'number' && Number.isFinite(raw.numeric) ? raw.numeric : null;
    if (!key || value === null || value < 0) continue;
    const st = String(raw.status ?? '').toUpperCase();
    const status: MathStatus = st === 'APPROVED' || st === 'PROPOSED' ? st : 'UNKNOWN';
    const input: MathInput = {
      key,
      label: typeof raw.label === 'string' ? raw.label : key,
      value,
      unit: typeof raw.unit === 'string' ? raw.unit : null,
      status,
      caseRef: typeof raw.caseRef === 'string' ? raw.caseRef : null,
      date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : null,
    };
    // The approved value is the one arithmetic is done with; a proposal never replaces it.
    const prev = out.get(key);
    if (!prev || rank(status) < rank(prev.status)) out.set(key, input);
  }
  return out;
}

const sameStanding = (a: MathInput, b: MathInput) => a.status === b.status && (a.caseRef ?? '') === (b.caseRef ?? '');

export function projectMath(specs: unknown): ProjectMath | null {
  const inputs = readInputs(specs);
  if (!inputs.size) return null;
  const get = (k: string) => inputs.get(k) ?? null;
  const land = get('landArea');
  const gross = get('totalArea');
  const k2Area = get('k2CalculationArea');
  const flags: MathFlag[] = [];
  const missing: MissingInput[] = [];
  const coefficients: CoefficientCalc[] = [];

  for (const id of ['K1', 'K2', 'K3'] as const) {
    const area = get(COEFF_AREA_KEY[id]);
    const stated = get(id)?.value ?? null;
    if (!area || !land) {
      // Nothing to say when neither the area nor the coefficient was documented at all.
      if (area || stated !== null || id === 'K2') missing.push({ id, needs: [...(area ? [] : [COEFF_AREA_KEY[id]]), ...(land ? [] : ['landArea'])] });
      continue;
    }
    if (land.value <= 0) continue;
    if (id === 'K1' && area.value > land.value) {
      flags.push({ id: 'K1_AREA_EXCEEDS_LAND', keys: [area.key, land.key], values: { area: area.value, land: land.value } });
      continue;
    }
    if (gross && area.value > gross.value * 1.005) {
      flags.push({ id: 'K_AREA_EXCEEDS_GROSS', keys: [area.key, gross.key], values: { coefficient: id, area: area.value, gross: gross.value } });
      continue;
    }
    if (!sameStanding(area, land)) {
      flags.push({ id: 'MIXED_STANDING', keys: [area.key, land.key], values: { coefficient: id } });
    }
    const result = round(area.value / land.value, 2);
    const consistent = stated === null ? null : Math.abs(result - stated) <= COEFF_TOLERANCE;
    if (consistent === false) flags.push({ id: 'COEFF_MISMATCH', keys: [area.key, land.key, id], values: { coefficient: id, computed: result, stated: stated as number } });
    coefficients.push({ id, area, land, result, stated, consistent });
  }

  // The form's own "built-up area" is not the K-1 footprint; it is never computed with.
  const builtUp = get('builtUpArea');
  if (builtUp && land && builtUp.value > land.value) {
    flags.push({ id: 'BUILT_UP_NOT_FOOTPRINT', keys: [builtUp.key, land.key], values: { area: builtUp.value, land: land.value } });
  }

  const useRows = USE_KEYS.map((k) => get(k)).filter((x): x is MathInput => !!x && x.value > 0);
  const usesTotal = useRows.length ? round(useRows.reduce((n, r) => n + r.value, 0), 1) : null;
  const uses: UseShare[] = useRows.length >= 2 && usesTotal
    ? useRows.map((r) => ({ key: r.key as UseShare['key'], area: r.value, share: round((r.value / usesTotal) * 100, 1) }))
    : [];
  if (!useRows.length) missing.push({ id: 'USES', needs: [...USE_KEYS] });

  let breakdown: GrossBreakdown | null = null;
  if (gross) {
    const parts = BREAKDOWN_KEYS.map((k) => get(k)).filter((x): x is MathInput => !!x).map((x) => ({ key: x.key, area: x.value }));
    if (parts.length >= 3) {
      const sum = round(parts.reduce((n, p) => n + p.area, 0), 1);
      const consistent = Math.abs(sum - gross.value) <= gross.value * 0.005;
      breakdown = { parts, sum, total: gross.value, consistent };
      if (!consistent) flags.push({ id: 'BREAKDOWN_MISMATCH', keys: [gross.key], values: { sum, total: gross.value } });
    }
  }

  const grossMinusK2 = gross && k2Area && gross.value >= k2Area.value ? round(gross.value - k2Area.value, 1) : null;

  // Saleable area is never on the city form and never derived from it.
  missing.push({ id: 'SALEABLE', needs: ['SALES_PLAN'] });

  // The case most inputs come from — said once, above the numbers.
  const tally = new Map<string, { n: number; input: MathInput }>();
  for (const i of inputs.values()) {
    const k = `${i.caseRef ?? ''}|${i.status}`;
    const t = tally.get(k);
    tally.set(k, { n: (t?.n ?? 0) + 1, input: t?.input ?? i });
  }
  const top = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  const basis = top ? { caseRef: top.input.caseRef, date: top.input.date, status: top.input.status } : null;

  const hasAnything = !!(land || gross || k2Area || coefficients.length || uses.length || breakdown);
  if (!hasAnything) return null;
  return {
    land, gross, k2Area, coefficients, uses, usesTotal, breakdown, grossMinusK2,
    parking: get('parkingArea'), summer: get('summerArea'),
    flags, missing, basis,
  };
}

/** "5242.3" → "5 242.3": the report's own number style, no locale surprises. */
export function formatArea(n: number): string {
  const [i, d] = String(round(n, 1)).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${d ? `.${d}` : ''}`;
}
