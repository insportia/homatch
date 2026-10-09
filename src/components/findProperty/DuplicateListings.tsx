import { ExternalLink, Layers } from 'lucide-react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { checkedAgo, type T, usd } from './format';

/** Never infer identity from a legacy multi-listing view. Only the current resolver can confirm it. */
export function DuplicateListings({ p, t }: { p: PropertyView; t: T }) {
  if (p.identity?.status !== 'CONFIRMED_DUPLICATE' || p.listings.length < 2) return null;
  return <details className="rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.04)]" data-confirmed-duplicates>
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />{t('fpa_duplicates_action', { n: p.listings.length })}
    </summary>
    <div className="space-y-3 border-t border-[hsl(var(--gold-border))] p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{t(p.identity.evidence.some((e) => e.startsWith('corroborated')) ? 'fpa_identity_corroborated' : 'fpa_identity_exact')}</p>
      <p className="text-sm font-semibold">{t('mps_price_lowest')}: {usd(p.facts.priceUsd)}</p>
      <ul className="space-y-2">
        {p.listings.map((l) => {
          const url = safeExternalUrl(l.exactUrl), image = safeExternalUrl(l.images?.[0]);
          return <li key={l.listingId} className="flex min-w-0 gap-3 rounded-lg border border-border bg-card p-2.5">
            {image ? <img src={image} alt="" loading="lazy" decoding="async" className="h-16 w-20 shrink-0 rounded-md object-cover" onError={(e) => { e.currentTarget.hidden = true; }} /> : null}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-medium" dir="auto">{l.sourceName ?? l.source}</p>
              <p className="text-sm font-semibold">{usd(l.priceUsd)}</p>
              <p className="text-xs text-muted-foreground">{checkedAgo(l.lastVerifiedAt ?? l.observedAt, t)}</p>
              {p.facts.priceUsd != null && l.priceUsd != null && l.priceUsd > p.facts.priceUsd ? <p className="text-xs text-muted-foreground">+{usd(l.priceUsd - p.facts.priceUsd)}</p> : null}
              {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">{t('mps_open_original')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}
            </div>
          </li>;
        })}
      </ul>
    </div>
  </details>;
}
