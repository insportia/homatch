/*
 * Deep Search — ONE paid campaign's own results page (/find-property/campaign/:runId).
 *
 * Stable: the server keeps each campaign's verdicts (find_property_campaign_results), so a
 * refresh, a shared link to the owner, or a visit months later shows the same list. Never
 * mixed with the free search's portal results. Exact matches first; potential matches say
 * exactly which requirements the post does not state; alternatives (one number slightly
 * off) appear only when the customer asks. Every count and verdict is the server's.
 */
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Copy, Heart, Loader2, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSavedListing } from '@/services/savedListings';
import { campaignResults, OPEN_CAMPAIGN, type CampaignResultItem, type CampaignResults } from '@/services/paidCampaign';
import { CheckRow, CriteriaSummary, placeText, ResultFunnel, SettlementCard } from './CampaignParts';
import type { T } from '../format';
import { btn, cx, Eyebrow, naturalDate, Pill, Surface } from '../workspace/primitives';

const VIEWS = ['EXACT', 'POTENTIAL', 'MATCHES', 'ALTERNATIVE'] as const;
const SORTS = ['BEST', 'PRICE_ASC', 'PRICE_DESC', 'NEWEST'] as const;
const PAGE = 12;
const nf = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);

export function CampaignResultsView({ runId }: { runId: string }) {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view')! : null;
  const sort = (SORTS as readonly string[]).includes(params.get('sort') ?? '') ? params.get('sort')! : 'BEST';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [data, setData] = useState<CampaignResults | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'FAILED' | 'NOT_FOUND'>('LOADING');
  const [retry, setRetry] = useState(0);

  /* Default view: exact matches when there are any, else every match. */
  const effectiveView = view ?? (data?.outcome ? (data.outcome.exact > 0 ? 'EXACT' : 'MATCHES') : 'MATCHES');

  useEffect(() => {
    let live = true;
    setState((s) => (s === 'READY' ? 'READY' : 'LOADING'));
    campaignResults(runId, { view: effectiveView, sort, page, pageSize: PAGE }).then((r) => {
      if (!live) return;
      if (r.data) { setData(r.data); setState('READY'); } else setState(r.reasonCode === 'UNKNOWN_CAMPAIGN' ? 'NOT_FOUND' : 'FAILED');
    }).catch(() => { if (live) setState('FAILED'); });
    return () => { live = false; };
  }, [runId, effectiveView, sort, page, retry]);

  /* Filters and pages replace history: Back leaves the results page. */
  const set = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
    window.scrollTo({ top: 0 });
  }, [params, setParams]);

  if (state === 'LOADING' && !data) return <Shell t={t} searchId={null}><div className="space-y-3" aria-busy="true"><div className="h-28 animate-pulse rounded-2xl bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div></Shell>;
  if (state === 'NOT_FOUND') return <Shell t={t} searchId={null}><Surface className="p-8 text-center"><p className="text-sm text-muted-foreground">{t('fpc_not_found')}</p></Surface></Shell>;
  if (state === 'FAILED' && !data) return (
    <Shell t={t} searchId={null}><Surface className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
      <p className="text-sm text-muted-foreground">{t('fpc_load_failed')}</p>
      <button type="button" className={btn.quiet} onClick={() => setRetry((n) => n + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('fpc_retry')}</button>
    </Surface></Shell>
  );
  if (!data) return null;

  const o = data.outcome;
  const running = OPEN_CAMPAIGN.includes(data.run.status);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const counts: Record<string, number | null> = { EXACT: o?.exact ?? null, POTENTIAL: o?.potential ?? null, MATCHES: o ? o.exact + o.potential : null, ALTERNATIVE: o?.alternative ?? null };
  return (
    <Shell t={t} searchId={data.run.searchId} completedAt={data.run.completedAt}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <CriteriaSummary t={t} criteria={data.run.criteria} originalText={data.run.originalText} />
          {running ? <Surface className="flex items-center gap-2 p-4 text-sm" role="status"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{t('fpc_still_running')}</Surface> : null}
          {/* Rebuilt from stored posts after the campaign, and not provably identical to what it found. */}
          {o?.provenance && o.provenance.captured === 'RECONSTRUCTED' && !o.provenance.verified
            ? <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground" role="note" data-campaign-rebuilt>{t('fpc_rebuilt_note')}</p> : null}
          {o ? (
            <>
              <div role="tablist" aria-label={t('fpc_views')} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {VIEWS.map((v) => (
                  <button key={v} role="tab" type="button" aria-selected={effectiveView === v} onClick={() => set({ view: v, page: null })} data-view={v}
                    className={cx('inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition',
                      effectiveView === v ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-border bg-card text-foreground hover:border-[hsl(var(--gold-border))]')}>
                    {t(`fpc_view_${v.toLowerCase()}`)}<span className="tabular-nums opacity-70">{counts[v] ?? ''}</span>
                  </button>
                ))}
              </div>
              {effectiveView === 'ALTERNATIVE' ? <p className="rounded-xl border border-[hsl(32_78%_36%/0.25)] bg-[hsl(32_78%_36%/0.06)] p-3 text-xs leading-relaxed text-[hsl(32_78%_28%)]">{t('fpc_alternative_note')}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground" aria-live="polite" data-results-total={data.total}>{data.view === effectiveView ? t('fpc_showing', { n: nf(data.total) }) : '\u00a0'}</p>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t('fpc_sort')}</span>
                  <select value={sort} onChange={(e) => set({ sort: e.target.value === 'BEST' ? null : e.target.value, page: null })}
                    className="h-10 rounded-xl border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
                    {SORTS.map((s) => <option key={s} value={s}>{t(`fpc_sort_${s.toLowerCase()}`)}</option>)}
                  </select>
                </label>
              </div>
              {data.view !== effectiveView ? <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" /> : data.items.length ? (
                <ol className="space-y-3" data-campaign-results>
                  {data.items.map((item, i) => <li key={item.id} className="motion-safe:animate-[hm-rise_420ms_ease-out_both]" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}><ResultCard t={t} item={item} /></li>)}
                </ol>
              ) : <EmptyState t={t} view={effectiveView} outcome={o} onShow={(v) => set({ view: v, page: null })} />}
              {pages > 1 ? (
                <nav className="flex items-center justify-center gap-2" aria-label={t('fpc_pages')}>
                  <button type="button" className={btn.icon} disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} aria-label={t('fpc_prev')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>
                  <span className="text-sm tabular-nums">{t('fpc_page_of', { page, pages })}</span>
                  <button type="button" className={btn.icon} disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} aria-label={t('fpc_next')}><ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>
                </nav>
              ) : null}
            </>
          ) : running ? null : <Surface className="p-6 text-sm text-muted-foreground">{t('fpc_preparing')}</Surface>}
        </div>
        {/* Phones: the real match count and the money come first; desktop: a sticky side column. */}
        <aside className="order-first min-w-0 space-y-4 lg:order-last lg:sticky lg:top-4 lg:self-start">
          {o ? <Surface className="p-4"><ResultFunnel t={t} outcome={o} animate /></Surface> : null}
          <SettlementCard t={t} s={data.settlement} />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ t, searchId, completedAt, children }: { t: T; searchId: string | null; completedAt?: string | null; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6" data-campaign-page>
      {searchId ? <Link to={`/find-property/search/${encodeURIComponent(searchId)}`} className={cx(btn.ghost, '-ms-3 mb-2')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('fpc_back_to_search')}</Link> : null}
      <header className="mb-4">
        <Eyebrow>{t('fpx_deep_eyebrow')}</Eyebrow>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t('fpc_page_title')}</h1>
        {completedAt ? <p className="mt-1 text-sm text-muted-foreground">{t('fpc_completed_at', { when: naturalDate(completedAt) })}</p> : null}
      </header>
      {children}
    </div>
  );
}

