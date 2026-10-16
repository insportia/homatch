import { ArrowRight, CalendarClock, MapPin, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type SearchHistoryItem, searchHistory } from '@/services/marketplaceSearch';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import { criteriaChips, type T } from './format';

type SearchIntelligenceBrief = SearchHistoryItem['brief'];

/** Bounded server metadata; no listing payloads or browser history storage. */
export function SearchDashboard({ t, onRepeat }: { t: T; onRepeat?: (brief: SearchIntelligenceBrief) => void }) {
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
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0C1119] p-5 text-white shadow-sm sm:p-7">
      <h2 className="font-display text-xl font-semibold">{t('fpw_history')}</h2>
      <Link to="/find-property/new" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[hsl(var(--gold))] px-5 font-semibold text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Plus className="h-5 w-5" aria-hidden="true" />{t('mps_new_search')}
      </Link>
    </div>
    {/* Where the match notification lands: the member matches across this person's searches. */}
    <NativeMatchesPanel role="SEEKER" />
    <p className="text-sm text-muted-foreground">{t('fpw_history_note')}</p>
    {failed ? <div role="alert" className="space-y-3 rounded-xl border border-border p-5">
      <p>{t('mps_error_generic')}</p><button type="button" onClick={() => setRetry((v) => v + 1)} className="min-h-11 rounded-lg border border-border px-4">{t('fpw_retry')}</button>
    </div> : !result ? <div className="h-40 animate-pulse rounded-xl bg-muted/60" aria-busy="true" /> : result.items.length === 0 ? <p className="rounded-xl border border-border p-6 text-muted-foreground">{t('fpw_history_empty')}</p> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.items.map((item) => <HistoryCard key={item.id} item={item} t={t} onRepeat={onRepeat} />)}
      </div>}
    {result && (page > 1 || result.hasMore) ? <nav className="flex items-center justify-center gap-4" aria-label={t('fpw_history')}>
      <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-40">{t('fpr_previous')}</button>
      <span aria-current="page">{page}</span>
      <button type="button" disabled={!result.hasMore} onClick={() => changePage(page + 1)} className="min-h-11 rounded-lg border border-border px-4 disabled:opacity-40">{t('fpr_next')}</button>
    </nav> : null}
  </section>;
}

const HEAD_KEYS = new Set(['location', 'transactionType', 'propertyType']);

/** Title = what (type · deal), subtitle = where; criteria stay compact chips. */
function HistoryCard({ item, t, onRepeat }: { item: SearchHistoryItem; t: T; onRepeat?: (brief: SearchIntelligenceBrief) => void }) {
  const b = item.brief;
  const title = [b.propertyType ? t(`mps_pt_${b.propertyType.value}`) : null, b.transactionType ? t(`mps_tx_${b.transactionType.value}`) : null].filter(Boolean).join(' · ') || t('plan_page_title');
  const place = [...(b.districts?.value ?? []), b.city?.value].filter(Boolean).join(' · ') || t('fpw_card_any_place');
  const chips = criteriaChips(b, t).filter((c) => !HEAD_KEYS.has(c.key));
  const href = `/find-property/search/${encodeURIComponent(item.id)}`;
  return <article data-history-card className="flex min-w-0 flex-col gap-4 rounded-2xl border border-foreground/15 bg-card p-5 shadow-sm transition-shadow hover:border-[hsl(var(--gold-border))] hover:shadow-md">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 dir="auto" className="font-display text-lg font-semibold leading-snug">{title}</h3>
        <p dir="auto" className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{place}</span></p>
      </div>
      <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-2xs font-semibold text-muted-foreground">{t(`fpw_status_${item.status}`)}</span>
    </div>
    {chips.length ? <ul className="flex flex-wrap gap-1.5" aria-label={t('fpw_history')}>
      {chips.map((c) => <li key={c.key} dir="auto" className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{c.label}</li>)}
    </ul> : null}
    <div className="space-y-1 text-sm">
      {item.uniqueProperties !== null ? <p data-history-count className="font-semibold">{t('fpw_card_results', { n: item.uniqueProperties })}</p> : null}
      {(item.strongMatches ?? 0) > 0 ? <p className="text-muted-foreground">{t('fpw_saved_strong', { n: item.strongMatches ?? 0 })}</p> : null}
      <p className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></p>
    </div>
    <div className="mt-auto grid gap-2 sm:grid-cols-2">
      <Link to={href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{t('fpw_view_results')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></Link>
      {onRepeat ? <button type="button" onClick={() => onRepeat(b)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('fpw_repeat_search')}</button> : null}
    </div>
  </article>;
}
