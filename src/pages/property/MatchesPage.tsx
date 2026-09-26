import {AlertCircle,
  BedDouble, Bot, CalendarDays,ChevronRight, Clock, DollarSign,ExternalLink, Globe, Loader2, Lock, MapPin, 
  Check, MessageSquare, Pause, Play, Unlock, User, 
  Zap, 
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CampaignLaunchPanel } from '@/components/campaign/CampaignLaunchPanel';
import { LanguageCoveragePanel } from '@/components/campaign/LanguageCoveragePanel';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CommunityOutreachPanel } from '@/components/matching/CommunityOutreachPanel';
import { ExternalContactUnlockModal } from '@/components/matching/ExternalContactUnlockModal';
import { ExternalSitesCard } from '@/components/matching/ExternalSitesCard';
import { MatchingJobProgress } from '@/components/matching/MatchingJobProgress';
import {
  AlertDialog, AlertDialogAction,AlertDialogCancel, AlertDialogContent, 
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,DialogHeader, DialogTitle, 
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatRange, rangeShape } from '@/lib/rangeSemantics';
import {
  type CampaignSearchLanguageChoice,getCampaignLanguageState,
  getCreditAccount, getMatchCounts, 
  getMatches, 
  getUnlockedMatch, markMatchPreviewed,nextMatchesCursor, pauseMatchingCampaign,startMatchingCampaign, unlockMatch, 
} from '@/services/api';
import type { CreditAccount, Match, MatchUnlock } from '@/types/types';

// ── CONSTANTS ─────────────────────────────────────────────────

// Presentation labels are localized via `labelKey` at render time; the
// object's own keys (EXCEPTIONAL, VERY_STRONG, …) are the stable machine
// enum values used for lookups and never change with language.
const STRENGTH_CONFIG = {
  EXCEPTIONAL:  { labelKey: 'matches_strength_exceptional',  color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30', bars: 5 },
  VERY_STRONG:  { labelKey: 'matches_strength_very_strong',  color: 'text-primary',    bg: 'bg-primary/10 border-primary/30',       bars: 4 },
  STRONG:       { labelKey: 'matches_strength_strong',        color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/30',   bars: 3 },
  GOOD:         { labelKey: 'matches_strength_good',          color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30',     bars: 2 },
  POTENTIAL:    { labelKey: 'matches_strength_potential',     color: 'text-muted-foreground', bg: 'bg-secondary border-border',      bars: 1 },
} as const;

const PLATFORM_ICONS: Record<string, string> = {
  TELEGRAM: '✈',
  FACEBOOK: 'f',
  INSTAGRAM: '◎',
  VK: 'vk',
  GOOGLE: 'G',
  BING: 'B',
  FORUM: '♠',
  WEBSITE: '⊕',
  OTHER: '·',
};

/**
 * What the freshness contract concluded, said in customer language.
 *
 * matches.evidence_freshness is written by run-matching-v2 from the seven-day
 * rule: NEW_UNVERIFIED for a first sighting inside its window,
 * NEEDS_REVALIDATION for one past it, FRESH for one re-read conclusively, and
 * UNVERIFIABLE where the attempt failed. All four are OUR words.
 *
 * An unrecognised or absent value returns null and the badge is not rendered.
 * The 72 matches created before this column existed carry null, and inventing
 * a status for them -- or defaulting them to "verified" -- would be a
 * freshness claim with nothing behind it.
 */
function freshnessLabel(
  t: (key: string) => string,
  freshness: string | null | undefined,
): string | null {
  switch (freshness) {
    case 'NEW_UNVERIFIED': return t('matches_freshness_new');
    case 'NEEDS_REVALIDATION': return t('matches_freshness_rechecking');
    case 'FRESH': return t('matches_freshness_verified');
    case 'UNVERIFIABLE': return t('matches_freshness_unconfirmed');
    default: return null;
  }
}

function StrengthBars({ strength }: { strength: keyof typeof STRENGTH_CONFIG }) {
  const cfg = STRENGTH_CONFIG[strength];
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={`w-1 rounded-sm transition-all ${i <= cfg.bars ? cfg.color.replace('text-', 'bg-') : 'bg-muted-foreground/20'}`}
          style={{ height: `${6 + i * 2}px` }}
        />
      ))}
    </div>
  );
}

