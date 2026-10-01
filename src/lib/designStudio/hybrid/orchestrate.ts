// THE HYBRID ENGINE, ONE JOB — RECONSTRUCT_FROM_IMAGE.
//
//   reading (already done) → each object's route (catalogue / parametric /
//   generated / approximate) → the GPU builds only the generated ones → the
//   scene is assembled → rendered from the picture's own camera → the visual
//   check names what differs → safe corrections to the reading → rebuilt →
//   (a second check only when the first one justified it) → fidelity report.
//
// Everything with a side effect is injected (EngineDeps), so the order, the
// bounds and the budget are tested without a GPU, a browser or a model.
// Deterministic work (routing, crops, assembly, corrections) never calls AI:
// the only AI here is the visual check, at most QA_LIMITS.maxPasses times.

import type { DesignState, GeneratedRef } from '../designState.ts';
import type { CatalogAsset } from '../catalog.ts';
import type { Reconstruction } from '../reconstructRead.ts';
import { projectPlan, unprojectFloor, type CameraFit } from '../sourceCamera.ts';
import type { BuildReport } from '../reconstruction.ts';
import { STAGES, type Stage, type StageTiming, type QualityTarget } from './contract.ts';
import { JOB_CEILING_USD, totals, withinCeiling, type CostLine } from './cost.ts';
import { fidelityReport, type FidelityReport } from './fidelity.ts';
import { anotherPass, applyQaCorrections, QA_LIMITS, type Applied, type QaReport, type Unproject } from './qa.ts';
import { DEFAULT_RESOLUTION, generationRequests, resolveObjects, type ObjectDecision } from './resolution.ts';

export interface GeneratedAssetRow { id: string; source_ref: string; object_key: string; sha256: string | null; bytes: number | null; state: string }
export interface GenerationPoll {
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNAVAILABLE';
  assets?: GeneratedAssetRow[];
  timings?: Record<string, unknown>;
  cost?: Array<{ usd: number | null; basis: string; detail: string }>;
  result?: Record<string, unknown>;
  error?: string | null;
}

export interface EngineDeps {
  startGeneration(keys: string[]): Promise<{ jobId: string | null; state: GenerationPoll['state']; error: string | null }>;
  generationStatus(jobId: string): Promise<GenerationPoll>;
  /** Build the design from a reading (deterministic; the space is fixed). */
  assemble(recon: Reconstruction): { state: DesignState; report: BuildReport };
  /** The scene from the picture's camera, as a JPEG data URL; null when it cannot be drawn. */
  render(state: DesignState): Promise<string | null>;
  visualQa(render: string, recon: Reconstruction): Promise<{ report: QaReport; cost: { usd: number | null; basis: string } } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onStage?(stage: Stage, status: 'RUNNING' | 'DONE' | 'SKIPPED'): void;
}

export interface EngineInput {
  recon: Reconstruction;
  assets: CatalogAsset[];
  /** Pieces the customer confirmed in review: the check never moves them. */
  confirmed: ReadonlySet<string>;
  unproject: Unproject | null;
  roomsBuilt: number;
  quality?: QualityTarget;
  pollMs?: number;
  /** How long the GPU may take before the job continues without it. */
  gpuTimeoutMs?: number;
  /** What one visual check is expected to cost (ESTIMATED), for the ceiling. */
  qaUsd?: number;
}

export interface EngineResult {
  state: DesignState;
  build: BuildReport;
  recon: Reconstruction;
  decisions: ObjectDecision[];
  generated: Map<string, GeneratedRef>;
  gpu: { jobId: string | null; state: GenerationPoll['state'] | 'NOT_NEEDED'; error: string | null; persistedBytes: number; worker: Record<string, unknown> | null };
  qa: QaReport | null;
  qaCalls: number;
  correctionPasses: number;
  applied: Applied[];
  skipped: Applied[];
  timings: StageTiming[];
  cost: CostLine[];
  fidelity: FidelityReport;
}

