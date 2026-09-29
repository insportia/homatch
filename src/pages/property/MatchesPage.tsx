import {
  AlertCircle, Bot, CalendarDays, Check, ExternalLink, Loader2, MessageSquare,
  Eye, Pause, Play, Search, User, Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NativeMatchesPanel } from '@/components/matching/NativeMatchesPanel';
import { toast } from 'sonner';
import type { DiscoveryHeadroom } from '@/campaign/searchExpansion';
import { CampaignLaunchPanel } from '@/components/campaign/CampaignLaunchPanel';
import { DeeperSearchPanel } from '@/components/campaign/DeeperSearchPanel';
import { LanguageCoveragePanel } from '@/components/campaign/LanguageCoveragePanel';
import { RouteGuard } from '@/components/common/RouteGuard';
import { OpportunityCard, OverflowGlyph } from '@/components/customer/OpportunityCard';
import {CustomerSurface,
  DISCOVERY_SURFACE, EmptyState, FilterRail, PageHero, QuietAction,
} from '@/components/customer/surface';
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { FEATURES } from '@/config/features';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { placeName } from '@/lib/placeNames';
import { formatRange, rangeShape } from '@/lib/rangeSemantics';
import {
  type Counterpart, counterpartFor, fitTier, headlineKey, matchFacets,
  reasonKey, recencyParts,
} from '@/matching/presentation';
import {
  type CampaignSearchLanguageChoice,getCampaignLanguageState,
  getCreditAccount, 
  getLastSettledSweep,getMatchCounts, 
  getMatches, 
  getUnlockedMatch, markMatchPreviewed,nextMatchesCursor, pauseMatchingCampaign,startMatchingCampaign, unlockMatch, 
  campaignStartErrorKey,
} from '@/services/api';
import { readProperty } from '@/services/propertyManagement';
import type { CreditAccount, Match, MatchUnlock, Property, PropertyFacts } from '@/types/types';
import { isHistoryMatch } from '@/matching/currentDemand';

// ── CONSTANTS ─────────────────────────────────────────────────

/*
 * THE INTERNAL GRADE, AND THE ONE THING IT IS STILL USED FOR.
 *
 * This object used to carry a colour, a background tint and a bar count per grade, and
 * the card took its SURFACE COLOUR from the grade: pale yellow for EXCEPTIONAL, blue for
 * GOOD, green for STRONG. Five grades, five coloured cards, and a list of opportunities
 * read as a status board — the loudest thing on the screen was an internal enum.
 *
 * What survives is `labelKey`, and only because the AI prompt names the grade when it
 * explains a match. The CUSTOMER-FACING word now comes from fitTier() in
 * src/matching/presentation.ts, which collapses these five onto three, and a card's
 * surface is the same neutral card as every other card in the product.
 *
 * The object's own keys are the stable machine enum values and never change with
 * language.
 */
