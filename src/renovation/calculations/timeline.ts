// timeline.ts — how long a renovation actually takes.
//
// PART X: not "60 m2 = 2 months". Real duration comes from phases with real
// dependencies, some of which overlap and some of which physically cannot.
// Curing is the clearest example: screed and waterproofing need drying time
// that no amount of extra labour shortens, which is why small flats are not
// proportionally faster than large ones.
//
// The engine returns a RANGE, because a single number would be a false
// promise.

import { type Condition } from './quantities.ts';
import { type RenovationLevel } from './estimate.ts';

export interface Phase {
  key: string;
  label: string;
  /** Phases that must FINISH before this one starts. */
  dependsOn: string[];
  days: number;
  /** True when the duration is physics, not labour — cannot be compressed. */
  fixed?: boolean;
}

export interface TimelineResult {
  phases: Phase[];
  /** Critical path in days (working days). */
  criticalPathDays: number;
  optimisticDays: number;
  typicalDays: number;
  bufferedDays: number;
  drivers: string[];
}

/** Area scaling is sub-linear: doubling the floor area does not double the
 * time, because crews work in parallel across rooms. */
function areaFactor(totalArea: number): number {
  const base = 60;
  return Math.max(0.6, Math.pow(Math.max(totalArea, 15) / base, 0.65));
}

const LEVEL_FACTOR: Record<RenovationLevel, number> = {
  COSMETIC: 0.55,
  BUDGET: 0.8,
  STANDARD: 1,
  UPPER_STANDARD: 1.2,
  PREMIUM: 1.45,
  DESIGNER: 1.8,
};

export function buildPhases(condition: Condition, totalArea: number, level: RenovationLevel): Phase[] {
  const a = areaFactor(totalArea);
  const l = LEVEL_FACTOR[level];
  const scaled = (d: number) => Math.max(1, Math.round(d * a * l));
  const demolitionDays =
    condition === 'OLD_RENOVATION' ? scaled(8) : condition === 'USABLE_RENOVATION' ? scaled(4) : 0;

  const phases: Phase[] = [
    { key: 'design', label: 'Design and planning', dependsOn: [], days: level === 'COSMETIC' ? scaled(3) : scaled(10) },
  ];
  if (demolitionDays > 0) {
    phases.push({ key: 'demolition', label: 'Demolition and strip-out', dependsOn: ['design'], days: demolitionDays });
  }
  const afterDemo = demolitionDays > 0 ? ['demolition'] : ['design'];

  phases.push(
    { key: 'partitions', label: 'Partitions', dependsOn: afterDemo, days: scaled(4) },
    { key: 'rough', label: 'Rough electrical and plumbing', dependsOn: ['partitions'], days: scaled(9) },
    { key: 'plaster', label: 'Plaster, levelling and screed', dependsOn: ['rough'], days: scaled(10) },
    // Curing is physics: it does not scale with crew size or with area.
    { key: 'curing', label: 'Drying and curing', dependsOn: ['plaster'], days: 14, fixed: true },
    { key: 'waterproofing', label: 'Wet-area waterproofing', dependsOn: ['plaster'], days: scaled(2) },
    { key: 'tiling', label: 'Tiling', dependsOn: ['waterproofing'], days: scaled(8) },
    { key: 'ceilings', label: 'Ceilings', dependsOn: ['curing'], days: scaled(5) },
    { key: 'painting', label: 'Painting', dependsOn: ['ceilings'], days: scaled(7) },
    { key: 'flooring', label: 'Flooring', dependsOn: ['painting', 'curing'], days: scaled(5) },
    { key: 'doors', label: 'Doors', dependsOn: ['flooring'], days: scaled(3) },
    { key: 'finish', label: 'Sanitaryware and electrical finish', dependsOn: ['tiling', 'painting'], days: scaled(5) },
    { key: 'kitchen', label: 'Kitchen and fitted furniture', dependsOn: ['flooring', 'finish'], days: scaled(6) },
    { key: 'snagging', label: 'Snagging', dependsOn: ['kitchen', 'doors'], days: scaled(4) },
    { key: 'cleaning', label: 'Final cleaning', dependsOn: ['snagging'], days: 2 }
  );
  return phases;
}

/**
 * Longest path through the dependency graph. Independent branches (tiling
 * while the ceilings go up, for instance) overlap naturally because only
 * dependencies force sequence.
 */
export function criticalPath(phases: Phase[]): number {
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const finish = new Map<string, number>();

  const resolve = (key: string, guard: Set<string>): number => {
    if (finish.has(key)) return finish.get(key)!;
    if (guard.has(key)) throw new Error(`circular phase dependency at ${key}`);
    const phase = byKey.get(key);
    if (!phase) return 0;
    guard.add(key);
    const start = phase.dependsOn.reduce((max, d) => Math.max(max, resolve(d, guard)), 0);
    guard.delete(key);
    const end = start + phase.days;
    finish.set(key, end);
    return end;
  };

  let longest = 0;
  for (const p of phases) longest = Math.max(longest, resolve(p.key, new Set()));
  return longest;
}

export function estimateTimeline(condition: Condition, totalArea: number, level: RenovationLevel): TimelineResult {
  const phases = buildPhases(condition, totalArea, level);
  const days = criticalPath(phases);

  const drivers: string[] = [];
  const curing = phases.find((p) => p.key === 'curing');
  if (curing) drivers.push(`${curing.days} days of drying and curing that cannot be shortened`);
  if (condition === 'OLD_RENOVATION') drivers.push('removing the existing renovation before new work can start');
  if (level === 'DESIGNER' || level === 'PREMIUM') drivers.push('bespoke materials and finishes with longer lead times');
  if (totalArea > 120) drivers.push('the size of the property');
  if (!drivers.length) drivers.push('the standard sequence of trades');

  return {
    phases,
    criticalPathDays: days,
    // Optimistic assumes no waiting on decisions or deliveries; typical and
    // buffered do not, because in practice something always waits.
    optimisticDays: Math.round(days * 0.85),
    typicalDays: days,
    bufferedDays: Math.round(days * 1.25),
    drivers,
  };
}

/** Working days -> calendar weeks, for a customer-facing sentence. */
export function toCalendarWeeks(workingDays: number): number {
  return Math.round((workingDays / 5) * 7 / 7);
}
