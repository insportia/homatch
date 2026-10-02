// FROM A REVIEWED PLAN TO A HOME YOU CAN WALK THROUGH — resumable, never paid twice.
//
//   architecture   the reviewed plan → HOMATCH's generator → a spatial source
//   original       the space's empty Original version
//   design         the customer's preferences → the AI designer's validated
//                  intent → HOMATCH's placement engine → an AI version
//   factory        that design → the Blender scene factory (Runpod) → the
//                  walkthrough's models, verified and stored → a version
//
// Every step first looks for its own result (recorded on the plan's review
// entry, and in the database itself) and reuses it. A reload, a closed tab or a
// lost connection therefore resumes where it was: the factory job is keyed by
// its spec's sha256 on the server, so asking again returns the same job and its
// outputs, never a second GPU run; the AI design is never re-requested once its
// version exists.

import type { FloorPlanDocument } from '@/services/developer/floorplan';
import { planToOperations } from '@/lib/designStudio/aiPlan';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import { copyState } from '@/lib/designStudio/versioning';
import { emptyDesignState, normalizeDesignState } from '@/lib/designStudio/designState';
import { buildCanonical, type Calibration, type ReviewDecisions } from '@/lib/designStudio/scale';
import { buildSpaceModel } from '@/lib/designStudio/space';
import type { CanonicalSpace } from '@/lib/designStudio/types';
import { compileSceneSpec } from '@/lib/designStudio/hybrid/compileSpec';
import { designChecks } from '@/lib/designStudio/hybrid/designChecks';
import { runDesignBuild } from '@/lib/designStudio/hybrid/designBuild';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import { FURNISHING_CAP, type DesignPreferences, type FlowTimings, type PlanAnswer } from '@/lib/designStudio/planToHome';
import { planCamera } from '@/components/designStudio/workspace/FactoryBuildDialog';
import { assetsByCode, listAssets, listMaterials } from './catalog';
import { designFromPreferences } from './ai';
import { factoryStatus, startFactory, visualQa } from './factory';
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
  factory?: 'USED' | 'UNAVAILABLE' | 'FAILED' | null;
  timings?: FlowTimings;
  startedAt?: string | null;
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
  versionName: (key: 'original' | 'design' | 'factory') => string;
  onStage: (stage: Stage, status: 'RUNNING' | 'DONE' | 'SKIPPED') => void;
  /** The factory pass may take minutes; it is polled until this. */
  passTimeoutMs?: number;
}

export interface GenerateResult {
  versionId: string;
  factory: 'USED' | 'UNAVAILABLE' | 'FAILED';
  renderKey: string | null;
  timings: FlowTimings;
}

const now = () => Date.now();

