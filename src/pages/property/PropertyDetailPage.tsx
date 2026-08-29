import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { getProperty, softDeleteProperty, calculateMatchability,
  startMatchingCampaign, pauseMatchingCampaign,
  getMatchCounts, getCreditAccount } from '@/services/api';
import type { Property, CreditAccount } from '@/types/types';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MapPin, BedDouble, Bath,
  Building2, ExternalLink, Zap, ArrowLeft, Trash2,
  CheckCircle2, AlertCircle, Lock, Layers,
  Play, Pause, Loader2, ChevronRight, Bot, TrendingDown, Shield,
} from 'lucide-react';
import { MatchingJobProgress } from '@/components/matching/MatchingJobProgress';
import { PropertyTrustBadge } from '@/components/property/PropertyTrustBadge';
import { CanonicalGroupBanner } from '@/components/property/CanonicalGroupBanner';

function MatchabilityPanel({ score, improvements }: { score: number; improvements: string[] }) {
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
            {score >= 70 ? 'Excellent matchability' : score >= 40 ? 'Good — can be improved' : 'Improve to get better matches'}
          </p>
        </div>
      </div>

      {improvements.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('match_improve')}</p>
          {improvements.slice(0, 4).map((hint, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{hint}</p>
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
  initialActive,
  matchCounts,
  creditBalance,
  onNavigateMatches,
  onCountsRefresh,
}: {
  propertyId: string;
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

  const handleStart = async () => {
    setLoading(true);
    try {
      const result = await startMatchingCampaign(propertyId, userId);
      if (!result?.jobId) throw new Error('No job ID returned from match-campaign');
      setActive(true);
      setActiveJobId(result.jobId);
      toast.success('Matching campaign started — live results loading…');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start matching');
    } finally {
      setLoading(false);
    }
  };

  const handlePauseConfirmed = async () => {
    setLoading(true);
    await pauseMatchingCampaign(propertyId, userId);
    setActive(false);
    setLoading(false);
    setShowPauseConfirm(false);
    toast.success('Campaign paused.');
  };

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
            { label: 'Total', value: matchCounts.total },
            { label: 'New', value: matchCounts.newCount, highlight: matchCounts.newCount > 0 },
            { label: 'Strong+', value: matchCounts.strongCount, highlight: matchCounts.strongCount > 0 },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="rounded-lg bg-secondary/50 p-2 text-center">
              <p className={`text-lg font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Credits indicator */}
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-muted-foreground">Balance</span>
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
              <span>View Matches</span>
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
              onClick={handleStart}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-xs h-8 gap-1.5"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {t('matches_start_matching')}
            </Button>
          )}
        </div>
      </div>

      {/* Live job progress — shown once a job is started */}
      {activeJobId && (
        <MatchingJobProgress
          jobId={activeJobId}
          onComplete={(job) => {
            // Refresh match counts when job finishes
            getMatchCounts(propertyId).then(onCountsRefresh);
            if (job.matches_created > 0) {
              toast.success(`Matching complete — ${job.matches_created} match${job.matches_created !== 1 ? 'es' : ''} found`);
            } else if (job.status === 'partially_completed') {
              toast.warning('Matching partially completed — check events for details');
            }
          }}
        />
      )}

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
              Pause Campaign
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
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [property, setProperty] = useState<Property | null>(null);
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
    setMatchCounts(counts);
    setCreditAccount(credits);
    setLoading(false);
  }, [id, homatchUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async () => {
    if (!id) return;
    await softDeleteProperty(id);
    toast.success('Property deleted.');
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
          <div className="h-48 md:h-64 rounded-xl bg-muted" />
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-4 bg-muted rounded w-1/3" />
        </div>
      </AppLayout>
    );
  }

  if (!property) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-20">
          <p className="text-muted-foreground">Property not found.</p>
          <Button onClick={() => navigate('/dashboard')} className="mt-4 bg-primary text-primary-foreground">
            Back to Dashboard
          </Button>
        </div>
      </AppLayout>
    );
  }

  const facts = property.facts;
  const isPrivate = property.source_type === 'PRIVATE_LISTING';
  const { score, improvements } = calculateMatchability(facts ?? null);
  const locationParts = [facts?.neighborhood, facts?.district, facts?.city, facts?.region].filter(Boolean).join(', ');

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Back + actions */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            Dashboard
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDelete(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            {t('prop_delete')}
          </Button>
        </div>

        {/* Cover photo */}
        <div className="aspect-[16/7] rounded-xl overflow-hidden bg-secondary relative">
          {property.cover_photo_url ? (
            <img
              src={property.cover_photo_url}
              alt={property.title ?? 'Property'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 className="h-12 w-12 text-muted-foreground/20" />
            </div>
          )}
          {isPrivate && (
            <div className={`absolute top-3 ${isRTL ? 'right-3' : 'left-3'}`}>
              <span className="status-private flex items-center gap-1.5">
                <Lock className="h-3 w-3" />
                {t('prop_private_badge')}
              </span>
            </div>
          )}
        </div>

        {/* Photo gallery strip */}
        {(property.photos?.length ?? 0) > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {property.photos?.map(ph => (
              <div key={ph.id} className="w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-border">
                <img src={ph.public_url ?? ''} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        )}

        {/* Canonical dedup banner */}
        {id && <CanonicalGroupBanner propertyId={id} />}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Main info */}
          <div className="md:col-span-2 space-y-5">
            {/* Title & location */}
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {property.title ?? (isPrivate ? 'Private Listing' : 'Imported Property')}
              </h1>
              {locationParts && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {locationParts}
                </p>
              )}
              {facts?.source_url && (
                <a
                  href={facts.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 mt-1.5"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('prop_source_link')}
                </a>
              )}
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-3">
              {facts?.total_price && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground mb-1">Price</p>
                  <p className="font-semibold text-foreground text-sm">
                    {Number(facts.total_price).toLocaleString()} {facts.currency}
                  </p>
                </div>
              )}
              {facts?.price_per_sqm && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground mb-1">Per m²</p>
                  <p className="font-semibold text-foreground text-sm">
                    {Number(facts.price_per_sqm).toLocaleString()} {facts.currency}
                  </p>
                </div>
              )}
              {facts?.area && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground mb-1">Area</p>
                  <p className="font-semibold text-foreground text-sm">{facts.area} m²</p>
                </div>
              )}
            </div>

            {/* Facts */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Details</h3>
              <FactRow icon={BedDouble} label="Bedrooms" value={facts?.bedrooms} />
              <FactRow icon={Bath} label="Bathrooms" value={facts?.bathrooms} />
              <FactRow icon={Layers} label="Floor" value={facts?.floor ? `${facts.floor}${facts.total_floors ? ` / ${facts.total_floors}` : ''}` : null} />
              <FactRow icon={Building2} label="Building type" value={facts?.building_type} />
              <FactRow icon={CheckCircle2} label="Condition" value={facts?.condition} />
              {facts?.new_build && <FactRow icon={CheckCircle2} label="New build" value="Yes" />}
            </div>

            {/* Amenities */}
            {(facts?.parking || facts?.balcony || facts?.elevator || facts?.security || facts?.furnished || facts?.air_conditioning) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amenities</p>
                <div className="flex flex-wrap gap-2">
                  <AmenityChip label={t('prop_parking')} active={facts?.parking} />
                  <AmenityChip label={t('prop_balcony')} active={facts?.balcony} />
                  <AmenityChip label={t('prop_elevator')} active={facts?.elevator} />
                  <AmenityChip label={t('prop_security')} active={facts?.security} />
                  <AmenityChip label={t('prop_furnished')} active={facts?.furnished} />
                  <AmenityChip label="AC" active={facts?.air_conditioning} />
                </div>
              </div>
            )}

            {/* Description */}
            {facts?.description && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{facts.description}</p>
              </div>
            )}

            {/* Search Profile */}
            {property.search_profile && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Search Profile</h3>
                <p className="text-xs text-muted-foreground">
                  Homatch will look for demand matching:{' '}
                  {[
                    property.search_profile.transaction_type,
                    property.search_profile.city,
                    property.search_profile.district,
                    property.search_profile.min_bedrooms ? `${property.search_profile.min_bedrooms}+ beds` : null,
                    property.search_profile.min_price ? `from ${property.search_profile.min_price?.toLocaleString()} ${property.search_profile.currency ?? ''}` : null,
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
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</p>
              <Button
                size="sm"
                className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 justify-start"
                onClick={() => navigate('/ai', {
                  state: {
                    context: { type: 'property', id, title: property.title ?? 'This property' },
                    prompt: `Tell me about this property: ${property.title ?? ''} ${locationParts ? `in ${locationParts}` : ''}`.trim(),
                  },
                })}
              >
                <Bot className="h-4 w-4 shrink-0" /> Ask Homatch AI
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2 border-border justify-start"
                onClick={() => navigate('/ai', {
                  state: {
                    context: { type: 'property', id, title: property.title ?? 'This property' },
                    prompt: `Find the same property cheaper: ${property.title ?? ''} ${facts?.total_price ? `listed at ${Number(facts.total_price).toLocaleString()} ${facts.currency ?? ''}` : ''}`.trim(),
                  },
                })}
              >
                <TrendingDown className="h-4 w-4 shrink-0 text-primary" /> Find Better Deal
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2 border-border justify-start"
                onClick={() => navigate('/verify', {
                  state: { query: property.title ?? locationParts, tab: 'property' },
                })}
              >
                <Shield className="h-4 w-4 shrink-0 text-primary" /> Verify Property
              </Button>
            </div>

            {/* Campaign Controls */}
            {homatchUser && id && (
              <CampaignPanel
                propertyId={id}
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
