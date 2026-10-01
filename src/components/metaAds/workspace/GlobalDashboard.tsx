// META ADS — global dashboard. Real numbers only, straight from
// metaDashboard(): status counts that are also the status filters, one
// summary card PER CURRENCY (money is never added across currencies), and
// every campaign as one tappable card.
//
// Status is the CANONICAL status (src/lib/metaAds/uiStatus.ts): "Active"
// counts only what Meta is running, so a campaign Meta reports as paused is
// counted — and filtered, and labelled — as Paused. The counts are derived
// from the same rows the list shows, so a number and its list cannot disagree.
//
// Empty metrics say what they are: a real 0 is "0"; a ratio without a
// denominator is "no results yet"; a metric that does not apply to the
// objective is not shown; never a screen of dashes.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BarChart3, ChevronRight, CirclePause, Clock, Layers, Lightbulb, PlayCircle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyState } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EDITABLE_STATUSES, metaDashboard, moneyIn, type DashboardData, type DashboardRow } from '@/services/metaAds';
import { matchesKpi, needsAttention, statusCounts, statusFromMeta, uiStatus, type KpiFilter } from '@/lib/metaAds/uiStatus';
import { CampaignStatusChip } from './CampaignStatusChip';
import { DashboardFilters, EMPTY_FILTERS, type DashboardFilterValue } from './DashboardFilters';
import { ago, count, dateTime, newest, pct } from './format';

type Summary = DashboardData['summary'][number];
const KPI_FILTERS: KpiFilter[] = ['all', 'active', 'paused', 'attention'];
const isKpi = (v: string | null): v is KpiFilter => !!v && (KPI_FILTERS as string[]).includes(v);
const LIST_TITLE: Record<KpiFilter, string> = { all: 'mm_w_campaigns_title', active: 'mm_w_list_active', paused: 'mm_w_list_paused', attention: 'mm_w_list_attention' };
const LIST_EMPTY: Record<KpiFilter, string> = { all: 'mm_w_empty_all', active: 'mm_w_empty_active', paused: 'mm_w_empty_paused', attention: 'mm_w_empty_attention' };

/** The canonical status input of a dashboard row. */
const statusOf = (r: DashboardRow) => ({
  status: r.status, external_status: r.external_status, guard_state: r.guard_state,
  last_error_key: (r as DashboardRow & { last_error_key?: string | null }).last_error_key ?? r.last_error?.key ?? null,
  launched_at: r.launched_at ?? null, attention: r.attention,
});

