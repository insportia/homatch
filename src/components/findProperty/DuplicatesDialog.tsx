import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Building2, Camera, Copy, ExternalLink, FileText, MapPin, Maximize2, Phone, Ruler, X } from 'lucide-react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { checkedAgo, type T, usd } from './format';

type Reason = 'SAME_LISTING' | 'PHOTOS' | 'DESCRIPTION' | 'PHONE' | 'LOCATION' | 'ADDRESS_AND_LAYOUT';
const REASON_ICON: Record<Reason, typeof Camera> = {
  SAME_LISTING: Copy, PHOTOS: Camera, DESCRIPTION: FileText, PHONE: Phone, LOCATION: MapPin, ADDRESS_AND_LAYOUT: Ruler,
};

interface Row {
  id: string; source: string; priceUsd: number | null; image: string | null; url: string | null; seen: string | null;
  areaSqm: number | null; floor: number | null; self: boolean; propertyKey: string | null;
}

/** /find-property/search/:id/property/:key — opened in a new tab for a full, side-by-side read. */
function propertyHref(key: string): string | null {
  const m = typeof window !== 'undefined' ? /\/find-property\/search\/([^/?#]+)/.exec(window.location.pathname) : null;
  return m ? `/find-property/search/${m[1]}/property/${encodeURIComponent(key)}` : null;
}

export function duplicateRows(p: PropertyView, confirmed: boolean): Row[] {
  if (confirmed) {
    return p.listings.map((l, i) => ({
      id: l.listingId, source: l.sourceName ?? l.source, priceUsd: l.priceUsd, image: safeExternalUrl(l.images?.[0] ?? (i === 0 ? p.images[0] : undefined)),
      url: safeExternalUrl(l.exactUrl), seen: l.lastVerifiedAt ?? l.observedAt, areaSqm: p.facts.areaSqm, floor: p.facts.floor, self: false, propertyKey: null,
    }));
  }
  const own = p.listings[0];
  return [
    { id: p.key, source: own?.sourceName ?? own?.source ?? '', priceUsd: p.facts.priceUsd, image: safeExternalUrl(p.images[0]), url: safeExternalUrl(own?.exactUrl),
      seen: own ? own.lastVerifiedAt ?? own.observedAt : null, areaSqm: p.facts.areaSqm, floor: p.facts.floor, self: true, propertyKey: null },
    ...(p.possibleMatches ?? []).map((m) => ({
      id: m.key, source: m.sourceName ?? m.source, priceUsd: m.priceUsd, image: safeExternalUrl(m.image ?? undefined), url: safeExternalUrl(m.exactUrl),
      seen: m.observedAt, areaSqm: m.areaSqm, floor: m.floor, self: false,
      /* A social repost is not a separate result: only its original post opens. */
      propertyKey: m.repost ? null : m.key,
    })),
  ];
}

/**
 * Every listing of one flat (or of one that may be the same flat), as small
 * cards with photo, price and the price gap, and the evidence that ties them.
 */
export function DuplicatesDialog({ p, t, open, onOpenChange, confirmed }: { p: PropertyView; t: T; open: boolean; onOpenChange: (o: boolean) => void; confirmed: boolean }) {
  const rows = duplicateRows(p, confirmed);
  const prices = rows.map((r) => r.priceUsd).filter((v): v is number => v != null);
  const lowest = prices.length ? Math.min(...prices) : null, highest = prices.length ? Math.max(...prices) : null;
  const reasons: Reason[] = confirmed
    ? (p.identity?.reasons ?? []) as Reason[]
    : [...new Set((p.possibleMatches ?? []).flatMap((m) => m.reasons ?? []))] as Reason[];
  const self = propertyHref(p.key);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0C1119]/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content data-duplicates-dialog={confirmed ? 'confirmed' : 'possible'}
        className="hm-discovery fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl border border-[hsl(var(--gold-border))] bg-background shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(960px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <header className="relative space-y-2 bg-[#0C1119] px-5 pb-5 pt-5 text-white sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${confirmed ? 'bg-[hsl(var(--gold))] text-[#0C1119]' : 'border border-[hsl(var(--gold))] text-[hsl(var(--gold))]'}`}>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />{confirmed ? t('mps_duplicate_badge', { n: rows.length }) : t('mps_possible_duplicate_badge')}
              </span>
              <DialogPrimitive.Title className="font-display text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
                {t(confirmed ? 'mps_dup_dialog_title_confirmed' : 'mps_dup_dialog_title_possible', { n: rows.length })}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-white/70">
                {t(confirmed ? 'mps_dup_dialog_body_confirmed' : 'mps_dup_dialog_body_possible')}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]" aria-label={t('mps_photo_close')}>
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {lowest != null && highest != null && highest > lowest ? <p className="text-sm text-white/85" data-dup-spread>
            {t('mps_dup_dialog_spread', { low: usd(lowest), high: usd(highest), diff: usd(highest - lowest) })}
          </p> : null}
          {reasons.length ? <ul className="flex flex-wrap gap-1.5 pt-1" data-dup-reasons>
            {reasons.map((r) => { const Icon = REASON_ICON[r]; return <li key={r} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/90"><Icon className="h-3.5 w-3.5 text-[hsl(var(--gold))]" aria-hidden="true" />{t(`mps_dup_reason_${r}`)}</li>; })}
          </ul> : null}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold)/0.7)] to-transparent" aria-hidden="true" />
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const isLowest = r.priceUsd != null && r.priceUsd === lowest && prices.length > 1;
              const more = r.propertyKey ? propertyHref(r.propertyKey) : null;
              return <li key={r.id} data-dup-card className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(12,17,25,0.06),0_12px_28px_-16px_rgba(12,17,25,0.35)] ${isLowest ? 'border-[hsl(var(--gold))]' : 'border-foreground/10'}`}>
                <div className="relative aspect-[4/3] bg-[#0C1119]">
                  {r.image ? <img src={r.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.hidden = true; }} /> : null}
                  {!r.image ? <span className="absolute inset-0 grid place-items-center"><Building2 className="h-10 w-10 text-white/30" aria-hidden="true" /></span> : null}
                  <span dir="auto" className="absolute start-2 top-2 rounded-full bg-[#0C1119]/80 px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-sm">{r.source}</span>
                  {r.self ? <span className="absolute end-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-semibold text-[#0C1119]">{t('mps_possible_duplicate_this')}</span> : null}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-2xl font-semibold tracking-[-0.02em]">{usd(r.priceUsd)}</span>
                    {isLowest ? <span className="rounded-full bg-[hsl(var(--gold)/0.18)] px-2 py-0.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{t('mps_price_lowest')}</span> : null}
                  </p>
                  {r.priceUsd != null && lowest != null && r.priceUsd > lowest ? <p className="text-xs font-medium text-foreground/75">{t('mps_dup_more_expensive', { diff: usd(r.priceUsd - lowest) })}</p> : null}
                  <p className="text-xs text-muted-foreground">{[r.areaSqm != null ? `${r.areaSqm} m²` : null, r.floor != null ? t('mps_possible_duplicate_floor', { n: r.floor }) : null].filter(Boolean).join(' · ')}</p>
                  {r.seen ? <p className="text-xs text-muted-foreground">{checkedAgo(r.seen, t)}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" data-dup-original
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0C1119] px-3 text-xs font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
                      {t('mps_open_original')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
                    {more ? <a href={more} target="_blank" rel="noopener" data-dup-more
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--gold))] px-3 text-xs font-semibold text-foreground transition hover:bg-[hsl(var(--gold)/0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
                      {t('mps_dup_view_more')}<Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
                  </div>
                </div>
              </li>;
            })}
          </ul>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 bg-card px-5 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">{t(confirmed ? 'mps_dup_dialog_note_confirmed' : 'mps_dup_dialog_note_possible')}</p>
          {self ? <a href={self} target="_blank" rel="noopener" data-dup-full
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[hsl(var(--gold))] px-4 text-sm font-semibold text-[#0C1119] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C1119] focus-visible:ring-offset-2">
            {t('mps_dup_open_full')}<Maximize2 className="h-4 w-4" aria-hidden="true" /></a> : null}
        </footer>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
