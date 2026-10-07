import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type SearchHistoryItem, searchHistory } from '@/services/marketplaceSearch';
import { criteriaChips, type T } from './format';

/** Bounded server metadata; no listing payloads or browser history storage. */
export function SearchDashboard({ t }: { t: T }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(1000, Math.floor(Number(params.get('historyPage')) || 1)));
  const [result, setResult] = useState<{ items: SearchHistoryItem[]; hasMore: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult(null);
    setFailed(false);
    void searchHistory(page).then((data) => { if (alive) setResult(data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [page, retry]);
  const changePage = (next: number) => {
    const updated = new URLSearchParams(params);
    if (next === 1) updated.delete('historyPage'); else updated.set('historyPage', String(next));
    setParams(updated);
  };
  return <section className="space-y-5" aria-label={t('fpw_history')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl font-semibold">{t('fpw_history')}</h2>
      <Link to="/find-property/new" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[hsl(var(--gold))] px-5 font-semibold text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Plus className="h-5 w-5" aria-hidden="true" />{t('mps_new_search')}
      </Link>
    </div>
    <p className="text-sm text-muted-foreground">{t('fpw_history_note')}</p>
    {failed ? <div role="alert" className="space-y-3 rounded-xl border border-border p-5">
      <p>{t('mps_error_generic')}</p><button type="button" onClick={() => setRetry((v) => v + 1)} className="min-h-11 rounded-lg border border-border px-4">{t('fpw_retry')}</button>
    </div> : !result ? <div className="h-40 animate-pulse rounded-xl bg-muted/60" aria-busy="true" /> : result.items.length === 0 ? <p className="rounded-xl border border-border p-6 text-muted-foreground">{t('fpw_history_empty')}</p> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.items.map((item) => <article key={item.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5">
          <h3 dir="auto" className="font-display text-lg font-semibold">{[...(item.brief.districts?.value ?? []), item.brief.city?.value].filter(Boolean).join(' · ') || t('plan_page_title')}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{criteriaChips(item.brief, t).filter((c) => c.key !== 'location').map((c) => c.label).join(' · ')}</p>
          <div className="space-y-1 text-sm">
            <p>{t('fpw_saved_properties', { n: item.uniqueProperties })}</p>
            {item.strongMatches > 0 ? <p className="text-muted-foreground">{t('fpw_saved_strong', { n: item.strongMatches })}</p> : null}
            <p>{t(`fpw_status_${item.status}`)}</p>
            <time dateTime={item.createdAt} className="text-muted-foreground">{new Date(item.createdAt).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </div>
          <Link to={`/find-property/search/${encodeURIComponent(item.id)}`} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('fpw_open_search')}</Link>
        </article>)}
      </div>}
    {result && (page > 1 || result.hasMore) ? <nav className="flex items-center justify-center gap-4" aria-label={t('fpw_history')}>
      <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-40">{t('fpr_previous')}</button>
      <span aria-current="page">{page}</span>
      <button type="button" disabled={!result.hasMore} onClick={() => changePage(page + 1)} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-40">{t('fpr_next')}</button>
    </nav> : null}
  </section>;
}
