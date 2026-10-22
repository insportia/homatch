// FIND BUYERS 2.0 — HOMATCH INTERNAL MATCHES, the first and most prominent section of the
// Find Buyers page (owner, 2026-10-18).
//
// "Find Internal Matches" starts the REAL matcher for this listing (internal_leads_request_
// matching queues it; supply-matching drains the queue every two minutes and compares it
// with every active member search), then follows its real state (internal_leads_match_
// status): queued → comparing → done when the matcher has removed the listing from its
// queue. No percentages, no invented progress. Leaving the page is fine — the comparison
// continues on the server and the results stay in the leads list.
//
// FREE: requesting, refreshing, browsing and filtering never touch the wallet. The only
// paid action anywhere in this flow is an explicit, confirmed contact unlock.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Loader2, Radar, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getMatchStatus, requestLeadMatching, type MatchStatus } from '@/services/homatchLeads';
import { intlLocaleFor } from '@/components/workspace/primitives';

type Phase = 'idle' | 'requesting' | 'comparing' | 'done' | 'slow' | 'error';

const POLL_MS = 4000;
/** After this the panel stops watching and says the comparison continues in the background. */
const WATCH_MS = 5 * 60_000;

const lastRunKey = (propertyId: string) => `homatch:fim:last:${propertyId}`;
function readLastRun(propertyId: string): string | null {
  try { return window.localStorage.getItem(lastRunKey(propertyId)); } catch { return null; }
}
function writeLastRun(propertyId: string, iso: string) {
  try { window.localStorage.setItem(lastRunKey(propertyId), iso); } catch { /* private mode: nothing to remember */ }
}

