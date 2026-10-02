// FROM A REVIEWED PLAN TO THE CUSTOMER'S DESIGNED HOME — OpenAI is the designer;
// resumable, never paid twice.
//
//   architecture   the reviewed plan → HOMATCH's generator → a spatial source
//                  and its empty Original (the evidence, and the future 3D's input)
//   design         OpenAI reads the customer's own source picture with HOMATCH's
//                  structured evidence and writes the Design Specification →
//                  an AI version behind it (its DNA from the spec)
//   master         ONE OpenAI picture from the customer's own source, then what is
//                  in it and its edit map → the photorealistic Result
//
// No Blender, no RunPod, no GLB and no 3D asset library on this path: Blender is
// downstream, for the 3D walkthrough only (PR2).
//
// Every step first looks for its own result (recorded on the plan's review
// entry, and in the database itself) and reuses it. A reload, a closed tab or a
// lost connection therefore resumes where it was: the specification and the
// render are keyed, so asking again returns the same job and the same picture;
// only an explicit retry of a failed picture asks for a new one.

import type { FloorPlanDocument } from '@/services/developer/floorplan';
import { copyState } from '@/lib/designStudio/versioning';
import { emptyDesignState, normalizeDesignState } from '@/lib/designStudio/designState';
import { buildCanonical, type Calibration, type ReviewDecisions } from '@/lib/designStudio/scale';
import { buildSpaceModel } from '@/lib/designStudio/space';
import type { CanonicalSpace } from '@/lib/designStudio/types';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import type { DesignPreferences, FlowTimings, PlanAnswer } from '@/lib/designStudio/planToHome';
import { quoteRender, saveDesignDna } from './renders';
import { generateRender, generationStep, requestDesignSpec, stepGenerated } from './generation';
import { stableJson } from '@/lib/designStudio/stableJson';
import type { RenderRecord } from '@/lib/designStudio/renders/contract';
import { createFloorPlanSource, getFloorPlan, type FloorPlanRecord } from './floorplans';
import {
  createOriginalVersion, createVersion, DesignStudioError, getProject, getSourceFull, getVersion, setActiveSource,
} from './projects';
import type { Anchor } from '@/lib/designStudio/scale';
import { supabase } from '@/db/supabase';

/** Where the customer is in the flow, kept on the plan's latest review entry. */
export interface FlowRecord {
  step: 'REVIEW' | 'DESIGN' | 'GENERATING' | 'DONE';
  answers: PlanAnswer[];
  preferences: DesignPreferences | null;
  sourceId?: string | null;
  originalVersionId?: string | null;
  designVersionId?: string | null;
  factoryVersionId?: string | null;
  factoryJobId?: string | null;
  /** The review the architecture was built from (a changed review builds it again). */
  reviewKey?: string | null;
  masterRenderId?: string | null;
  /** The credits the customer confirmed for the master design (a different quote stops and asks). */
  confirmedCredits?: number | null;
  factory?: 'USED' | 'UNAVAILABLE' | 'FAILED' | null;
  /** Who made the design: OpenAI from the customer's own source (no factory on this path). */
  generator?: 'OPENAI_FIRST' | null;
  /** OpenAI's Design Specification (an AI_DESIGN job): the design's lineage. */
  specJobId?: string | null;
  /** The master picture's attempt: only an explicit retry of a failed picture moves it on. */
  masterAttempt?: number | null;
  timings?: FlowTimings;
  startedAt?: string | null;
  /** How the reading was confirmed: on its own, by quick questions, or in the detailed review. */
  review?: 'AUTO' | 'QUICK' | 'DETAIL' | null;
  /** Which part of "how should it feel" the customer is on. */
  lookStep?: 'STYLE' | 'QUALITY' | 'CUSTOM' | null;
  /** The two simple choices (lookPresets.ts); `preferences` is what they produced, or the customer's own details. */
  look?: { style: string; quality: string } | null;
}

export type ReviewEntry = FloorPlanRecord['corrections'][number] & { flow?: FlowRecord };