const STRENGTH_CONFIG = {
  EXCEPTIONAL:  { labelKey: 'matches_strength_exceptional' },
  VERY_STRONG:  { labelKey: 'matches_strength_very_strong' },
  STRONG:       { labelKey: 'matches_strength_strong' },
  GOOD:         { labelKey: 'matches_strength_good' },
  POTENTIAL:    { labelKey: 'matches_strength_potential' },
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

/**
 * A budget, said honestly.
 *
 * The old line coerced both bounds with `?? 0` and joined them with a dash,
 * so a buyer who gave a floor and no ceiling was rendered as USD60,000-0 --
 * a range running downwards to nothing. rangeShape() decides what the two
 * bounds actually describe and this supplies the currency and the words.
 */
function useMoney() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  return (
    min: number | null | undefined,
    max: number | null | undefined,
    currency?: string | null,
  ) => {
    /*
     * THE FORMATTING LAYER, NOT A STRING HACK IN THE CARD.
     *
     * This built a price by gluing the currency COLUMN onto a locale-formatted number:
     * `${currency}${n.toLocaleString()}` with currency = 'USD' produced "USD220,000", and
     * "USD60,000-მდე" on a Georgian card. A currency code is not a symbol and it does not
     * go in front of the digits in every language.
     *
     * formatMoney() is the formatter the approved workspaces use. It knows where the
     * symbol goes per locale, and narrowSymbol asks for "$" instead of "US$".
     */
    const money = (value: number) => formatMoney(value, currency ?? 'USD', locale, {
      decimals: 0,
      narrowSymbol: true,
    });
    return formatRange(
      rangeShape(min, max),
      money,
      {
        from: (v) => t('range_from', { value: v }),
        upTo: (v) => t('range_up_to', { value: v }),
        unknown: () => t('range_unknown'),
      },
    );
  };
}
/*
 * MatchCard USED TO BE HERE, AND IT IS GONE RATHER THAN EDITED.
 *
 * Three redesigns rearranged its children and produced the same screenshot each time,
 * because its appearance was never coming from its children. It composed shadcn's Card,
 * Badge and Button, and on the root light palette those resolve to a white rounded
 * rectangle, grey capsules and a black filled button — see the root-cause note at the top
 * of src/components/customer/surface.tsx.
 *
 * Its replacement is <OpportunityCard>, which imports none of those three and renders on
 * the same scoped token block the approved Investment and Mortgage surfaces use.
 */

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
  /*
   * THE DIALOG'S SUBTITLE IS A WORD, NOT A FIGURE.
   *
   * It read "Strong · Score: 87%" in the product's own primary colour, which put a raw
   * confidence number at the top of the one screen a customer has just paid to see. The
   * score is real and it is still on the card, inside "Why this match?" — one control
   * away, next to the platform and the language it belongs with.
   */
  const tier = fitTier(match.signal_strength);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            {t('matches_unlocked_dialog_title')}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{t(`match_fit_${tier.toLowerCase()}`)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Full signal text */}
          {unlock.full_signal_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_full_signal')}</p>
              <div className="rounded-lg bg-secondary/50 border border-border p-3">
                {/* The person's own words, in their own language and therefore their own direction. */}
                <p dir="auto" className="text-sm text-foreground whitespace-pre-wrap break-words">{unlock.full_signal_text}</p>
              </div>
            </div>
          )}

          {/* Translation */}
          {unlock.full_intent_json?.translated_text && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_translation')}</p>
              <p dir="auto" className="text-sm text-muted-foreground italic break-words">{unlock.full_intent_json.translated_text}</p>
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

          {/*
            THE SAME TRANSLATION THE CARD DOES, ON THE SCREEN SOMEBODY PAID TO REACH.
            These are matcher literals from a closed set of sixteen, written in English by
            run-matching-v2 and stored on the row. The card learned to say them in the
            reader's language; leaving this dialog in English would mean the free preview
            spoke Georgian and the paid result did not.
          */}
          {match.match_reasons?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('matches_reasons')}</p>
              <div className="flex flex-wrap gap-1.5">
                {match.match_reasons.map((reason, index) => {
                  const key = reasonKey(reason);
                  return (
                    <span
                      key={`${reason}-${index}`}
                      className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-full max-w-full"
                    >
                      <span className="break-words">{key ? t(key) : reason}</span>
                    </span>
                  );
                })}
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
  const { t, lang } = useLanguage();
  const money = useMoney();
  const { id: propertyId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const MATCHES_PAGE_SIZE = 20;
  const [counts, setCounts] = useState({ total: 0, newCount: 0, strongCount: 0 });
  /*
   * THE PROPERTY, BECAUSE THE PAGE COULD NOT NAME WHAT IT WAS ABOUT.
   *
   * This screen is reached per property and held only the property's ID: its heading said
   * "Matches" and its cards said "87%". Two things need the property itself — the
   * counterpart word (a rental has no buyers, so a card must say TENANT) and a heading
   * that names the asset these people are interested in.
   *
   * Best-effort and separate from the Promise.all: readProperty throws on a REST error
   * and the matches are the page. A property that fails to load costs the heading its
   * subtitle and the cards their specific noun — headlineKey() then returns the generic
   * key, which is true of every match — and nothing else.
   */
  const [property, setProperty] = useState<Property | null>(null);
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [filter, setFilter] = useState<'all' | 'new' | 'strong'>('all');

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
  /** The last settled sweep, for the Expand Search offer. */
  const [lastSweep, setLastSweep] = useState<{
    id: string;
    status: string;
    campaign_id: string | null;
    discovery_headroom: DiscoveryHeadroom | null;
  } | null>(null);

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

    /* The asset these people are interested in, for the heading and for the word the
       cards use to name a person. */
    readProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));

    /*
     * WHAT THE LAST SEARCH DID NOT REACH.
     *
     * The most recent SETTLED sweep, because a running one has not finished
     * deciding what it read and offering to extend it would sell a source it was
     * about to read anyway. `discovery_headroom` is the customer-facing column
     * and is the only one selected here: sources_read is the internal receipt and
     * the screen has no business holding adapter ids.
     *
     * Best-effort. A campaign whose sweeps predate the column has no headroom,
     * and DeeperSearchPanel renders nothing rather than guessing — which is why
     * "we recorded nothing" and "there is nothing left" are two different states
     * in that component and not one.
     */
    getLastSettledSweep(propertyId)
      .then(setLastSweep)
      .catch(() => setLastSweep(null));

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
    return m.status !== 'REJECTED';
  });

  /*
   * CURRENT DEMAND vs HISTORY -- the 30-day active-demand rule, applied where
   * matches are shown. A match made when the person's post was current does
   * not stay "current" forever: once the post is older than the window (or
   * has no readable date) it moves to an earlier section, is never presented
   * as someone looking now, and cannot be opened for a price (atomic-unlock
   * refuses it with DEMAND_NOT_CURRENT). Contacts already opened stay usable.
   *
   * A row read before the migration has no demand_published_at key at all;
   * that is "not known yet", not "undated", so it keeps today's behaviour.
   */
  const isHistory = (m: Match) => isHistoryMatch(m);
  const currentMatches = filteredMatches.filter((m) => !isHistory(m));
  const historyMatches = filteredMatches.filter(isHistory);
  const [showHistory, setShowHistory] = useState(false);

  const renderMatchCard = (match: Match, history: boolean) => {
                  const tier = fitTier(match.signal_strength);
                  const included = (
                    Boolean(match.unlock_included_reservation_id)
                    || Boolean(match.unlock_included_allowance_id)
                  ) && match.status !== 'UNLOCKED';
                  const opened = match.status === 'UNLOCKED';
                  const forSale = !included && !opened;
                  const parsed = recencyParts(match.preview_recency);
                  const budgetStr = rangeShape(match.preview_budget_min, match.preview_budget_max).kind !== 'unknown'
                    ? money(match.preview_budget_min, match.preview_budget_max, match.preview_currency)
                    : null;
                  const headline = headlineKey(counterpart);
                  return (
                    <OpportunityCard
                      key={match.id}
                      strengthTier={tier}
                      strengthLabel={t(`match_fit_${tier.toLowerCase()}`)}
                      headline={t(headline)}
                      freshness={parsed ? t(parsed.key, { count: String(parsed.count) }) : match.preview_recency}
                      /*
                       * "UNLOCKED" WAS NOT A FACT ABOUT THE RESULT. It described the
                       * customer's purchase history and it only made sense inside the
                       * lock model. What is useful is whether they already have the
                       * contact details, which is the same row in the database said as a
                       * thing about the opportunity rather than about a transaction.
                       */
                      state={
                        history
                          ? { label: t('matches_history_badge', { days: '30' }), tone: 'owned' }
                          : match.status === 'NEW'
                          ? { label: t('matches_new_badge'), tone: 'new' }
                          : opened
                            ? { label: t('match_state_contacted'), tone: 'owned' }
                            : included
                              ? { label: t('matches_included_badge'), tone: 'owned' }
                              : null
                      }
                      /* The city and the rooms are facts, and they live here now rather
                         than inside a sentence that also claimed who somebody was. */
                      facts={{
                        /* In the reader's script. A quoted post stays in its own language;
                           a city name is a place the reader's language has a word for. */
                        city: placeName(match.preview_city, lang),
                        budget: budgetStr,
                        bedrooms: match.preview_bedrooms,
                        propertyType: propertyTypeLabel,
                      }}
                      whyLine={whyLineFor(match)}
                      excerpt={match.preview_excerpt}
                      excerptLabel={t('match_original_post')}
                      excerptObscured={forSale}
                      /*
                       * ONE ACTION, THE SAME ON EVERY CARD.
                       *
                       * It used to read "Unlock · 4.50 CR" on some cards and "View" on
                       * others, so the list sorted itself visually into things you owned
                       * and things you did not — a shop window rather than a set of
                       * opportunities.
                       *
                       * The price did not disappear; it moved to where a price belongs.
                       * handleUnlockClick opens the detail flow, and for a result nothing
                       * has paid for that flow shows the price, the balance and what the
                       * balance becomes, and waits for a confirmation. Nothing is charged
                       * by pressing this.
                       */
                      actionLabel={t('match_view_btn')}
                      onAction={() => (history
                        ? toast.info(t('matches_history_body', { days: '30' }))
                        : handleUnlockClick(match))}
                      actionBusy={unlockLoading && pendingUnlock?.id === match.id}
                      overflow={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={t('match_more_btn')}>
                              <OverflowGlyph />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-w-[min(18rem,calc(100vw-2rem))]">
                            <DropdownMenuItem className="gap-2" onClick={() => handleAskAI(match)}>
                              <Bot className="h-4 w-4 shrink-0" />
                              <span className="break-words">{t('matches_ask_ai_title')}</span>
                            </DropdownMenuItem>
                            {opened && (
                              <>
                                <DropdownMenuItem className="gap-2" onClick={() => handleChat(match)}>
                                  <MessageSquare className="h-4 w-4 shrink-0" />
                                  <span className="break-words">{t('matches_chat_btn')}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2" onClick={() => handleRequestViewing(match)}>
                                  <CalendarDays className="h-4 w-4 shrink-0" />
                                  <span className="break-words">{t('matches_viewing_btn')}</span>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  );
  };
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

    /*
     * ALREADY PAID FOR BY THE CAMPAIGN: OPEN IT, DO NOT ASK TO SELL IT.
     *
     * The confirmation dialog exists to authorise a purchase — it shows the balance, the
     * price and what the balance becomes. Putting an included result through it would
     * show "0.00 CR" and ask somebody to confirm buying something they already own, which
     * is the second charge in the only currency an interface has.
     *
     * The RPC is still called, still writes the match_unlocks row and still charges zero;
     * what is skipped is the sale. If it fails, the customer is told, because a result
     * that will not open is a fact and not something to swallow.
     */
    const included = Boolean(match.unlock_included_reservation_id)
      || Boolean(match.unlock_included_allowance_id);
    if (included) {
      setUnlockLoading(true);
      const result = await unlockMatch(match.id);
      setUnlockLoading(false);
      if (!result.success) {
        toast.error(result.errorCode === 'DEMAND_NOT_CURRENT'
          ? t('matches_history_body', { days: '30' })
          : (result.error ?? t('matches_unlock_failed')));
        return;
      }
      setMatches(prev => prev.map(m => m.id === match.id ? { ...m, status: 'UNLOCKED' } : m));
      if (result.unlock) {
        setRevealMatch({ match: { ...match, status: 'UNLOCKED' }, unlock: result.unlock });
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
      setUnlockError({
        msg: result.errorCode === 'DEMAND_NOT_CURRENT'
          ? t('matches_history_body', { days: '30' })
          : (result.error ?? t('matches_unlock_failed')),
        code: result.errorCode,
      });
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
    discoverBrokers?: boolean,
  ) => {
    if (!propertyId || !homatchUser) return;
    setShowBudget(false);
    setCampaignLoading(true);
    try {
      const result = await startMatchingCampaign(
        propertyId, homatchUser.id, authorizedMaxCredits, searchLanguages ?? null,
        discoverBrokers === true,
      );
      if (!result?.jobId) throw new Error('No job ID returned from match-campaign');
      setCampaignActive(true);
      setActiveJobId(result.jobId);
      toast.success(t('matches_campaign_started_toast'));
    } catch (e) {
      { const refused = campaignStartErrorKey(e); toast.error(refused ? t(refused.key, refused.vars) : t('matches_start_failed')); }
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

  /*
   * WHO THESE PEOPLE ARE, IN ONE PLACE.
   *
   * SALE has buyers, RENT has tenants, INVESTMENT has investors, and a half-finished
   * import has none of the three — counterpartFor() returns null and every key below
   * falls back to a form that is true of any property. One derivation, read by the
   * heading, the primary action, the empty state and every card, so the screen cannot
   * call the same person a buyer in one place and a tenant in another.
   */
  const counterpart = counterpartFor(property?.transaction_type);
  const slug = counterpart ? counterpart.toLowerCase() : null;
  const titleKey = slug ? `matches_title_${slug}` : 'matches_title';
  const discoverKey = slug ? `matches_find_${slug}` : 'matches_start_matching';
  /* What the list is about: the owner's own title, else the address they entered, else
     the city. Their own property, so there is no visibility rule to apply here. */
  const propertyLabel = property?.title
    || property?.facts?.address
    || property?.facts?.city
    || null;

  /*
   * PostgREST returns an embedded relation as an object or a single-element array
   * depending on how it reads the relationship, and `facts:property_facts(*)` produces the
   * array. Typed as the object, so the cast is where the two shapes meet rather than a
   * `any` sprinkled at the use site.
   */
  const facts = (() => {
    const embedded = property?.facts as PropertyFacts | PropertyFacts[] | undefined;
    return Array.isArray(embedded) ? embedded[0] : embedded;
  })();
  /* The same two fixes the cards got. The rail built its own line and kept rendering
     "Tbilisi · USD213,840" next to cards reading "თბილისი · $220,000". */
  const railFacts = [
    placeName(facts?.city, lang),
    facts?.total_price
      ? formatMoney(Number(facts.total_price), facts.currency ?? 'USD', intlLocaleFor(lang), {
        decimals: 0,
        narrowSymbol: true,
      })
      : null,
    facts?.bedrooms ? `${facts.bedrooms} ${t('matches_bedrooms')}` : null,
  ].filter(Boolean) as string[];

  /*
   * ONE SENTENCE SAYING WHAT AGREED, built from the facets the matcher recorded.
   *
   * "Matches on 5 points" told a reader how much agreement there was and nothing about
   * what agreed, which is the half that decides whether to open a lead. matchFacets()
   * collapses eleven literals onto six nouns and dedupes them, so country + city +
   * district reads as "location" once rather than three times.
   */
  const whyLineFor = (match: Match): string | null => {
    /* Three at most. Six nouns is a checklist again, and it wrapped to three lines in
       Georgian — the facets are ordered by how much they decide, so the first three are
       the three worth reading. */
    const facets = matchFacets(match.match_reasons).slice(0, 3);
    if (!facets.length) return null;
    return t('match_why_line', { facets: facets.map((key) => t(key)).join(', ') });
  };

  /* prop_type_*, which is the key family that exists — property_type_* does not, and a
     t() miss renders the key itself into the card. */
  const propertyTypeLabel = property?.property_type
    ? t(`prop_type_${String(property.property_type).toLowerCase()}`)
    : null;

  /*
   * THREE FILTERS, NOT FOUR. "Unlocked" existed only because the product used to present
   * every result as a locked thing, so "the ones I have paid for" was a state worth
   * filtering by. It is not a useful description of a RESULT — it describes the
   * customer's billing history — and with the lock model gone it is legacy clutter.
   *
   * The status is still recorded, still queryable and still in the ledger. It is simply
   * not a customer-facing way to sort opportunities.
   */
  const filters = [
    { value: 'all' as const, label: t('matches_filter_all'), count: counts.total },
    { value: 'new' as const, label: t('matches_filter_new'), count: counts.newCount },
    { value: 'strong' as const, label: t('matches_filter_strong'), count: counts.strongCount },
  ];

  /*
   * THE CAMPAIGN CONTROLS ARE NO LONGER THE HEADER.
   *
   * "Pause matching" was a full-weight outlined button at the top right of a page about
   * results, and it is the deferred Active Search concept wearing a different label: it
   * asks the customer to hold a mode in their head before they have read anything. It is
   * NOT removed, because stopping something that spends money must stay reachable — it
   * moves into the search module beside the results, where the campaign is the subject.
   */
  /*
   * A JOB IS RUNNING, AS OPPOSED TO A MODE BEING ON.
   *
   * `campaignActive` is `matchData.some(m => m.status !== 'ARCHIVED')` — the existence of
   * any non-archived match — so it is true for every property that has ever matched
   * anything, and a page keyed off it reports a search running that finished weeks ago.
   * `activeJobId` comes from a job this session started or found, which is the only thing
   * that makes "stop" a meaningful offer.
   */
  const jobRunning = Boolean(activeJobId);

  const searchModule = (
    <div className="hm-discovery-panel p-3.5">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-foreground">
        {t('matches_search_module')}
      </p>
      <p className="mb-2.5 text-2xs leading-snug text-muted-foreground">
        {t('matches_search_what')}
      </p>
      <QuietAction
        full
        icon={Play}
        busy={campaignLoading}
        disabled={campaignLoading}
        onClick={() => setShowBudget(true)}
        label={t(discoverKey)}
      />
      {/*
        THE STOP, WHERE STOPPING MEANS SOMETHING.
        Not a page-level status control and not keyed off a mode — it appears while a job
        is genuinely running, and disappears when it is not. pauseMatchingCampaign and the
        campaign engine behind it are untouched.
      */}
      {jobRunning && (
        <div className="mt-2">
          <QuietAction
            full
            icon={Pause}
            busy={campaignLoading}
            disabled={campaignLoading}
            onClick={() => setShowPauseConfirm(true)}
            label={t('matches_pause_matching')}
          />
        </div>
      )}
    </div>
  );

  return (
    /*
     * noPadding, so the canvas reaches the edges. AppLayout pads its children by default
     * and a premium surface inside that padding is a rectangle floating in the old
     * palette — the same failure the page is being rebuilt to remove.
     */
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface>
        {/* ── HEADER: two lines, not a hero ──────────────────────────────
          What this replaces cost ~210px before the first result on a 390px phone: a title
          line, a property line, a counts line, a full-width button and a tab rail. The
          property is now the eyebrow, the counts are a 13px suffix, and the campaign
          control has left the header entirely. */}
        {/* The discovery product's navy identity band: which property, what
            this screen finds for it, how many. The results read on white. */}
        <div className="pt-4 sm:pt-5">
          <PageHero
            compact
            eyebrow={propertyLabel}
            title={t(titleKey)}
            subtitle={t('matches_count_line', {
              total: String(counts.total),
              new: String(counts.newCount),
            })}
          />
        </div>

        <FilterRail
          options={filters}
          value={filter}
          onChange={(next) => setFilter(next)}
          ariaLabel={t('matches_filter_all')}
        />

        {/* HOMATCH members whose requirements fit this property, or who asked about it.
            Two real accounts on both sides — the one kind of result that offers Message
            and Call. Renders nothing when there is nobody. */}
        {propertyId ? <NativeMatchesPanel propertyId={propertyId} role="OWNER" className="hm-discovery-panel" /> : null}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            {loading ? (
              <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="hm-discovery-panel h-[15rem] animate-pulse p-3.5" />
                ))}
              </div>
            ) : filteredMatches.length === 0 ? (
              <EmptyState
                icon={Search}
                title={t('matches_empty')}
                body={t('matches_empty_desc')}
              />
            ) : (
              /*
               * TWO COLUMNS FROM md, THREE FROM 2xl. A card is ~240px tall now, so a
               * 1080p screen shows nine at once where the rejected layout showed two.
               * On a phone it is one column of compact results, which is the point: the
               * reader should always see that another opportunity begins below.
               */
              <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                {currentMatches.map((match) => renderMatchCard(match, false))}
                {historyMatches.length > 0 && (
                  <div className="md:col-span-2 2xl:col-span-3">
                    <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-3.5 py-2.5 text-start text-sm text-muted-foreground hover:text-foreground">
                      <span>{t('matches_history_title', { count: String(historyMatches.length), days: '30' })}</span>
                      <span aria-hidden="true">{showHistory ? '−' : '+'}</span>
                    </button>
                    {showHistory && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('matches_history_body', { days: '30' })}</p>}
                  </div>
                )}
                {showHistory && historyMatches.map((match) => renderMatchCard(match, true))}
                {hasMore && (
                  <div className="md:col-span-2 2xl:col-span-3">
                    <QuietAction
                      full
                      busy={loadingMore}
                      disabled={loadingMore}
                      onClick={loadMore}
                      label={t('matches_load_more')}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── the rail: context and the campaign, never the header ──── */}
          <aside className="min-w-0 space-y-3">
            {property && (
              <div className="hm-discovery-panel p-3.5">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {t('matches_rail_property')}
                </p>
                <p className="font-display text-sm font-semibold leading-snug text-foreground">
                  {propertyLabel ?? t('matches_rail_untitled')}
                </p>
                {railFacts.length > 0 && (
                  <p className="mt-1 text-2xs text-muted-foreground">{railFacts.join(' · ')}</p>
                )}
                <div className="mt-2.5">
                  <QuietAction
                    full
                    onClick={() => navigate(`/property/${propertyId}`)}
                    label={t('matches_rail_open')}
                  />
                </div>
              </div>
            )}

            {searchModule}

            {activeJobId && (
              <MatchingJobProgress
                jobId={activeJobId}
                propertyId={propertyId}
                onComplete={(job) => {
                  if (job.matches_created > 0) {
                    toast.success(t('matches_job_complete_toast', { count: String(job.matches_created) }));
                    loadData();
                  } else if (job.status === 'partially_completed' || job.status === 'budget_reached') {
                    toast.warning(t('matches_job_partial_toast'));
                  }
                }}
              />
            )}

            {/* Expand Search: a PAYG continuation, explicitly preserved. Renders nothing
                when the last settled sweep recorded no headroom. */}
            {propertyId && lastSweep?.campaign_id && !activeJobId && (
              <DeeperSearchPanel
                propertyId={propertyId}
                campaignId={lastSweep.campaign_id}
                jobId={lastSweep.id}
                jobStatus={lastSweep.status}
                headroom={lastSweep.discovery_headroom}
                onStarted={(newJobId) => setActiveJobId(newJobId)}
              />
            )}

            {FEATURES.matchesCampaignOperatorControls && campaignActive && propertyId && (
              <LanguageCoveragePanel
                propertyId={propertyId}
                resolvedLanguages={campaignLanguages}
              />
            )}

            {FEATURES.matchesOutboundPublication && propertyId && (
              <CommunityOutreachPanel propertyId={propertyId} />
            )}
            {FEATURES.matchesOutboundPublication && (
              <ExternalSitesCard propertyId={propertyId} />
            )}
          </aside>
        </div>
      </CustomerSurface>

      {/* Unlock Confirmation Dialog */}
      {showUnlockConfirm && pendingUnlock && (
        <Dialog open onOpenChange={open => { if (!open) { setShowUnlockConfirm(false); setPendingUnlock(null); } }}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
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
                    <Eye className="h-4 w-4 mr-1.5" />
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
          included={Boolean(externalUnlockMatch.unlock_included_reservation_id)
            || Boolean(externalUnlockMatch.unlock_included_allowance_id)}
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
            onRun={(authorized, languages, discoverBrokers) => void handleStartMatching(authorized, languages, discoverBrokers)}
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
