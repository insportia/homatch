import {AlertCircle, ArrowLeft, Bath,BedDouble, Bot, 
  Building2, Camera, 
  CheckCircle2, ChevronRight, ExternalLink, Landmark,Layers,Loader2, Lock, 
  MapPin, Pause, Pencil, Phone,
  Play, Shield, Trash2,TrendingDown, Zap 
, Megaphone } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CampaignLaunchPanel } from '@/components/campaign/CampaignLaunchPanel';
import { PrivateImage } from '@/components/common/PrivateImage';
import { RouteGuard } from '@/components/common/RouteGuard';
import { OWNER_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { MatchingJobProgress } from '@/components/matching/MatchingJobProgress';
import { PropertyReference } from '@/components/owner/ContactPhoneField';
import {
  FactLine, IntelLine, OWNER_ICON, OWNER_SECONDARY,
} from '@/components/owner/portfolio';
import { CanonicalGroupBanner } from '@/components/property/CanonicalGroupBanner';
import { PropertyGallery } from '@/components/property/PropertyGallery';
import { PropertyTrustBadge } from '@/components/property/PropertyTrustBadge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { hasContactReadiness } from '@/lib/propertyContact';
import { cn } from '@/lib/utils';
import { intelligenceActionFor } from '@/property/rules';
import { 
  type CampaignSearchLanguageChoice, calculateMatchability,getCreditAccount,
  getMatchCounts, getProperty, pauseMatchingCampaign,softDeleteProperty, 
  startMatchingCampaign } from '@/services/api';
import type { PortfolioIntelligence } from '@/services/propertyManagement';
import { portfolioIntelligence } from '@/services/propertyManagement';
import type { CreditAccount, Property } from '@/types/types';

function MatchabilityPanel({ score, improvements }: { score: number; improvements: string[] }) {
  /* The hints arrive as i18n keys; a module that cannot know the reader's
     language must not choose their words. */
  const { t } = useLanguage();
  const color = score >= 70 ? '#4ade80' : score >= 40 ? 'hsl(38 92% 55%)' : '#6b7ba0';
  const circumference = 2 * Math.PI * 28;
  const dash = (score / 100) * circumference;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{t('match_score_label')}</h3>
      </div>

      <div className="flex items-center gap-5">
        {/* Circle gauge */}
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 64 64" className="transform -rotate-90">
            <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--secondary))" strokeWidth="5" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              stroke={color} strokeWidth="5"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
            {score}%
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {score >= 70 ? t('prop_matchability_excellent') : score >= 40 ? t('prop_matchability_good') : t('prop_matchability_improve')}
          </p>
        </div>
      </div>

      {improvements.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('match_improve')}</p>
          {improvements.slice(0, 4).map((hint, i) => (
            <div key={t(i as never)} className="flex items-start gap-2 min-w-0">
              <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              {/* An i18n KEY, not a sentence. These rendered as English inside a
                  Georgian page on production; calculateMatchability cannot know the
                  reader's language and must not choose their words. */}
              <p className="text-xs text-muted-foreground break-words min-w-0">{t(hint as never)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FactRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border/40 last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      <span className="text-sm text-muted-foreground min-w-[100px]">{label}</span>
      <span className="text-sm font-medium text-foreground flex-1 text-right">{value}</span>
    </div>
  );
}

function AmenityChip({ label, active }: { label: string; active?: boolean }) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs text-foreground">
      <CheckCircle2 className="h-3 w-3 text-primary" />
      {label}
    </div>
  );
}

// ── CAMPAIGN PANEL ──────────────────────────────────────────

const STRENGTH_COLORS: Record<string, string> = {
  EXCEPTIONAL: 'text-yellow-400',
  VERY_STRONG: 'text-primary',
  STRONG: 'text-green-400',
  GOOD: 'text-blue-400',
  POTENTIAL: 'text-muted-foreground',
};

