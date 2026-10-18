/*
 * Deep Search: the paid social OFFER campaign, for one Find Property search.
 *
 * Started from the Deep Search card with ONE confirmation (owner, 2026-10-18): the
 * approval made there (exact maximum, terms) is handed over as a one-shot token
 * (takeDeepConsent) and the campaign starts as soon as the search it extends exists.
 * Opened anywhere else, it asks for the price and the approval itself.
 *
 * The customer follows the PROCESS — searching posts, reading them, checking matches,
 * preparing results — never a list of networks or sites. Progress is real: runs
 * finished of runs planned, read from the server. Its results open in the search's
 * own Deep Search view (paidResultsPath), never mixed into a portal list.
 *
 * Honesty rules: every number shown comes from the server; the animated flow runs
 * only while work is really in flight and never under prefers-reduced-motion.
 */
import { ArrowRight, Check, Gamepad2, Loader2, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  OPEN_CAMPAIGN, campaignState, latestCampaignId, paidResultsPath, previewCampaign, startCampaign, stopCampaign,
  subscriptionForSearch, takeDeepConsent, type CampaignPreview, type CampaignState, type DeepConsent,
} from '@/services/paidCampaign';
import type { T } from './format';
import { SnakeOverlay } from './SnakeThumbnail';

const POLL_MS = 5000;
const QUICK = [50, 100, 300, 1000];
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

