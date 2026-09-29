// HOMATCH DESIGN STUDIO — the shared vocabulary.
//
// Two things are kept apart everywhere in this module tree, and the type
// names are chosen so that mixing them up reads as wrong at the call site:
//
//   SPATIAL SOURCE   the space itself — a published developer apartment, a
//                    customer's own 3D model, or geometry generated from a
//                    customer's floor plan. Immutable once ready.
//   DESIGN VERSION   what the customer did to that space. Small, structured,
//                    versioned, and never a copy of the geometry.
//
// Nothing in here imports three.js or the network: these are plain data
// shapes that the deterministic engine, the persistence layer and the
// renderer all agree on.

import type { GeneratedScene } from '@/lib/floorplan/geometry';

export type SpatialSourceKind = 'DEVELOPER_UNIT' | 'UPLOADED_MODEL' | 'FLOORPLAN_SCENE';

/**
 * How much the geometry can be trusted as a measurement.
 *
 *   ESTIMATED   proportions from a drawing; the scale is inferred from weak
 *               signals (a door, a fixture, a printed area) and is shown as
 *               an estimate everywhere a size is shown.
 *   CALIBRATED  at least one real-world anchor supplied by the customer
 *               ("the flat is 82 m²", "this wall is 4.1 m").
 *   VERIFIED    trusted source data (published developer geometry) or
 *               enough agreeing anchors.
 *
 * These are Design Studio's own states. The Developer floor-plan gate
 * (`evaluateGate`) keeps its stricter semantics and is not consulted here.
 */
export type GeometryState = 'ESTIMATED' | 'CALIBRATED' | 'VERIFIED';

/**
 * What can truthfully be edited in a source.
 *
 *   FULLY_STRUCTURED      separate, named objects (sofa, chair, table...)
 *   PARTIALLY_STRUCTURED  some objects are separable, some are baked
 *   VISUAL_MODEL          one baked mesh — it can be looked at, lit and
 *                         furnished around, but its contents cannot be
 *                         moved one by one, and the product never says so
 *   GENERATED             HOMATCH generated the shell; everything in it is
 *                         HOMATCH's own structure
 *   UNCLASSIFIED          not analysed yet
 */
export type Editability =
  | 'FULLY_STRUCTURED'
  | 'PARTIALLY_STRUCTURED'
  | 'VISUAL_MODEL'
  | 'GENERATED'
  | 'UNCLASSIFIED';

export type SourceStatus = 'PROCESSING' | 'READY' | 'FAILED' | 'SUPERSEDED';

/** The developer publication a DEVELOPER_UNIT source was pinned to. */
export interface UpstreamPin {
  scene_id: string;
  version: string;
  unit_type_id?: string | null;
}

export interface SpatialSourceRecord {
  id: string;
  project_id: string;
  kind: SpatialSourceKind;
  status: SourceStatus;
  geometry_state: GeometryState;
  editability: Editability;
  dev_unit_id: string | null;
  upstream: UpstreamPin | null;
  floorplan_id: string | null;
  model_object_key: string | null;
  model_sha256: string | null;
  model_bytes: number | null;
  model_mime: string | null;
  canonical: CanonicalSpace | Record<string, unknown> | null;
  calibration: Record<string, unknown> | null;
  generator_version: string | null;
  provenance: Record<string, unknown>;
  failure: string | null;
  supersedes_id: string | null;
  created_at: string;
}

/**
 * The canonical spatial model for a HOMATCH-generated space: the
 * deterministic floor-plan geometry, in metres, plus how its scale was
 * established. Every apartment is DATA in this shape; the same engine
 * processes every layout.
 */
export interface CanonicalSpace {
  schema: 1;
  units: 'm';
  generatorVersion: string;
  geometryState: GeometryState;
  /** Metres per source pixel, when the source was a drawing. */
  metresPerPx: number | null;
  /** Relative uncertainty of the scale (0.15 = ±15%), null when exact. */
  scaleUncertainty: number | null;
  scene: GeneratedScene;
}

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface DesignProjectRecord {
  id: string;
  user_id: string;
  name: string;
  property_id: string | null;
  dev_unit_id: string | null;
  active_source_id: string | null;
  head_version_id: string | null;
  status: ProjectStatus;
  thumbnail_key: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type VersionOrigin = 'ORIGINAL' | 'USER' | 'AI' | 'DUPLICATE' | 'BRANCH' | 'RESTORE';

export interface DesignVersionRecord {
  id: string;
  project_id: string;
  user_id: string;
  source_id: string;
  parent_id: string | null;
  name: string;
  origin: VersionOrigin;
  state: Record<string, unknown>;
  state_schema: number;
  revision: number;
  style_tags: string[];
  change_summary: unknown[];
  thumbnail_key: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
