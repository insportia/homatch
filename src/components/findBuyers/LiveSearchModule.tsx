// The live Find Buyers / Find Tenants module (owner, 2026-10-16): one simple
// primary view — what the search is doing now, how long it has run, real
// progress, what it has found, and the one control that fits — and ONE
// collapsed "Search details" disclosure for everything technical (metric
// tiles, per-source outcomes, the search profile, the full report).
//
// Every state comes from the server (find_buyers_campaign_status →
// campaignView); the module only renders it. The elapsed clock is computed
// from the server's timestamps (findBuyers/elapsed.ts) — the one-second tick
// re-renders, it never counts — so a refresh shows the same time. The
// animation's motion follows the same state and draws no numbers.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck2, ChevronDown, Loader2, Pause, Play, Radar, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND, sourceStyle } from '@/components/findBuyers/brand';
import { SearchNetworkField } from '@/components/findBuyers/SearchNetworkField';
import { SearchDurationNotice } from '@/components/findBuyers/SearchDurationNotice';
import { CampaignReport } from '@/components/findBuyers/CampaignReport';
import { SearchDna, type DnaFacts } from '@/components/findBuyers/SearchDna';
import { campaignView, currentState, customerNetwork, executionState, networkNodes } from '@/findBuyers/campaignView';
import { elapsedMs, elapsedTicks, formatElapsed } from '@/findBuyers/elapsed';
import { getCampaignState, type CampaignStatus } from '@/services/findBuyers';
import { parseLanguageOutcomes, type LanguageOutcomeRow } from '@/findBuyers/languageOutcomes';

const ON_NAVY_SOFT = 'text-[hsl(218_40%_85%)]';

function Metric({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-inset ring-white/10">
      <p className={cn('font-display text-xl font-bold leading-none tabular-nums', accent ? GOLD_TEXT : 'text-white')}>{value}</p>
      <p className={cn('mt-1 text-2xs leading-snug', ON_NAVY_SOFT)}>{label}</p>
    </div>
  );
}

