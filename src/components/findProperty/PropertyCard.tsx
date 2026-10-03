import { AlertTriangle, ArrowRight, BedDouble, Building, Check, DoorOpen, Layers, MapPin, Ruler, ShieldCheck } from 'lucide-react';
import React from 'react';
import type { PropertyView } from '@/services/marketplaceSearch';
import { type T, checkedAgo, num, pct, usd } from './format';

export const SELLER_KEY: Record<string, string> = {
  VERIFIED_OWNER: 'mps_seller_verified_owner', LIKELY_OWNER: 'mps_seller_likely_owner', AGENCY: 'mps_seller_agency',
  BROKER: 'mps_seller_broker', DEVELOPER: 'mps_seller_developer', UNKNOWN: 'mps_seller_unknown',
};

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
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#0C1119]">
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
  const checked = checkedAgo(p.freshness.lastVerifiedAt, t);
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const upgrade = p.group === 'UPGRADE' ? p.upgrade : null;
  return (
    <article className="hm-discovery-panel group flex min-w-0 flex-col overflow-hidden">
      <Hero p={p} t={t} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground">{usd(f.priceUsd)}</p>
          {f.pricePerSqmUsd ? <p className="text-sm text-muted-foreground">{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
        </div>
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
          {p.seller.classification !== 'UNKNOWN' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground/85">
              {p.seller.classification === 'LIKELY_OWNER' || p.seller.classification === 'VERIFIED_OWNER' ? <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
              {t(SELLER_KEY[p.seller.classification])}
            </span>
          ) : null}
          {checked ? <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-muted-foreground">{checked}</span> : null}
        </div>

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
              {p.reasons.slice(0, 3).map((r) => (
                <li key={r.code} className="flex items-start gap-2 text-sm text-foreground/90"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{reasonText(r, t)}</li>
              ))}
            </ul>
          </div>
        ) : null}

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
