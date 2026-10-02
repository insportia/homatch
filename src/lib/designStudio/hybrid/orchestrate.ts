// THE ENGINE, ONE JOB — a picture (or a plan) to a checked, editable 3D home.
//
//   reading (done) → each object's route → the canonical scene (deterministic)
//   → SceneBuildSpec → Blender factory pass 1: build + render from the source
//   camera → visual check → bounded corrections to the reading → rebuilt →
//   factory pass 2: build + render + export (the home in tiers, each walkthrough
//   piece once) → a verifying check → a third pass only when justified and
//   within budget → the walkthrough's pieces attached → the fidelity report.
//
// Everything with a side effect is injected (EngineDeps), so the order, the
// bounds and the budget are tested without a GPU, a browser or a model. AI is
// called only for the visual check — never for routing, compiling, placing or
// correcting. Without the factory (not configured) the same loop runs on a
// browser still and no models are exported; the report says so.

import type { DesignState, GeneratedRef } from '../designState.ts';
import type { CatalogAsset } from '../catalog.ts';
import type { Reconstruction } from '../reconstructRead.ts';
import type { BuildReport } from '../reconstruction.ts';
import { projectPlan, unprojectFloor, type CameraFit } from '../sourceCamera.ts';
import { FACTORY_STAGE, STAGES, type QualityTarget, type Stage, type StageTiming } from './contract.ts';
import { JOB_CEILING_USD, totals, withinCeiling, type CostLine } from './cost.ts';
import { fidelityReport, type FidelityReport } from './fidelity.ts';
import { anotherPass, applyQaCorrections, QA_LIMITS, QA_PLANNED_PASSES, type Applied, type QaReport, type Unproject } from './qa.ts';
import { resolveObjects, type ObjectDecision } from './resolution.ts';
import type { SceneBuildSpec } from './sceneSpec.ts';

export interface FactoryRef { assetId: string; key: string; sha256: string | null; bytes: number | null }
/**
 * One planned view's files (spec.views): the picture (JPEG), its id image (PNG) and legend
 * (renders/contract.ts ObjectMap, JSON). ids / legend are null without an object map or when
 * an output failed verification; a view that did not render has all three null.
 */
