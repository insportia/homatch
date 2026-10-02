// THE WALKTHROUGH IS THE APPROVED HOME — checked, not assumed.
//
// When the walkthrough is built, the factory renders the approved master
// camera again, with its object map. Comparing the two maps (what each pixel
// shows, by canonical id) finds, exactly and for free:
//
//   MISSING    a piece the approved picture shows that the build does not
//   EXTRA      a piece the build shows that the approved design never had
//   MOVED      a piece that stands somewhere else in the frame
//
// Surfaces are compared too (a floor or wall face that vanished is a
// missing surface). Geometry is never "fixed" toward a picture: this only
// reports, so a contradiction is found before the customer walks in.
//
// Pure.

import type { MapEntry, ObjectMap } from './contract.ts';

export type Contradiction =
  | { code: 'MISSING'; id: string; kind: MapEntry['kind'] }
  | { code: 'EXTRA'; id: string; kind: MapEntry['kind'] }
  | { code: 'MOVED'; id: string; kind: MapEntry['kind']; shift: number };

export interface ConsistencyReport {
  compared: number;
  contradictions: Contradiction[];
  /** 0–1: share of the approved picture's significant targets that the build shows where they were. */
  agreement: number;
}

/** Targets that matter: visible enough to be noticed (0.1% of the frame). */
const SIGNIFICANT = 0.001;
const centre = (e: MapEntry) => [(e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2] as const;

export function compareMaps(approved: ObjectMap, built: ObjectMap, opts: { moveTolerance?: number } = {}): ConsistencyReport {
  const tol = opts.moveTolerance ?? 0.04;
  const a = new Map(approved.entries.filter((e) => e.coverage >= SIGNIFICANT && e.kind !== 'OTHER').map((e) => [e.id, e]));
  const b = new Map(built.entries.filter((e) => e.coverage >= SIGNIFICANT && e.kind !== 'OTHER').map((e) => [e.id, e]));
  const out: Contradiction[] = [];
  let ok = 0;
  for (const [id, e] of a) {
    const f = b.get(id);
    if (!f) { out.push({ code: 'MISSING', id, kind: e.kind }); continue; }
    const [ax, ay] = centre(e); const [bx, by] = centre(f);
    const shift = Math.hypot(ax - bx, ay - by);
    if (e.kind === 'OBJECT' && shift > tol) out.push({ code: 'MOVED', id, kind: e.kind, shift: Math.round(shift * 1000) / 1000 });
    else ok += 1;
  }
  for (const [id, f] of b) if (!a.has(id) && f.kind === 'OBJECT') out.push({ code: 'EXTRA', id, kind: f.kind });
  return { compared: a.size, contradictions: out, agreement: a.size ? Math.round((ok / a.size) * 1000) / 1000 : 1 };
}