export function InternalMatchesPanel({
  propertyId, tenant, leadsHref, fallbackCount,
}: {
  propertyId: string;
  /** The listing is for rent: the people are tenants. */
  tenant: boolean;
  /** The full, filterable list of internal matches. */
  leadsHref: string;
  /** Matches already known from the page's own reads, shown before a status read. */
  fallbackCount: number | null;
}) {
  const { t, lang } = useLanguage();
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(() => readLastRun(propertyId));
  const timer = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    let on = true;
    getMatchStatus(propertyId).then((s) => { if (on) setStatus(s); }).catch(() => undefined);
    return () => { on = false; };
  }, [propertyId]);

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const poll = useCallback(async () => {
    try {
      const s = await getMatchStatus(propertyId);
      if (!alive.current) return;
      if (!s) { setPhase('done'); return; } /* status not deployed yet: the request itself was accepted */
      setStatus(s);
      if (!s.queued) {
        const now = new Date().toISOString();
        writeLastRun(propertyId, now); setLastRun(now);
        setPhase('done');
        return;
      }
      if (Date.now() - startedAt.current > WATCH_MS) { setPhase('slow'); return; }
      setPhase('comparing');
      timer.current = window.setTimeout(() => { void poll(); }, POLL_MS);
    } catch {
      if (alive.current) setPhase('error');
    }
  }, [propertyId]);

  const start = useCallback(async () => {
    stop();
    setPhase('requesting');
    startedAt.current = Date.now();
    try {
      await requestLeadMatching(propertyId);
      if (!alive.current) return;
      setPhase('comparing');
      timer.current = window.setTimeout(() => { void poll(); }, 1500);
    } catch {
      if (alive.current) setPhase('error');
    }
  }, [poll, propertyId, stop]);

  const running = phase === 'requesting' || phase === 'comparing';
  const count = status?.matches ?? fallbackCount;
  const searches = status?.activeSearches ?? null;
  const fmtDate = (iso: string) => {
    try { return new Intl.DateTimeFormat(intlLocaleFor(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso; }
  };

  const stages: Array<{ key: string; state: 'done' | 'active' | 'todo'; label: string }> = [
    { key: 'send', state: phase === 'requesting' ? 'active' : 'done', label: t('fim_stage_send') },
    {
      key: 'compare', state: phase === 'requesting' ? 'todo' : phase === 'comparing' ? 'active' : 'done',
      label: searches != null ? t('fim_stage_compare_n', { n: String(searches) }) : t('fim_stage_compare'),
    },
    { key: 'rank', state: phase === 'done' ? 'done' : 'todo', label: t('fim_stage_rank') },
  ];

  return (
    <section aria-labelledby="fim-title" data-testid="fim-panel" data-phase={phase}
      className="relative mt-4 overflow-hidden rounded-3xl bg-[hsl(218_52%_11%)] bg-[radial-gradient(28rem_18rem_at_100%_0%,hsl(40_94%_60%/0.2),transparent_70%)] p-5 text-white shadow-[0_24px_60px_-34px_hsl(218_70%_8%/0.9)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)] sm:p-6">

      <div className="relative flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[hsl(40_94%_62%/0.14)] text-[hsl(40_94%_66%)] ring-1 ring-inset ring-[hsl(40_94%_62%/0.35)]">
          <Users className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-2xs font-bold uppercase tracking-[0.16em] text-[hsl(40_94%_66%)]">{t('fim_eyebrow')}</p>
          <h2 id="fim-title" className="mt-0.5 break-words font-display text-lg font-semibold leading-snug sm:text-xl">
            {t(tenant ? 'fim_title_tenants' : 'fim_title_buyers')}
          </h2>
        </div>
      </div>

      <p className="relative mt-3 max-w-[68ch] text-sm leading-relaxed text-[hsl(218_40%_86%)]">{t('fim_explain')}</p>

      {/* The unmistakable billing rule. */}
      <p data-testid="fim-free" className="relative mt-3 inline-flex max-w-full items-start gap-2 rounded-xl bg-[hsl(40_94%_62%/0.12)] px-3 py-2 text-xs font-bold uppercase leading-snug tracking-[0.08em] text-[hsl(40_94%_70%)] ring-1 ring-inset ring-[hsl(40_94%_62%/0.4)]">
        <ShieldCheck className="mt-px h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{t('fim_free_banner')}</span>
      </p>

      {/* Live state of the real matcher. */}
      {phase !== 'idle' ? (
        <div className="relative mt-4 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-inset ring-white/10" role="status" aria-live="polite" data-testid="fim-progress">
          {phase === 'error' ? (
            <p className="text-sm text-[hsl(350_80%_86%)]">{t('fim_error')}</p>
          ) : (
            <ol className="space-y-2.5">
              {stages.map((s) => (
                <li key={s.key} className="flex min-w-0 items-start gap-2.5 text-sm" data-state={s.state}>
                  <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                    s.state === 'done' ? 'bg-[hsl(40_94%_62%)] text-[hsl(218_52%_11%)]'
                      : s.state === 'active' ? 'bg-transparent text-[hsl(40_94%_66%)] ring-2 ring-inset ring-[hsl(40_94%_62%)]'
                        : 'bg-white/10 text-white/40')}>
                    {s.state === 'done' ? <Check className="h-3 w-3" aria-hidden="true" />
                      : s.state === 'active' ? <span className="h-1.5 w-1.5 rounded-full bg-[hsl(40_94%_66%)] motion-safe:animate-pulse" aria-hidden="true" /> : null}
                  </span>
                  <span className={cn('min-w-0 break-words leading-snug', s.state === 'todo' ? 'text-white/50' : 'text-white')}>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
          {phase === 'comparing' ? <p className="mt-3 text-xs text-[hsl(218_40%_78%)]">{t('fim_wait_note')}</p> : null}
          {phase === 'slow' ? <p className="mt-3 text-xs text-[hsl(218_40%_80%)]" data-testid="fim-slow">{t('fim_slow_note')}</p> : null}
          {phase === 'done' ? (
            <p className="mt-3 text-sm font-semibold text-white" data-testid="fim-result">
              {count && count > 0
                ? t(count === 1 ? (tenant ? 'fim_result_one_tenant' : 'fim_result_one_buyer') : (tenant ? 'fim_result_n_tenants' : 'fim_result_n_buyers'), { n: String(count) })
                : t('fim_result_none')}
            </p>
          ) : null}
          {phase === 'done' && (!count || count === 0) ? <p className="mt-1 text-xs leading-relaxed text-[hsl(218_40%_80%)]">{t('fim_result_none_body')}</p> : null}
        </div>
      ) : null}

      <div className="relative mt-4 flex flex-col gap-2.5 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:items-center">
        <button type="button" onClick={() => void start()} disabled={running} data-testid="fim-start"
          className={cn('group relative inline-flex min-h-12 w-full min-w-0 items-center justify-center gap-2 overflow-hidden whitespace-normal rounded-2xl px-5 py-2.5 text-center text-sm font-bold leading-snug text-[hsl(218_52%_11%)] min-[420px]:w-auto',
            'bg-[linear-gradient(135deg,hsl(40_94%_64%),hsl(34_90%_48%))] shadow-[0_12px_30px_-14px_hsl(38_92%_50%/0.9)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(218_52%_11%)]',
            'disabled:cursor-progress disabled:opacity-90 motion-safe:transition-transform motion-safe:hover:-translate-y-px')}>
          {/* A slow gold sweep; still under prefers-reduced-motion. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_35%,hsl(0_0%_100%/0.38)_50%,transparent_65%)] bg-[length:250%_100%] bg-no-repeat motion-safe:animate-[fim-sweep_3.2s_ease-in-out_infinite] motion-reduce:hidden" />
          {running ? <Radar className="relative h-4 w-4 shrink-0 motion-safe:animate-spin [animation-duration:2.4s]" aria-hidden="true" />
            : phase === 'done' || phase === 'slow' ? <RefreshCw className="relative h-4 w-4 shrink-0" aria-hidden="true" />
              : <Search className="relative h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="relative min-w-0 break-words">
            {running ? t('fim_cta_running') : phase === 'done' || phase === 'slow' ? t('fim_cta_again') : t('fim_cta')}
          </span>
        </button>
        {running ? (
          <button type="button" onClick={() => { stop(); setPhase('slow'); }} data-testid="fim-stop"
            className="inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-2xl px-4 text-sm font-semibold text-white/85 ring-1 ring-inset ring-white/25 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white min-[420px]:w-auto">
            {t('fim_stop_watching')}
          </button>
        ) : null}
        <Link to={leadsHref} data-testid="fim-view"
          className="inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white ring-1 ring-inset ring-[hsl(40_94%_62%/0.5)] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white min-[420px]:w-auto">
          <span className="min-w-0 break-words">{count != null && count > 0 ? t('fim_view_n', { n: String(count) }) : t('fim_view')}</span>
          <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>

      <p className="relative mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(218_40%_78%)]">
        <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('fim_weekly_tip')}</span>
        {lastRun ? <span data-testid="fim-last-run">{t('fim_last_run', { date: fmtDate(lastRun) })}</span> : null}
        {phase === 'requesting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      </p>
    </section>
  );
}

export default InternalMatchesPanel;