/**
 * A budget, said honestly.
 *
 * The old line coerced both bounds with `?? 0` and joined them with a dash,
 * so a buyer who gave a floor and no ceiling was rendered as USD60,000-0 --
 * a range running downwards to nothing. rangeShape() decides what the two
 * bounds actually describe and this supplies the currency and the words.
 */
function useMoney() {
  const { t } = useLanguage();
  return (
    min: number | null | undefined,
    max: number | null | undefined,
    currency?: string | null,
  ) => {
    const unit = currency ?? '$';
    return formatRange(
      rangeShape(min, max),
      (n) => `${unit}${n.toLocaleString()}`,
      {
        from: (v) => t('range_from', { value: v }),
        upTo: (v) => t('range_up_to', { value: v }),
        unknown: () => t('range_unknown'),
      },
    );
  };
}
function LockedMatchCard({
  match,
  onUnlock,
  unlocking,
  onAskAI,
  onChat,
  onRequestViewing,
}: {
  match: Match;
  onUnlock: (m: Match) => void;
  unlocking: boolean;
  onAskAI: (m: Match) => void;
  onChat: (m: Match) => void;
  onRequestViewing: (m: Match) => void;
}) {
  const { t } = useLanguage();
  const money = useMoney();
  const cfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;
  /*
   * Already paid for by the campaign that found it.
   *
   * Read from the reservation id rather than from a price of zero. A zero
   * price can also mean "we have not worked out what this costs", and the two
   * must not render the same way -- the whole reason pricing_state exists one
   * layer down.
   */
  /*
   * PAID FOR IS PAID FOR, whichever way the search was funded.
   *
   * This tested the reservation alone. A reservation exists for a PAYG run;
   * an INCLUDED run -- the search a customer's plan already covers -- carries
   * an allowance instead. So the first search of every month on the FREE
   * plan, which is the included one, produced results this screen blurred and
   * offered to sell for 35 credits.
   */
  const included = (
    Boolean(match.unlock_included_reservation_id)
    || Boolean(match.unlock_included_allowance_id)
  ) && match.status !== 'UNLOCKED';
  const platformIcon = PLATFORM_ICONS[match.preview_platform ?? 'OTHER'] ?? '·';
  const budgetStr =
    /* An absent bound is not zero: see src/lib/rangeSemantics.ts. This
       rendered USD60,000–0 for a buyer who stated no ceiling. */
    rangeShape(match.preview_budget_min, match.preview_budget_max).kind !== 'unknown'
      ? money(match.preview_budget_min, match.preview_budget_max, match.preview_currency)
      : null;

  return (
    <div className={`rounded-xl border ${cfg.bg} p-4 space-y-3`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <StrengthBars strength={match.signal_strength} />
          <span className={`text-xs font-semibold ${cfg.color}`}>{t(cfg.labelKey)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {match.status === 'NEW' && (
            <span className="text-[13px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded">{t('matches_new_badge')}</span>
          )}
          {match.status === 'UNLOCKED' && (
            <span className="text-[13px] font-bold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30">{t('matches_unlocked_badge')}</span>
          )}
          {included && (
            <span className="text-[13px] font-bold bg-green-500/10 text-green-400/90 px-1.5 py-0.5 rounded border border-green-500/20">{t('matches_included_badge')}</span>
          )}
          {/*
            HOW OLD THIS EVIDENCE IS, in the customer's words.
            matches.evidence_freshness has been stored since the seven-day
            rule was wired and never shown, so a search that returned fewer
            results because findings were awaiting re-checking looked simply
            thinner. freshnessLabel maps the enum; an unmapped or absent value
            renders nothing rather than guessing, and there is no percentage
            anywhere because no measured number backs one.
          */}
          {freshnessLabel(t, match.evidence_freshness) && (
            <span className="text-[13px] text-muted-foreground/70 px-1.5 py-0.5 rounded border border-border/60">
              {freshnessLabel(t, match.evidence_freshness)}
            </span>
          )}
        </div>
      </div>

      {/* Preview chips */}
      <div className="flex flex-wrap gap-2">
        {match.preview_platform && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {match.preview_platform}
          </span>
        )}
        {match.preview_language && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
            {match.preview_language.toUpperCase()}
          </span>
        )}
        {match.preview_city && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {match.preview_city}
          </span>
        )}
        {budgetStr && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {budgetStr}
          </span>
        )}
        {match.preview_bedrooms && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <BedDouble className="h-3 w-3" />
            {match.preview_bedrooms} {t('matches_bedrooms')}
          </span>
        )}
        {match.preview_recency && (
          <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {match.preview_recency}
          </span>
        )}
      </div>

      {/* Excerpt */}
      {match.preview_excerpt && (
        <div className="rounded-lg bg-background/50 border border-border/50 px-3 py-2">
          {/*
            * BLURRED ONLY WHEN SOMETHING IS ACTUALLY BEING SOLD.
            *
            * A match carrying unlock_included_reservation_id costs zero
            * credits to reveal, because the search that produced it was
            * already paid for. Blurring it anyway charges the customer a
            * second time in the only currency the interface has left:
            * making them ask for what they already bought.
            */}
          <p
            className={
              `text-xs text-muted-foreground italic line-clamp-2${
                included ? '' : ' blur-[1.5px] select-none'}`
            }
          >
            {match.preview_excerpt}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {included ? (
              <>
                <Check className="h-3 w-3 text-green-400/70" />
                <span className="text-[13px] text-muted-foreground/70">{t('matches_included_hint')}</span>
              </>
            ) : (
              <>
                <Lock className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[13px] text-muted-foreground/50">{t('matches_unlock_hint')}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mock badge — dev only */}
      {match.mock_mode && import.meta.env.DEV && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[13px] font-bold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-2 py-0.5 rounded-full">
            {t('matches_dev_signal')}
          </span>
        </div>
      )}

      {/* Score + Unlock CTA */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{t('matches_score')}</p>
            <p className={`text-sm font-semibold ${cfg.color}`}>{Math.round(match.match_score)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">{t('matches_confidence')}</p>
            <p className="text-sm font-semibold text-foreground">
              {Math.round((match.intent_confidence ?? 0) * 100)}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Ask AI why — always available */}
          <Button
            size="sm"
            variant="ghost"
            className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-primary"
            onClick={() => onAskAI(match)}
            title={t('matches_ask_ai_title')}
          >
            <Bot className="h-3 w-3" />
            <span className="hidden md:inline">{t('matches_why')}</span>
          </Button>
          {match.status !== 'UNLOCKED' ? (
            /*
             * "Unlock · 0.00 CR" was the old button on an included match: an
             * offer to sell something at no price, which reads as either a
             * mistake or a trick. It is not a purchase, so it does not get a
             * purchase's words -- it opens a result the campaign already
             * bought, and says so.
             *
             * The same handler runs. The RPC still charges zero, still writes
             * the match_unlocks row, and still returns the full signal; what
             * changes is what the customer is asked for.
             */
            <Button
              size="sm"
              className={
                included
                  ? 'bg-secondary text-foreground hover:bg-secondary/80 font-semibold h-8 px-4 text-xs gap-1.5'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-8 px-4 text-xs gap-1.5'
              }
              onClick={() => onUnlock(match)}
              disabled={unlocking}
            >
              {unlocking
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : included ? <Check className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              {included ? (
                <span>{t('matches_included_view_btn')}</span>
              ) : (
                <span dir="ltr">{t('matches_unlock_btn')} · {match.unlock_price_credits.toFixed(2)} CR</span>
              )}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onChat(match)}
                title={t('matches_chat_title')}
              >
                <MessageSquare className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_chat_btn')}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onRequestViewing(match)}
                title={t('matches_viewing_title')}
              >
                <CalendarDays className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_viewing_btn')}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1.5"
                onClick={() => onUnlock(match)}
              >
                <ChevronRight className="h-3 w-3" />
                <span className="hidden md:inline">{t('matches_details_btn')}</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UnlockedMatchDialog({
  match,
  unlock,
  onClose,
}: {
  match: Match;
  unlock: MatchUnlock;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const money = useMoney();
  const cfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-primary" />
            {t('matches_unlocked_dialog_title')}
          </DialogTitle>
          <DialogDescription>
            <span className={`font-medium ${cfg.color}`}>{t(cfg.labelKey)}</span>
            {' · '}{t('matches_score')}: {Math.round(match.match_score)}%
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Full signal text */}
          {unlock.full_signal_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_full_signal')}</p>
              <div className="rounded-lg bg-secondary/50 border border-border p-3">
                <p className="text-sm text-foreground whitespace-pre-wrap">{unlock.full_signal_text}</p>
              </div>
            </div>
          )}

          {/* Translation */}
          {unlock.full_intent_json?.translated_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_translation')}</p>
              <p className="text-sm text-muted-foreground italic">{unlock.full_intent_json.translated_text}</p>
            </div>
          )}

          {/* Intent details */}
          {unlock.full_intent_json && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_intent_details')}</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [t('matches_intent_label'), unlock.full_intent_json.intent_type],
                  [t('matches_city'), unlock.full_intent_json.city],
                  [t('matches_district_label'), unlock.full_intent_json.district],
                  [t('matches_transaction_label'), unlock.full_intent_json.transaction_type],
                  [t('matches_types_label'), unlock.full_intent_json.property_types?.join(', ')],
                  [t('matches_budget'), rangeShape(unlock.full_intent_json.budget_min, unlock.full_intent_json.budget_max).kind !== 'unknown'
                    ? money(unlock.full_intent_json.budget_min, unlock.full_intent_json.budget_max, unlock.full_intent_json.currency)
                    : null],
                  [t('matches_bedrooms'), unlock.full_intent_json.bedrooms_min != null
                    ? `${unlock.full_intent_json.bedrooms_min}+`
                    : null],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-secondary/30 px-3 py-2">
                    <p className="text-[13px] text-muted-foreground uppercase tracking-wide">{k}</p>
                    <p className="text-sm text-foreground font-medium">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match reasons */}
          {match.match_reasons?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_reasons')}</p>
              <div className="flex flex-wrap gap-1.5">
                {match.match_reasons.map((r, i) => (
                  <span key={i} className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            {unlock.full_source_url && (
              <Button
                variant="ghost"
                size="sm"
                className="border border-border gap-1.5 text-sm h-8"
                onClick={() => window.open(unlock.full_source_url!, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('matches_full_source')}
              </Button>
            )}
            {unlock.full_profile_url && (
              <Button
                variant="ghost"
                size="sm"
                className="border border-border gap-1.5 text-sm h-8"
                onClick={() => window.open(unlock.full_profile_url!, '_blank')}
              >
                <User className="h-3.5 w-3.5" />
                {t('matches_full_profile')}
              </Button>
            )}
          </div>

          <p className="text-[13px] text-muted-foreground/50">
            {t('matches_charged_credits', { credits: String(unlock.credits_charged) })} · {t('matches_unlocked_on', { date: new Date(unlock.created_at).toLocaleString() })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────

function MatchesContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const money = useMoney();
  const { id: propertyId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const MATCHES_PAGE_SIZE = 20;
  const [counts, setCounts] = useState({ total: 0, newCount: 0, strongCount: 0 });
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'strong' | 'unlocked'>('all');

  // Unlock flow
  const [pendingUnlock, setPendingUnlock] = useState<Match | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<{ msg: string; code?: string } | null>(null);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  // External contact unlock (Phase 3)
  const [externalUnlockMatch, setExternalUnlockMatch] = useState<Match | null>(null);

  // Reveal dialog
  const [revealMatch, setRevealMatch] = useState<{ match: Match; unlock: MatchUnlock } | null>(null);

  // Campaign
  const [campaignActive, setCampaignActive] = useState(false);
  /* The campaign's resolved search languages, so the coverage panel can
     name a language that has produced nothing yet rather than omitting it. */
  const [campaignLanguages, setCampaignLanguages] = useState<string[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  /* The search does not begin until the customer has said how much it
     may spend. Wallet balance is not campaign budget. */
  const [showBudget, setShowBudget] = useState(false);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!propertyId || !homatchUser) return;
    setLoading(true);
    const [matchData, countData, credits] = await Promise.all([
      getMatches(propertyId, undefined, MATCHES_PAGE_SIZE),
      getMatchCounts(propertyId),
      getCreditAccount(homatchUser.id),
    ]);
    setMatches(matchData);
    setCounts(countData);
    setCreditAccount(credits);
    // getMatches() caps a page at MATCHES_PAGE_SIZE — a full page means there's
    // likely more beyond it (confirmed or not by the next loadMore() call).
    setHasMore(matchData.length >= MATCHES_PAGE_SIZE);
    // Detect campaign status from match data
    setCampaignActive(matchData.some(m => m.status !== 'ARCHIVED'));
    /*
     * The campaign's own search-language configuration, read separately
     * because it is a FACT ABOUT THE CAMPAIGN and the matches are a fact
     * about its results. A campaign that has run in Hebrew and produced
     * nothing must still be able to say it ran in Hebrew.
     *
     * Best-effort: a campaign that predates search languages has no stored
     * set, and the panel renders nothing rather than inventing one.
     */
    getCampaignLanguageState(propertyId)
      .then((state) => setCampaignLanguages(state.resolved))
      .catch(() => setCampaignLanguages([]));
    setLoading(false);
  }, [propertyId, homatchUser]);

  useEffect(() => { loadData(); }, [loadData]);

  // getMatches() already supports cursor pagination (composite match_score +
  // created_at seek cursor — see nextMatchesCursor()), but nothing called it with
  // pagination args before, so any property with more than MATCHES_PAGE_SIZE
  // matches silently showed only its top page forever. This wires a real
  // "Load more" action on top of it.
  const loadMore = useCallback(async () => {
    if (!propertyId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const cursor = nextMatchesCursor(matches);
    if (!cursor) { setHasMore(false); setLoadingMore(false); return; }
    const nextPage = await getMatches(propertyId, cursor, MATCHES_PAGE_SIZE);
    setMatches(prev => {
      const seen = new Set(prev.map(m => m.id));
      return [...prev, ...nextPage.filter(m => !seen.has(m.id))];
    });
    setHasMore(nextPage.length >= MATCHES_PAGE_SIZE);
    setLoadingMore(false);
  }, [propertyId, matches, hasMore, loadingMore]);

  const filteredMatches = matches.filter(m => {
    if (filter === 'new') return m.status === 'NEW';
    if (filter === 'strong') return ['STRONG', 'VERY_STRONG', 'EXCEPTIONAL'].includes(m.signal_strength);
    if (filter === 'unlocked') return m.status === 'UNLOCKED';
    return m.status !== 'REJECTED';
  });

  const handleUnlockClick = async (match: Match) => {
    // External signals → Phase 3 ExternalContactUnlockModal
    if (match.is_external && !match.is_homatch_user) {
      setExternalUnlockMatch(match);
      return;
    }
    if (match.status === 'UNLOCKED') {
      // Load existing unlock and reveal
      const existing = await getUnlockedMatch(match.id);
      if (existing) {
        setRevealMatch({ match, unlock: existing });
      }
      return;
    }
    setPendingUnlock(match);
    setUnlockError(null);
    setShowUnlockConfirm(true);
    if (match.status === 'NEW') {
      // Reflect what the server actually recorded. Setting PREVIEWED locally
      // regardless is what hid the fact that the write never landed.
      const recorded = await markMatchPreviewed(match.id);
      if (recorded) {
        setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: recorded as Match['status'] } : m));
      }
    }
  };

  const handleConfirmUnlock = async () => {
    if (!pendingUnlock) return;
    setUnlockLoading(true);
    setUnlockError(null);

    const result = await unlockMatch(pendingUnlock.id);
    setUnlockLoading(false);

    if (!result.success) {
      setUnlockError({ msg: result.error ?? t('matches_unlock_failed'), code: result.errorCode });
      if (result.errorCode === 'INSUFFICIENT_CREDITS') {
        setShowUnlockConfirm(false);
      }
      return;
    }

    setShowUnlockConfirm(false);
    setMatches(prev => prev.map(m => m.id === pendingUnlock.id ? { ...m, status: 'UNLOCKED' } : m));
    if (result.newBalance !== undefined) {
      setCreditAccount(prev => prev ? { ...prev, balance: result.newBalance! } : prev);
    }
    toast.success(t('matches_toast_unlocked'));

    // Open reveal dialog
    if (result.unlock) {
      setRevealMatch({ match: { ...pendingUnlock, status: 'UNLOCKED' }, unlock: result.unlock });
    }
    setPendingUnlock(null);
  };

  // AI match explanation handler. The prompt text itself is sent to the AI
  // and shown in the chat UI, so it's built from translated fragments —
  // never hardcoded English — using the user's currently selected locale.
  const handleAskAI = useCallback((match: Match) => {
    const reasons = match.match_reasons?.join(', ') || t('matches_ai_reasons_fallback');
    const strengthCfg = STRENGTH_CONFIG[match.signal_strength] ?? STRENGTH_CONFIG.POTENTIAL;
    const strengthLabel = t(strengthCfg.labelKey);
    const cityPart = match.preview_city ? t('matches_ai_prompt_in_city', { city: match.preview_city }) : '';
    const budgetPart = rangeShape(match.preview_budget_min, match.preview_budget_max).kind !== 'unknown'
      ? t('matches_ai_prompt_with_budget', { budget: money(match.preview_budget_min, match.preview_budget_max, match.preview_currency) })
      : '';
    const platformPart = match.preview_platform ? t('matches_ai_prompt_from_platform', { platform: match.preview_platform }) : '';
    navigate('/ai', {
      state: {
        context: {
          type: 'match',
          data: {
            match_id: match.id,
            match_score: match.match_score,
            signal_strength: match.signal_strength,
            match_reasons: match.match_reasons,
            mismatch_reasons: match.mismatch_reasons,
            preview_city: match.preview_city,
            preview_budget_min: match.preview_budget_min,
            preview_budget_max: match.preview_budget_max,
            preview_currency: match.preview_currency,
            preview_language: match.preview_language,
            preview_platform: match.preview_platform,
            intent_confidence: match.intent_confidence,
          },
        },
        prompt: t('matches_ai_prompt_base', {
          score: String(Math.round(match.match_score)),
          strength: strengthLabel,
          extra: `${cityPart}${budgetPart}${platformPart}`,
          reasons,
          strengthLower: strengthLabel.toLowerCase(),
        }),
      },
    });
  }, [navigate, t]);

  // Start chat with unlocked match buyer
  const handleChat = useCallback((match: Match) => {
    navigate('/chat', {
      state: {
        prefill: {
          platform: match.preview_platform,
          matchId: match.id,
          propertyId,
          matchScore: match.match_score,
        },
      },
    });
  }, [navigate, propertyId]);

  // Request viewing from a match
  const handleRequestViewing = useCallback((match: Match) => {
    navigate('/viewings', {
      state: {
        openNew: true,
        preselectedPropertyId: propertyId,
        matchContext: { matchId: match.id, matchScore: match.match_score },
      },
    });
  }, [navigate, propertyId]);

  // Start matching campaign
  const handleStartMatching = async (
    authorizedMaxCredits: number | null,
    searchLanguages?: CampaignSearchLanguageChoice,
  ) => {
    if (!propertyId || !homatchUser) return;
    setShowBudget(false);
    setCampaignLoading(true);
    try {
      const result = await startMatchingCampaign(
        propertyId, homatchUser.id, authorizedMaxCredits, searchLanguages ?? null,
      );
      if (!result?.jobId) throw new Error('No job ID returned from match-campaign');
      setCampaignActive(true);
      setActiveJobId(result.jobId);
      toast.success(t('matches_campaign_started_toast'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matches_start_failed'));
    } finally {
      setCampaignLoading(false);
    }
  };

  const handlePauseMatching = async () => {
    if (!propertyId || !homatchUser) return;
    setCampaignLoading(true);
    try {
      await pauseMatchingCampaign(propertyId, homatchUser.id);
      setCampaignActive(false);
      setShowPauseConfirm(false);
      toast.success(t('matches_paused_toast'));
    } catch (err) {
      // Do not clear the active state on failure: the campaign is still
      // running and still spending credits, and the screen must say so.
      console.error(err);
      toast.error(t('matches_pause_error'));
    } finally {
      setCampaignLoading(false);
    }
  };

  const balance = Number(creditAccount?.balance ?? 0);
  const unlockPrice = pendingUnlock?.unlock_price_credits ?? 0;
  const balanceAfter = balance - unlockPrice;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('matches_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('matches_header_summary', { total: String(counts.total), new: String(counts.newCount), strong: String(counts.strongCount) })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Credits balance chip */}
            <button
              onClick={() => navigate('/credits')}
              className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1 hover:bg-primary/20 transition-colors"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">{balance.toFixed(2)} CR</span>
            </button>
            {/* Campaign toggle */}
            {campaignActive ? (
              <Button
                size="sm"
                variant="ghost"
                className="border border-border text-xs h-8 gap-1.5 text-muted-foreground"
                onClick={() => setShowPauseConfirm(true)}
                disabled={campaignLoading}
              >
                {campaignLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                <span className="hidden md:inline">{t('matches_pause_matching')}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8 gap-1.5 font-semibold"
                onClick={() => setShowBudget(true)}
                disabled={campaignLoading}
              >
                {campaignLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {t('matches_start_matching')}
              </Button>
            )}
          </div>
        </div>

        {/* Campaign status banner */}
        {campaignActive && (
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-primary font-medium">{t('matches_matching_active')}</span>
            <span className="text-xs text-muted-foreground ml-auto hidden md:block">{t('matches_start_desc')}</span>
          </div>
        )}

        {/*
          * WHICH LANGUAGES THIS CAMPAIGN IS SEARCHING IN, AND WHAT THEY
          * REACHED.
          *
          * Shown on the workspace rather than only in the launch dialog: a
          * customer who chose three languages a week ago should be able to
          * see which of them produced anything without opening a settings
          * screen. Counts only -- no percentage, because there is no honest
          * denominator for one.
          */}
        {campaignActive && propertyId && (
          <LanguageCoveragePanel
            propertyId={propertyId}
            resolvedLanguages={campaignLanguages}
          />
        )}

        {/* Live job progress panel */}
        {activeJobId && (
          <MatchingJobProgress
            jobId={activeJobId}
            propertyId={propertyId}
            onComplete={(job) => {
              if (job.matches_created > 0) {
                toast.success(t('matches_job_complete_toast', { count: String(job.matches_created) }));
                loadData();
              } else if (job.status === 'partially_completed') {
                toast.warning(t('matches_job_partial_toast'));
              }
            }}
          />
        )}

        {/* Filters */}
        <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="all">{t('matches_filter_all')} ({counts.total})</TabsTrigger>
            <TabsTrigger value="new">{t('matches_filter_new')} ({counts.newCount})</TabsTrigger>
            <TabsTrigger value="strong">{t('matches_filter_strong')} ({counts.strongCount})</TabsTrigger>
            <TabsTrigger value="unlocked">{t('matches_filter_unlocked')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Surface relevant communities to post the property in, with AI-drafted, translated post copy */}
        {propertyId && <CommunityOutreachPanel propertyId={propertyId} />}

        {/* Broaden the search: outbound links to major Georgian real-estate sites */}
        <ExternalSitesCard propertyId={propertyId} />

        {/* Match list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredMatches.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{t('matches_empty')}</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">{t('matches_empty_desc')}</p>
              {!campaignActive && (
                <Button
                  className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => setShowBudget(true)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {t('matches_start_matching')}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredMatches.map(m => (
              <LockedMatchCard
                key={m.id}
                match={m}
                onUnlock={handleUnlockClick}
                unlocking={unlockLoading && pendingUnlock?.id === m.id}
                onAskAI={handleAskAI}
                onChat={handleChat}
                onRequestViewing={handleRequestViewing}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="border-border gap-2">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('matches_load_more')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unlock Confirmation Dialog */}
      {showUnlockConfirm && pendingUnlock && (
        <Dialog open onOpenChange={open => { if (!open) { setShowUnlockConfirm(false); setPendingUnlock(null); } }}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Unlock className="h-4 w-4 text-primary" />
                {t('matches_unlock_confirm')}
              </DialogTitle>
              <DialogDescription>
                {t('matches_unlock_confirm_desc').replace('{credits}', pendingUnlock.unlock_price_credits.toFixed(2))}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="rounded-lg bg-secondary/50 border border-border p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('matches_current_balance')}</span>
                  <span className="font-medium text-foreground" dir="ltr">{balance.toFixed(2)} CR</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('matches_unlock_price')}</span>
                  <span className="font-medium text-destructive" dir="ltr">−{unlockPrice.toFixed(2)} CR</span>
                </div>
                <div className="border-t border-border pt-1.5 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('credits_balance_after')}</span>
                  <span className={`font-semibold ${balanceAfter < 0 ? 'text-destructive' : 'text-foreground'}`} dir="ltr">
                    {balanceAfter.toFixed(2)} CR
                  </span>
                </div>
              </div>
              {unlockError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{unlockError.msg}</p>
                </div>
              )}
              {balanceAfter < 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-destructive font-medium">{t('matches_insufficient_credits')}</p>
                    <p className="text-xs text-destructive/80 mt-0.5">
                      {t('matches_insufficient_desc')
                        .replace('{required}', unlockPrice.toFixed(2))}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                className="border border-border"
                onClick={() => { setShowUnlockConfirm(false); setPendingUnlock(null); }}
              >
                {t('general_cancel')}
              </Button>
              {balanceAfter < 0 ? (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => navigate('/credits')}
                >
                  <Zap className="h-4 w-4 mr-1.5" />
                  {t('matches_topup_btn')}
                </Button>
              ) : (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirmUnlock}
                  disabled={unlockLoading}
                >
                  {unlockLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Unlock className="h-4 w-4 mr-1.5" />
                  )}
                  <span dir="ltr">{t('matches_confirm_unlock_btn', { price: unlockPrice.toFixed(2) })}</span>
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Unlocked reveal dialog */}
      {revealMatch && (
        <UnlockedMatchDialog
          match={revealMatch.match}
          unlock={revealMatch.unlock}
          onClose={() => setRevealMatch(null)}
        />
      )}

      {/* External contact unlock modal (Phase 3) */}
      {externalUnlockMatch && (
        <ExternalContactUnlockModal
          open={true}
          matchId={externalUnlockMatch.id}
          creditBalance={Number(creditAccount?.balance ?? 0)}
          onClose={() => setExternalUnlockMatch(null)}
          onUnlocked={() => {
            setMatches(prev =>
              prev.map(m => m.id === externalUnlockMatch!.id ? { ...m, status: 'UNLOCKED' } : m)
            );
            setExternalUnlockMatch(null);
            toast.success(t('matches_toast_contact_unlocked'));
          }}
        />
      )}

      {/* Pause confirm */}
      {/*
        AUTHORISING THE SPEND, BEFORE ANYTHING IS SPENT.

        SearchBudgetOffer decides what to show: an included run needs no
        authorisation, a balance below the minimum viable budget is sent to
        top up rather than allowed to waste its last credits, and otherwise
        the customer picks the ceiling from the configured ladder. The figure
        it hands back is what becomes authorized_max_credits.
      */}
      <Dialog open={showBudget} onOpenChange={setShowBudget}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('matches_start_matching')}</DialogTitle>
            <DialogDescription className="sr-only">{t('budget_choose_title')}</DialogDescription>
          </DialogHeader>
          <CampaignLaunchPanel
            propertyId={propertyId ?? ''}
            productCode="FIND_CLIENTS"
            onRun={(authorized, languages) => void handleStartMatching(authorized, languages)}
            running={campaignLoading}
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
            <AlertDialogAction onClick={handlePauseMatching} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('matches_pause_campaign_btn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function MatchesPage() {
  return (
    <RouteGuard>
      <MatchesContent />
    </RouteGuard>
  );
}
