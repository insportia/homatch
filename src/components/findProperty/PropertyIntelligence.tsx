import { AlertTriangle, ArrowRight, Check, CircleHelp, ExternalLink, FileSearch, FileText, GitCompare, Info, Landmark, LineChart, Mail, MinusCircle, Phone, ShieldCheck, Sparkles, Star, User, Users } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import { investmentHandoff, mortgageHandoff } from '@/research-core/marketplace/handoff';
import type { ResultProperty } from '@/research-core/marketplace/pipeline';
import type { PropertyView } from '@/services/marketplaceSearch';
import { checkedAgo, listingActivity, listingAgeText, listingTimes, num, pct, type T, usd } from './format';
import { advantageText, reasonText, sellerLabel, VERDICT_TONE } from './PropertyCard';
import { fitText, highlightText, missText, summaryText, unknownText } from './advisorText';
import { assessProperty } from '@/research-core/marketplace/advisor';
import type { SearchIntelligenceBrief } from '@/research-core/marketplace/brief';
import { useLanguage } from '@/contexts/LanguageContext';
import { PropertyGallery } from './PropertyGallery';
import { DuplicateBadge, DuplicateListings } from './DuplicateListings';
import { DuplicatesDialog } from './DuplicatesDialog';
import { ContactLine } from './ContactLine';
import { sourceNames } from './PropertyCard';

/** One premium section: navy icon tile with a gold glyph, display title, gold hairline. */
function Section({ icon: Icon, title, id, children, className = '' }: { icon: typeof Check; title: React.ReactNode; id?: string; children: React.ReactNode; className?: string }) {
  return <section aria-labelledby={id} data-premium-section className={`overflow-hidden rounded-2xl border border-foreground/10 bg-card shadow-[0_1px_2px_rgba(12,17,25,0.05),0_14px_32px_-20px_rgba(12,17,25,0.35)] ${className}`}>
    <header className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0C1119] text-[hsl(var(--gold))]"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <h3 id={id} className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
    </header>
    <div className="h-px bg-gradient-to-r from-[hsl(var(--gold)/0.6)] via-[hsl(var(--gold)/0.2)] to-transparent rtl:bg-gradient-to-l" aria-hidden="true" />
    <div className="space-y-3 px-4 py-4 sm:px-5">{children}</div>
  </section>;
}
const Bullet = ({ children }: { children: React.ReactNode }) => <li className="flex items-start gap-2.5 text-[15px] leading-relaxed text-foreground/90">
  <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold)/0.18)]"><Check className="h-3 w-3 text-[hsl(var(--gold-ink))]" aria-hidden="true" /></span><span className="min-w-0">{children}</span>
