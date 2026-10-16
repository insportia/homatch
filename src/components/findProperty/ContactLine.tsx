import { ExternalLink, Phone, User } from 'lucide-react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import type { T } from './format';

type Listing = PropertyView['listings'][number];

/**
 * How to reach the seller of one listing. A number is shown only when the
 * source published it or the seller wrote it in the listing text (labelled so);
 * otherwise the source keeps it behind its own "show number", and we say so.
 */
export function ContactLine({ listing, t, className = '', compact = false }: { listing: Listing | undefined; t: T; className?: string; compact?: boolean }) {
  if (!listing) return null;
  const phone = listing.seller.publicPhone;
  const source = listing.sourceName ?? listing.source;
  const url = safeExternalUrl(listing.exactUrl);
  /* The card's version: one quiet action, the same two truths (a published number, or the source's own "show number"). */
  if (compact) {
    const look = `inline-flex min-h-[40px] min-w-0 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold text-foreground transition hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${className}`;
    return <div data-contact className="min-w-0">
      {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} data-contact-call title={phone} className={look}>
        <Phone className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span className="truncate">{t('mps_contact_call')}</span>
      </a> : url ? <a href={url} target="_blank" rel="noopener noreferrer" data-contact-source title={t('mps_contact_source_only', { source })} className={look}>
        <Phone className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span dir="auto" className="truncate">{t('fpp_contact_source_short', { source })}</span>
      </a> : null}
    </div>;
  }
  return <div data-contact className={`space-y-1.5 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] p-3 ${className}`}>
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold-ink))]">
      {t('mps_contact_title')}
      {listing.seller.name ? <span className="inline-flex items-center gap-1 normal-case tracking-normal text-foreground/85"><User className="h-3.5 w-3.5" aria-hidden="true" /><span dir="auto">{listing.seller.name}</span></span> : null}
    </p>
    {phone ? <>
      <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} data-contact-call
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--gold))] px-4 text-sm font-semibold text-[#0C1119] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C1119] focus-visible:ring-offset-2">
        <Phone className="h-4 w-4" aria-hidden="true" />{t('mps_contact_call')} · <span dir="ltr">{phone}</span>
      </a>
      {listing.seller.phoneFromDescription ? <p className="text-xs text-muted-foreground">{t('mps_contact_from_description')}</p> : null}
    </> : url ? <>
      <a href={url} target="_blank" rel="noopener noreferrer" data-contact-source
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#0C1119] px-4 text-sm font-semibold text-foreground transition hover:bg-[#0C1119]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
        <Phone className="h-4 w-4" aria-hidden="true" />{t('mps_contact_on_source', { source })}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
      <p className="text-xs text-muted-foreground">{t('mps_contact_source_only', { source })}</p>
    </> : null}
  </div>;
}