export function GlobalDashboard({ goals }: { goals?: string[] }) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const view: KpiFilter = isKpi(params.get('view')) ? (params.get('view') as KpiFilter) : 'all';
  const setView = (next: KpiFilter) => setParams((prev) => {
    if (next === 'all') prev.delete('view'); else prev.set('view', next);
    return prev;
  }, { replace: true });

  const [filters, setFilters] = useState<DashboardFilterValue>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Currencies seen so far, so choosing one never hides the others' option.
  const [seenCurrencies, setSeenCurrencies] = useState<string[]>([]);

  const load = useCallback(async (f: DashboardFilterValue) => {
    setLoading(true); setFailed(false);
    try {
      const d = await metaDashboard({
        goal: f.goal || undefined, currency: f.currency || undefined,
        from: f.from || undefined, to: f.to || undefined,
      });
      setData(d);
      const found = [...d.summary.map(s => s.currency), ...d.campaigns.map(c => c.currency), ...(d.serviceBalance ?? []).map(b => b.currency)]
        .filter((c): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c));
      setSeenCurrencies(prev => Array.from(new Set([...prev, ...found])).sort());
    } catch {
      setFailed(true);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(filters); }, [filters, load]);

  const freshest = useMemo(() => newest((data?.campaigns ?? []).map(c =>
    (c as DashboardRow & { insights_synced_at?: string | null }).insights_synced_at ?? c.last_synced_at ?? null)), [data]);
  // Counted from the rows on screen with the canonical status — the same rule the list filters by.
  const counts = useMemo(() => statusCounts((data?.campaigns ?? []).map(statusOf)), [data]);
  const shown = useMemo(() => (data?.campaigns ?? []).filter((r) => matchesKpi(statusOf(r), view)), [data, view]);
  const filtersOn = Object.values(filters).some(Boolean);

  return (
    <section className="space-y-3" aria-labelledby="mm-w-dash-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mm-w-dash-title" className="text-base font-semibold text-foreground">{t('mm_w_dash_title')}</h2>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className={cn('h-10 gap-1.5', filtersOn && 'text-[hsl(var(--gold-ink))]')}
            aria-expanded={showFilters} aria-controls="mm-w-filters" onClick={() => setShowFilters(v => !v)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span>{t('mm_w_filters_toggle')}</span>
            {filtersOn && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--gold))]" aria-hidden="true" />}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={() => void load(filters)} disabled={loading}
            aria-label={t('mm_w_retry')}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {showFilters && <div id="mm-w-filters"><DashboardFilters value={filters} onChange={setFilters} currencies={seenCurrencies} goals={goals} /></div>}

      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          <span className="flex-1">{t('mm_w_dash_failed')}</span>
          <Button size="sm" variant="outline" onClick={() => void load(filters)}>{t('mm_w_retry')}</Button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : data ? (
        <>
          {/* The counts ARE the status filters: tap one, the list below shows exactly those. */}
          <div role="group" aria-label={t('mm_w_kpi_group')} className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-mm-kpis="">
            <KpiControl filter="all" value={counts.total} label={t('mm_w_kpi_f_all')} icon={Layers} selected={view === 'all'} onSelect={setView} />
            <KpiControl filter="active" value={counts.active} label={t('mm_w_kpi_f_active')} icon={PlayCircle} tone="success" selected={view === 'active'} onSelect={setView} />
            <KpiControl filter="paused" value={counts.paused} label={t('mm_w_kpi_f_paused')} icon={CirclePause} tone="warning" selected={view === 'paused'} onSelect={setView} />
            <KpiControl filter="attention" value={counts.attention} label={t('mm_w_kpi_f_attention')} icon={AlertTriangle} tone={counts.attention > 0 ? 'warning' : undefined} selected={view === 'attention'} onSelect={setView} />
          </div>

          {data.summary.length === 0 ? (
            <EmptyState icon={BarChart3} title={t('mm_w_summary_empty_title')} body={t('mm_w_summary_empty_body')} />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {data.summary.map(s => <CurrencySummaryCard key={s.currency} s={s} />)}
              </div>
              {data.summary.length > 1 && <p className="text-[13px] text-muted-foreground">{t('mm_w_summary_note')}</p>}
            </>
          )}

          <CampaignList rows={shown} all={data.campaigns.length} view={view} onShowAll={() => setView('all')} />

          <p className="text-[13px] text-muted-foreground">
            {freshest ? t('mm_w_freshness', { time: dateTime(freshest, lang) }) : t('mm_w_freshness_never')}
          </p>
        </>
      ) : null}
    </section>
  );
}

/* ── KPI controls ──────────────────────────────────────────────────────── */

function KpiControl({ filter, value, label, icon: Icon, tone, selected, onSelect }: {
  filter: KpiFilter; value: number; label: string; icon: typeof Layers; tone?: 'success' | 'warning';
  selected: boolean; onSelect: (f: KpiFilter) => void;
}) {
  const { lang } = useLanguage();
  const cue = tone === 'success' ? 'text-[hsl(var(--success))]' : tone === 'warning' ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground';
  return (
    <button type="button" aria-pressed={selected} data-mm-kpi={filter} data-mm-kpi-value={value}
      onClick={() => onSelect(selected && filter !== 'all' ? 'all' : filter)}
      className={cn(
        'group relative flex min-h-[3.75rem] min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-[background-color,border-color,box-shadow,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:scale-[0.98] motion-reduce:active:scale-100',
        selected
          ? 'border-[hsl(var(--gold))] bg-[#0C1119] text-white shadow-hover'
          : 'border-border bg-card text-foreground shadow-card hover:border-[hsl(var(--gold-border))] hover:shadow-hover',
      )}>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        selected ? 'bg-white/10 text-[hsl(var(--gold))]' : cn('bg-[hsl(var(--background))]', cue))} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className={cn('block font-display text-xl font-bold leading-none tabular-nums', selected ? 'text-[hsl(var(--gold))]' : 'text-foreground')}>
          {count(value, lang)}
        </span>
        <span className={cn('mt-1 block text-2xs font-medium leading-tight', selected ? 'text-white/80' : 'text-muted-foreground')}>{label}</span>
      </span>
      {selected && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[hsl(var(--gold))]" aria-hidden="true" />}
    </button>
  );
}

/* ── Results per currency ──────────────────────────────────────────────── */

