// HOMATCH RESEARCH CORE — the same observation, seen twice.
//
// A duplicate is THE SAME OBSERVATION, not the same subject. That distinction
// is the whole design, and getting it wrong deletes real evidence:
//
//   1. canonical URL        — the same document, reached two ways.
//   2. content hash         — the same prose, re-hosted on a mirror.
//   3. structured source id — the same record republished under several URLs.
//   4. entity identity      — the same property listed twice by one source.
//
// Signals 3 and 4 are scoped to a single SOURCE FAMILY on purpose. A registry
// record and a portal listing describe the same flat and share a cadastral
// code, but they are two organisations making two independent claims —
// merging them would silently delete one of the two prices we are trying to
// compare. Establishing that two sources are talking about the same property
// is what makes their facts comparable; it is not evidence that they are
// copies of each other.
//
// NOTHING IS DELETED. A duplicate keeps its place in the result with
// `independent: false` and a recorded reason, so the audit trail survives. It
// simply stops voting and stops inflating the source count. Homatch's rule is
// "no evidence = no fact"; quietly dropping an observation because it looked
// redundant would be the same failure from the other direction.
//
// This is DOCUMENT dedupe. It is not entity resolution: official-worker's
// EntityDeduplicator stays the authority on whether two companies are one
// company, and nothing here second-guesses it.

import type { Observation } from '../core/types.ts';

export type DuplicateReason =
  | 'CANONICAL_URL'
  | 'CONTENT_HASH'
  | 'STRUCTURED_SOURCE_ID'
  | 'ENTITY_IDENTITY';

export interface DedupedObservation {
  observation: Observation;
  independent: boolean;
  duplicateOf: string | null;
  duplicateReason: DuplicateReason | null;
}

export interface DuplicateGroup {
  primaryObservationId: string;
  duplicateObservationIds: string[];
  reason: DuplicateReason;
}

export interface DedupeResult {
  observations: DedupedObservation[];
  groups: DuplicateGroup[];
  duplicateCount: number;
}

/**
 * Rank observations so the STRONGEST member of a duplicate group is kept as
 * the primary and the restatements are the ones marked redundant.
 *
 * Supplied by the caller because "strongest" is a question about the source,
 * and the core has no authority table — Homatch's Provenance/Tier does. Ties
 * break on id so the outcome is deterministic across runs.
 */
export type ObservationRank = (observation: Observation) => number;

const defaultRank: ObservationRank = () => 0;

export function dedupeObservations(
  observations: readonly Observation[],
  options: { rank?: ObservationRank; entityIdOf?: (o: Observation) => string | null } = {},
): DedupeResult {
  const rank = options.rank ?? defaultRank;
  const entityIdOf = options.entityIdOf ?? (() => null);

  const parent = new Map<string, string>();
  const reasonById = new Map<string, DuplicateReason>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = id;
    while (parent.get(cursor) && parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const observation of observations) parent.set(observation.id, observation.id);

  const byCanonicalUrl = new Map<string, string>();
  const byContentHash = new Map<string, string>();
  const bySourceId = new Map<string, string>();
  const byEntity = new Map<string, string>();

  const link = (
    index: Map<string, string>,
    key: string | null,
    id: string,
    reason: DuplicateReason,
  ): void => {
    if (!key) return;
    const existing = index.get(key);
    if (!existing) {
      index.set(key, id);
      return;
    }
    // Record the reason against the item being folded in, not against the
    // group: "this page matched by content hash" is only true of that page.
    if (!reasonById.has(id)) reasonById.set(id, reason);
    union(existing, id);
  };

  for (const observation of observations) {
    link(byCanonicalUrl, observation.canonicalIdentityUrl, observation.id, 'CANONICAL_URL');
    link(byContentHash, observation.contentHash, observation.id, 'CONTENT_HASH');

    if (observation.structuredSourceId) {
      // Family-scoped: listing "4471" on two unrelated portals is a
      // coincidence, not a duplicate.
      link(
        bySourceId,
        `${observation.source.sourceFamily}\u001f${observation.structuredSourceId}`,
        observation.id,
        'STRUCTURED_SOURCE_ID',
      );
    }

    const entityId = entityIdOf(observation);
    if (entityId) {
      // Also family-scoped. ACROSS families a shared entity means "these are
      // about the same property", which is precisely the condition under which
      // we want both of them voting.
      link(
        byEntity,
        `${observation.source.sourceFamily}\u001f${entityId}`,
        observation.id,
        'ENTITY_IDENTITY',
      );
    }
  }

  const groupsByRoot = new Map<string, Observation[]>();
  for (const observation of observations) {
    const root = find(observation.id);
    const bucket = groupsByRoot.get(root);
    if (bucket) bucket.push(observation);
    else groupsByRoot.set(root, [observation]);
  }

  const groups: DuplicateGroup[] = [];
  const output: DedupedObservation[] = [];
  let duplicateCount = 0;

  for (const members of groupsByRoot.values()) {
    if (members.length === 1) {
      output.push({
        observation: members[0] as Observation,
        independent: true,
        duplicateOf: null,
        duplicateReason: null,
      });
      continue;
    }

    const ranked = [...members].sort(
      (a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id),
    );
    const primary = ranked[0] as Observation;
    const duplicates = ranked.slice(1);

    output.push({
      observation: primary,
      independent: true,
      duplicateOf: null,
      duplicateReason: null,
    });

    for (const duplicate of duplicates) {
      duplicateCount += 1;
      output.push({
        observation: duplicate,
        independent: false,
        duplicateOf: primary.id,
        duplicateReason: reasonById.get(duplicate.id) ?? 'ENTITY_IDENTITY',
      });
    }

    groups.push({
      primaryObservationId: primary.id,
      duplicateObservationIds: duplicates.map((d) => d.id),
      reason: reasonById.get(duplicates[0]?.id ?? '') ?? 'ENTITY_IDENTITY',
    });
  }

  return { observations: output, groups, duplicateCount };
}
