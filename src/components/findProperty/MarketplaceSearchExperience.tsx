import { ArrowLeft, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CustomerSurface } from '@/components/customer/surface';
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
import { DeepSearchPanel } from './workspace/DeepSearchPanel';
import { rememberDeepConsent } from '@/services/paidCampaign';
import { DiscoveryModeStep } from './workspace/DiscoveryModeStep';
import { ActivityTab, SavedTab } from './workspace/PersonalTabs';
import { SearchesTab } from './workspace/SearchesTab';
import { SearchProgress } from './workspace/SearchProgress';
import { btn } from './workspace/primitives';
import { WorkspaceHeader, WorkspaceTabs, WORKSPACE_TABS, type WorkspaceTab } from './workspace/WorkspaceHeader';
import { SnakeOverlay } from './SnakeThumbnail';

type View = 'LOADING' | 'MODE' | 'INTRO' | 'BUILD' | 'CHOOSE' | 'SEARCH' | 'RESULTS' | 'ERROR';
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

export function MarketplaceSearchExperience({ deepSearchAvailable, activeSources = null, sourceNames = [] }: { deepSearchAvailable: boolean; activeSources?: number | null; sourceNames?: string[] }) {
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

  /* Completion gate (owner, 2026-10-17): a property page of a search that is still running
     goes back to the progress screen; results open only after every source job has ended. */
  useEffect(() => {
    if (route.propertyKey && search && search.id === searchId && !search.terminal) {
      navigate(`/find-property/search/${encodeURIComponent(search.id)}`, { replace: true });
      setView('SEARCH');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.propertyKey, search?.id, search?.terminal]);

  // Only a known-running search blocks the dossier; the status arriving for a finished one must not refetch it.
  const gated = !!search && search.id === searchId && !search.terminal;
  useEffect(() => {
    if (!route.propertyKey || !searchId) { setOpen(null); return; }
    if (gated) return;
    let alive = true;
    setOpen(null);
    setPropertyError(false);
    void propertyDetail(searchId, route.propertyKey).then((r) => { if (alive) setOpen(r.property); })
      .catch(() => { if (alive) setPropertyError(true); });
    return () => { alive = false; };
  }, [searchId, route.propertyKey, propertyRetry, gated]);

  /* Real polling while the search is open; paused while the tab is hidden. */
  useEffect(() => {
    if (!search || search.terminal || view !== 'SEARCH') return;
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

  const doStart = async (deepCredits?: number) => {
    if (!brief) return;
    setBusy(true);
    const criteria = JSON.stringify({ ...brief, originalText: '' });
    idempotency.current = startKey(criteria);
    try {
      const r = await startSearch(brief, idempotency.current);
      setSearch(r.search);
      justStartedId.current = r.search.id;
      /* Deep Search was approved on its card (one confirmation): the campaign starts with
         that approval as soon as this search's subscription exists. */
      if (deepCredits) rememberDeepConsent(r.search.id, deepCredits);
      navigate(`/find-property/search/${r.search.id}${deepCredits ? `?deep=${deepCredits}` : ''}`);
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

  const tab: WorkspaceTab = (WORKSPACE_TABS as string[]).includes(params.get('tab') ?? '') ? params.get('tab') as WorkspaceTab : 'searches';
  const [counts, setCounts] = useState<Partial<Record<WorkspaceTab, number | null>>>({});
  const onSavedCount = useCallback((n: number) => setCounts((c) => ({ ...c, saved: n })), []);
  const onSearchCount = useCallback((n: number | null) => setCounts((c) => ({ ...c, searches: n })), []);
  const deepCredits = Number(params.get('deep')) || null;
  /* A finished Deep Search opens its results view directly (the search it extends ended long before). */
  const paidView = params.get('view') === 'paid';
  useEffect(() => {
    if (paidView && !deepCredits && view === 'SEARCH' && search?.terminal && !search.unavailable) setView('RESULTS');
  }, [paidView, deepCredits, view, search?.terminal, search?.unavailable]);
  const backToWorkspace = !route.propertyKey && view !== 'MODE' && view !== 'ERROR'
    ? <Link to="/find-property" className={btn.quiet}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('fpx_my_searches')}</Link> : undefined;

  return (
    <CustomerSurface className="space-y-6 pb-10">
      {!route.propertyKey ? <div className="pt-4 sm:pt-6">
        <WorkspaceHeader t={t} compact={view !== 'MODE'} activeSources={activeSources} deepAvailable={deepSearchAvailable} action={backToWorkspace} />
      </div> : null}

      {view === 'LOADING' && <div className="h-48 animate-pulse rounded-2xl border border-border bg-card/70" aria-busy="true" />}
      {view === 'MODE' && <div className="space-y-5">
        <WorkspaceTabs t={t} active={tab} counts={counts} hrefOf={(next) => (next === 'searches' ? '/find-property' : `/find-property?tab=${next}`)} />
        {tab === 'searches' ? <SearchesTab t={t} onCount={onSearchCount} onRepeat={(b) => {
          // Refining reopens the builder with the saved criteria; nothing starts until the customer confirms.
          setBriefAndDraft(sanitizeBrief(b));
          navigate('/find-property/new');
          setSearch(null);
          setView('BUILD');
        }} /> : tab === 'saved' ? <SavedTab t={t} onCount={onSavedCount} /> : <ActivityTab t={t} />}
      </div>}
      {view === 'ERROR' && <div role="alert" className="space-y-4 rounded-2xl border border-border bg-card p-6"><p>{t('mps_error_generic')}</p><Link to="/find-property" className={btn.quiet}>{t('fpx_my_searches')}</Link></div>}
      {view === 'INTRO' && <BuilderIntro t={t} text={text} onText={setText} onSubmit={() => void doUnderstand()} busy={busy} />}
      {view === 'BUILD' && brief && (
        <SearchBuilder t={t} brief={brief} onBrief={setBriefAndDraft} onStart={() => setView('CHOOSE')} starting={busy} startLabel={t('fpx_continue_modes')}
          onReset={() => { setBriefAndDraft(null); setView('INTRO'); }} />
      )}
      {view === 'CHOOSE' && brief && (
        <DiscoveryModeStep t={t} deepAvailable={deepSearchAvailable} activeSources={activeSources} sourceNames={sourceNames} starting={busy} brief={brief}
          onFree={() => void doStart()} onDeep={(credits) => void doStart(credits)} onBack={() => setView('BUILD')} />
      )}
      {/* Deep Search: the campaign's own screen, never the portal search's progress or list
          (the free search runs underneath only because the campaign extends it). */}
      {deepCredits && search && !route.propertyKey && (view === 'SEARCH' || view === 'RESULTS') ? (
        <DeepSearchPanel t={t} searchId={search.id} available={deepSearchAvailable} initialCredits={deepCredits} />
      ) : null}
      {view === 'SEARCH' && search && !route.propertyKey && !deepCredits && (
        <SearchProgress t={t} search={search} onViewResults={() => { if (search.terminal) setView('RESULTS'); }} onPlay={() => setPlaying(true)}
          onNewSearch={newSearch}
          onCancel={async () => { try { const r = await cancelSearch(search.id); setSearch(r.search); } catch { /* ignore */ } newSearch(); }} />
      )}
      {view === 'RESULTS' && search && !route.propertyKey && !deepCredits && (
        <ResultsView t={t} search={search} onOpen={(p) => void openProperty(p)} compare={compare} onToggleCompare={toggleCompare}
          onNewSearch={newSearch} deepSearchAvailable={deepSearchAvailable} version={resultsVersion}
          onChangeCriteria={(edit) => {
            const base = sanitizeBrief(search.brief);
            setBriefAndDraft(edit ? applyEdit(base, edit) : base);
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
        resultsReady={!!search && search.terminal && search.totalProperties > 0}
        onViewResults={() => { if (!search?.terminal) return; setPlaying(false); setView('RESULTS'); }} />
      {route.propertyKey && !open && !propertyError && view !== 'ERROR' ? <div aria-busy="true" className="h-64 animate-pulse rounded-xl bg-muted/60" /> : null}
      {route.propertyKey && propertyError ? <div role="alert" className="space-y-3"><p>{t('fpw_property_unavailable')}</p><button type="button" onClick={() => setPropertyRetry((value) => value + 1)} className="min-h-11 rounded-xl bg-[#0C1119] px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{t('fpw_retry')}</button></div> : null}
      {route.propertyKey && search ? <Link to={`/find-property/search/${search.id}${location.search}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-foreground/15 bg-card px-4 text-sm font-semibold shadow-sm transition hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('fpw_back_results')}</Link> : null}
      <PropertyIntelligence t={t} p={open} open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} isRTL={isRTL} fullPage={!!route.propertyKey}
        propertyType={search?.brief.propertyType?.value ?? null} brief={search?.brief ?? null}
        budgetMaxUsd={search?.brief.price?.value.max ?? null}
        compareSelected={!!open && compare.includes(open.key)} onCompare={() => { if (open) toggleCompare(open); }} />
      {route.propertyKey && search && open ? <React.Suspense fallback={<div aria-busy="true" className="h-24 animate-pulse rounded-xl bg-muted/60" />}><PropertyAI key={`${search.id}:${open.key}`} searchId={search.id} propertyKey={open.key} title={open.title ?? ''} t={t} /></React.Suspense> : null}
      <CompareView t={t} open={!!comparison} onOpenChange={(o) => { if (!o) setComparison(null); }}
        a={comparison?.a ?? null} b={comparison?.b ?? null} rows={comparison?.rows ?? []} />
    </CustomerSurface>
  );
}


