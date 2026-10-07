import { AlertTriangle, ExternalLink, Info, Landmark, LineChart, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { investmentHandoff, mortgageHandoff } from '@/research-core/marketplace/handoff';
import type { ResultProperty } from '@/research-core/marketplace/pipeline';
import type { PropertyView } from '@/services/marketplaceSearch';
import { checkedAgo, currentActivity, listingActivity, listingAgeText, num, pct, type T, usd } from './format';
import { advantageText, reasonText, SELLER_KEY, sellerLabel } from './PropertyCard';
import { PropertyGallery } from './PropertyGallery';

function IntelligenceFrame({ children, fullPage, open, onOpenChange, isRTL }: { children: React.ReactNode; fullPage: boolean; open: boolean; onOpenChange: (o: boolean) => void; isRTL: boolean }) {
  if (fullPage) return <article data-property-dossier className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card">{children}</article>;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side={isRTL ? 'left' : 'right'} className="hm-discovery w-full overflow-y-auto bg-background p-0 sm:max-w-xl">{children}</SheetContent></Sheet>;
}

const FACTS: Array<[keyof PropertyView['facts'], string]> = [
  ['areaSqm', 'mps_fact_area'], ['rooms', 'mps_fact_rooms'], ['bedrooms', 'mps_fact_bedrooms'], ['bathrooms', 'mps_fact_bathrooms'],
  ['floor', 'mps_fact_floor'], ['buildingStatus', 'mps_fact_building'], ['renovationStatus', 'mps_fact_renovation'], ['parking', 'mps_fact_parking'],
];

function factValue(k: keyof PropertyView['facts'], v: unknown, t: T, p: PropertyView): string | null {
  if (v === null || v === undefined) return null;
  if (k === 'areaSqm') return t('mps_value_area', { v: num(v as number) });
  if (k === 'floor') return p.facts.totalFloors ? t('mps_floor_of', { n: v as number, total: p.facts.totalFloors }) : String(v);
  if (k === 'buildingStatus') return t(`mps_bs_${v}`);
  if (k === 'renovationStatus') return t(`mps_rn_${v}`);
  if (k === 'parking') return v ? t('mps_yes') : t('mps_no');
  return String(v);
}

/**
 * The canonical property, not one random listing: overview first, then the
 * evidence in progressive layers. Every listing keeps its exact, clickable
 * source link; public contacts are shown as published.
 */
export function PropertyIntelligence({ t, p, open, onOpenChange, isRTL, propertyType, onCompare, compareSelected, fullPage = false, budgetMaxUsd }: {
  t: T; p: PropertyView | null; open: boolean; onOpenChange: (o: boolean) => void; isRTL: boolean; propertyType: string | null;
  onCompare: () => void; compareSelected: boolean;
  fullPage?: boolean;
  budgetMaxUsd?: number | null;
}) {
  const navigate = useNavigate();
  const listingsRef = useRef<HTMLDivElement>(null);
  if (!p) return null;
  const f = p.facts;
  const d = p.priceDiscrepancy;
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const mortgage = mortgageHandoff(p);
  return (
    <IntelligenceFrame fullPage={fullPage} open={open} onOpenChange={onOpenChange} isRTL={isRTL}>
        <PropertyGallery images={p.images} t={t} full />
        <div className="space-y-6 p-5 sm:p-6">
          {fullPage ? <header className="space-y-1 text-start"><h1 className="font-display text-3xl font-semibold tracking-[-0.02em]">{usd(f.priceUsd)}</h1><p dir="auto" className="text-[15px] text-muted-foreground">{place || p.title}</p></header> : <SheetHeader className="space-y-1 text-start"><SheetTitle className="font-display text-3xl font-semibold">{usd(f.priceUsd)}</SheetTitle><SheetDescription dir="auto">{place || p.title}</SheetDescription></SheetHeader>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {f.pricePerSqmUsd ? <p>{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
            <p>{t('fpw_listing_count', { n: p.listings.length })} · {t('mps_sources_n', { n: p.sourceCount })}</p>
            <p>{listingAgeText(currentActivity(p), t)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-2">
            {FACTS.map(([k, label]) => {
              const v = factValue(k, f[k], t, p);
              return v ? (
                <div key={k} className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <dt className="text-xs text-muted-foreground">{t(label)}</dt>
                  <dd className="text-[15px] font-medium text-foreground">{v}</dd>
                </div>
              ) : null;
            })}
          </dl>

          {p.intelligence ? <section className="space-y-2">
            <h3 className="font-display text-lg font-semibold">{t('fpr_evidence_title')}</h3>
            {p.unverified.length > 0 ? <p className="text-sm text-muted-foreground">{t('fpr_required_unknown', { n: p.unverified.length })}</p> : null}
            <p className="text-sm text-muted-foreground">{t(p.seller.reasonCodes.some((c) => c.startsWith('DECLARED_')) ? 'fpr_seller_source' : p.seller.reasonCodes.includes('CONTACT_ON_MANY_PROPERTIES') ? 'fpr_seller_contact' : p.seller.classification === 'LIKELY_OWNER' ? 'fpr_seller_owner' : 'fpr_seller_unclear')}</p>
            {p.intelligence.warnings.map((code) => <p key={code} className="text-sm text-muted-foreground">{t(`fpr_warning_${code}`)}</p>)}
            {p.intelligence.signals.map((signal) => <div key={signal.code} className="rounded-xl border border-border p-3"><p className="text-sm font-medium">{t(signal.polarity === 'NEGATED' ? 'fpr_description_negates' : 'fpr_description_mentions', { feature: t(`fpr_signal_${signal.code}`) })}</p><q dir="auto" className="mt-1 block break-words text-sm text-muted-foreground">{signal.evidence}</q></div>)}
            <p className="text-xs text-muted-foreground">{t('fpr_text_evidence_note')}</p>
            {p.description ? <details><summary className="min-h-[44px] cursor-pointer py-3 text-sm">{t('fpr_description_evidence')}</summary><p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{p.description}</p></details> : null}
          </section> : null}

          {p.reasons.length || p.upgrade ? (
            <section className="space-y-2">
              <h3 className="font-display text-lg font-semibold">{p.upgrade ? t('mps_upgrade_value') : t('mps_why_title')}</h3>
              <ul className="space-y-1.5">
                {(p.upgrade ? p.upgrade.advantages.map((a) => advantageText(a, t)) : p.reasons.map((r) => reasonText(r, t))).map((line) => (
                  <li key={line} className="text-[15px] text-foreground/90">· {line}</li>
                ))}
              </ul>
              {p.upgrade && budgetMaxUsd != null && f.priceUsd != null && p.upgrade.overMaxPct !== null ? (
                <p className="text-sm text-muted-foreground">{t('fpw_over_budget', { amount: usd(Math.max(0, f.priceUsd - budgetMaxUsd)), pct: pct(p.upgrade.overMaxPct) })}</p>
              ) : null}
              {(p.tradeoffs ?? []).length ? (
                <ul className="space-y-1">
                  {(p.tradeoffs ?? []).map((c) => <li key={c} className="flex items-start gap-2 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(`mps_tradeoff_${c}`)}</li>)}
                </ul>
              ) : null}
              {p.vsComparable !== null ? (
                <p className="text-sm text-muted-foreground">{t(p.vsComparable < 0 ? 'mps_vs_similar_below' : 'mps_vs_similar_above', { pct: pct(Math.abs(p.vsComparable)) })}</p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="font-display text-lg font-semibold">{t('mps_seller_title')}</h3>
            <p className="inline-flex items-center gap-2 text-[15px]">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{sellerLabel(p.seller, t)}
            </p>
            <ul className="space-y-1">
              {p.seller.reasonCodes.slice(0, 3).map((c) => <li key={c} className="text-sm text-muted-foreground">· {t(`mps_seller_reason_${c}`)}</li>)}
            </ul>
          </section>

          {d?.significant ? (
            <section className="space-y-3 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] p-4" aria-labelledby="mps-price-diff">
              <h3 id="mps-price-diff" className="flex items-center gap-2 font-display text-lg font-semibold">
                <AlertTriangle className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mps_price_diff_title')}
              </h3>
              <p className="text-sm text-foreground/85">{t('mps_price_diff_body')}</p>
              <dl className="grid gap-2 text-center sm:grid-cols-3">
                <div className="rounded-xl bg-card p-2.5"><dt className="text-xs text-muted-foreground">{t('mps_price_lowest')}</dt><dd className="font-semibold">{usd(d.lowestUsd)}</dd></div>
                <div className="rounded-xl bg-card p-2.5"><dt className="text-xs text-muted-foreground">{t('mps_price_highest')}</dt><dd className="font-semibold">{usd(d.highestUsd)}</dd></div>
                <div className="rounded-xl bg-card p-2.5"><dt className="text-xs text-muted-foreground">{t('mps_price_difference')}</dt><dd className="font-semibold">{usd(d.differenceUsd)} · {pct(d.differencePct)}</dd></div>
              </dl>
              <p className="text-sm text-muted-foreground">{t('mps_price_verify')}</p>
              <button type="button" onClick={() => listingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
                {t('mps_compare_sources')}
              </button>
            </section>
          ) : null}

          <section ref={listingsRef} className="space-y-3" aria-labelledby="mps-listings">
            <h3 id="mps-listings" className="font-display text-lg font-semibold">{t('mps_listings_title', { n: p.listings.length })}</h3>
            <ul className="space-y-3">
              {p.listings.map((l) => {
                const url = safeExternalUrl(l.exactUrl);
                const profile = safeExternalUrl(l.seller.publicProfile ?? l.authorUrl);
                const checked = checkedAgo(l.lastVerifiedAt, t);
                return (
                  <li key={l.listingId} className="space-y-2 rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-foreground" dir="auto">{l.sourceName ?? l.source}</p>
                      <p className="font-display text-lg font-semibold">{usd(l.priceUsd)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {l.seller.classification !== 'UNKNOWN' ? <span className="rounded-full border border-border px-2.5 py-1">{sellerLabel(l.seller, t)}</span> : null}
                      <span className="text-muted-foreground">{listingAgeText(listingActivity(l.publishedAt, l.updatedAt), t)}</span>
                      {checked ? <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">{checked}</span> : null}
                      {l.isLowest && d?.significant ? <span className="rounded-full bg-[hsl(var(--gold)/0.15)] px-2.5 py-1 font-medium">{t('mps_price_lowest')}</span> : null}
                      {l.isHighest && d?.significant ? <span className="rounded-full border border-dashed border-border px-2.5 py-1">{t('mps_price_higher')}</span> : null}
                      {l.priceOriginal && l.priceOriginal.currency !== 'USD' ? <span className="text-muted-foreground">{t('mps_converted_from', { v: `${num(l.priceOriginal.amount)} ${l.priceOriginal.currency}` })}</span> : null}
                    </div>
                    {(l.seller.name || l.seller.publicPhone || l.seller.publicEmail || profile) ? (
                      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground/85">
                        {l.seller.name ? <li className="inline-flex items-center gap-1.5"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span dir="auto">{l.seller.name}</span></li> : null}
                        {l.seller.publicPhone ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`tel:${l.seller.publicPhone.replace(/[^\d+]/g, '')}`}><Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span dir="ltr">{l.seller.publicPhone}</span></a></li> : null}
                        {l.seller.publicEmail ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`mailto:${l.seller.publicEmail}`}><Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{l.seller.publicEmail}</a></li> : null}
                        {profile ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={profile} target="_blank" rel="noopener noreferrer"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_author_profile')}</a></li> : null}
                      </ul>
                    ) : null}
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
                        {t('mps_open_original')}<ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => navigate('/investment', { state: { findProperty: investmentHandoff(p as ResultProperty, propertyType) } })}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
              <LineChart className="h-4 w-4" aria-hidden="true" />{t('mps_investment_cta')}
            </button>
            {mortgage ? (
              <button type="button" onClick={() => navigate('/mortgage', { state: { context: mortgage } })}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
                <Landmark className="h-4 w-4" aria-hidden="true" />{t('mps_mortgage_cta')}
              </button>
            ) : null}
            <button type="button" onClick={onCompare} aria-pressed={compareSelected}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
              {t('mps_compare')}
            </button>
          </section>
        </div>
    </IntelligenceFrame>
  );
}
