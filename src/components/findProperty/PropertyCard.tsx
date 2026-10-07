import { AlertTriangle, ArrowRight, BedDouble, Building, Check, DoorOpen, Layers, MapPin, Ruler, ShieldCheck } from 'lucide-react';
import React from 'react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { type T, currentActivity, listingAgeText, num, pct, usd } from './format';

export const SELLER_KEY: Record<string, string> = {
  VERIFIED_OWNER: 'mps_seller_verified_owner', LIKELY_OWNER: 'mps_seller_likely_owner', AGENCY: 'mps_seller_agency',
  BROKER: 'mps_seller_broker', DEVELOPER: 'mps_seller_developer', UNKNOWN: 'mps_seller_unknown',
};
export function sellerLabel(seller: { classification: string; reasonCodes?: string[] }, t: T) {
  const inferred = !seller.reasonCodes?.some((code) => code.startsWith('DECLARED_'));
  if (inferred && seller.classification === 'BROKER') return t('fpr_seller_likely_broker');
  if (inferred && seller.classification === 'AGENCY') return t('fpr_seller_likely_agency');
  return t(SELLER_KEY[seller.classification]);
}

export function reasonText(r: { code: string; count?: number }, t: T) {
  return t(`mps_reason_${r.code}`, { n: r.count ?? 0 });
}

export function advantageText(a: { code: string; delta: number | null }, t: T) {
  return t(`mps_adv_${a.code}`, { n: a.delta !== null ? Math.abs(a.delta) : 0 });
}

function Hero({ p, t }: { p: PropertyView; t: T }) {
  const [failed, setFailed] = React.useState(false);
  const img = failed ? null : p.images[0];
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#0C1119]">
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,hsl(38_92%_56%/0.18),transparent_65%)]">
          <Building className="h-10 w-10 text-white/25" aria-hidden="true" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent" aria-hidden="true" />
      {p.sourceCount > 1 || p.priceDiscrepancy?.significant ? (
        <div className="absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          {p.sourceCount > 1 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-[#0C1119]">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />{t('mps_sources_n', { n: p.sourceCount })}
            </span>
          ) : null}
          {p.priceDiscrepancy?.significant ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(38_92%_56%)] px-2.5 py-1 text-xs font-semibold text-[#0C1119]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('mps_price_diff_badge')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PropertyCard({ p, t, onOpen, compareSelected, onToggleCompare }: {
  p: PropertyView; t: T; onOpen: () => void; compareSelected: boolean; onToggleCompare: () => void;
}) {
  const f = p.facts;
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const upgrade = p.group === 'UPGRADE' ? p.upgrade : null;
  const intel = p.intelligence;
  return (
    <article data-property-key={p.key} className="hm-discovery-panel group flex min-w-0 flex-col overflow-hidden">
      <Hero p={p} t={t} />
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-display text-[24px] font-semibold leading-none tracking-[-0.02em] text-foreground">{usd(f.priceUsd)}</p>
          {f.pricePerSqmUsd ? <p className="text-sm text-muted-foreground">{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
        </div>
        {p.title ? <h3 dir="auto" className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</h3> : null}
        {upgrade && upgrade.overMaxPct !== null ? (
          <p className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{t('mps_upgrade_over', { pct: pct(upgrade.overMaxPct) })}</p>
        ) : null}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-foreground/85">
          {f.areaSqm ? <li className="inline-flex items-center gap-1.5"><Ruler className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_value_area', { v: num(f.areaSqm) })}</li> : null}
          {f.rooms !== null ? <li className="inline-flex items-center gap-1.5"><DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_rooms_n', { n: f.rooms })}</li> : null}
          {f.bedrooms !== null ? <li className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_bedrooms_n', { n: f.bedrooms })}</li> : null}
        </ul>
        {place ? <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" /><span dir="auto">{place}</span></p> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {p.seller.classification ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground/85">
              {p.seller.classification === 'LIKELY_OWNER' || p.seller.classification === 'VERIFIED_OWNER' ? <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
              {sellerLabel(p.seller, t)}
            </span>
          ) : null}
          <span className="text-muted-foreground">{listingAgeText(currentActivity(p), t)}</span>
        </div>
        {intel?.otherListingCount ? <p className="text-xs text-muted-foreground">{t('fpr_other_listings', { n: intel.otherListingCount })}</p> : null}

        {upgrade ? (
          <div className="space-y-2 rounded-xl bg-[hsl(var(--gold)/0.06)] p-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[hsl(var(--gold-ink))]">{t('mps_upgrade_why')}</p>
            <ul className="space-y-1">
              {upgrade.advantages.slice(0, 4).map((a) => (
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
        {p.description || intel?.signals.length ? <details className="text-xs text-muted-foreground"><summary className="min-h-[44px] cursor-pointer py-3 font-medium">{t('fpr_description_evidence')}</summary>
          {intel?.signals.length ? <ul className="space-y-2">{intel.signals.map((s) => <li key={s.code}><span className="font-medium">{t(s.polarity === 'NEGATED' ? 'fpr_description_negates' : 'fpr_description_mentions', { feature: t(`fpr_signal_${s.code}`) })}</span><q className="mt-1 block break-words leading-relaxed" dir="auto">{s.evidence}</q></li>)}</ul> : null}
          {p.description ? <p dir="auto" className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{p.description}</p> : null}
          <p className="mt-2 leading-relaxed">{t('fpr_text_evidence_note')}</p>
        </details> : null}

        {p.unverified.length > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">{t('fpr_required_unknown', { n: p.unverified.length })}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <button type="button" onClick={onOpen}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-5 text-sm font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
            {t('mps_view_property')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button type="button" onClick={onToggleCompare} aria-pressed={compareSelected}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${compareSelected ? 'border-[#0C1119] bg-[#0C1119]/5 text-foreground' : 'border-border text-foreground/80 hover:bg-muted'}`}>
            {compareSelected ? <Check className="me-1 h-4 w-4" aria-hidden="true" /> : null}{t('mps_compare')}
          </button>
        </div>
      </div>
    </article>
  );
}
