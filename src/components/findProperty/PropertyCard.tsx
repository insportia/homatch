import { AlertTriangle, ArrowRight, BedDouble, Bookmark, BookmarkCheck, Check, Clock, DoorOpen, Globe2, MapPin, Ruler, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { listingTimes, num, pct, type T, usd } from './format';
import { PropertyGallery } from './PropertyGallery';
import { DuplicateBadge } from './DuplicateListings';
import { DuplicatesDialog } from './DuplicatesDialog';
import { ContactLine } from './ContactLine';
import { listingKeyOf, listingSnapshot, noteListingInterest, useSavedListing } from '@/services/savedListings';

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

const REQUIREMENT_LABELS: Record<string, string> = { AREA: 'mps_fact_area', ROOMS: 'mps_fact_rooms', BEDROOMS: 'mps_fact_bedrooms',
  BATHROOMS: 'mps_fact_bathrooms', FLOOR_NOT_FIRST: 'fpa_NOT_FIRST', FLOOR_NOT_LAST: 'fpa_NOT_LAST', FLOOR_RANGE: 'mps_fact_floor',
  BUILDING_AGE: 'fpa_building_age', BUILDING_STATUS: 'mps_fact_building', DISTRICT: 'mps_filter_district',
  PARKING: 'mps_fact_parking', FURNISHED: 'mps_amenity_FURNISHED' };
export const requirementLabel = (code: string, t: T) =>
  t(REQUIREMENT_LABELS[code] ?? (code.startsWith('REQUIRED_') ? `mps_amenity_${code.slice(9)}` : 'mps_not_stated'));

export function missingRequirements(codes: string[], t: T): string {
  return [...new Set(codes.map((code) => requirementLabel(code, t)))].join(' · ');
}

export function PropertyCard({ p, t, onOpen, compareSelected, onToggleCompare, budgetMaxUsd, searchId, transaction }: {
  p: PropertyView; t: T; onOpen: () => void; compareSelected: boolean; onToggleCompare: () => void;
  budgetMaxUsd?: number | null;
  /** For the customer's own interest history (views and saves); optional. */
  searchId?: string | null; transaction?: string | null;
}) {
  const save = useSavedListing(listingKeyOf(p));
  const open = () => { noteListingInterest('VIEWED', p, { searchId, transaction }); onOpen(); };
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
  const badge = upgrade ? { key: 'fpx_badge_upgrade', tone: 'border-[hsl(var(--info)/0.3)] bg-[hsl(var(--info)/0.1)] text-[hsl(var(--info))]' }
    : intel?.strong ? { key: 'fpx_badge_strong', tone: 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#0C1119]' }
      : p.unverified.length ? { key: 'fpx_badge_partial', tone: 'border-border bg-muted text-foreground/80' }
        : { key: 'fpx_badge_alternative', tone: 'border-border bg-card text-foreground/70' };
  const primary = p.listings.find((l) => l.listingId === intel?.primaryListingId) ?? p.listings[0];
  const times = listingTimes(primary, t);
  const condition = [f.renovationStatus ? t(`mps_rn_${f.renovationStatus}`) : null, f.buildingStatus ? t(`mps_bs_${f.buildingStatus}`) : null].filter(Boolean).join(' · ');
  const why = upgrade ? upgrade.advantages.slice(0, 2).map((a) => advantageText(a, t)) : p.reasons.filter((r) => r.code !== 'VERIFIED_RECENTLY').slice(0, 2).map((r) => reasonText(r, t));
  return (
    <article data-property-key={p.key} data-match={intel?.strong ? 'STRONG' : p.unverified.length ? 'PARTIAL' : 'ALTERNATIVE'}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-card shadow-[0_1px_2px_rgba(12,17,25,0.04),0_12px_32px_-20px_rgba(12,17,25,0.3)] transition hover:border-[hsl(var(--gold-border))] hover:shadow-[0_1px_2px_rgba(12,17,25,0.06),0_22px_44px_-22px_rgba(12,17,25,0.42)] motion-safe:hover:-translate-y-0.5">
      <PropertyGallery images={p.images} t={t} onOpen={onOpen} overlay={<>
        {sources.slice(0, 2).map((name) => <span key={name} dir="auto" className="rounded-full bg-[#0C1119]/75 px-2.5 py-1 text-2xs font-semibold text-white backdrop-blur-sm">{name}</span>)}
        {sources.length > 2 ? <span className="rounded-full bg-[#0C1119]/75 px-2.5 py-1 text-2xs font-semibold tabular-nums text-white backdrop-blur-sm" dir="ltr">+{sources.length - 2}</span> : null}
        <DuplicateBadge p={p} t={t} onClick={showDuplicates} />
      </>} />
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`mb-2 inline-flex rounded-full border px-2.5 py-1 text-2xs font-semibold ${badge.tone}`} data-match-badge>{t(badge.key)}</span>
            <p className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums" dir="ltr">{usd(f.priceUsd)}</p>
            {f.pricePerSqmUsd ? <p className="mt-1 text-xs text-muted-foreground">{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
          </div>
          <button type="button" onClick={() => void save.toggle(listingSnapshot(p, transaction))} aria-pressed={save.saved} disabled={save.busy}
            aria-label={save.saved ? t('fpi_unsave') : t('fpi_save')} title={save.saved ? t('fpi_unsave') : t('fpi_save')}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] disabled:opacity-60 ${save.saved ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.14)] text-[hsl(var(--gold-ink))]' : 'border-border text-foreground/70 hover:border-[hsl(var(--gold-border))] hover:text-foreground'}`}>
            {save.saved ? <BookmarkCheck className="h-[18px] w-[18px]" aria-hidden="true" /> : <Bookmark className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>
        </div>
        {place ? <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground"><MapPin className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span dir="auto" className="truncate">{place}</span></h3> : null}
        {upgrade && upgrade.overMaxPct !== null ? (
          <p className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{budgetMaxUsd != null && f.priceUsd != null
            ? t('fpw_over_budget', { amount: usd(Math.max(0, f.priceUsd - budgetMaxUsd)), pct: pct(upgrade.overMaxPct) })
            : t('mps_upgrade_over', { pct: pct(upgrade.overMaxPct) })}</p>
        ) : null}
        <ul className="grid grid-cols-3 gap-1.5 text-sm">
          <Fact icon={Ruler} value={f.areaSqm ? t('mps_value_area', { v: num(f.areaSqm) }) : null} missing={t('mps_not_stated')} />
          <Fact icon={DoorOpen} value={f.rooms !== null ? t('mps_rooms_n', { n: f.rooms }) : null} missing={t('mps_not_stated')} />
          <Fact icon={BedDouble} value={f.bedrooms !== null ? t('mps_bedrooms_n', { n: f.bedrooms }) : null} missing={t('mps_not_stated')} />
        </ul>
        <p className="text-xs leading-relaxed text-foreground/75">
          {[f.floor != null ? (f.totalFloors ? t('mps_floor_of', { n: f.floor, total: f.totalFloors }) : `${t('mps_fact_floor')}: ${f.floor}`) : null,
            t(elevator === true ? 'fpa_elevator_yes' : elevator === false ? 'fpa_elevator_no' : 'fpa_elevator_unknown'), condition || null].filter(Boolean).join(' · ')}
        </p>
        {why.length ? (
          <div className="space-y-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t(upgrade ? 'mps_upgrade_why' : 'mps_why_title')}</p>
          <ul className="space-y-1">
            {why.map((w) => <li key={w} className="flex items-start gap-2 text-sm text-foreground/90"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{w}</li>)}
          </ul>
          </div>
        ) : null}
        {p.unverified.length > 0 ? <p className="rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">{t('mps_not_stated')}: {missingRequirements(p.unverified, t)}</p> : null}
        {intel?.warnings.length ? <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(var(--gold-ink))]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`fpr_warning_${intel.warnings[0]}`)}</p> : null}
        {p.seller.classification !== 'UNKNOWN' ? (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            {p.seller.classification === 'LIKELY_OWNER' || p.seller.classification === 'VERIFIED_OWNER' ? <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
            {sellerLabel(p.seller, t)}
          </p>
        ) : null}
        <ContactLine listing={primary} t={t} className="mt-auto" />
        <div data-card-times className="flex items-start gap-1.5 border-t border-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <p className="min-w-0">
            {times.published ? <span className="block">{times.published}</span> : null}
            {times.updated ? <span className="block">{times.updated}</span> : null}
            {times.unknown ? <span className="block">{t('mps_time_unknown')}</span> : null}
            {times.seen ? <span className="block">{times.seen}</span> : null}
          </p>
        </div>
        <p className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-card-source>
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span dir="auto" className="truncate">{t('mps_card_source', { source: sources.join(' · ') })}</span>
        </p>
        {p.priceDiscrepancy?.significant ? <p className="text-xs text-muted-foreground">{t('mps_price_diff_badge')}</p> : null}
        {intel && intel.preferences.unconfirmed.length + intel.preferences.mentioned.length + intel.preferences.contradicted.length > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">{t('fpr_compromise', { n: intel.preferences.unconfirmed.length + intel.preferences.mentioned.length + intel.preferences.contradicted.length })}</p> : null}
        {f.floor != null && f.totalFloors != null && f.floor === f.totalFloors ? <p className="text-xs leading-relaxed text-muted-foreground">{t('fpa_top_floor_note')}</p> : null}
        {dialogOpen ? <DuplicatesDialog p={p} t={t} open={dialogOpen} onOpenChange={setDialogOpen} confirmed={confirmedDuplicate} /> : null}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 pt-1">
          <button type="button" onClick={open}
            className="inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white transition hover:bg-[#1A2331] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
            <span className="truncate">{t('mps_view_property')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button type="button" onClick={onToggleCompare} aria-pressed={compareSelected}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${compareSelected ? 'border-[#0C1119] bg-[#0C1119]/5 text-foreground' : 'border-border text-foreground/80 hover:bg-muted'}`}>
            {compareSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}{t('mps_compare')}
          </button>
        </div>
        {save.failed ? <p role="alert" className="text-xs text-destructive">{t('fpi_save_failed')}</p> : null}
        {original ? <a href={original} target="_blank" rel="noopener noreferrer" onClick={() => noteListingInterest('RESULT_OPENED', p, { searchId, transaction })} className="inline-flex min-h-11 items-center justify-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">{t('mps_open_original')}</a> : null}
      </div>
    </article>
  );
}

function Fact({ icon: Icon, value, missing }: { icon: typeof Ruler; value: string | null; missing: string }) {
  return (
    <li className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg bg-muted/60 px-2.5 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className={`truncate text-[13px] font-semibold ${value ? 'text-foreground' : 'font-normal text-muted-foreground'}`} title={value ?? missing}>{value ?? missing}</span>
    </li>
  );
}
