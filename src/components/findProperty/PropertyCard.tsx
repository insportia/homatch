import { ArrowRight, Bookmark, BookmarkCheck, Check, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { assessProperty } from '@/research-core/marketplace/advisor';
import type { SearchIntelligenceBrief } from '@/research-core/marketplace/brief';
import type { PropertyView } from '@/services/marketplaceSearch';
import { listingTimes, num, pct, type T, usd } from './format';
import { amenityLabel, summaryText } from './advisorText';
import { PropertyGallery } from './PropertyGallery';
import { DuplicateBadge } from './DuplicateListings';
import { DuplicatesDialog } from './DuplicatesDialog';
import { listingKeyOf, listingSnapshot, noteListingInterest, useSavedListing } from '@/services/savedListings';

/** Every source this property was found on, by its public name. */
export const sourceNames = (p: PropertyView) => [...new Set(p.listings.map((l) => l.sourceName ?? l.source).filter(Boolean))];

export const SELLER_KEY: Record<string, string> = {
  VERIFIED_OWNER: 'fpw_seller_owner', LIKELY_OWNER: 'fpw_seller_likely_owner', AGENCY: 'fpw_seller_broker_agency',
  BROKER: 'fpw_seller_broker_agency', DEVELOPER: 'mps_seller_developer', UNKNOWN: 'mps_seller_unknown',
  OWNER: 'fpw_seller_any_owner',
};
export function sellerLabel(seller: { classification: string; reasonCodes?: string[] }, t: T) {
  const inferred = !seller.reasonCodes?.some((code) => code.startsWith('DECLARED_'));
  if (inferred && seller.classification === 'BROKER') return t('fpr_seller_likely_broker');
  if (inferred && seller.classification === 'AGENCY') return t('fpr_seller_likely_agency');
  // The source itself says agent (MyHome "აგენტი"): say exactly that.
  if (seller.reasonCodes?.includes('DECLARED_BROKER')) return t('mps_seller_agent');
  return t(SELLER_KEY[seller.classification]);
}

export function reasonText(r: { code: string; count?: number }, t: T) {
  return t(`mps_reason_${r.code}`, { n: r.count ?? 0 });
}

export function advantageText(a: { code: string; delta: number | null }, t: T) {
  return t(`mps_adv_${a.code}`, { n: a.delta !== null ? Math.abs(a.delta) : 0 });
}

const REQUIREMENT_LABELS: Record<string, string> = { AREA: 'mps_fact_area', ROOMS: 'mps_fact_rooms', BEDROOMS: 'mps_fact_bedrooms',
  BATHROOMS: 'mps_fact_bathrooms', FLOOR_NOT_FIRST: 'fpa_NOT_FIRST', FLOOR_NOT_LAST: 'fpa_NOT_LAST', FLOOR_RANGE: 'mps_fact_floor',
  BUILDING_AGE: 'fpa_building_age', BUILDING_STATUS: 'mps_fact_building', DISTRICT: 'mps_filter_district',
  PARKING: 'mps_fact_parking', FURNISHED: 'fpv_amenity_FURNISHED' };
export const requirementLabel = (code: string, t: T) =>
  REQUIREMENT_LABELS[code] ? t(REQUIREMENT_LABELS[code]) : code.startsWith('REQUIRED_') ? amenityLabel(code.slice(9), t) : t('fpv_amenity_OTHER');

export function missingRequirements(codes: string[], t: T): string {
  return [...new Set(codes.map((code) => requirementLabel(code, t)))].join(' · ');
}

export const VERDICT_TONE: Record<string, string> = {
  TOP: 'bg-[hsl(var(--gold))] text-[#0C1119]',
  GOOD: 'bg-[hsl(var(--gold)/0.16)] text-[hsl(var(--gold-ink))]',
  CONSIDER: 'bg-muted text-foreground/75',
  UPGRADE: 'bg-[hsl(var(--info)/0.1)] text-[hsl(var(--info))]',
};

/**
 * One result, compact: photo, price and place, rooms and size, the advisor's
 * one-line reading against this customer's request, and the way into the full
 * assessment. Everything else (contacts, sellers, every listing) lives there.
 */
export function PropertyCard({ p, t, onOpen, compareSelected, onToggleCompare, brief, searchId, transaction }: {
  p: PropertyView; t: T; onOpen: () => void; compareSelected: boolean; onToggleCompare: () => void;
  /** The customer's request; the card reads the property against it. */
  brief: SearchIntelligenceBrief;
  /** For the customer's own interest history (views and saves); optional. */
  searchId?: string | null; transaction?: string | null;
}) {
  const { lang } = useLanguage();
  const save = useSavedListing(listingKeyOf(p));
  const open = () => { noteListingInterest('VIEWED', p, { searchId, transaction }); onOpen(); };
  const f = p.facts;
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const assessment = useMemo(() => assessProperty(p, brief), [p, brief]);
  const summary = summaryText(assessment, t, lang);
  const sources = sourceNames(p);
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirmedDuplicate = p.identity?.status === 'CONFIRMED_DUPLICATE' && p.listings.length > 1;
  const primary = p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0];
  const times = listingTimes(primary, t);
  const size = f.rooms !== null && f.areaSqm ? t('fpv_rooms_area', { rooms: f.rooms, area: num(f.areaSqm) })
    : f.areaSqm ? t('fpv_area_only', { area: num(f.areaSqm) }) : f.rooms !== null ? t('fpv_rooms_only', { rooms: f.rooms }) : null;
  const floor = f.floor != null ? (f.totalFloors ? t('mps_floor_of', { n: f.floor, total: f.totalFloors }) : `${t('mps_fact_floor')}: ${f.floor}`) : null;
  return (
    <article data-property-key={p.key} data-match={p.intelligence?.strong ? 'STRONG' : assessment.verdict === 'GOOD' ? 'PARTIAL' : 'ALTERNATIVE'} data-verdict={assessment.verdict}
      className="group grid min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(12,17,25,0.04),0_10px_28px_-22px_rgba(12,17,25,0.35)] transition hover:border-[hsl(var(--gold-border))] md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <div className="min-w-0 md:self-stretch md:[&>[role=group]]:h-full md:[&>[role=group]]:aspect-auto md:[&>[role=group]]:min-h-[11rem]">
        <PropertyGallery images={p.images} t={t} onOpen={open} overlay={<DuplicateBadge p={p} t={t} onClick={() => setDialogOpen(true)} />} />
      </div>
      <div className="flex min-w-0 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground tabular-nums" dir="ltr">{usd(f.priceUsd)}</p>
            {place ? <h3 className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground/85"><MapPin className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span dir="auto" className="truncate">{place}</span></h3> : null}
          </div>
          <button type="button" onClick={() => void save.toggle(listingSnapshot(p, transaction))} aria-pressed={save.saved} disabled={save.busy}
            aria-label={save.saved ? t('fpi_unsave') : t('fpi_save')} title={save.saved ? t('fpi_unsave') : t('fpi_save')}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] disabled:opacity-60 ${save.saved ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.14)] text-[hsl(var(--gold-ink))]' : 'border-border text-foreground/70 hover:border-[hsl(var(--gold-border))] hover:text-foreground'}`}>
            {save.saved ? <BookmarkCheck className="h-[18px] w-[18px]" aria-hidden="true" /> : <Bookmark className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>
        </div>
        {size || floor || f.pricePerSqmUsd ? <p className="text-sm text-muted-foreground">{[size, floor, f.pricePerSqmUsd ? t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) }) : null].filter(Boolean).join(' · ')}</p> : null}
        <p className="text-sm leading-relaxed text-foreground/90" data-advisor-summary>
          <span className={`me-2 inline-flex rounded-full px-2 py-0.5 align-[1px] text-2xs font-semibold ${VERDICT_TONE[assessment.verdict]}`} data-match-badge>{t(`fpv_verdict_${assessment.verdict}`)}</span>
          <span dir="auto">{summary}</span>
        </p>
        {p.upgrade && p.upgrade.overMaxPct !== null && f.priceUsd != null && brief.price?.value.max != null ? (
          <p className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{t('fpw_over_budget', { amount: usd(Math.max(0, f.priceUsd - brief.price.value.max)), pct: pct(p.upgrade.overMaxPct) })}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
          <p className="min-w-0 truncate text-xs text-muted-foreground" data-card-source>
            <span dir="auto">{t('mps_card_source', { source: sources.join(' · ') })}</span>
            {times.published || times.updated ? <span data-card-times> · {times.updated ?? times.published}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={onToggleCompare} aria-pressed={compareSelected}
              className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${compareSelected ? 'bg-[#0C1119]/5 text-foreground' : 'text-foreground/70 hover:bg-muted hover:text-foreground'}`}>
              {compareSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}{t('mps_compare')}
            </button>
            <button type="button" onClick={open} data-action="open-assessment"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0C1119] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1A2331] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
              {t('fpv_see_assessment')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        </div>
        {save.failed ? <p role="alert" className="text-xs text-destructive">{t('fpi_save_failed')}</p> : null}
        {dialogOpen ? <DuplicatesDialog p={p} t={t} open={dialogOpen} onOpenChange={setDialogOpen} confirmed={confirmedDuplicate} /> : null}
      </div>
    </article>
  );
}
