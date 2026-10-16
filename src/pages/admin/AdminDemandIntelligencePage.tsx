// HOMATCH Admin — Demand Intelligence.
//
// Who wants what, from the interest timeline (property_interest_events) and the
// per-person interests built from it. Every row says whether the interest was
// STATED (explicit), DONE (observed) or derived (inferred), and a strength is
// always shown with the components that produced it. Seller and landlord rows
// exist only where the person listed a property or asked for buyers — never
// from browsing. Opening a profile and every export are audited server-side.
import { Download, Eye, LineChart, Users } from 'lucide-react';
import React from 'react';
import { ActiveChips, BarList, NumberFilter, PlaceInput, StatCard, placeLabel, usd, type Chip } from '@/components/admin/intelligence/IntelKit';
import {
  Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter, TextFilter, UserLine, When, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { downloadBlob, toCsv } from '@/lib/xlsx';
import {
  DEMAND_SORTS, exportDemandCustomers, getDemandAnalytics, getDemandProfile, listDemandCustomers,
  type DemandAnalytics, type DemandCustomer, type DemandFilters, type DemandInterest, type DemandProfile, type DemandSort,
} from '@/services/demandIntelligence';

const PAGE_SIZE = 25;
const DEFAULTS = {
  tab: 'customers', q: '', side: '', basis: '', city: '', district: '', property_type: '', budget_min: '', budget_max: '',
  rooms_min: '', rooms_max: '', area_min: '', area_max: '', active_days: '', strength_min: '', freshness: '',
  frequency_min: '', has_saved: '', has_contacts: '', has_paid: '', sort: 'last_seen_desc', user: '', days: '90',
};
type Draft = typeof DEFAULTS;
type T = (k: TranslationKey, v?: Record<string, string | number>) => string;

const FILTER_KEYS = ['q', 'side', 'basis', 'city', 'district', 'property_type', 'budget_min', 'budget_max', 'rooms_min', 'rooms_max',
  'area_min', 'area_max', 'active_days', 'strength_min', 'freshness', 'frequency_min', 'has_saved', 'has_contacts', 'has_paid'] as const;
const toFilters = (d: Draft): DemandFilters => Object.fromEntries(FILTER_KEYS.map((k) => [k, d[k]])) as DemandFilters;

const sideLabel = (t: T, s: string | null | undefined) => (s ? t(`admin_di_side_${s.toLowerCase()}` as TranslationKey) : '—');
const basisLabel = (t: T, b: string) => t(`admin_di_basis_${b.toLowerCase()}` as TranslationKey);
const bandLabel = (t: T, b: string) => t(`admin_di_band_${b}` as TranslationKey);
const RUN_DONE = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED'];
const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(2)}`);

export default function AdminDemandIntelligencePage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_di_title')} subtitle={t('admin_di_subtitle')} />
      <p className="text-xs text-muted-foreground">{t('admin_di_privacy_note')}</p>
      <Tabs value={applied.tab} onValueChange={(tab) => setApplied({ ...applied, tab })}>
        <TabsList>
          <TabsTrigger value="customers" className="gap-1.5"><Users className="h-4 w-4" aria-hidden="true" />{t('admin_di_tab_customers')}</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5"><LineChart className="h-4 w-4" aria-hidden="true" />{t('admin_di_tab_analytics')}</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-4"><CustomersTab applied={applied} setApplied={setApplied} /></TabsContent>
        <TabsContent value="analytics" className="mt-4"><AnalyticsTab applied={applied} setApplied={setApplied} /></TabsContent>
      </Tabs>
      <ProfileDrawer userId={applied.user || null} onClose={() => setApplied({ ...applied, user: '' })} />
    </div>
  );
}

function CustomersTab({ applied, setApplied }: { applied: Draft; setApplied: (d: Draft) => void }) {
  const { t, lang } = useLanguage();
  const [draft, setDraft] = React.useState<Draft>(applied);
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<DemandCustomer[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const filters = React.useMemo(() => toFilters(applied), [applied]);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listDemandCustomers(filters, applied.sort as DemandSort, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((r) => { if (live) { setRows(r.rows); setTotal(r.total); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filters, applied.sort, page]);

  const apply = (next: Draft) => { setPage(1); setDraft(next); setApplied(next); };
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const opts = (values: string[], fmt: (v: string) => string) => values.map((v) => ({ value: v, label: fmt(v) }));
  const yes = [{ value: 'true', label: t('admin_di_yes') }];

  const runExport = async () => {
    setExporting(true);
    try {
      const all = await exportDemandCustomers(filters);
      const csv = toCsv([
        { field: 'user_id', header: 'user_id' }, { field: 'email', header: 'email' }, { field: 'full_name', header: 'full_name' },
        { field: 'sides', header: 'sides' }, { field: 'cities', header: 'cities' }, { field: 'property_types', header: 'property_types' },
        { field: 'top_strength', header: 'top_strength' }, { field: 'events', header: 'events' }, { field: 'explicit_events', header: 'explicit_events' },
        { field: 'observed_events', header: 'observed_events' }, { field: 'searches', header: 'searches' }, { field: 'views', header: 'views' },
        { field: 'saves', header: 'saves' }, { field: 'contacts', header: 'contacts' }, { field: 'viewings', header: 'viewings' },
        { field: 'paid_campaigns', header: 'paid_campaigns' }, { field: 'listings', header: 'listings' },
        { field: 'budget_min', header: 'budget_min' }, { field: 'budget_max', header: 'budget_max' },
        { field: 'registered_at', header: 'registered_at' }, { field: 'last_seen_at', header: 'last_seen_at' },
      ], all.map(({ top_interest: _top, ...r }) => ({ ...r, sides: (r.sides ?? []).join('|'), cities: (r.cities ?? []).join('|'), property_types: (r.property_types ?? []).join('|') })));
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `homatch-demand-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const chips: Chip[] = [];
  const named: Array<[keyof Draft, string, (v: string) => string]> = [
    ['q', t('admin_di_search'), (v) => v], ['side', t('admin_di_side'), (v) => sideLabel(t, v)], ['basis', t('admin_di_basis'), (v) => basisLabel(t, v)],
    ['city', t('admin_bi_city'), (v) => placeLabel('city', v, lang)], ['district', t('admin_bi_district'), (v) => placeLabel('district', v, lang)],
    ['property_type', t('admin_cc_dim_property_type'), (v) => t(`prop_type_${v.toLowerCase()}` as TranslationKey)],
    ['budget_min', t('admin_bi_min_budget'), (v) => usd(Number(v))], ['budget_max', t('admin_bi_max_budget'), (v) => usd(Number(v))],
    ['rooms_min', t('admin_bi_min_bedrooms'), (v) => v], ['rooms_max', t('admin_bi_max_bedrooms'), (v) => v],
    ['area_min', t('admin_bi_min_area'), (v) => `${v} m²`], ['area_max', t('admin_bi_max_area'), (v) => `${v} m²`],
    ['active_days', t('admin_di_activity'), (v) => t('admin_bi_days', { count: v })], ['strength_min', t('admin_di_strength_min'), (v) => v],
    ['freshness', t('admin_di_freshness'), (v) => t(`admin_di_fresh_${v.toLowerCase()}` as TranslationKey)],
    ['frequency_min', t('admin_di_frequency_min'), (v) => v], ['has_saved', t('admin_di_has_saved'), () => t('admin_di_yes')],
    ['has_contacts', t('admin_di_has_contacts'), () => t('admin_di_yes')], ['has_paid', t('admin_di_has_paid'), () => t('admin_di_yes')],
  ];
  for (const [k, label, fmt] of named) {
    if (applied[k]) chips.push({ id: k, label: `${label}: ${fmt(applied[k])}`, onRemove: () => apply({ ...applied, [k]: '' }) });
  }

  return (
    <div className="space-y-4">
      <FilterBar
        busy={loading}
        onApply={() => apply(draft)}
        onReset={() => apply({ ...DEFAULTS, tab: applied.tab })}
        primary={<>
          <TextFilter label={t('admin_di_search')} value={draft.q} placeholder={t('admin_di_search_placeholder')} onChange={(v) => set({ q: v })} />
          <SelectFilter label={t('admin_di_side')} value={draft.side} onChange={(v) => set({ side: v })} options={opts(['BUY', 'RENT', 'SELL', 'LET'], (v) => sideLabel(t, v))} />
          <SelectFilter label={t('admin_di_basis')} value={draft.basis} onChange={(v) => set({ basis: v })} options={opts(['EXPLICIT', 'OBSERVED'], (v) => basisLabel(t, v))} />
          <SelectFilter label={t('admin_di_activity')} value={draft.active_days} onChange={(v) => set({ active_days: v })}
                        options={opts(['7', '30', '90', '180', '365'], (v) => t('admin_bi_days', { count: v }))} />
        </>}
        more={<>
          <PlaceInput kind="city" label={t('admin_bi_city')} value={draft.city} onChange={(v) => set({ city: v, district: v === draft.city ? draft.district : '' })} />
          <PlaceInput kind="district" label={t('admin_bi_district')} value={draft.district} city={draft.city} onChange={(v) => set({ district: v })} />
          <SelectFilter label={t('admin_cc_dim_property_type')} value={draft.property_type} onChange={(v) => set({ property_type: v })}
                        options={opts(['APARTMENT', 'HOUSE', 'COMMERCIAL', 'LAND'], (v) => t(`prop_type_${v.toLowerCase()}` as TranslationKey))} />
          <SelectFilter label={t('admin_di_freshness')} value={draft.freshness} onChange={(v) => set({ freshness: v })}
                        options={opts(['ACTIVE', 'RECENT', 'COOLING', 'DORMANT', 'WITHDRAWN'], (v) => t(`admin_di_fresh_${v.toLowerCase()}` as TranslationKey))} />
          <NumberFilter label={t('admin_bi_min_budget')} value={draft.budget_min} onChange={(v) => set({ budget_min: v })} />
          <NumberFilter label={t('admin_bi_max_budget')} value={draft.budget_max} onChange={(v) => set({ budget_max: v })} />
          <NumberFilter label={t('admin_bi_min_bedrooms')} value={draft.rooms_min} onChange={(v) => set({ rooms_min: v })} />
          <NumberFilter label={t('admin_bi_max_bedrooms')} value={draft.rooms_max} onChange={(v) => set({ rooms_max: v })} />
          <NumberFilter label={t('admin_bi_min_area')} value={draft.area_min} onChange={(v) => set({ area_min: v })} />
          <NumberFilter label={t('admin_bi_max_area')} value={draft.area_max} onChange={(v) => set({ area_max: v })} />
          <NumberFilter label={t('admin_di_strength_min')} value={draft.strength_min} onChange={(v) => set({ strength_min: v })} />
          <NumberFilter label={t('admin_di_frequency_min')} value={draft.frequency_min} onChange={(v) => set({ frequency_min: v })} />
          <SelectFilter label={t('admin_di_has_saved')} value={draft.has_saved} onChange={(v) => set({ has_saved: v })} options={yes} />
          <SelectFilter label={t('admin_di_has_contacts')} value={draft.has_contacts} onChange={(v) => set({ has_contacts: v })} options={yes} />
          <SelectFilter label={t('admin_di_has_paid')} value={draft.has_paid} onChange={(v) => set({ has_paid: v })} options={yes} />
        </>}
      />
      <ActiveChips chips={chips} onClear={() => apply({ ...DEFAULTS, tab: applied.tab, sort: applied.sort })} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_bi_results', { count: total })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('admin_bi_sort')}
            <select className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={applied.sort}
                    onChange={(e) => { setPage(1); setApplied({ ...applied, sort: e.target.value }); }}>
              {DEMAND_SORTS.map((s) => <option key={s} value={s}>{t(`admin_di_sort_${s}` as TranslationKey)}</option>)}
            </select>
          </label>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={exporting || total === 0} onClick={() => void runExport()}>
            <Download className="h-4 w-4" aria-hidden="true" />{exporting ? t('admin_di_exporting') : t('admin_di_export')}
          </Button>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">{t('admin_di_export_note')}</p>

      {error && <ErrorNote message={error} />}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? <Empty>{t('admin_di_empty')}</Empty> : (
            <ul>
              {rows.map((r) => (
                <li key={r.user_id} className="border-t border-border first:border-0">
                  <button type="button" onClick={() => setApplied({ ...applied, user: r.user_id })}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">{r.full_name || r.email || r.user_id}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[(r.cities ?? []).map((c) => placeLabel('city', c, lang)).join(', '),
                          (r.property_types ?? []).map((p) => t(`prop_type_${p.toLowerCase()}` as TranslationKey)).join(', '),
                          r.budget_min || r.budget_max ? `${usd(r.budget_min)}–${usd(r.budget_max)}` : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {(r.sides ?? []).map((s) => <Badge key={s} variant="secondary" className="text-2xs">{sideLabel(t, s)}</Badge>)}
                      <Badge variant={r.explicit_events > 0 ? 'default' : 'outline'} className="text-2xs">
                        {basisLabel(t, r.explicit_events > 0 ? 'EXPLICIT' : 'OBSERVED')}
                      </Badge>
                      <span className="text-2xs tabular-nums text-muted-foreground">
                        {t('admin_di_strength_value', { score: r.top_strength ?? 0 })} · {t('admin_di_events_count', { count: r.events })}
                      </span>
                      {r.last_seen_at && <span className="text-2xs text-muted-foreground"><When at={r.last_seen_at} /></span>}
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('admin_bi_inspect')} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager offset={(page - 1) * PAGE_SIZE} limit={PAGE_SIZE} total={total} count={rows.length}
             onChange={(offset) => setPage(Math.floor(offset / PAGE_SIZE) + 1)} />
    </div>
  );
}

function AnalyticsTab({ applied, setApplied }: { applied: Draft; setApplied: (d: Draft) => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = React.useState<DemandAnalytics | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [city, setCity] = React.useState(applied.city);
  React.useEffect(() => {
    let live = true;
    setData(null);
    getDemandAnalytics(Number(applied.days) || 90, applied.city || null)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [applied.days, applied.city]);
  const place = (v: string) => placeLabel(applied.city ? 'district' : 'city', v, lang);
  const econ = data?.campaignEconomics;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectFilter label={t('admin_di_window')} value={applied.days} onChange={(v) => setApplied({ ...applied, days: v || '90' })}
                      options={['7', '30', '90', '180', '365'].map((v) => ({ value: v, label: t('admin_bi_days', { count: v }) }))} />
        <PlaceInput kind="city" label={t('admin_bi_city')} value={city} onChange={(v) => { setCity(v); setApplied({ ...applied, city: v }); }} />
      </div>
      {error && <ErrorNote message={error} />}
      {!data && !error && <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>}
      {data && (
        <>
          <section aria-label={t('admin_di_people')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label={t('admin_di_buyers')} value={data.people.buyers} />
            <StatCard label={t('admin_di_tenants')} value={data.people.tenants} />
            <StatCard label={t('admin_di_sellers')} value={data.people.sellers} hint={t('admin_di_sellers_hint')} />
            <StatCard label={t('admin_di_landlords')} value={data.people.landlords} hint={t('admin_di_sellers_hint')} />
            <StatCard label={t('admin_di_explicit_people')} value={data.people.explicit} />
            <StatCard label={t('admin_di_observed_only')} value={data.people.observedOnly} hint={t('admin_di_observed_only_hint')} />
          </section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <BarList title={applied.city ? t('admin_bi_by_district') : t('admin_bi_by_city')} empty={t('admin_bi_none')}
                     rows={(applied.city ? data.byDistrict : data.byCity).map((r) => ({ label: place(r.label), value: r.value }))} />
            <BarList title={t('admin_di_by_type')} empty={t('admin_bi_none')}
                     rows={data.byType.map((r) => ({ label: t(`prop_type_${r.label.toLowerCase()}` as TranslationKey), value: r.value }))} />
            <BarList title={t('admin_di_by_budget')} empty={t('admin_bi_none')} rows={data.byBudget.map((r) => ({ label: bandLabel(t, r.label), value: r.value }))} />
          </div>
          <Card>
            <CardContent className="space-y-2 p-3">
              <h3 className="text-sm font-semibold">{t('admin_di_demand_vs_supply')}</h3>
              {data.demandVsSupply.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_bi_none')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted-foreground">
                      <th className="py-1 text-start font-medium">{applied.city ? t('admin_bi_district') : t('admin_bi_city')}</th>
                      <th className="py-1 text-end font-medium">{t('admin_di_demand')}</th>
                      <th className="py-1 text-end font-medium">{t('admin_di_native_supply')}</th>
                      <th className="py-1 text-end font-medium">{t('admin_di_portal_supply')}</th>
                    </tr></thead>
                    <tbody>{data.demandVsSupply.map((r) => (
                      <tr key={r.label} className="border-t border-border">
                        <td className="py-1">{place(r.label)}</td>
                        <td className="py-1 text-end tabular-nums">{r.demand}</td>
                        <td className="py-1 text-end tabular-nums">{r.nativeSupply}</td>
                        <td className="py-1 text-end tabular-nums">{r.portalSupply}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 p-3">
              <h3 className="text-sm font-semibold">{t('admin_di_trend')}</h3>
              {data.trend.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_bi_none')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted-foreground">
                      <th className="py-1 text-start font-medium">{t('admin_di_week')}</th>
                      {(['buy', 'rent', 'sell', 'let'] as const).map((s) => <th key={s} className="py-1 text-end font-medium">{sideLabel(t, s)}</th>)}
                    </tr></thead>
                    <tbody>{data.trend.map((r) => (
                      <tr key={r.week} className="border-t border-border">
                        <td className="py-1 tabular-nums" dir="ltr">{r.week}</td>
                        <td className="py-1 text-end tabular-nums">{r.buy}</td><td className="py-1 text-end tabular-nums">{r.rent}</td>
                        <td className="py-1 text-end tabular-nums">{r.sell}</td><td className="py-1 text-end tabular-nums">{r.let}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('admin_di_free_searches')} value={data.searches.free} hint={t('admin_di_free_hint')} />
            <StatCard label={t('admin_di_paid_find_property')} value={data.searches.paidFindProperty} />
            <StatCard label={t('admin_di_find_buyers_campaigns')} value={data.searches.findBuyersCampaigns} />
            <StatCard label={t('admin_di_policy')} value={`${(econ?.policy.homatchShareBps ?? 3700) / 100}% / ${(econ?.policy.providerShareBps ?? 6300) / 100}%`} hint={t('admin_di_policy_hint')} />
          </section>
          <Card>
            <CardContent className="space-y-2 p-3">
              <h3 className="text-sm font-semibold">{t('admin_di_economics')}</h3>
              <p className="text-2xs text-muted-foreground">{t('admin_di_economics_note')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-muted-foreground">
                    <th className="py-1 text-start font-medium">{t('admin_di_product')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_di_campaigns')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_di_charged')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_di_provider_spend')}</th>
                    <th className="py-1 text-end font-medium">{t('admin_di_profit')}</th>
                  </tr></thead>
                  <tbody>
                    {(econ?.findBuyers ?? []).map((r) => (
                      <tr key={r.policy} className="border-t border-border">
                        <td className="py-1">{t('admin_di_find_buyers_campaigns')} · {r.policy === 'legacy' ? t('admin_di_policy_legacy') : t('admin_di_policy_new')}</td>
                        <td className="py-1 text-end tabular-nums">{r.campaigns}{r.running ? ` (${t('admin_di_running', { count: r.running })})` : ''}</td>
                        <td className="py-1 text-end tabular-nums">{money(r.chargedUsd)}</td>
                        <td className="py-1 text-end tabular-nums">{money(r.providerSpendUsd)}</td>
                        <td className="py-1 text-end tabular-nums">{money(r.homatchProfitUsd)}</td>
                      </tr>
                    ))}
                    {econ?.findProperty && (
                      <tr className="border-t border-border">
                        <td className="py-1">{t('admin_di_paid_find_property')}</td>
                        <td className="py-1 text-end tabular-nums">{econ.findProperty.runs}</td>
                        <td className="py-1 text-end tabular-nums">{money(econ.findProperty.chargedUsd)}</td>
                        <td className="py-1 text-end tabular-nums">{money(econ.findProperty.providerSpendUsd)}</td>
                        <td className="py-1 text-end tabular-nums">{money(econ.findProperty.homatchProfitUsd)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function InterestCard({ i }: { i: DemandInterest }) {
  const { t, lang } = useLanguage();
  const s = i.strength;
  return (
    <li className="rounded-md border border-border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-2xs">{sideLabel(t, i.side)}</Badge>
        {s && <Badge variant={s.basis === 'EXPLICIT' ? 'default' : 'outline'} className="text-2xs">{basisLabel(t, s.basis)}</Badge>}
        {s && <Badge variant="outline" className="text-2xs">{t(`admin_di_fresh_${s.freshness.toLowerCase()}` as TranslationKey)}</Badge>}
        {s && <span className="tabular-nums text-muted-foreground">{t('admin_di_strength_value', { score: s.score })}</span>}
      </div>
      <p className="mt-1 text-muted-foreground">
        {[i.city ? placeLabel('city', i.city, lang) : null, i.districts.map((d) => placeLabel('district', d, lang)).join(', ') || null,
          i.property_type ? t(`prop_type_${i.property_type.toLowerCase()}` as TranslationKey) : null, bandLabel(t, i.budget_band)]
          .filter(Boolean).join(' · ')}
      </p>
      {s && (
        <p className="mt-1 text-2xs text-muted-foreground">
          {t('admin_di_components', { stated: s.components.stated, refined: s.components.refined, viewed: s.components.viewed,
            saved: s.components.saved, contacted: s.components.contacted, committed: s.components.committed })}
        </p>
      )}
      <p className="mt-1 text-2xs text-muted-foreground">
        {t('admin_di_counts', { searches: i.searches + i.declarations, views: i.views, saves: i.saves, contacts: i.contacts + i.viewings, paid: i.paid_campaigns })}
      </p>
    </li>
  );
}

function ProfileDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t, lang, isRTL } = useLanguage();
  const [p, setP] = React.useState<DemandProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!userId) { setP(null); return; }
    let live = true;
    setP(null); setError(null);
    getDemandProfile(userId)
      .then((d) => { if (live) setP(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [userId]);
  return (
    <Sheet open={Boolean(userId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side={isRTL ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('admin_di_profile')}</SheetTitle>
          <SheetDescription>{t('admin_di_profile_note')}</SheetDescription>
        </SheetHeader>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        {!p && !error && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
        {p && (
          <div className="mt-4 space-y-5">
            <KV rows={[
              [t('admin_bi_person'), <UserLine user={{ id: p.identity.id, email: p.identity.email, full_name: p.identity.fullName }} />],
              [t('admin_di_phone'), p.identity.phone ? <span dir="ltr">{p.identity.phone}</span> : '—'],
              [t('admin_di_registered'), <When at={p.identity.registeredAt} />],
              [t('admin_di_last_activity'), <When at={p.lastActivityAt} />],
              [t('admin_di_credits'), p.credits ? `${p.credits.balance} · ${t('admin_di_reserved', { count: p.credits.reserved })}` : '—'],
              [t('admin_di_matches'), t('admin_di_matches_value', { seeker: p.matches.asSeeker, owner: p.matches.asOwner })],
              [t('admin_di_tracking'), p.observedTracking ? t('admin_di_tracking_on') : t('admin_di_tracking_off')],
              [t('admin_di_id'), <IdChip id={p.identity.id} />],
            ]} />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_di_interests', { count: p.interests.length })}</h3>
              {p.interests.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_bi_none')}</p>
                : <ul className="space-y-2">{p.interests.map((i) => <InterestCard key={i.interest_key} i={i} />)}</ul>}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_di_saved', { count: p.saved.length })}</h3>
              {p.saved.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_bi_none')}</p> : (
                <ul className="space-y-1 text-xs">{p.saved.map((s) => (
                  <li key={s.listing_key} className="flex flex-wrap gap-2">
                    <span className="min-w-0 flex-1 truncate">{String(s.snapshot.title ?? s.listing_key)}</span>
                    <When at={s.saved_at} />
                  </li>))}</ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_di_searches_section')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('admin_di_search_counts', { free: p.freeSearches.length, paid: p.paidDiscovery.length, campaigns: p.findBuyersCampaigns.length, contacts: p.contacts.length })}
              </p>
              <ul className="space-y-1 text-xs">
                {p.freeSearches.slice(0, 20).map((s) => (
                  <li key={s.id} className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-2xs">{t('admin_di_free')}</Badge>
                    <span>{[s.transaction ? sideLabel(t, s.transaction === 'BUY' ? 'BUY' : 'RENT') : null, s.city ? placeLabel('city', s.city, lang) : null,
                      s.properties != null ? t('admin_di_results_count', { count: s.properties }) : null].filter(Boolean).join(' · ')}</span>
                    <When at={s.at} />
                  </li>))}
                {p.paidDiscovery.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-2">
                    <Badge className="text-2xs">{t('admin_di_paid')}</Badge>
                    <span>{[t(`admin_di_run_${RUN_DONE.includes(r.status) ? r.status.toLowerCase() : 'running'}` as TranslationKey), r.credits != null ? t('admin_di_credits_value', { count: r.credits }) : null].filter(Boolean).join(' · ')}</span>
                    <When at={r.at} />
                  </li>))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_di_timeline', { count: p.eventsTotal })}</h3>
              <ol className="space-y-1 text-xs">
                {p.timeline.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-1.5 border-s-2 border-border ps-2">
                    <Badge variant={e.intent_basis === 'EXPLICIT' ? 'default' : 'outline'} className="text-2xs">{t(`admin_di_event_${e.event_type.toLowerCase()}` as TranslationKey)}</Badge>
                    <span className="text-muted-foreground">
                      {[sideLabel(t, e.side), e.city ? placeLabel('city', e.city, lang) : null, e.source_host, basisLabel(t, e.intent_basis)].filter((x) => x && x !== '—').join(' · ')}
                    </span>
                    <span className="ms-auto text-muted-foreground"><When at={e.occurred_at} /></span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
