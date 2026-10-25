/*
 * THE WAITING SCREEN FOR A CONTRACT BEING READ.
 *
 * The owner asked for this to feel like being inside the document while it
 * is read. So the screen is the document: a page under a moving light, its
 * lines lighting up, the topics HOMI reads for sliding out beside it, and
 * HOMI (the 3D model) at work next to it (DocumentReader, ContractHomiGuide).
 *
 * NOTHING HERE IS FAKE PROGRESS. The analyser reports STATES, not a
 * percentage, so the rail shows the states: uploaded, waiting its turn, being
 * read, ready. Each step is lit only when the server has actually reached it,
 * and the motion itself follows the state (a calm pulse while queued, the
 * reading beam while RUNNING). The elapsed time is real. There is no
 * percentage: nothing server-side knows what fraction of a contract has been
 * read, and a number nobody measured is decoration.
 *
 * The optional Snake game is a separate component in its own chunk. It
 * shares nothing with the analysis: closing it, losing at it or never
 * opening it changes nothing about the document. It sits behind its own
 * error boundary (SnakeBoundary): a game that throws, or a chunk that no
 * longer exists after a deploy, closes the game and leaves this page alone.
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { CalendarClock, Check, Coins, Gamepad2, Scale, ShieldAlert, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { AnalysisState } from '@/services/dealRoomDocuments';
import { formatElapsed } from './progressEstimate';
import { isChunkLoadError } from '@/lib/lazyRoute';
import { reportError } from '@/lib/errorReporting';
import { DocumentReader, type ReaderMode, type ReaderPull } from './DocumentReader';
import { ContractHomiGuide } from './ContractHomiGuide';

/* One retry for a chunk the network or a deploy lost; anything else reaches the boundary. */
const SnakeGame = lazy(() => import('./SnakeGame').catch((e: unknown) => {
  if (!isChunkLoadError(e)) throw e;
  return import('./SnakeGame');
}));

class SnakeBoundary extends React.Component<{ onFailed: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    reportError(error, { boundary: 'contract-snake', route: typeof window !== 'undefined' ? window.location.pathname : undefined });
    this.props.onFailed();
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const STAGES = ['UPLOADED', 'QUEUED', 'RUNNING', 'DONE'] as const;
type Stage = (typeof STAGES)[number];

/** How far the server has really got. NONE means the upload is stored and the request not yet picked up. */
export function reachedStage(state: AnalysisState): Stage {
  if (state === 'DONE') return 'DONE';
  if (state === 'RUNNING') return 'RUNNING';
  if (state === 'QUEUED') return 'QUEUED';
  return 'UPLOADED';
}

/** The reader's motion for a real server state. */
export function readerModeFor(state: AnalysisState): ReaderMode {
  if (state === 'DONE') return 'done';
  if (state === 'RUNNING') return 'reading';
  return 'queued';
}

/** The topics every contract is read for. Shared with the entry page. */
export function useReaderPulls(): ReaderPull[] {
  const { t } = useLanguage();
  const i = 'h-3.5 w-3.5';
  return [
    { key: 'parties', label: t('ux_ct_pull_parties'), icon: <Users className={i} /> },
    { key: 'money', label: t('ux_ct_pull_money'), icon: <Coins className={i} /> },
    { key: 'dates', label: t('ux_ct_pull_dates'), icon: <CalendarClock className={i} /> },
    { key: 'duties', label: t('ux_ct_pull_duties'), icon: <Scale className={i} /> },
    { key: 'risks', label: t('ux_ct_pull_risks'), icon: <ShieldAlert className={i} /> },
  ];
}

export function ContractProgress({
  state,
  startedAt,
}: {
  state: AnalysisState;
  /** Epoch ms when the upload completed. */
  startedAt: number;
}) {
  const { t } = useLanguage();
  const pulls = useReaderPulls();
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (state === 'DONE') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const elapsed = Math.max(0, now - startedAt);
  const reached = STAGES.indexOf(reachedStage(state));

  return (
    <div className="min-w-0 space-y-4" data-testid="contract-progress" data-stage={STAGES[reached]}>
      <div className="relative min-w-0 overflow-hidden rounded-3xl bg-[#0C1119] p-5 text-white shadow-hover ring-1 ring-white/10 sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_20%_0%,hsl(38_92%_56%/0.14),transparent_60%)]" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 break-words font-display text-lg font-semibold sm:text-xl" aria-live="polite">
              {t(state === 'DONE' ? 'ct_progress_done' : state === 'RUNNING' ? 'ct_progress_reading' : 'ct_progress_queued')}
            </p>
            <p className="shrink-0 text-sm tabular-nums text-white/70">{t('ct_stage_elapsed', { time: formatElapsed(elapsed) })}</p>
          </div>

          <DocumentReader mode={readerModeFor(state)} pulls={pulls} pullsTitle={t('ux_ct_pull_title')} className="mt-5" />

          {/* The real states, on a rail that only moves when the server does. */}
          <ol className="mt-6 grid grid-cols-4 gap-1.5" aria-label={t('ct_stage_list')}>
            {STAGES.map((stage, i) => {
              const done = i < reached || (i === reached && stage === 'DONE');
              const current = i === reached && stage !== 'DONE';
              return (
                <li key={stage} aria-current={current ? 'step' : undefined} className="min-w-0">
                  <span className="relative block h-1 overflow-hidden rounded-full bg-white/10">
                    <span className={cn('ct-rail-fill absolute inset-0 rounded-full bg-[hsl(38_92%_56%)]', done ? 'scale-x-100' : current ? 'scale-x-50 animate-pulse motion-reduce:animate-none' : 'scale-x-0')} />
                  </span>
                  <span className={cn('mt-2 flex min-w-0 items-start gap-1 text-xs leading-snug sm:text-sm',
                    done ? 'text-white' : current ? 'font-semibold text-[hsl(38_92%_70%)]' : 'text-white/45')}>
                    {done ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(38_92%_60%)]" aria-hidden="true" /> : null}
                    <span className="min-w-0 break-words">{t(`ct_stage_${stage.toLowerCase()}`)}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 text-sm leading-relaxed text-white/70">{state === 'DONE' ? t('ct_progress_done_hint') : t('ct_stage_hint')}</p>
        </div>
      </div>

      {state !== 'DONE' ? <ContractHomiGuide mode="reading" /> : null}

      {state !== 'DONE' ? (
        playing ? (
          <div className="rounded-2xl bg-[#0C1119] p-3 text-white shadow-hover">
            <SnakeBoundary onFailed={() => setPlaying(false)}>
              <Suspense fallback={null}>
                <SnakeGame onClose={() => setPlaying(false)} />
              </Suspense>
            </SnakeBoundary>
          </div>
        ) : (
          <button type="button" onClick={() => setPlaying(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-card hover:border-[hsl(var(--gold-border))]">
            <Gamepad2 className="h-4 w-4" aria-hidden="true" />{t('ct_snake_invite')}
          </button>
        )
      ) : null}
    </div>
  );
}
