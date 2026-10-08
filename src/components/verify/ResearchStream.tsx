// HOMATCH — the research experience.
//
// THE CLOCK COMES FROM THE SERVER, AND THERE IS NO PERCENTAGE ANY MORE
//
// This component used to own its own start time. That was correct while the
// browser WAS the research engine — the component mounted when a run began,
// so its mount time was the run's start. It is no longer true: research runs
// server-side whether anyone is watching or not, so a customer can start a
// check, leave, and come back twelve minutes later. A clock that started when
// this component mounted would tell them 00:00, which is not a smaller
// version of the truth, it is a different number.
//
// So elapsed time is `now - research_jobs.created_at`: derived, never
// remembered, which is why it cannot reset on refresh, remount, a second tab
// or reopening the case from History.
//
// The estimated percentage bar is gone from this view (owner decision,
// 2026-10). However honestly it was labelled, it was a guessed number beside
// a measured one. Its place is taken by the research NETWORK
// (verify/researchNetwork.ts + ResearchNetwork.tsx): nodes that light up only
// when the real pipeline stage reaches them, sections that came back
// unavailable shown as unavailable, and counts only when the server has them.
//
// WHAT IS SHOWN, AND WHAT IT IS ALLOWED TO CLAIM
//
//   - the research network, derived from stage + sections + live counters;
//   - ELAPSED time, which is measured;
//   - a rotating stream of abstract activity lines (presentation only);
//   - REAL facts, shown only once the job has genuinely established them;
//   - an optional game while waiting — pure local UI, it never touches the job;
//   - an explicit way to stop, because closing a tab is not cancellation.

