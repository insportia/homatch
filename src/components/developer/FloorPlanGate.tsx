import React from 'react';
import { CheckCircle2, AlertTriangle, CircleDashed, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Panel } from './primitives';
import { REVIEW_THRESHOLD, type GateResult, type GateRow } from '@/services/developer/floorplan';

/**
 * THE GATE BETWEEN A READING AND A BUILDING.
 *
 * An extraction is a machine's opinion. This is the screen that decides
 * whether that opinion is allowed to become a published apartment, and it
 * decides the same way every time:
 *
 *   SCALE, EXTERIOR WALLS, ROOMS and CEILING HEIGHT are REQUIRED. Without a
 *   scale every length is wrong; without an envelope there is no building;
 *   without rooms there is no floor; without a height there is no wall. None
 *   of the four has a sensible default and the pipeline supplies none.
 *
 *   DOORS, WINDOWS, INTERIOR WALLS and BALCONIES are not required. An
 *   apartment generated without its unverified windows is a truthful shell
 *   with no windows in it, which is better than a shell with windows somebody
 *   guessed — and the gate says exactly which are missing.
 *
 * A category can be confident and still unverified. Confidence is what the
 * model thinks; verified is what a person has said. Only the second opens the
 * gate, which is why a row can read 97% and still be the thing blocking
 * generation.
 */

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  verified: CheckCircle2,
  review: AlertTriangle,
  none: CircleDashed,
};

function rowState(row: GateRow): 'verified' | 'review' | 'none' {
  if (row.count === 0) return 'none';
  if (row.verified) return 'verified';
  return 'review';
}

export function FloorPlanGate({
  gate, className, onGenerate, generating,
}: {
  gate: GateResult;
  className?: string;
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <Panel className={cn('overflow-hidden', className)}>
      <div className="border-b border-border px-4 py-3">
        <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t('dev_fp_gate_title')}
        </p>
      </div>

      <ul className="divide-y divide-border">
        {gate.rows.map((row) => {
          const state = rowState(row);
          const Icon = ICON[state];
          const low = row.confidence != null && row.confidence < REVIEW_THRESHOLD;
          return (
            <li key={row.category} className="flex items-center gap-3 px-4 py-2.5">
              <Icon
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0',
                  state === 'verified' ? 'text-emerald-600'
                    : state === 'review' ? 'text-amber-600' : 'text-muted-foreground/60',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {t(`dev_fp_gate_${row.category.toLowerCase()}`)}
                {row.required && (
                  <span className="ml-1.5 text-2xs text-muted-foreground">
                    {t('dev_fp_gate_required')}
                  </span>
                )}
              </span>

              {/* The count, because "92%" over nothing is not a measurement. */}
              <span className="shrink-0 tabular text-2xs text-muted-foreground">
                {row.count > 0 ? row.count : '—'}
              </span>

              <span className={cn(
                'w-14 shrink-0 text-right tabular text-sm',
                low && 'text-amber-700 dark:text-amber-400',
              )}>
                {row.confidence == null ? '—' : `${Math.round(row.confidence * 100)}%`}
              </span>

              <span className={cn(
                'w-24 shrink-0 text-right text-2xs font-medium uppercase tracking-wider',
                state === 'verified' ? 'text-emerald-700 dark:text-emerald-400'
                  : state === 'review' ? 'text-amber-700 dark:text-amber-400'
                    : 'text-muted-foreground',
              )}>
                {t(`dev_fp_state_${state}`)}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3',
        gate.canGenerate
          ? 'border-emerald-600/40 bg-emerald-500/[0.06]'
          : 'border-amber-600/40 bg-amber-500/[0.06]',
      )}>
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {gate.canGenerate
            ? <Unlock className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            : <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />}
          <span className={gate.canGenerate
            ? 'text-emerald-800 dark:text-emerald-300'
            : 'text-amber-800 dark:text-amber-300'}>
            {t(gate.canGenerate ? 'dev_fp_gate_open' : 'dev_fp_gate_blocked')}
          </span>
        </p>

        {gate.canGenerate ? (
          onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-60"
            >
              {t(generating ? 'dev_fp_generating' : 'dev_fp_generate')}
            </button>
          )
        ) : (
          <p className="text-2xs text-amber-800 dark:text-amber-300">
            {gate.blockedBy
              .map((category) => t(`dev_fp_gate_${category.toLowerCase()}`))
              .join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}
