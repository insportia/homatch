// HOMATCH — the research experience.
//
// THE CLOCK AND THE PERCENTAGE BOTH COME FROM THE SERVER NOW
//
// This component used to own its own start time. That was correct while the
// browser WAS the research engine — the component mounted when a run began,
// so its mount time was the run's start. It is no longer true: research runs
// server-side whether anyone is watching or not, so a customer can start a
// check, leave, and come back twelve minutes later. A clock that started when
// this component mounted would tell them 00:00, which is not a smaller
// version of the truth, it is a different number.
//
// So elapsed time is now `now - research_jobs.created_at`, and the estimated
// percentage is reconstructed from `created_at` and the pipeline's own stage
// (see verify/progress.ts). Both are derived, never remembered, which is why
// neither can reset: refresh, remount, a second tab, or reopening the case
// from History all recompute the same number from the same two server facts.
//
// WHAT IS SHOWN, AND WHAT IT IS ALLOWED TO CLAIM
//
//   - ESTIMATED progress, labelled as an estimate, asymptotic, never 100
//     until a valid report actually exists;
//   - ELAPSED time, which is measured;
//   - a rotating stream of abstract activity lines (presentation only);
//   - REAL facts, shown only once the job has genuinely established them;
//   - an explicit way to stop, because closing a tab is not cancellation.

import React from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { estimateProgress, elapsedMs, formatElapsed, phaseFor } from '@/verify/progress';
import { messagesFor, PHASE_TAG, extractLiveFacts } from '@/verify/researchNarrative';

export interface ResearchStreamProps {
  status?: string | null;
  stage?: string | null;
  /** research_jobs.created_at — the authoritative start of this run. */
  createdAt?: string | null;
  completedAt?: string | null;
  /** True only when a valid report has been persisted. */
  reportReady?: boolean;
  /** The customer-sanitised research result, for the real-fact reveal. */
  result?: unknown;
  subject?: string | null;
  /** True once research finished and only the report is still being built. */
  synthesizing?: boolean;
  onStop?: () => void;
  stopping?: boolean;
}

export function ResearchStream({
  status,
  stage,
  createdAt,
  completedAt,
  reportReady = false,
  result,
  subject,
  synthesizing = false,
  onStop,
  stopping = false,
}: ResearchStreamProps) {
  const { t } = useLanguage();
  const [, forceTick] = React.useState(0);
  const [step, setStep] = React.useState(0);

  /*
   * One dependency-free interval drives both readouts. The values it renders
   * are recomputed from props on every tick rather than accumulated, so a
   * prop arriving late (or a re-render arriving early) cannot desynchronise
   * the clock from the percentage — they are two views of the same instant.
   */
  React.useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    // Motion, not measurement: the line rotation deliberately does not map to
    // backend transitions.
    const id = setInterval(() => setStep((s) => s + 1), 3600);
    return () => clearInterval(id);
  }, []);

  const input = { status, stage, createdAt, completedAt, reportReady };
  const pct = estimateProgress(input);
  const elapsed = formatElapsed(elapsedMs(input));
  // Synthesis is a real phase of the pipeline, so say so rather than leaving
  // the stream describing research that has already finished.
  // Same rule as the percentage: before the first status poll we know nothing
  // about this run, and the honest reading of nothing is the beginning — not
  // the middle of the pipeline, which is where an unknown STAGE belongs.
  const phase = synthesizing ? 'SYNTHESIS' : createdAt ? phaseFor(stage) : 'STARTING';
  const lines = synthesizing ? messagesFor('SYNTHESIS', step, 1) : messagesFor(phase, step, 3);
  const facts = React.useMemo(() => extractLiveFacts(result), [result]);

  return (
    <section
      aria-live="polite"
      aria-label={t(synthesizing ? 'verify_stream_synth_title' : 'verify_stream_title')}
      className="rounded-2xl border border-border bg-card/60 p-5 sm:p-6 space-y-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold break-words">
            {t(synthesizing ? 'verify_stream_synth_title' : 'verify_stream_title')}
          </p>
          {subject ? <p className="text-xs text-muted-foreground break-all">{subject}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular-nums text-lg font-semibold leading-none">{pct}%</p>
          {/* Labelled honestly: this is an estimate, and the number beside it
              is not — one is guessed, the other is measured. */}
          <p className="text-2xs uppercase tracking-wider text-muted-foreground/70 mt-1">
            {t('verify_progress_estimated')}
          </p>
        </div>
      </div>

      <div>
        <div
          className="h-1.5 w-full rounded-full bg-primary/15 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('verify_progress_estimated')}
        >
          <div
            className="h-full rounded-full bg-primary/70 transition-all duration-1000 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 mt-2">
          <span className="text-2xs text-muted-foreground">{t(`verify_pstep_${phase.toLowerCase()}`)}</span>
          <span className="tabular-nums text-2xs text-muted-foreground">{elapsed}</span>
        </div>
      </div>

      <ul className="space-y-2">
        {lines.map((k, i) => (
          <li
            key={`${k}-${step}-${i}`}
            className={`flex items-start gap-3 transition-opacity duration-500 ${
              i === 0 ? 'opacity-100' : i === 1 ? 'opacity-70' : 'opacity-40'
            }`}
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm break-words">{t(k)}</span>
              <span className="block text-2xs uppercase tracking-wider text-muted-foreground/60 break-words">
                {PHASE_TAG[phase]}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* WHAT WE ACTUALLY KNOW SO FAR. Every row here was persisted by the
          research itself; none of it is implied by the stage we reached. */}
      {facts.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-background/40 p-3 sm:p-4">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground/70 mb-2">
            {t('verify_stream_found_so_far')}
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {facts.map((f) => (
              <div key={f.id} className="min-w-0 flex items-baseline gap-2">
                <dt className="text-2xs text-muted-foreground shrink-0">{t(f.labelKey)}</dt>
                <dd className="text-xs font-medium break-words min-w-0">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground break-words">{t('verify_stream_note')}</p>

      {onStop && (
        <div className="pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onStop}
            disabled={stopping}
            className="text-muted-foreground hover:text-destructive px-0"
          >
            {t(stopping ? 'verify_stop_pending' : 'verify_stop_research')}
          </Button>
        </div>
      )}
    </section>
  );
}
