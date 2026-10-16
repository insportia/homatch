/*
 * The paid social OFFER campaign, for one Find Property search.
 *
 * Configure (networks, budget ≥ $5) → a live server preview (price, the 37/63
 * split, what each network can search right now) → the customer confirms the
 * exact price → the server reserves and starts → real per-network progress read
 * from the server → stop at any time → the final charge and the released rest.
 *
 * Honesty rules: every number shown comes from the server; there is no fake
 * percentage; a network that cannot be searched says so; the animated flow runs
 * only while work is really in flight and never under prefers-reduced-motion.
 */
import { Check, Facebook, Instagram, Loader2, Send, Square, Telescope } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OFFER_NETWORKS, OPEN_CAMPAIGN, campaignState, latestCampaignId, previewCampaign, startCampaign, stopCampaign,
  subscriptionForSearch, type CampaignPreview, type CampaignState, type OfferNetwork,
} from '@/services/paidCampaign';
import type { T } from './format';

const POLL_MS = 5000;
const NETWORK_ICON: Record<OfferNetwork, typeof Facebook> = { FACEBOOK: Facebook, INSTAGRAM: Instagram, TELEGRAM: Send, VK: Telescope };
const QUICK = [50, 100, 300, 1000];
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

export function PaidCampaignPanel({ t, searchId, subscriptionId: givenSubscription }: { t: T; searchId?: string | null; subscriptionId?: string | null }) {
  const [subscriptionId, setSubscriptionId] = useState<string | null>(givenSubscription ?? null);
  const [run, setRun] = useState<CampaignState | null>(null);
  const [mode, setMode] = useState<'LOADING' | 'CONFIGURE' | 'RUN' | 'NO_SEARCH'>('LOADING');
  const [networks, setNetworks] = useState<OfferNetwork[]>([...OFFER_NETWORKS]);
  const [credits, setCredits] = useState(50);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const startKey = useRef<string>(crypto.randomUUID());

  /* Which search, and is a campaign already running for it? */
  useEffect(() => {
    let live = true;
    (async () => {
      const sub = givenSubscription ?? (searchId ? await subscriptionForSearch(searchId) : null);
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
      setMode('CONFIGURE');
    })().catch(() => { if (live) setMode('NO_SEARCH'); });
    return () => { live = false; };
  }, [searchId, givenSubscription]);

  /* Live preview: the server prices and plans; debounced so typing does not flood it. */
  useEffect(() => {
    if (mode !== 'CONFIGURE' || !subscriptionId) return;
    let live = true;
    const id = window.setTimeout(() => {
      previewCampaign(subscriptionId, credits, networks).then((r) => {
        if (!live) return;
        setPreview(r.preview); setPreviewError(r.preview ? null : r.reasonCode);
        if (!r.preview && r.minCredits && credits < r.minCredits) setCredits(r.minCredits);
      }).catch(() => { if (live) setPreviewError('PREVIEW_FAILED'); });
    }, 400);
    setAgreed(false);
    return () => { live = false; window.clearTimeout(id); };
  }, [mode, subscriptionId, credits, networks]);

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
      const r = await startCampaign(subscriptionId, credits, networks, startKey.current);
      if (!r.runId) { setRefusal(r.reasonCode); return; }
      startKey.current = crypto.randomUUID();
      setRun(await campaignState(r.runId)); setMode('RUN');
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!run) return;
    setBusy(true);
    try { await stopCampaign(run.id); await refresh(); } finally { setBusy(false); }
  };

  const toggleNetwork = (n: OfferNetwork) => setNetworks((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const minCredits = preview?.minCredits ?? 50;

  if (mode === 'LOADING') return <div aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-white/5" />;
  if (mode === 'NO_SEARCH') return <p className="text-sm text-white/70">{t('fpi_paid_needs_search')}</p>;

  if (mode === 'RUN' && run) return <CampaignProgress t={t} run={run} busy={busy} onStop={() => void stop()} onAgain={() => { setRun(null); setMode('CONFIGURE'); }} />;

  return (
    <div className="space-y-5 text-white">
      {run && !OPEN_CAMPAIGN.includes(run.status) ? <CampaignSummary t={t} run={run} /> : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('fpi_paid_networks')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OFFER_NETWORKS.map((n) => {
            const Icon = NETWORK_ICON[n];
            const on = networks.includes(n);
            const planned = preview?.plannedByNetwork?.[n] ?? null;
            const missing = preview?.unavailableNetworks.find((u) => u.network === n);
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => toggleNetwork(n)}
                className={`flex min-h-[64px] flex-col items-start justify-center gap-1 rounded-xl border px-3 py-2 text-start text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] ${on ? 'border-[hsl(38_92%_60%/0.7)] bg-white/10' : 'border-white/15 text-white/60 hover:bg-white/5'}`}>
                <span className="inline-flex items-center gap-2 font-semibold"><Icon className="h-4 w-4" aria-hidden="true" />{t(`fpi_network_${n.toLowerCase()}`)}</span>
                <span className="text-2xs text-white/60">
                  {!on ? t('fpi_paid_network_off') : missing ? t(`fpi_paid_unavailable_${missing.reason.toLowerCase()}`) : planned != null ? t('fpi_paid_planned_runs', { n: planned }) : ' '}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

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
            <Row k={t('fpi_paid_planned')} v={t('fpi_paid_planned_runs', { n: preview.plannedRuns })} />
            {preview.skippedForBudget > 0 ? <p className="sm:col-span-2 text-2xs text-white/60">{t('fpi_paid_skipped', { n: preview.skippedForBudget })}</p> : null}
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
  const known = ['DISCOVERY_OFF', 'PAID_CAMPAIGNS_OFF', 'PROVIDER_OFF', 'NO_SEARCHABLE_SOURCES', 'NO_LIVE_SOURCES', 'BELOW_CAMPAIGN_MINIMUM',
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

function CampaignProgress({ t, run, busy, onStop, onAgain }: { t: T; run: CampaignState; busy: boolean; onStop: () => void; onAgain: () => void }) {
  const open = OPEN_CAMPAIGN.includes(run.status);
  const totals = useMemo(() => run.sources.reduce((a, s) => ({ planned: a.planned + s.planned, finished: a.finished + s.done + s.failed + s.budget }), { planned: 0, finished: 0 }), [run.sources]);
  return (
    <div className="space-y-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{t(`fpi_paid_status_${run.status.toLowerCase()}`)}</p>
        {open && run.status !== 'MATCHING' ? (
          <button type="button" onClick={onStop} disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]">
            <Square className="h-4 w-4" aria-hidden="true" />{t('fpi_paid_stop')}
          </button>
        ) : null}
      </div>
      {/* Real counts only: runs finished of runs planned, per network. */}
      <ul className="space-y-2" aria-live="polite">
        {run.sources.map((s) => {
          const finished = s.done + s.failed + s.budget;
          const pct = s.planned ? Math.round((finished / s.planned) * 100) : 0;
          const n = (['FACEBOOK', 'INSTAGRAM', 'TELEGRAM', 'VK'].includes(s.network) ? s.network : 'FACEBOOK').toLowerCase();
          return (
            <li key={s.network} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">{t(`fpi_network_${n}`)}</span>
                <span className="tabular-nums text-white/70">{t('fpi_paid_runs_progress', { done: finished, total: s.planned })}{s.failed ? ` · ${t('fpi_paid_runs_failed', { n: s.failed })}` : ''}</span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={s.planned} aria-valuenow={finished}>
                <div className="h-1.5 rounded-full bg-[hsl(38_92%_56%)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
                {open && s.running > 0 ? <div className="pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[hm-flow_1.6s_linear_infinite] motion-reduce:hidden" /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Row k={t('fpi_paid_offers_found')} v={String(run.offersFound)} strong />
        <Row k={t('fpi_paid_used_so_far')} v={t('fpi_paid_credits_n', { n: run.creditsUsed ?? 0 })} />
        <Row k={t('fpi_paid_held')} v={t('fpi_paid_credits_n', { n: run.creditsAuthorized ?? 0 })} />
        <Row k={t('fpi_paid_runs')} v={t('fpi_paid_runs_progress', { done: totals.finished, total: totals.planned })} />
      </dl>
      {!open ? (
        <>
          <CampaignSummary t={t} run={run} />
          <button type="button" onClick={onAgain} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/5">{t('fpi_paid_again')}</button>
        </>
      ) : <p className="text-xs text-white/60">{t('fpi_paid_running_note')}</p>}
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
