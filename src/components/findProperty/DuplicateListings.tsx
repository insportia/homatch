import { Copy, ExternalLink } from 'lucide-react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { isConfirmedDuplicate } from '@/research-core/marketplace/browse-results';
import { checkedAgo, type T, usd } from './format';

/** The "Duplicate" badge: one property published as several listings. */
export function DuplicateBadge({ p, t, onClick, className = '' }: { p: PropertyView; t: T; onClick?: () => void; className?: string }) {
  if (!isConfirmedDuplicate(p)) return null;
  const label = <><Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('mps_duplicate_badge', { n: p.listings.length })}</>;
  const look = `inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--gold))] px-2.5 py-1 text-xs font-semibold text-[#0C1119] shadow-sm ${className}`;
  return onClick
    ? <button type="button" onClick={onClick} data-duplicate-badge className={`${look} min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C1119] focus-visible:ring-offset-2`}>{label}</button>
    : <span data-duplicate-badge className={look}>{label}</span>;
}

/**
 * Every listing of one confirmed property, side by side, so a person sees at
 * once that it is the same flat and what each source asks. Never inferred from
 * a legacy multi-listing view: only the current identity resolver confirms it.
 */
export function DuplicateListings({ p, t, open, onOpenChange }: { p: PropertyView; t: T; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  if (!isConfirmedDuplicate(p)) return null;
  const lowest = Math.min(...p.listings.map((l) => l.priceUsd ?? Infinity));
  return <details open={open} onToggle={(e) => onOpenChange?.((e.currentTarget as HTMLDetailsElement).open)}
    className="overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.05)]" data-confirmed-duplicates>
    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <DuplicateBadge p={p} t={t} />
      <span className="text-xs font-normal text-muted-foreground">{t('mps_duplicate_hint', { n: p.listings.length })}</span>
    </summary>
    <div className="space-y-3 border-t border-[hsl(var(--gold-border))] p-3.5">
      <p className="text-xs leading-relaxed text-muted-foreground">{t(p.identity?.evidence.some((e) => e.startsWith('corroborated')) ? 'fpa_identity_corroborated' : 'fpa_identity_exact')}</p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {p.listings.map((l) => {
          const url = safeExternalUrl(l.exactUrl), image = safeExternalUrl(l.images?.[0]);
          const isLowest = l.priceUsd != null && l.priceUsd === lowest;
          return <li key={l.listingId} className={`flex min-w-0 gap-3 rounded-xl border bg-card p-2.5 shadow-sm ${isLowest ? 'border-[hsl(var(--gold))]' : 'border-border'}`}>
            {image ? <img src={image} alt="" loading="lazy" decoding="async" className="h-20 w-24 shrink-0 rounded-lg object-cover" onError={(e) => { e.currentTarget.hidden = true; }} /> : null}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold-ink))]" dir="auto">{l.sourceName ?? l.source}</p>
              <p className="font-display text-base font-semibold">{usd(l.priceUsd)}{isLowest && p.listings.length > 1 ? <span className="ms-2 rounded-full bg-[hsl(var(--gold)/0.18)] px-2 py-0.5 align-middle text-[11px] font-semibold">{t('mps_price_lowest')}</span> : null}</p>
              {l.priceUsd != null && Number.isFinite(lowest) && l.priceUsd > lowest ? <p className="text-xs text-muted-foreground">+{usd(l.priceUsd - lowest)}</p> : null}
              <p className="text-xs text-muted-foreground">{checkedAgo(l.lastVerifiedAt ?? l.observedAt, t)}</p>
              {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">{t('mps_open_original')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
            </div>
          </li>;
        })}
      </ul>
    </div>
  </details>;
}