/** One currency, one card. Every money figure uses THIS card's currency. */
function CurrencySummaryCard({ s }: { s: Summary }) {
  const { t, lang } = useLanguage();
  const cur = s.currency;
  const k = s.kpis;
  const spent = s.totals.spendMinor > 0;
  // A ratio without a denominator is "not enough data yet" (null here), not a dash.
  const primary: Array<[string, string | null, string]> = [
    [t('mm_w_kpi_spend'), moneyIn(s.totals.spendMinor, cur, lang), ''],
    [t('mm_w_kpi_results'), count(k.results, lang), ''],
    // Cost per result has no meaning before anything was spent: not shown, explained below.
    ...(spent ? [[t('mm_w_kpi_cpr'), k.costPerResultMinor != null ? moneyIn(k.costPerResultMinor, cur, lang) : null,
      t('mm_w_metric_no_results')] as [string, string | null, string]] : []),
  ];
  const leadMetrics: Array<[string, string | null]> = [
    [t('mm_w_kpi_leads'), count(s.leads, lang)],
    [t('mm_w_kpi_cpl'), k.cplMinor != null ? moneyIn(k.cplMinor, cur, lang) : null],
    [t('mm_w_kpi_cpql'), k.cpqlMinor != null ? moneyIn(k.cpqlMinor, cur, lang) : null],
    [t('mm_w_kpi_qual_rate'), k.qualificationRate != null ? pct(k.qualificationRate, lang) : null],
    [t('mm_w_kpi_cost_viewing'), k.costPerViewingMinor != null ? moneyIn(k.costPerViewingMinor, cur, lang) : null],
  ];
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-card" aria-label={t('mm_w_summary_title', { currency: cur })} data-mm-summary={cur}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('mm_w_summary_title', { currency: cur })}
        </h3>
        <span className="text-2xs text-muted-foreground">{t('mm_w_summary_campaigns', { count: s.campaigns })}</span>
      </div>
      <dl className={cn('mt-3 grid gap-3 border-b border-border pb-3', spent ? 'grid-cols-3' : 'grid-cols-2')}>
        {primary.map(([label, value, empty]) => (
          <div key={label} className="min-w-0">
            <dt className="text-2xs leading-snug text-muted-foreground">{label}</dt>
            {value != null
              ? <dd className="mt-0.5 break-words font-display text-lg font-bold tabular-nums text-foreground" dir="ltr">{value}</dd>
              : <dd className="mt-1 text-2xs leading-snug text-muted-foreground" data-mm-metric-empty="">{empty}</dd>}
          </div>
        ))}
      </dl>
      {!spent && <p className="mt-2.5 text-2xs leading-relaxed text-muted-foreground" data-mm-metric-empty="">{t('mm_w_metric_no_spend_yet')}</p>}
      {s.leads > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {leadMetrics.filter(([, v]) => v != null).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-2xs leading-snug text-muted-foreground">{label}</dt>
              <dd className="break-words font-semibold tabular-nums text-foreground" dir="ltr">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2.5 text-2xs leading-relaxed text-muted-foreground">{t('mm_w_metric_leads_later')}</p>
      )}
    </article>
  );
}

/* ── Campaigns ─────────────────────────────────────────────────────────── */

function Signals({ row }: { row: DashboardRow }) {
  const { t } = useLanguage();
  const u = uiStatus(statusOf(row));
  // The one most useful line, never a wall of badges.
  const warning = u === 'ACCESS_LOST' ? 'mm_w_warn_access' : u === 'LOCKED' ? 'mm_w_warn_locked' : u === 'FAILED' ? 'mm_w_warn_failed'
    : row.status === 'REJECTED' ? 'mm_w_warn_rejected' : row.status === 'NEEDS_CHANGES' ? 'mm_w_warn_changes'
      : row.status === 'PAYMENT_REQUIRED' ? 'mm_w_warn_payment' : row.status === 'PREFLIGHT_REQUIRED' ? 'mm_w_warn_recheck'
        : needsAttention(statusOf(row)) ? 'mm_w_badge_attention' : null;
  if (u === 'HOMATCH_REVIEW') {
    // Held for a person at HOMATCH: nothing for the customer to do, and nothing is published or charged.
    return (
      <p className="flex items-start gap-1.5 text-2xs font-medium leading-snug text-[hsl(var(--gold-ink))]" data-mm-review-note="">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('mm_w_note_homatch_review')}
      </p>
    );
  }
  if (warning) {
    return (
      <p className="flex items-start gap-1.5 text-2xs font-medium leading-snug text-[hsl(var(--warning))]" data-mm-warning="">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(warning)}
      </p>
    );
  }
  if (row.openRecommendations > 0) {
    return (
      <p className="flex items-center gap-1.5 text-2xs font-medium text-[hsl(var(--gold-ink))]">
        <Lightbulb className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('mm_w_badge_recs', { count: row.openRecommendations })}
      </p>
    );
  }
  return null;
}