</li>;
const Chip = ({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'gold' | 'dashed' }) => <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
  tone === 'gold' ? 'bg-[hsl(var(--gold)/0.18)] text-[hsl(var(--gold-ink))]' : tone === 'dashed' ? 'border border-dashed border-foreground/25 text-foreground/75' : 'border border-foreground/10 bg-background text-foreground/80'}`}>{children}</span>;

function IntelligenceFrame({ children, fullPage, open, onOpenChange, isRTL }: { children: React.ReactNode; fullPage: boolean; open: boolean; onOpenChange: (o: boolean) => void; isRTL: boolean }) {
  if (fullPage) return <article data-property-dossier className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-foreground/10 bg-[hsl(var(--background))] shadow-[0_2px_4px_rgba(12,17,25,0.06),0_30px_60px_-30px_rgba(12,17,25,0.45)]">{children}</article>;
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
export function PropertyIntelligence({ t, p, open, onOpenChange, isRTL, propertyType, onCompare, compareSelected, fullPage = false, budgetMaxUsd, brief }: {
  t: T; p: PropertyView | null; open: boolean; onOpenChange: (o: boolean) => void; isRTL: boolean; propertyType: string | null;
  /** The customer's request: the assessment reads the property against it. */
  brief?: SearchIntelligenceBrief | null;
  onCompare: () => void; compareSelected: boolean;
  fullPage?: boolean;
  budgetMaxUsd?: number | null;
}) {
  const navigate = useNavigate();
  const listingsRef = useRef<HTMLDivElement>(null);
  const duplicatesRef = useRef<HTMLDivElement>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  if (!p) return null;
  const f = p.facts;
  const d = p.priceDiscrepancy;
  const place = [f.district, f.city].filter(Boolean).join(', ');
  const mortgage = mortgageHandoff(p);
  return (
    <IntelligenceFrame fullPage={fullPage} open={open} onOpenChange={onOpenChange} isRTL={isRTL}>
        <PropertyGallery images={p.images} t={t} full />
        <div className="space-y-6 p-5 sm:p-6">
          <div className="-mx-5 -mt-5 space-y-3 bg-[#0C1119] px-5 pb-5 pt-5 text-white sm:-mx-6 sm:-mt-6 sm:px-6" data-property-band>
            {fullPage ? <header className="space-y-1 text-start"><h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">{usd(f.priceUsd)}</h1><p dir="auto" className="text-[15px] text-white/75">{place || p.title}</p></header> : <SheetHeader className="space-y-1 text-start"><SheetTitle className="font-display text-3xl font-semibold text-white">{usd(f.priceUsd)}</SheetTitle><SheetDescription dir="auto" className="text-white/75">{place || p.title}</SheetDescription></SheetHeader>}
            <div className="flex flex-wrap items-center gap-2">
              {sourceNames(p).map((name) => <span key={name} dir="auto" className="rounded-full border border-[hsl(var(--gold)/0.6)] px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold))]">{t('mps_card_source', { source: name })}</span>)}
              <DuplicateBadge p={p} t={t} onClick={() => setDialogOpen(true)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {f.pricePerSqmUsd ? <p>{t('mps_per_sqm', { v: usd(f.pricePerSqmUsd) })}</p> : null}
            <p>{t('fpw_listing_count', { n: p.listings.length })} · {t('mps_sources_n', { n: p.sourceCount })}</p>
          </div>
          <ContactLine listing={p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0]} t={t} />
          {(() => {
            const times = listingTimes(p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0], t);
            return <div data-property-times className="space-y-0.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm">
              {times.published ? <p className="font-medium">{times.published}</p> : null}
              {times.updated ? <p className="font-medium">{times.updated}</p> : null}
              {times.unknown ? <p className="text-muted-foreground">{t('mps_time_unknown')}</p> : null}
              {times.seen ? <p className="text-xs text-muted-foreground">{times.seen}</p> : null}
            </div>;
          })()}

          <dl className="grid grid-cols-2 gap-2">
            {FACTS.map(([k, label]) => {
              const v = factValue(k, f[k], t, p);
              return v ? (
                <div key={k} className="rounded-xl border border-foreground/10 border-t-2 border-t-[hsl(var(--gold))] bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(12,17,25,0.05),0_10px_24px_-18px_rgba(12,17,25,0.35)]">
                  <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(label)}</dt>
                  <dd className="mt-0.5 font-display text-lg font-semibold text-foreground">{v}</dd>
                </div>
              ) : null;
            })}
          </dl>
          {p.description ? <OriginalDescription t={t} text={p.description} source={(p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0])?.sourceName ?? null} /> : null}
          {brief ? <Assessment t={t} p={p} brief={brief} /> : null}
          <p className="text-sm text-muted-foreground">{t(f.elevator === true || f.amenities.includes('ELEVATOR') ? 'fpa_elevator_yes' : f.elevator === false || f.amenities.includes('NO_ELEVATOR') ? 'fpa_elevator_no' : 'fpa_elevator_unknown')}</p>
          <div ref={duplicatesRef}><DuplicateListings p={p} t={t} open={duplicatesOpen} onOpenChange={setDuplicatesOpen} /></div>
          {dialogOpen ? <DuplicatesDialog p={p} t={t} open={dialogOpen} onOpenChange={setDialogOpen} confirmed={p.identity?.status === 'CONFIRMED_DUPLICATE' && p.listings.length > 1} /> : null}

          {p.intelligence ? <Section icon={FileSearch} title={t('fpr_evidence_title')} id="mps-evidence">
            <p className="text-sm leading-relaxed text-foreground/80">{t(p.seller.reasonCodes.some((c) => c.startsWith('DECLARED_')) ? 'fpr_seller_source' : p.seller.reasonCodes.includes('CONTACT_ON_MANY_PROPERTIES') ? 'fpr_seller_contact' : p.seller.classification === 'LIKELY_OWNER' ? 'fpr_seller_owner' : 'fpr_seller_unclear')}</p>
            {p.intelligence.warnings.length ? <ul className="space-y-1.5">{p.intelligence.warnings.map((code) => <li key={code} className="flex items-start gap-2 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] px-3 py-2 text-sm text-foreground/85"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t(`fpr_warning_${code}`)}</li>)}</ul> : null}
            {p.intelligence.signals.map((signal) => <div key={signal.code} className="rounded-xl border border-foreground/10 border-s-2 border-s-[hsl(var(--gold))] bg-background p-3"><p className="text-sm font-medium">{t(signal.polarity === 'NEGATED' ? 'fpr_description_negates' : 'fpr_description_mentions', { feature: t(`fpr_signal_${signal.code}`) })}</p><q dir="auto" className="mt-1 block break-words text-sm italic text-muted-foreground">{signal.evidence}</q></div>)}
            <p className="text-xs text-muted-foreground">{t('fpr_text_evidence_note')}</p>
          </Section> : null}

          {p.reasons.length || p.upgrade ? (
            <Section icon={Sparkles} title={p.upgrade ? t('mps_upgrade_value') : t('mps_why_title')} id="mps-why">
              <ul className="space-y-2">
                {(p.upgrade ? p.upgrade.advantages.map((a) => advantageText(a, t)) : p.reasons.map((r) => reasonText(r, t))).map((line) => (
                  <Bullet key={line}>{line}</Bullet>
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
                <p className="rounded-xl bg-[#0C1119] px-3.5 py-2.5 text-sm font-medium text-white"><LineChart className="me-2 inline h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t(p.vsComparable < 0 ? 'mps_vs_similar_below' : 'mps_vs_similar_above', { pct: pct(Math.abs(p.vsComparable)) })}</p>
              ) : null}
            </Section>
          ) : null}

          <Section icon={Users} title={t('mps_seller_title')} id="mps-seller">
            <p className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.08)] px-3 py-1.5 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{sellerLabel(p.seller, t)}
            </p>
            {p.seller.reasonCodes.length ? <ul className="space-y-2">
              {p.seller.reasonCodes.slice(0, 3).map((c) => <Bullet key={c}>{t(`mps_seller_reason_${c}`)}</Bullet>)}
            </ul> : null}
          </Section>

          {d?.significant ? (
            <section className="space-y-3 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] p-4" aria-labelledby="mps-price-diff">
              <h3 id="mps-price-diff" className="flex items-center gap-2 font-display text-lg font-semibold">
                <AlertTriangle className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mps_price_diff_title')}
              </h3>
              <p className="text-sm text-foreground/85">{t('mps_price_diff_body')}</p>
              <dl className="grid gap-2 text-center sm:grid-cols-3">
                <div className="rounded-xl border border-foreground/10 bg-card p-3 shadow-sm"><dt className="text-xs text-muted-foreground">{t('mps_price_lowest')}</dt><dd className="font-display text-lg font-semibold">{usd(d.lowestUsd)}</dd></div>
                <div className="rounded-xl border border-foreground/10 bg-card p-3 shadow-sm"><dt className="text-xs text-muted-foreground">{t('mps_price_highest')}</dt><dd className="font-display text-lg font-semibold">{usd(d.highestUsd)}</dd></div>
                <div className="rounded-xl bg-[#0C1119] p-3 text-white shadow-sm"><dt className="text-xs text-white/70">{t('mps_price_difference')}</dt><dd className="font-display text-lg font-semibold text-[hsl(var(--gold))]">{usd(d.differenceUsd)} · {pct(d.differencePct)}</dd></div>
              </dl>
              <p className="text-sm text-muted-foreground">{t('mps_price_verify')}</p>
              <button type="button" onClick={() => listingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
                <GitCompare className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t('mps_compare_sources')}
              </button>
            </section>
          ) : null}

          <div ref={listingsRef}><Section icon={ExternalLink} title={t('mps_listings_title', { n: p.listings.length })} id="mps-listings">
            <ul className="space-y-3">
              {p.listings.map((l) => {
                const url = safeExternalUrl(l.exactUrl);
                const profile = safeExternalUrl(l.seller.publicProfile ?? l.authorUrl);
                const checked = checkedAgo(l.lastVerifiedAt, t);
                return (
                  <li key={l.listingId} className={`space-y-3 rounded-2xl border bg-background p-4 ${l.isLowest && d?.significant ? 'border-[hsl(var(--gold))] shadow-[0_0_0_3px_hsl(var(--gold)/0.12)]' : 'border-foreground/10'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span dir="auto" className="rounded-full bg-[#0C1119] px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-white">{l.sourceName ?? l.source}</span>
                      <p className="font-display text-2xl font-semibold tracking-[-0.02em]">{usd(l.priceUsd)}</p>
                    </div>
                    {l.social ? <p className="rounded-xl border border-dashed border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] p-3 text-sm leading-relaxed text-foreground/85" data-social-note>
                      <span className="me-1 font-semibold">{t('fps_social_badge')}.</span>{t('fps_social_note')}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {l.seller.classification !== 'UNKNOWN' ? <Chip>{sellerLabel(l.seller, t)}</Chip> : null}
                      <Chip>{listingAgeText(listingActivity(l.publishedAt, l.updatedAt), t)}</Chip>
                      {checked ? <Chip>{checked}</Chip> : null}
                      {l.isLowest && d?.significant ? <Chip tone="gold">{t('mps_price_lowest')}</Chip> : null}
                      {l.isHighest && d?.significant ? <Chip tone="dashed">{t('mps_price_higher')}</Chip> : null}
                      {l.priceOriginal && l.priceOriginal.currency !== 'USD' ? <Chip>{t('mps_converted_from', { v: `${num(l.priceOriginal.amount)} ${l.priceOriginal.currency}` })}</Chip> : null}
                    </div>
                    {(l.seller.name || l.seller.publicPhone || l.seller.publicEmail || profile) ? (
                      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground/85">
                        {l.seller.name ? <li className="inline-flex items-center gap-1.5"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span dir="auto">{l.seller.name}</span></li> : null}
                        {l.seller.publicPhone ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`tel:${l.seller.publicPhone.replace(/[^\d+]/g, '')}`}><Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span dir="ltr">{l.seller.publicPhone}</span></a>{l.seller.phoneFromDescription ? <span className="ms-1.5 text-xs text-muted-foreground">({t('mps_contact_from_description_short')})</span> : null}</li> : null}
                        {l.seller.publicEmail ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={`mailto:${l.seller.publicEmail}`}><Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{l.seller.publicEmail}</a></li> : null}
                        {profile ? <li><a className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline" href={profile} target="_blank" rel="noopener noreferrer"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('mps_author_profile')}</a></li> : null}
                      </ul>
                    ) : null}
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2">
                        {t('mps_open_original')}<ExternalLink className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section></div>

          <section data-property-actions className="grid gap-2.5 rounded-2xl bg-[#0C1119] p-3 shadow-[0_20px_40px_-24px_rgba(12,17,25,0.6)] sm:grid-cols-3">
            <button type="button" onClick={() => navigate('/investment', { state: { findProperty: investmentHandoff(p as ResultProperty, propertyType) } })}
              className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[hsl(var(--gold))] px-4 text-sm font-semibold text-[#0C1119] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C1119]">
              <LineChart className="h-4 w-4" aria-hidden="true" />{t('mps_investment_cta')}<ArrowRight className="h-4 w-4 transition motion-safe:group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
            </button>
            {mortgage ? (
              <button type="button" onClick={() => navigate('/mortgage', { state: { context: mortgage } })}
                className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[hsl(var(--gold)/0.7)] bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
                <Landmark className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />{t('mps_mortgage_cta')}
              </button>
            ) : null}
            <button type="button" onClick={onCompare} aria-pressed={compareSelected}
              className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] ${compareSelected ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.15)] text-[hsl(var(--gold))]' : 'border-white/20 bg-white/[0.04] text-white hover:bg-white/10'}`}>
              {compareSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : <GitCompare className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden="true" />}{t('mps_compare')}
            </button>
          </section>
        </div>
    </IntelligenceFrame>
  );
}

