import { AlertTriangle, ArrowRight, BedDouble, Check, Clock, DoorOpen, Globe2, MapPin, Ruler, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { listingTimes, num, pct, type T, usd } from './format';
import { PropertyGallery } from './PropertyGallery';
import { DuplicateBadge } from './DuplicateListings';
import { DuplicatesDialog } from './DuplicatesDialog';
import { ContactLine } from './ContactLine';

/** Every source this property was found on, by its public name. */
export const sourceNames = (p: PropertyView) => [...new Set(p.listings.map((l) => l.sourceName ?? l.source).filter(Boolean))];
import { safeExternalUrl } from '@/lib/safeExternalUrl';

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

export function missingRequirements(codes: string[], t: T): string {
  const labels: Record<string, string> = { AREA: 'mps_fact_area', ROOMS: 'mps_fact_rooms', BEDROOMS: 'mps_fact_bedrooms',
    BATHROOMS: 'mps_fact_bathrooms', FLOOR_NOT_FIRST: 'fpa_NOT_FIRST', FLOOR_NOT_LAST: 'fpa_NOT_LAST', FLOOR_RANGE: 'mps_fact_floor',
    BUILDING_AGE: 'fpa_building_age', BUILDING_STATUS: 'mps_fact_building', DISTRICT: 'mps_filter_district',
    PARKING: 'mps_fact_parking', FURNISHED: 'mps_amenity_FURNISHED' };
  return [...new Set(codes.map((code) => t(labels[code] ?? (code.startsWith('REQUIRED_') ? `mps_amenity_${code.slice(9)}` : 'mps_not_stated'))))].join(' · ');
}

export function PropertyCard({ p, t, onOpen, compareSelected, onToggleCompare, budgetMaxUsd }: {
  p: PropertyView; t: T; onOpen: () => void; compareSelected: boolean; onToggleCompare: () => void;
  budgetMaxUsd?: number | null;
}) {
  const f = p.facts;
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const upgrade = p.group === 'UPGRADE' ? p.upgrade : null;
  const intel = p.intelligence;
  const original = safeExternalUrl(p.listings.find((l) => l.listingId === intel?.primaryListingId)?.exactUrl ?? p.listings[0]?.exactUrl);
  const elevator = f.elevator ?? (f.amenities.includes('ELEVATOR') ? true : f.amenities.includes('NO_ELEVATOR') ? false : null);
  const sources = sourceNames(p);
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirmedDuplicate = p.identity?.status === 'CONFIRMED_DUPLICATE' && p.listings.length > 1;
  const showDuplicates = () => setDialogOpen(true);
  return (
    <article data-property-key={p.key} className="hm-discovery-panel group flex min-w-0 flex-col overflow-hidden rounded-2xl border-foreground/10 shadow-[0_1px_2px_rgba(12,17,25,0.06),0_12px_28px_-16px_rgba(12,17,25,0.35)] transition hover:border-[hsl(var(--gold-border))] hover:shadow-[0_1px_2px_rgba(12,17,25,0.08),0_18px_36px_-16px_rgba(12,17,25,0.45)] motion-safe:hover:-translate-y-0.5">
      <PropertyGallery images={p.images} t={t} onOpen={onOpen} overlay={<>
        {sources.map((name) => <span key={name} dir="auto" className="rounded-full bg-[#0C1119]/80 px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-sm">{name}</span>)}
        <DuplicateBadge p={p} t={t} onClick={showDuplicates} />
      </>} />
      <div className="h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold)/0.55)] to-transparent" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] text-foreground">{usd(f.priceUsd)}</p>
          {f.pricePerSqmUsd ? <p className="text-sm text-muted-foreground">{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
        </div>
        {place ? <h3 className="inline-flex items-center gap-1.5 text-sm font-medium"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span dir="auto">{place}</span></h3> : null}
        {upgrade && upgrade.overMaxPct !== null ? (
          <p className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{budgetMaxUsd != null && f.priceUsd != null
            ? t('fpw_over_budget', { amount: usd(Math.max(0, f.priceUsd - budgetMaxUsd)), pct: pct(upgrade.overMaxPct) })
            : t('mps_upgrade_over', { pct: pct(upgrade.overMaxPct) })}</p>
        ) : null}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-foreground/85">
          {f.areaSqm ? <li className="inline-flex items-center gap-1.5"><Ruler className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_value_area', { v: num(f.areaSqm) })}</li> : null}
          {f.rooms !== null ? <li className="inline-flex items-center gap-1.5"><DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_rooms_n', { n: f.rooms })}</li> : null}
          {f.bedrooms !== null ? <li className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_bedrooms_n', { n: f.bedrooms })}</li> : null}
        </ul>
        {f.floor != null ? <p className="text-xs text-muted-foreground">{f.totalFloors ? t('mps_floor_of', { n: f.floor, total: f.totalFloors }) : `${t('mps_fact_floor')}: ${f.floor}`}</p> : null}
        <p className="text-xs text-foreground/80">{t(elevator === true ? 'fpa_elevator_yes' : elevator === false ? 'fpa_elevator_no' : 'fpa_elevator_unknown')}{f.renovationStatus ? ` · ${t(`mps_rn_${f.renovationStatus}`)}` : ''}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {p.seller.classification !== 'UNKNOWN' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground/85">
              {p.seller.classification === 'LIKELY_OWNER' || p.seller.classification === 'VERIFIED_OWNER' ? <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
              {sellerLabel(p.seller, t)}
            </span>
          ) : null}
        </div>
        {(() => {
          const times = listingTimes(p.listings.find((l) => l.listingId === intel?.primaryListingId) ?? p.listings[0], t);
          return <div data-card-times className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            <p className="min-w-0">
              {times.published ? <span className="block font-medium text-foreground/85">{times.published}</span> : null}
              {times.updated ? <span className="block font-medium text-foreground/85">{times.updated}</span> : null}
              {times.unknown ? <span className="block">{t('mps_time_unknown')}</span> : null}
              {times.seen ? <span className="block">{times.seen}</span> : null}
            </p>
          </div>;
        })()}
        {p.priceDiscrepancy?.significant ? <p className="text-xs text-muted-foreground">{t('mps_price_diff_badge')}</p> : null}
        {dialogOpen ? <DuplicatesDialog p={p} t={t} open={dialogOpen} onOpenChange={setDialogOpen} confirmed={confirmedDuplicate} /> : null}

        {upgrade ? (
          <div className="space-y-2 rounded-xl bg-[hsl(var(--gold)/0.06)] p-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">{t('mps_upgrade_why')}</p>
            <ul className="space-y-1">
              {upgrade.advantages.slice(0, 2).map((a) => (
                <li key={a.code} className="flex items-start gap-2 text-sm text-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{advantageText(a, t)}</li>
              ))}
            </ul>
          </div>
        ) : p.reasons.length ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t('mps_why_title')}</p>
            <ul className="space-y-1">
              {!upgrade ? <li className="text-xs text-foreground/85">{t('fpr_in_budget')}</li> : null}
              {p.reasons.filter((r) => r.code !== 'VERIFIED_RECENTLY').slice(0, 2).map((r) => (
                <li key={r.code} className="flex items-start gap-2 text-sm text-foreground/90"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{reasonText(r, t)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {intel && intel.preferences.unconfirmed.length + intel.preferences.mentioned.length + intel.preferences.contradicted.length > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">{t('fpr_compromise', { n: intel.preferences.unconfirmed.length + intel.preferences.mentioned.length + intel.preferences.contradicted.length })}</p> : null}
        {intel?.warnings.length ? <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(var(--gold-ink))]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`fpr_warning_${intel.warnings[0]}`)}</p> : null}
        {p.unverified.length > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">{t('mps_not_stated')}: {missingRequirements(p.unverified, t)}</p> : null}
        {f.floor != null && f.totalFloors != null && f.floor === f.totalFloors ? <p className="text-xs leading-relaxed text-muted-foreground">{t('fpa_top_floor_note')}</p> : null}
        <ContactLine listing={p.listings.find((l) => l.listingId === intel?.primaryListingId) ?? p.listings[0]} t={t} className="mt-auto" />
        <p className="inline-flex items-center gap-1.5 pt-1 text-xs font-medium text-foreground/80" data-card-source>
          <Globe2 className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span dir="auto">{t('mps_card_source', { source: sources.join(' · ') })}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpen}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-5 text-sm font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
            {t('mps_view_property')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button type="button" onClick={onToggleCompare} aria-pressed={compareSelected}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${compareSelected ? 'border-[#0C1119] bg-[#0C1119]/5 text-foreground' : 'border-border text-foreground/80 hover:bg-muted'}`}>
            {compareSelected ? <Check className="me-1 h-4 w-4" aria-hidden="true" /> : null}{t('mps_compare')}
          </button>
        </div>
        {original ? <a href={original} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center text-xs font-medium text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('mps_open_original')}</a> : null}
      </div>
    </article>
  );
}
