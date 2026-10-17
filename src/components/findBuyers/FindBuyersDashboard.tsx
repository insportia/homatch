// FIND BUYERS DASHBOARD — one clear journey per property (owner, 2026-10-17; recovery UX).
//
//   ONE primary action   start a search / view live progress / continue a paused one — from
//                        the server's live status, never inferred from stored results;
//   Latest search        the newest finished search (a search with zero results included),
//                        its date, state and its OWN counts, and "Open results" for THAT job;
//   Internal matches     HOMATCH's own members (შიდა დამთხვევები), one "View matches" button;
//   Previous searches    every earlier search, each opening its own results;
//   Clear old results    secondary, owner-scoped, behind an explicit confirmation.
//
// No "free vs paid" labels and no "buyers found" claims: the people are "potentially
// interested people", the posts "research opportunities". Starting only OPENS the budget
// step; nothing is charged until the owner confirms there.
//
// Mobile: actions are full width under 420px (never two long Georgian labels in one row),
// labels wrap to two lines instead of an ellipsis, every touch target is ≥ 44px.

import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Eraser, Globe2, History, Pause, Play, Radar, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import type { CampaignRunState, CampaignSummary } from '@/findBuyers/leadCampaigns';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_10px_28px_-22px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_84%)]';
const ICON = 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)]';
/** Full-width under 420px; a label wraps (two lines) rather than truncating. */
export const DASH_BTN = 'inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded-xl px-4 py-2 text-center text-sm font-semibold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 min-[420px]:w-auto';
const GOLD_BTN = cn(DASH_BTN, 'bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] text-[hsl(218_52%_11%)]');
const NAVY_BTN = cn(DASH_BTN, 'bg-[hsl(218_52%_11%)] text-white');
const LINE_BTN = cn(DASH_BTN, 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)]');
const LABEL = 'min-w-0 break-words';
const H2 = 'min-w-0 flex-1 break-words font-display text-base font-semibold leading-snug text-[hsl(218_45%_14%)] line-clamp-2';
const SOFT = 'text-[hsl(218_28%_38%)]';

const STATE_TONE: Record<CampaignRunState, string> = {
  RUNNING: 'bg-[hsl(218_52%_11%)] text-[hsl(40_94%_70%)] ring-transparent',
  PAUSED: 'bg-[hsl(42_100%_95%)] text-[hsl(34_90%_30%)] ring-[hsl(40_80%_78%)]',
  COMPLETED: 'bg-[hsl(150_45%_95%)] text-[hsl(150_50%_24%)] ring-[hsl(150_35%_80%)]',
  FAILED: 'bg-[hsl(0_70%_97%)] text-[hsl(0_60%_38%)] ring-[hsl(0_60%_86%)]',
  CANCELLED: 'bg-[hsl(218_30%_96%)] text-[hsl(218_28%_34%)] ring-[hsl(218_30%_86%)]',
  UNKNOWN: 'bg-[hsl(218_30%_96%)] text-[hsl(218_28%_34%)] ring-[hsl(218_30%_86%)]',
};

export type PrimaryMode = 'start' | 'start_new' | 'live' | 'resume' | 'blocked';

export function StateChip({ state }: { state: CampaignRunState }) {
  const { t } = useLanguage();
  return (
    <span data-testid="fbd-state" data-state={state}
      className={cn('inline-flex max-w-full shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset', STATE_TONE[state])}>
      <span className="break-words">{t(`fbrx_state_${state}`)}</span>
    </span>
  );
}

