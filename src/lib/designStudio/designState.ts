// THE DESIGN, AS DATA.
//
// A design version's state is everything the customer decided about a
// space and nothing about the space itself: which catalogue assets stand
// where, which material or colour each surface wears, how it is lit, which
// style direction it follows, and what is locked. Geometry is referenced
// (room and surface ids from the spatial source), never copied.
//
// Everything here is plain JSON so it can be persisted, diffed, validated
// and replayed deterministically.

import { normalizeShape, type ObjectShape } from './objectShape.ts';

export const DESIGN_STATE_SCHEMA = 1 as const;

export interface Vec3 { x: number; y: number; z: number }

/**
 * Where a piece came from, when it was not placed by hand: read from the
 * customer's reference images and matched to the catalogue. `confirmed`
 * becomes true once the customer confirms or edits it — AI then leaves it
 * alone, and a re-read never silently overwrites it.
 */
export interface ObjectProvenance {
  source: 'IMAGE_RECONSTRUCTION';
  /** The reconstruction's own key for what was seen. */
  ref: string;
  label: string;
  detectedType: string;
  /** Reference image ids it was seen in. */
  images: string[];
  confidence: number;
  basis: 'OBSERVED' | 'INFERRED';
  /** 0..1 catalogue match score. */
  match: number;
  /** The catalogue piece is the closest HOMATCH has, not the thing itself. */
  approximate: boolean;
  confirmed: boolean;
}

/** One placed catalogue asset. `assetId` is a catalogue code, never a file. */
export interface ObjectInstance {
  instanceId: string;
  assetId: string;
  roomId: string | null;
  /**
   * Metres, in PLAN coordinates: x = plan x, z = plan y (not negated), y =
   * height above the floor. The renderer maps (x, z) to world (x, -z).
   */
  position: Vec3;
  /**
   * Radians counter-clockwise in plan from +x. The asset's front is its
   * local +y (plan), so rotation 0 faces "up the drawing".
   */
  rotationY: number;
  materialVariant: string | null;
  colorOverride: string | null;
  locked: boolean;
  provenance?: ObjectProvenance;
  /**
   * What a picture showed of this piece (size, form, second colour), when it
   * was rebuilt from one: it is drawn and collided at that size. Optional;
   * designs without it draw the catalogue piece as it is.
   */
  shape?: ObjectShape;
  /**
   * A model HOMATCH built from the customer's own picture for this piece (the
   * hybrid engine's GPU path): project-private, referenced, never copied. The
   * catalogue asset still says what the piece IS and can do; this is how it
   * LOOKS. Optional; without it the piece is drawn as before.
   */
  generated?: GeneratedRef;
}

export interface GeneratedRef { assetId: string; key: string; sha256: string | null }

const GEN_KEY = /^users\/[0-9a-f-]{36}\/design-studio-models\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.glb$/;
export function normalizeGenerated(raw: unknown): GeneratedRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  if (typeof g.assetId !== 'string' || typeof g.key !== 'string' || !GEN_KEY.test(g.key) || !g.key.endsWith(`/${g.assetId}.glb`)) return undefined;
  return { assetId: g.assetId, key: g.key, sha256: typeof g.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(g.sha256) ? g.sha256.toLowerCase() : null };
}

function normalizeProvenance(raw: unknown): ObjectProvenance | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  if (p.source !== 'IMAGE_RECONSTRUCTION' || typeof p.ref !== 'string') return undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  return {
    source: 'IMAGE_RECONSTRUCTION',
    ref: p.ref.slice(0, 40),
    label: typeof p.label === 'string' ? p.label.slice(0, 80) : '',
    detectedType: typeof p.detectedType === 'string' ? p.detectedType.slice(0, 24) : 'OTHER',
    images: Array.isArray(p.images) ? p.images.filter((x): x is string => typeof x === 'string').slice(0, 12) : [],
    confidence: num(p.confidence),
    basis: p.basis === 'OBSERVED' ? 'OBSERVED' : 'INFERRED',
    match: num(p.match),
    approximate: p.approximate !== false,
    confirmed: p.confirmed === true,
  };
}

/**
 * What a surface wears. `surfaceId` is a stable id derived from the source
 * geometry: `floor:<roomId>`, `ceiling:<roomId>`, `wall:<wallId>:<side>`.
 */
