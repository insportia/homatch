// THE DESIGNED HOME, SEEN — the contract behind master and room renders and their edits.
//
// Two sources of truth, kept apart on purpose:
//
//   GEOMETRY   the validated reconstruction (the spatial source's canonical
//              scene): footprint, rooms, walls, openings, stairs, scale.
//   DESIGN     PropertyDesignDNA + the approved design version (DesignState):
//              finishes, furniture and where it stands, lighting.
//
// A render is the Blender factory's deterministic picture of BOTH (Cycles,
// from a planned camera), optionally given a photoreal FINISH by an image
// model that is constrained to it and checked against it: a finish that moved
// a wall, a door or a piece is refused and the Blender picture stands. Every
// render keeps an OBJECT MAP — which canonical object or surface each pixel
// shows — so a tap on the picture selects the real thing, and an edit changes
// the design itself (DesignState operations), which the walkthrough is built
// from. A picture never redefines geometry.
//
// Pure types and small pure helpers; no I/O.

import type { DesignPreferences } from '../planToHome.ts';

// ── Cameras ──────────────────────────────────────────────────────────────

export type ViewKind = 'MASTER' | 'ROOM';

/** What a planned view is for (the planner's reasoning, kept with the view). */
export type ViewPurpose = 'DOLLHOUSE' | 'MAIN' | 'REVERSE' | 'FUNCTION' | 'DETAIL' | 'CONNECTION';

/**
 * A camera in plan metres (x east, y north, z up), as the factory renders it.
 * MASTER: a dollhouse view — orthographic or long-lens, from above at an angle,
 * every ceiling removed and walls cut at `cut` heights so the whole furnished
 * home reads at once. ROOM: an eye-level photograph inside one room, full-height walls.
 */
export interface SpecView {
  id: string;
  kind: ViewKind;
  purpose: ViewPurpose;
  roomId: string | null;
  position: [number, number, number];
  target: [number, number, number];
  /** Vertical field of view in degrees (perspective), or null with `orthoScale`. */
  fovDeg: number | null;
  /** Orthographic: metres the view's height covers. */
  orthoScale: number | null;
  aspect: number;
  width: number;
  height: number;
  samples: number;
  /** Wall heights for this view only (dollhouse); null = full height. */
  cut: { exteriorM: number; interiorM: number } | null;
  hideCeilings: boolean;
  /** Write the object map (id image + legend) for this view. */
  objectMap: boolean;
}

// ── The object map ───────────────────────────────────────────────────────

/** What a region of a picture is: an object, or one of the design's surfaces. */
export type MapTargetKind = 'OBJECT' | 'FLOOR' | 'WALL' | 'CEILING' | 'STAIRS' | 'DOOR' | 'WINDOW' | 'OTHER';

export interface MapEntry {
  /** The colour the id image paints this target with ("#rrggbb"), unique per view. */
  color: string;
  kind: MapTargetKind;
  /**
   * The canonical id: an object's instanceId, a surface id ("floor:r-1",
   * "wall:w-3:L:r-1", "ceiling:r-1"), an opening id, a stair id.
   */
  id: string;
  roomId: string | null;
  /** Share of the picture's pixels it covers (0–1), and its bounding box in 0–1 picture coordinates. */
  coverage: number;
  box: [number, number, number, number];
}

/** One view's object map: a lossless id image (PNG) and its legend. */
export interface ObjectMap {
  width: number;
  height: number;
  entries: MapEntry[];
}

// ── Records the customer sees ────────────────────────────────────────────

export type RenderStatus = 'QUOTED' | 'QUEUED' | 'RENDERING' | 'FINISHING' | 'READY' | 'FAILED' | 'CANCELLED';