export interface FactoryViewRefs { image: FactoryRef | null; ids: FactoryRef | null; legend: FactoryRef | null }
export interface FactoryPoll {
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNAVAILABLE';
  stage?: string | null;
  outputs?: {
    render: FactoryRef | null; scene: Partial<Record<'DESKTOP' | 'MOBILE', FactoryRef | null>>; pieces: Record<string, FactoryRef | null>;
    /** Present only when the pass planned views, keyed by view id. */
    views?: Record<string, FactoryViewRefs>;
  };
  timings?: Record<string, unknown>;
  cost?: Array<{ usd: number | null; basis: string; detail: string }>;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface EngineDeps {
  startFactory(spec: SceneBuildSpec, pass: number): Promise<{ jobId: string | null; state: FactoryPoll['state']; error: string | null }>;
  factoryStatus(jobId: string): Promise<FactoryPoll>;
  /** A superseded pass's outputs are deleted (nothing orphaned stays in storage). */
  discardFactory(jobId: string): Promise<void>;
  /** The canonical scene from a reading (deterministic; the space is fixed). */
  assemble(recon: Reconstruction): { state: DesignState; report: BuildReport };
  /** The canonical scene as the factory's spec, with these outputs. */
  compile(state: DesignState, outputs: SceneBuildSpec['outputs']): SceneBuildSpec;
  /** Without the factory: a browser still from the source camera (JPEG data URL), or null. */
  browserRender(state: DesignState): Promise<string | null>;
  visualQa(render: { assetId: string } | { dataUrl: string }, recon: Reconstruction): Promise<{ report: QaReport; cost: { usd: number | null; basis: string } } | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onStage?(stage: Stage, status: 'RUNNING' | 'DONE' | 'SKIPPED'): void;
}

export interface EngineInput {
  recon: Reconstruction;
  assets: CatalogAsset[];
  /** Pieces the customer confirmed in review: the check never moves them. */
  confirmed: ReadonlySet<string>;
  /** Picture point → plan metres (the measured camera); null when there is no picture camera. */
  unproject: Unproject | null;
  roomsBuilt: number;
  /** A plan build: the check compares architecture only and never corrects the reading. */
  planSource?: boolean;
  quality?: QualityTarget;
  pollMs?: number;
  /** How long one factory pass may take before the engine stops waiting for it. */
  passTimeoutMs?: number;
  /** What one visual check is expected to cost (ESTIMATED), for the ceiling. */
  qaUsd?: number;
}

export interface PassRecord { pass: number; jobId: string | null; state: string; render: FactoryRef | null; error: string | null; discarded: boolean; persistedBytes: number }

export interface EngineResult {
  state: DesignState;
  build: BuildReport;
  recon: Reconstruction;
  decisions: ObjectDecision[];
  spec: SceneBuildSpec | null;
  factory: 'USED' | 'UNAVAILABLE' | 'FAILED';
  passes: PassRecord[];
  scene: Partial<Record<'DESKTOP' | 'MOBILE', FactoryRef | null>>;
  pieces: Record<string, FactoryRef | null>;
  qa: QaReport | null;
  qaHistory: Array<{ pass: number; scores: QaReport['scores']; errors: number; high: number }>;
  qaCalls: number;
  correctionPasses: number;
  applied: Applied[];
  skipped: Applied[];
  timings: StageTiming[];
  cost: CostLine[];
  persistedBytes: number;
  fidelity: FidelityReport;
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNAVAILABLE']);

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

/** Give each walkthrough piece the factory model of its group. Returns the instance ids that got one. */
export function attachFactoryModels(state: DesignState, spec: SceneBuildSpec, pieces: Record<string, FactoryRef | null>): Set<string> {
  const groupOf = new Map(spec.objects.filter((o) => o.runtime && o.group).map((o) => [o.id, o.group as string]));
  const ok = new Set<string>();
  for (const obj of state.objects) {
    const g = groupOf.get(obj.instanceId);
    const ref = g ? pieces[g] : null;
    if (!ref) { delete obj.generated; continue; }
    obj.generated = { assetId: ref.assetId, key: ref.key, sha256: ref.sha256 } satisfies GeneratedRef;
    ok.add(obj.instanceId);
  }
  return ok;
}

export async function runEngine(input: EngineInput, deps: EngineDeps): Promise<EngineResult> {
  const timings: StageTiming[] = [];
  const cost: CostLine[] = [];
  const ceiling = JOB_CEILING_USD[input.quality ?? 'HIGH'];
  const qaUsd = input.qaUsd ?? 0.03;
  const status = new Map<Stage, 'RUNNING' | 'DONE' | 'SKIPPED'>();
  const started = new Map<Stage, number>();
  const run = (s: Stage) => {
    // Everything before a running stage is done (the factory reports stages in order).
    for (const prev of STAGES.slice(0, STAGES.indexOf(s))) if (status.get(prev) === 'RUNNING') done(prev);
    if (status.get(s) === 'RUNNING') return;
    status.set(s, 'RUNNING'); started.set(s, deps.now()); deps.onStage?.(s, 'RUNNING');
  };
  const done = (s: Stage) => {
    if (status.get(s) !== 'RUNNING') return;
    const t0 = started.get(s) ?? deps.now(); const t1 = deps.now();
    timings.push({ stage: s, startedAt: new Date(t0).toISOString(), endedAt: new Date(t1).toISOString(), ms: Math.round(t1 - t0) });
    status.set(s, 'DONE'); deps.onStage?.(s, 'DONE');
  };
  const skip = (s: Stage) => {
    if (status.has(s)) return;
    const t = new Date(deps.now()).toISOString();
    timings.push({ stage: s, startedAt: t, endedAt: t, ms: 0 }); status.set(s, 'SKIPPED'); deps.onStage?.(s, 'SKIPPED');
  };

  // PLANNING — routes and the canonical scene, deterministic.
  run('PLANNING');
  let recon = input.recon;
  const decisions = resolveObjects(recon, input.assets);
  let built = deps.assemble(recon);
  done('PLANNING');

  const passes: PassRecord[] = [];
  let factory: EngineResult['factory'] = 'USED';
  let lastPassUsd = 0;
  let final: FactoryPoll | null = null;
  let finalSpec: SceneBuildSpec | null = null;
  // The scene and reading the latest successful pass built (what is saved, exactly).
  let finalBuilt = built;
  let finalRecon = recon;

  /** One factory pass to its end (bounded in time); the stages it reports are the customer's. */
  const factoryPass = async (pass: number, outputs: SceneBuildSpec['outputs']): Promise<FactoryPoll | null> => {
    const spec = deps.compile(built.state, outputs);
    const startedJob = await deps.startFactory(spec, pass);
    if (!startedJob.jobId) {
      if (startedJob.state === 'UNAVAILABLE') factory = 'UNAVAILABLE';
      else factory = 'FAILED';
      passes.push({ pass, jobId: null, state: startedJob.state, render: null, error: startedJob.error, discarded: false, persistedBytes: 0 });
      return null;
    }
    run('ARCHITECTURE');
    const until = deps.now() + (input.passTimeoutMs ?? 15 * 60_000);
    let poll: FactoryPoll = { state: startedJob.state };
    while (!TERMINAL.has(poll.state) && deps.now() < until) {
      await deps.sleep(input.pollMs ?? 4000);
      poll = await deps.factoryStatus(startedJob.jobId);
      const s = poll.stage ? FACTORY_STAGE[poll.stage] : undefined;
      if (s) run(s);
    }
    for (const c of poll.cost ?? []) {
      const basis = c.basis === 'MEASURED' || c.basis === 'ESTIMATED' ? c.basis : 'NOT_AVAILABLE';
      cost.push({ stage: 'ARCHITECTURE', kind: 'GPU', usd: c.usd, basis, detail: `pass ${pass}: ${c.detail}` });
      if (c.usd !== null) lastPassUsd = c.usd;
    }
    const ok = poll.state === 'COMPLETED' && !!poll.outputs?.render;
    passes.push({
      pass, jobId: startedJob.jobId, state: TERMINAL.has(poll.state) ? poll.state : 'TIMEOUT', render: poll.outputs?.render ?? null,
      error: ok ? null : poll.error ?? (TERMINAL.has(poll.state) ? 'no render' : 'TIMEOUT'), discarded: false,
      persistedBytes: Number((poll.result as { persistedBytes?: number } | null | undefined)?.persistedBytes ?? 0),
    });
    if (!ok) { factory = 'FAILED'; return null; }
    finalSpec = spec;
    finalBuilt = built; finalRecon = recon;
    return poll;
  };

  // CHECKING — the source camera's view compared with the source; corrections bounded.
  let qa: QaReport | null = null;
  const qaHistory: EngineResult['qaHistory'] = [];
  let qaCalls = 0;
  let correctionPasses = 0;
  const applied: Applied[] = []; const skipped: Applied[] = [];
  const check = async (render: { assetId: string } | { dataUrl: string }, pass: number): Promise<{ changed: boolean; report: QaReport; appliedCount: number } | null> => {
    if (qaCalls >= QA_LIMITS.maxPasses || !withinCeiling(cost, qaUsd, ceiling)) return null;
    run('CHECKING');
    const answer = await deps.visualQa(render, recon);
    qaCalls += 1;
    if (!answer) return null;
    const basis = answer.cost.basis === 'MEASURED' || answer.cost.basis === 'ESTIMATED' ? answer.cost.basis : 'NOT_AVAILABLE';
    cost.push({ stage: 'CHECKING', kind: 'VISION', usd: answer.cost.usd, basis, detail: `visual check after pass ${pass}` });
    qa = answer.report;
    qaHistory.push({ pass, scores: answer.report.scores, errors: answer.report.errors.length, high: answer.report.errors.filter((e) => e.severity === 'HIGH').length });
    // A plan build only reports: the architecture is the plan's, never moved by a check.
    if (input.planSource || !input.unproject) {
      for (const e of answer.report.errors) skipped.push({ code: e.code, target: e.target, detail: 'reported for review' });
      return { changed: false, report: answer.report, appliedCount: 0 };
    }
    const fixed = applyQaCorrections(recon, answer.report, input.unproject, input.confirmed);
    applied.push(...fixed.applied); skipped.push(...fixed.skipped);
    if (!fixed.applied.length) return { changed: false, report: answer.report, appliedCount: 0 };
    recon = fixed.recon;
    built = deps.assemble(recon);
    correctionPasses += 1;
    return { changed: true, report: answer.report, appliedCount: fixed.applied.length };
  };

  // Pass 1: build and render only (nothing exported, nothing to clean up).
  const p1 = await factoryPass(1, { render: true, scene: false, objects: false });
  if (p1?.outputs?.render) {
    const c1 = await check({ assetId: p1.outputs.render.assetId }, 1);
    // Pass 2: the (corrected) home, rendered and exported.
    const p2 = await factoryPass(2, { render: true, scene: true, objects: true });
    if (p2?.outputs?.render) {
      final = p2;
      let before = c1?.report.scores ?? null;
      let passNo = 2;
      // A verifying check when the first one changed something; a further pass only when justified.
      let verify = c1?.changed && QA_PLANNED_PASSES >= 2 ? await check({ assetId: p2.outputs.render.assetId }, 2) : null;
      while (verify?.changed && passNo < QA_LIMITS.maxPasses) {
        const spent = totals(cost);
        const high = verify.report.errors.filter((e) => e.severity === 'HIGH').length;
        if (!anotherPass({ passesDone: passNo - 1, before, after: verify.report.scores, remainingHigh: high, spentUsd: spent.measured + spent.estimated, ceilingUsd: ceiling, nextPassUsd: lastPassUsd + qaUsd })) break;
        const next = await factoryPass(passNo + 1, { render: true, scene: true, objects: true });
        if (!next?.outputs?.render) break;
        // The superseded pass's exports are deleted: one home, one set of files.
        const prev = passes.find((p) => p.pass === passNo);
        if (prev?.jobId) { await deps.discardFactory(prev.jobId); prev.discarded = true; }
        final = next;
        passNo += 1;
        before = verify.report.scores;
        verify = await check({ assetId: next.outputs.render.assetId }, passNo);
      }
      // What the last check found after the last pass is reported, never half-applied:
      // the saved home is exactly the one the final pass built (and rendered).
      if (verify?.changed) {
        for (const a of applied.splice(applied.length - verify.appliedCount)) skipped.push({ ...a, detail: `found after the last pass: ${a.detail}` });
        correctionPasses -= 1;
        built = finalBuilt; recon = finalRecon;
      }
    }
  }

  // Without the factory: the same bounded check on a browser still; nothing is exported.
  if (factory !== 'USED') {
    // The factory's stages did not run: they are shown as skipped, never as done.
    for (const s of ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING'] as Stage[]) skip(s);
    for (let pass = 1; pass <= QA_PLANNED_PASSES; pass += 1) {
      const still = await deps.browserRender(built.state);
      if (!still) break;
      const c = await check({ dataUrl: still }, pass);
      if (!c?.changed) break;
    }
  }

  // PREPARING — the walkthrough's pieces wear their factory models.
  run('PREPARING');
  let factoryOk = new Set<string>();
  const pieces = final?.outputs?.pieces ?? {};
  if (final && finalSpec) factoryOk = attachFactoryModels(built.state, finalSpec, pieces);
  done('PREPARING');
  for (const s of STAGES) if (s !== 'FINALIZING' && s !== 'UNDERSTANDING' && s !== 'MEASURING') { if (status.get(s) === 'RUNNING') done(s); else skip(s); }

  const okKeys = new Set(built.state.objects.filter((o) => factoryOk.has(o.instanceId) && o.provenance?.ref).map((o) => o.provenance!.ref));
  const fidelity = fidelityReport({ recon, state: built.state, build: built.report, decisions, factoryOk: okKeys, qa, roomsBuilt: input.roomsBuilt });
  timings.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  return {
    state: built.state, build: built.report, recon, decisions, spec: finalSpec, factory, passes,
    scene: final?.outputs?.scene ?? {}, pieces, qa, qaHistory, qaCalls, correctionPasses, applied, skipped, timings, cost,
    persistedBytes: passes.filter((p) => !p.discarded).reduce((s, p) => s + p.persistedBytes, 0), fidelity,
  };
}
