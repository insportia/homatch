import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CustomerSurface, PageHero } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { applyEdit, emptyBrief, type SearchIntelligenceBrief, sanitizeBrief } from '@/research-core/marketplace/brief';
import type { ComparisonRow } from '@/research-core/marketplace/comparison';
import {cancelSearch, compareTwo,
  MarketplaceError, type PropertyView, propertyDetail,type SearchSummary,
  searchStatus, startSearch, understand,
} from '@/services/marketplaceSearch';
import { CompareView } from './CompareView';
import { PropertyIntelligence } from './PropertyIntelligence';
import { ResultsView } from './ResultsView';
import { BuilderIntro, SearchBuilder } from './SearchBuilder';
import { SearchDashboard } from './SearchDashboard';
import { SearchingView } from './SearchingView';
import { SnakeOverlay } from './SnakeThumbnail';

type View = 'LOADING' | 'MODE' | 'INTRO' | 'BUILD' | 'SEARCH' | 'RESULTS' | 'ERROR';
const POLL_MS = 4000;
const DRAFT_KEY = 'homatch.findProperty.draft.v1';
const START_KEY = 'homatch.findProperty.startKey.v1';
const PropertyAI = React.lazy(() => import('./PropertyAI').then((module) => ({ default: module.PropertyAI })));

/* Per-viewer convenience only: an unsent draft survives a refresh. The search itself lives on the server. */
const readDraft = (): SearchIntelligenceBrief | null => {
  try { const raw = sessionStorage.getItem(DRAFT_KEY); return raw ? sanitizeBrief(JSON.parse(raw)) : null; } catch { return null; }
};
/* The start's idempotency key survives a refresh or reconnect, so a retried start replays the same search. */
/* Bound to the exact criteria it was issued for: edited criteria get a new key, never an old search. */
const startKey = (criteria: string): string => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(START_KEY) ?? 'null') as { key: string; criteria: string } | null;
    if (saved && saved.criteria === criteria) return saved.key;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(START_KEY, JSON.stringify({ key: fresh, criteria }));
    return fresh;
  } catch { return crypto.randomUUID(); }
};
const clearStartKey = () => { try { sessionStorage.removeItem(START_KEY); } catch { /* storage unavailable */ } };
const writeDraft = (b: SearchIntelligenceBrief | null) => {
  try { if (b) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(b)); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
};

