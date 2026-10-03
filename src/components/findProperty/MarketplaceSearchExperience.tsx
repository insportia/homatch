import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CustomerSurface, PageHero } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { type SearchIntelligenceBrief, applyEdit, emptyBrief, sanitizeBrief } from '@/research-core/marketplace/brief';
import {
  MarketplaceError, type PropertyView, type SearchSummary, cancelSearch, compareTwo, propertyDetail,
  searchStatus, startSearch, understand,
} from '@/services/marketplaceSearch';
import type { ComparisonRow } from '@/research-core/marketplace/comparison';
import { CompareView } from './CompareView';
import { PropertyIntelligence } from './PropertyIntelligence';
import { ResultsView } from './ResultsView';
import { BuilderIntro, SearchBuilder } from './SearchBuilder';
import { SearchModeSelect } from './SearchModeSelect';
import { SearchingView } from './SearchingView';

type View = 'LOADING' | 'MODE' | 'INTRO' | 'BUILD' | 'SEARCH' | 'RESULTS';
const POLL_MS = 4000;
const DRAFT_KEY = 'homatch.findProperty.draft.v1';

/* Per-viewer convenience only: an unsent draft survives a refresh. The search itself lives on the server. */
const readDraft = (): SearchIntelligenceBrief | null => {
  try { const raw = sessionStorage.getItem(DRAFT_KEY); return raw ? sanitizeBrief(JSON.parse(raw)) : null; } catch { return null; }
};
const writeDraft = (b: SearchIntelligenceBrief | null) => {
  try { if (b) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(b)); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
};

