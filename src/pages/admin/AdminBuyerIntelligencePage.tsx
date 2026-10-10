// HOMATCH Admin — Buyer intelligence.
//
// One row per HOMATCH account, built only from what that person EXPLICITLY
// asked for: a confirmed Find Property plan or marketplace search, a
// requirement they stated in their own words, a viewing they requested. No
// chat text, no mortgage figures, no wealth inferred from anything — a budget
// shows only where the person typed one. External leads are counted in the
// stats and never shown as HOMATCH people.
//
// Everything is filtered, sorted and paged on the server
// (admin_buyer_intelligence_list / _stats / _detail, each is_admin-gated).
import { Eye, UserSearch } from 'lucide-react';
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  ActiveChips, BarList, COUNTRIES, MultiToggle, NumberFilter, PlaceInput, StatCard, placeLabel, usd, type Chip,
} from '@/components/admin/intelligence/IntelKit';
import {
  Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter, TextFilter, UserLine, When, useQueryState,
} from '@/components/admin/control/AdminKit';
import { InternalLeadsAdminPanel } from '@/components/admin/InternalLeadsAdminPanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import {
  INTENT_LEVELS, INTENT_SOURCES, getBuyerDetail, getBuyerStats, listBuyers,
  type BuyerDetail, type BuyerFilters, type BuyerStats, type BuyerSummary,
} from '@/services/buyerIntelligence';

const PAGE_SIZE = 25;
const LIST_KEYS = ['property_types', 'segments', 'sources', 'levels'] as const;
const DEFAULTS = {
  q: '', role: '', transaction: '', status: '', country: '', city: '', district: '', neighborhood: '',
  property_types: '', segments: '', sources: '', levels: '', confidence: '', match_strength: '', budget: '',
  strength: '', origin: '', currency: '', recency_days: '', min_price: '', max_price: '',
  min_bedrooms: '', max_bedrooms: '', min_area: '', max_area: '', sort: 'latest_desc', user: '',
};
type Draft = typeof DEFAULTS;

const split = (v: string) => (v ? v.split(',').filter(Boolean) : []);
const toFilters = (d: Draft): BuyerFilters => {
  const { sort: _sort, user: _user, ...rest } = d;
  const f: Record<string, unknown> = { ...rest };
  for (const k of LIST_KEYS) f[k] = split(d[k]);
  return f as BuyerFilters;
};