function EmptyState({ t, view, outcome, onShow }: { t: T; view: string; outcome: NonNullable<CampaignResults['outcome']>; onShow: (v: string) => void }) {
  const other = view === 'EXACT' && outcome.potential > 0 ? 'POTENTIAL' : view !== 'ALTERNATIVE' && outcome.alternative > 0 ? 'ALTERNATIVE' : null;
  return (
    <Surface className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-results-empty={view}>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t(view === 'EXACT' ? 'fpc_empty_exact' : view === 'ALTERNATIVE' ? 'fpc_empty_alternative' : 'fpc_empty_matches')}</p>
      {other ? <button type="button" className={btn.quiet} onClick={() => onShow(other)}>{t(`fpc_show_${other.toLowerCase()}`)}</button> : null}
    </Surface>
  );
}

const NETWORK: Record<string, string> = { FACEBOOK: 'Facebook', TELEGRAM: 'Telegram', TIKTOK: 'TikTok', INSTAGRAM: 'Instagram', VK: 'VK' };

function ResultCard({ t, item }: { t: T; item: CampaignResultItem }) {
  const saved = useSavedListing(`dc:${item.id}`);
  const tone = item.category === 'EXACT' ? 'success' : item.category === 'POTENTIAL' ? 'warning' : 'neutral';
  const facts = [
    item.rooms != null ? t('fpc_c_rooms', { n: item.rooms }) : null,
    item.bedrooms != null ? t('fpc_c_bedrooms', { n: item.bedrooms }) : null,
    item.areaSqm != null ? t('fpc_c_area', { n: item.areaSqm }) : null,
    item.floor != null ? t('fpc_floor', { n: item.totalFloors ? `${item.floor}/${item.totalFloors}` : item.floor }) : null,
  ].filter(Boolean) as string[];
  const place = [placeText(item.district), placeText(item.city)].filter(Boolean).join(', ');
  const relevant = item.checks.filter((c) => c.key !== 'transaction' && c.key !== 'fresh');
  const unverified = relevant.filter((c) => c.state === 'UNVERIFIED').length;
  const safeUrl = item.url && /^https:\/\//.test(item.url) ? item.url : null;
  return (
    <Surface as="article" className="overflow-hidden" data-result={item.category}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        {item.images[0] && /^https:\/\//.test(item.images[0]) ? (
          <img src={item.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-40 w-full shrink-0 rounded-xl bg-muted object-cover sm:h-28 sm:w-36" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={tone}>{t(`fpc_cat_${item.category.toLowerCase()}`)}</Pill>
            {item.network ? <Pill>{NETWORK[item.network] ?? item.network}</Pill> : null}
            {item.duplicates > 0 ? <Pill tone="neutral"><Copy className="h-3 w-3" aria-hidden="true" />{t('fpc_reposts', { n: item.duplicates })}</Pill> : null}
          </div>
          <p className="font-display text-xl font-semibold tabular-nums">
            {item.price ? <bdi>{nf(item.price.amount)} {item.price.currency}</bdi> : <span className="text-base text-muted-foreground">{t('fpc_price_unstated')}</span>}
            {item.price && item.price.currency !== 'USD' && item.priceUsd ? <span className="ms-2 text-sm font-normal text-muted-foreground">≈ ${nf(item.priceUsd)}</span> : null}
          </p>
          <p className="text-sm text-foreground/85"><bdi>{[place || t('fpc_place_unstated'), ...facts].join(' · ')}</bdi></p>
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground"><bdi>{item.excerpt}</bdi></p>
          {item.publishedAt ? <p className="text-xs text-muted-foreground">{t('fpc_posted', { when: naturalDate(item.publishedAt) })}</p> : null}
        </div>
      </div>
      <details className="border-t border-border px-4 py-3">
        <summary className="cursor-pointer select-none text-sm font-semibold">
          {item.category === 'EXACT' ? t('fpc_why_exact') : item.category === 'POTENTIAL' ? t('fpc_why_potential', { n: unverified }) : t('fpc_why_alternative')}
        </summary>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{relevant.map((c) => <CheckRow key={c.key} t={t} c={c} />)}</ul>
        {item.category === 'POTENTIAL' ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('fpc_verify_hint')}</p> : null}
      </details>
      <div className="flex flex-wrap gap-2 border-t border-border p-3">
        {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer nofollow" className={btn.primary} data-action="open-original">{t('fpc_open_original')}<ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /></a> : null}
        <button type="button" className={btn.quiet} aria-pressed={saved.saved} disabled={saved.busy}
          onClick={() => void saved.toggle({ title: item.title, city: item.city, district: item.district, price: item.priceUsd, currency: item.priceUsd != null ? 'USD' : null, transaction: null, areaSqm: item.areaSqm, rooms: item.rooms, url: safeUrl, sourceHost: item.network ? NETWORK[item.network] ?? null : null, imageUrl: item.images[0]?.startsWith('https://') ? item.images[0] : null })}>
          <Heart className={cx('h-4 w-4', saved.saved && 'fill-current text-[hsl(0_66%_48%)]')} aria-hidden="true" />{t(saved.saved ? 'fpc_saved' : 'fpc_save')}
        </button>
        {saved.failed ? <p role="alert" className="self-center text-xs text-[hsl(0_66%_44%)]">{t('fpc_save_failed')}</p> : null}
      </div>
    </Surface>
  );
}
