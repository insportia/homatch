// WHAT IS KEPT OF A RUN — the engine report saved with the reading (or the design).
//
// Routes, stage timings, every factory pass, the visual checks, the
// corrections (applied and only reported), cost lines by where they go, the
// storage the run left, and the fidelity gates. Ids and hashes only: never a
// URL, a signed path or a secret.

import { ENGINE_VERSION, type JobMode } from './contract.ts';
import { byKind, totals } from './cost.ts';
import type { EngineResult } from './orchestrate.ts';

export function engineReport(r: EngineResult, extra: { mode: JobMode; versionId: string; startedAt: number; endedAt: number }): Record<string, unknown> {
  const ref = (x: { assetId: string; sha256: string | null; bytes: number | null } | null | undefined) => (x ? { assetId: x.assetId, sha256: x.sha256, bytes: x.bytes } : null);
  return {
    engineVersion: ENGINE_VERSION,
    mode: extra.mode,
    versionId: extra.versionId,
    totalMs: Math.round(extra.endedAt - extra.startedAt),
    timings: r.timings,
    factory: r.factory,
    passes: r.passes.map((p) => ({ pass: p.pass, jobId: p.jobId, state: p.state, error: p.error, discarded: p.discarded, persistedBytes: p.persistedBytes, render: ref(p.render) })),
    scene: { DESKTOP: ref(r.scene.DESKTOP), MOBILE: ref(r.scene.MOBILE) },
    pieces: Object.fromEntries(Object.entries(r.pieces).map(([g, x]) => [g, ref(x)])),
    decisions: r.decisions.map((d) => ({ key: d.key, type: d.type, route: d.route, impact: Math.round(d.impact * 100) / 100, asset: d.assetCode, reason: d.reason })),
    qa: r.qa ? { scores: r.qa.scores, errors: r.qa.errors.map((e) => ({ code: e.code, target: e.target, severity: e.severity, confidence: e.confidence, evidence: e.evidence.slice(0, 200) })) } : null,
    qaHistory: r.qaHistory,
    qaCalls: r.qaCalls,
    correctionPasses: r.correctionPasses,
    applied: r.applied.slice(0, 60),
    reportedOnly: r.skipped.slice(0, 60),
    cost: r.cost,
    costTotals: totals(r.cost),
    costByKind: byKind(r.cost),
    storage: { persistedBytes: r.persistedBytes },
    fidelity: r.fidelity,
    build: { placed: r.build.placed.length, unmatched: r.build.unmatched, unplaced: r.build.unplaced },
  };
}