export function PaidCampaignPanel({ t, searchId, subscriptionId: givenSubscription, initialCredits }: { t: T; searchId?: string | null; subscriptionId?: string | null; initialCredits?: number }) {
  const [subscriptionId, setSubscriptionId] = useState<string | null>(givenSubscription ?? null);
  const [run, setRun] = useState<CampaignState | null>(null);
  const [mode, setMode] = useState<'LOADING' | 'STARTING' | 'CONFIGURE' | 'RUN' | 'NO_SEARCH' | 'LOAD_FAILED'>('LOADING');
  const [credits, setCredits] = useState(initialCredits && initialCredits >= 50 ? Math.round(initialCredits) : 50);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const startKey = useRef<string>(crypto.randomUUID());
  const { lang } = useLanguage();
  /* The approval given on the Deep Search card for exactly this search (read once). */
  const consent = useRef<DeepConsent | null | undefined>(undefined);
  if (consent.current === undefined) consent.current = searchId ? takeDeepConsent(searchId) : null;

  /* Which search, and is a campaign already running for it? */
  useEffect(() => {
    let live = true;
    (async () => {
      /* A search started a moment ago registers its subscription in the background: wait for it briefly. */
      let sub = givenSubscription ?? (searchId ? await subscriptionForSearch(searchId) : null);
      for (let i = 0; !sub && searchId && !givenSubscription && i < 8 && live; i += 1) {
        await new Promise((r) => setTimeout(r, 2500));
        sub = await subscriptionForSearch(searchId);
      }
      if (!live) return;
      setSubscriptionId(sub);
      if (!sub) { setMode('NO_SEARCH'); return; }
      const last = await latestCampaignId(sub);
      if (!live) return;
      if (last) {
        const state = await campaignState(last).catch(() => null);
        if (!live) return;
        if (state && OPEN_CAMPAIGN.includes(state.status)) { setRun(state); setMode('RUN'); return; }
        setRun(state);
      }
      const approved = consent.current;
      if (approved) {
        /* One confirmation: the server prices the same amount the customer approved; only
           then is anything held. Anything else (off, no credits, a different price) falls
           back to asking, with the reason. */
        consent.current = null;
        setMode('STARTING');
        const pv = await previewCampaign(sub, approved.credits, lang).catch(() => ({ preview: null, reasonCode: 'PREVIEW_FAILED' as string | null }));
        if (!live) return;
        if (pv.preview?.available && pv.preview.plannedRuns > 0 && pv.preview.priceCredits === approved.credits) {
          const r = await startCampaign(sub, approved.credits, approved.key, lang).catch(() => ({ runId: null, reasonCode: 'START_FAILED' }));
          if (!live) return;
          if (r.runId) { setRun(await campaignState(r.runId)); setMode('RUN'); return; }
          setRefusal(r.reasonCode);
        } else setRefusal(pv.preview && !pv.preview.available ? pv.preview.unavailableReason ?? 'DISCOVERY_OFF' : pv.preview?.plannedRuns === 0 ? 'NO_LIVE_SOURCES' : pv.reasonCode ?? 'START_FAILED');
        setCredits(approved.credits);
      }
      setMode('CONFIGURE');
    /* A failed read is not "no search": say it could not be loaded. */
    })().catch(() => { if (live) setMode('LOAD_FAILED'); });
    return () => { live = false; };
  }, [searchId, givenSubscription]);

  /* Live preview: the server prices and plans; debounced so typing does not flood it. */
  useEffect(() => {
    if (mode !== 'CONFIGURE' || !subscriptionId) return;
    let live = true;
    const id = window.setTimeout(() => {
      previewCampaign(subscriptionId, credits, lang).then((r) => {
        if (!live) return;
        setPreview(r.preview); setPreviewError(r.preview ? null : r.reasonCode);
        if (!r.preview && r.minCredits && credits < r.minCredits) setCredits(r.minCredits);
      }).catch(() => { if (live) setPreviewError('PREVIEW_FAILED'); });
    }, 400);
    setAgreed(false);
    return () => { live = false; window.clearTimeout(id); };
  }, [mode, subscriptionId, credits, lang]);

  /* Progress: polled from the server while the campaign is open. */
  const refresh = useCallback(async () => {
    if (!run) return;
    const state = await campaignState(run.id).catch(() => null);
    if (state) setRun(state);
  }, [run]);
  useEffect(() => {
    if (mode !== 'RUN' || !run || !OPEN_CAMPAIGN.includes(run.status)) return;
    const id = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [mode, run, refresh]);

  const start = async () => {
    if (!subscriptionId || !preview || !agreed) return;
    setBusy(true); setRefusal(null);
    try {
      const r = await startCampaign(subscriptionId, credits, startKey.current, lang);
      if (!r.runId) { setRefusal(r.reasonCode); return; }
      startKey.current = crypto.randomUUID();
      setRun(await campaignState(r.runId)); setMode('RUN');
    } catch { setRefusal('START_FAILED'); } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!run) return;
    setBusy(true);
    try { await stopCampaign(run.id); await refresh(); } catch { setRefusal('STOP_FAILED'); } finally { setBusy(false); }
  };

  const minCredits = preview?.minCredits ?? 50;

  if (mode === 'LOADING') return <div aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-white/5" />;
  if (mode === 'STARTING') return (
    <p role="status" className="flex items-center gap-2 text-sm text-white/80" data-campaign-starting>
      <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{t('fpi_paid_starting')}
    </p>
  );
  if (mode === 'LOAD_FAILED') return <p role="alert" className="text-sm text-white/70">{t('fpi_paid_refused_generic')}</p>;
  if (mode === 'NO_SEARCH') return <p className="text-sm text-white/70">{t('fpi_paid_needs_search')}</p>;

  if (mode === 'RUN' && run) return (
    <>
      {refusal === 'STOP_FAILED' ? <p role="alert" className="mb-3 text-sm text-[hsl(38_92%_66%)]">{t('fpi_paid_refused_generic')}</p> : null}
      <CampaignProgress t={t} run={run} searchId={searchId ?? null} busy={busy} onStop={() => void stop()} onAgain={() => { setRefusal(null); setRun(null); setMode('CONFIGURE'); }} />
    </>
  );

  return (
    <div className="space-y-5 text-white">
      {run && !OPEN_CAMPAIGN.includes(run.status) ? <CampaignSummary t={t} run={run} /> : null}
      <div className="space-y-2">
        <label htmlFor="fpi-budget" className="text-sm font-semibold">{t('fpi_paid_budget')}</label>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setCredits(q)} aria-pressed={credits === q}
              className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] ${credits === q ? 'border-[hsl(38_92%_60%)] text-[hsl(38_92%_66%)]' : 'border-white/15 text-white/80 hover:bg-white/5'}`}>
              {t('fpi_paid_credits_usd', { credits: q, usd: (q / (preview?.creditsPerUsd ?? 10)).toFixed(2) })}
            </button>
          ))}
          <input id="fpi-budget" type="number" inputMode="numeric" min={minCredits} step={10} value={credits}
            onChange={(e) => setCredits(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="h-11 w-28 rounded-xl border border-white/20 bg-transparent px-3 text-sm tabular-nums text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]" />
        </div>
        {credits < minCredits ? <p role="alert" className="text-xs text-[hsl(38_92%_66%)]">{t('fpi_paid_minimum', { credits: minCredits, usd: (minCredits / (preview?.creditsPerUsd ?? 10)).toFixed(2) })}</p> : null}
      </div>

      <div aria-live="polite" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
        {!preview ? (
          previewError ? <p className="text-white/70">{t(`fpi_paid_refused_${refusalKey(previewError)}`)}</p>
            : <div className="h-16 animate-pulse rounded-lg bg-white/5" aria-busy="true" />
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <Row k={t('fpi_paid_price')} v={`${usd(preview.priceUsd)} · ${t('fpi_paid_credits_n', { n: preview.priceCredits })}`} strong />
            <p className="sm:col-span-2 mt-2 text-xs leading-relaxed text-white/70">{t('fpi_paid_terms', { max: usd(preview.priceUsd) })}</p>
            {!preview.available ? <p role="alert" className="sm:col-span-2 mt-1 text-xs text-[hsl(38_92%_66%)]">{t(`fpi_paid_refused_${refusalKey(preview.unavailableReason ?? 'DISCOVERY_OFF')}`)}</p> : null}
          </dl>
        )}
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={!preview?.available || preview.plannedRuns === 0}
          className="mt-1 h-5 w-5 shrink-0 accent-[hsl(38_92%_56%)]" />
        <span className="text-white/85">{t('fpi_paid_confirm', { credits, max: usd(preview?.priceUsd ?? credits / 10) })}</span>
      </label>
      {refusal ? (
        <p role="alert" className="text-sm text-[hsl(38_92%_66%)]">
          {t(`fpi_paid_refused_${refusalKey(refusal)}`)}{' '}
          {refusal === 'INSUFFICIENT_CREDITS' || refusal === 'BILLING_REQUIRED' ? <Link to="/credits" className="underline underline-offset-4">{t('fpi_paid_top_up')}</Link> : null}
        </p>
      ) : null}
      <button type="button" onClick={() => void start()} disabled={busy || !agreed || !preview?.available || preview.plannedRuns === 0 || credits < minCredits}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_56%)] px-6 text-[15px] font-semibold text-[#0C1119] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto">
        {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
        {t('fpi_paid_start', { credits })}
      </button>
    </div>
  );
}

function refusalKey(code: string): string {
  const known = ['DISCOVERY_OFF', 'PAID_CAMPAIGNS_OFF', 'PROVIDER_OFF', 'PROVIDER_NOT_CONFIGURED', 'NO_SEARCHABLE_SOURCES', 'NO_LIVE_SOURCES', 'BELOW_CAMPAIGN_MINIMUM',
    'ABOVE_CAMPAIGN_MAXIMUM', 'NO_NETWORKS', 'INSUFFICIENT_CREDITS', 'BILLING_REQUIRED', 'PLAN_INCOMPLETE', 'UNKNOWN_SEARCH', 'CONFIRMATION_REQUIRED'];
  return known.includes(code) ? code.toLowerCase() : 'generic';
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-white/60">{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-[hsl(38_92%_66%)]' : 'text-white'}`}>{v}</dd>
    </div>
  );
}

