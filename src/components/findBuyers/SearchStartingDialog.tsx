// SEARCH STARTING — the moment after "Find interested people" is pressed.
//
// A simple, honest confirmation (owner, 2026-10-12): first "starting" while the
// server accepts the search, then "started" with the three things that happen
// next, and the way to the page where it all shows. It never claims a result:
// it says the search is running and where its results will appear.

import React from 'react';
import { CheckCircle2, Loader2, Radar, Search, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export type SearchStartPhase = 'starting' | 'started' | null;

export function SearchStartingDialog({ phase, tenant, onGo, onClose, goLabelKey = 'fbs_go_to_search' }: {
  phase: SearchStartPhase;
  tenant: boolean;
  /** Open the page where the search and its results show. */
  onGo: () => void;
  onClose: () => void;
  goLabelKey?: string;
}) {
  const { t } = useLanguage();
  const started = phase === 'started';
  const steps = [
    { icon: Search, key: 'fbs_step_prepare' },
    { icon: Radar, key: tenant ? 'fbs_step_search_tenants' : 'fbs_step_search_buyers' },
    { icon: Users, key: 'fbs_step_results' },
  ];
  return (
    <Dialog open={phase !== null} onOpenChange={(open) => { if (!open && started) onClose(); }}>
      <DialogContent data-testid="search-starting" data-phase={phase ?? ''}
        className="max-w-[calc(100%-2rem)] sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          <span className={cn('mb-1 grid h-11 w-11 place-items-center rounded-2xl',
            started ? 'bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] text-[hsl(218_52%_11%)]' : 'bg-[hsl(42_100%_95%)] text-[hsl(34_90%_36%)]')}>
            {started ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />}
          </span>
          <DialogTitle className="break-words font-display">{t(started ? 'fbs_started_title' : 'fbs_starting_title')}</DialogTitle>
          <DialogDescription className="break-words">{t(started ? 'fbs_started_body' : 'fbs_starting_body')}</DialogDescription>
        </DialogHeader>
        <ol className="mt-1 space-y-2" aria-label={t('fbs_steps_label')}>
          {steps.map(({ icon: Icon, key }, i) => {
            const done = started && i === 0;
            const active = started ? i === 1 : i === 0;
            return (
              <li key={key} data-state={done ? 'done' : active ? 'active' : 'next'}
                className={cn('flex items-start gap-2.5 rounded-xl px-3 py-2 text-sm ring-1 ring-inset',
                  active ? 'bg-[hsl(42_100%_96%)] ring-[hsl(40_80%_78%)]' : 'bg-white ring-[hsl(40_30%_88%)]')}>
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-inset ring-[hsl(40_60%_82%)] text-[hsl(34_90%_36%)]">
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    : active && !started ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                      : <Icon className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 break-words leading-snug text-[hsl(218_45%_14%)]">{t(key)}</span>
              </li>
            );
          })}
        </ol>
        {started ? (
          <button type="button" data-testid="search-starting-go" onClick={onGo}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] px-4 text-sm font-semibold text-[hsl(218_52%_11%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2">
            {t(goLabelKey)}
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
