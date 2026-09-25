// HOMATCH RESEARCH CORE — is this a discovery network, or one source?
//
// Eight adapters is not eight sources' worth of intelligence. If ninety per
// cent of what reaches a customer came from ss.ge, then Homatch is ss.ge with
// extra steps, and the honest thing is for that to be visible on an admin
// screen rather than discovered when ss.ge changes its markup.
//
// THERE IS NO COVERAGE PERCENTAGE HERE
//
// "We cover 80% of the market" needs a denominator, and nobody knows how many
// properties are for sale in Tbilisi. Every number below has a denominator
// that is something we actually counted: observations we hold, entities we
// resolved, sources we reached.
//
// share is "of what WE have", never "of what EXISTS", and the field is named
// so that a reader cannot mistake one for the other.
//
// UNIQUE YIELD IS THE NUMBER THAT MATTERS
//
// A source that returns four hundred listings the other sources already gave
// us has added four hundred rows and nothing else. incrementalUniqueEntities
// counts the entities that ONLY this source reached — which is the question
// "would we lose anything by dropping it".

export interface SourceObservationRow {
  adapterId: string;
  /** The resolved property, where the resolver reached one. */
  entityId: string | null;
  /** Whether the row carries a price a campaign could rank on. */
  hasPrice: boolean;
  /** Whether it carries an area, the field resolution leans on hardest. */
  hasArea: boolean;
  /** 0..1 provenance quality, as structuredQuality() scored it. */
  quality: number;
}

export interface SourceShare {
  adapterId: string;
  observations: number;
  /** Of the observations WE hold. Not of a market. */
  shareOfHeld: number;
  withPrice: number;
  withArea: number;
  /** Entities this source contributed at least one observation to. */
  entitiesTouched: number;
  /**
   * Entities NO other source reached.
   *
   * The answer to "what would we lose by dropping this source", and the only
   * number here that distinguishes a source that adds intelligence from one
   * that adds rows.
   */
  incrementalUniqueEntities: number;
  averageQuality: number;
}

export interface ConcentrationReport {
  observations: number;
  sources: number;
  entities: number;
  shares: SourceShare[];
  /** The largest single share, 0..1. */
  topSourceShare: number;
  topSource: string | null;
  /**
   * Herfindahl index over source shares, 0..1.
   *
   * One source is 1.0; four equal sources are 0.25. It is here because a top
   * share alone hides the difference between "one big and six tiny" and "two
   * evenly matched" — and a network of one source with six decorations is the
   * thing this report exists to make visible.
   */
  herfindahl: number;
  /**
   * Observations the resolver has not attached to any entity.
   *
   * Not a failure: UNRESOLVED is the resolver's default and most listings are
   * genuinely unique. It is here because a number that climbs towards 100% is
   * the sign that resolution has stopped working, and nothing else would show
   * that.
   */
  unresolvedObservations: number;
}

/**
 * Who Homatch is actually getting its supply from.
 *
 * Pure. Takes rows, returns counts. No thresholds, no verdicts and no advice:
 * an admin screen can decide that 0.9 is alarming, and it can do so where a
 * person can see the number it decided from.
 */
export function concentrationOf(rows: readonly SourceObservationRow[]): ConcentrationReport {
  const total = rows.length;
  const bySource = new Map<string, SourceObservationRow[]>();
  for (const row of rows) {
    if (!row.adapterId) continue;
    bySource.set(row.adapterId, [...(bySource.get(row.adapterId) ?? []), row]);
  }

  /* Which sources reached each entity, so uniqueness is a real count. */
  const entityToSources = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.entityId || !row.adapterId) continue;
    entityToSources.set(
      row.entityId,
      (entityToSources.get(row.entityId) ?? new Set()).add(row.adapterId),
    );
  }

  const shares: SourceShare[] = [];
  for (const [adapterId, group] of bySource) {
    const entities = new Set(group.map((r) => r.entityId).filter(Boolean) as string[]);
    let unique = 0;
    for (const entityId of entities) {
      if (entityToSources.get(entityId)?.size === 1) unique += 1;
    }
    shares.push({
      adapterId,
      observations: group.length,
      shareOfHeld: total > 0 ? round(group.length / total) : 0,
      withPrice: group.filter((r) => r.hasPrice).length,
      withArea: group.filter((r) => r.hasArea).length,
      entitiesTouched: entities.size,
      incrementalUniqueEntities: unique,
      averageQuality: group.length > 0
        ? round(group.reduce((sum, r) => sum + (Number(r.quality) || 0), 0) / group.length)
        : 0,
    });
  }

  shares.sort((a, b) => b.observations - a.observations);
  const top = shares[0] ?? null;

  return {
    observations: total,
    sources: shares.length,
    entities: entityToSources.size,
    shares,
    topSourceShare: top ? top.shareOfHeld : 0,
    topSource: top ? top.adapterId : null,
    herfindahl: round(shares.reduce((sum, s) => sum + s.shareOfHeld * s.shareOfHeld, 0)),
    unresolvedObservations: rows.filter((r) => !r.entityId).length,
  };
}

/** Four decimals. Enough to see a share move, not enough to imply precision. */
function round(value: number): number {
  return Number(value.toFixed(4));
}
