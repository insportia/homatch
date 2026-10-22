// THE EXTERNAL CAMPAIGN, WHILE IT RUNS.
//
// The same contract as Find Property's SearchingView: every number on this
// screen is a real counter from the server (find_buyers_my_campaign), the stage
// list moves only when the lifecycle does (campaignStages), and a progress bar
// is drawn as a fraction only when the server has a real denominator — queued
// search steps — otherwise it is an honest "in progress" shimmer with no figure.
//
// WHAT IS DELIBERATELY ABSENT: how many HOMATCH users exist, how much content
// was read, how many communities were registered, how large any internal pool
// is. Those describe HOMATCH, not the customer's campaign. The only count shown
// is this campaign's own results, once there are any.
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, Circle, Loader2, Pause, Play, Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND } from '@/components/findBuyers/brand';
import { DiscoverySnake } from '@/components/findBuyers/DiscoverySnake';
import { ServiceBadge } from '@/components/matching/ServiceIdentity';
import {
  type StageKey, type StageState, campaignStages, campaignView, networkNodes,
} from '@/findBuyers/campaignView';
import type { CampaignStatus } from '@/services/findBuyers';

const SOFT = 'text-[hsl(218_40%_85%)]';

function elapsedLabel(fromIso: string | null, toIso: string | null, now: number): string | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const to = toIso ? Date.parse(toIso) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const s = Math.round((to - from) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** The animated mark: a radar sweep while work is moving, still otherwise. Reduced motion: always still. */
function SearchOrb({ moving, done }: { moving: boolean; done: boolean }) {
  return (
    <div className="relative grid h-16 w-16 shrink-0 place-items-center sm:h-28 sm:w-28" aria-hidden="true">
      <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-[hsl(40_80%_60%/0.35)]" />
      <span className="absolute inset-[18%] rounded-full ring-1 ring-inset ring-[hsl(40_80%_60%/0.25)]" />
      <span className="absolute inset-[36%] rounded-full ring-1 ring-inset ring-[hsl(40_80%_60%/0.2)]" />
      {moving && (
        <>
          <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,hsl(40_94%_64%/0.55),transparent_28%)] motion-safe:animate-[spin_2.8s_linear_infinite] motion-reduce:hidden" />
          <span className="absolute inset-[10%] rounded-full bg-[hsl(40_94%_64%/0.18)] motion-safe:animate-ping motion-reduce:hidden" />
        </>
      )}
      <span className={cn('relative grid h-9 w-9 place-items-center rounded-full shadow-[0_0_24px_hsl(40_94%_60%/0.55)]', GOLD_FILL)}>
        {done ? <Check className="h-5 w-5 text-[hsl(218_52%_11%)]" /> : <span className="h-2.5 w-2.5 rounded-full bg-[hsl(218_52%_11%)]" />}
      </span>
    </div>
  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'DONE') return <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', GOLD_FILL)}><Check className="h-3.5 w-3.5 text-[hsl(218_52%_11%)]" aria-hidden="true" /></span>;
  if (state === 'ACTIVE') return <Loader2 className="h-6 w-6 shrink-0 text-[hsl(40_94%_64%)] motion-safe:animate-spin" aria-hidden="true" />;
  if (state === 'HALTED') return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-[hsl(40_80%_60%/0.7)]"><Pause className="h-3 w-3 text-[hsl(40_94%_64%)]" aria-hidden="true" /></span>;
  return <Circle className="h-6 w-6 shrink-0 text-white/25" aria-hidden="true" />;
}

