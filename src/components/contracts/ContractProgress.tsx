/*
 * THE WAITING SCREEN FOR A CONTRACT BEING READ.
 *
 * The analyser reports STATES, not a percentage, so the screen shows the
 * states: uploaded, waiting its turn, being read, ready. Each step is lit
 * only when the server has actually reached it. The elapsed time is real.
 * There is no percentage: nothing server-side knows what fraction of a
 * contract has been read, and a number nobody measured is decoration.
 *
 * The optional Snake game is a separate component in its own chunk. It
 * shares nothing with the analysis: closing it, losing at it or never
 * opening it changes nothing about the document.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { Check, FileText, Gamepad2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { AnalysisState } from '@/services/dealRoomDocuments';
import { formatElapsed } from './progressEstimate';

const SnakeGame = lazy(() => import('./SnakeGame'));

const STAGES = ['UPLOADED', 'QUEUED', 'RUNNING', 'DONE'] as const;
type Stage = (typeof STAGES)[number];

/** How far the server has really got. NONE means the upload is stored and the request not yet picked up. */
export function reachedStage(state: AnalysisState): Stage {
  if (state === 'DONE') return 'DONE';
  if (state === 'RUNNING') return 'RUNNING';
  if (state === 'QUEUED') return 'QUEUED';
  return 'UPLOADED';
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
    <div className="min-w-0 space-y-4 overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover sm:p-6" data-testid="contract-progress" data-stage={STAGES[reached]}>
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-white/20 bg-white/5" aria-hidden="true">
          <FileText className="absolute inset-0 m-auto h-6 w-6 text-white/60" />
          {state !== 'DONE' ? <span className="hm-doc-scan absolute inset-x-0 h-[2px] bg-[hsl(38_92%_60%)] shadow-[0_0_12px_hsl(38_92%_60%)]" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold">{t(state === 'DONE' ? 'ct_progress_done' : state === 'RUNNING' ? 'ct_progress_reading' : 'ct_progress_queued')}</p>
          <p className="mt-0.5 text-sm tabular-nums text-white/70">{t('ct_stage_elapsed', { time: formatElapsed(elapsed) })}</p>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4" aria-label={t('ct_stage_list')}>
        {STAGES.map((stage, i) => {
          const done = i < reached || (i === reached && stage === 'DONE');
          const current = i === reached && stage !== 'DONE';
          return (
            <li key={stage} aria-current={current ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
                done ? 'bg-white/10 text-white' : current ? 'bg-[hsl(38_92%_56%)]/15 text-[hsl(38_92%_70%)]' : 'text-white/40')}>
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                done ? 'border-[hsl(38_92%_56%)] bg-[hsl(38_92%_56%)] text-[#0C1119]' : current ? 'border-[hsl(38_92%_60%)]' : 'border-white/25')}>
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : current ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(38_92%_60%)] motion-reduce:animate-none" /> : null}
              </span>
              {t(`ct_stage_${stage.toLowerCase()}`)}
            </li>
          );
        })}
      </ol>

      <p className="text-2xs leading-relaxed text-white/60">{state === 'DONE' ? t('ct_progress_done_hint') : t('ct_stage_hint')}</p>

      {state !== 'DONE' ? (
        playing ? (
          <Suspense fallback={null}>
            <SnakeGame onClose={() => setPlaying(false)} />
          </Suspense>
        ) : (
          <button type="button" onClick={() => setPlaying(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-medium text-white/90 hover:border-[hsl(38_92%_56%)]">
            <Gamepad2 className="h-4 w-4" aria-hidden="true" />{t('ct_snake_invite')}
          </button>
        )
      ) : null}
    </div>
  );
}
