// HOMATCH DESIGN STUDIO — plan reading v2: the shapes the deterministic half
// works on.
//
// These are STRUCTURAL copies of the contract in
// src/services/developer/floorplan.ts (FloorPlanDocument and its elements)
// and src/lib/designStudio/planToHome.ts (questions, answers, checks,
// issues, understanding). They are copied, not imported, because this folder
// is shared byte-for-byte between the edge (Deno, which cannot reach src/)
// and the browser (src/lib/designStudio/planRead/). The browser's index.ts
// proves at compile time that the copies still match the contract.
//
// Pure types; no code.

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export type ElementState = 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | 'REJECTED';

export interface Wall {
  id: string;
  start: Pt;
  end: Pt;
  kind: 'EXTERIOR' | 'INTERIOR';
  thicknessPx: number | null;
  confidence: number;
  evidence?: string | null;
  state: ElementState;
}

export type Leaf = 'HINGED' | 'DOUBLE' | 'SLIDING' | 'NONE' | 'FRENCH' | 'FIXED' | 'CASEMENT';

export interface Opening {
  id: string;
  wallId: string;
  position: number;
  widthPx: number;
  sillHeightM?: number | null;
  heightM?: number | null;
  centerPx?: Pt | null;
  leaf?: Leaf | null;
  swingRoomId?: string | null;
  confidence: number;
  evidence?: string | null;
  state: ElementState;
}

export type RoomKind =
  | 'LIVING' | 'BEDROOM' | 'KITCHEN' | 'BATHROOM' | 'WC' | 'HALL'
  | 'CORRIDOR' | 'STORAGE' | 'BALCONY' | 'TERRACE' | 'UNKNOWN';

export interface Room {
  id: string;
  kind: RoomKind;
  label: string | null;
  polygon: Pt[];
  statedAreaM2: number | null;
  dimensionText?: string | null;
  confidence: number;
  evidence?: string | null;
  state: ElementState;
}

export interface Stair {
  id: string;
  polygon: Pt[];
  startEdge: [Pt, Pt] | null;
  direction: 'UP' | 'DOWN' | 'UNKNOWN';
  treads: number | null;
  confidence: number;
  evidence?: string | null;
  state: ElementState;
}

export type TextRole =
  | 'ROOM_LABEL' | 'DIMENSION' | 'AREA' | 'SCALE' | 'NORTH' | 'LEVEL'
  | 'TITLE' | 'LOGO' | 'CONTACT' | 'NOTE' | 'OTHER';

export interface PlanText { id: string; text: string; role: TextRole; box: Box; roomId?: string | null; confidence: number }

export type IgnoredRole = 'TITLE_BLOCK' | 'LOGO' | 'CONTACT' | 'BORDER' | 'COMPASS' | 'LEGEND' | 'DIMENSION_LINES' | 'OTHER';

export interface Ignored { id: string; role: IgnoredRole; box: Box; note?: string | null }

export interface Unknown { id: string; note: string; polygon?: Pt[] | null; confidence: number }

export interface Warning { code: string; detail?: string | null; elementId?: string | null }

export interface PlanDoc {
  sourceAssetId: string;
  imageWidth: number;
  imageHeight: number;
  detectedScale: number | null;
  scaleConfidence: number;
  scaleEvidence?: string | null;
  ceilingHeight: number | null;
  ceilingHeightSource: 'DRAWING' | 'OPERATOR' | 'PROJECT_DEFAULT' | null;
  walls: Wall[];
  doors: Opening[];
  windows: Opening[];
  rooms: Room[];
  balconies: Room[];
  unknownElements: Unknown[];
  warnings: Warning[];
  extractionConfidence: number;
  stairs?: Stair[];
  texts?: PlanText[];
  ignored?: Ignored[];
  footprint?: Pt[] | null;
  northDeg?: number | null;
}

/** A printed dimension with the pixel span it measures. `text` is verbatim when the reader gave it. */
export interface DimString {
  valueM: number;
  from: Pt;
  to: Pt;
  confidence: number;
  evidence: string | null;
  text?: string | null;
}

// ── The review contract (copies of planToHome.ts) ──────────────────────────

export type OpeningChoice = 'DOOR' | 'WINDOW' | 'OPENING' | 'WALL';

export type PlanQuestion =
  | { id: string; kind: 'OPENING_TYPE'; elementId: string; options: OpeningChoice[]; suggested: OpeningChoice; confidence: number }
  | { id: string; kind: 'ROOM_TYPE'; elementId: string; suggested: string; confidence: number }
  | { id: string; kind: 'DIMENSION'; elementId: string; text: string; suggestedM: [number, number] | number; residualPct: number; confidence: number }
  | { id: string; kind: 'OUTDOOR'; elementId: string; suggested: boolean; confidence: number }
  | { id: string; kind: 'IS_WALL'; elementId: string; suggested: boolean; confidence: number }
  | { id: string; kind: 'STAIRS'; elementId: string; suggested: boolean; confidence: number };

export type PlanAnswer =
  | { questionId: string; kind: 'OPENING_TYPE'; value: OpeningChoice }
  | { questionId: string; kind: 'ROOM_TYPE'; value: string }
  | { questionId: string; kind: 'DIMENSION'; value: [number, number] | number }
  | { questionId: string; kind: 'OUTDOOR' | 'IS_WALL' | 'STAIRS'; value: boolean };

export interface DimensionCheck {
  elementId: string;
  text: string;
  valueM: number[];
  measuredM: number[];
  residualPct: number;
  ocrConfidence: number;
  geometryConfidence: number;
  used: boolean;
}

export interface ConstraintReport {
  metresPerPx: number;
  uncertainty: number;
  checks: DimensionCheck[];
  medianResidualPct: number;
  worstResidualPct: number;
}

export type TopologyIssueCode =
  | 'ROOM_OUTSIDE_FOOTPRINT' | 'ROOMS_OVERLAP' | 'UNCOVERED_AREA' | 'OPENING_OFF_WALL' | 'DUPLICATE_WALL'
  | 'DANGLING_WALL' | 'ROOM_NOT_CLOSED' | 'STAIRS_OUTSIDE' | 'NO_ENTRANCE' | 'ROOM_UNREACHABLE';

export interface TopologyIssue { code: TopologyIssueCode; elementIds: string[]; severity: 'INFO' | 'WARN' | 'BLOCK'; detail?: string }

export interface PlanUnderstanding {
  readVersion: string;
  constraints: ConstraintReport | null;
  issues: TopologyIssue[];
  questions: PlanQuestion[];
  adjacency: Record<string, string[]>;
  /** Who can walk to whom through the reconstructed walls (a validation signal; never shown to customers). */
  connectivity?: Connectivity;
}

/** One way between two rooms: a door (its id) or a stretch of shared boundary with no wall on it. */
export interface ConnectivityEdge { a: string; b: string; via: string }
export interface ConnectivitySignal {
  code: 'PRIVATE_ROOM_VIA_PRIVATE_ONLY' | 'HABITABLE_UNREACHABLE' | 'DOOR_CONNECTS_NOTHING';
  rooms: string[];
  detail: string;
}
export interface Connectivity { edges: ConnectivityEdge[]; reachable: string[]; signals: ConnectivitySignal[] }

/** A grayscale picture: one byte per pixel, row-major. */
export interface GrayImage { width: number; height: number; data: Uint8Array }