export default function AdminBuyerIntelligencePage() {
  const { t, lang } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const [draft, setDraft] = React.useState<Draft>(applied);
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<BuyerSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [stats, setStats] = React.useState<BuyerStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const filters = React.useMemo(() => toFilters(applied), [applied]);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([listBuyers(filters, applied.sort, page, PAGE_SIZE), getBuyerStats(filters)])
      .then(([list, s]) => { if (live) { setRows(list.rows); setTotal(list.total); setStats(s); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setStats(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filters, applied.sort, page]);

  const apply = (next: Draft) => { setPage(1); setDraft(next); setApplied(next); };
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const opts = (keys: readonly string[], prefix: string) =>
    keys.map((k) => ({ value: k, label: t(`${prefix}${k.toLowerCase()}` as TranslationKey) }));
  const segOpts = opts(['PREMIUM', 'MIDDLE', 'ECONOMY'], 'admin_seg_segment_');
  const typeOpts = ['APARTMENT', 'HOUSE', 'COMMERCIAL', 'LAND'].map((v) => ({ value: v, label: t(`prop_type_${v.toLowerCase()}` as TranslationKey) }));
  const levelOpts = opts(INTENT_LEVELS, 'admin_bi_level_');
  const sourceOpts = opts(INTENT_SOURCES, 'admin_bi_source_');

  /* Active chips: every applied filter, removable one by one. */
  const chips: Chip[] = [];
  const named: Array<[keyof Draft, string, (v: string) => string]> = [
    ['q', t('admin_bi_search'), (v) => v],
    ['role', t('admin_bi_role'), (v) => t(`admin_bi_role_${v.toLowerCase()}` as TranslationKey)],
    ['transaction', t('admin_cc_transaction'), (v) => labelFor(t, 'deal', v)],
    ['status', t('admin_bi_status'), (v) => t(`admin_bi_status_${v.toLowerCase()}` as TranslationKey)],
    ['country', t('admin_bi_country'), (v) => t(COUNTRIES.find((c) => c.value === v)?.labelKey ?? v)],
    ['city', t('admin_bi_city'), (v) => placeLabel('city', v, lang)],
    ['district', t('admin_bi_district'), (v) => placeLabel('district', v, lang)],
    ['neighborhood', t('admin_bi_neighborhood'), (v) => v],
    ['confidence', t('admin_bi_confidence'), (v) => t(`admin_bi_conf_${v.toLowerCase()}` as TranslationKey)],
    ['match_strength', t('admin_bi_match_strength'), (v) => t(`admin_bi_match_${v.toLowerCase()}` as TranslationKey)],
    ['budget', t('admin_bi_budget'), (v) => t(`admin_bi_budget_${v.toLowerCase()}` as TranslationKey)],
    ['strength', t('admin_bi_strength'), (v) => t(`admin_bi_strength_${v.toLowerCase()}` as TranslationKey)],
    ['origin', t('admin_bi_origin'), (v) => t(`admin_bi_origin_${v.toLowerCase()}` as TranslationKey)],
    ['currency', t('admin_bi_currency'), (v) => v],
    ['recency_days', t('admin_bi_recency'), (v) => t('admin_bi_days', { count: v })],
    ['min_price', t('admin_bi_min_budget'), (v) => usd(Number(v))],
    ['max_price', t('admin_bi_max_budget'), (v) => usd(Number(v))],
    ['min_bedrooms', t('admin_bi_min_bedrooms'), (v) => v],
    ['max_bedrooms', t('admin_bi_max_bedrooms'), (v) => v],
    ['min_area', t('admin_bi_min_area'), (v) => `${v} m²`],
    ['max_area', t('admin_bi_max_area'), (v) => `${v} m²`],
  ];
  for (const [k, label, fmt] of named) {
    if (applied[k]) chips.push({ id: k, label: `${label}: ${fmt(applied[k])}`, onRemove: () => apply({ ...applied, [k]: '' }) });
  }
  const listChip = (k: typeof LIST_KEYS[number], label: string, options: Array<{ value: string; label: string }>) => {
    for (const v of split(applied[k])) {
      chips.push({
        id: `${k}:${v}`, label: `${label}: ${options.find((o) => o.value === v)?.label ?? v}`,
        onRemove: () => apply({ ...applied, [k]: split(applied[k]).filter((x) => x !== v).join(',') }),
      });
    }
  };
  listChip('segments', t('admin_seg_segment'), segOpts);
  listChip('property_types', t('admin_cc_dim_property_type'), typeOpts);
  listChip('sources', t('admin_bi_source'), sourceOpts);
  listChip('levels', t('admin_bi_level'), levelOpts);

  const sel = (key: keyof Draft, label: string, values: string[], prefix: string) => (
    <SelectFilter label={label} value={draft[key]} onChange={(v) => set({ [key]: v } as Partial<Draft>)}
                  options={values.map((v) => ({ value: v, label: t(`${prefix}${v.toLowerCase()}` as TranslationKey) }))} />
  );

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_bi_title')} subtitle={t('admin_bi_subtitle')} />
      <p className="text-xs text-muted-foreground">{t('admin_bi_privacy_note')}</p>

      {stats && <StatsPanel stats={stats} />}

      <InternalLeadsAdminPanel />

      <FilterBar
        busy={loading}
        onApply={() => apply(draft)}
        onReset={() => apply({ ...DEFAULTS })}
        primary={<>
          <TextFilter label={t('admin_bi_search')} value={draft.q} placeholder={t('admin_bi_search_placeholder')} onChange={(v) => set({ q: v })} />
          {sel('role', t('admin_bi_role'), ['BUYER', 'TENANT'], 'admin_bi_role_')}
          <SelectFilter label={t('admin_cc_transaction')} value={draft.transaction} onChange={(v) => set({ transaction: v })}
                        options={['SALE', 'RENT'].map((v) => ({ value: v, label: labelFor(t, 'deal', v) }))} />
          {sel('status', t('admin_bi_status'), ['ACTIVE', 'INACTIVE', 'STALE'], 'admin_bi_status_')}
        </>}
        more={<>
          <SelectFilter label={t('admin_bi_country')} value={draft.country} onChange={(v) => set({ country: v })}
                        options={COUNTRIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))} />
          <PlaceInput kind="city" label={t('admin_bi_city')} value={draft.city}
                      onChange={(v) => set({ city: v, district: v === draft.city ? draft.district : '', neighborhood: v === draft.city ? draft.neighborhood : '' })} />
          <PlaceInput kind="district" label={t('admin_bi_district')} value={draft.district} city={draft.city}
                      onChange={(v) => set({ district: v, neighborhood: v === draft.district ? draft.neighborhood : '' })} />
          <TextFilter label={t('admin_bi_neighborhood')} value={draft.neighborhood} onChange={(v) => set({ neighborhood: v })} />
          {sel('confidence', t('admin_bi_confidence'), ['HIGH', 'MEDIUM', 'LOW'], 'admin_bi_conf_')}
          {sel('match_strength', t('admin_bi_match_strength'), ['STRONG', 'ANY', 'NONE'], 'admin_bi_match_')}
          {sel('budget', t('admin_bi_budget'), ['CONFIRMED', 'UNKNOWN'], 'admin_bi_budget_')}
          {sel('strength', t('admin_bi_strength'), ['STRONG', 'EXPLORATORY'], 'admin_bi_strength_')}
          {sel('origin', t('admin_bi_origin'), ['INTERNAL', 'EXTERNAL'], 'admin_bi_origin_')}
          <SelectFilter label={t('admin_bi_currency')} value={draft.currency} onChange={(v) => set({ currency: v })} options={[{ value: 'USD', label: 'USD' }]} />
          <SelectFilter label={t('admin_bi_recency')} value={draft.recency_days} onChange={(v) => set({ recency_days: v })}
                        options={['7', '30', '90', '180', '365'].map((v) => ({ value: v, label: t('admin_bi_days', { count: v }) }))} />
          <NumberFilter label={t('admin_bi_min_budget')} value={draft.min_price} onChange={(v) => set({ min_price: v })} />
          <NumberFilter label={t('admin_bi_max_budget')} value={draft.max_price} onChange={(v) => set({ max_price: v })} />
          <NumberFilter label={t('admin_bi_min_bedrooms')} value={draft.min_bedrooms} onChange={(v) => set({ min_bedrooms: v })} />
          <NumberFilter label={t('admin_bi_max_bedrooms')} value={draft.max_bedrooms} onChange={(v) => set({ max_bedrooms: v })} />
          <NumberFilter label={t('admin_bi_min_area')} value={draft.min_area} onChange={(v) => set({ min_area: v })} />
          <NumberFilter label={t('admin_bi_max_area')} value={draft.max_area} onChange={(v) => set({ max_area: v })} />
          <div className="sm:col-span-2 lg:col-span-4 grid gap-3 sm:grid-cols-2">
            <MultiToggle label={t('admin_seg_segment')} options={segOpts} value={split(draft.segments)} onChange={(v) => set({ segments: v.join(',') })} />
            <MultiToggle label={t('admin_cc_dim_property_type')} options={typeOpts} value={split(draft.property_types)} onChange={(v) => set({ property_types: v.join(',') })} />
            <MultiToggle label={t('admin_bi_source')} options={sourceOpts} value={split(draft.sources)} onChange={(v) => set({ sources: v.join(',') })} />
            <MultiToggle label={t('admin_bi_level')} options={levelOpts} value={split(draft.levels)} onChange={(v) => set({ levels: v.join(',') })} />
          </div>
        </>}
      />

      <ActiveChips chips={chips} onClear={() => apply({ ...DEFAULTS, sort: applied.sort })} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_bi_results', { count: total })}</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('admin_bi_sort')}
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={applied.sort}
                  onChange={(e) => { setPage(1); setApplied({ ...applied, sort: e.target.value }); }}>
            {['latest_desc', 'latest_asc', 'level_desc', 'confidence_desc', 'budget_desc', 'budget_asc', 'matches_desc'].map((s) => (
              <option key={s} value={s}>{t(`admin_bi_sort_${s}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{applied.origin === 'EXTERNAL' ? t('admin_bi_external_not_people') : t('admin_bi_empty')}</Empty>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.user_id} className="border-t border-border first:border-0">
                  <button type="button" onClick={() => setApplied({ ...applied, user: r.user_id })}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <UserSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">{r.full_name || r.email || r.user_id}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[r.cities.map((c) => placeLabel('city', c, lang)).join(', '),
                          r.districts.map((d) => placeLabel('district', d, lang)).join(', '),
                          budgetText(t, r)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-2xs">{t(`admin_bi_role_${r.role.toLowerCase()}` as TranslationKey)}</Badge>
                      <Badge variant={r.level_rank >= 4 && !r.stale ? 'default' : 'outline'} className="text-2xs">
                        {t(`admin_bi_level_${r.intent_level.toLowerCase()}` as TranslationKey)}
                      </Badge>
                      {r.stale && <Badge variant="outline" className="text-2xs text-destructive">{t('admin_bi_status_stale')}</Badge>}
                      {r.segments.map((s) => (
                        <Badge key={s} variant="outline" className="text-2xs">{t(`admin_seg_segment_${s.toLowerCase()}` as TranslationKey)}</Badge>
                      ))}
                      {r.internal_matches > 0 && (
                        <span className="text-2xs tabular-nums text-muted-foreground">{t('admin_bi_matches_count', { count: r.internal_matches })}</span>
                      )}
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

      <BuyerDrawer userId={applied.user || null} onClose={() => setApplied({ ...applied, user: '' })} />
    </div>
  );
}

function budgetText(t: (k: TranslationKey, v?: Record<string, string | number>) => string, r: BuyerSummary): string {
  if (!r.budget_confirmed) return t('admin_bi_budget_unknown');
  if (r.budget_min_usd && r.budget_max_usd) return `${usd(r.budget_min_usd)}–${usd(r.budget_max_usd)}`;
  return r.budget_max_usd ? `≤ ${usd(r.budget_max_usd)}` : `≥ ${usd(r.budget_min_usd)}`;
}

function StatsPanel({ stats }: { stats: BuyerStats }) {
  const { t, lang } = useLanguage();
  const fromRecord = (rec: Record<string, number>, prefix: string) =>
    Object.entries(rec).map(([k, v]) => ({ label: t(`${prefix}${k.toLowerCase()}` as TranslationKey), value: Number(v) }))
      .sort((a, b) => b.value - a.value);
  const ext = stats.external_leads;
  return (
    <section aria-label={t('admin_bi_stats')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t('admin_bi_stat_eligible_buyers')} value={stats.eligible_buyers} hint={t('admin_bi_stat_of', { count: stats.buyers })} />
        <StatCard label={t('admin_bi_stat_eligible_tenants')} value={stats.eligible_tenants} hint={t('admin_bi_stat_of', { count: stats.tenants })} />
        <StatCard label={t('admin_bi_stat_strong')} value={stats.strong} hint={t('admin_bi_stat_exploratory', { count: stats.exploratory })} />
        <StatCard label={t('admin_bi_stat_stale')} value={stats.stale} hint={t('admin_bi_stat_uncertain', { count: stats.uncertain })} tone={stats.stale > 0 ? 'warn' : 'default'} />
        <StatCard label={t('admin_bi_stat_internal_matches')} value={stats.internal_matches.total}
                  hint={t('admin_bi_stat_internal_hint', { compatible: stats.internal_matches.compatible, uncertain: stats.internal_matches.uncertain, stale: stats.internal_matches.stale })} />
        <StatCard label={t('admin_bi_stat_external_qualified')} value={ext.available ? (ext.qualified ?? 0) : '—'}
                  hint={ext.available ? t('admin_bi_stat_of', { count: ext.total ?? 0 }) : t('admin_bi_stat_external_unavailable')} />
        <StatCard label={t('admin_bi_stat_budget_stated')} value={stats.budget_confirmed} hint={t('admin_bi_stat_budget_unknown', { count: stats.budget_unknown })} />
        <StatCard label={t('admin_bi_stat_people')} value={stats.people} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <BarList title={t('admin_bi_by_city')} empty={t('admin_bi_none')}
                 rows={stats.by_city.map((r) => ({ label: placeLabel('city', r.city, lang), value: r.count }))} />
        <BarList title={t('admin_bi_by_district')} empty={t('admin_bi_none')}
                 rows={stats.by_district.slice(0, 10).map((r) => ({ label: placeLabel('district', r.district, lang), value: r.count }))} />
        <BarList title={t('admin_bi_by_source')} empty={t('admin_bi_none')} rows={fromRecord(stats.by_source, 'admin_bi_source_')} />
        <BarList title={t('admin_bi_by_level')} empty={t('admin_bi_none')} rows={fromRecord(stats.by_level, 'admin_bi_level_')} />
        <BarList title={t('admin_bi_budget_sale')} empty={t('admin_bi_none')}
                 rows={Object.entries(stats.budget_ranges.sale ?? {}).map(([k, v]) => ({ label: t(`admin_bi_range_${k}` as TranslationKey), value: Number(v) }))} />
        <BarList title={t('admin_bi_budget_rent')} empty={t('admin_bi_none')}
                 rows={Object.entries(stats.budget_ranges.rent ?? {}).map(([k, v]) => ({ label: t(`admin_bi_range_${k}` as TranslationKey), value: Number(v) }))} />
      </div>
    </section>
  );
}

function BuyerDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t, lang, isRTL } = useLanguage();
  const [detail, setDetail] = React.useState<BuyerDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!userId) { setDetail(null); return; }
    let live = true;
    setDetail(null); setError(null);
    getBuyerDetail(userId)
      .then((d) => { if (live) setDetail(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [userId]);
  const s = detail?.summary;
  const range = (a: number | null | undefined, b: number | null | undefined, unit = '') =>
    a == null && b == null ? '—' : `${a ?? '…'}–${b ?? '…'}${unit}`;
  return (
    <Sheet open={Boolean(userId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side={isRTL ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('admin_bi_drawer_title')}</SheetTitle>
          <SheetDescription>{t('admin_bi_drawer_note')}</SheetDescription>
        </SheetHeader>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        {!detail && !error && <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
        {s && (
          <div className="mt-4 space-y-5">
            <KV rows={[
              [t('admin_bi_person'), <UserLine user={{ id: s.user_id, email: s.email, full_name: s.full_name }} />],
              [t('admin_bi_role'), t(`admin_bi_role_${s.role.toLowerCase()}` as TranslationKey)],
              [t('admin_bi_level'), t(`admin_bi_level_${s.intent_level.toLowerCase()}` as TranslationKey)],
              [t('admin_bi_freshness'), `${t(`admin_bi_fresh_${s.freshness.toLowerCase()}` as TranslationKey)}${s.age_days != null ? ` · ${t('admin_bi_days', { count: s.age_days })}` : ''}`],
              [t('admin_bi_confidence'), s.confidence != null ? `${Math.round(Number(s.confidence) * 100)}%` : '—'],
              [t('admin_cc_transaction'), s.transactions.map((x) => labelFor(t, 'deal', x)).join(', ') || '—'],
              [t('admin_cc_dim_property_type'), s.property_types.map((x) => t(`prop_type_${x.toLowerCase()}` as TranslationKey)).join(', ') || '—'],
              [t('admin_bi_city'), s.cities.map((c) => placeLabel('city', c, lang)).join(', ') || '—'],
              [t('admin_bi_district'), s.districts.map((d) => placeLabel('district', d, lang)).join(', ') || '—'],
              [t('admin_bi_budget'), budgetText(t, s)],
              [t('admin_cc_dim_bedrooms'), range(s.bedrooms_min, s.bedrooms_max)],
              [t('admin_cc_dim_area'), range(s.area_min, s.area_max, ' m²')],
              [t('admin_seg_segment'), s.segments.length ? s.segments.map((x) => t(`admin_seg_segment_${x.toLowerCase()}` as TranslationKey)).join(', ') : t('admin_bi_segments_none')],
              [t('admin_bi_stat_internal_matches'), `${s.internal_matches} · ${t('admin_bi_compatible_count', { count: s.compatible_matches })}`],
            ]} />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_bi_evidence')}</h3>
              <ul className="space-y-2">
                {detail.evidence.map((e) => (
                  <li key={e.source_id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-2xs">{t(`admin_bi_source_${e.source.toLowerCase()}` as TranslationKey)}</Badge>
                      <Badge variant="outline" className="text-2xs">{t(`admin_bi_level_${e.intent_level.toLowerCase()}` as TranslationKey)}</Badge>
                      {!e.is_active && <Badge variant="outline" className="text-2xs">{t('admin_bi_status_inactive')}</Badge>}
                      {e.on_behalf && <Badge variant="outline" className="text-2xs">{t('admin_bi_on_behalf')}</Badge>}
                      <span className="text-muted-foreground"><When at={e.observed_at} /></span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {[e.transaction ? labelFor(t, 'deal', e.transaction) : null,
                        e.city ? placeLabel('city', e.city, lang) : null,
                        (e.districts ?? []).map((d) => placeLabel('district', d, lang)).join(', ') || null,
                        e.budget_confirmed && e.budget ? `${t('admin_bi_budget')}: ${usd(e.budget.min_usd)}–${usd(e.budget.max_usd)}` : t('admin_bi_budget_unknown'),
                        e.property?.homatch_id ? `#${e.property.homatch_id}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1"><IdChip id={e.source_id} /></p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('admin_bi_internal_matches')}</h3>
              {detail.internal_matches.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_bi_no_matches')}</p> : (
                <ul className="space-y-2">
                  {detail.internal_matches.map((m) => (
                    <li key={m.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.property_homatch_id && <a className="font-mono hover:underline" href={`/admin/properties?ref=${m.property_homatch_id}`}>#{m.property_homatch_id}</a>}
                        <Badge variant={m.compatibility === 'COMPATIBLE' ? 'default' : 'outline'} className="text-2xs">{labelFor(t, 'compatibility', m.compatibility)}</Badge>
                        {m.score != null && <span className="tabular-nums text-muted-foreground">{Math.round(Number(m.score) * 100)}%</span>}
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {t('admin_cc_agreed')}: {(m.agreed ?? []).map((d) => labelFor(t, 'dimension', d)).join(', ') || '—'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