import React, { Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { elapsedMs, formatElapsed, phaseFor } from '@/verify/progress';
import { messagesFor, PHASE_TAG, extractLiveFacts } from '@/verify/researchNarrative';
import { networkState, type LiveCounters, type NetworkSection } from '@/verify/researchNetwork';
import { ResearchNetwork } from '@/components/verify/ResearchNetwork';

// The shared Snake (also offered beside Design Studio renders). Loaded only
// when someone actually chooses to play.
const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));

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
  /** Server-computed section maturities (research-agent `sections.sections`). */
  sections?: readonly NetworkSection[] | null;
  /** research-agent `liveCounters`; a null counter is unknown and is not shown. */
  liveCounters?: LiveCounters | null;
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
  sections,
  liveCounters,
  onStop,
  stopping = false,
}: ResearchStreamProps) {
  const { t } = useLanguage();
  const [, forceTick] = React.useState(0);
  const [step, setStep] = React.useState(0);
  // Local UI only. Opening or closing the game never pauses, cancels,
  // restarts or creates research — VerifyPage's polling is untouched.
  const [playing, setPlaying] = React.useState(false);

  /*
   * One dependency-free interval drives the clock. The value it renders is
   * recomputed from props on every tick rather than accumulated, so a prop
   * arriving late (or a re-render arriving early) cannot desynchronise it.
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
  const elapsed = formatElapsed(elapsedMs(input));
  // Synthesis is a real phase of the pipeline, so say so rather than leaving
  // the stream describing research that has already finished.
  // Before the first status poll we know nothing about this run, and the
  // honest reading of nothing is the beginning — not the middle of the
  // pipeline, which is where an unknown STAGE belongs.
  const phase = synthesizing ? 'SYNTHESIS' : createdAt ? phaseFor(stage) : 'STARTING';
  const lines = synthesizing ? messagesFor('SYNTHESIS', step, 1) : messagesFor(phase, step, 3);
  const facts = React.useMemo(() => extractLiveFacts(result), [result]);
  // Derived from props alone: a remount redraws the same network.
  const network = React.useMemo(
    () => networkState({ stage, status, sections, liveCounters, synthesizing, reportReady }),
    [stage, status, sections, liveCounters, synthesizing, reportReady],
  );
  const activeNode = network.nodes.find((n) => n.key === network.activeKey);
  const stopped = network.terminal === 'FAILED' || network.terminal === 'CANCELLED';
  // One sentence for screen readers, changing only when the stage does.
  const nowLine = reportReady
    ? t('verify_net_settled')
    : stopped
      ? t('verify_net_stopped')
      : activeNode
        ? t('verify_net_now', { step: t(activeNode.labelKey) })
        : t(`verify_pstep_${phase.toLowerCase()}`);
  const snakeStatus = reportReady ? 'READY' : network.terminal === 'FAILED' ? 'FAILED' : 'PROCESSING';

  return (
    <section
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
        <div className="shrink-0 text-end">
          {/* Measured, so it is shown. Nothing guessed sits beside it. */}
          <p className="tabular-nums text-lg font-semibold leading-none">{elapsed}</p>
          <p className="text-2xs uppercase tracking-wider text-muted-foreground mt-1">{t('verify_net_elapsed')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <ResearchNetwork network={network} />
        {/* The only live region: announced when the stage changes, never on a
            clock tick, a rotating line or an animation frame. */}
        <p className="text-xs font-medium break-words" aria-live="polite">{nowLine}</p>
        <ol className="sr-only" aria-label={t('verify_net_sr_heading')}>
          {network.nodes.map((n) => (
            <li key={n.key}>{`${t(n.labelKey)}: ${t(n.stateKey)}`}</li>
          ))}
        </ol>
        {network.counters.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {network.counters.map((c) => (
              <li
                key={c.key}
                className="rounded-full border border-border bg-background/60 px-3 py-1 text-2xs text-muted-foreground tabular-nums break-words"
              >
                {t(c.labelKey, { count: c.value })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="space-y-2">
        {lines.map((k, i) => (
          <li
            key={`${k}-${step}-${i}`}
            className={`flex items-start gap-3 transition-opacity duration-500 ${
              i === 0 ? 'opacity-100' : i === 1 ? 'opacity-70' : 'opacity-40'
            }`}
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(38_92%_54%)]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm break-words">{t(k)}</span>
              <span className="block text-2xs font-semibold uppercase tracking-wider text-[hsl(var(--gold-ink))]/80 break-words">
                {PHASE_TAG[phase]}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* WHAT WE ACTUALLY KNOW SO FAR. Every row here was persisted by the
          research itself; none of it is implied by the stage we reached. */}
      {facts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-2">
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

      {!stopped && !reportReady && (
        <div className="flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPlaying(true)}
            className="h-auto min-h-11 whitespace-normal px-4 py-2 text-start leading-snug"
            data-testid="verify-play-snake"
          >
            {t('verify_net_play_snake')}
          </Button>
        </div>
      )}

      {playing ? (
        <Suspense fallback={null}>
          <SnakeGame
            status={snakeStatus}
            stageLabel={nowLine}
            statusLines={{ working: nowLine, ready: t('verify_net_settled'), failed: t('verify_net_stopped') }}
            onView={() => setPlaying(false)}
            onClose={() => setPlaying(false)}
          />
        </Suspense>
      ) : null}

      {/*
        * THE CONTROL AREA, CONTAINED.
        *
        * This was a ghost button with px-0 — text the same size and weight as
        * the paragraph above it, with no border, no background and no padding
        * to click. The only thing marking it as an action was the cursor, and
        * a customer looking for "how do I stop this" had to guess.
        *
        * It is a real button in a real container now. Outline rather than a
        * filled destructive: stopping a verification is a legitimate choice
        * and must be findable, but it is not the primary thing to do on this
        * screen and should not be the loudest element on it.
        */}
      {onStop && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/60 p-3 sm:p-4">
          <p className="min-w-0 basis-full text-xs leading-relaxed text-muted-foreground sm:flex-1 sm:basis-auto">
            {t('verify_controls_hint')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onStop}
            disabled={stopping}
            /* Same sizing rules as the report's CTAs: a real touch target that
               GROWS for a long translated label instead of clipping it. `h-9`
               was 36px, under the comfortable minimum, and size="sm" brings
               whitespace-nowrap with it. */
            className="h-auto min-h-11 shrink-0 whitespace-normal border-destructive/40 px-4 py-2 text-start leading-snug text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {t(stopping ? 'verify_stop_pending' : 'verify_stop_research')}
          </Button>
        </div>
      )}
    </section>
  );
}