export function MarketplaceSearchExperience({ deepSearchAvailable }: { deepSearchAvailable: boolean }) {
  const { t, isRTL } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('LOADING');
  const [text, setText] = useState('');
  const [brief, setBrief] = useState<SearchIntelligenceBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<SearchSummary | null>(null);
  const [resultsVersion, setResultsVersion] = useState(0);
  const [open, setOpen] = useState<PropertyView | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ a: PropertyView; b: PropertyView; rows: ComparisonRow[] } | null>(null);
  const idempotency = useRef<string | null>(null);
  const searchId = params.get('search');

  const setBriefAndDraft = useCallback((b: SearchIntelligenceBrief | null) => { setBrief(b); writeDraft(b); }, []);

  /* Resume: the search in the URL, else the latest one, wherever the customer left it. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { search: s } = await searchStatus(searchId ?? undefined);
        if (!alive) return;
        if (s && (!s.terminal || searchId || Date.now() - Date.parse(s.createdAt) < 6 * 3600_000)) {
          setSearch(s);
          setView(s.terminal && !s.unavailable ? 'RESULTS' : 'SEARCH');
          if (!searchId) setParams({ search: s.id }, { replace: true });
          return;
        }
      } catch { /* no search to resume */ }
      if (!alive) return;
      const draft = readDraft();
      if (draft && (draft.originalText || draft.transactionType)) { setBrief(draft); setView('BUILD'); } else setView('MODE');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Real polling while the search is open; paused while the tab is hidden. */
  useEffect(() => {
    if (!search || search.terminal || (view !== 'SEARCH' && view !== 'RESULTS')) return;
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const { search: s } = await searchStatus(search.id);
        if (!s) return;
        setSearch((prev) => {
          if (prev && (prev.counters.uniqueProperties !== s.counters.uniqueProperties || prev.status !== s.status)) setResultsVersion((v) => v + 1);
          return s;
        });
      } catch { /* next tick */ }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [search, view]);

  const doUnderstand = async () => {
    setBusy(true);
    try {
      const r = await understand(text);
      setBriefAndDraft(r.brief);
    } catch {
      /* The model being unavailable is not a dead end: every question is asked instead. */
      setBriefAndDraft(emptyBrief(text));
    } finally {
      setBusy(false);
      setView('BUILD');
    }
  };

  const doStart = async () => {
    if (!brief) return;
    setBusy(true);
    idempotency.current ??= crypto.randomUUID();
    try {
      const r = await startSearch(brief, idempotency.current);
      setSearch(r.search);
      setParams({ search: r.search.id });
      writeDraft(null);
      setView('SEARCH');
      idempotency.current = null;
    } catch (e) {
      const code = e instanceof MarketplaceError ? e.code : 'REQUEST_FAILED';
      toast.error(t(code === 'SEARCH_NOT_READY' ? 'mps_error_not_ready' : code === 'SOURCES_PAUSED' ? 'mps_error_paused' : 'mps_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const openProperty = async (p: PropertyView) => {
    setOpen(p);
    if (!search) return;
    try { const r = await propertyDetail(search.id, p.key); setOpen(r.property); } catch { /* card data stands */ }
  };

  const toggleCompare = (p: PropertyView) => setCompare((cur) => (cur.includes(p.key) ? cur.filter((k) => k !== p.key) : [...cur.slice(-1), p.key]));

  const runCompare = async () => {
    if (!search || compare.length !== 2) return;
    try { setComparison(await compareTwo(search.id, compare[0], compare[1])); } catch { toast.error(t('mps_error_generic')); }
  };

  const newSearch = () => {
    setParams({}, { replace: true });
    setSearch(null);
    setCompare([]);
    setText('');
    setBriefAndDraft(null);
    setView('MODE');
  };

  return (
    <CustomerSurface className="space-y-6">
      <div className="pt-4 sm:pt-6">
        <PageHero compact title={t('plan_page_title')} subtitle={view === 'MODE' ? null : t('mps_hero_subtitle')} />
      </div>

      {view === 'LOADING' && <div className="h-48 animate-pulse rounded-2xl bg-muted/60" aria-busy="true" />}
      {view === 'MODE' && <SearchModeSelect t={t} deepSearchAvailable={deepSearchAvailable} onMarketplace={() => setView('INTRO')} />}
      {view === 'INTRO' && <BuilderIntro t={t} text={text} onText={setText} onSubmit={() => void doUnderstand()} busy={busy} />}
      {view === 'BUILD' && brief && (
        <SearchBuilder t={t} brief={brief} onBrief={setBriefAndDraft} onStart={() => void doStart()} starting={busy}
          onReset={() => { setBriefAndDraft(null); setView('INTRO'); }} />
      )}
      {view === 'SEARCH' && search && (
        <SearchingView t={t} search={search} onViewResults={() => setView('RESULTS')}
          onCancel={async () => { try { const r = await cancelSearch(search.id); setSearch(r.search); } catch { /* ignore */ } newSearch(); }} />
      )}
      {view === 'SEARCH' && search?.terminal && (search.counters.uniqueProperties > 0 || !search.unavailable) ? (
        <ResultsRedirect onGo={() => setView('RESULTS')} />
      ) : null}
      {view === 'RESULTS' && search && (
        <ResultsView t={t} search={search} onOpen={(p) => void openProperty(p)} compare={compare} onToggleCompare={toggleCompare}
          onNewSearch={newSearch} deepSearchAvailable={deepSearchAvailable} version={resultsVersion}
          onChangeCriteria={(f) => {
            const base = sanitizeBrief(search.brief);
            setBriefAndDraft(applyEdit(base, { field: f, value: null }));
            setParams({}, { replace: true });
            setSearch(null);
            setView('BUILD');
          }} />
      )}

      {compare.length > 0 && view === 'RESULTS' ? (
        <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-[#0C1119] px-4 py-3 text-white shadow-hover" role="region" aria-label={t('mps_compare')}>
          <span className="text-sm">{t('mps_compare_selected', { n: compare.length })}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={compare.length !== 2} onClick={() => void runCompare()}
              className="inline-flex min-h-[40px] items-center rounded-xl bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119] disabled:opacity-50">{t('mps_compare_go')}</button>
            <button type="button" onClick={() => setCompare([])} aria-label={t('mps_compare_clear')} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}

      <PropertyIntelligence t={t} p={open} open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} isRTL={isRTL}
        propertyType={search?.brief.propertyType?.value ?? null}
        compareSelected={!!open && compare.includes(open.key)} onCompare={() => { if (open) toggleCompare(open); }} />
      <CompareView t={t} open={!!comparison} onOpenChange={(o) => { if (!o) setComparison(null); }}
        a={comparison?.a ?? null} b={comparison?.b ?? null} rows={comparison?.rows ?? []} />
    </CustomerSurface>
  );
}

/* A finished search moves on to its results by itself. */
function ResultsRedirect({ onGo }: { onGo: () => void }) {
  useEffect(() => { const id = window.setTimeout(onGo, 600); return () => window.clearTimeout(id); }, [onGo]);
  return null;
}
