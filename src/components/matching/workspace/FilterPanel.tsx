// Matching workspace — the filters, for one product at a time.
//
// Every filter is applied on the server and kept in the URL. Shared: country (searchable,
// Georgian and English names), language (searchable, incl. "Unknown" — never inferred from a
// country), interest (BUY / RENT / INVEST, multi) and a debounced keyword. External adds lead
// category, contact channels, source, dates and a location text; Internal keeps the feed's own
// criteria (one per group), district and property type. Active filters read back as chips.

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { chipClass } from '@/components/leads/kit';
import { useLanguage } from '@/contexts/LanguageContext';
import { propertyTypeLabel } from '@/leads/leadSummary';
import { countryOptions } from '@/lib/comm/countries';
import { cn } from '@/lib/utils';
import type { LeadFilter } from '@/services/homatchLeads';
import type { MatchingFilters } from '@/services/matchingWorkspace';
import { countryName, flagOf, formatCount, languageName } from './format';
import { type MultiOption, MultiSelect } from './MultiSelect';
import {
  activeFilters, CATEGORIES, CHANNELS, INTERESTS, INTERNAL_GROUPS, 
  type InternalCriteria, SOURCES, toggleCriterion,type WsProduct,
} from './urlState';

const COMMON_LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he', 'uk', 'de', 'fr', 'es', 'it', 'hy', 'az', 'fa', 'zh', 'pl', 'kk'];
const CRITERION_KEY: Partial<Record<LeadFilter, string>> = {
  EXACT: 'hl_cat_EXACT', NEARBY: 'hl_cat_NEARBY_SIMILAR', VIP: 'hl_cat_VIP', STRONG: 'hl_filter_strong', POTENTIAL: 'hl_filter_potential',
  HIGH_CONFIDENCE: 'hl_filter_high_confidence', DIRECT: 'hl_filter_direct', BROKER: 'hl_filter_broker', FRESH: 'hl_filter_fresh',
};

export interface FilterFacets {
  countries: Record<string, number>;
  languages: Record<string, number>;
  interests: Record<string, number>;
  districts?: string[];
  propertyTypes?: string[];
  criteriaCounts?: Partial<Record<LeadFilter, number>>;
}

const FIELD = 'flex min-w-0 flex-col gap-1 text-xs font-semibold text-[hsl(224_14%_30%)]';
const INPUT = 'min-h-11 w-full min-w-0 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold text-[hsl(224_14%_12%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]';

