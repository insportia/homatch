// WHICH SPACE IS THIS DESIGN ABOUT?
//
// A project can accumulate several candidate sources over its life: the
// developer's published apartment, a model the customer uploaded, geometry
// generated from their floor plan (estimated first, calibrated later). The
// workspace must open exactly one, and it must never open one silently when
// that one is stale or incompatible.
//
// The order is fixed and deterministic:
//
//   A  a published Developer Digital Twin apartment, still current
//   B  the customer's own ingested 3D model
//   C  a CALIBRATED or VERIFIED floor-plan scene
//   D  an ESTIMATED floor-plan scene
//   E  nothing usable
//
// An explicit choice the customer made (the project's active source) wins
// over the order — but only if it is itself usable. Every candidate that is
// passed over is reported with the reason, so the UI can say "the developer
// published an updated apartment" instead of quietly switching geometry.

import type { SpatialSourceRecord, UpstreamPin } from './types';

export type SourceTier = 'A' | 'B' | 'C' | 'D' | 'E';

export type RejectionReason =
  | 'NOT_READY'
  | 'SUPERSEDED'
  | 'FAILED'
  | 'STALE_UPSTREAM'
  | 'UPSTREAM_WITHDRAWN'
  | 'INCOMPATIBLE_GENERATOR'
  | 'MISSING_PAYLOAD';

export interface Rejection {
  sourceId: string;
  reason: RejectionReason;
}

export interface ResolutionInput {
  sources: SpatialSourceRecord[];
  /** The project's explicitly chosen source, when the customer chose one. */
  preferredSourceId?: string | null;
  /**
   * What each developer unit publishes TODAY, keyed by unit id: the pin, or
   * null when nothing is published any more. A unit absent from the map has
   * not been checked; its source is usable but flagged `freshnessUnchecked`.
   */
  developerCurrent?: Record<string, UpstreamPin | null>;
  /** Generator versions the current engine can rebuild and edit. */
  supportedGenerators: readonly string[];
}

export interface Resolution {
  tier: SourceTier;
  source: SpatialSourceRecord | null;
  /** The customer's explicit choice was honoured. */
  explicit: boolean;
  /** A developer source whose publication could not be checked this time. */
  freshnessUnchecked: boolean;
  rejected: Rejection[];
}

/** The tier a READY, usable source belongs to. */
export function tierOf(source: SpatialSourceRecord): Exclude<SourceTier, 'E'> {
  switch (source.kind) {
    case 'DEVELOPER_UNIT':
      return 'A';
    case 'UPLOADED_MODEL':
      return 'B';
    case 'FLOORPLAN_SCENE':
      return source.geometry_state === 'ESTIMATED' ? 'D' : 'C';
  }
}

const TIER_RANK: Record<SourceTier, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

/** Why a source cannot be opened, or null when it can. */
export function unusableReason(
  source: SpatialSourceRecord,
  input: Pick<ResolutionInput, 'developerCurrent' | 'supportedGenerators'>,
): RejectionReason | null {
  if (source.status === 'SUPERSEDED') return 'SUPERSEDED';
  if (source.status === 'FAILED') return 'FAILED';
  if (source.status !== 'READY') return 'NOT_READY';

  switch (source.kind) {
    case 'DEVELOPER_UNIT': {
      if (!source.dev_unit_id || !source.upstream) return 'MISSING_PAYLOAD';
      const current = input.developerCurrent;
      if (current && Object.prototype.hasOwnProperty.call(current, source.dev_unit_id)) {
        const now = current[source.dev_unit_id];
        if (now === null) return 'UPSTREAM_WITHDRAWN';
        if (now.scene_id !== source.upstream.scene_id || String(now.version) !== String(source.upstream.version)) {
          return 'STALE_UPSTREAM';
        }
      }
      return null;
    }
    case 'UPLOADED_MODEL':
      return source.model_object_key ? null : 'MISSING_PAYLOAD';
    case 'FLOORPLAN_SCENE': {
      if (!source.canonical) return 'MISSING_PAYLOAD';
      if (!source.generator_version || !input.supportedGenerators.includes(source.generator_version)) {
        return 'INCOMPATIBLE_GENERATOR';
      }
      return null;
    }
  }
}

function newestFirst(a: SpatialSourceRecord, b: SpatialSourceRecord): number {
  if (a.created_at === b.created_at) return a.id < b.id ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

export function resolveSpatialSource(input: ResolutionInput): Resolution {
  const rejected: Rejection[] = [];
  const usable: SpatialSourceRecord[] = [];

  for (const source of input.sources) {
    const reason = unusableReason(source, input);
    if (reason) rejected.push({ sourceId: source.id, reason });
    else usable.push(source);
  }

  const freshnessUnchecked = (source: SpatialSourceRecord | null): boolean =>
    !!source && source.kind === 'DEVELOPER_UNIT' && !!source.dev_unit_id
    && !(input.developerCurrent
      && Object.prototype.hasOwnProperty.call(input.developerCurrent, source.dev_unit_id));

  if (input.preferredSourceId) {
    const chosen = usable.find((s) => s.id === input.preferredSourceId);
    if (chosen) {
      return {
        tier: tierOf(chosen), source: chosen, explicit: true,
        freshnessUnchecked: freshnessUnchecked(chosen), rejected,
      };
    }
  }

  const ordered = [...usable].sort((a, b) => {
    const byTier = TIER_RANK[tierOf(a)] - TIER_RANK[tierOf(b)];
    return byTier !== 0 ? byTier : newestFirst(a, b);
  });
  const best = ordered[0] ?? null;

  return {
    tier: best ? tierOf(best) : 'E',
    source: best,
    explicit: false,
    freshnessUnchecked: freshnessUnchecked(best),
    rejected,
  };
}

/**
 * The customer-facing description of where a space came from: translation
 * keys, never engineering language. "Developer Digital Twin", "Your 3D
 * model", "From your floor plan" — plus how far its dimensions can be
 * trusted.
 */
export interface ProvenanceLabel {
  originKey: string;
  geometryKey: string;
  editabilityKey: string | null;
}

export function provenanceLabel(source: SpatialSourceRecord): ProvenanceLabel {
  // A plan HOMATCH read from the customer's pictures is theirs "from your
  // pictures", never "from your floor plan" (20261001180000 records it).
  const originKey = source.kind === 'DEVELOPER_UNIT'
    ? 'ds_source_developer'
    : source.kind === 'UPLOADED_MODEL'
      ? 'ds_source_model'
      : source.provenance?.origin === 'CUSTOMER_PICTURES'
        ? 'ds_source_pictures'
        : 'ds_source_floorplan';

  const geometryKey = source.geometry_state === 'VERIFIED'
    ? 'ds_geometry_verified'
    : source.geometry_state === 'CALIBRATED'
      ? 'ds_geometry_calibrated'
      : 'ds_geometry_estimated';

  const editabilityKey = source.editability === 'VISUAL_MODEL'
    ? 'ds_editability_visual'
    : source.editability === 'PARTIALLY_STRUCTURED'
      ? 'ds_editability_partial'
      : source.editability === 'FULLY_STRUCTURED'
        ? 'ds_editability_full'
        : null;

  return { originKey, geometryKey, editabilityKey };
}
