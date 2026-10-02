// THE HYBRID ENGINE'S CONTRACT — what a Design Studio job is asked, and what it answers.
//
// One contract for every way a customer arrives at a space: a picture to
// rebuild, a floor plan to build and furnish, a brief in words, an existing
// design to change. AI reads, plans, compares and proposes corrections;
// deterministic code measures, places, validates and compiles the scene build
// spec; the Blender scene factory (a GPU worker) builds and renders the scene
// from that spec. Nothing here names a provider: a compute vendor or a
// renderer is an adapter behind this contract, never part of it.
//
// Pure and dependency-free: the browser, the edge function and the tests read
// the same code (byte-identical copy in supabase/functions/_shared/designStudio/hybrid).

export const ENGINE_VERSION = 'ds-factory-1';

export const JOB_MODES = ['RECONSTRUCT_FROM_IMAGE', 'DESIGN_FROM_FLOOR_PLAN', 'DESIGN_FROM_TEXT', 'REDESIGN_EXISTING_SCENE'] as const;
export type JobMode = typeof JOB_MODES[number];
/** The modes this build runs end to end; the others are accepted by the contract and refused as NOT_YET. */
export const LIVE_MODES: ReadonlySet<JobMode> = new Set<JobMode>(['RECONSTRUCT_FROM_IMAGE', 'DESIGN_FROM_FLOOR_PLAN']);

export type QualityTarget = 'DRAFT' | 'STANDARD' | 'HIGH';
export type DeviceTarget = 'DESKTOP' | 'MOBILE' | 'BOTH';
export type BudgetPreference = 'ECONOMY' | 'MID' | 'PREMIUM';

export interface JobInput {
  mode: JobMode;
  projectId: string;
  /** Reference pictures (ds_floorplans rows, purpose REFERENCE), in reading order. */
  sourceImageIds: string[];
  floorPlanId: string | null;
  textBrief: string | null;
  stylePreferences: string[];
  budgetPreference: BudgetPreference | null;
  /** Rebuild what is there (a reconstruction) rather than design something new. */
  preserveSource: boolean;
  qualityTarget: QualityTarget;
  deviceTarget: DeviceTarget;
  locale: string;
}

/**
 * The stages a customer sees, in order. Real backend states, never a fake
 * percentage: the screen shows which stage is running and how long it has
 * taken, nothing more precise than that.
 */
export const STAGES = [
  'UNDERSTANDING', // the source is read (picture or plan)
  'MEASURING', // geometry from the measured camera / the calibrated plan
  'PLANNING', // each object's route, and the scene build spec
  'ARCHITECTURE', // the factory builds floors, walls, openings, balcony
  'FURNISHING', // the factory builds and places every piece
  'MATERIALS', // catalogue materials onto the surfaces
  'LIGHTING', // daylight, interior light, the source camera
  'CHECKING', // rendered from the source camera and compared with it
  'PREPARING', // the walkthrough's models, optimised for every device
  'FINALIZING', // saved as a design version and opened
] as const;
export type Stage = typeof STAGES[number];
/** The customer-facing copy key for each stage (translations.ts). */
export const STAGE_COPY: Record<Stage, string> = {
  UNDERSTANDING: 'ds_gen_stage_understanding',
  MEASURING: 'ds_gen_stage_measuring',
  PLANNING: 'ds_gen_stage_planning',
  ARCHITECTURE: 'ds_gen_stage_architecture',
  FURNISHING: 'ds_gen_stage_furnishing',
  MATERIALS: 'ds_gen_stage_materials',
  LIGHTING: 'ds_gen_stage_lighting',
  CHECKING: 'ds_gen_stage_checking',
  PREPARING: 'ds_gen_stage_preparing',
  FINALIZING: 'ds_gen_stage_finalizing',
};

/** The factory's own progress (worker stage markers) → the stage the customer sees. */
export const FACTORY_STAGE: Record<string, Stage> = {
  ARCHITECTURE: 'ARCHITECTURE', FURNISHING: 'FURNISHING', MATERIALS: 'MATERIALS', LIGHTING: 'LIGHTING',
  RENDERING: 'CHECKING', EXPORTING: 'PREPARING', OPTIMIZING: 'PREPARING',
};

