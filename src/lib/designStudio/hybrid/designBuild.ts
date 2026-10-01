// A DESIGN (FROM A FLOOR PLAN) THROUGH THE FACTORY — one pass, checked, never rewritten.
//
//   the design's canonical scene → SceneBuildSpec (architecture SOURCE-DERIVED
//   from the plan; furnishing and finishes a DESIGN CHOICE) → one factory pass:
//   build, render from above, export → deterministic checks (walkability,
//   intersections, scale) → a visual check of the architecture against the
//   plan drawing, REPORTED only (a plan is never corrected by a model) →
//   the walkthrough's pieces attached.

import type { DesignState } from '../designState.ts';
import { STAGES, type Stage, type StageTiming } from './contract.ts';
import type { CostLine } from './cost.ts';
import { gateOf, type Dimension, type Gate } from './fidelity.ts';
import { attachFactoryModels, type EngineDeps, type FactoryPoll, type FactoryRef } from './orchestrate.ts';
import { QA_DIMENSIONS, type QaReport } from './qa.ts';
import { FACTORY_STAGE } from './contract.ts';
import type { SceneBuildSpec } from './sceneSpec.ts';

export interface DesignBuildResult {
  state: DesignState;
  spec: SceneBuildSpec | null;
  factory: 'USED' | 'UNAVAILABLE' | 'FAILED';
  jobId: string | null;
  error: string | null;
  render: FactoryRef | null;
  scene: Partial<Record<'DESKTOP' | 'MOBILE', FactoryRef | null>>;
  pieces: Record<string, FactoryRef | null>;
  qa: QaReport | null;
  dimensions: Dimension[];
  verdict: Gate;
  timings: StageTiming[];
  cost: CostLine[];
  persistedBytes: number;
}

const worst = (gates: Gate[]): Gate => (gates.includes('FAIL') ? 'FAIL' : gates.includes('WARN') ? 'WARN' : gates.includes('UNKNOWN') ? 'UNKNOWN' : 'PASS');

export async function runDesignBuild(
  input: { state: DesignState; checks: Dimension[]; pollMs?: number; passTimeoutMs?: number },
  deps: Pick<EngineDeps, 'startFactory' | 'factoryStatus' | 'compile' | 'sleep' | 'now' | 'onStage'> & {
    planQa: (renderAssetId: string) => Promise<{ report: QaReport; cost: { usd: number | null; basis: string } } | null>;
  },
): Promise<DesignBuildResult> {
  const timings: StageTiming[] = [];
  const cost: CostLine[] = [];
  const t0s = new Map<Stage, number>();
  const state = new Map<Stage, string>();
  const run = (s: Stage) => {
    for (const p of STAGES.slice(0, STAGES.indexOf(s))) if (state.get(p) === 'RUNNING') done(p);
    if (state.get(s) === 'RUNNING') return;
    state.set(s, 'RUNNING'); t0s.set(s, deps.now()); deps.onStage?.(s, 'RUNNING');
  };
  const done = (s: Stage) => {
    if (state.get(s) !== 'RUNNING') return;
    const a = t0s.get(s) ?? deps.now(); const b = deps.now();
    timings.push({ stage: s, startedAt: new Date(a).toISOString(), endedAt: new Date(b).toISOString(), ms: Math.round(b - a) });
    state.set(s, 'DONE'); deps.onStage?.(s, 'DONE');
  };

  run('PLANNING');
  const spec = deps.compile(input.state, { render: true, scene: true, objects: true });
  const started = await deps.startFactory(spec, 1);
  const out: DesignBuildResult = {
    state: input.state, spec, factory: 'USED', jobId: started.jobId, error: started.error, render: null, scene: {}, pieces: {}, qa: null,
    dimensions: [...input.checks], verdict: 'UNKNOWN', timings, cost, persistedBytes: 0,
  };
  if (!started.jobId) {
    out.factory = started.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED';
    done('PLANNING');
    out.verdict = worst(out.dimensions.map((d) => d.gate));
    return out;
  }
  run('ARCHITECTURE');
  const until = deps.now() + (input.passTimeoutMs ?? 15 * 60_000);
  let poll: FactoryPoll = { state: started.state };
  while (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNAVAILABLE'].includes(poll.state) && deps.now() < until) {
    await deps.sleep(input.pollMs ?? 4000);
    poll = await deps.factoryStatus(started.jobId);
    const s = poll.stage ? FACTORY_STAGE[poll.stage] : undefined;
    if (s) run(s);
  }
  for (const c of poll.cost ?? []) cost.push({ stage: 'ARCHITECTURE', kind: 'GPU', usd: c.usd, basis: c.basis === 'ESTIMATED' || c.basis === 'MEASURED' ? c.basis : 'NOT_AVAILABLE', detail: c.detail });
  if (poll.state !== 'COMPLETED' || !poll.outputs?.render) {
    out.factory = 'FAILED'; out.error = poll.error ?? (poll.state === 'COMPLETED' ? 'no render' : 'TIMEOUT');
    out.verdict = worst(out.dimensions.map((d) => d.gate));
    return out;
  }
  out.render = poll.outputs.render; out.scene = poll.outputs.scene; out.pieces = poll.outputs.pieces;
  out.persistedBytes = Number((poll.result as { persistedBytes?: number } | null | undefined)?.persistedBytes ?? 0);

  run('CHECKING');
  const answer = await deps.planQa(poll.outputs.render.assetId);
  if (answer) {
    out.qa = answer.report;
    cost.push({ stage: 'CHECKING', kind: 'VISION', usd: answer.cost.usd, basis: answer.cost.basis === 'ESTIMATED' || answer.cost.basis === 'MEASURED' ? answer.cost.basis : 'NOT_AVAILABLE', detail: 'plan check' });
    const dims = answer.report.scores.dimensions ?? {};
    for (const d of QA_DIMENSIONS) {
      if (dims[d] == null) continue;
      out.dimensions.push({ name: `${d} (against the plan)`, value: `${dims[d]}/10 by eye`, gate: gateOf(dims[d]), note: answer.report.errors.filter((e) => (d === 'openings' ? e.code === 'wrongOpening' : e.code === 'wrongWall')).slice(0, 3).map((e) => `${e.target}: ${e.evidence}`).join('; ') });
    }
  } else out.dimensions.push({ name: 'architecture against the plan', value: 'not checked', gate: 'UNKNOWN', note: '' });

  run('PREPARING');
  attachFactoryModels(input.state, spec, out.pieces);
  done('PREPARING');
  out.dimensions.push({ name: 'furnishing', value: 'a design choice (the plan shows no furniture)', gate: 'PASS', note: 'INFERRED: never presented as the plan\'s' });
  out.verdict = worst(out.dimensions.map((d) => d.gate));
  return out;
}
