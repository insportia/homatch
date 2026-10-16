// HOMATCH Admin — Market segmentation.
//
// PREMIUM / MIDDLE / ECONOMY is a property's place in ITS OWN local market:
// asking price per m² against comparable listings of the same transaction and
// type, street → neighbourhood → district → city, only where a level holds
// enough comparables. Thin evidence is UNKNOWN. Every price is an asking
// price, never a transaction price.
//
// Changing the rule is deliberate: edit → PREVIEW (what would change, nothing
// written) → APPLY, which needs the change count typed back and is refused by
// the server if the effect is no longer the one previewed. Every draft, apply
// and retirement is in the audit log.
import { Building2 } from 'lucide-react';
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  ActiveChips, MultiToggle, NumberFilter, PlaceInput, StatCard, placeLabel, usd, type Chip,
} from '@/components/admin/intelligence/IntelKit';
import {
  Confirm, Empty, ErrorNote, Field, FilterBar, KV, PageHeader, Pager, SelectFilter, TextFilter, UserLine, When,
  inputClass, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import {
  SEGMENTS, applySegmentRule, getSegmentAreas, getSegmentRules, listPropertySegments, previewSegmentRule,
  saveSegmentDraft, sameParams,
  type PropertySegmentFilters, type PropertySegmentRow, type SegmentArea, type SegmentParams, type SegmentPreview,
  type SegmentRulesView,
} from '@/services/buyerIntelligence';

const PAGE_SIZE = 25;
const LEVELS = ['STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY'] as const;
const segKey = (s: string) => `admin_seg_segment_${s.toLowerCase()}` as TranslationKey;

export default function AdminMarketSegmentationPage() {
  const { t } = useLanguage();
  const [tab, setTab] = React.useState('properties');
  const [rules, setRules] = React.useState<SegmentRulesView | null>(null);
  const [rulesError, setRulesError] = React.useState<string | null>(null);
  const reloadRules = React.useCallback(() => {
    getSegmentRules().then((r) => { setRules(r); setRulesError(null); })
      .catch((e: unknown) => setRulesError(e instanceof Error ? e.message : String(e)));
  }, []);
  React.useEffect(() => { reloadRules(); }, [reloadRules]);
  const active = rules?.rules.find((r) => r.status === 'ACTIVE') ?? null;

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_seg_title')} subtitle={t('admin_seg_subtitle')} />
      <p className="text-xs text-muted-foreground">{t('admin_seg_asking_note')}</p>
      {rulesError && <ErrorNote message={rulesError} />}
      {rules && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SEGMENTS.map((s) => <StatCard key={s} label={t(segKey(s))} value={rules.stored[s] ?? 0} />)}
          <StatCard label={t('admin_seg_rule_version')} value={active ? `v${active.version}` : '—'}
                    hint={rules.stored.last_computed_at ? new Date(rules.stored.last_computed_at).toLocaleString() : t('admin_seg_never_computed')} />
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="properties">{t('admin_seg_tab_properties')}</TabsTrigger>
          <TabsTrigger value="areas">{t('admin_seg_tab_areas')}</TabsTrigger>
          <TabsTrigger value="rules">{t('admin_seg_tab_rules')}</TabsTrigger>
        </TabsList>
        <TabsContent value="properties"><PropertiesTab /></TabsContent>
        <TabsContent value="areas"><AreasTab /></TabsContent>
        <TabsContent value="rules"><RulesTab rules={rules} onChanged={reloadRules} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── properties ───────────────────────────────────────────────────── */

const P_DEFAULTS = {
  q: '', segments: '', confidence: '', level: '', country: '', city: '', district: '', neighborhood: '', street: '',
  property_types: '', transaction: '', currency: '', min_price: '', max_price: '', min_ppsqm: '', max_ppsqm: '',
  min_bedrooms: '', max_bedrooms: '', min_area: '', max_area: '', sort: 'computed_desc',
};
type PDraft = typeof P_DEFAULTS;
const split = (v: string) => (v ? v.split(',').filter(Boolean) : []);

function PropertiesTab() {
  const { t, lang } = useLanguage();
  const [applied, setApplied] = useQueryState(P_DEFAULTS);
  const [draft, setDraft] = React.useState<PDraft>(applied);
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<PropertySegmentRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    const { sort, ...rest } = applied;
    const f: PropertySegmentFilters = {
      ...rest, segments: split(rest.segments), confidence: split(rest.confidence), property_types: split(rest.property_types),
    };
    listPropertySegments(f, sort, page, PAGE_SIZE)
      .then((r) => { if (live) { setRows(r.rows); setTotal(r.total); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, page]);

  const apply = (next: PDraft) => { setPage(1); setDraft(next); setApplied(next); };
  const set = (patch: Partial<PDraft>) => setDraft({ ...draft, ...patch });
  const segOpts = [...SEGMENTS, 'UNCOMPUTED'].map((s) => ({ value: s, label: t(segKey(s)) }));
  const confOpts = ['HIGH', 'MEDIUM', 'LOW', 'NONE'].map((s) => ({ value: s, label: t(`admin_seg_band_${s.toLowerCase()}` as TranslationKey) }));
  const typeOpts = ['APARTMENT', 'HOUSE', 'COMMERCIAL', 'LAND'].map((v) => ({ value: v, label: t(`prop_type_${v.toLowerCase()}` as TranslationKey) }));

  const chips: Chip[] = [];
  const simple: Array<[keyof PDraft, string, (v: string) => string]> = [
    ['q', t('admin_bi_search'), (v) => v],
    ['level', t('admin_seg_level'), (v) => t(`admin_seg_level_${v.toLowerCase()}` as TranslationKey)],
    ['country', t('admin_bi_country'), (v) => v],
    ['city', t('admin_bi_city'), (v) => placeLabel('city', v, lang)],
    ['district', t('admin_bi_district'), (v) => placeLabel('district', v, lang)],
    ['neighborhood', t('admin_bi_neighborhood'), (v) => v],
    ['street', t('admin_seg_street'), (v) => v],
    ['transaction', t('admin_cc_transaction'), (v) => labelFor(t, 'deal', v)],
    ['currency', t('admin_bi_currency'), (v) => v],
    ['min_price', t('admin_seg_min_price'), (v) => v],
    ['max_price', t('admin_seg_max_price'), (v) => v],
    ['min_ppsqm', t('admin_seg_min_ppsqm'), (v) => usd(Number(v))],
    ['max_ppsqm', t('admin_seg_max_ppsqm'), (v) => usd(Number(v))],
    ['min_bedrooms', t('admin_bi_min_bedrooms'), (v) => v],
    ['max_bedrooms', t('admin_bi_max_bedrooms'), (v) => v],
    ['min_area', t('admin_bi_min_area'), (v) => `${v} m²`],
    ['max_area', t('admin_bi_max_area'), (v) => `${v} m²`],
  ];
  for (const [k, label, fmt] of simple) {
    if (applied[k]) chips.push({ id: k, label: `${label}: ${fmt(applied[k])}`, onRemove: () => apply({ ...applied, [k]: '' }) });
  }
  for (const [k, label, options] of [
    ['segments', t('admin_seg_segment'), segOpts], ['confidence', t('admin_bi_confidence'), confOpts],
    ['property_types', t('admin_cc_dim_property_type'), typeOpts],
  ] as Array<[keyof PDraft, string, Array<{ value: string; label: string }>]>) {
    for (const v of split(applied[k])) {
      chips.push({ id: `${k}:${v}`, label: `${label}: ${options.find((o) => o.value === v)?.label ?? v}`,
        onRemove: () => apply({ ...applied, [k]: split(applied[k]).filter((x) => x !== v).join(',') }) });
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <FilterBar
        busy={loading}
        onApply={() => apply(draft)}
        onReset={() => apply({ ...P_DEFAULTS })}
        primary={<>
          <TextFilter label={t('admin_bi_search')} value={draft.q} placeholder="482915" onChange={(v) => set({ q: v })} />
          <PlaceInput kind="city" label={t('admin_bi_city')} value={draft.city}
                      onChange={(v) => set({ city: v, district: v === draft.city ? draft.district : '', neighborhood: v === draft.city ? draft.neighborhood : '', street: v === draft.city ? draft.street : '' })} />
          <PlaceInput kind="district" label={t('admin_bi_district')} value={draft.district} city={draft.city}
                      onChange={(v) => set({ district: v, neighborhood: v === draft.district ? draft.neighborhood : '', street: v === draft.district ? draft.street : '' })} />
          <SelectFilter label={t('admin_cc_transaction')} value={draft.transaction} onChange={(v) => set({ transaction: v })}
                        options={['SALE', 'RENT'].map((v) => ({ value: v, label: labelFor(t, 'deal', v) }))} />
        </>}
        more={<>
          <SelectFilter label={t('admin_bi_country')} value={draft.country} onChange={(v) => set({ country: v })}
                        options={[{ value: 'GE', label: t('admin_bi_country_ge') }]} />
          <TextFilter label={t('admin_bi_neighborhood')} value={draft.neighborhood} onChange={(v) => set({ neighborhood: v })} />
          <TextFilter label={t('admin_seg_street')} value={draft.street} onChange={(v) => set({ street: v })} />
          <SelectFilter label={t('admin_seg_level')} value={draft.level} onChange={(v) => set({ level: v })}
                        options={LEVELS.map((l) => ({ value: l, label: t(`admin_seg_level_${l.toLowerCase()}` as TranslationKey) }))} />
          <SelectFilter label={t('admin_bi_currency')} value={draft.currency} onChange={(v) => set({ currency: v })}
                        options={['USD', 'GEL', 'EUR'].map((c) => ({ value: c, label: c }))} />
          <NumberFilter label={t('admin_seg_min_price')} value={draft.min_price} onChange={(v) => set({ min_price: v })} />
          <NumberFilter label={t('admin_seg_max_price')} value={draft.max_price} onChange={(v) => set({ max_price: v })} />
          <NumberFilter label={t('admin_seg_min_ppsqm')} value={draft.min_ppsqm} onChange={(v) => set({ min_ppsqm: v })} />
          <NumberFilter label={t('admin_seg_max_ppsqm')} value={draft.max_ppsqm} onChange={(v) => set({ max_ppsqm: v })} />
          <NumberFilter label={t('admin_bi_min_bedrooms')} value={draft.min_bedrooms} onChange={(v) => set({ min_bedrooms: v })} />
          <NumberFilter label={t('admin_bi_max_bedrooms')} value={draft.max_bedrooms} onChange={(v) => set({ max_bedrooms: v })} />
          <NumberFilter label={t('admin_bi_min_area')} value={draft.min_area} onChange={(v) => set({ min_area: v })} />
          <NumberFilter label={t('admin_bi_max_area')} value={draft.max_area} onChange={(v) => set({ max_area: v })} />
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-3">
            <MultiToggle label={t('admin_seg_segment')} options={segOpts} value={split(draft.segments)} onChange={(v) => set({ segments: v.join(',') })} />
            <MultiToggle label={t('admin_bi_confidence')} options={confOpts} value={split(draft.confidence)} onChange={(v) => set({ confidence: v.join(',') })} />
            <MultiToggle label={t('admin_cc_dim_property_type')} options={typeOpts} value={split(draft.property_types)} onChange={(v) => set({ property_types: v.join(',') })} />
          </div>
        </>}
      />
      <ActiveChips chips={chips} onClear={() => apply({ ...P_DEFAULTS, sort: applied.sort })} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_bi_results', { count: total })}</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('admin_bi_sort')}
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" value={applied.sort}
                  onChange={(e) => { setPage(1); setApplied({ ...applied, sort: e.target.value }); }}>
            {['computed_desc', 'price_asc', 'price_desc', 'ppsqm_asc', 'ppsqm_desc', 'confidence_desc', 'homatch_id'].map((s) => (
              <option key={s} value={s}>{t(`admin_seg_sort_${s}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? <Empty>{t('admin_seg_empty')}</Empty> : (
            <ul>
              {rows.map((r) => (
                <li key={r.property_id} className="border-t border-border first:border-0">
                  <button type="button" aria-expanded={open === r.property_id} onClick={() => setOpen(open === r.property_id ? null : r.property_id)}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">{r.homatch_id ? `#${r.homatch_id} ` : ''}{r.title ?? ''}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[placeLabel('city', r.city, lang), placeLabel('district', r.district, lang), r.street].filter((x) => x && x !== '—').join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={r.segment === 'UNKNOWN' || r.segment === 'UNCOMPUTED' ? 'outline' : 'default'} className="text-2xs">{t(segKey(r.segment))}</Badge>
                      {r.level && <Badge variant="secondary" className="text-2xs">{t(`admin_seg_level_${r.level.toLowerCase()}` as TranslationKey)}</Badge>}
                      {r.price_per_sqm_usd != null && <span dir="ltr" className="text-2xs tabular-nums text-muted-foreground">{usd(r.price_per_sqm_usd)}/m²</span>}
                    </span>
                  </button>
                  {open === r.property_id && <PropertyReason r={r} />}
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

function PropertyReason({ r }: { r: PropertySegmentRow }) {
  const { t } = useLanguage();
  const b = r.basis ?? {};
  const th = b.thresholds;
  return (
    <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
      <KV rows={[
        [t('admin_seg_reason'), t(`admin_seg_reason_${String(b.reason ?? 'uncomputed').toLowerCase()}` as TranslationKey)],
        [t('admin_seg_owner'), <UserLine user={r.owner} />],
        [t('admin_cc_transaction'), labelFor(t, 'deal', r.transaction)],
        [t('admin_cc_dim_property_type'), r.property_type ? t(`prop_type_${r.property_type.toLowerCase()}` as TranslationKey) : '—'],
        [t('admin_seg_asking_price'), r.price != null ? <span dir="ltr">{`${Math.round(r.price).toLocaleString('en-US')} ${r.currency ?? ''}`}</span> : '—'],
        [t('admin_cc_dim_area'), r.area != null ? `${r.area} m²` : '—'],
        [t('admin_seg_ppsqm_usd'), <span dir="ltr">{usd(b.subjectPricePerSqmUsd)}</span>],
        [t('admin_seg_thresholds'), th ? <span dir="ltr">{`≤ ${usd(th.economyMax)} · ${usd(th.median)} · ≥ ${usd(th.premiumMin)}`}</span> : '—'],
        [t('admin_seg_percentile'), r.percentile != null ? `${Math.round(Number(r.percentile) * 100)}` : '—'],
        [t('admin_bi_confidence'), r.confidence != null ? `${Math.round(Number(r.confidence) * 100)}% · ${t(`admin_seg_band_${String(r.confidence_band ?? 'none').toLowerCase()}` as TranslationKey)}` : '—'],
        [t('admin_seg_dispersion'), b.dispersion != null ? String(b.dispersion) : '—'],
        [t('admin_seg_rule_version'), r.version != null ? `v${r.version}` : '—'],
        [t('admin_seg_computed'), <When at={r.computed_at} />],
      ]} />
      {(b.levelsTried ?? []).length > 0 && (
        <div>
          <p className="text-2xs font-medium text-muted-foreground">{t('admin_seg_levels_tried')}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {(b.levelsTried ?? []).map((l) => (
              <li key={l.level}>
                <Badge variant={l.sufficient ? 'default' : 'outline'} className="text-2xs">
                  {t(`admin_seg_level_${l.level.toLowerCase()}` as TranslationKey)} · {l.key ? t('admin_seg_sample', { count: l.sampleSize }) : t('admin_seg_no_key')}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── areas ────────────────────────────────────────────────────────── */

function AreasTab() {
  const { t, lang } = useLanguage();
  const [areas, setAreas] = React.useState<SegmentArea[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [onlyThin, setOnlyThin] = React.useState(false);
  React.useEffect(() => {
    getSegmentAreas(null).then((r) => setAreas(r.areas)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const shown = (areas ?? []).filter((a) => !onlyThin || !a.sufficient);
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_seg_areas_note')}</p>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onlyThin} onChange={(e) => setOnlyThin(e.target.checked)} />
          {t('admin_seg_only_insufficient')}
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {!areas && !error && <Skeleton className="h-32 w-full" />}
      {areas && shown.length === 0 && <Empty>{t('admin_seg_no_areas')}</Empty>}
      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-xs">
            <thead className="bg-muted/50 text-2xs text-muted-foreground">
              <tr>
                {['admin_seg_area', 'admin_cc_transaction', 'admin_cc_dim_property_type', 'admin_seg_sample_size',
                  'admin_seg_economy_max', 'admin_seg_median', 'admin_seg_premium_min', 'admin_bi_confidence', 'admin_seg_evidence'].map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={`${a.transaction}:${a.property_type}:${a.city}:${a.district ?? ''}`} className="border-t border-border">
                  <td className="px-3 py-2">
                    {placeLabel('city', a.city, lang)}{a.district ? ` · ${placeLabel('district', a.district, lang)}` : ''}
                    <span className="block text-2xs text-muted-foreground">{t(`admin_seg_level_${a.level.toLowerCase()}` as TranslationKey)}</span>
                  </td>
                  <td className="px-3 py-2">{labelFor(t, 'deal', a.transaction)}</td>
                  <td className="px-3 py-2">{t(`prop_type_${a.property_type.toLowerCase()}` as TranslationKey)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {a.sample_size}
                    {!a.sufficient && <Badge variant="outline" className="ms-1.5 text-2xs text-destructive">{t('admin_seg_insufficient')}</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{usd(a.economy_max)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{usd(a.median)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{usd(a.premium_min)}</td>
                  <td className="px-3 py-2 tabular-nums">{a.sufficient ? `${Math.round(a.confidence * 100)}%` : '—'}</td>
                  <td className="px-3 py-2 text-2xs text-muted-foreground">
                    {(a.sources ?? []).join(', ')}
                    {a.no_fx_rate > 0 && <span className="block">{t('admin_seg_no_fx', { count: a.no_fx_rate })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── rules: editor, preview, apply, audit ─────────────────────────── */

function RulesTab({ rules, onChanged }: { rules: SegmentRulesView | null; onChanged: () => void }) {
  const { t } = useLanguage();
  const active = rules?.rules.find((r) => r.status === 'ACTIVE') ?? null;
  const [params, setParams] = React.useState<SegmentParams | null>(null);
  const [note, setNote] = React.useState('');
  const [preview, setPreview] = React.useState<SegmentPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [done, setDone] = React.useState<string | null>(null);

  React.useEffect(() => { if (active && !params) setParams({ ...active.params }); }, [active, params]);
  if (!rules || !params) return <Skeleton className="mt-3 h-40 w-full" />;

  const edit = (patch: Partial<SegmentParams>) => { setParams({ ...params, ...patch }); setPreview(null); setDone(null); };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const doPreview = () => run(async () => { setPreview(await previewSegmentRule(params)); });
  const doApply = () => run(async () => {
    if (!preview) return;
    const ruleId = active && sameParams(active.params, preview.params) ? active.id : (await saveSegmentDraft(preview.params, note)).id;
    const res = await applySegmentRule(ruleId, preview.changed_count, preview.confirmation_token);
    setConfirmOpen(false); setTyped(''); setPreview(null);
    setDone(t('admin_seg_applied', { count: res.rows_written, changed: res.changed_count }));
    onChanged();
  });
  const pct = (v: number) => String(Math.round(v * 100));

  return (
    <div className="mt-3 space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t('admin_seg_editor')}</h2>
          <p className="text-xs text-muted-foreground">{t('admin_seg_editor_note')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('admin_seg_min_comparables')}>
              <input type="number" min={3} className={inputClass} value={params.minComparables}
                     onChange={(e) => edit({ minComparables: Number(e.target.value) })} />
            </Field>
            <Field label={t('admin_seg_economy_pct')}>
              <input type="number" min={1} max={99} className={inputClass} value={pct(params.economyPercentile)}
                     onChange={(e) => edit({ economyPercentile: Number(e.target.value) / 100 })} />
            </Field>
            <Field label={t('admin_seg_premium_pct')}>
              <input type="number" min={1} max={99} className={inputClass} value={pct(params.premiumPercentile)}
                     onChange={(e) => edit({ premiumPercentile: Number(e.target.value) / 100 })} />
            </Field>
            <Field label={t('admin_seg_min_area')}>
              <input type="number" min={1} className={inputClass} value={params.minAreaSqm}
                     onChange={(e) => edit({ minAreaSqm: Number(e.target.value) })} />
            </Field>
          </div>
          <MultiToggle label={t('admin_seg_levels')} value={params.levels}
                       options={LEVELS.map((l) => ({ value: l, label: t(`admin_seg_level_${l.toLowerCase()}` as TranslationKey) }))}
                       onChange={(v) => edit({ levels: LEVELS.filter((l) => v.includes(l)) })} />
          <Field label={t('admin_seg_note')}>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={doPreview} disabled={busy}>{t('admin_seg_preview')}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setParams({ ...(active?.params ?? params) }); setPreview(null); }}>
              {t('admin_cc_reset')}
            </Button>
          </div>
          {error && <ErrorNote message={error} />}
          {done && <p role="status" className="text-xs text-foreground">{done}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('admin_seg_preview_title')}</h2>
            <p className="text-xs text-muted-foreground">{t('admin_seg_preview_note')}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-xs">
                <thead className="text-2xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 text-start font-medium">{t('admin_seg_segment')}</th>
                    <th scope="col" className="py-1 text-end font-medium">{t('admin_seg_before')}</th>
                    <th scope="col" className="py-1 text-end font-medium">{t('admin_seg_after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...SEGMENTS, 'UNCOMPUTED'].map((s) => (
                    <tr key={s} className="border-t border-border">
                      <td className="py-1">{t(segKey(s))}</td>
                      <td className="py-1 text-end tabular-nums">{preview.before[s] ?? 0}</td>
                      <td className="py-1 text-end tabular-nums">{preview.after[s] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm font-medium">{t('admin_seg_changed', { count: preview.changed_count })}</p>
            {preview.changed.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {preview.changed.map((c) => (
                  <li key={c.property_id} className="flex flex-wrap gap-x-2">
                    <span className="font-mono">{c.homatch_id ? `#${c.homatch_id}` : c.property_id.slice(0, 8)}</span>
                    <span>{t(segKey(c.before ?? 'UNCOMPUTED'))} → {t(segKey(c.after))}</span>
                    <span className="text-muted-foreground">{t(`admin_seg_reason_${c.reason.toLowerCase()}` as TranslationKey)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
              {t('admin_seg_apply')}
            </Button>
          </CardContent>
        </Card>
      )}

      <Confirm
        open={confirmOpen}
        onOpenChange={(v) => { setConfirmOpen(v); if (!v) setTyped(''); }}
        title={t('admin_seg_confirm_title')}
        description={t('admin_seg_confirm_body', { count: preview?.changed_count ?? 0 })}
        confirmLabel={t('admin_seg_apply')}
        destructive
        busy={busy}
        confirmDisabled={!preview || typed.trim() !== String(preview.changed_count)}
        onConfirm={doApply}
      >
        <Field label={t('admin_seg_confirm_type', { count: preview?.changed_count ?? 0 })}>
          <input className={inputClass} inputMode="numeric" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Confirm>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">{t('admin_seg_rules')}</h2>
          <ul className="space-y-1.5 text-xs">
            {rules.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">v{r.version}</span>
                <Badge variant={r.status === 'ACTIVE' ? 'default' : 'outline'} className="text-2xs">{t(`admin_seg_status_${r.status.toLowerCase()}` as TranslationKey)}</Badge>
                <span dir="ltr" className="text-muted-foreground">
                  {`n≥${r.params.minComparables} · P${pct(r.params.economyPercentile)}/P${pct(r.params.premiumPercentile)} · ${r.params.levels.join('→')}`}
                </span>
                {r.note && <span className="text-muted-foreground">{r.note}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">{t('admin_seg_audit')}</h2>
          {rules.audit.length === 0 ? <p className="text-xs text-muted-foreground">{t('admin_seg_audit_empty')}</p> : (
            <ul className="space-y-2 text-xs">
              {rules.audit.map((a) => (
                <li key={a.id} className="rounded-md border border-border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-2xs">{t(`admin_seg_action_${a.action.toLowerCase()}` as TranslationKey)}</Badge>
                    {a.version != null && <span className="font-mono">v{a.version}</span>}
                    <span className="text-muted-foreground"><When at={a.created_at} /></span>
                    {a.changed_count != null && <span>{t('admin_seg_changed', { count: a.changed_count })}</span>}
                  </div>
                  {a.actor && <div className="mt-1"><UserLine user={a.actor} /></div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