export function latestFlow(plan: FloorPlanRecord | null): FlowRecord | null {
  const last = plan?.corrections?.[plan.corrections.length - 1] as ReviewEntry | undefined;
  return last?.flow ?? null;
}

/**
 * Merge into the latest review entry (or start one). The history of entries
 * stays append-only for review changes; the flow pointer on the latest entry
 * is what a reload resumes from.
 */
export async function saveFlow(planId: string, patch: Partial<FlowRecord> & { decisions?: ReviewDecisions; anchors?: Anchor[]; ceilingM?: number | null }): Promise<FloorPlanRecord> {
  const plan = await getFloorPlan(planId);
  if (!plan) throw new DesignStudioError('DS_PLAN_MISSING');
  const list = [...(plan.corrections ?? [])] as ReviewEntry[];
  const last = list[list.length - 1];
  const base: ReviewEntry = last ?? { at: new Date().toISOString(), decisions: { rejected: [], roomKinds: {} }, anchors: [], ceilingM: null };
  const { decisions, anchors, ceilingM, ...flowPatch } = patch;
  const flow: FlowRecord = { step: 'REVIEW', answers: [], preferences: null, ...(base.flow ?? {}), ...flowPatch };
  const next: ReviewEntry = {
    ...base,
    at: new Date().toISOString(),
    ...(decisions ? { decisions } : {}),
    ...(anchors ? { anchors } : {}),
    ...(ceilingM !== undefined ? { ceilingM } : {}),
    flow,
  };
  if (last) list[list.length - 1] = next; else list.push(next);
  const corrections = list.slice(-50);
  const { error } = await supabase.from('ds_floorplans').update({ corrections }).eq('id', planId);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return { ...plan, corrections } as FloorPlanRecord;
}

export interface GenerateInput {
  userId: string;
  projectId: string;
  projectName: string;
  plan: FloorPlanRecord;
  /** The reading with the customer's answers applied (ids stable). */
  doc: FloorPlanDocument;
  decisions: ReviewDecisions;
  anchors: Anchor[];
  calibration: Calibration;
  ceilingM: number;
  ceilingSource: 'CUSTOMER' | 'DRAWING' | 'TYPICAL';
  preferences: DesignPreferences;
  /** The customer's two choices (Style × Quality), when they made them: creative direction for OpenAI. */
  look?: { style: string; quality: string } | null;
  /** What the customer confirmed for the master design (from the Look step's quote). */
  confirmedCredits: number | null;
  versionName: (key: 'original' | 'design' | 'factory') => string;
  onStage: (stage: Stage, status: 'RUNNING' | 'DONE' | 'SKIPPED') => void;
  /** The customer pressed Retry on a failed picture: a new picture may be made. A reload never is a retry. */
  retry?: boolean;
  /** The master is followed until this. */
  passTimeoutMs?: number;
  pollMs?: number;
}

export interface GenerateResult {
  versionId: string;
  factory: 'USED' | 'UNAVAILABLE' | 'FAILED' | 'NOT_USED';
  renderKey: string | null;
  timings: FlowTimings;
}

export type ArchitectureInput = Pick<GenerateInput, 'userId' | 'projectId' | 'plan' | 'doc' | 'decisions' | 'anchors' | 'calibration' | 'ceilingM' | 'ceilingSource' | 'versionName'> & { answers?: PlanAnswer[] };

/**
 * The building itself, as a key: the sha-256 of the canonical scene HOMATCH would build from this review.
 * Two reviews that build the same building are the same architecture (nothing is rebuilt); any change
 * that moves a wall, a door or the scale is a different one.
 */
