// META ADS — global dashboard. Real numbers only, straight from
// metaDashboard(): one summary card PER CURRENCY (money is never added across
// currencies), live / needs-attention counts, and every campaign with its
// spend, results and signals. Empty data renders an honest empty state.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, ChevronRight, Lightbulb, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyState } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { metaDashboard, moneyIn, type DashboardData, type DashboardRow } from '@/services/metaAds';
import { CampaignStatusChip } from './CampaignStatusChip';
import { DashboardFilters, EMPTY_FILTERS, type DashboardFilterValue } from './DashboardFilters';
import { count, dateTime, newest, pct } from './format';

type Summary = DashboardData['summary'][number];

export function GlobalDashboard({ goals }: { goals?: string[] }) {
  const { t, lang } = useLanguage();
  const [filters, setFilters] = useState<DashboardFilterValue>(EMPTY_FILTERS);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Currencies seen so far, so choosing one never hides the others' option.
  const [seenCurrencies, setSeenCurrencies] = useState<string[]>([]);

  const load = useCallback(async (f: DashboardFilterValue) => {
    setLoading(true); setFailed(false);
    try {
      const d = await metaDashboard({
        status: f.status || undefined, goal: f.goal || undefined, currency: f.currency || undefined,
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

  return (
    <section className="space-y-3" aria-labelledby="mm-w-dash-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mm-w-dash-title" className="text-base font-semibold text-foreground">{t('mm_w_dash_title')}</h2>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => void load(filters)} disabled={loading}
          aria-label={t('mm_w_retry')}>
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
        </Button>
      </div>

      <DashboardFilters value={filters} onChange={setFilters} currencies={seenCurrencies} goals={goals} />

      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          <span className="flex-1">{t('mm_w_dash_failed')}</span>
          <Button size="sm" variant="outline" onClick={() => void load(filters)}>{t('mm_w_retry')}</Button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : data ? (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Count label={t('mm_w_count_total')} value={count(data.counts.total, lang)} />
            <Count label={t('mm_w_count_live')} value={count(data.counts.live, lang)} />
            <Count label={t('mm_w_count_attention')} value={count(data.counts.attention, lang)} tone={data.counts.attention > 0 ? 'warn' : undefined} />
          </dl>

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

          <CampaignList rows={data.campaigns} />

          <p className="text-[13px] text-muted-foreground">
            {freshest ? t('mm_w_freshness', { time: dateTime(freshest, lang) }) : t('mm_w_freshness_never')}
          </p>
        </>
      ) : null}
    </section>
  );
}

function Count({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={tone === 'warn'
      ? 'min-w-0 rounded-xl border border-[hsl(32_78%_36%)]/30 bg-[hsl(32_78%_36%)]/10 px-3 py-2.5'
      : 'min-w-0 rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5'}>
      <dt className="break-words text-2xs leading-snug text-muted-foreground">{label}</dt>
      <dd className="font-display text-xl font-bold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** One currency, one card. Every money figure uses THIS card's currency. */
function CurrencySummaryCard({ s }: { s: Summary }) {
  const { t, lang } = useLanguage();
  const cur = s.currency;
  const k = s.kpis;
  const items: Array<[string, string]> = [
    [t('mm_w_kpi_spend'), moneyIn(s.totals.spendMinor, cur, lang)],
    [t('mm_w_kpi_results'), count(k.results, lang)],
    [t('mm_w_kpi_cpr'), moneyIn(k.costPerResultMinor, cur, lang)],
    [t('mm_w_kpi_leads'), count(s.leads, lang)],
    [t('mm_w_kpi_cpl'), moneyIn(k.cplMinor, cur, lang)],
    [t('mm_w_kpi_cpql'), moneyIn(k.cpqlMinor, cur, lang)],
    [t('mm_w_kpi_qual_rate'), pct(k.qualificationRate, lang)],
    [t('mm_w_kpi_cost_viewing'), moneyIn(k.costPerViewingMinor, cur, lang)],
  ];
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-card" aria-label={t('mm_w_summary_title', { currency: cur })}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('mm_w_summary_title', { currency: cur })}
        </h3>
        <span className="text-2xs text-muted-foreground">{t('mm_w_summary_campaigns', { count: s.campaigns })}</span>
      </div>
      {/* Two columns: the card is half of the dashboard column, and four columns
          cut money values to "$192.…" at every desktop width. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="break-words text-2xs leading-snug text-muted-foreground">{label}</dt>
            <dd className="break-words font-semibold tabular-nums text-foreground" dir="ltr">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function Signals({ row }: { row: DashboardRow }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {row.openRecommendations > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
          <Lightbulb className="h-3 w-3" aria-hidden="true" />{t('mm_w_badge_recs', { count: row.openRecommendations })}
        </span>
      )}
      {row.attention && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(32_78%_36%)]/30 bg-[hsl(32_78%_36%)]/10 px-2 py-0.5 text-2xs font-semibold text-[hsl(32_78%_32%)] dark:text-[hsl(32_78%_62%)]">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />{t('mm_w_badge_attention')}
        </span>
      )}
    </span>
  );
}

function CampaignList({ rows }: { rows: DashboardRow[] }) {
  const { t, lang } = useLanguage();
  if (rows.length === 0) {
    return <EmptyState icon={BarChart3} title={t('mm_w_campaigns_empty_title')} body={t('mm_w_campaigns_empty_body')} />;
  }
  const name = (r: DashboardRow) => r.name || t(`mads_goal_${r.goal.toLowerCase()}`);
  const href = (r: DashboardRow) => `/outreach/meta/campaigns/${r.id}`;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{t('mm_w_campaigns_title')}</h3>

      {/* Mobile: cards. */}
      <ul className="space-y-2 md:hidden">
        {rows.map(r => (
          <li key={r.id}>
            <Link to={href(r)} aria-label={t('mm_w_open_campaign', { name: name(r) })}
              className="block rounded-2xl border border-border bg-card px-4 py-3 shadow-card transition-colors hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-foreground">{name(r)}</p>
                <CampaignStatusChip status={r.status} />
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">{t('mm_w_kpi_spend')}</dt>
                <dd className="text-end font-semibold tabular-nums" dir="ltr">{moneyIn(r.totals.spendMinor, r.currency, lang)}</dd>
                <dt className="text-muted-foreground">{t('mm_w_kpi_results')}</dt>
                <dd className="text-end tabular-nums">{count(r.kpis.results, lang)}</dd>
                <dt className="text-muted-foreground">{t('mm_w_kpi_cpr')}</dt>
                <dd className="text-end tabular-nums" dir="ltr">{moneyIn(r.kpis.costPerResultMinor, r.currency, lang)}</dd>
                <dt className="text-muted-foreground">{t('mm_w_kpi_leads')}</dt>
                <dd className="text-end tabular-nums">{count(r.leads, lang)}</dd>
              </dl>
              {(r.openRecommendations > 0 || r.attention) && <div className="mt-2"><Signals row={r} /></div>}
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-2xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">{t('mm_w_col_campaign')}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">{t('mm_w_filter_status')}</th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium">{t('mm_w_kpi_spend')}</th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium">{t('mm_w_kpi_results')}</th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium">{t('mm_w_kpi_cpr')}</th>
              <th scope="col" className="px-3 py-2.5 text-end font-medium">{t('mm_w_kpi_leads')}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-medium">{t('mm_w_col_flags')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-[hsl(var(--secondary))]/60">
                <td className="max-w-[18rem] px-4 py-2.5">
                  <Link to={href(r)} className="block truncate font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    aria-label={t('mm_w_open_campaign', { name: name(r) })}>
                    {name(r)}
                  </Link>
                </td>
                <td className="px-3 py-2.5"><CampaignStatusChip status={r.status} /></td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{moneyIn(r.totals.spendMinor, r.currency, lang)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{count(r.kpis.results, lang)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{moneyIn(r.kpis.costPerResultMinor, r.currency, lang)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums">{count(r.leads, lang)}</td>
                <td className="px-3 py-2.5"><Signals row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
