/*
 * HOW MANY NEIGHBOURS — ARITHMETIC, NOT ADJECTIVES.
 *
 * Owner, 2026-10-10: the Villion report never said what makes the project
 * premium — two 8-storey buildings, 42 homes, a 2,145 m² plot: about 2-3
 * flats per floor (no corridor system) and ~51 m² of land per household.
 * Those are computed here from the documented scale, so the model states
 * them as facts and never invents them. Nothing is returned when an input
 * is missing; nothing is guessed.
 */

export interface LivingDensity {
  units: number;
  buildings: number;
  floorsPerBuilding: number;
  /** Average homes per residential floor, across buildings (rounded to 0.1). */
  unitsPerFloor: number;
  /** Land per household in m², when the plot area is known. */
  landPerUnitSqm: number | null;
  plotAreaSqm: number | null;
  /** Calm, deterministic reading: ≤ 4 per floor and no corridor system. */
  boutique: boolean;
}

const num = (v: unknown): number | null => {
  const m = String(v ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function livingDensityFrom(project: Record<string, unknown>, plotAreaSqm: number | null): LivingDensity | null {
  const units = num(project.unitCounts ?? project.units ?? project.unitCount);
  const buildings = num(project.buildings ?? project.buildingCount) ?? 1;
  const floors = num(project.floors ?? project.floorCount);
  if (!units || !floors || units > 5000 || floors > 120) return null;
  const perFloor = Math.round((units / (buildings * floors)) * 10) / 10;
  const plot = plotAreaSqm && plotAreaSqm > 0 ? plotAreaSqm : null;
  return {
    units,
    buildings,
    floorsPerBuilding: floors,
    unitsPerFloor: perFloor,
    landPerUnitSqm: plot ? Math.round(plot / units) : null,
    plotAreaSqm: plot,
    boutique: perFloor <= 4,
  };
}