export function MarketplaceSearchExperience({ deepSearchAvailable }: { deepSearchAvailable: boolean }) {
  const { t, isRTL } = useLanguage();
  const [params] = useSearchParams();
  const route = useParams<{ searchId: string; propertyKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<View>('LOADING');
  const [text, setText] = useState('');
  const [brief, setBrief] = useState<SearchIntelligenceBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<SearchSummary | null>(null);
  const [resultsVersion, setResultsVersion] = useState(0);
  const [open, setOpen] = useState<PropertyView | null>(null);
  const [propertyError, setPropertyError] = useState(false);
  const [propertyRetry, setPropertyRetry] = useState(0);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ a: PropertyView; b: PropertyView; rows: ComparisonRow[] } | null>(null);
  const idempotency = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const searchId = route.searchId ?? params.get('search');
  const justStartedId = useRef<string | null>(null);

  const setBriefAndDraft = useCallback((b: SearchIntelligenceBrief | null) => { setBrief(b); writeDraft(b); }, []);

  /* Only an explicit URL selects a search. Root always remains the workspace. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!route.searchId && params.get('search')) {
        const next = new URLSearchParams(params);
        next.delete('search');
        navigate(`/find-property/search/${encodeURIComponent(params.get('search')!)}${next.size ? `?${next}` : ''}`, { replace: true });
        return;
      }
      if (!searchId) {
        setSearch(null); setOpen(null); setCompare([]);
        if (location.pathname.endsWith('/new')) {
          const draft = readDraft();
          if (draft) { setBrief(draft); setView('BUILD'); } else setView('INTRO');
        } else setView('MODE');
        return;
      }
      if (searchId && justStartedId.current === searchId) { justStartedId.current = null; return; }
      setView('LOADING');
      setOpen(null);
      setCompare([]);
      try {
        const { search: s } = await searchStatus(searchId ?? undefined);
        if (!alive) return;
        if (s && s.id === searchId) {
          setSearch(s);
          setView(s.terminal && !s.unavailable ? 'RESULTS' : 'SEARCH');
          return;
        }
      } catch { /* Explicit search failure must never substitute another search. */ }
      if (!alive) return;
      setSearch(null);
      setView('ERROR');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, route.searchId, location.pathname.endsWith('/new')]);

  useEffect(() => {
    if (!route.propertyKey || !searchId) { setOpen(null); return; }
    let alive = true;
    setOpen(null);
    setPropertyError(false);
    void propertyDetail(searchId, route.propertyKey).then((r) => { if (alive) setOpen(r.property); })
      .catch(() => { if (alive) setPropertyError(true); });
    return () => { alive = false; };
  }, [searchId, route.propertyKey, propertyRetry]);

  /* Real polling while the search is open; paused while the tab is hidden. */
  useEffect(() => {
    if (!search || search.terminal || (view !== 'SEARCH' && view !== 'RESULTS')) return;
    let alive = true;
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const { search: s } = await searchStatus(search.id);
        if (!s || !alive) return;
        setSearch((prev) => {
          if (prev && (prev.counters.uniqueProperties !== s.counters.uniqueProperties || prev.status !== s.status)) setResultsVersion((v) => v + 1);
          return s;
        });
      } catch { /* next tick */ }
    }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [search, view]);

  const doUnderstand = async () => {
    setBusy(true);
    try {
      const r = await understand(text);
      setBriefAndDraft(r.brief);
    } catch (e) {
      /* The model being unavailable (or the per-user quota reached) is not a dead end:
         every question is asked instead, and nothing is charged or queued. */
      if (e instanceof MarketplaceError && e.code === 'RATE_LIMIT_EXCEEDED') toast.message(t('mps_error_rate_limited'));
      setBriefAndDraft(emptyBrief(text));
    } finally {
      setBusy(false);
      setView('BUILD');
    }
  };

  const doStart = async () => {
    if (!brief) return;
    setBusy(true);
    const criteria = JSON.stringify({ ...brief, originalText: '' });
    idempotency.current = startKey(criteria);
    try {
      const r = await startSearch(brief, idempotency.current);
      setSearch(r.search);
      justStartedId.current = r.search.id;
      navigate(`/find-property/search/${r.search.id}`);
      writeDraft(null);
      clearStartKey();
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
    if (!search) return;
    navigate(`/find-property/search/${search.id}/property/${encodeURIComponent(p.key)}${location.search}`);
  };

  const toggleCompare = (p: PropertyView) => setCompare((cur) => (cur.includes(p.key) ? cur.filter((k) => k !== p.key) : [...cur.slice(-1), p.key]));

  const runCompare = async () => {
    if (!search || compare.length !== 2) return;
    try { setComparison(await compareTwo(search.id, compare[0], compare[1])); } catch { toast.error(t('mps_error_generic')); }
  };

  const newSearch = () => {
    navigate('/find-property/new');
    setSearch(null);
    setCompare([]);
    setText('');
    setBriefAndDraft(null);
    setView('INTRO');
  };

  return (
    <CustomerSurface className="space-y-6">
      {!route.propertyKey ? <div className="pt-4 sm:pt-6">
        <PageHero compact title={t('plan_page_title')} subtitle={view === 'MODE' ? null : t('mps_hero_subtitle')} />
      </div> : null}

      {view === 'LOADING' && <div className="h-48 animate-pulse rounded-2xl bg-muted/60" aria-busy="true" />}
      {view === 'MODE' && <SearchDashboard t={t} />}
      {view === 'ERROR' && <div role="alert" className="space-y-4"><p>{t('mps_error_generic')}</p><Link to="/find-property">{t('fpw_history')}</Link></div>}
      {view === 'INTRO' && <BuilderIntro t={t} text={text} onText={setText} onSubmit={() => void doUnderstand()} busy={busy} />}
      {view === 'BUILD' && brief && (
        <SearchBuilder t={t} brief={brief} onBrief={setBriefAndDraft} onStart={() => void doStart()} starting={busy}
          onReset={() => { setBriefAndDraft(null); setView('INTRO'); }} />
      )}
      {view === 'SEARCH' && search && !route.propertyKey && (
        <SearchingView t={t} search={search} onViewResults={() => setView('RESULTS')} onPlay={() => setPlaying(true)}
          onNewSearch={newSearch}
          onCancel={async () => { try { const r = await cancelSearch(search.id); setSearch(r.search); } catch { /* ignore */ } newSearch(); }} />
      )}
      {view === 'SEARCH' && !playing && search?.terminal && (search.counters.uniqueProperties > 0 || !search.unavailable) ? (
        <ResultsRedirect onGo={() => setView('RESULTS')} />
      ) : null}
      {view === 'RESULTS' && search && !route.propertyKey && (
        <ResultsView t={t} search={search} onOpen={(p) => void openProperty(p)} compare={compare} onToggleCompare={toggleCompare}
          onNewSearch={newSearch} deepSearchAvailable={deepSearchAvailable} version={resultsVersion}
          onChangeCriteria={(f) => {
            const base = sanitizeBrief(search.brief);
            setBriefAndDraft(applyEdit(base, { field: f, value: null }));
            navigate('/find-property/new');
            setSearch(null);
            setView('BUILD');
          }} />
      )}

      {compare.length > 0 && view === 'RESULTS' && !route.propertyKey ? (
        <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-[#0C1119] px-4 py-3 text-white shadow-hover" role="region" aria-label={t('mps_compare')}>
          <span className="text-sm">{t('mps_compare_selected', { n: compare.length })}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={compare.length !== 2} onClick={() => void runCompare()}
              className="inline-flex min-h-[40px] items-center rounded-xl bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119] disabled:opacity-50">{t('mps_compare_go')}</button>
            <button type="button" onClick={() => setCompare([])} aria-label={t('mps_compare_clear')} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}

      {/* The game lives at page level: the search keeps polling underneath, and the search
          finishing never closes it. Only the customer closes it. */}
      <SnakeOverlay t={t} open={playing} onClose={() => setPlaying(false)}
        resultsReady={!!search && search.totalProperties > 0}
        onViewResults={() => { setPlaying(false); setView('RESULTS'); }} />
      {route.propertyKey && !open && !propertyError && view !== 'ERROR' ? <div aria-busy="true" className="h-64 animate-pulse rounded-xl bg-muted/60" /> : null}
      {route.propertyKey && propertyError ? <div role="alert" className="space-y-3"><p>{t('fpw_property_unavailable')}</p><button type="button" onClick={() => setPropertyRetry((value) => value + 1)} className="min-h-11 rounded-xl border border-border px-4">{t('fpw_retry')}</button></div> : null}
      {route.propertyKey && search ? <Link to={`/find-property/search/${search.id}${location.search}`} className="inline-flex min-h-11 items-center text-sm">{t('fpw_back_results')}</Link> : null}
      <PropertyIntelligence t={t} p={open} open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} isRTL={isRTL} fullPage={!!route.propertyKey}
        propertyType={search?.brief.propertyType?.value ?? null}
        budgetMaxUsd={search?.brief.price?.value.max ?? null}
        compareSelected={!!open && compare.includes(open.key)} onCompare={() => { if (open) toggleCompare(open); }} />
      {route.propertyKey && search && open ? <React.Suspense fallback={<div aria-busy="true" className="h-24 animate-pulse rounded-xl bg-muted/60" />}><PropertyAI key={`${search.id}:${open.key}`} searchId={search.id} propertyKey={open.key} title={open.title ?? ''} t={t} /></React.Suspense> : null}
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
