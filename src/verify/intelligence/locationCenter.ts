// HOMATCH — where the subject is, from every source that says so (F5, 2026-10-22).
//
// Every completed cadastral Verify since 2026-10-12 stored no centre: the
// TAS_MAP worker never recorded the map view after it focused the parcel,
// the newer NAPR cadastral plans print no grid numbers in their text, and the
// Nominatim fallback answered nothing from the edge (job 61c1c38c). This
// module gathers the centres the stored official data DOES carry, each with
// its provenance, and decides which one (if any) distances may be measured
// from. Pure: the network (geocoder) lives in neighborhoodFetch.ts.
//
// The rules, in order:
//   1. A HIGH centre (the ms.gov.ge map view after a confirmed parcel search,
//      or a cadastral plan that names the parcel and prints its UTM grid) is
//      used. Any other candidate further than CENTER_DISAGREEMENT_M away is
//      kept and flagged, never silently dropped: the parcel wins.
//   2. A situational-drawing centre (MEDIUM: it names an application, not the
//      parcel) is used only when an independent candidate (an address
//      geocode) lies within CENTER_DISAGREEMENT_M of it. A drawing that
//      disagrees with the address is set aside when the address geocode is
//      VALIDATED at house precision (the geocoder's own house number equals
//      the registry address's, parseNominatim): the geocode is the centre,
//      labelled approximate, and the conflict stays on record as
//      DRAWING_SET_ASIDE. Job 61c1c38c is why: its only drawing names an
//      application, not the parcel, and lands 7.5 km from Tskneti highway 31,
//      whose house 31 the geocoder places exactly. Against a street-precision
//      geocode the conflict cannot be settled: CENTER_CONFLICT, no distances.
//      A drawing with nothing to check it against is UNCORROBORATED_DRAWING.
//   3. Otherwise an address geocode, house before street precision, as before.
// Never AI: no candidate here comes from a model.

import {
  haversineM,
  inGeorgia,
  type CenterBasis,
  type CenterCandidate,
  type CenterConfidence,
  type CenterIssue,
  type NeighborhoodCenter,
} from './neighborhood.ts';

/** Two centres further apart than this do not describe the same building. */
export const CENTER_DISAGREEMENT_M = 1000;

/** Confidence of each basis on its own; a geocode's depends on its precision. */
export function centerConfidence(c: Pick<NeighborhoodCenter, 'basis' | 'precision'>): CenterConfidence {
  switch (c.basis) {
    case 'MS_MAP_PARCEL':
    case 'MS_MAP_PARCEL_EARLIER':
    case 'CADASTRAL_PLAN':
      return 'HIGH';
    case 'SITUATIONAL_DRAWING':
      return 'MEDIUM';
    default:
      return c.precision === 'HOUSE' ? 'MEDIUM' : 'LOW';
  }
}

const RANK: Record<CenterBasis, number> = {
  MS_MAP_PARCEL: 0,
  CADASTRAL_PLAN: 1,
  MS_MAP_PARCEL_EARLIER: 2,
  SITUATIONAL_DRAWING: 3,
  GEOCODED_ADDRESS: 4,
};
const rank = (c: NeighborhoodCenter) => RANK[c.basis] * 2 + (c.basis === 'GEOCODED_ADDRESS' && c.precision !== 'HOUSE' ? 1 : 0);

export interface CenterDecision {
  center: NeighborhoodCenter | null;
  candidates: CenterCandidate[];
  issue: CenterIssue | null;
}

const metres = (m: number) => Math.round(m);

/** Annotates every candidate against `chosen` (or, with none chosen, against each other). */
function annotate(cands: NeighborhoodCenter[], chosen: NeighborhoodCenter | null, thresholdM: number): CenterCandidate[] {
  return cands.map((c) => {
    if (chosen) {
      const d = haversineM(c, chosen);
      return { ...c, distanceFromCenterM: metres(d), disagrees: d > thresholdM, chosen: c === chosen };
    }
    const far = cands.some((o) => o !== c && haversineM(o, c) > thresholdM);
    return { ...c, distanceFromCenterM: null, disagrees: far, chosen: false };
  });
}

/**
 * The centre distances may be measured from, with every candidate kept.
 * Candidates outside Georgia (a swapped or mis-parsed pair) are dropped first.
 */
export function chooseCenter(input: NeighborhoodCenter[], thresholdM = CENTER_DISAGREEMENT_M): CenterDecision {
  const cands = input
    .filter((c) => c && inGeorgia(c))
    .map((c) => ({ ...c, confidence: c.confidence ?? centerConfidence(c) }))
    .sort((a, b) => rank(a) - rank(b));
  if (!cands.length) return { center: null, candidates: [], issue: null };

  const high = cands.find((c) => c.confidence === 'HIGH');
  if (high) return { center: high, candidates: annotate(cands, high, thresholdM), issue: null };

  const drawings = cands.filter((c) => c.basis === 'SITUATIONAL_DRAWING');
  const geocodes = cands.filter((c) => c.basis === 'GEOCODED_ADDRESS');
  if (drawings.length) {
    const corroborated = drawings.find((d) => geocodes.some((g) => haversineM(d, g) <= thresholdM));
    if (corroborated) return { center: corroborated, candidates: annotate(cands, corroborated, thresholdM), issue: null };
    // Only a house-validated geocode may outrank a drawing; the drawing stays a flagged candidate.
    const house = geocodes.find((g) => g.precision === 'HOUSE');
    if (house) return { center: house, candidates: annotate(cands, house, thresholdM), issue: 'DRAWING_SET_ASIDE' };
    return {
      center: null,
      candidates: annotate(cands, null, thresholdM),
      issue: geocodes.length ? 'CENTER_CONFLICT' : 'UNCORROBORATED_DRAWING',
    };
  }
  const best = geocodes[0] ?? null;
  return { center: best, candidates: annotate(cands, best, thresholdM), issue: null };
}