export function FilterPanel({
  product, filters, internal, facets, onChange, extra,
}: {
  product: WsProduct;
  filters: MatchingFilters;
  internal: InternalCriteria;
  facets: FilterFacets | null;
  onChange: (filters: MatchingFilters, internal: InternalCriteria) => void;
  /** Sort / page size controls, rendered on the filters' own row. */
  extra?: ReactNode;
}) {
  const { t, lang } = useLanguage();
  const fmt = (n: number) => formatCount(n, lang);
  const [more, setMore] = useState(false);
  const set = (patch: Partial<MatchingFilters>) => onChange({ ...filters, ...patch }, internal);
  const setInternal = (patch: Partial<InternalCriteria>) => onChange(filters, { ...internal, ...patch });

  /* The keyword is debounced: the URL (and the server) see it 350 ms after the last key. */
  const [q, setQ] = useState(filters.q);
  const lastSent = useRef(filters.q);
  useEffect(() => { if (filters.q !== lastSent.current) { lastSent.current = filters.q; setQ(filters.q); } }, [filters.q]);
  const setRef = useRef(set);
  setRef.current = set;
  useEffect(() => {
    if (q === lastSent.current) return undefined;
    const timer = window.setTimeout(() => { lastSent.current = q; setRef.current({ q }); }, 350);
    return () => window.clearTimeout(timer);
  }, [q]);

  const countryOpts = useMemo<MultiOption[]>(() => {
    const local = countryOptions(lang);
    const english = new Map(countryOptions('en').map((c) => [c.code as string, c.name]));
    const counts = facets?.countries ?? {};
    const known = new Set(local.map((c) => c.code as string));
    const extraCodes = Object.keys(counts).filter((c) => !known.has(c) && /^[A-Z]{2}$/.test(c));
    return [
      ...local.map((c) => ({ value: c.code as string, label: c.name, search: `${english.get(c.code) ?? ''} ${countryName(c.code, 'ka')}`, count: counts[c.code] ?? null, leading: flagOf(c.code) })),
      ...extraCodes.map((c) => ({ value: c, label: countryName(c, lang), search: countryName(c, 'en'), count: counts[c], leading: flagOf(c) })),
    ];
  }, [lang, facets?.countries]);

  const languageOpts = useMemo<MultiOption[]>(() => {
    const counts = facets?.languages ?? {};
    const codes = [...new Set([...COMMON_LANGUAGES, ...Object.keys(counts).filter((c) => c !== 'unknown')])];
    return [
      ...codes.map((c) => ({ value: c, label: languageName(c, lang), search: `${languageName(c, 'en')} ${languageName(c, 'ka')}`, count: counts[c] ?? null })),
      { value: 'unknown', label: t('mw_lang_unknown'), search: 'unknown', count: counts.unknown ?? null },
    ];
  }, [lang, facets?.languages, t]);

  const toggle = <T extends string>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const n = activeFilters(product, filters, internal);
  const moreCount = product === 'external'
    ? filters.channels.length + filters.categories.length + filters.sources.length + (filters.addedSince ? 1 : 0) + (filters.verifiedSince ? 1 : 0) + (filters.location.trim() ? 1 : 0)
    : internal.criteria.length + (internal.district ? 1 : 0) + (internal.propertyType ? 1 : 0);

  /* What is set, as removable chips. */
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  for (const c of filters.countries) chips.push({ key: `c-${c}`, label: `${flagOf(c)} ${countryName(c, lang)}`.trim(), clear: () => set({ countries: filters.countries.filter((x) => x !== c) }) });
  for (const l of filters.languages) chips.push({ key: `l-${l}`, label: l === 'unknown' ? t('mw_lang_unknown') : languageName(l, lang), clear: () => set({ languages: filters.languages.filter((x) => x !== l) }) });
  for (const i of filters.interests) chips.push({ key: `i-${i}`, label: t(`mw_interest_${i}`), clear: () => set({ interests: filters.interests.filter((x) => x !== i) }) });
  if (filters.q.trim()) chips.push({ key: 'q', label: `“${filters.q.trim()}”`, clear: () => { setQ(''); set({ q: '' }); } });
  if (product === 'external') {
    for (const c of filters.channels) chips.push({ key: `ch-${c}`, label: t(`mw_ch_${c}`), clear: () => set({ channels: filters.channels.filter((x) => x !== c) }) });
    for (const c of filters.categories) chips.push({ key: `cat-${c}`, label: t(`mw_category_${c}`), clear: () => set({ categories: filters.categories.filter((x) => x !== c) }) });
    for (const s of filters.sources) chips.push({ key: `src-${s}`, label: t(`mw_source_${s}`), clear: () => set({ sources: filters.sources.filter((x) => x !== s) }) });
    if (filters.addedSince) chips.push({ key: 'added', label: t('mw_chip_added', { date: filters.addedSince }), clear: () => set({ addedSince: null }) });
    if (filters.verifiedSince) chips.push({ key: 'verified', label: t('mw_chip_verified', { date: filters.verifiedSince }), clear: () => set({ verifiedSince: null }) });
    if (filters.location.trim()) chips.push({ key: 'loc', label: filters.location.trim(), clear: () => set({ location: '' }) });
  } else {
    for (const c of internal.criteria) chips.push({ key: `f-${c}`, label: t(CRITERION_KEY[c] ?? c), clear: () => setInternal({ criteria: internal.criteria.filter((x) => x !== c) }) });
    if (internal.district) chips.push({ key: 'district', label: internal.district, clear: () => setInternal({ district: null }) });
    if (internal.propertyType) chips.push({ key: 'type', label: propertyTypeLabel([internal.propertyType], t) ?? internal.propertyType, clear: () => setInternal({ propertyType: null }) });
  }

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-card sm:p-4" data-testid="mw-filters" aria-label={t('mw_filters_label')}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="relative min-w-0 sm:col-span-2 lg:col-span-1">
          <span className="sr-only">{t('mw_search_label')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mw_search_placeholder')}
            className={cn(INPUT, 'ps-9')} data-testid="mw-search" />
        </label>
        <MultiSelect label={t('mw_filter_country')} options={countryOpts} selected={filters.countries}
          onChange={(countries) => set({ countries })} searchPlaceholder={t('mw_filter_country_search')} emptyText={t('mw_filter_none_found')}
          clearText={t('mw_clear')} testId="mw-country" formatCount={fmt} />
        <MultiSelect label={t('mw_filter_language')} options={languageOpts} selected={filters.languages}
          onChange={(languages) => set({ languages })} searchPlaceholder={t('mw_filter_language_search')} emptyText={t('mw_filter_none_found')}
          clearText={t('mw_clear')} testId="mw-language" formatCount={fmt} />
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="mw-more-filters"
          className={cn(chipClass(more || moreCount > 0), 'justify-center rounded-xl')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t('mw_more_filters')}
          {moreCount ? <span className="tabular-nums" dir="ltr">{moreCount}</span> : null}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={t('mw_filter_interest')}>
        {INTERESTS.map((i) => (
          <button key={i} type="button" className={chipClass(filters.interests.includes(i))} aria-pressed={filters.interests.includes(i)}
            data-interest={i} onClick={() => set({ interests: toggle(filters.interests, i) })}>
            {t(`mw_interest_${i}`)}
            {facets?.interests?.[i] != null ? <span className="tabular-nums opacity-70" dir="ltr">{fmt(facets.interests[i])}</span> : null}
          </button>
        ))}
        {extra ? <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">{extra}</div> : null}
      </div>

      {more ? (
        <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3" data-testid="mw-more-panel">
          {product === 'external' ? (
            <>
              <ChipGroup label={t('mw_filter_channels')} values={CHANNELS} selected={filters.channels} labelOf={(c) => t(`mw_ch_${c}`)}
                onToggle={(c) => set({ channels: toggle(filters.channels, c) })} attr="channel" />
              <ChipGroup label={t('mw_filter_category')} values={CATEGORIES} selected={filters.categories} labelOf={(c) => t(`mw_category_${c}`)}
                onToggle={(c) => set({ categories: toggle(filters.categories, c) })} attr="category" />
              <ChipGroup label={t('mw_filter_source')} values={SOURCES} selected={filters.sources} labelOf={(c) => t(`mw_source_${c}`)}
                onToggle={(c) => set({ sources: toggle(filters.sources, c) })} attr="source" />
              <div className="grid gap-2 sm:grid-cols-3">
                <label className={FIELD}><span>{t('mw_filter_added_since')}</span>
                  <input type="date" className={INPUT} value={filters.addedSince ?? ''} onChange={(e) => set({ addedSince: e.target.value || null })} data-testid="mw-added" />
                </label>
                <label className={FIELD}><span>{t('mw_filter_verified_since')}</span>
                  <input type="date" className={INPUT} value={filters.verifiedSince ?? ''} onChange={(e) => set({ verifiedSince: e.target.value || null })} data-testid="mw-verified" />
                </label>
                <label className={FIELD}><span>{t('mw_filter_location')}</span>
                  <input type="text" className={INPUT} defaultValue={filters.location} key={filters.location}
                    onBlur={(e) => { if (e.target.value !== filters.location) set({ location: e.target.value }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') set({ location: (e.target as HTMLInputElement).value }); }}
                    placeholder={t('mw_filter_location_placeholder')} data-testid="mw-location" />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[hsl(224_14%_30%)]">{t('mw_filter_match')}</p>
                <div className="flex flex-wrap gap-2">
                  {INTERNAL_GROUPS.map((group, gi) => (
                    <div key={gi} className="flex flex-wrap gap-2">
                      {group.map((c) => (
                        <button key={c} type="button" className={chipClass(internal.criteria.includes(c))} aria-pressed={internal.criteria.includes(c)}
                          data-criterion={c} onClick={() => setInternal({ criteria: toggleCriterion(internal.criteria, c) })}>
                          {t(CRITERION_KEY[c] ?? c)}
                          {facets?.criteriaCounts?.[c] != null ? <span className="tabular-nums opacity-70" dir="ltr">{fmt(facets.criteriaCounts[c] ?? 0)}</span> : null}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={FIELD}><span>{t('hl_filter_location')}</span>
                  <select className={INPUT} value={internal.district ?? ''} onChange={(e) => setInternal({ district: e.target.value || null })} data-testid="mw-district">
                    <option value="">{t('hl_filter_any')}</option>
                    {(facets?.districts ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label className={FIELD}><span>{t('hl_filter_type')}</span>
                  <select className={INPUT} value={internal.propertyType ?? ''} onChange={(e) => setInternal({ propertyType: e.target.value || null })} data-testid="mw-type">
                    <option value="">{t('hl_filter_any')}</option>
                    {(facets?.propertyTypes ?? []).map((v) => <option key={v} value={v}>{propertyTypeLabel([v], t) ?? v}</option>)}
                  </select>
                </label>
              </div>
            </>
          )}
        </div>
      ) : null}

      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="mw-filter-chips">
          <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mw_active_filters', { n })}</span>
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={c.clear} data-chip={c.key}
              className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-2.5 text-xs font-semibold text-[hsl(var(--gold-ink))]"
              aria-label={t('mw_remove_filter', { filter: c.label })}>
              <span className="min-w-0 truncate">{c.label}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
          <button type="button" data-testid="mw-clear-all" className="min-h-8 px-2 text-xs font-semibold text-[hsl(218_45%_20%)] underline underline-offset-4"
            onClick={() => { setQ(''); lastSent.current = ''; onChange({ ...filters, countries: [], languages: [], interests: [], channels: [], categories: [], sources: [], q: '', addedSince: null, verifiedSince: null, location: '' }, { criteria: [], district: null, propertyType: null }); }}>
            {t('mw_clear_all')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ChipGroup<T extends string>({ label, values, selected, labelOf, onToggle, attr }: {
  label: string; values: T[]; selected: T[]; labelOf: (v: T) => string; onToggle: (v: T) => void; attr: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[hsl(224_14%_30%)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <button key={v} type="button" className={chipClass(selected.includes(v))} aria-pressed={selected.includes(v)}
            {...{ [`data-${attr}`]: v }} onClick={() => onToggle(v)}>{labelOf(v)}</button>
        ))}
      </div>
    </div>
  );
}