/** Real elapsed time of the campaign, from the server's start (and end, once it has one). */
function useElapsed(from: string, to: string | null, ticking: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  const ms = Math.max(0, (to ? Date.parse(to) : now) - Date.parse(from));
  const total = Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}

type Step = 'done' | 'active' | 'waiting';
const PROCESS = ['search', 'analyse', 'match', 'ready'] as const;

/**
 * The process, from the server's real state: posts are searched while runs are open,
 * read as each run finishes, checked against the search while it matches, and the
 * results prepared when it ends. Progress = runs finished of runs planned (to 85%),
 * then matching (90%), then done (100%) — never a timer.
 */
export function campaignProcess(run: Pick<CampaignState, 'status' | 'stage' | 'sources'>): { steps: Record<typeof PROCESS[number], Step>; pct: number } {
  const planned = run.sources.reduce((n, s) => n + s.planned, 0);
  const finished = run.sources.reduce((n, s) => n + s.done + s.failed + s.budget, 0);
  const open = OPEN_CAMPAIGN.includes(run.status);
  const matching = run.status === 'MATCHING' || run.stage === 'VALIDATING' || run.stage === 'MATCHING';
  if (!open) return { steps: { search: 'done', analyse: 'done', match: 'done', ready: 'done' }, pct: 100 };
  if (matching) return { steps: { search: 'done', analyse: 'done', match: 'active', ready: 'waiting' }, pct: 90 };
  const searching = planned === 0 || finished < planned;
  return {
    steps: { search: searching ? 'active' : 'done', analyse: finished > 0 ? (searching ? 'active' : 'done') : 'waiting', match: searching ? 'waiting' : 'active', ready: 'waiting' },
    pct: planned ? Math.max(3, Math.round((finished / planned) * 85)) : 3,
  };
}