export async function generateHome(input: GenerateInput): Promise<GenerateResult> {
  const timings: FlowTimings = { ...(latestFlow(input.plan)?.timings ?? {}) };
  let flow = latestFlow(input.plan) ?? { step: 'GENERATING', answers: [], preferences: input.preferences };
  const save = async (patch: Partial<FlowRecord>) => {
    const next = await saveFlow(input.plan.id, { ...patch, timings });
    flow = latestFlow(next) ?? flow;
  };
  await save({ step: 'GENERATING', preferences: input.preferences, startedAt: flow.startedAt ?? new Date().toISOString() });

  // ── 1. Architecture: the reviewed plan, built once ──────────────────────
  input.onStage('MEASURING', 'RUNNING');
  let sourceId = flow.sourceId ?? null;
  if (sourceId && !(await getSourceFull(sourceId))) sourceId = null;
  if (!sourceId) {
    const built = buildCanonical(input.doc, input.decisions, input.calibration, input.ceilingM, input.ceilingSource);
    if (!built.ok) throw new DesignStudioError('DS_PLAN_NOT_BUILDABLE', built.problems.join(','));
    sourceId = await createFloorPlanSource({
      floorplanId: input.plan.id, canonical: built.canonical, geometryState: input.calibration.geometryState, anchors: input.anchors,
    });
    await save({ sourceId });
  }
  await setActiveSource(input.projectId, sourceId);
  const source = await getSourceFull(sourceId);
  const canonical = (source?.canonical as CanonicalSpace | null) ?? null;
  if (!source || !canonical?.scene) throw new DesignStudioError('DS_SOURCE_MISSING');
  const space = buildSpaceModel(canonical.scene);
  input.onStage('MEASURING', 'DONE');

  // ── 2. The Original (empty) version on this space ───────────────────────
  let originalId = flow.originalVersionId ?? null;
  if (!originalId) {
    const bundle = await getProject(input.projectId);
    const existing = bundle?.versions.find((v) => v.source_id === sourceId && !v.archived_at && v.origin === 'ORIGINAL');
    originalId = existing?.id ?? (await createOriginalVersion({
      userId: input.userId, projectId: input.projectId, sourceId, name: input.versionName('original'),
    })).id;
    await save({ originalVersionId: originalId });
  }

  // ── 3. The design: AI intent, placed by HOMATCH ─────────────────────────
  input.onStage('PLANNING', 'RUNNING');
  let designId = flow.designVersionId ?? null;
  const [browse, materials] = await Promise.all([listAssets({ limit: 500 }), listMaterials()]);
  const assets = new Map<string, CatalogAsset>(browse.map((a) => [a.code, a]));
  const materialMap = new Map<string, CatalogMaterial>(materials.map((m) => [m.id, m]));
  if (!designId) {
    const t0 = now();
    const { jobId, plan } = await designFromPreferences({ versionId: originalId, preferences: input.preferences });
    const alt = plan.alternatives[0];
    if (!alt) throw new DesignStudioError('DS_AI_FAILED');
    // The level the customer chose is a ceiling the AI's list is cut to, never padded past.
    const cap = FURNISHING_CAP[input.preferences.furnishing];
    const capped = { ...alt, rooms: alt.rooms.map((r) => ({ ...r, furniture: r.furniture.slice(0, Math.max(cap, 0)) })) };
    const wanted = [...new Set(capped.rooms.flatMap((r) => r.furniture))].filter((c) => !assets.has(c));
    if (wanted.length) for (const a of await assetsByCode(wanted)) assets.set(a.code, a);
    const original = await getVersion(originalId);
    const basis = normalizeDesignState(original?.state ?? emptyDesignState());
    const proposal = planToOperations(capped, {
      state: basis, space, ctx: { space, assets, materials: materialMap }, assets, materials, idPrefix: `p2h-${jobId.slice(0, 8)}`, furnishing: input.preferences.furnishing,
    });
    const created = await createVersion({
      userId: input.userId, projectId: input.projectId, sourceId, parentId: originalId, origin: 'AI', jobId,
      name: input.versionName('design'), state: copyState(proposal.state) as unknown as Record<string, unknown>,
      styleTags: input.preferences.style ? [input.preferences.style] : [],
      changeSummary: [{ kind: 'PLAN_TO_HOME_DESIGN', preferences: input.preferences, summary: proposal.summary, skipped: proposal.skipped.length }],
    });
    designId = created.id;
    timings.designIntentMs = now() - t0;
    await save({ designVersionId: designId });
  }
  input.onStage('PLANNING', 'DONE');

  // ── 4. The factory: the same design is the same job ─────────────────────
  if (flow.factoryVersionId) {
    for (const s of ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'CHECKING', 'PREPARING', 'FINALIZING'] as Stage[]) input.onStage(s, 'DONE');
    await save({ step: 'DONE' });
    return { versionId: flow.factoryVersionId, factory: 'USED', renderKey: null, timings };
  }
  const design = await getVersion(designId);
  const state = normalizeDesignState(design?.state ?? emptyDesignState());
  for (const o of state.objects) if (!assets.has(o.assetId)) for (const a of await assetsByCode([o.assetId])) assets.set(a.code, a);
  const checks = designChecks(space, state, assets, canonical);
  const t1 = now();
  const result = await runDesignBuild({ state: copyState(state), checks: checks.dimensions, passTimeoutMs: input.passTimeoutMs ?? 20 * 60_000 }, {
    startFactory: (spec, pass) => startFactory({ projectId: input.projectId, versionId: designId, pass, spec }),
    factoryStatus,
    compile: (s, outputs) => compileSceneSpec({
      space, state: s, assets, materials: materialMap, camera: planCamera(space),
      source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, render: { edge: 1600, samples: 96 }, outputs,
    }),
    planQa: async (renderAssetId) => visualQa({
      floorplanId: input.plan.id, renderAssetId, objects: [], rooms: space.rooms.map((r) => ({ key: r.id, kind: r.kind })),
    }).catch(() => null),
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    now,
    onStage: input.onStage,
  });
  if (result.jobId) await save({ factoryJobId: result.jobId });
  const ft = result.timings;
  timings.factoryExecMs = now() - t1;
  timings.optimizeMs = ft.find((x) => x.stage === 'PREPARING')?.ms ?? undefined;

  if (result.factory !== 'USED') {
    // The design still opens in HOMATCH's own walkthrough; the factory's absence is reported, not hidden.
    for (const s of ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'CHECKING', 'PREPARING'] as Stage[]) input.onStage(s, 'SKIPPED');
    await save({ step: 'DONE', factory: result.factory });
    return { versionId: designId, factory: result.factory, renderKey: null, timings };
  }

  input.onStage('FINALIZING', 'RUNNING');
  const t2 = now();
  const created = await createVersion({
    userId: input.userId, projectId: input.projectId, sourceId, parentId: designId, origin: 'BRANCH',
    name: input.versionName('factory'), state: copyState(result.state) as unknown as Record<string, unknown>,
    changeSummary: [{
      kind: 'FACTORY_BUILD', jobId: result.jobId, verdict: result.verdict, persistedBytes: result.persistedBytes,
      dimensions: result.dimensions.map((d) => ({ name: d.name, gate: d.gate, value: d.value })), cost: result.cost,
      timings: result.timings, provenance: { architecture: 'SOURCE_DERIVED', furnishing: 'DESIGN_CHOICE' },
    }],
  });
  timings.persistMs = now() - t2;
  input.onStage('FINALIZING', 'DONE');
  await save({ step: 'DONE', factory: 'USED', factoryVersionId: created.id });
  return { versionId: created.id, factory: 'USED', renderKey: result.render?.key ?? null, timings };
}
