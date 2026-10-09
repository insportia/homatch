// The live Find Buyers / Find Tenants module: one place that says whether a
// search is running, paused or finished, where it is searching right now and
// how much real work has happened. Every state comes from the server
// (find_buyers_campaign_status → campaignView); the module only renders it.
import React from 'react';
import { AlertTriangle, CalendarCheck2, Loader2, Pause, Play, Radar, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND, sourceStyle } from '@/components/findBuyers/brand';
import { DiscoverySnake } from '@/components/findBuyers/DiscoverySnake';
import { CampaignReport } from '@/components/findBuyers/CampaignReport';
import { SearchDna, type DnaFacts } from '@/components/findBuyers/SearchDna';
import { campaignView, currentState, executionState, networkNodes, searchScope } from '@/findBuyers/campaignView';
import type { CampaignStatus } from '@/services/findBuyers';

const ON_NAVY_SOFT = 'text-[hsl(218_40%_85%)]';

function Metric({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-inset ring-white/10">
      <p className={cn('font-display text-xl font-bold leading-none tabular-nums', accent ? GOLD_TEXT : 'text-white')}>{value}</p>
      <p className={cn('mt-1 text-2xs leading-snug', ON_NAVY_SOFT)}>{label}</p>
    </div>
  );
}

export function LiveSearchModule({
  status, facts, counterpart, propertyLabel, busy, launchLabel, onLaunch, onPause, onResume, onStop, id,
}: {
  status: CampaignStatus | null;
  facts: DnaFacts | null;
  counterpart: 'BUYER' | 'TENANT' | null;
  propertyLabel: string;
  busy: boolean;
  launchLabel: string;
  onLaunch: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  id?: string;
}) {
  const { t, lang } = useLanguage();
  const c = status?.campaign ?? null;
  const view = c ? campaignView({
    state: c.state, sources: c.sources, queue: c.queue, signalsAnalyzed: c.signalsAnalyzed, signalsChecked: c.signalsChecked,
    newResults: c.newResults, strong: c.strong,
  }) : null;
  const live = Boolean(view?.live);
  const readiness = status?.readiness ?? null;
  const tenant = counterpart === 'TENANT';
  /* The headline is what is true NOW; a past attempt is its own dated line. */
  const now = currentState(c, readiness);
  /* The whole discovery network, from the server: what ran, what could, what is off. */
  const nodes = networkNodes(c?.sources, readiness?.network);
  const showNetwork = nodes.length > 0;
  const ran = nodes.filter((n) => n.executed);
  /* What actually happened in THIS search: per-source state, and whether only
     one source ran or the social planner never queued anything. */
  const scope = c ? searchScope(nodes, c.socialPlan ?? null) : null;
  const blockedSocial = c ? nodes.filter((n) => !n.executed && executionState(n, c.socialPlan ?? null) === 'BLOCKED') : [];
  const reasonKey = (r: string | null) => r === 'SOCIAL_DISABLED' ? 'fbl_reason_social_off' : r === 'NO_ACTOR_READY' ? 'fbl_reason_no_actor'
    : r === 'NO_JOBS' ? 'fbl_reason_no_jobs' : 'fbl_reason_planner_error';
  const lastDate = now.last?.at ? new Date(now.last.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : null;

  const button = (o: { label: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void; primary?: boolean; disabled?: boolean; spinning?: boolean }) => (
    <button
      type="button"
      onClick={o.onClick}
      disabled={busy || o.disabled}
      aria-busy={o.spinning || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(218_52%_11%)]',
        o.primary
          ? `${GOLD_FILL} text-[hsl(218_52%_11%)] shadow-[0_10px_24px_-12px_hsl(38_92%_45%/0.9)] enabled:hover:-translate-y-px`
          : 'bg-white/5 text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.55)] enabled:hover:bg-white/10',
      )}
    >
      {o.spinning || (busy && !o.disabled) ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <o.icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="break-words text-start">{o.label}</span>
    </button>
  );

  return (
    <section id={id} aria-labelledby="fbl-title" aria-live="polite"
      className={cn('relative overflow-hidden rounded-2xl p-4 text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] shadow-[0_18px_40px_-24px_hsl(218_60%_8%/0.9)] sm:p-5', NAVY_BAND)}>
      {/* ── status line ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GOLD_FILL)}>
            <Radar className="h-5 w-5 text-[hsl(218_52%_11%)]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className={cn('text-2xs font-bold uppercase tracking-[0.14em]', GOLD_TEXT)}>{t(tenant ? 'fbl_eyebrow_tenants' : 'fbl_eyebrow_buyers')}</p>
            <h2 id="fbl-title" className="flex items-center gap-2 font-display text-base font-semibold leading-snug sm:text-lg">
              {live && view?.motion === 'active' && (
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(40_94%_64%)] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[hsl(40_94%_64%)]" />
                </span>
              )}
              <span className="break-words">{t(now.headlineKey)}</span>
            </h2>
          </div>
        </div>
        {/* ── the one control that matches the state ── */}
        <div className="flex flex-wrap gap-2">
          {view?.control === 'pause' && button({ icon: Pause, label: t('fbl_pause'), onClick: onPause })}
          {view?.control === 'pausing' && button({ icon: Pause, label: t('fbl_pausing'), disabled: true, spinning: true })}
          {view?.control === 'resume' && button({ icon: Play, label: t('fbl_resume'), onClick: onResume, primary: true })}
          {view?.canStop && button({ icon: Square, label: t('fbl_stop'), onClick: onStop })}
          {!live && button({
            icon: Play, label: launchLabel, onClick: onLaunch, primary: true, disabled: readiness ? !readiness.ready : false,
          })}
        </div>
      </div>

      {view?.control === 'pausing' && (
        <p className={cn('mt-3 rounded-xl bg-white/5 px-3 py-2 text-2xs leading-relaxed ring-1 ring-inset ring-white/10', ON_NAVY_SOFT)} role="status">
          {t('fbl_pausing_note')}
        </p>
      )}
      {!live && readiness && !readiness.ready && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-[hsl(350_60%_50%/0.12)] px-3 py-2 text-2xs leading-relaxed text-[hsl(350_80%_88%)] ring-1 ring-inset ring-[hsl(350_60%_60%/0.35)]" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('fbl_not_ready')}</span>
        </p>
      )}

      <div className={cn('mt-4 grid gap-4', showNetwork && 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]')}>
        {showNetwork && (
          <div className="min-w-0 rounded-xl bg-[hsl(218_55%_8%/0.55)] p-2 ring-1 ring-inset ring-white/10" dir="ltr">
            <DiscoverySnake
              sources={nodes}
              motion={view?.motion ?? 'still'}
              propertyLabel={t('fbl_node_property')}
              homatchLabel="HOMATCH"
              ariaLabel={t('fbl_network_aria', { sources: nodes.map((n) => n.source).join(', ') || '—' })}
            />
            {ran.length === 0 && live && (
              <p className={cn('px-2 pb-2 text-center text-2xs', ON_NAVY_SOFT)} dir="auto">{t('fbl_preparing_note')}</p>
            )}
            <p className={cn('flex flex-wrap justify-center gap-x-3 gap-y-1 px-2 pb-1.5 text-2xs', ON_NAVY_SOFT)} data-testid="fbl-network-legend">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(40_94%_64%)]" aria-hidden="true" />{t('fbl_net_searched')}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-[hsl(40_60%_70%/0.7)]" aria-hidden="true" />{t('fbl_net_available')}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-dashed border-[hsl(218_25%_70%/0.7)]" aria-hidden="true" />{t('fbl_net_off')}</span>
            </p>
          </div>
        )}
        <div className="min-w-0 space-y-4">
          {c && view && (live || c.executed) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric value={view.metrics.sourcesWorking} label={t('fbl_m_working')} accent={view.metrics.sourcesWorking > 0} />
              <Metric value={view.metrics.sourcesDone} label={t('fbl_m_done')} />
              <Metric value={view.metrics.signals} label={t('fbl_m_checked')} />
              <Metric value={view.metrics.possible} label={t('fbl_m_qualified')} accent={view.metrics.possible > 0} />
              <Metric value={view.metrics.strong} label={t('fbl_m_strong')} accent={view.metrics.strong > 0} />
              <Metric value={c.staleSkipped} label={t('fbl_m_stale')} />
            </div>
          )}
          {/* Per source, in words: what was READ is never what was FOUND. */}
          {ran.length > 0 && (
            <ul className="space-y-1.5" data-testid="fbl-source-outcomes">
              {ran.map((n) => (
                <li key={n.source} className="rounded-xl bg-white/[0.04] px-3 py-2 text-2xs leading-relaxed ring-1 ring-inset ring-white/10">
                  <span className="font-semibold text-white">{sourceStyle(n.source).label}</span>
                  <span className="ms-1.5 rounded-full bg-white/10 px-1.5 py-px text-[0.65rem] font-semibold uppercase tracking-wide text-white/80" data-testid="fbl-exec-state" data-state={executionState(n, c?.socialPlan ?? null)}>
                    {t(`fbl_exec_${executionState(n, c?.socialPlan ?? null).toLowerCase()}` as never)}
                  </span>
                  <span className={ON_NAVY_SOFT}>
                    {' · '}{t('fbl_src_checked', { n: String(n.checked) })}
                    {n.communities > 0 ? <>{' · '}{t('fbl_src_communities', { n: String(n.communities) })}</> : null}
                    {' · '}<span className={n.qualified > 0 ? GOLD_TEXT : undefined}>{t('fbl_src_qualified', { n: String(n.qualified) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {scope && !live && c?.executed && scope.onlySource && (
            <p className="text-2xs font-semibold text-white" data-testid="fbl-scope-only">
              {t('fbl_scope_only', { source: sourceStyle(scope.onlySource).label })}
            </p>
          )}
          {scope?.socialBlocked && (
            <p className={cn('text-2xs leading-relaxed', ON_NAVY_SOFT)} data-testid="fbl-scope-social-blocked">
              {t('fbl_scope_social_blocked', { reason: t(reasonKey(scope.socialReason) as never) })}
              {blockedSocial.length > 0 ? <>{' — '}{blockedSocial.map((n) => sourceStyle(n.source).label).join(', ')}</> : null}
            </p>
          )}
          {now.last && (
            <p className="text-2xs font-semibold text-white" data-testid="fbl-last-search">
              {t('fbl_last_search', { state: t(now.last.headlineKey), date: lastDate ?? '—' })}
            </p>
          )}
          {c && !live && (
            <p className={cn('text-2xs leading-relaxed', ON_NAVY_SOFT)}>
              {t(c.state === 'UNAVAILABLE' ? 'fbl_last_unavailable_note' : c.state === 'COMPLETED_NO_RESULTS' ? 'fbl_last_zero_note'
                : c.state === 'COMPLETED_WITH_RESULTS' ? 'fbl_last_results_note' : 'fbl_last_other_note', { n: String(c.newResults) })}
            </p>
          )}
          <SearchDna facts={facts} onDark />
          <p className={cn('flex items-center gap-1.5 text-2xs', ON_NAVY_SOFT)}>
            <CalendarCheck2 className={cn('h-3.5 w-3.5 shrink-0', GOLD_TEXT)} aria-hidden="true" />{t('fbx_fresh_rule')}
          </p>
          <span className="sr-only">{propertyLabel}</span>
        </div>
      </div>

      {/* ── the search report: live and partial while running, final after ── */}
      {c?.jobId && (live || c.executed) && (
        <CampaignReport jobId={c.jobId} live={live} refreshKey={c.lastActivityAt ?? c.state} />
      )}
    </section>
  );
}

/** A compact, persistent status entry while the module is scrolled away. */
export function SearchStatusPill({ status, counterpart, onOpen }: {
  status: CampaignStatus | null; counterpart: 'BUYER' | 'TENANT' | null; onOpen: () => void;
}) {
  const { t } = useLanguage();
  const c = status?.campaign;
  if (!c || !c.active) return null;
  const paused = c.state === 'PAUSED';
  const label = paused ? t('fbl_pill_paused')
    : c.newResults > 0 ? t('fbl_pill_results', { n: String(c.newResults) })
    : t(counterpart === 'TENANT' ? 'fbl_pill_running_tenants' : 'fbl_pill_running_buyers');
  return (
    <button type="button" onClick={onOpen}
      className={cn('fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] start-4 z-40 inline-flex min-h-11 max-w-[calc(100vw-6rem)] items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-[0_14px_30px_-12px_hsl(218_60%_8%/0.9)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.45)] md:bottom-6', NAVY_BAND)}>
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        {!paused && <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(40_94%_64%)] opacity-70 motion-safe:animate-ping" />}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[hsl(40_94%_64%)]" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default LiveSearchModule;