function CampaignPanel({
  propertyId,
  userId,
  transactionType,
  initialActive,
  matchCounts,
  creditBalance,
  onNavigateMatches,
  onCountsRefresh,
}: {
  propertyId: string;
  /** SALE, RENT or INVESTMENT. Decides what this property is looking FOR. */
  transactionType?: string | null;
  userId: string;
  initialActive: boolean;
  matchCounts: { total: number; newCount: number; strongCount: number };
  creditBalance: number;
  onNavigateMatches: () => void;
  onCountsRefresh: (counts: { total: number; newCount: number; strongCount: number }) => void;
}) {
  const { t } = useLanguage();
  const [active, setActive] = useState(initialActive);
  const [loading, setLoading] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /* Nothing is spent until the customer names the ceiling. */
  const [showBudget, setShowBudget] = useState(false);

  const handleStart = async (
    authorizedMaxCredits: number | null,
    searchLanguages?: CampaignSearchLanguageChoice,
    discoverBrokers?: boolean,
  ) => {
    setShowBudget(false);
    setLoading(true);
    try {
      const result = await startMatchingCampaign(
        propertyId, userId, authorizedMaxCredits, searchLanguages ?? null,
        discoverBrokers === true,
      );
      if (!result?.jobId) throw new Error('No job ID returned from match-campaign');
      setActive(true);
      setActiveJobId(result.jobId);
      toast.success(t('matches_campaign_started_toast'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matches_start_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePauseConfirmed = async () => {
    setLoading(true);
    try {
      await pauseMatchingCampaign(propertyId, userId);
      setActive(false);
      setShowPauseConfirm(false);
      toast.success(t('matches_paused_toast'));
    } catch (err) {
      // Still active, still spending. Saying "paused" here would be a lie the
      // customer only discovers on their next credit statement.
      console.error(err);
      toast.error(t('matches_pause_error'));
    } finally {
      setLoading(false);
    }
  };

  /*
   * WHAT THIS PROPERTY IS LOOKING FOR, AND THEREFORE WHAT THE BUTTON SAYS.
   *
   * The machinery underneath is unchanged and deliberately so: the same handler, the
   * same budget dialog, the same CampaignLaunchPanel, the same FIND_CLIENTS product,
   * the same reserve-settle-release. Only the words change -- "Start matching" is an
   * abstraction the customer has to translate into their own situation, and a listing
   * for sale is looking for buyers while a rental is looking for tenants.
   *
   * Null for a property whose transaction type is absent or unrecognised -- a real
   * state for a half-finished import -- and then the generic wording is the honest one
   * rather than a guess at which half of the market they are in.
   */
  const contextual = intelligenceActionFor(transactionType);
  const startLabel = contextual
    ? t(`prop_action_${contextual.toLowerCase()}` as never)
    : t('matches_start_matching');

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t('matches_title')}
          </h3>
          {active ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {t('matches_matching_active')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t('matches_matching_paused')}</span>
          )}
        </div>

        {/* Match stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: t('prop_stat_total'), value: matchCounts.total },
            { label: t('prop_stat_new'), value: matchCounts.newCount, highlight: matchCounts.newCount > 0 },
            { label: t('prop_stat_strong'), value: matchCounts.strongCount, highlight: matchCounts.strongCount > 0 },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="rounded-lg bg-secondary/50 p-2 text-center">
              <p className={`text-lg font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
              <p className="text-[13px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Credits indicator */}
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-muted-foreground">{t('prop_balance_label')}</span>
          <button
            onClick={() => window.open('/credits', '_self')}
            className="flex items-center gap-1 text-primary hover:underline font-medium"
          >
            <Zap className="h-3 w-3" />
            {creditBalance.toFixed(2)} CR
          </button>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          {matchCounts.total > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onNavigateMatches}
              className="w-full border border-border text-sm h-8 gap-1.5 justify-between"
            >
              <span>{t('prop_view_matches')}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPauseConfirm(true)}
              disabled={loading}
              className="w-full border border-border text-xs h-8 gap-1.5 text-muted-foreground"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
              {t('matches_pause_matching')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setShowBudget(true)}
              disabled={loading}
              /* h-auto with a minimum: "მყიდველების მოძიება" wraps in this column and a
                 fixed height clipped the second line. */
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-xs h-auto min-h-8 py-1.5 gap-1.5 whitespace-normal"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              <span className="break-words min-w-0">{startLabel}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Live job progress — shown once a job is started */}
      {activeJobId && (
        <MatchingJobProgress
          jobId={activeJobId}
          propertyId={propertyId}
          onComplete={(job) => {
            // Refresh match counts when job finishes
            getMatchCounts(propertyId).then(onCountsRefresh).catch(err => {
              console.error('[PropertyDetailPage] failed to refresh match counts:', err);
            });
            if (job.matches_created > 0) {
              toast.success(t('matches_job_complete_toast', { count: job.matches_created }));
            } else if (job.status === 'partially_completed') {
              toast.warning(t('matches_job_partial_toast'));
            }
          }}
        />
      )}

      {/* The ceiling is chosen before anything is spent. */}
      <Dialog open={showBudget} onOpenChange={setShowBudget}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-words">{startLabel}</DialogTitle>
            <DialogDescription className="sr-only">{t('budget_choose_title')}</DialogDescription>
          </DialogHeader>
          <CampaignLaunchPanel
            propertyId={propertyId}
            productCode="FIND_CLIENTS"
            onRun={(authorized, languages, discoverBrokers) => void handleStart(authorized, languages, discoverBrokers)}
            running={loading}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={showPauseConfirm} onOpenChange={setShowPauseConfirm}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('matches_pause_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('matches_pause_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePauseConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('matches_pause_campaign_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── PROPERTY DETAIL ──────────────────────────────────────────

function PropertyDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { homatchUser } = useAuth();
  const { t, lang, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [property, setProperty] = useState<Property | null>(null);
  /*
   * WHAT HOMATCH KNOWS ABOUT THIS ONE PROPERTY.
   *
   * The same call the portfolio list makes, scoped to a single id, rather than a second
   * counting query written here — one definition of what a match count is, and it already
   * reads `property_id=in.` so a list of one costs the same round trip.
   *
   * Best-effort: a details page that cannot reach the counts still shows the property.
   */
  const [intel, setIntel] = useState<PortfolioIntelligence | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [matchCounts, setMatchCounts] = useState({ total: 0, newCount: 0, strongCount: 0 });
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);

  const loadData = useCallback(async () => {
    if (!id || !homatchUser) return;
    const [prop, counts, credits] = await Promise.all([
      getProperty(id),
      getMatchCounts(id),
      getCreditAccount(homatchUser.id),
    ]);
    setProperty(prop);
    /* The counts, best-effort and separate: a details page that cannot reach them still
       shows the property, and the intelligence panel reports zero rather than guessing. */
    portfolioIntelligence([String(id)])
      .then((byId) => setIntel(byId.get(String(id))))
      .catch(() => setIntel(undefined));
    setMatchCounts(counts);
    setCreditAccount(credits);
    setLoading(false);
  }, [id, homatchUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async () => {
    if (!id) return;
    await softDeleteProperty(id);
    toast.success(t('prop_deleted_toast'));
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
        <div className="mx-auto w-full max-w-[72rem] space-y-4 px-4 py-4 animate-pulse sm:px-6 lg:px-8">
          <div className="h-48 md:h-64 rounded-xl bg-muted" />
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-4 bg-muted rounded w-1/3" />
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
  const { score, improvements } = calculateMatchability(facts ?? null);
  /* In the reader's script, through the same layer the portfolio uses. */
  const locationParts = [
    placeName(facts?.neighborhood, lang),
    placeName(facts?.district, lang),
    placeName(facts?.city, lang),
    facts?.region,
  ].filter(Boolean).join(', ');

  const locale = intlLocaleFor(lang);
  const money = (value: number, currency: string) =>
    formatMoney(value, currency || 'USD', locale, { decimals: 0, narrowSymbol: true });

  /* The facts that decide a property, only where each one is real. */
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

  /*
   * The contextual action. Matches when there are matches; otherwise the discovery this
   * property's transaction type actually supports — a rental has no buyers, so offering
   * to find them is offering something that cannot succeed.
   */
  const action = intelligenceActionFor(property.transaction_type as string | null);
  /* A historical property with no number keeps everything except the ability to start a
     NEW search. Nothing is archived, nothing is fabricated, nothing is deleted. */
  const contactReady = hasContactReadiness(property);

  const ownerAction = (intel?.total ?? 0) > 0
    ? t('prop_view_matches')
    : action ? t(`prop_action_${action.toLowerCase()}` as never) : t('prop_view_matches');

  return (
    /*
     * `.hm-owner` — the established dark block, the same one the portfolio wears. A
     * customer opening a property from that list should not cross a theme boundary
     * doing it.
     *
     * 72rem rather than a 768px column: this page has a gallery, a facts grid and a side
     * rail, and three of those in a phone-width strip is the composition the workspace
     * was rebuilt to stop doing.
     */
    <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
      <div className="mx-auto w-full max-w-[72rem] space-y-5 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        {/* Back + actions */}
        <div className="flex items-center justify-between gap-4">
          {/* Both were words with handlers. The one that leaves the page and the one
              that destroys a property are the two that most need to look like controls. */}
          <button
            type="button"
            onClick={() => navigate('/property')}
            className={OWNER_SECONDARY}
          >
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

        {/*
          THE GALLERY, WHICH USED TO BE A COVER AND A ROW OF INERT STAMPS.
          Every photo the property has -- the photo table first, then the property's own
          cover key, then an importer's gallery array -- de-duplicated, ordered with the
          owner's chosen cover leading, with a thumbnail rail, a count and a lightbox.
          Storage is not reimplemented: PrivateImage is still the one thing that knows a
          private key from an absolute URL.
        */}
        {/*
          ── THE FIRST SCREEN: PHOTOGRAPH AND IDENTITY, SIDE BY SIDE ──
          A gallery across 72rem is 460px tall and pushes the property's own price and
          facts below the fold, which is a control centre whose first screen is one
          photograph. At lg the image takes the width a landscape cover reads at and the
          identity sits beside it; below lg they stack, which is the right order on a
          phone anyway.
        */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
          <div className="relative min-w-0">
            <PropertyGallery
              source={{
                coverPhotoUrl: property.cover_photo_url,
                photos: property.photos,
                galleryImages: (facts as { gallery_images?: string[] } | null)?.gallery_images ?? null,
              }}
              title={property.title ?? t('prop_alt_fallback')}
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

          {/* ── IDENTITY ─────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-2">
              <h1 className="font-display text-xl font-semibold leading-tight tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">
                {property.title ?? (isPrivate ? t('prop_title_private_fallback') : t('prop_title_imported_fallback'))}
              </h1>
              {locationParts && (
                <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                  <span className="break-words">{locationParts}</span>
                </p>
              )}
              {/* The permanent reference, quiet and selectable. */}
              <PropertyReference id={property.homatch_id} />
            </div>

            {/*
              THE PRICE IS A NUMBER, NOT A CARD. It was one of three bordered tiles
              captioned PRICE / PER M² / AREA — a container each for one figure, which
              made the most important number on the page the same size as the least.
            */}
            <div className="min-w-0">
              {facts?.total_price ? (
                <>
                  <p className="font-display text-2xl font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums" dir="ltr">
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

            {/* The facts that decide a property, as values rather than tiles. */}
            <FactLine items={headFacts} />

            {/* ── HOMATCH INTELLIGENCE AND THE ONE ACTION ───────────────
                The discovery CTA's navy framing: the single dark object in
                the identity column, so "find the people for this property"
                reads as the product's own act, not one row among the facts.
                Everything else on the page stays on white. */}
            <div className="space-y-2.5 overflow-hidden rounded-2xl bg-[#0C1119] p-4 text-white shadow-hover">
              <IntelLine
                onDark
                total={intel?.total ?? 0}
                fresh={intel?.fresh ?? 0}
                strong={intel?.strong ?? 0}
              />
              {/*
                A SEARCH CANNOT START WITHOUT SOMEWHERE TO SEND PEOPLE.
                Where the property has no contact number the same control says the one
                thing that has to happen first and goes to the field that does it. The
                action is not disabled and nothing is hidden — a disabled button with a
                tooltip is a puzzle, and this is a sentence.
              */}
              {contactReady ? (
                <Link to={`/property/${id}/matches`} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3 py-1.5 text-2xs font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <span className="break-words text-center leading-snug">{ownerAction}</span>
                </Link>
              ) : (
                <>
                  <Link to={`/property/${id}/edit#contact`} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3 py-1.5 text-2xs font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="break-words text-center leading-snug">
                      {t('contact_phone_add')}
                    </span>
                  </Link>
                  <p className="break-words text-2xs leading-relaxed text-white/75">
                    {t('contact_phone_missing_body')}
                  </p>
                </>
              )}
              <div className="flex items-center gap-1.5">
                <Link to={`/property/${id}/edit`} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/40 bg-white px-3 py-1.5 text-2xs font-semibold text-[#0C1119] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-words text-start">{t('prop_action_edit')}</span>
                </Link>
                <Link to={`/property/${id}/edit#photos`} className="inline-flex min-h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/25 text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" aria-label={t('prop_action_photos')}>
                  <Camera className="h-3.5 w-3.5" />
                </Link>
                {/* PATH A into Meta Ads: this property, already selected. */}
                <Link to={`/outreach/meta/create?property=${id}`} className="inline-flex min-h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/25 text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" aria-label={t('mads_property_cta')} title={t('mads_property_cta')}>
                  <Megaphone className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {facts?.source_url && (
              <a
                href={facts.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-2xs text-[hsl(var(--primary))] hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {t('prop_source_link')}
              </a>
            )}
          </div>
        </div>

        {/* Canonical dedup banner */}
        {id && <CanonicalGroupBanner propertyId={id} />}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Main info */}
          <div className="md:col-span-2 space-y-5">
            {/* Facts */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('prop_details_label')}</h3>
              <FactRow icon={BedDouble} label={t('prop_bedrooms')} value={facts?.bedrooms} />
              <FactRow icon={Bath} label={t('prop_bathrooms')} value={facts?.bathrooms} />
              <FactRow icon={Layers} label={t('prop_floor')} value={facts?.floor ? `${facts.floor}${facts.total_floors ? ` / ${facts.total_floors}` : ''}` : null} />
              <FactRow icon={Building2} label={t('prop_building_type')} value={facts?.building_type} />
              <FactRow icon={CheckCircle2} label={t('prop_condition')} value={facts?.condition} />
              {facts?.new_build && <FactRow icon={CheckCircle2} label={t('prop_new_build')} value={t('general_yes')} />}
            </div>

            {/* Amenities */}
            {(facts?.parking || facts?.balcony || facts?.elevator || facts?.security || facts?.furnished || facts?.air_conditioning) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('prop_amenities_label')}</p>
                <div className="flex flex-wrap gap-2">
                  <AmenityChip label={t('prop_parking')} active={facts?.parking} />
                  <AmenityChip label={t('prop_balcony')} active={facts?.balcony} />
                  <AmenityChip label={t('prop_elevator')} active={facts?.elevator} />
                  <AmenityChip label={t('prop_security')} active={facts?.security} />
                  <AmenityChip label={t('prop_furnished')} active={facts?.furnished} />
                  <AmenityChip label={t('prop_ac_label')} active={facts?.air_conditioning} />
                </div>
              </div>
            )}

            {/* Description */}
            {facts?.description && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('prop_description_label')}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{facts.description}</p>
              </div>
            )}

            {/* Search Profile */}
            {property.search_profile && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('prop_search_profile_label')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('prop_search_profile_desc')}{' '}
                  {[
                    property.search_profile.transaction_type,
                    property.search_profile.city,
                    property.search_profile.district,
                    property.search_profile.min_bedrooms ? t('prop_min_beds_suffix', { n: property.search_profile.min_bedrooms }) : null,
                    property.search_profile.min_price ? t('prop_from_price_prefix', { price: property.search_profile.min_price?.toLocaleString() ?? '', currency: property.search_profile.currency ?? '' }) : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <MatchabilityPanel score={score} improvements={improvements} />
            {id && <PropertyTrustBadge propertyId={id} />}

            {/* AI / Verify quick actions */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('prop_quick_actions_label')}</p>
              <Button
                size="sm"
                className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 justify-start h-auto min-h-9 py-2 whitespace-normal text-start"
                onClick={() => navigate('/ai', {
                  state: {
                    context: { type: 'property', data: { propertyId: id, title: property.title ?? t('prop_title_generic_fallback'), price: facts?.total_price ?? null, currency: facts?.currency ?? null, location: locationParts || null, transactionType: property.transaction_type ?? null, propertyType: property.property_type ?? null } },
                    prompt: `${t('prop_ai_about_prompt_base', { title: property.title ?? '' })} ${locationParts ? t('prop_ai_in_location', { location: locationParts }) : ''}`.trim(),
                  },
                })}
              >
                <Bot className="h-4 w-4 shrink-0" /> {t('prop_ask_ai_btn')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2 border-border justify-start h-auto min-h-9 py-2 whitespace-normal text-start"
                onClick={() => navigate('/ai', {
                  state: {
                    context: { type: 'property', data: { propertyId: id, title: property.title ?? t('prop_title_generic_fallback'), price: facts?.total_price ?? null, currency: facts?.currency ?? null, location: locationParts || null, transactionType: property.transaction_type ?? null, propertyType: property.property_type ?? null } },
                    prompt: `${t('prop_ai_cheaper_prompt_base', { title: property.title ?? '' })} ${facts?.total_price ? t('prop_ai_listed_at', { price: Number(facts.total_price).toLocaleString(), currency: facts.currency ?? '' }) : ''}`.trim(),
                  },
                })}
              >
                <TrendingDown className="h-4 w-4 shrink-0 text-primary" /> {t('prop_find_better_deal_btn')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2 border-border justify-start h-auto min-h-9 py-2 whitespace-normal text-start"
                onClick={() => navigate('/verify', {
                  state: { query: property.title ?? locationParts, tab: 'property' },
                })}
              >
                <Shield className="h-4 w-4 shrink-0 text-primary" /> {t('prop_verify_btn')}
              </Button>
              {facts?.total_price && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 border-border justify-start h-auto min-h-9 py-2 whitespace-normal text-start"
                  onClick={() => navigate('/mortgage', {
                    state: {
                      context: { propertyId: id, price: Number(facts.total_price), currency: facts.currency },
                    },
                  })}
                >
                  <Landmark className="h-4 w-4 shrink-0 text-primary" /> {t('dash_calculate_mortgage_property')}
                </Button>
              )}
            </div>

            {/* Campaign Controls */}
            {homatchUser && id && (
              <CampaignPanel
                propertyId={id}
                transactionType={property.transaction_type}
                userId={homatchUser.id}
                initialActive={property.matching_status === 'ACTIVE'}
                matchCounts={matchCounts}
                creditBalance={Number(creditAccount?.balance ?? 0)}
                onNavigateMatches={() => navigate(`/property/${id}/matches`)}
                onCountsRefresh={setMatchCounts}
              />
            )}
          </div>
        </div>
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
