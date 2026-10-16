import { ArrowRight, CalendarDays, Home, MapPin, RotateCcw, Search, Sparkles, Telescope, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type SearchHistoryItem, searchHistory } from '@/services/marketplaceSearch';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import type { T } from '../format';
import { btn, cx, HISTORY_TONE, keyFacts, naturalDate, Pill, RUNNING_STATUSES, searchBudget, searchPlace, searchTitle, Surface } from './primitives';

type Brief = SearchHistoryItem['brief'];

/** The customer's searches: running ones first, then history as compact, scannable cards. */
export function SearchesTab({ t, onRepeat, onCount }: { t: T; onRepeat: (brief: Brief) => void; onCount?: (n: number | null) => void }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(1000, Math.floor(Number(params.get('historyPage')) || 1)));
  const [result, setResult] = useState<{ items: SearchHistoryItem[]; hasMore: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult(null); setFailed(false);
    void searchHistory(page).then((data) => { if (alive) { setResult(data); onCount?.(page === 1 && !data.hasMore ? data.items.length : null); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, retry]);
  const changePage = (next: number) => {
    const updated = new URLSearchParams(params);
    if (next === 1) updated.delete('historyPage'); else updated.set('historyPage', String(next));
    setParams(updated);
  };
  const running = (result?.items ?? []).filter((i) => RUNNING_STATUSES.includes(i.status));
  const past = (result?.items ?? []).filter((i) => !RUNNING_STATUSES.includes(i.status));

  return (
    <div className="space-y-6" data-tab-panel="searches">
      {/* Members' properties that fit any of this person's searches (native matcher). */}
      <NativeMatchesPanel role="SEEKER" />
      {failed ? (
        <Surface className="flex flex-wrap items-center justify-between gap-3 p-5" role="alert">
          <p className="text-sm">{t('mps_error_generic')}</p>
          <button type="button" onClick={() => setRetry((v) => v + 1)} className={btn.quiet}>{t('fpw_retry')}</button>
        </Surface>
      ) : !result ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={t('fpr_loading')}>
          {[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-card/70" />)}
        </div>
      ) : result.items.length === 0 ? (
        <EmptySearches t={t} />
      ) : (
        <>
          {running.length ? (
            <section aria-labelledby="fpx-running" className="space-y-3">
              <h2 id="fpx-running" className="flex items-center gap-2 text-sm font-semibold text-foreground"><Pill tone="live" pulse>{t('fpx_running_now', { n: running.length })}</Pill></h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{running.map((item) => <HistoryCard key={item.id} item={item} t={t} onRepeat={onRepeat} />)}</div>
            </section>
          ) : null}
          {past.length ? (
            <section aria-labelledby="fpx-history" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="fpx-history" className="font-display text-lg font-semibold text-foreground">{t('fpw_history')}</h2>
                <p className="text-xs text-muted-foreground">{t('fpx_history_note')}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{past.map((item) => <HistoryCard key={item.id} item={item} t={t} onRepeat={onRepeat} />)}</div>
            </section>
          ) : null}
        </>
      )}
      {result && (page > 1 || result.hasMore) ? (
        <nav className="flex items-center justify-center gap-3" aria-label={t('fpr_pagination')}>
          <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className={btn.quiet}>{t('fpr_previous')}</button>
          <span aria-current="page" className="min-w-8 text-center text-sm font-semibold tabular-nums">{page}</span>
          <button type="button" disabled={!result.hasMore} onClick={() => changePage(page + 1)} className={btn.quiet}>{t('fpr_next')}</button>
        </nav>
      ) : null}
    </div>
  );
}

function EmptySearches({ t }: { t: T }) {
  return (
    <Surface className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--gold)/0.12)] text-[hsl(var(--gold-ink))]" aria-hidden="true"><Search className="h-6 w-6" /></span>
      <div className="max-w-md space-y-1.5">
        <h2 className="font-display text-xl font-semibold">{t('fpx_empty_title')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('fpx_empty_body')}</p>
      </div>
      <Link to="/find-property/new" className={btn.primary}><Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t('mps_new_search')}</Link>
    </Surface>
  );
}

/** What, where, budget, up to three key facts, when, state, real counts, and two actions. */
export function HistoryCard({ item, t, onRepeat }: { item: SearchHistoryItem; t: T; onRepeat?: (brief: Brief) => void }) {
  const b = item.brief;
  const budget = searchBudget(b, t);
  const facts = keyFacts(b, t);
  const running = RUNNING_STATUSES.includes(item.status);
  const href = `/find-property/search/${encodeURIComponent(item.id)}`;
  return (
    <Surface as="article" data-history-card className="group flex min-w-0 flex-col transition hover:-translate-y-0.5 hover:border-[hsl(var(--gold-border))] motion-reduce:hover:translate-y-0">
      <Link to={href} className="flex min-w-0 flex-1 flex-col gap-4 rounded-t-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--gold))]" aria-label={`${searchTitle(b, t)} — ${t('fpw_view_results')}`}>
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0C1119] text-[hsl(var(--gold))]" aria-hidden="true"><Home className="h-[18px] w-[18px]" /></span>
          <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
            {item.deepSearch ? <Pill tone="gold"><Telescope className="h-3 w-3" aria-hidden="true" />{t('fpx_badge_deep')}</Pill> : <Pill>{t('fpx_badge_free')}</Pill>}
            <Pill tone={HISTORY_TONE[item.status] ?? 'neutral'} pulse={running}>{t(`fpw_status_${item.status}`)}</Pill>
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <h3 dir="auto" className="font-display text-[17px] font-semibold leading-snug text-foreground [text-wrap:balance]">{searchTitle(b, t)}</h3>
          <p dir="auto" className="flex min-w-0 items-center gap-1.5 text-sm text-foreground/75"><MapPin className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span className="truncate">{searchPlace(b, t)}</span></p>
          {budget ? <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Wallet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span dir="ltr" className="tabular-nums">{budget}</span></p> : null}
        </div>
        {facts.length ? <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">{facts.join(' · ')}</p> : null}
        <dl className="mt-auto grid grid-cols-2 gap-2 rounded-xl bg-muted/70 p-3">
          <div className="min-w-0"><dt className="truncate text-2xs font-medium text-muted-foreground">{t('fpx_results')}</dt><dd className="font-display text-xl font-semibold tabular-nums" data-history-count>{item.uniqueProperties ?? '—'}</dd></div>
          <div className="min-w-0"><dt className="truncate text-2xs font-medium text-muted-foreground">{t('fpx_strong')}</dt><dd className="font-display text-xl font-semibold tabular-nums text-[hsl(var(--gold-ink))]">{item.strongMatches ?? '—'}</dd></div>
        </dl>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground group-hover:text-[hsl(var(--gold-ink))]">{t('fpw_view_results')}<ArrowRight className="h-4 w-4 transition rtl:rotate-180" aria-hidden="true" /></span>
      </Link>
      <div className="flex min-h-[52px] items-center justify-between gap-2 border-t border-border px-5 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><time dateTime={item.createdAt}>{naturalDate(item.createdAt)}</time></p>
        {onRepeat ? <button type="button" onClick={() => onRepeat(b)} className={cx(btn.ghost, 'shrink-0 px-2.5')}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('fpx_refine')}</button> : null}
      </div>
    </Surface>
  );
}