export function CampaignProgressPanel({
  status, counterpart, busy, onPause, onResume, onStop,
}: {
  status: CampaignStatus;
  counterpart: 'BUYER' | 'TENANT' | null;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const { t } = useLanguage();
  const c = status.campaign;
  const [open, setOpen] = useState<StageKey | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const view = c ? campaignView({
    state: c.state, sources: c.sources, queue: c.queue, signalsAnalyzed: c.signalsAnalyzed,
    signalsChecked: c.signalsChecked, newResults: c.newResults, strong: c.strong,
  }) : null;
  const stages = useMemo(() => (c ? campaignStages(c) : []), [c]);
  const nodes = useMemo(() => networkNodes(c?.sources, status.readiness?.network), [c?.sources, status.readiness?.network]);
  const live = Boolean(view?.live);
  const moving = view?.motion === 'active';

  /* The clock ticks only while the run is live; it is the run's own elapsed time. */
  useEffect(() => {
    if (!live) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  if (!c || !view) return null;
  const finished = c.queue.done + c.queue.failed;
  const planned = finished + c.queue.queued + c.queue.running;
  const elapsed = elapsedLabel(c.startedAt ?? c.createdAt, c.completedAt, now);
  const tenant = counterpart === 'TENANT';

  const control = (o: { label: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void; primary?: boolean; disabled?: boolean; spinning?: boolean }) => (
    <button type="button" onClick={o.onClick} disabled={busy || o.disabled} aria-busy={o.spinning || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(218_52%_11%)]',
        o.primary
          ? cn(GOLD_FILL, 'text-[hsl(218_52%_11%)] enabled:hover:-translate-y-px')
          : 'bg-white/5 text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.55)] enabled:hover:bg-white/10',
      )}>
      {o.spinning ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <o.icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 break-words text-start">{o.label}</span>
    </button>
  );

  return (
    <section aria-labelledby="cw-progress-title"
      className={cn('relative overflow-hidden rounded-3xl p-5 text-white shadow-[0_24px_60px_-30px_hsl(218_60%_8%/0.95)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] sm:p-7', NAVY_BAND)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_100%_0%,hsl(38_92%_56%/0.16),transparent_60%)]" aria-hidden="true" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            <SearchOrb moving={moving} done={!live && view.tone === 'success'} />
            <div className="min-w-0 space-y-1.5">
              <ServiceBadge service="external" onDark />
              <h2 id="cw-progress-title" className="font-display text-xl font-semibold leading-snug tracking-[-0.01em] break-words sm:text-2xl" aria-live="polite">
                {t(view.headlineKey)}
              </h2>
              <p className={cn('text-2xs', SOFT)}>
                {t(tenant ? 'cw_looking_for_tenants' : 'cw_looking_for_buyers')}
                {elapsed ? <><span aria-hidden="true"> · </span><span className="tabular-nums" dir="ltr">{elapsed}</span></> : null}
              </p>
            </div>
          </div>

          {/* Progress: a real fraction only when the server has planned work; never invented. */}
          <div className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar"
              aria-label={t('cw_progress_label')}
              aria-valuemin={view.progress == null ? undefined : 0}
              aria-valuemax={view.progress == null ? undefined : planned}
              aria-valuenow={view.progress == null ? undefined : finished}>
              {view.progress != null ? (
                <div className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700', GOLD_FILL)} style={{ width: `${Math.round(view.progress * 100)}%` }} />
              ) : live ? (
                <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,transparent,hsl(40_94%_64%),transparent)] motion-safe:animate-[cw-shimmer_1.8s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-40" />
              ) : (
                <div className={cn('h-full w-full rounded-full', view.tone === 'success' ? GOLD_FILL : 'bg-white/25')} />
              )}
            </div>
            <p className={cn('text-2xs', SOFT)}>
              {view.progress != null
                ? t('cw_steps_progress', { done: String(finished), total: String(planned) })
                : live ? t('cw_progress_working') : t('cw_progress_settled')}
            </p>
          </div>

          {/* The stages: each one explains itself when opened. */}
          <ol className="space-y-1.5" aria-label={t('cw_stages_label')}>
            {stages.map((s) => {
              const expanded = open === s.key;
              return (
                <li key={s.key}>
                  <button type="button" onClick={() => setOpen(expanded ? null : s.key)} aria-expanded={expanded}
                    className={cn('flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-start transition-colors',
                      'hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                      s.state === 'ACTIVE' && 'bg-white/[0.06]')}>
                    <StageIcon state={s.state} />
                    <span className={cn('min-w-0 flex-1 break-words text-sm', s.state === 'PENDING' ? 'text-white/55' : 'font-semibold text-white')}>
                      {t(`cw_stage_${s.key}`)}
                    </span>
                    <span className="sr-only">{t(`cw_stage_state_${s.state.toLowerCase()}`)}</span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/50 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <p className={cn('ms-11 me-2 pb-1 text-2xs leading-relaxed', SOFT)}>{t(`cw_stage_${s.key}_detail`)}</p>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap gap-2">
            {view.control === 'pause' && control({ icon: Pause, label: t('fbl_pause'), onClick: onPause })}
            {view.control === 'pausing' && control({ icon: Pause, label: t('fbl_pausing'), disabled: true, spinning: true })}
            {view.control === 'resume' && control({ icon: Play, label: t('fbl_resume'), onClick: onResume, primary: true })}
            {view.canStop && control({ icon: Square, label: t('fbl_stop'), onClick: onStop })}
          </div>
          {view.control === 'pausing' && (
            <p className={cn('rounded-xl bg-white/5 px-3 py-2 text-2xs leading-relaxed ring-1 ring-inset ring-white/10', SOFT)} role="status">{t('fbl_pausing_note')}</p>
          )}
          {c.state === 'FAILED' || c.state === 'UNAVAILABLE' ? (
            <p className="flex items-start gap-2 rounded-xl bg-[hsl(350_60%_50%/0.14)] px-3 py-2 text-2xs leading-relaxed text-[hsl(350_80%_90%)] ring-1 ring-inset ring-[hsl(350_60%_60%/0.35)]" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('cw_failed_note')}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {/* This campaign's own results: the one count that belongs to the customer. */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0 rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-inset ring-white/10">
              <p className={cn('font-display text-3xl font-bold leading-none tabular-nums', c.newResults > 0 ? GOLD_TEXT : 'text-white')}>{c.newResults}</p>
              <p className={cn('mt-1.5 text-2xs leading-snug break-words', SOFT)}>{t('cw_results_found')}</p>
            </div>
            <div className="min-w-0 rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-inset ring-white/10">
              <p className={cn('font-display text-3xl font-bold leading-none tabular-nums', c.strong > 0 ? GOLD_TEXT : 'text-white')}>{c.strong}</p>
              <p className={cn('mt-1.5 text-2xs leading-snug break-words', SOFT)}>{t('cw_strong_found')}</p>
            </div>
          </div>
          {nodes.length > 0 && (
            <div className="min-w-0 rounded-2xl bg-[hsl(218_55%_8%/0.55)] p-2 ring-1 ring-inset ring-white/10" dir="ltr">
              <DiscoverySnake
                sources={nodes}
                motion={view.motion}
                propertyLabel={t('fbl_node_property')}
                homatchLabel="HOMATCH"
                ariaLabel={t('fbl_network_aria', { sources: nodes.map((n) => n.source).join(', ') || '—' })}
              />
              <p className={cn('px-2 pb-1.5 text-center text-2xs', SOFT)} dir="auto">{t('cw_network_caption')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default CampaignProgressPanel;
