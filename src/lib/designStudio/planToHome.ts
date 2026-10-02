// FROM A FLOOR PLAN TO A HOME — the contract the customer's path is built on.
//
//   upload → HOMATCH understands (reading, ds-read-2) → the customer confirms
//   (only the questions worth asking) → chooses a look (DesignPreferences) →
//   Generate (DesignIntent from the AI designer, placed by HOMATCH's engine;
//   the Blender factory builds it) → the walkthrough.
//
// Each stage depends only on the one before it, and is cached by what it
// depends on: changing the look never re-reads the plan, and changing one
// finish never rebuilds the architecture.
//
//   reading       ← the image's sha256                       (ds_floorplans.interpretation)
//   review        ← reading + the customer's answers         (ds_floorplans.corrections)
//   architecture  ← review                                   (ds_spatial_sources.canonical)
//   design        ← architecture + DesignPreferences         (a design version)
//   factory       ← design (spec sha256)                     (ds_factory_jobs, idempotent)
//
// Pure types and small pure helpers; no I/O.

import { STYLE_CODES, type StyleCode } from './grammar.ts';

export type { StyleCode };

export const MOODS = ['WARM', 'BRIGHT', 'CALM', 'DRAMATIC', 'NATURAL', 'ELEGANT', 'COZY'] as const;
export type Mood = typeof MOODS[number];

export const FLOOR_DIRECTIONS = ['LIGHT_WOOD', 'DARK_WOOD', 'STONE', 'MARBLE', 'CONCRETE', 'TILE'] as const;
export type FloorDirection = typeof FLOOR_DIRECTIONS[number];

export const WALL_DIRECTIONS = ['WARM_WHITE', 'COOL_WHITE', 'GREIGE', 'PLASTER', 'DEEP'] as const;
export type WallDirection = typeof WALL_DIRECTIONS[number];

export const ACCENTS = ['BLACK_METAL', 'BRASS', 'CHROME', 'NATURAL_WOOD'] as const;
export type Accent = typeof ACCENTS[number];

export const PALETTES = ['WARM', 'NEUTRAL', 'COOL'] as const;
export type Palette = typeof PALETTES[number];

export const FURNISHING_LEVELS = ['UNFURNISHED', 'ESSENTIAL', 'FULL', 'STAGED'] as const;
export type FurnishingLevel = typeof FURNISHING_LEVELS[number];

/** What the customer chose. `style: null` with a brief is "describe your own". */
export interface DesignPreferences {
  style: StyleCode | null;
  mood: Mood;
  floor: FloorDirection;
  walls: WallDirection;
  accent: Accent;
  palette: Palette;
  furnishing: FurnishingLevel;
  /** Free text, at most 600 characters ("warm modern, light oak, no marble"). */
  brief: string;
}

export const DEFAULT_PREFERENCES: DesignPreferences = {
  style: 'contemporary', mood: 'WARM', floor: 'LIGHT_WOOD', walls: 'WARM_WHITE', accent: 'BLACK_METAL',
  palette: 'WARM', furnishing: 'FULL', brief: '',
};

/** How many pieces a room may receive at each level (the AI's list is cut to this, never padded). */
export const FURNISHING_CAP: Record<FurnishingLevel, number> = { UNFURNISHED: 0, ESSENTIAL: 3, FULL: 8, STAGED: 10 };

/** Bounded and type-exact, or the default for each bad field. */
export function normalizePreferences(raw: unknown): DesignPreferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, set: readonly T[], d: T): T => (set.includes(v as T) ? v as T : d);
  return {
    style: r.style === null ? null : pick(r.style, STYLE_CODES, DEFAULT_PREFERENCES.style as StyleCode),
    mood: pick(r.mood, MOODS, DEFAULT_PREFERENCES.mood),
    floor: pick(r.floor, FLOOR_DIRECTIONS, DEFAULT_PREFERENCES.floor),
    walls: pick(r.walls, WALL_DIRECTIONS, DEFAULT_PREFERENCES.walls),
    accent: pick(r.accent, ACCENTS, DEFAULT_PREFERENCES.accent),
    palette: pick(r.palette, PALETTES, DEFAULT_PREFERENCES.palette),
    furnishing: pick(r.furnishing, FURNISHING_LEVELS, DEFAULT_PREFERENCES.furnishing),
    brief: typeof r.brief === 'string' ? r.brief.replace(/[\u0000-\u001f]/g, ' ').slice(0, 600) : '',
  };
}