export interface SurfaceAssignment {
  materialId: string | null;
  color: string | null;
  finish: 'MATTE' | 'SATIN' | 'GLOSS' | null;
  /**
   * What the surface's pattern is, when a reading SAW it (herringbone
   * parquet, tiles…) and no catalogue material says otherwise. Optional:
   * designs saved before it existed simply have none.
   */
  pattern?: 'WOOD_PLANK' | 'WOOD_HERRINGBONE' | 'TILE' | 'STONE' | 'CONCRETE' | 'CARPET' | null;
  /**
   * The colour a picture showed this surface in, when an imported (textured)
   * material was chosen for it: the texture is balanced to it, so herringbone
   * oak is the oak tone the customer saw. Optional; cleared by any new choice.
   */
  tint?: string | null;
  locked: boolean;
}

export type TimeOfDay = 'DAY' | 'EVENING' | 'NIGHT';
export type LightTemperature = 'WARM' | 'NEUTRAL' | 'COOL';

export interface LightingState {
  timeOfDay: TimeOfDay;
  temperature: LightTemperature;
  /** 0..1 — a design preview intensity, not a lux value. */
  interiorIntensity: number;
  locked: boolean;
}

/** Category-level locks ("keep the floor", "keep the layout"). */
export interface LockSet {
  layout: boolean;
  furniture: boolean;
  walls: boolean;
  floor: boolean;
  kitchen: boolean;
  colors: boolean;
  lighting: boolean;
}

export interface DesignState {
  schema: typeof DESIGN_STATE_SCHEMA;
  objects: ObjectInstance[];
  surfaces: Record<string, SurfaceAssignment>;
  lighting: LightingState;
  /** Project palette: hex colours in the order the customer arranged them. */
  palette: string[];
  styleCode: string | null;
  locks: LockSet;
  /** Uploaded models only: identified furniture parts the customer has hidden (`part:<node>`). */
  hiddenParts: string[];
  /** The colour of the window and glazing frames, when a picture showed it (black steel, white uPVC…). */
  frames?: string | null;
}

export function emptyDesignState(): DesignState {
  return {
    schema: DESIGN_STATE_SCHEMA,
    objects: [],
    surfaces: {},
    lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.6, locked: false },
    palette: [],
    styleCode: null,
    locks: {
      layout: false, furniture: false, walls: false, floor: false,
      kitchen: false, colors: false, lighting: false,
    },
    hiddenParts: [],
  };
}

/**
 * A stored state brought up to the current schema: missing parts get their
 * defaults, unknown parts are dropped. A design saved by an older build
 * always opens.
 */
export function normalizeDesignState(raw: unknown): DesignState {
  const base = emptyDesignState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DesignState>;
  return {
    schema: DESIGN_STATE_SCHEMA,
    objects: Array.isArray(r.objects)
      ? r.objects.filter((o) => o && typeof o.instanceId === 'string' && typeof o.assetId === 'string').map((o) => {
        const provenance = normalizeProvenance(o.provenance);
        const shape = normalizeShape(o.shape);
        const generated = normalizeGenerated(o.generated);
        const { provenance: _drop, shape: _dropShape, generated: _dropGenerated, ...rest } = o;
        return { ...rest, ...(provenance ? { provenance } : {}), ...(shape ? { shape } : {}), ...(generated ? { generated } : {}) };
      })
      : [],
    surfaces: r.surfaces && typeof r.surfaces === 'object' ? r.surfaces : {},
    lighting: { ...base.lighting, ...(r.lighting ?? {}) },
    palette: Array.isArray(r.palette) ? r.palette : [],
    styleCode: typeof r.styleCode === 'string' ? r.styleCode : null,
    locks: { ...base.locks, ...(r.locks ?? {}) },
    hiddenParts: Array.isArray(r.hiddenParts)
      ? [...new Set(r.hiddenParts.filter((p): p is string => typeof p === 'string' && /^part:\d{1,6}$/.test(p)))].slice(0, 5000)
      : [],
    ...(typeof r.frames === 'string' && /^#[0-9a-f]{6}$/i.test(r.frames) ? { frames: r.frames.toLowerCase() } : {}),
  };
}
