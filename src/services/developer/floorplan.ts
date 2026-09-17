/**
 * THE FLOOR PLAN, AS A STRUCTURE RATHER THAN A PICTURE.
 *
 * This is the contract between the two halves of the 2D → 3D pipeline, and the
 * division of labour is the whole design:
 *
 *   OPENAI INTERPRETS.   It reads a drawing and says what it can see, with a
 *                        confidence and, where practical, the evidence it read
 *                        it from. It is not allowed to supply an architectural
 *                        fact it did not see: an absent ceiling height is
 *                        null, not 2.9.
 *   A PERSON VERIFIES.   Everything arrives UNVERIFIED. An operator confirms
 *                        or corrects it in the overlay, and the corrections
 *                        are stored separately from what the model said so
 *                        the difference is auditable for ever.
 *   HOMATCH GENERATES.   The geometry layer is deterministic code that takes
 *                        VERIFIED structure and produces the same result every
 *                        time. It calls no model. A wall is a start point, an
 *                        end point, a height and a thickness, and those four
 *                        numbers produce its mesh.
 *
 * WHAT THIS TYPE REFUSES TO EXPRESS
 *
 * There is no field here for "the model's impression", no free-text room
 * description that could become geometry, and no default for anything
 * structural. If the drawing does not carry a scale, `detectedScale` is null
 * and the pipeline stops at the gate — because every length downstream is that
 * one number multiplied out, and a guessed scale is a building of the wrong
 * size rendered with total confidence.
 */

// ── Units and coordinates ──────────────────────────────────────────────────

/**
 * A point in the SOURCE IMAGE's pixel space, origin top-left.
 *
 * Extraction works in pixels because that is what the model can actually see
 * and point at; metres appear only after the normalizer multiplies by a
 * VERIFIED scale. Keeping the two apart is what makes an unverified scale
 * impossible to use by accident.
 */
export interface PixelPoint { x: number; y: number }

/** A point in metres, origin at the plan's own minimum corner, y forward. */
export interface MetrePoint { x: number; y: number }

export type VerificationState = 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | 'REJECTED';

/** Everything the model asserts carries these three, without exception. */
export interface Asserted {
  /** 0–1. The model's own confidence in THIS element, not in the drawing. */
  confidence: number;
  /** Where it read it: a label, a dimension string, a hatch pattern. */
  evidence?: string | null;
  state: VerificationState;
}

// ── The elements ───────────────────────────────────────────────────────────

export interface WallSegment extends Asserted {
  id: string;
  start: PixelPoint;
  end: PixelPoint;
  /** Exterior walls carry the building; interior ones divide it. */
  kind: 'EXTERIOR' | 'INTERIOR';
  /** Pixels. Null when the drawing does not show a wall thickness. */
  thicknessPx: number | null;
}

export interface Opening extends Asserted {
  id: string;
  /** The wall it sits in. An opening with no wall is a warning, not geometry. */
  wallId: string;
  /** 0–1 along the wall from `start` to `end`. */
  position: number;
  widthPx: number;
  /** Doors: the leaf height. Windows: sill and head. Null when not drawn. */
  sillHeightM?: number | null;
  heightM?: number | null;
}

export type RoomKind =
  | 'LIVING' | 'BEDROOM' | 'KITCHEN' | 'BATHROOM' | 'WC' | 'HALL'
  | 'CORRIDOR' | 'STORAGE' | 'BALCONY' | 'TERRACE' | 'UNKNOWN';

export interface RoomPolygon extends Asserted {
  id: string;
  kind: RoomKind;
  /** The label as printed on the drawing, in the drawing's own language. */
  label: string | null;
  /** Closed ring, in image pixels. First point is not repeated at the end. */
  polygon: PixelPoint[];
  /** Square metres AS PRINTED on the plan, when it prints one. */
  statedAreaM2: number | null;
}

export interface UnknownElement {
  id: string;
  /** What the model saw and could not classify, in its own words. */
  note: string;
  polygon?: PixelPoint[] | null;
  confidence: number;
}

export type WarningCode =
  | 'NO_SCALE'
  | 'SCALE_INFERRED'
  | 'OPEN_ROOM_POLYGON'
  | 'OPENING_WITHOUT_WALL'
  | 'OVERLAPPING_ROOMS'
  | 'NO_CEILING_HEIGHT'
  | 'AREA_MISMATCH'
  | 'AMBIGUOUS_BALCONY'
  | 'LOW_RESOLUTION'
  | 'UNREADABLE_REGION';

export interface FloorPlanWarning {
  code: WarningCode;
  detail?: string | null;
  /** The element it concerns, when it concerns one. */
  elementId?: string | null;
}

/** Where a number came from. A guess is never one of these. */
export type FactSource = 'DRAWING' | 'OPERATOR' | 'PROJECT_DEFAULT' | null;

export interface FloorPlanDocument {
  /** The dt_assets row the drawing itself lives in. */
  sourceAssetId: string;
  /** Pixel dimensions of the image the coordinates refer to. */
  imageWidth: number;
  imageHeight: number;

  /**
   * Metres per pixel. NULL when the drawing carries no dimension the model
   * could measure against — the single most important null in this file,
   * because every length downstream is this number multiplied out.
   */
  detectedScale: number | null;
  scaleConfidence: number;
  scaleEvidence?: string | null;

  /** Metres. NULL unless the drawing states it or an operator supplies it. */
  ceilingHeight: number | null;
  ceilingHeightSource: FactSource;