/** The listing's own words, in their own language, first; long text folds after a few lines. */
function OriginalDescription({ t, text, source }: { t: T; text: string; source: string | null }) {
  const [more, setMore] = useState(false);
  const long = text.length > 420;
  return (
    <section aria-labelledby="fpv-desc" data-original-description className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 id="fpv-desc" className="flex items-center gap-2 font-display text-lg font-semibold"><FileText className="h-[18px] w-[18px] text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('fpv_desc_title')}</h3>
      {source ? <p className="mt-0.5 text-xs text-muted-foreground">{t('fpv_desc_note', { source })}</p> : null}
      <p dir="auto" className={`mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90 ${long && !more ? 'line-clamp-6' : ''}`}>{text}</p>
      {long ? <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="mt-2 min-h-[44px] text-sm font-semibold text-[hsl(var(--gold-ink))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{t(more ? 'fpv_desc_less' : 'fpv_desc_more')}</button> : null}
    </section>
  );
}

/** The advisor's reading: what fits, what differs, what the listing does not say, and the short verdict. */
function Assessment({ t, p, brief }: { t: T; p: PropertyView; brief: SearchIntelligenceBrief }) {
  const { lang } = useLanguage();
  const a = assessProperty(p, brief);
  const unknown = unknownText(a, t, lang);
  const group = (title: string, icon: typeof Check, tone: string, lines: string[], key: string) => lines.length ? (
    <div data-assessment-group={key}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {lines.map((line) => { const Icon = icon; return <li key={line} className="flex items-start gap-2 text-[15px] leading-relaxed text-foreground/90"><Icon className={`mt-1 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" /><span dir="auto">{line}</span></li>; })}
      </ul>
    </div>
  ) : null;
  return (
    <section aria-labelledby="fpv-assess" data-assessment className="space-y-4 rounded-2xl border border-[hsl(var(--gold-border)/0.7)] bg-[hsl(var(--gold)/0.04)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fpv-assess" className="flex items-center gap-2 font-display text-lg font-semibold"><Sparkles className="h-[18px] w-[18px] text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('fpv_assess_title')}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${VERDICT_TONE[a.verdict]}`}>{t(`fpv_verdict_${a.verdict}`)}</span>
      </div>
      {group(t('fpv_g_fits'), Check, 'text-[hsl(var(--success))]', a.fits.map((x) => fitText(x, t)), 'fits')}
      {group(t('fpv_g_misses'), MinusCircle, 'text-[hsl(var(--gold-ink))]', a.misses.map((x) => missText(x, t)), 'misses')}
      {unknown ? group(t('fpv_g_unknown'), CircleHelp, 'text-muted-foreground', [unknown], 'unknown') : null}
      {group(t('fpv_g_highlights'), Star, 'text-[hsl(var(--gold-ink))]', a.highlights.map((x) => highlightText(x, t)), 'highlights')}
      <div className="rounded-xl bg-card px-3.5 py-3 shadow-sm" data-assessment-group="summary">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('fpv_g_summary')}</p>
        <p dir="auto" className="mt-1 text-[15px] font-medium leading-relaxed text-foreground">{summaryText(a, t, lang)}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('fpv_assess_note')}</p>
    </section>
  );
}