function CampaignProgress({ t, run, searchId, busy, onStop, onAgain }: { t: T; run: CampaignState; searchId: string | null; busy: boolean; onStop: () => void; onAgain: () => void }) {
  const open = OPEN_CAMPAIGN.includes(run.status);
  const navigate = useNavigate();
  const elapsed = useElapsed(run.createdAt, open ? null : run.completedAt, open);
  const process = useMemo(() => campaignProcess(run), [run]);
  const [playing, setPlaying] = useState(false);
  const found = Math.max(run.offersFound ?? 0, run.resultsFound ?? 0);
  const viewResults = () => {
    if (open || !searchId) return;
    setPlaying(false);
    navigate(paidResultsPath(searchId)); window.scrollTo({ top: 0 });
  };
  return (
    <div className="space-y-4 text-white" data-campaign-progress={open ? 'open' : 'ended'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t(`fpi_paid_status_${run.status.toLowerCase()}`)}</p>
          <p className="text-xs tabular-nums text-white/60" data-campaign-elapsed>{t('fpi_paid_elapsed', { time: elapsed })}</p>
        </div>
        {open && run.status !== 'MATCHING' ? (
          <button type="button" onClick={onStop} disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]">
            <Square className="h-4 w-4" aria-hidden="true" />{t('fpi_paid_stop')}
          </button>
        ) : null}
      </div>
      {/* The process only — which networks or sites are read is never shown (owner, 2026-10-18). */}
      <div className="space-y-1.5">
        <div className="relative h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={process.pct} aria-label={t('fpi_proc_progress', { pct: process.pct })}>
          <div className="h-2 rounded-full bg-[hsl(38_92%_56%)] transition-[width] duration-700" style={{ width: `${process.pct}%` }} />
          {open ? <div className="pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[hm-flow_1.6s_linear_infinite] motion-reduce:hidden" /> : null}
        </div>
        <p className="text-end text-2xs tabular-nums text-white/60" data-campaign-pct={process.pct}>{t('fpi_proc_progress', { pct: process.pct })}</p>
      </div>
      <ol className="space-y-2" aria-live="polite">
        {PROCESS.map((key) => {
          const state = process.steps[key];
          return (
            <li key={key} className="flex min-w-0 items-start gap-3 text-sm" data-process-step={key} data-step-state={state}>
              <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${state === 'done' ? 'border-[hsl(38_92%_56%)] bg-[hsl(38_92%_56%)] text-[#0C1119]' : state === 'active' ? 'border-[hsl(38_92%_60%)] text-[hsl(38_92%_60%)]' : 'border-white/20 text-white/30'}`}>
                {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : state === 'active' ? <Loader2 className="h-3 w-3 motion-safe:animate-spin" /> : null}
              </span>
              <span className={`min-w-0 leading-snug ${state === 'waiting' ? 'text-white/45' : 'text-white/90'}`}>{t(`fpi_proc_${key}`)}</span>
            </li>
          );
        })}
      </ol>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Row k={t('fpi_paid_offers_found')} v={String(run.offersFound)} strong />
        <Row k={t('fpi_paid_used_so_far')} v={t('fpi_paid_credits_n', { n: run.creditsUsed ?? 0 })} />
        <Row k={t('fpi_paid_held')} v={t('fpi_paid_credits_n', { n: run.creditsAuthorized ?? 0 })} />
      </dl>
      {!open ? (
        <>
          <CampaignSummary t={t} run={run} />
          {found === 0 ? <p className="text-sm text-white/75" data-campaign-no-offers>{t('fpi_paid_no_offers')}</p> : null}
          <div className="flex flex-wrap gap-2">
            {/* One way to the results, only after the campaign has ended: its own Deep Search view. */}
            {searchId && found > 0 ? (
              <button type="button" data-action="campaign-view-results" onClick={viewResults}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                {t('fpi_paid_view_results')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" onClick={onAgain} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/5">{t('fpi_paid_again')}</button>
          </div>
        </>
      ) : <>
        <p className="text-xs text-white/60">{t('fpi_paid_running_note')}</p>
        <p className="text-xs text-white/60" data-campaign-results-wait>{t('fpi_paid_results_wait')}</p>
        {/* The same Snake as the free search, while the campaign runs; it never ends the wait early. */}
        <button type="button" onClick={() => setPlaying(true)} data-action="campaign-play-snake"
          className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-[hsl(38_92%_60%/0.5)] bg-white/5 px-4 text-start text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] sm:w-auto">
          <Gamepad2 className="h-4 w-4 shrink-0 text-[hsl(38_92%_60%)]" aria-hidden="true" /><span className="min-w-0 leading-tight">{t('fpv_play_snake')}</span>
        </button>
      </>}
      <SnakeOverlay t={t} open={playing} onClose={() => setPlaying(false)} resultsReady={!open && !!searchId && found > 0} onViewResults={viewResults} />
    </div>
  );
}

function CampaignSummary({ t, run }: { t: T; run: CampaignState }) {
  const charged = run.creditsCharged ?? null;
  const released = charged != null && run.creditsAuthorized != null ? Math.max(0, Math.round((run.creditsAuthorized - charged) * 100) / 100) : null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      <p className="inline-flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-[hsl(38_92%_60%)]" aria-hidden="true" />{t(`fpi_paid_status_${run.status.toLowerCase()}`)}</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Row k={t('fpi_paid_offers_found')} v={String(run.offersFound)} />
        <Row k={t('fpi_paid_results_delivered')} v={String(run.resultsFound ?? 0)} />
        <Row k={t('fpi_paid_charged')} v={charged == null ? t('fpi_paid_settling') : t('fpi_paid_credits_n', { n: charged })} strong />
        <Row k={t('fpi_paid_released')} v={released == null ? '—' : t('fpi_paid_credits_n', { n: released })} />
      </dl>
    </div>
  );
}