function CampaignList({ rows, all, view, onShowAll }: { rows: DashboardRow[]; all: number; view: KpiFilter; onShowAll: () => void }) {
  const { t, lang } = useLanguage();
  if (all === 0) {
    return <EmptyState icon={BarChart3} title={t('mm_w_campaigns_empty_title')} body={t('mm_w_campaigns_empty_body')} />;
  }
  const name = (r: DashboardRow) => r.name || t(`mads_goal_${r.goal.toLowerCase()}`);
  // Drafts open in the builder; anything at Meta opens its campaign page.
  const href = (r: DashboardRow) => (EDITABLE_STATUSES.includes(r.status) && !r.launched_at
    ? `/outreach/meta/create?draft=${r.id}&step=review` : `/outreach/meta/campaigns/${r.id}`);
  return (
    <div className="space-y-2" data-mm-campaigns={view}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t(LIST_TITLE[view])}
          <span className="ms-1.5 font-normal tabular-nums text-muted-foreground">{count(rows.length, lang)}</span>
        </h3>
        {view !== 'all' && (
          <button type="button" onClick={onShowAll}
            className="min-h-10 rounded-lg px-2 text-[13px] font-semibold text-[hsl(var(--gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
            {t('mm_w_show_all')}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center" data-mm-filtered-empty="">
          <p className="text-sm font-semibold text-foreground">{t(LIST_EMPTY[view])}</p>
          <button type="button" onClick={onShowAll}
            className="mt-2 min-h-10 rounded-lg px-3 text-[13px] font-semibold text-[hsl(var(--gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
            {t('mm_w_show_all')}
          </button>
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {rows.map(r => {
            const st = statusOf(r);
            const launched = !!r.launched_at;
            const when = statusFromMeta(st) ? ago(r.last_synced_at) : null;
            const synced = when ? t(when.key, { n: count(when.n, lang) }) : null;
            return (
              <li key={r.id}>
                {/* The whole card is the link; nothing interactive is nested inside it. */}
                <Link to={href(r)} aria-label={t('mm_w_open_campaign', { name: name(r) })} data-mm-campaign-card={uiStatus(st)}
                  className="group block h-full rounded-2xl border border-border bg-card px-4 py-3 shadow-card transition-[border-color,box-shadow] hover:border-[hsl(var(--gold-border))] hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] active:bg-[hsl(var(--background))]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words font-semibold leading-snug text-foreground">{name(r)}</p>
                      {synced && <p className="mt-0.5 text-2xs text-muted-foreground" data-mm-synced="">{synced}</p>}
                    </div>
                    <CampaignStatusChip campaign={st} />
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
                  </div>
                  {launched && r.totals.spendMinor === 0 && r.kpis.results === 0 ? (
                    <p className="mt-1.5 text-2xs text-muted-foreground" data-mm-no-delivery="">{t('mm_w_no_delivery')}</p>
                  ) : launched ? (
                    <dl className="mt-2.5 grid grid-cols-3 gap-2 text-[13px]">
                      <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t('mm_w_kpi_spend')}</dt>
                        <dd className="font-semibold tabular-nums text-foreground" dir="ltr">{moneyIn(r.totals.spendMinor, r.currency, lang)}</dd></div>
                      <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t('mm_w_kpi_results')}</dt>
                        <dd className="font-semibold tabular-nums text-foreground">{count(r.kpis.results, lang)}</dd></div>
                      <div className="min-w-0"><dt className="text-2xs text-muted-foreground">{t('mm_w_kpi_cpr')}</dt>
                        {r.kpis.costPerResultMinor != null
                          ? <dd className="font-semibold tabular-nums text-foreground" dir="ltr">{moneyIn(r.kpis.costPerResultMinor, r.currency, lang)}</dd>
                          : <dd className="text-2xs leading-snug text-muted-foreground">{t(r.totals.spendMinor > 0 ? 'mm_w_metric_no_results' : 'mm_w_metric_no_spend')}</dd>}
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-1.5 text-2xs text-muted-foreground">{t('mm_w_not_launched')}</p>
                  )}
                  <div className="mt-2 empty:hidden"><Signals row={r} /></div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
