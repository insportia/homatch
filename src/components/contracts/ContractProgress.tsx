/*
 * THE WAITING SCREEN FOR A CONTRACT BEING READ.
 *
 * The arithmetic, and the reasoning behind refusing to show a fake 100%,
 * lives in ./progressEstimate.ts. This file is only what that looks like.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AnalysisState } from '@/services/dealRoomDocuments';
import { estimatedPercent, formatElapsed } from './progressEstimate';

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

  useEffect(() => {
    if (state === 'DONE') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const elapsed = Math.max(0, now - startedAt);
  const percent = estimatedPercent(elapsed, state);

  const labelKey =
    state === 'DONE' ? 'ct_progress_done'
    : state === 'RUNNING' ? 'ct_progress_reading'
    : 'ct_progress_queued';

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {state !== 'DONE' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        ) : null}
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{t(labelKey)}</span>
        <span className="ms-auto shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t(labelKey)}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
        {state === 'DONE' ? t('ct_progress_done_hint') : t('ct_progress_estimate_hint')}
      </p>
    </div>
  );
}
