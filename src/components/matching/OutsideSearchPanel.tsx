/*
 * PHASE 2 — SEARCH OUTSIDE HOMATCH, on the Find Property results.
 *
 * HOMATCH's own intelligence answers a confirmed search continuously and for
 * free. This panel is the paid step beyond it: the customer sets a budget
 * (a ceiling; settlement charges what was used) and HOMATCH searches live
 * property portals and communities for listings that fit.
 *
 * Every stage shown is a real server state (discovery_runs.stage), and the
 * source activity is counted from real finished jobs, by customer-safe group
 * -- never a provider name, a cost or a raw error. The run is read from the
 * server on mount and polled while open, so a refresh, a second tab or a
 * logout changes nothing. Pause, resume and stop act on the server.
 */
import { Pause, Play, Search, Square } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SearchBudgetOffer } from '@/components/billing/SearchBudgetOffer';
import { QuietAction } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  OPEN_OUTSIDE_RUN, type OutsideRun,
  controlOutsideRun, latestOutsideRun, latestSupplySearchId, outsideRunActivity, startOutsideSearch,
} from '@/services/findProperty';

const STAGES = ['UNDERSTANDING', 'CHECKING_HOMATCH', 'SEARCHING_SOURCES', 'VALIDATING', 'MATCHING', 'READY'] as const;
const STAGE_KEY: Record<string, string> = {
  UNDERSTANDING: 'p2d_stage_understanding',
  CHECKING_HOMATCH: 'p2d_stage_checking',
  SEARCHING_SOURCES: 'p2d_stage_searching',
  VALIDATING: 'p2d_stage_validating',
  MATCHING: 'p2d_stage_matching',
  READY: 'p2d_stage_ready',
};
const GROUP_KEY: Record<string, string> = {
  PROPERTY_PORTALS: 'p2d_group_portals',
  COMMUNITIES: 'p2d_group_communities',
  FORUMS: 'p2d_group_forums',
  HOMATCH: 'p2d_group_homatch',
};
const REFUSAL_KEY: Record<string, string> = {
  DISCOVERY_OFF: 'p2d_refused_off',
  NO_LIVE_SOURCES: 'p2d_refused_no_sources',
  PLAN_INCOMPLETE: 'p2d_refused_plan',
  BELOW_CAMPAIGN_MINIMUM: 'p2d_refused_budget',
  INSUFFICIENT_CREDITS: 'p2d_refused_credits',
  BILLING_REQUIRED: 'p2d_refused_credits',
};

export function OutsideSearchPanel({ onFinished, className }: { onFinished?: () => void; className?: string }) {
  const { t } = useLanguage();
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [run, setRun] = useState<OutsideRun | null>(null);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  /* One key per decision to start, so a double click or a retry is one run. */
  const startKey = useRef<string>(crypto.randomUUID());
  const wasOpen = useRef(false);
  /* Held in a ref: an inline callback from the parent must not restart polling. */
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const refresh = useCallback(async () => {
    /* A failed poll keeps the last known state; the next poll tries again. */
    try {
      const id = subscriptionId ?? await latestSupplySearchId();
      if (!id) return;
      if (!subscriptionId) setSubscriptionId(id);
      const latest = await latestOutsideRun(id);
      setRun(latest);
      if (latest) setActivity(await outsideRunActivity(latest.id));
      const open = !!latest && OPEN_OUTSIDE_RUN.includes(latest.status);
      if (wasOpen.current && !open) finished.current?.();
      wasOpen.current = open;
    } catch (error) {
      console.error('outside search refresh failed', error);
    }
  }, [subscriptionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = !!run && OPEN_OUTSIDE_RUN.includes(run.status);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  if (!subscriptionId) return null;

  const start = async (credits: number | null) => {
    setBusy(true);
    try {
      const outcome = await startOutsideSearch(subscriptionId, credits, startKey.current);
      if (!outcome.runId) {
        toast.error(t(REFUSAL_KEY[outcome.reasonCode ?? ''] ?? 'p2d_control_error'));
        return;
      }
      startKey.current = crypto.randomUUID();
      setChoosing(false);
      await refresh();
    } catch {
      toast.error(t('p2d_control_error'));
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: 'pause' | 'resume' | 'stop') => {
    if (!run) return;
    setBusy(true);
    try {
      await controlOutsideRun(run.id, action);
      if (action === 'resume') toast.success(t('p2d_resumed_toast'));
      if (action === 'stop') toast.success(t('p2d_stopping_toast'));
      await refresh();
    } catch {
      toast.error(t('p2d_control_error'));
    } finally {
      setBusy(false);
    }
  };

  const currentStage = run?.status === 'PAUSED' ? null : (run && !open ? 'READY' : run?.stage ?? null);
  const stageIndex = currentStage ? STAGES.indexOf(currentStage as (typeof STAGES)[number]) : -1;

  return (
    <section className={cn('hm-discovery-panel p-3.5', className)} aria-labelledby="outside-search-title">
      <p id="outside-search-title" className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-foreground">
        {t('p2d_outside_title')}
      </p>
      <p className="mb-3 text-2xs leading-snug text-muted-foreground">{t('p2d_outside_body')}</p>

      {open && run && (
        <div className="space-y-3" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-[hsl(var(--gold-ink))] transition-[width] duration-500" style={{ width: `${Math.max(4, run.progress)}%` }} />
          </div>
          {run.status === 'PAUSED' ? (
            <p className="text-xs leading-snug text-muted-foreground">{t('p2d_paused_note')}</p>
          ) : (
            <ol className="space-y-1">
              {STAGES.map((stage, index) => (
                <li key={stage} className={cn('flex items-center gap-2 text-xs',
                  index < stageIndex ? 'text-muted-foreground' : index === stageIndex ? 'font-medium text-foreground' : 'text-muted-foreground/60')}>
                  <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                    index <= stageIndex ? 'bg-[hsl(var(--gold-ink))]' : 'bg-muted-foreground/30')} />
                  <span className="min-w-0 break-words">{t(STAGE_KEY[stage])}</span>
                </li>
              ))}
            </ol>
          )}
          {Object.keys(activity).length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              {Object.entries(activity).map(([group, count]) => (
                <li key={group}>{t('p2d_group_done', { group: t(GROUP_KEY[group] ?? 'p2d_group_homatch'), count: String(count) })}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {run.status === 'PAUSED' ? (
              <QuietAction full icon={Play} busy={busy} disabled={busy} onClick={() => control('resume')} label={t('p2d_resume_search')} />
            ) : (
              <QuietAction full icon={Pause} busy={busy} disabled={busy || run.status === 'MATCHING'} onClick={() => control('pause')} label={t('p2d_pause_search')} />
            )}
            <QuietAction full icon={Square} busy={busy} disabled={busy || run.status === 'MATCHING'} onClick={() => control('stop')} label={t('p2d_stop_search')} />
          </div>
        </div>
      )}

      {!open && run && (
        <p className="mb-3 text-xs leading-snug text-muted-foreground" role="status">
          {run.resultsFound > 0
            ? t('p2d_outside_done', { count: String(run.resultsFound) })
            : t('p2d_outside_none')}
        </p>
      )}

      {!open && !choosing && (
        <QuietAction full icon={Search} disabled={busy} onClick={() => setChoosing(true)} label={t(run ? 'p2d_outside_again' : 'p2d_outside_start')} />
      )}
      {!open && choosing && (
        <SearchBudgetOffer productCode="FIND_PROPERTY" expectedUnits={1} running={busy} onRun={(credits) => { void start(credits); }} />
      )}
    </section>
  );
}