/** Re-render once a second while `active`; the value shown is always computed from server timestamps. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function Stat({ label, children, testid }: { label: string; children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="min-w-0 rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-inset ring-white/10">
      <dt className={cn('break-words text-2xs leading-snug', ON_NAVY_SOFT)}>{label}</dt>
      <dd className="mt-0.5 font-display text-lg font-semibold leading-tight text-white">{children}</dd>
    </div>
  );
}

/** One compact row per search language, from the campaign's own stats (optional: older campaigns have none). */
function LanguageOutcomes({ jobId, refreshKey }: { jobId: string; refreshKey: string | number | null }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<LanguageOutcomeRow[]>([]);
  useEffect(() => {
    let alive = true;
    getCampaignState(jobId).then((s) => { if (alive) setRows(parseLanguageOutcomes(s?.stats)); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [jobId, refreshKey]);
  if (rows.length === 0) return null;
  return (
    <div data-testid="fbl-language-outcomes">
      <p className={cn('text-2xs font-bold uppercase tracking-[0.12em]', GOLD_TEXT)}>{t('fbl_lang_outcomes_title')}</p>
      <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.language} data-lang={r.language} data-outcome={r.outcome}
            className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-2xs ring-1 ring-inset ring-white/10">
            <span className="shrink-0 font-semibold text-white">{t(`fbx_lang_${r.language}`)}</span>
            <span className={cn('min-w-0 truncate text-end', r.outcome === 'RESULTS' ? GOLD_TEXT : ON_NAVY_SOFT)}>
              {t(`fbl_lang_outcome_${r.outcome}`, { n: String(r.people) })}
            </span>
          </li>
        ))}
      </ul>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  /* Per source, only the sources really working for this search (customerNetwork);
     failed, skipped and switched-off sources stay in the admin views. */
  const nodes = customerNetwork(networkNodes(c?.sources, readiness?.network));
  const ran = nodes.filter((n) => n.executed);
  const lastDate = now.last?.at ? new Date(now.last.at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const tick = useSecondTick(elapsedTicks(c));
  const elapsed = c ? elapsedMs(c, tick) : null;
  const engaged = Boolean(c && view && (live || c.executed));
  /* Real progress only: finished search tasks of the tasks the server planned. */
  const planned = c?.queue?.total ?? 0;
  const finished = c ? (c.queue.done ?? 0) + (c.queue.failed ?? 0) + (c.queue.cancelled ?? 0) : 0;
  const showProgress = Boolean(c && planned > 0);
  const elapsedKey = !c ? 'fbl_elapsed_running' : c.state === 'PAUSED' ? 'fbl_elapsed_paused' : live ? 'fbl_elapsed_running' : 'fbl_elapsed_total';

  const button = (o: { label: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void; primary?: boolean; disabled?: boolean; spinning?: boolean; testid?: string }) => (
    <button
      type="button"
      onClick={o.onClick}
      disabled={busy || o.disabled}
      aria-busy={o.spinning || undefined}
      data-testid={o.testid}
      className={cn(
        'inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-normal rounded-xl px-4 py-2 text-sm font-semibold leading-snug transition-all disabled:cursor-not-allowed disabled:opacity-70 min-[420px]:w-auto',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(218_52%_11%)]',
        o.primary
          ? `${GOLD_FILL} text-[hsl(218_52%_11%)] shadow-[0_10px_24px_-12px_hsl(38_92%_45%/0.9)] enabled:hover:-translate-y-px`
          : 'bg-white/5 text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.55)] enabled:hover:bg-white/10',
      )}
    >
      {o.spinning || (busy && !o.disabled) ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <o.icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 break-words text-center">{o.label}</span>
    </button>
  );

  return (
    <section id={id} aria-labelledby="fbl-title" data-testid="fbl-module" data-state={c?.state ?? 'NONE'}
      className={cn('relative scroll-mt-20 overflow-hidden rounded-2xl p-4 text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] shadow-[0_18px_40px_-24px_hsl(218_60%_8%/0.9)] sm:p-5', NAVY_BAND)}>
      {/* ── status line: what is true now, and the one control that fits ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GOLD_FILL)}>
            <Radar className="h-5 w-5 text-[hsl(218_52%_11%)]" aria-hidden="true" />
          </span>
          <div className="min-w-0" aria-live="polite">
            <p className={cn('text-2xs font-bold uppercase tracking-[0.14em]', GOLD_TEXT)}>{t(tenant ? 'fbl_eyebrow_tenants' : 'fbl_eyebrow_buyers')}</p>
            <h2 id="fbl-title" className="flex items-center gap-2 font-display text-base font-semibold leading-snug sm:text-lg">
              {live && view?.motion === 'active' && (
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[hsl(40_94%_64%)] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[hsl(40_94%_64%)]" />
                </span>
              )}
              <span className="break-words" data-testid="fbl-headline">{t(now.headlineKey)}</span>
            </h2>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 min-[420px]:w-auto min-[420px]:flex-row min-[420px]:flex-wrap">
          {view?.control === 'pause' && button({ icon: Pause, label: t('fbl_pause'), onClick: onPause, testid: 'fbl-pause' })}
          {view?.control === 'pausing' && button({ icon: Pause, label: t('fbl_pausing'), disabled: true, spinning: true })}
          {view?.control === 'resume' && button({ icon: Play, label: t('fbl_resume'), onClick: onResume, primary: true, testid: 'fbl-resume' })}
          {view?.canStop && button({ icon: Square, label: t('fbl_stop'), onClick: onStop, testid: 'fbl-stop' })}
          {!live && button({
            icon: Play, label: launchLabel, onClick: onLaunch, primary: true, disabled: readiness ? !readiness.ready : false, testid: 'fbl-launch',
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

      {/* ── the search, as a picture (decorative) and as three real facts ── */}
      {engaged && c && (
        <>
          <SearchNetworkField state={c.state} seedKey={c.jobId}
            className="relative mt-4 h-36 overflow-hidden rounded-xl bg-[radial-gradient(120%_90%_at_50%_40%,hsl(220_50%_16%)_0%,hsl(218_58%_8%)_100%)] ring-1 ring-inset ring-white/10 sm:h-48" />
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="fbl-primary">
            <Stat label={t(elapsedKey)} testid="fbl-elapsed">
              <span dir="ltr" className="tabular-nums" data-testid="fbl-elapsed-value">{formatElapsed(elapsed)}</span>
            </Stat>
            <Stat label={t('fbl_found_so_far')} testid="fbl-found">
              <span dir="ltr" className={cn('tabular-nums', c.newResults > 0 && GOLD_TEXT)}>{Math.max(0, c.newResults)}</span>
            </Stat>
            {showProgress && (
              <div data-testid="fbl-progress" className="col-span-2 min-w-0 rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-inset ring-white/10 sm:col-span-1">
                <dt className={cn('break-words text-2xs leading-snug', ON_NAVY_SOFT)}>{t('fbl_progress_tasks')}</dt>
                <dd className="mt-0.5 font-display text-lg font-semibold leading-tight text-white">
                  <span dir="ltr" className="tabular-nums" data-testid="fbl-progress-value">{`${Math.min(finished, planned)} / ${planned}`}</span>
                </dd>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div className={cn('h-full rounded-full', GOLD_FILL)} style={{ width: `${Math.round((Math.min(finished, planned) / planned) * 100)}%` }} />
                </div>
                {/* The real stages of the planned tasks (server queue), never invented activity. */}
                <p className={cn('mt-1 break-words text-2xs leading-snug', ON_NAVY_SOFT)} data-testid="fbl-stages" dir="auto">
                  {t('fbrx_stage_line', { running: String(c.queue.running ?? 0), queued: String((c.queue.queued ?? 0) + (c.queue.paused ?? 0)), done: String(Math.min(finished, planned)) })}
                </p>
              </div>
            )}
          </dl>
        </>
      )}
      {live && <SearchDurationNotice className="mt-3" />}
      {now.last && (
        <p className="mt-3 text-2xs font-semibold text-white" data-testid="fbl-last-search">
          {t('fbl_last_search', { state: t(now.last.headlineKey), date: lastDate ?? '—' })}
        </p>
      )}
      {c && !live && (
        <p className={cn('mt-1 text-2xs leading-relaxed', ON_NAVY_SOFT)}>
          {t(c.state === 'UNAVAILABLE' ? 'fbl_last_unavailable_note' : c.state === 'COMPLETED_NO_RESULTS' ? 'fbl_last_zero_note'
            : c.state === 'COMPLETED_WITH_RESULTS' ? 'fbl_last_results_note' : 'fbl_last_other_note', { n: String(c.newResults) })}
        </p>
      )}

      {/* ── SEARCH DETAILS: everything technical, one disclosure, collapsed ── */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <button type="button" data-testid="fbl-details-toggle" aria-expanded={detailsOpen} aria-controls="fbl-details"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-start text-sm font-semibold text-white hover:text-[hsl(40_94%_72%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
          <span>{t('fbl_details_title')}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none', detailsOpen && 'rotate-180', GOLD_TEXT)} aria-hidden="true" />
        </button>
        {detailsOpen && (
          <div id="fbl-details" data-testid="fbl-details" className="mt-2 space-y-4">
            {c && view && engaged && (
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
                  <li key={n.source} data-source={n.source} className="rounded-xl bg-white/[0.04] px-3 py-2 text-2xs leading-relaxed ring-1 ring-inset ring-white/10">
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
            {ran.length === 0 && live && <p className={cn('text-2xs', ON_NAVY_SOFT)} dir="auto">{t('fbl_preparing_note')}</p>}
            {c?.jobId && engaged && <LanguageOutcomes jobId={c.jobId} refreshKey={`${c.state}:${c.newResults}`} />}
            <SearchDna facts={facts} onDark />
            <p className={cn('flex items-center gap-1.5 text-2xs', ON_NAVY_SOFT)}>
              <CalendarCheck2 className={cn('h-3.5 w-3.5 shrink-0', GOLD_TEXT)} aria-hidden="true" />{t('fbx_fresh_rule')}
            </p>
            {/* the search report: live and partial while running, final after */}
            {c?.jobId && engaged && <CampaignReport jobId={c.jobId} live={live} refreshKey={c.lastActivityAt ?? c.state} />}
          </div>
        )}
      </div>
      <span className="sr-only">{propertyLabel}</span>
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
      <span className="line-clamp-2 min-w-0 break-words text-start leading-tight">{label}</span>
    </button>
  );
}

export default LiveSearchModule;
