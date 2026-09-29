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
  /** Metres, space coordinates: x/z on the floor plane, y up. */
  position: Vec3;
  /** Rotation about the vertical axis, radians, counter-clockwise from +x. */
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