export async function architectureKey(canonical: CanonicalSpace): Promise<string> {
  const text = stableJson({ scene: canonical.scene, metresPerPx: Math.round((canonical.metresPerPx ?? 0) * 1e9), state: canonical.geometryState });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The reviewed plan as a spatial source and its empty Original version —
 * built once per review (a changed review builds a new source; the earlier
 * one is superseded, never edited). Called when the customer confirms the
 * review, and again (as a no-op) by generateHome.
 */
export async function prepareArchitecture(input: ArchitectureInput): Promise<{ sourceId: string; originalId: string; canonical: CanonicalSpace; space: ReturnType<typeof buildSpaceModel> }> {
  const plan = (await getFloorPlan(input.plan.id)) ?? input.plan;
  const flow = latestFlow(plan);
  const built = buildCanonical(input.doc, input.decisions, input.calibration, input.ceilingM, input.ceilingSource);
  if (!built.ok) throw new DesignStudioError('DS_PLAN_NOT_BUILDABLE', built.problems.join(','));
  const key = await architectureKey(built.canonical);
  let sourceId = flow?.reviewKey === key ? flow?.sourceId ?? null : null;
  if (sourceId && !(await getSourceFull(sourceId))) sourceId = null;
  let originalId = sourceId ? flow?.originalVersionId ?? null : null;
  if (!sourceId) {
    sourceId = await createFloorPlanSource({
      floorplanId: input.plan.id, canonical: built.canonical, geometryState: input.calibration.geometryState, anchors: input.anchors,
    });
    // A new building: everything designed on the previous one is no longer this flow's.
    await saveFlow(input.plan.id, { sourceId, reviewKey: key, originalVersionId: null, designVersionId: null, factoryVersionId: null, factoryJobId: null, masterRenderId: null, specJobId: null, masterAttempt: null });
  }
  await setActiveSource(input.projectId, sourceId);
  const source = await getSourceFull(sourceId);
  const canonical = (source?.canonical as CanonicalSpace | null) ?? null;
  if (!source || !canonical?.scene) throw new DesignStudioError('DS_SOURCE_MISSING');
  if (!originalId) {
    const bundle = await getProject(input.projectId);
    const existing = bundle?.versions.find((v) => v.source_id === sourceId && !v.archived_at && v.origin === 'ORIGINAL');
    originalId = existing?.id ?? (await createOriginalVersion({
      userId: input.userId, projectId: input.projectId, sourceId, name: input.versionName('original'),
    })).id;
    await saveFlow(input.plan.id, { originalVersionId: originalId });
  }
  return { sourceId, originalId, canonical, space: buildSpaceModel(canonical.scene) };
}

const now = () => Date.now();
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function generateHome(input: GenerateInput): Promise<GenerateResult> {
  const timings: FlowTimings = { ...(latestFlow(input.plan)?.timings ?? {}) };
  let flow = latestFlow(input.plan) ?? { step: 'GENERATING', answers: [], preferences: input.preferences };
  const save = async (patch: Partial<FlowRecord>) => {
    const next = await saveFlow(input.plan.id, { ...patch, timings });
    flow = latestFlow(next) ?? flow;
  };
  await save({ step: 'GENERATING', preferences: input.preferences, generator: 'OPENAI_FIRST', startedAt: flow.startedAt ?? new Date().toISOString() });

  // ── 1. The architecture (normally done when the reading was confirmed): the evidence, and the future 3D's input ──
  input.onStage('MEASURING', 'RUNNING');
  const arch = await prepareArchitecture(input);
  flow = latestFlow(await getFloorPlan(input.plan.id)) ?? flow;
  input.onStage('MEASURING', 'DONE');

  // ── 2. OpenAI's Design Specification of THIS property, and the design version it stands behind ──
  input.onStage('PLANNING', 'RUNNING');
  let designId = flow.designVersionId ?? null;
  if (!designId) {
    const t0 = now();
    const directionKey = (await sha256(stableJson({ look: input.look ?? null, preferences: input.preferences }))).slice(0, 16);
    const { spec, error } = await requestDesignSpec({
      projectId: input.projectId, versionId: arch.originalId, mode: 'MASTER', idempotencyKey: `p2h-spec-${arch.originalId}-${directionKey}`,
      look: input.look ?? null, preferences: input.preferences,
    });
    if (!spec) throw new DesignStudioError(error === 'RATE_LIMITED' ? 'DS_RATE_LIMITED' : 'DS_AI_FAILED', error ?? undefined);
    const original = await getVersion(arch.originalId);
    const created = await createVersion({
      userId: input.userId, projectId: input.projectId, sourceId: arch.sourceId, parentId: arch.originalId, origin: 'AI', jobId: spec.jobId,
      name: input.versionName('design'), state: copyState(normalizeDesignState(original?.state ?? emptyDesignState())) as unknown as Record<string, unknown>,
      styleTags: input.preferences.style ? [input.preferences.style] : [],
      changeSummary: [{ kind: 'AI_DESIGN_SPEC', generator: 'OPENAI_FIRST', jobId: spec.jobId, look: input.look ?? null, preferences: input.preferences, conflicts: spec.summary.conflicts }],
    });
    designId = created.id;
    timings.designIntentMs = now() - t0;
    await saveDesignDna(designId, spec.dna);
    await save({ designVersionId: designId, specJobId: spec.jobId });
  }
  input.onStage('PLANNING', 'DONE');

  // ── 3. The photorealistic master: ONE OpenAI picture from the customer's own source ──
  input.onStage('ARCHITECTURE', 'DONE');
  let renderId = flow.masterRenderId ?? null;
  let attempt = flow.masterAttempt ?? 0;
  if (renderId) {
    const known = (await stepGenerated([renderId]))?.[0] ?? null;
    if (known?.status === 'FAILED' || known?.status === 'CANCELLED') {
      if (!input.retry) throw new DesignStudioError('DS_RENDER_FAILED', known.error ?? undefined);
      renderId = null; attempt += 1; // an explicit retry is a new picture; a reload never is
    }
  }
  if (!renderId) {
    if (!flow.specJobId) throw new DesignStudioError('DS_AI_FAILED', 'SPEC_MISSING');
    const quoted = await quoteRender({ projectId: input.projectId, versionId: designId, product: 'DS_MASTER_RENDER', views: 1 });
    if (!quoted.quote) throw new DesignStudioError('DS_RENDER_FAILED', quoted.error ?? undefined);
    if (input.confirmedCredits != null && quoted.quote.credits !== input.confirmedCredits) throw new DesignStudioError('DS_PRICE_CHANGED');
    const started = await generateRender({
      quote: quoted.quote, projectId: input.projectId, versionId: designId, specJobId: flow.specJobId, mode: 'MASTER', idempotencyKey: `p2h-ai-master-${designId}-${attempt}`,
    });
    if (!started.render) throw new DesignStudioError('DS_RENDER_FAILED', started.error ?? undefined);
    renderId = started.render.id;
    await save({ masterRenderId: renderId, masterAttempt: attempt });
  }

  // ── 4. Followed (and moved on) until it is ready: image → what is in it → its edit map ──
  const t1 = now();
  const deadline = t1 + (input.passTimeoutMs ?? 15 * 60_000);
  const show = (step: ReturnType<typeof generationStep>) => {
    const running = (s: Stage) => input.onStage(s, 'RUNNING');
    const done = (s: Stage) => input.onStage(s, 'DONE');
    if (step === 'QUEUED' || step === 'IMAGE') { running('FURNISHING'); running('MATERIALS'); running('LIGHTING'); return; }
    done('FURNISHING'); done('MATERIALS'); done('LIGHTING');
    if (step === 'SCENE') { running('CHECKING'); return; }
    done('CHECKING');
    if (step === 'MAP') { running('PREPARING'); return; }
    done('PREPARING');
  };
  let last: RenderRecord | null = null;
  while (now() < deadline) {
    const rows = await stepGenerated([renderId]);
    last = rows?.[0] ?? last;
    const step = generationStep(last);
    show(step);
    if (step === 'READY') break;
    if (step === 'FAILED') throw new DesignStudioError('DS_RENDER_FAILED', last?.error ?? undefined);
    await new Promise((ok) => setTimeout(ok, input.pollMs ?? 2500));
  }
  if (generationStep(last) !== 'READY') throw new DesignStudioError('DS_RENDER_FAILED', 'TIMEOUT');
  timings.factoryExecMs = now() - t1;
  input.onStage('FINALIZING', 'DONE');
  await save({ step: 'DONE', factory: null });
  return { versionId: designId, factory: 'NOT_USED', renderKey: last?.final_key ?? null, timings };
}
