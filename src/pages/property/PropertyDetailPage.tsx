import {
  AlertCircle, ArrowLeft, Bath, BedDouble, Bot, Building2, Calculator, Camera, CheckCircle2,
  ExternalLink, Landmark, Layers, Lock, MapPin, Megaphone, Pencil, Phone,
  Shield, Trash2, TrendingDown,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { returnState } from '@/lib/backNavigation';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { MatchingEntryCard } from '@/components/matching/workspace/MatchingEntryCard';
import { OWNER_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NavGlyphIcon } from '@/components/layouts/NavGlyph';
import { SearchDna } from '@/components/findBuyers/SearchDna';
import { PropertyReference } from '@/components/owner/ContactPhoneField';
import { FactLine, OWNER_ICON, OWNER_SECONDARY } from '@/components/owner/portfolio';
import { CanonicalGroupBanner } from '@/components/property/CanonicalGroupBanner';
import {
  FreshnessChip, ManageInHomatch, MediaUnavailable, PropertyStatusPanel, SourceChip,
} from '@/components/property/OwnerLifecycle';
import { PropertyGallery } from '@/components/property/PropertyGallery';
import { galleryImages } from '@/property/gallery';
import { MediaRefresh } from '@/components/property/MediaRefresh';
import { PropertyTrustBadge } from '@/components/property/PropertyTrustBadge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { designStudioEnabled } from '@/lib/designStudio/access';
import { placeName } from '@/lib/placeNames';
import { hasContactReadiness } from '@/lib/propertyContact';
import { cn } from '@/lib/utils';
import { type PropertyLifecycle, safeExternalUrl } from '@/property/lifecycle';
import { intelligenceActionFor, isImported } from '@/property/rules';
import { calculateMatchability, getMatchCounts, getProperty, softDeleteProperty } from '@/services/api';
import { fetchLifecycle } from '@/services/propertyLifecycle';
import type { Property } from '@/types/types';
import { useServiceControls } from '@/lib/serviceControls';

// ── THE OWNER'S PROPERTY WORKSPACE ─────────────────────────────────────────────
//
// WHAT THIS REPLACED. A 72rem page whose first row put the gallery beside the
// identity with `items-start`, so a short 16:7 photograph left a block of nothing
// under it, and whose second row gave two thirds of the width to a facts card that
// was often a bare heading (every FactRow returns null without data) while the
// actually useful product — AI, Verify, mortgage, Design Studio, matches and
// buyer/tenant discovery — was stacked into a 1/3 sidebar. At 1440px most of the
// screen was dead white space and everything that mattered was in a narrow column.
//
// THE COMPOSITION NOW, BY INFORMATION HIERARCHY
//
//   1. The property      photograph (hero ratio) beside identity, price, facts,
//                        freshness/source status and the one primary action.
//   2. Quick actions     one responsive grid of tiles — never a permanent sidebar.
//   3. Matching          one entry card into the matching workspace
//                        (/property/:id/matches): HOMATCH Internal and the External
//                        Leads Database. The paid external search launch (budget
//                        dialog, CampaignLaunchPanel, start / pause) was removed
//                        here on the owner's instruction (2026-10-24).
//   4. The information   facts, amenities, description, source — in columns that
//                        collapse when one side has nothing, so nothing is padded
//                        out and nothing leaves a hole.
//
// Everything else is unchanged: trust badge, matchability, canonical banner, delete.
// No pricing or unlock behaviour lives on this page.

function MatchabilityPanel({ score, improvements }: { score: number; improvements: string[] }) {
  /* How searchable this listing is (completeness of the facts a search uses) —
     a number, a word and a slim gold bar, in the page's own language; no donut.
     The hints arrive as i18n keys. */
  const { t } = useLanguage();
  const word = score >= 70 ? t('prop_matchability_excellent') : score >= 40 ? t('prop_matchability_good') : t('prop_matchability_improve');
  return (
    <div className="hm-owner-panel space-y-3 p-5">
      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-[hsl(34_90%_34%)]">{t('match_score_label')}</p>
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-3xl font-bold leading-none tabular-nums text-foreground" dir="ltr">{score}%</span>
        <span className="min-w-0 text-sm font-semibold text-foreground break-words">{word}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(40_60%_88%)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label={t('match_score_label')}>
        <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(42_96%_62%),hsl(34_90%_50%))]" style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      {improvements.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {improvements.slice(0, 3).map((hint) => (
            <li key={hint} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(34_90%_40%)]" aria-hidden="true" />
              {/* An i18n KEY, not a sentence. */}
              <span className="min-w-0 break-words">{t(hint as never)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A fact as label + value in a grid cell. Absent values are not rendered at all. */
function Fact({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-lg bg-secondary/40 px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-2xs text-muted-foreground break-words">{label}</p>
        <p className="text-sm font-medium text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

function AmenityChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs text-foreground">
      <CheckCircle2 className="h-3 w-3 text-primary" />
      {label}
    </div>
  );
}

function SectionTitle({ id, children, action }: { id?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 id={id} className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground break-words">{children}</h2>
      {action}
    </div>
  );
}

// ── QUICK ACTIONS ──────────────────────────────────────────────────────────────

interface QuickAction { key: string; icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }

function QuickActions({ actions }: { actions: QuickAction[] }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="pow-quick-title" className="space-y-3">
      <SectionTitle id="pow-quick-title">{t('pow_quick_actions')}</SectionTitle>
      <div data-testid="pow-quick-actions" className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            /* One premium card style for every action (owner, 2026-10-12: dark navy only
               in small amounts). The primary action is marked by a gold ring and a gold
               icon tile, not by a dark fill. */
            className={cn(
              'group flex min-h-[4.75rem] min-w-0 flex-col items-start justify-between gap-2 rounded-2xl bg-white p-3.5 text-start text-[hsl(218_45%_14%)]',
              'shadow-[0_8px_22px_-16px_hsl(218_60%_15%/0.45)] ring-1 ring-inset motion-safe:transition-[box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-16px_hsl(218_60%_15%/0.5)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              action.primary ? 'ring-[hsl(40_80%_62%)]' : 'ring-[hsl(40_40%_86%)]',
            )}
          >
            <span className={cn('grid h-8 w-8 place-items-center rounded-xl',
              action.primary
                ? 'bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] text-[hsl(218_52%_11%)]'
                : 'bg-[hsl(42_100%_95%)] text-[hsl(34_90%_36%)] ring-1 ring-inset ring-[hsl(40_80%_84%)]')}>
              {action.icon}
            </span>
            <span className="text-2xs font-semibold leading-snug break-words">{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── PROPERTY DETAIL ────────────────────────────────────────────────────────────

function PropertyDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { homatchUser } = useAuth();
  const { services } = useServiceControls();
  const { t, lang, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [property, setProperty] = useState<Property | null>(null);
  const [life, setLife] = useState<PropertyLifecycle | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [matchCounts, setMatchCounts] = useState({ total: 0, newCount: 0, strongCount: 0 });

  const loadLifecycle = useCallback(async () => {
    if (!id) return;
    /* Best-effort: without the server's answer the page shows no freshness line rather
       than guessing one from the browser's clock. */
    const byId = await fetchLifecycle([String(id)]).catch(() => new Map<string, PropertyLifecycle>());
    setLife(byId.get(String(id)) ?? null);
  }, [id]);

  const loadData = useCallback(async () => {
    if (!id || !homatchUser) return;
    const [prop, counts] = await Promise.all([
      getProperty(id),
      getMatchCounts(id),
    ]);
    setProperty(prop);
    setMatchCounts(counts);
    setLoading(false);
    void loadLifecycle();
  }, [id, homatchUser, loadLifecycle]);

  useEffect(() => { void loadData(); }, [loadData]);

  /* Renewal can resume what expiry paused, so the property row is re-read with it. */
  const onRenewed = useCallback(() => { void loadData(); }, [loadData]);

  const handleDelete = async () => {
    if (!id) return;
    await softDeleteProperty(id);
    toast.success(t('prop_deleted_toast'));
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <div className="mx-auto w-full max-w-[90rem] space-y-4 px-4 py-4 animate-pulse sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="aspect-[16/10] rounded-xl bg-muted lg:col-span-7" />
            <div className="space-y-3 lg:col-span-5">
              <div className="h-6 bg-muted rounded w-2/3" />
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-28 bg-muted rounded-xl" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!property) {
    return (
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
          <p className="text-muted-foreground">{t('prop_not_found')}</p>
          <Button onClick={() => navigate('/dashboard')} className="mt-4 bg-primary text-primary-foreground">
            {t('prop_back_to_dashboard')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const facts = property.facts;
  const isPrivate = property.source_type === 'PRIVATE_LISTING';
  const imported = isImported(property.source_type as string | null);
  const sourceUrl = safeExternalUrl(facts?.source_url ?? null);
  const gallery = galleryImages({
    coverPhotoUrl: property.cover_photo_url, photos: property.photos,
    galleryImages: (facts as { gallery_images?: string[] } | null)?.gallery_images ?? null,
  });
  const { score, improvements } = calculateMatchability(facts ?? null, gallery.length);
  const locationParts = [
    placeName(facts?.neighborhood, lang),
    placeName(facts?.district, lang),
    placeName(facts?.city, lang),
    facts?.region,
  ].filter(Boolean).join(', ');

  const locale = intlLocaleFor(lang);
  const money = (value: number, currency: string) =>
    formatMoney(value, currency || 'USD', locale, { decimals: 0, narrowSymbol: true });

  const headFacts = [
    property.property_type
      ? { label: t('prop_fact_type'), value: t(`prop_type_${String(property.property_type).toLowerCase()}` as never) }
      : null,
    property.transaction_type
      ? { label: t('prop_fact_deal'), value: t(`prop_txn_${String(property.transaction_type).toLowerCase()}` as never) }
      : null,
    facts?.area ? { label: t('prop_fact_area'), value: `${facts.area} m²` } : null,
    facts?.rooms ? { label: t('prop_unit_rooms'), value: String(facts.rooms) } : null,
    facts?.bedrooms ? { label: t('prop_unit_bedrooms'), value: String(facts.bedrooms) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  /* Every detail fact that is real; none that is not. */
  const detailFacts = [
    facts?.bedrooms ? { icon: BedDouble, label: t('prop_bedrooms'), value: String(facts.bedrooms) } : null,
    facts?.bathrooms ? { icon: Bath, label: t('prop_bathrooms'), value: String(facts.bathrooms) } : null,
    facts?.floor ? { icon: Layers, label: t('prop_floor'), value: `${facts.floor}${facts.total_floors ? ` / ${facts.total_floors}` : ''}` } : null,
    facts?.building_type ? { icon: Building2, label: t('prop_building_type'), value: String(facts.building_type) } : null,
    facts?.condition ? { icon: CheckCircle2, label: t('prop_condition'), value: String(facts.condition) } : null,
    facts?.new_build ? { icon: CheckCircle2, label: t('prop_new_build'), value: t('general_yes') } : null,
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; value: string }>;
  const amenities = [
    facts?.parking ? t('prop_parking') : null,
    facts?.balcony ? t('prop_balcony') : null,
    facts?.elevator ? t('prop_elevator') : null,
    facts?.security ? t('prop_security') : null,
    facts?.furnished ? t('prop_furnished') : null,
    facts?.air_conditioning ? t('prop_ac_label') : null,
  ].filter(Boolean) as string[];
  const hasAbout = detailFacts.length > 0 || amenities.length > 0 || Boolean(facts?.description);

  const contactReady = hasContactReadiness(property);
  const action = intelligenceActionFor(property.transaction_type as string | null);
  /* A property with a search (or results) opens its results directly:
     "მყიდველები და მოთხოვნები" / "მოიჯარეები და მოთხოვნები" — one click, no new search. */
  const hasSearch = matchCounts.total > 0;
  const resultsLabel = String(property.transaction_type ?? '').toUpperCase() === 'RENT' ? t('fbl_nav_results_tenants') : t('fbl_nav_results_buyers');
  const ownerAction = hasSearch ? resultsLabel : matchCounts.total > 0
    ? t('prop_view_matches')
    : action ? t(`prop_action_${action.toLowerCase()}` as never) : t('prop_view_matches');
  const isOwner = Boolean(homatchUser && property.user_id === homatchUser.id);

  const aiContext = { type: 'property', data: { propertyId: id, title: property.title ?? t('prop_title_generic_fallback'), price: facts?.total_price ?? null, currency: facts?.currency ?? null, location: locationParts || null, transactionType: property.transaction_type ?? null, propertyType: property.property_type ?? null } };
  const quickActions: QuickAction[] = [
    {
      key: 'ai', primary: true, icon: <Bot className="h-4 w-4" />, label: t('prop_ask_ai_btn'),
      onClick: () => navigate('/ai', { state: { context: aiContext, prompt: `${t('prop_ai_about_prompt_base', { title: property.title ?? '' })} ${locationParts ? t('prop_ai_in_location', { location: locationParts }) : ''}`.trim() } }),
    },
    {
      key: 'improve', icon: <TrendingDown className="h-4 w-4" />, label: t('prop_find_better_deal_btn'),
      onClick: () => navigate('/ai', { state: { context: aiContext, prompt: `${t('prop_ai_cheaper_prompt_base', { title: property.title ?? '' })} ${facts?.total_price ? t('prop_ai_listed_at', { price: Number(facts.total_price).toLocaleString(), currency: facts.currency ?? '' }) : ''}`.trim() } }),
    },
    {
      key: 'verify', icon: <Shield className="h-4 w-4" />, label: t('prop_verify_btn'),
      onClick: () => navigate('/verify', { state: { query: property.title ?? locationParts, tab: 'property' } }),
    },
    {
      key: 'investment', icon: <Calculator className="h-4 w-4" />, label: t('pow_action_investment'),
      onClick: () => navigate(`/investment?propertyId=${encodeURIComponent(String(id))}`),
    },
    ...(facts?.total_price ? [{
      key: 'mortgage', icon: <Landmark className="h-4 w-4" />, label: t('dash_calculate_mortgage_property'),
      onClick: () => navigate('/mortgage', { state: { context: { propertyId: id, price: Number(facts.total_price), currency: facts.currency } } }),
    }] : []),
    ...(id && homatchUser && isOwner && designStudioEnabled(services.design_studio.frontend) ? [{
      key: 'design', icon: <NavGlyphIcon name="design_studio" className="h-4 w-4" />, label: t('ds_open_in_design_studio'),
      onClick: () => navigate(`/design-studio?property=${encodeURIComponent(id)}`),
    }] : []),
  ].filter((a) => {
    // A paused product (Admin → Service Control Center) offers no quick action.
    const service = ({ ai: 'ai_assistant', improve: 'ai_assistant', verify: 'verify', investment: 'investment', mortgage: 'mortgage' } as const)[a.key as 'ai'];
    return !service || services[service].frontend;
  });

  const unavailable = (
    <MediaUnavailable imported={imported} sourceUrl={sourceUrl} propertyId={String(id)} sourceStatus={life?.source_status ?? null} />
  );

  return (
    <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
      <div data-testid="pow-workspace" className="mx-auto w-full max-w-[90rem] space-y-6 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        {/* Back + delete */}
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => navigate('/property')} className={OWNER_SECONDARY}>
            <ArrowLeft className={`h-3.5 w-3.5 shrink-0 ${isRTL ? 'rotate-180' : ''}`} />
            <span className="break-words text-start">{t('prop_page_title')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            aria-label={t('prop_delete')}
            className={`${OWNER_ICON} hover:border-destructive/60 hover:text-destructive`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── 1. THE PROPERTY: photograph beside identity, status and the one action ── */}
        <section data-testid="pow-hero" className="grid gap-6 lg:grid-cols-12">
          <div className="relative min-w-0 lg:col-span-7 lg:h-full">
            <PropertyGallery
              ratio="hero"
              source={{
                coverPhotoUrl: property.cover_photo_url,
                photos: property.photos,
                galleryImages: (facts as { gallery_images?: string[] } | null)?.gallery_images ?? null,
              }}
              title={property.title ?? t('prop_alt_fallback')}
              unavailable={imported ? unavailable : undefined}
            />
            {isPrivate && (
              <div className="absolute top-3 start-3 z-10">
                <span className="status-private flex items-center gap-1.5">
                  <Lock className="h-3 w-3" />
                  {t('prop_private_badge')}
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4 lg:col-span-5">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <FreshnessChip life={life} />
                <SourceChip life={life} imported={imported} />
                {imported && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    {t('prop_source_imported')}
                  </span>
                )}
              </div>
              <h1 className="font-display text-2xl font-semibold leading-tight tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">
                {property.title ?? (isPrivate ? t('prop_title_private_fallback') : t('prop_title_imported_fallback'))}
              </h1>
              {locationParts && (
                <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                  <span className="break-words">{locationParts}</span>
                </p>
              )}
              <PropertyReference id={property.homatch_id} />
            </div>

            <div className="min-w-0">
              {facts?.total_price ? (
                <>
                  <p className="font-display text-3xl font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums" dir="ltr">
                    {money(Number(facts.total_price), String(facts.currency ?? 'USD'))}
                  </p>
                  {facts?.price_per_sqm ? (
                    <p className="mt-1.5 text-2xs text-muted-foreground tabular-nums" dir="ltr">
                      {money(Number(facts.price_per_sqm), String(facts.currency ?? 'USD'))}/m²
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-2xs text-muted-foreground">{t('prop_no_price')}</p>
              )}
            </div>

            <FactLine items={headFacts} />

            {/* The one primary action, then the owner's management controls. */}
            <div className="flex flex-wrap items-center gap-2">
              {services.find_buyers.frontend && <Link
                to={contactReady || hasSearch ? `/property/${id}/matches` : `/property/${id}/edit#contact`}
                state={contactReady || hasSearch ? undefined : returnState()}
                data-testid="property-results-link"
                className="inline-flex min-h-10 min-w-0 basis-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] sm:basis-0 sm:flex-1 px-4 py-2 text-2xs font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                {!contactReady && !hasSearch && <Phone className="h-3.5 w-3.5 shrink-0" />}
                <span className="break-words text-center leading-snug">{contactReady || hasSearch ? ownerAction : t('contact_phone_add')}</span>
              </Link>}
              <Link to={`/property/${id}/edit`} state={returnState()} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-2xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{t('prop_action_edit')}</span>
              </Link>
              <Link to={`/property/${id}/edit#photos`} state={returnState()} className={OWNER_ICON} aria-label={t('prop_action_photos')}>
                <Camera className="h-3.5 w-3.5" />
              </Link>
              {/* Publish to Portals with this property already chosen — the workspace
                  itself is the standalone /publishing area, not a panel here. */}
              {services.publishing.frontend && (
                <Link to={`/publishing/${id}`} className={OWNER_ICON} aria-label={t('pubw_publish_this_property')} title={t('pubw_publish_this_property')}>
                  <NavGlyphIcon name="publishing" className="h-3.5 w-3.5" />
                </Link>
              )}
              {/* PATH A into Meta Ads: this property, already selected. */}
              {services.meta_ads.frontend && (
                <Link to={`/outreach/meta/create?property=${id}`} className={OWNER_ICON} aria-label={t('mads_property_cta')} title={t('mads_property_cta')}>
                  <Megaphone className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {isOwner && id && (
              <PropertyStatusPanel propertyId={id} life={life} imported={imported} sourceUrl={sourceUrl} onRenewed={onRenewed} />
            )}
          </div>
        </section>

        {id && <CanonicalGroupBanner propertyId={id} />}

        {/* ── 2. QUICK ACTIONS ── */}
        <QuickActions actions={quickActions} />

        {/* ── 3. MATCHING ── the way into the matching workspace (owner, 2026-10-24: the
            property page no longer launches or prices a paid external search). */}
        {homatchUser && id && services.find_buyers.frontend && <MatchingEntryCard propertyId={id} />}

        {/* ── 4. THE INFORMATION: one editorial system, no giant empty cards ── */}
        <section data-testid="pow-info" className="grid gap-4 lg:grid-cols-12">
          <div className="min-w-0 space-y-4 lg:col-span-8">
            {hasAbout && (
              <div className="hm-owner-panel space-y-4 p-5">
                <SectionTitle>{t('pow_section_about')}</SectionTitle>
                {detailFacts.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {detailFacts.map((fact) => <Fact key={fact.label} icon={fact.icon} label={fact.label} value={fact.value} />)}
                  </div>
                )}
                {amenities.length > 0 && (
                  <div className="flex flex-wrap gap-2" aria-label={t('prop_amenities_label')}>
                    {amenities.map((label) => <AmenityChip key={label} label={label} />)}
                  </div>
                )}
                {facts?.description && (
                  <p className="max-w-[75ch] whitespace-pre-line border-t border-[hsl(40_60%_88%)] pt-3 text-sm leading-relaxed text-muted-foreground" dir="auto">{facts.description}</p>
                )}
              </div>
            )}
            {/* WHAT A SEARCH LOOKS FOR, from the property's real facts (never a stale "1+"). */}
            <div className="hm-owner-panel space-y-2 p-5">
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-[hsl(34_90%_34%)]">{t('prop_search_profile_label')}</p>
              <SearchDna facts={facts ? {
                transaction_type: property.transaction_type, property_type: property.property_type,
                city: facts.city, district: facts.district, bedrooms: facts.bedrooms, rooms: facts.rooms,
                area: facts.area, total_price: facts.total_price, currency: facts.currency,
              } : null} />
            </div>
          </div>

          <aside className="min-w-0 space-y-4 lg:col-span-4">
            <MatchabilityPanel score={score} improvements={improvements} />
            {imported && (
              <div data-testid="pow-source-card" className="hm-owner-panel space-y-3 p-5">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-[hsl(34_90%_34%)]">{t('pow_section_source')}</p>
                <dl className="space-y-1.5 text-2xs">
                  {facts?.source_domain && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('pow_source_site')}</dt><dd className="font-medium text-foreground break-all" dir="ltr">{String(facts.source_domain).replace(/^www\./, '')}</dd></div>
                  )}
                  {facts?.source_listing_id && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('pow_source_listing_id')}</dt><dd className="font-medium text-foreground tabular-nums" dir="ltr">{String(facts.source_listing_id)}</dd></div>
                  )}
                  {life?.imported_at && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('pow_imported_at')}</dt><dd className="font-medium text-foreground" dir="ltr">{new Date(life.imported_at).toLocaleDateString()}</dd></div>
                  )}
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('fbl_media_photos')}</dt><dd className="font-medium text-foreground tabular-nums" dir="ltr">{gallery.length}</dd></div>
                </dl>
                {isOwner && id && <MediaRefresh propertyId={id} storedCount={gallery.length} sourceDomain={facts?.source_domain ?? null} onRefreshed={onRenewed} />}
                {sourceUrl && (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-2xs font-semibold text-[hsl(34_90%_36%)] hover:underline">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t('pow_open_listing')}
                  </a>
                )}
              </div>
            )}
            {imported && isOwner && id && <ManageInHomatch propertyId={id} />}
            {id && <PropertyTrustBadge propertyId={id} />}
          </aside>
        </section>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('prop_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {t('prop_delete_confirm_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">{t('prop_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('prop_confirm_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function PropertyDetailPage() {
  return (
    <RouteGuard>
      <PropertyDetailContent />
    </RouteGuard>
  );
}