  walls: WallSegment[];
  doors: Opening[];
  windows: Opening[];
  rooms: RoomPolygon[];
  balconies: RoomPolygon[];
  unknownElements: UnknownElement[];
  warnings: FloorPlanWarning[];

  /** The LOWEST element confidence, never the average. See below. */
  extractionConfidence: number;
}

/**
 * THE OVERALL CONFIDENCE IS THE WEAKEST LINK, NOT THE AVERAGE.
 *
 * A reading with thirty certain walls and one doubtful exterior wall is a
 * doubtful reading: that one wall is where the building leaks. Averaging would
 * bury exactly the element a reviewer most needs to look at, which is the same
 * rule the document extractor already follows for contract fields.
 */
export function overallConfidence(doc: Pick<FloorPlanDocument,
  'walls' | 'doors' | 'windows' | 'rooms' | 'balconies' | 'scaleConfidence'>): number {
  const all = [
    doc.scaleConfidence,
    ...doc.walls.map((w) => w.confidence),
    ...doc.doors.map((d) => d.confidence),
    ...doc.windows.map((w) => w.confidence),
    ...doc.rooms.map((r) => r.confidence),
    ...doc.balconies.map((b) => b.confidence),
  ].filter((n) => Number.isFinite(n));
  if (all.length === 0) return 0;
  return Math.min(...all);
}

// ── The gate ───────────────────────────────────────────────────────────────

export type GateCategory =
  | 'SCALE' | 'EXTERIOR_WALLS' | 'INTERIOR_WALLS' | 'ROOMS'
  | 'DOORS' | 'WINDOWS' | 'BALCONY' | 'CEILING_HEIGHT';

export interface GateRow {
  category: GateCategory;
  /** Null where the category has no elements — "none found" is not 0%. */
  confidence: number | null;
  /** Every element of this category confirmed or corrected by a person. */
  verified: boolean;
  /** Generation cannot proceed without this category. */
  required: boolean;
  count: number;
}

export interface GateResult {
  rows: GateRow[];
  /** True only when every REQUIRED category is verified. */
  canGenerate: boolean;
  blockedBy: GateCategory[];
}

/** Confidence below this always needs a person, however well it scored. */
export const REVIEW_THRESHOLD = 0.85;

/**
 * WHAT MUST BE TRUE BEFORE ANY GEOMETRY IS GENERATED.
 *
 * Scale, exterior walls and rooms are REQUIRED: without them there is no
 * building, no envelope and no floor. Doors, windows, balconies and interior
 * walls are not required — an apartment with unverified windows still produces
 * a truthful shell with no windows in it, which is better than a shell with
 * windows somebody guessed. Whatever is not verified is simply not built, and
 * the gate says which.
 */
export function evaluateGate(doc: FloorPlanDocument): GateResult {
  const cat = (
    category: GateCategory,
    items: Asserted[],
    required: boolean,
  ): GateRow => ({
    category,
    count: items.length,
    confidence: items.length === 0 ? null : Math.min(...items.map((i) => i.confidence)),
    verified: items.length > 0
      && items.every((i) => i.state === 'VERIFIED' || i.state === 'CORRECTED'),
    required,
  });

  const exterior = doc.walls.filter((w) => w.kind === 'EXTERIOR');
  const interior = doc.walls.filter((w) => w.kind === 'INTERIOR');

  const rows: GateRow[] = [
    {
      category: 'SCALE',
      count: doc.detectedScale == null ? 0 : 1,
      confidence: doc.detectedScale == null ? null : doc.scaleConfidence,
      // A scale is verified when a person has accepted or typed it. The
      // document records that by carrying a scale AND full confidence.
      verified: doc.detectedScale != null && doc.scaleConfidence >= 1,
      required: true,
    },
    cat('EXTERIOR_WALLS', exterior, true),
    cat('ROOMS', doc.rooms, true),
    cat('INTERIOR_WALLS', interior, false),
    cat('DOORS', doc.doors, false),
    cat('WINDOWS', doc.windows, false),
    cat('BALCONY', doc.balconies, false),
    {
      category: 'CEILING_HEIGHT',
      count: doc.ceilingHeight == null ? 0 : 1,
      confidence: null,
      verified: doc.ceilingHeight != null && doc.ceilingHeightSource !== null,
      required: true,
    },
  ];

  const blockedBy = rows.filter((r) => r.required && !r.verified).map((r) => r.category);
  return { rows, canGenerate: blockedBy.length === 0, blockedBy };
}

// ── Persistence shape ──────────────────────────────────────────────────────

export type FloorPlanStatus =
  | 'EXTRACTING' | 'NEEDS_REVIEW' | 'VERIFIED' | 'GENERATED' | 'FAILED';

/**
 * The three versions are stored side by side ON PURPOSE (§F).
 *
 * `extraction` is what the model said and is never edited. `corrections` is
 * what a person changed, keyed by element id. `verified` is the document the
 * generator actually consumes. Keeping all three is what lets somebody ask, a
 * year later, whether the model or the operator put that wall there.
 */
export interface FloorPlanRecord {
  id: string;
  workspace_id: string;
  project_id: string | null;
  unit_type_id: string | null;
  asset_id: string;
  status: FloorPlanStatus;
  extraction: FloorPlanDocument | null;
  corrections: Record<string, unknown> | null;
  verified: FloorPlanDocument | null;
  extraction_confidence: number | null;
  extraction_error: string | null;
  model: string | null;
  cost_cents: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
