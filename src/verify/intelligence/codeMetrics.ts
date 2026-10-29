// The section metrics, computed in code (owner, 2026-10-29).
//
// A metric is a number the reader's eye goes to first, so it must be the
// number the evidence holds, exactly. The model used to write them and
// could round, mix units or restate a district spread as this home's price;
// it no longer writes metrics at all (the report schema has no field for
// them). Each value below is read from the deterministic bundle: the
// register, the documented scale (livingDensity) and the market valuation.
//
// The market metric follows the valuation contract: only an ESTIMATE has a
// number, labelled as asking prices; INSUFFICIENT_EVIDENCE has none.

import type { IntelligenceBundle } from './bundle.ts';
import type { SectionMetric } from './report.ts';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** 1 234.5 → "1 235": the report's grouped integer style. */
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const sqm = (n: number): string => `${n >= 100 ? fmt(n) : Math.round(n * 10) / 10} მ²`;
const CURRENCY: Record<string, string> = { USD: '$', GEL: '₾', EUR: '€' };

/** Metrics per section key; a section absent from the map has none. */
export function codeSectionMetrics(bundle: IntelligenceBundle | null | undefined): Record<string, SectionMetric[]> {
  const out: Record<string, SectionMetric[]> = {};
  if (!bundle) return out;

  const latest = bundle.register?.latest ?? null;
  const snap: SectionMetric[] = [];
  const area = num(bundle.snapshot?.area) ?? num(latest?.unitAreaSqm);
  if (area) snap.push({ label: 'ფართი', value: sqm(area) });
  const land = num(latest?.landAreaSqm);
  if (land && land !== area) snap.push({ label: 'მიწის ფართი', value: sqm(land) });
  const floor = String(bundle.snapshot?.floor ?? latest?.unitFloor ?? '').trim();
  if (floor && floor.length <= 12) snap.push({ label: 'სართული', value: floor });
  const rooms = num(bundle.snapshot?.rooms);
  if (rooms && rooms < 20) snap.push({ label: 'ოთახები', value: String(Math.round(rooms)) });
  if (snap.length) out.SNAPSHOT = snap.slice(0, 4);

  const d = bundle.livingDensity;
  if (d) {
    const project: SectionMetric[] = [];
    if (d.units) project.push({ label: 'ბინები', value: fmt(d.units) });
    if (d.buildings > 1) project.push({ label: 'კორპუსები', value: String(d.buildings) });
    if (d.unitsPerFloor) project.push({ label: 'ბინა სართულზე', value: String(Math.round(d.unitsPerFloor * 10) / 10) });
    if (d.landPerUnitSqm) project.push({ label: 'მიწა ერთ ოჯახზე', value: sqm(d.landPerUnitSqm) });
    if (project.length) out.PROJECT = project.slice(0, 4);
  }

  const v = bundle.market?.valuation;
  if (v?.state === 'ESTIMATE' && v.pricePerSqm) {
    const c = CURRENCY[String(v.currency || 'USD').toUpperCase()] ?? `${v.currency} `;
    const label = v.priceBasis === 'TRANSACTION' ? 'ფასი მ²-ზე' : 'მოთხოვნილი ფასი მ²-ზე';
    out.MARKET = [{ label, value: `${c}${fmt(v.pricePerSqm.min)}–${fmt(v.pricePerSqm.max)}` }];
  }
  return out;
}
