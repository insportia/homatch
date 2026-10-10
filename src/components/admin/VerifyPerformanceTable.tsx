// Admin → Providers → Verify: end-to-end performance per recent job.
//
// Start (research_jobs.created_at) → report READY (synthesis_at), from the
// `performance` block verify-admin-diagnostics computes with
// src/verify/performance.ts. Server timestamps only. Admin-only by
// construction: the diagnostics action refuses anyone who is not is_admin.
//
// One bar per job: top-level stages positioned on the job's own timeline,
// hand-off gaps left as empty track. The bottleneck is named in text (never
// colour alone); every stage, task and TAS sub-step is listed in the table
// under each job.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PerfStage, VerifyPerformance } from '@/verify/performance';

const secs = (ms?: number | null) => (typeof ms === 'number' ? (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 100) / 10}s`) : '—');
const at = (v: string | null) => (v ? Date.parse(v) : NaN);

function StageBar({ p }: { p: VerifyPerformance }) {
  const start = at(p.startedAt);
  const end = at(p.readyAt) || at(p.researchCompletedAt);
  const top = p.stages.filter((s) => s.parent === null && s.startedAt && s.endedAt);
  const length = Number.isFinite(end) && Number.isFinite(start) && end > start ? end - start : top.reduce((m, s) => Math.max(m, at(s.endedAt) - start), 0);
  if (!top.length || !(length > 0)) return null;
  // The top-level stage the bottleneck sits under (it may be a task or TAS step).
  let b = p.stages.find((s) => s.key === p.bottleneck) ?? null;
  while (b?.parent) b = p.stages.find((s) => s.key === b!.parent) ?? null;
  const hotTop = b?.key ?? null;
  return (
    <div className="relative h-3 w-full min-w-[240px] rounded-sm bg-muted" role="img" aria-label={top.map((s) => `${s.label} ${secs(s.ms)}`).join(', ')}>
      {top.map((s) => {
        const left = Math.max(0, ((at(s.startedAt) - start) / length) * 100);
        const width = Math.max(0.6, ((s.ms ?? 0) / length) * 100);
        const hot = hotTop === s.key;
        return (
          <span
            key={s.key}
            title={`${s.label}: ${secs(s.ms)}${s.gapBeforeMs ? ` (+${secs(s.gapBeforeMs)} hand-off before)` : ''}`}
            className={`absolute top-0 h-3 rounded-sm border-x border-background ${hot ? 'bg-amber-500' : s.kind === 'synthesis' ? 'bg-primary/60' : 'bg-primary'}`}
            style={{ insetInlineStart: `${Math.min(left, 99.4)}%`, width: `${Math.min(width, 100 - Math.min(left, 99.4))}%` }}
          />
        );
      })}
    </div>
  );
}

function StageRows({ stages, bottleneck }: { stages: PerfStage[]; bottleneck: string | null }) {
  const depth = (s: PerfStage): number => (s.parent ? 1 + depth(stages.find((x) => x.key === s.parent) ?? { ...s, parent: null }) : 0);
  // Parents first, each followed by its children.
  const ordered: PerfStage[] = [];
  const add = (s: PerfStage) => {
    ordered.push(s);
    for (const c of stages.filter((x) => x.parent === s.key)) add(c);
  };
  for (const s of stages.filter((x) => x.parent === null)) add(s);
  for (const s of stages) if (!ordered.includes(s)) ordered.push(s);
  return (
    <table className="w-full text-2xs">
      <tbody>
        {ordered.map((s) => (
          <tr key={s.key} className={`border-t border-border/50 ${bottleneck === s.key ? 'font-semibold' : ''}`}>
            <td className="py-0.5 pe-2" style={{ paddingInlineStart: `${depth(s) * 12}px` }}>{s.label}{bottleneck === s.key ? ' ◀' : ''}</td>
            <td className="py-0.5 pe-2 tabular-nums">{secs(s.ms)}</td>
            <td className="py-0.5 pe-2 tabular-nums text-muted-foreground">
              {s.queueMs ? `q ${secs(s.queueMs)} ` : ''}{s.execMs !== null && s.execMs !== s.ms ? `exec ${secs(s.execMs)} ` : ''}{s.attempts && s.attempts > 1 ? `×${s.attempts} retry ${secs(s.retryMs)} ` : ''}{s.captchaMs ? `captcha ${secs(s.captchaMs)} ` : ''}{s.gapBeforeMs ? `gap ${secs(s.gapBeforeMs)}` : ''}
            </td>
            <td className="py-0.5 text-muted-foreground">{s.status ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VerifyPerformanceTable({ jobs }: { jobs: Array<{ id: string; query?: string; performance?: VerifyPerformance | null }> }) {
  const { t } = useLanguage();
  const rows = jobs.filter((j) => j.performance);
  if (!rows.length) return <p className="text-xs text-muted-foreground">{t('adm_vos_no_data')}</p>;
  return (
    <div className="space-y-2">
      {rows.map((j) => {
        const p = j.performance!;
        const stage = p.stages.find((s) => s.key === p.bottleneck);
        return (
          <details key={j.id} className="rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer list-none space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-mono">{j.id}</span>
                <span className="tabular-nums font-semibold">{t('adm_vperf_total')}: {p.totalMs !== null ? secs(p.totalMs) : `${secs(p.elapsedMs)} · ${p.state}`}</span>
                <span className="tabular-nums">{t('adm_vperf_research')}: {secs(p.researchMs)}</span>
                <span className="tabular-nums">{t('adm_vperf_report')}: {secs(p.synthesisMs)}{p.modelMs !== null ? ` (AI ${secs(p.modelMs)})` : ''}</span>
                <span className="tabular-nums">{t('adm_vperf_queue')}: {secs(p.queueWaitMs)}</span>
                <span className="tabular-nums">{t('adm_vperf_worker')}: {secs(p.workerMs)}</span>
                <span className="tabular-nums">{t('adm_vperf_handoff')}: {secs(p.handoffMs)}</span>
                <span className="tabular-nums">{t('adm_vperf_retries')}: {p.retries.count}{p.retries.count ? ` · ${secs(p.retries.ms)}` : ''}</span>
                {p.coverage.tasPriority ? <span>TAS {t('adm_vperf_newest_two')}: {p.coverage.tasPriority}</span> : null}
              </div>
              <StageBar p={p} />
              <div className="text-amber-700 dark:text-amber-400">
                {t('adm_vperf_bottleneck')}: {p.bottleneck ? (stage ? `${stage.label} · ${secs(stage.ms)}` : p.bottleneck) : '—'}
              </div>
            </summary>
            <div className="mt-2 overflow-x-auto">
              <StageRows stages={p.stages} bottleneck={p.bottleneck} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