/** How a picture was finished: Blender alone, or an image model over it (and which). */
export interface RenderFinish {
  provider: 'BLENDER' | 'OPENAI' | 'GEMINI';
  model: string | null;
  /** The structure check against Blender's picture: accepted or refused, and why. */
  check: { accepted: boolean; edgeAgreement: number | null; maskAgreement: number | null; reason: string | null } | null;
  ms: number | null;
  usd: number | null;
}

/** ds_renders, as the browser reads it (signed URLs are requested separately). */
export interface RenderRecord {
  id: string;
  project_id: string;
  version_id: string;
  kind: ViewKind | 'EDIT';
  parent_id: string | null;
  view: SpecView;
  status: RenderStatus;
  factory_job_id: string | null;
  /** The Blender picture, the id image, the finished picture (storage keys; never shown raw to a customer). */
  base_key: string | null;
  map_key: string | null;
  final_key: string | null;
  legend: ObjectMap | null;
  finish: RenderFinish | null;
  /** For an EDIT: what was changed, in the design's own terms. */
  edit: RenderEdit | null;
  billing: { credits: number | null; reservationId: string | null; state: 'NOT_CHARGED' | 'RESERVED' | 'SETTLED' | 'RELEASED' } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Edits ────────────────────────────────────────────────────────────────

/**
 * APPEARANCE: the picture is repainted inside the target's own mask, the
 * design changes the same way (one DesignState operation), nothing moves.
 * SPATIAL: the design changes (move / rotate / replace / remove), is validated,
 * and the affected views are re-rendered by the factory.
 */
export type RenderEdit =
  | { type: 'APPEARANCE'; targetId: string; targetKind: MapTargetKind; color: string | null; materialId: string | null; label: string }
  | { type: 'SPATIAL'; targetId: string; op: 'MOVE' | 'ROTATE' | 'REPLACE' | 'REMOVE'; detail: Record<string, unknown> };

// ── Money ────────────────────────────────────────────────────────────────

export type RenderProduct = 'DS_MASTER_RENDER' | 'DS_ROOM_RENDER' | 'DS_RENDER_EDIT';

export interface RenderQuote {
  /** Signed by the server; a start must present it unchanged and before it expires. */
  token: string;
  product: RenderProduct | 'DS_WALKTHROUGH';
  views: number;
  /** The MAXIMUM: what the customer confirms and what is reserved; the charge is the measured cost, never above it. */
  credits: number;
  /** The minimum and the estimate shown beside it (server-priced from measured cost; 0.1 credit). */
  min: number;
  est: number;
  expiresAt: string;
  /** False while Design Studio charging is switched off: shown, confirmed, not charged. */
  charged: boolean;
}

// ── The design, as one source of truth ───────────────────────────────────

/**
 * PropertyDesignDNA — the customer's choices resolved ONCE into concrete,
 * catalogue-backed decisions, kept with the design version and reused by
 * every render, room view and edit, so the same home stays the same home.
 */
export interface PropertyDesignDNA {
  version: 'ds-dna-1';
  preferences: DesignPreferences;
  palette: string[];
  /** Surface class → catalogue material id (or null for a colour) and its colour. */
  finishes: {
    floor: { materialId: string | null; color: string };
    wetFloor: { materialId: string | null; color: string };
    outdoorFloor: { materialId: string | null; color: string };
    walls: { materialId: string | null; color: string };
    accentWall: { materialId: string | null; color: string } | null;
    ceiling: { color: string };
    cabinetry: { color: string; materialId: string | null };
    metal: string;
  };
  lighting: { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interior: number };
  /** Words the photoreal finish is told (style, character, textiles) — never geometry. */
  look: string[];
  /** The AI design job it came from, when it did. */
  sourceJobId: string | null;
}

/** Stable JSON of the DNA: the same choices are the same DNA (and the same cached renders). */
export function dnaKey(dna: PropertyDesignDNA): string {
  const walk = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${walk((v as Record<string, unknown>)[k])}`).join(',')}}`;
    return JSON.stringify(v ?? null);
  };
  return walk(dna);
}