export interface StageTiming { stage: Stage; startedAt: string; endedAt: string | null; ms: number | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES = new Set(['ka', 'en', 'ru', 'ar', 'he', 'tr']);
const MAX_BRIEF = 2000;
const MAX_IMAGES = 6;

export type InputError =
  | 'MODE' | 'NOT_YET' | 'PROJECT' | 'IMAGES' | 'FLOOR_PLAN' | 'BRIEF' | 'QUALITY' | 'DEVICE' | 'LOCALE' | 'BUDGET' | 'STYLE';

/**
 * A job request, bounded. Anything malformed is an error, never silently
 * repaired into something the customer did not ask for.
 */
export function validateJobInput(raw: unknown): { ok: true; input: JobInput } | { ok: false; errors: InputError[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: InputError[] = [];
  const mode = (JOB_MODES as readonly string[]).includes(String(o.mode)) ? o.mode as JobMode : null;
  if (!mode) errors.push('MODE');
  else if (!LIVE_MODES.has(mode)) errors.push('NOT_YET');
  if (typeof o.projectId !== 'string' || !UUID.test(o.projectId)) errors.push('PROJECT');
  const images = Array.isArray(o.sourceImageIds) ? o.sourceImageIds : [];
  const imagesOk = images.length <= MAX_IMAGES && images.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(images).size === images.length;
  if (!imagesOk || (mode === 'RECONSTRUCT_FROM_IMAGE' && images.length === 0)) errors.push('IMAGES');
  const floorPlanId = o.floorPlanId == null ? null : typeof o.floorPlanId === 'string' && UUID.test(o.floorPlanId) ? o.floorPlanId : undefined;
  if (floorPlanId === undefined || (mode === 'DESIGN_FROM_FLOOR_PLAN' && !floorPlanId)) errors.push('FLOOR_PLAN');
  const brief = o.textBrief == null ? null : typeof o.textBrief === 'string' && o.textBrief.trim().length <= MAX_BRIEF ? o.textBrief.trim() : undefined;
  if (brief === undefined || (mode === 'DESIGN_FROM_TEXT' && !brief)) errors.push('BRIEF');
  const styles = Array.isArray(o.stylePreferences) ? o.stylePreferences : o.stylePreferences == null ? [] : null;
  if (!styles || styles.length > 8 || styles.some((s) => typeof s !== 'string' || s.length > 40)) errors.push('STYLE');
  const budget = o.budgetPreference == null ? null : ['ECONOMY', 'MID', 'PREMIUM'].includes(String(o.budgetPreference)) ? o.budgetPreference as BudgetPreference : undefined;
  if (budget === undefined) errors.push('BUDGET');
  const quality = ['DRAFT', 'STANDARD', 'HIGH'].includes(String(o.qualityTarget ?? 'HIGH')) ? (o.qualityTarget ?? 'HIGH') as QualityTarget : null;
  if (!quality) errors.push('QUALITY');
  const device = ['DESKTOP', 'MOBILE', 'BOTH'].includes(String(o.deviceTarget ?? 'BOTH')) ? (o.deviceTarget ?? 'BOTH') as DeviceTarget : null;
  if (!device) errors.push('DEVICE');
  const locale = typeof o.locale === 'string' && LOCALES.has(o.locale) ? o.locale : null;
  if (!locale) errors.push('LOCALE');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      mode: mode!, projectId: o.projectId as string, sourceImageIds: images as string[], floorPlanId: floorPlanId ?? null, textBrief: brief ?? null,
      stylePreferences: (styles as string[]).map((s) => s.trim()).filter(Boolean), budgetPreference: budget ?? null,
      preserveSource: mode === 'RECONSTRUCT_FROM_IMAGE' ? true : o.preserveSource === true, qualityTarget: quality!, deviceTarget: device!, locale: locale!,
    },
  };
}

/** How each object reached the scene. */
export type ObjectRoute = 'CATALOGUE' | 'PARAMETRIC' | 'FACTORY' | 'UNRESOLVED';

export interface JobOutput {
  engineVersion: string;
  mode: JobMode;
  /** The design version the scene was saved as (the canonical HOMATCH scene). */
  versionId: string | null;
  objectRoutes: Record<string, ObjectRoute>;
  /** Project-private factory outputs (renders, scene tiers, walkthrough pieces). */
  factoryAssetIds: string[];
  unresolved: string[];
  timings: StageTiming[];
  /** Cost lines (cost.ts), each MEASURED, ESTIMATED or NOT_AVAILABLE. */
  cost: Array<{ stage: Stage; kind: string; usd: number | null; basis: 'MEASURED' | 'ESTIMATED' | 'NOT_AVAILABLE'; detail: string }>;
  storage: { persistedBytes: number; temporaryBytesDeleted: number; objects: number };
}