/**
 * Where a picture point at a height (the top of a piece) stands on the plan:
 * the floor point under it, found by correcting the floor ray until its
 * projection at that height lands on the point (exact in one step for a
 * parallel camera, a few for a perspective one).
 */
export function unprojectWith(fit: CameraFit): Unproject {
  return (uv, heightM) => {
    const floor = unprojectFloor(fit, uv);
    if (!floor || !(heightM > 0)) return floor;
    let p: [number, number] = [floor[0], floor[1]];
    for (let i = 0; i < 6; i += 1) {
      const q = projectPlan(fit, p, heightM);
      const g = q ? unprojectFloor(fit, q) : null;
      if (!g) return null;
      const dx = floor[0] - g[0]; const dy = floor[1] - g[1];
      p = [p[0] + dx, p[1] + dy];
      if (Math.hypot(dx, dy) < 1e-4) break;
    }
    return p;
  };
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNAVAILABLE']);

/** Give generated models to every placed member of a generated group whose model is ready. */
export function attachGenerated(state: DesignState, build: BuildReport, decisions: ObjectDecision[], refs: ReadonlyMap<string, GeneratedRef>): Set<string> {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  const byInstance = new Map(build.placed.map((p) => [p.instanceId, p.key]));
  const ok = new Set<string>();
  for (const obj of state.objects) {
    const key = byInstance.get(obj.instanceId);
    const d = key ? byKey.get(key) : undefined;
    if (!d || d.route !== 'GENERATE' || !d.group) continue;
    const ref = refs.get(d.group);
    if (!ref) continue;
    obj.generated = { ...ref };
    ok.add(d.key);
  }
  return ok;
}

export async function runEngine(input: EngineInput, deps: EngineDeps): Promise<EngineResult> {
  const timings: StageTiming[] = [];
  const cost: CostLine[] = [];
  const ceiling = JOB_CEILING_USD[input.quality ?? 'HIGH'];
  const qaUsd = input.qaUsd ?? 0.03;
  let open: { stage: Stage; t0: number } | null = null;
  const stage = (s: Stage | null, skipped: Stage[] = []) => {
    const t = deps.now();
    if (open) {
      timings.push({ stage: open.stage, startedAt: new Date(open.t0).toISOString(), endedAt: new Date(t).toISOString(), ms: Math.round(t - open.t0) });
      deps.onStage?.(open.stage, 'DONE');
    }
    for (const k of skipped) { timings.push({ stage: k, startedAt: new Date(t).toISOString(), endedAt: new Date(t).toISOString(), ms: 0 }); deps.onStage?.(k, 'SKIPPED'); }
    open = s ? { stage: s, t0: t } : null;
    if (s) deps.onStage?.(s, 'RUNNING');
  };

  // FINDING — every object's route, highest impact first.
  stage('FINDING');
  let recon = input.recon;
  let decisions = resolveObjects(recon, input.assets, DEFAULT_RESOLUTION);
  const keys = generationRequests(recon, decisions).map((r) => r.key);

  // BUILDING_OBJECTS — only what nothing else can represent; bounded by time.
  const generated = new Map<string, GeneratedRef>();
  const gpu: EngineResult['gpu'] = { jobId: null, state: 'NOT_NEEDED', error: null, persistedBytes: 0, worker: null };
  if (keys.length) {
    stage('BUILDING_OBJECTS');
    const started = await deps.startGeneration(keys);
    gpu.jobId = started.jobId; gpu.state = started.state; gpu.error = started.error;
    if (started.jobId && !TERMINAL.has(started.state)) {
      const until = deps.now() + (input.gpuTimeoutMs ?? 12 * 60_000);
      let last: GenerationPoll = { state: started.state };
      while (!TERMINAL.has(last.state) && deps.now() < until) {
        await deps.sleep(input.pollMs ?? 5000);
        last = await deps.generationStatus(started.jobId);
      }
      gpu.state = TERMINAL.has(last.state) ? last.state : 'RUNNING';
      gpu.error = last.error ?? (TERMINAL.has(last.state) ? null : 'TIMEOUT');
      gpu.worker = (last.result as Record<string, unknown> | undefined) ?? null;
      for (const c of last.cost ?? []) {
        const basis = c.basis === 'MEASURED' || c.basis === 'ESTIMATED' ? c.basis : 'NOT_AVAILABLE';
        cost.push({ stage: 'BUILDING_OBJECTS', kind: 'GPU', usd: c.usd, basis, detail: c.detail });
      }
      for (const a of last.assets ?? []) {
        if (a.state !== 'READY') continue;
        generated.set(a.source_ref, { assetId: a.id, key: a.object_key, sha256: a.sha256 });
        gpu.persistedBytes += a.bytes ?? 0;
      }
    } else if (started.state === 'UNAVAILABLE') {
      cost.push({ stage: 'BUILDING_OBJECTS', kind: 'GPU', usd: null, basis: 'NOT_AVAILABLE', detail: 'generation not configured' });
    }
    // A group whose model did not arrive stays HOMATCH's drawn piece, marked approximate.
    decisions = decisions.map((d) => (d.route === 'GENERATE' && d.group && !generated.has(d.group)
      ? { ...d, route: 'APPROXIMATE', reason: `generation ${gpu.error ? `failed (${gpu.error})` : 'returned no model'}: drawn by HOMATCH` }
      : d));
    // The worker optimises each model before it is stored (no separate client step).
    stage('OPTIMIZING');
  } else {
    stage(null, ['BUILDING_OBJECTS', 'OPTIMIZING']);
  }

  // MATERIALS + ASSEMBLING — deterministic.
  stage('MATERIALS');
  stage('ASSEMBLING');
  let built = deps.assemble(recon);
  let generatedOk = attachGenerated(built.state, built.report, decisions, generated);

  // CHECKING — rendered from the picture's camera, compared, corrected; bounded.
  let qa: QaReport | null = null;
  let qaCalls = 0;
  let correctionPasses = 0;
  const applied: Applied[] = []; const skipped: Applied[] = [];
  if (input.unproject) {
    stage('CHECKING');
    let before: QaReport['scores'] | null = null;
    for (let pass = 0; pass < QA_LIMITS.maxPasses; pass += 1) {
      if (!withinCeiling(cost, qaUsd, ceiling)) break;
      const still = await deps.render(built.state);
      if (!still) break;
      const answer = await deps.visualQa(still, recon);
      qaCalls += 1;
      if (!answer) break;
      const basis = answer.cost.basis === 'MEASURED' || answer.cost.basis === 'ESTIMATED' ? answer.cost.basis : 'NOT_AVAILABLE';
      cost.push({ stage: 'CHECKING', kind: 'VISION', usd: answer.cost.usd, basis, detail: `visual check ${pass + 1}` });
      qa = answer.report;
      const fixed = applyQaCorrections(recon, answer.report, input.unproject, input.confirmed);
      applied.push(...fixed.applied); skipped.push(...fixed.skipped);
      if (!fixed.applied.length) break;
      recon = fixed.recon;
      built = deps.assemble(recon);
      generatedOk = attachGenerated(built.state, built.report, decisions, generated);
      correctionPasses += 1;
      const remainingHigh = answer.report.errors.filter((e) => e.severity === 'HIGH').length;
      const spent = totals(cost);
      if (!anotherPass({ passesDone: pass, before, after: answer.report.scores, remainingHigh, spentUsd: spent.measured + spent.estimated, ceilingUsd: ceiling, nextPassUsd: qaUsd })) break;
      before = answer.report.scores;
    }
  } else {
    stage(null, ['CHECKING']);
  }
  stage(null);

  const fidelity = fidelityReport({ recon, state: built.state, build: built.report, decisions, generatedOk, qa, roomsBuilt: input.roomsBuilt });
  // Stages in the contract's order (skipped ones included), so a report reads the same every time.
  timings.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  return { state: built.state, build: built.report, recon, decisions, generated, gpu, qa, qaCalls, correctionPasses, applied, skipped, timings, cost, fidelity };
}