export function useCampaignDate() {
  const { lang } = useLanguage();
  return (iso: string | null | undefined) => (iso
    ? new Date(iso).toLocaleString(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—');
}

export interface LatestCounts { people: number; opportunities: number; newPeople: number; foundAgain: number }

export function FindBuyersDashboard({
  primary, foundSoFar, onStart, liveHref,
  campaigns, featured, latestCounts, campaignsFailed, resultsHref, allPeople,
  internalCount, internalHref, onOpenInternal,
  canClear, onClear,
}: {
  primary: PrimaryMode;
  /** The live search's results so far (server status). */
  foundSoFar: number;
  /** Opens the budget step (no charge until confirmed there). */
  onStart: () => void;
  liveHref: string;
  /** Every search, newest first; null while loading. */
  campaigns: CampaignSummary[] | null;
  featured: CampaignSummary | null;
  /** The featured search's listable counts; null while its leads load. */
  latestCounts: LatestCounts | null;
  campaignsFailed: boolean;
  resultsHref: (jobId: string) => string;
  allPeople: number | null;
  /** HOMATCH members matched to this property; null while loading. */
  internalCount: number | null;
  internalHref: string;
  onOpenInternal?: () => void;
  canClear: boolean;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  const fmt = useCampaignDate();
  const previous = (campaigns ?? []).filter((c) => c.jobId !== featured?.jobId);

  const primaryLabel = { start: 'fbrx_primary_start', start_new: 'fbrx_primary_start_new', live: 'fbrx_primary_live', resume: 'fbrx_primary_resume', blocked: 'fbrx_primary_start_new' }[primary];
  const PrimaryIcon = primary === 'live' ? Radar : primary === 'resume' ? Play : Sparkles;

  return (
    <section aria-label={t('fbd_label')} data-testid="fb-dashboard" className="space-y-3">
      {/* ── ONE primary action, from the server's live status ── */}
      <div data-testid="fbd-primary" data-mode={primary}
        className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-[hsl(218_52%_11%)] p-4 text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-start gap-2 text-sm leading-relaxed text-[hsl(218_40%_88%)]" role={primary === 'live' || primary === 'resume' ? 'status' : undefined}>
          {primary === 'live' ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(40_94%_60%)] motion-safe:animate-pulse" aria-hidden="true" />
            : primary === 'resume' ? <Pause className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(40_94%_64%)]" aria-hidden="true" />
              : primary === 'blocked' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(350_80%_80%)]" aria-hidden="true" />
                : <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(40_94%_64%)]" aria-hidden="true" />}
          <span className="min-w-0 break-words" data-testid="fbd-primary-note">
            {primary === 'live' ? t('fbrx_primary_live_note', { n: String(Math.max(0, foundSoFar)) })
              : primary === 'resume' ? t('fbrx_primary_paused_note')
                : primary === 'blocked' ? t('fbl_not_ready') : t('fbrx_primary_start_note')}
          </span>
        </p>
        {primary === 'live' || primary === 'resume' ? (
          <Link to={liveHref} data-testid="fbd-primary-action" className={cn(GOLD_BTN, 'shrink-0 sm:max-w-[18rem]')}>
            <PrimaryIcon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={LABEL}>{t(primaryLabel)}</span>
          </Link>
        ) : (
          <button type="button" data-testid="fbd-primary-action" onClick={onStart} disabled={primary === 'blocked'} className={cn(GOLD_BTN, 'shrink-0 sm:max-w-[18rem]')}>
            <PrimaryIcon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={LABEL}>{t(primaryLabel)}</span>
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* ── Latest search: extended research, its own counts ── */}
        <article className={CARD} data-testid="fbd-latest" data-job={featured?.jobId ?? ''} data-state={featured?.state ?? 'NONE'}>
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={ICON}><Globe2 className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('fbd_external_title')}</p>
              <h2 className={H2}>{t('fbrx_latest_title')}</h2>
            </div>
            {featured ? <StateChip state={featured.state} /> : null}
          </div>
          {campaignsFailed ? (
            <p role="alert" className="text-sm text-[hsl(0_60%_38%)]">{t('fbx_results_failed')}</p>
          ) : campaigns === null ? (
            <div className="h-24 rounded-xl bg-[hsl(40_33%_96%)] motion-safe:animate-pulse" data-testid="fbd-latest-loading" />
          ) : !featured ? (
            <p data-testid="fbd-latest-none" className={cn('text-sm', SOFT)}>{t('fbrx_latest_none')}</p>
          ) : (
            <>
              <p className={cn('text-xs', SOFT)} data-testid="fbd-latest-date"><span dir="auto">{fmt(featured.createdAt)}</span></p>
              <dl className="grid grid-cols-2 gap-1.5" data-testid="fbd-latest-counts">
                {([
                  ['people', 'fbrx_stat_people', latestCounts?.people],
                  ['opportunities', 'fbx_tab3_opportunities', latestCounts?.opportunities],
                  ['new', 'fbrx_stat_new', latestCounts?.newPeople],
                  ['again', 'fbrx_stat_again', latestCounts?.foundAgain],
                ] as const).map(([k, label, n]) => (
                  <div key={k} className="min-w-0 rounded-xl bg-[hsl(40_33%_98%)] px-2 py-2 text-center ring-1 ring-inset ring-[hsl(40_30%_90%)]">
                    <dd className="font-display text-xl font-semibold tabular-nums text-[hsl(218_45%_14%)]" dir="ltr" data-testid={`fbd-latest-${k}`}>{n ?? '—'}</dd>
                    <dt className={cn('break-words text-2xs leading-snug', SOFT)}>{t(label)}</dt>
                  </div>
                ))}
              </dl>
              {latestCounts && latestCounts.people === 0 && latestCounts.opportunities === 0 && featured.state === 'COMPLETED' && (
                <p className={cn('text-2xs', SOFT)} data-testid="fbd-latest-zero">{t('fbrx_zero_note')}</p>
              )}
              {featured.state === 'FAILED' && <p className="text-2xs text-[hsl(0_60%_38%)]" data-testid="fbd-latest-failed">{t('fbrx_failed_note')}</p>}
              <Link to={resultsHref(featured.jobId)} data-testid="fbd-latest-open" className={cn(NAVY_BTN, 'mt-auto')}>
                <span className={LABEL}>{t('fbrx_open_results')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </>
          )}
        </article>

        {/* ── Internal matches: HOMATCH's own members ── */}
        <article className={CARD} data-testid="fbd-internal">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={ICON}><Users className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h2 className={H2}>{t('fbd_internal_title')}</h2>
              <p className={cn('break-words text-xs', SOFT)}>{t('fbrx_internal_desc')}</p>
            </div>
          </div>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[hsl(218_45%_14%)]">
            <span className="font-display text-3xl font-semibold tabular-nums" dir="ltr" data-testid="fbd-internal-count">{internalCount ?? '—'}</span>
            <span className={cn('min-w-0 break-words text-sm', SOFT)}>{t('fbd_internal_count_buyers')}</span>
          </p>
          <Link to={internalHref} onClick={onOpenInternal} className={cn(LINE_BTN, 'mt-auto')} data-testid="fbd-internal-view">
            <span className={LABEL}>{t('fbd_internal_view')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </article>
      </div>

      {/* ── Previous searches: each opens its own results ── */}
      {previous.length > 0 && (
        <section aria-labelledby="fbd-previous-title" data-testid="fbd-previous">
          <h2 id="fbd-previous-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[hsl(218_45%_14%)]">
            <History className="h-4 w-4 shrink-0 text-[hsl(34_90%_40%)]" aria-hidden="true" /><span className="break-words">{t('fbrx_previous_title')}</span>
          </h2>
          <ul className="divide-y divide-[hsl(40_30%_90%)] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[hsl(40_50%_86%)]">
            {previous.slice(0, 10).map((c) => (
              <li key={c.jobId}>
                <Link to={resultsHref(c.jobId)} data-testid="fbd-previous-item" data-job={c.jobId}
                  className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_50%)]">
                  <span className="min-w-0 flex-1 break-words font-medium text-[hsl(218_45%_14%)]" dir="auto">{fmt(c.createdAt)}</span>
                  <StateChip state={c.state} />
                  <span className={cn('shrink-0 text-2xs', SOFT)}>{t('fbrx_previous_people', { n: String(c.total) })}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(218_28%_50%)] rtl:rotate-180" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {allPeople != null && (campaigns?.length ?? 0) > 1 && (
            <p className={cn('mt-1.5 text-2xs', SOFT)} data-testid="fbd-all-people">{t('fbrx_all_people', { n: String(allPeople) })}</p>
          )}
        </section>
      )}

      {/* ── Clear old results: secondary, explicit confirmation ── */}
      {canClear && (
        <div className="flex justify-end">
          <button type="button" onClick={onClear} data-testid="fbd-clear-open"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[hsl(218_28%_34%)] hover:bg-white hover:text-[hsl(218_45%_14%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
            <Eraser className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={LABEL}>{t('fbrx_clear_open')}</span>
          </button>
        </div>
      )}
    </section>
  );
}

export default FindBuyersDashboard;