// ── The review: only the questions worth asking ────────────────────────────

/**
 * A question HOMATCH asks only when its evidence is weak. Each has a small,
 * closed set of answers a non-architect can give by tapping.
 */
export type PlanQuestion =
  | { id: string; kind: 'OPENING_TYPE'; elementId: string; options: Array<'DOOR' | 'WINDOW' | 'OPENING' | 'WALL'>; suggested: 'DOOR' | 'WINDOW' | 'OPENING' | 'WALL'; confidence: number }
  | { id: string; kind: 'ROOM_TYPE'; elementId: string; suggested: string; confidence: number }
  | { id: string; kind: 'DIMENSION'; elementId: string; text: string; suggestedM: [number, number] | number; residualPct: number; confidence: number }
  | { id: string; kind: 'OUTDOOR'; elementId: string; suggested: boolean; confidence: number }
  | { id: string; kind: 'IS_WALL'; elementId: string; suggested: boolean; confidence: number }
  | { id: string; kind: 'STAIRS'; elementId: string; suggested: boolean; confidence: number };

export type PlanAnswer =
  | { questionId: string; kind: 'OPENING_TYPE'; value: 'DOOR' | 'WINDOW' | 'OPENING' | 'WALL' }
  | { questionId: string; kind: 'ROOM_TYPE'; value: string }
  | { questionId: string; kind: 'DIMENSION'; value: [number, number] | number }
  | { questionId: string; kind: 'OUTDOOR' | 'IS_WALL' | 'STAIRS'; value: boolean };

/** A printed measurement, read and checked against the drawing's geometry. */
export interface DimensionCheck {
  /** The element it measures (a room id, or 'OVERALL_W' / 'OVERALL_D'). */
  elementId: string;
  text: string;
  /** Normalised metric value(s). A room's are [a, b] as printed. */
  valueM: number[];
  /** What the geometry measures at the solved scale, matched to the printed order. */
  measuredM: number[];
  /** |measured − printed| / printed, worst axis. */
  residualPct: number;
  ocrConfidence: number;
  geometryConfidence: number;
  /** Used by the scale solve (an outlier is reported and left out). */
  used: boolean;
}

export interface ConstraintReport {
  metresPerPx: number;
  /** Relative uncertainty of the solved scale. */
  uncertainty: number;
  checks: DimensionCheck[];
  /** Median |residual| over the checks used. */
  medianResidualPct: number;
  worstResidualPct: number;
}

export type TopologyIssueCode =
  | 'ROOM_OUTSIDE_FOOTPRINT' | 'ROOMS_OVERLAP' | 'UNCOVERED_AREA' | 'OPENING_OFF_WALL' | 'DUPLICATE_WALL'
  | 'DANGLING_WALL' | 'ROOM_NOT_CLOSED' | 'STAIRS_OUTSIDE' | 'NO_ENTRANCE' | 'ROOM_UNREACHABLE';

export interface TopologyIssue { code: TopologyIssueCode; elementIds: string[]; severity: 'INFO' | 'WARN' | 'BLOCK'; detail?: string }

/** Everything the review shows, computed deterministically from the reading. */
export interface PlanUnderstanding {
  readVersion: string;
  constraints: ConstraintReport | null;
  issues: TopologyIssue[];
  questions: PlanQuestion[];
  /** Room adjacency through doors/openings (room id → room ids). */
  adjacency: Record<string, string[]>;
}

// ── Where the customer is, so a reload never loses it ──────────────────────

export type FlowStep = 'UPLOAD' | 'READING' | 'REVIEW' | 'DESIGN' | 'GENERATING' | 'DONE';

/** Milliseconds of each stage the customer waits for (instrumentation; never shown as fake progress). */
export interface FlowTimings {
  uploadMs?: number;
  analysisMs?: number;
  reviewReadyMs?: number;
  designIntentMs?: number;
  factoryQueueMs?: number;
  factoryExecMs?: number;
  blenderMs?: number;
  optimizeMs?: number;
  persistMs?: number;
  firstWalkthroughMs?: number;
  firstInteractiveMs?: number;
}
