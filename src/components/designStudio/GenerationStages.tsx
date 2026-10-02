// The stages a build is really in — never a percentage. Shared by the picture
// flow and the floor-plan build so both read the same.

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Minus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { STAGES, STAGE_COPY, type Stage } from '@/lib/designStudio/hybrid/contract';

export type StageStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'SKIPPED';
export const freshStages = (): Record<Stage, StageStatus> => Object.fromEntries(STAGES.map((s) => [s, 'PENDING'])) as Record<Stage, StageStatus>;
const STATE_KEY: Record<StageStatus, string> = { PENDING: 'ds_gen_state_pending', RUNNING: 'ds_gen_state_running', DONE: 'ds_gen_state_done', SKIPPED: 'ds_gen_state_skipped' };

export function GenerationStages({ stages, title, only, tone = 'light', since }: { stages: Record<Stage, StageStatus>; title: string; only?: readonly Stage[]; tone?: 'light' | 'dark'; /** When the run began (a resumed run keeps counting from then). */ since?: number }) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = since ?? Date.now();
    setElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const dark = tone === 'dark';
  return (
    <section className="mx-auto grid w-full max-w-md content-center gap-4" role="status" aria-live="polite" data-testid="generation-stages">
      <div>
        <p className="text-[17px] font-semibold">{title}</p>
        <p className={cn('mt-1 text-[13px]', dark ? 'text-white/60' : 'text-[#5B6472]')} data-testid="generation-elapsed">{t('ds_gen_elapsed', { m: Math.floor(elapsed / 60), s: String(elapsed % 60).padStart(2, '0') })}</p>
      </div>
      <ol className="grid gap-2">
        {(only ?? STAGES).map((s) => {
          const st = stages[s];
          return (
            <li key={s} data-stage={s} data-state={st}
              className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] ring-1',
                dark ? 'bg-white/5' : 'bg-white',
                st === 'RUNNING' ? (dark ? 'ring-[hsl(38_92%_56%)]' : 'ring-[#0C1119]') : (dark ? 'ring-white/10' : 'ring-[#E3E6EB]'),
                st === 'PENDING' || st === 'SKIPPED' ? (dark ? 'text-white/45' : 'text-[#8A919C]') : '')}>
              <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
                {st === 'RUNNING' ? <Loader2 className="h-4 w-4 animate-spin" /> : st === 'DONE' ? <Check className="h-4 w-4 text-[hsl(152_55%_38%)]" /> : st === 'SKIPPED' ? <Minus className="h-4 w-4" /> : <span className={cn('h-1.5 w-1.5 rounded-full', dark ? 'bg-white/30' : 'bg-[#C9CED6]')} />}
              </span>
              <span className="min-w-0 flex-1">{t(STAGE_COPY[s])}</span>
              <span className="sr-only">{t(STATE_KEY[st])}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
