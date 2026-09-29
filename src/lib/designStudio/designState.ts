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

export const DESIGN_STATE_SCHEMA = 1 as const;

export interface Vec3 { x: number; y: number; z: number }

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
}

/**
 * What a surface wears. `surfaceId` is a stable id derived from the source
 * geometry: `floor:<roomId>`, `ceiling:<roomId>`, `wall:<wallId>:<side>`.
 */
export interface SurfaceAssignment {
  materialId: string | null;
  color: string | null;
  finish: 'MATTE' | 'SATIN' | 'GLOSS' | null;
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
    objects: Array.isArray(r.objects) ? r.objects.filter((o) => o && typeof o.instanceId === 'string' && typeof o.assetId === 'string') : [],
    surfaces: r.surfaces && typeof r.surfaces === 'object' ? r.surfaces : {},
    lighting: { ...base.lighting, ...(r.lighting ?? {}) },
    palette: Array.isArray(r.palette) ? r.palette : [],
    styleCode: typeof r.styleCode === 'string' ? r.styleCode : null,
    locks: { ...base.locks, ...(r.locks ?? {}) },
  };
}
