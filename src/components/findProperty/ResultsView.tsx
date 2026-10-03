import { Loader2, RotateCcw, Search } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import type { ResultGroup } from '@/research-core/marketplace/pipeline';
import { type PropertyView, type SearchSummary, searchResults } from '@/services/marketplaceSearch';
import { PropertyCard } from './PropertyCard';
import { DeepSearchCard } from './SearchModeSelect';
import { type T, criteriaChips } from './format';

const GROUPS: Array<{ group: ResultGroup; title: string; body?: string; size: number }> = [
  { group: 'BEST', title: 'mps_group_best', size: 6 },
  { group: 'OWNER', title: 'mps_group_owner', size: 6 },
  { group: 'UPGRADE', title: 'mps_group_upgrade', body: 'mps_group_upgrade_body', size: 3 },
  { group: 'MORE', title: 'mps_group_more', size: 12 },
];

function GroupSection({ t, search, group, title, body, size, onOpen, compare, onToggleCompare, version }: {
  t: T; search: SearchSummary; group: ResultGroup; title: string; body?: string; size: number;
  onOpen: (p: PropertyView) => void; compare: string[]; onToggleCompare: (p: PropertyView) => void; version: number;
}) {
  const [items, setItems] = useState<PropertyView[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const total = search.groups[group] ?? 0;
  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await searchResults(search.id, group, offset, size);
      setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
      setNext(page.nextOffset);
    } finally {
      setLoading(false);
    }
  }, [search.id, group, size]);
  useEffect(() => { if (total) void load(0); else setItems([]); }, [total, version, load]);
  if (!total) return null;
  return (
    <section aria-labelledby={`mps-g-${group}`} className="space-y-4">
      <div className="space-y-1">
        <h2 id={`mps-g-${group}`} className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground sm:text-2xl">{t(title)}</h2>
        {body ? <p className="max-w-[70ch] text-[15px] text-muted-foreground">{t(body)}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <PropertyCard key={p.key} p={p} t={t} onOpen={() => onOpen(p)} compareSelected={compare.includes(p.key)} onToggleCompare={() => onToggleCompare(p)} />
        ))}
      </div>
      {next !== null ? (
        <button type="button" onClick={() => void load(next)} disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('mps_show_more')}
        </button>
      ) : null}
    </section>
  );
}

export function ResultsView({ t, search, onOpen, compare, onToggleCompare, onNewSearch, onChangeCriteria, deepSearchAvailable, version }: {
  t: T; search: SearchSummary; onOpen: (p: PropertyView) => void; compare: string[]; onToggleCompare: (p: PropertyView) => void;
  onNewSearch: () => void; onChangeCriteria: (field: 'price' | 'area') => void; deepSearchAvailable: boolean; version: number;
}) {
  const chips = criteriaChips(search.brief, t);
  const totalShown = Object.values(search.groups).reduce((s, n) => s + n, 0);
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ul className="flex min-w-0 flex-wrap gap-2" aria-label={t('mps_your_search')}>
          {chips.map((c) => <li key={c.key} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm" dir="auto">{c.label}</li>)}
        </ul>
        <button type="button" onClick={onNewSearch}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
          <Search className="h-4 w-4" aria-hidden="true" />{t('mps_new_search')}
        </button>
      </div>

      {!search.terminal ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('mps_progressive_body')}
        </p>
      ) : null}
      {search.partial ? (
        <div className="hm-discovery-panel space-y-1 p-4" role="status">
          <p className="font-semibold text-foreground">{t('mps_partial_title')}</p>
          <p className="text-sm text-muted-foreground">{t('mps_partial_body')}</p>
        </div>
      ) : null}

      {search.terminal && totalShown === 0 ? (
        <section className="hm-discovery-panel space-y-4 p-6 sm:p-8" aria-labelledby="mps-empty">
          <h2 id="mps-empty" className="font-display text-xl font-semibold text-foreground">{t('mps_empty_title')}</h2>
          <p className="text-[15px] text-muted-foreground">{t('mps_empty_body')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onChangeCriteria('area')} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('mps_empty_area')}</button>
            <button type="button" onClick={() => onChangeCriteria('price')} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('mps_empty_budget')}</button>
          </div>
        </section>
      ) : null}

      {GROUPS.map((g) => (
        <GroupSection key={g.group} t={t} search={search} group={g.group} title={g.title} body={g.body} size={g.size}
          onOpen={onOpen} compare={compare} onToggleCompare={onToggleCompare} version={version} />
      ))}

      {search.terminal ? <DeepSearchCard t={t} available={deepSearchAvailable} variant="results" /> : null}
    </div>
  );
}
