import {
  AlertCircle, Bot, CalendarDays, Check, ChevronDown, ChevronUp, ExternalLink,
  Loader2, MessageSquare, MoreHorizontal, Pause, Play, Unlock, User, Zap,
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
import { DeeperSearchPanel } from '@/components/campaign/DeeperSearchPanel';
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
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatRange, rangeShape } from '@/lib/rangeSemantics';
import {
  type CampaignSearchLanguageChoice,getCampaignLanguageState,
  getCreditAccount, getMatchCounts, 
  getMatches, 
  getLastSettledSweep,
  getUnlockedMatch, markMatchPreviewed,nextMatchesCursor, pauseMatchingCampaign,startMatchingCampaign, unlockMatch, 
} from '@/services/api';
import { readProperty } from '@/services/propertyManagement';
import { FEATURES } from '@/config/features';
import {
  agreementCount, type Counterpart, counterpartFor, fitTier, hasEvidence, headlineKey,
  reasonKey, recencyParts,
} from '@/matching/presentation';
import type { DiscoveryHeadroom } from '@/campaign/searchExpansion';
import type { CreditAccount, Match, MatchUnlock, Property, PropertyFacts } from '@/types/types';

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
/*
 * AN OPPORTUNITY, NOT A CLASSIFIER READOUT.
 *
 * WHAT THIS CARD SHOWED, IN THE ORDER IT SHOWED IT, on production, to a Georgian
 * property owner: five coloured bars, the word EXCEPTIONAL, then "Transaction intent
 * matches", "Country matches", "City matches", "Property type matches" — in English — a
 * row of grey pills, a blurred sentence, then "GOOGLE · KA · Score 87%", then four
 * unlabelled icon buttons. Every statement on it true. Not one of them the thing the
 * person came for, and the whole card sitting on a pale yellow surface because an
 * internal enum said EXCEPTIONAL.
 *
 * It read like a debugger attached to a database row.
 *
 * THE HIERARCHY IT IS REBUILT TO, decided in docs/design/customer-information-hierarchy.md
 * before any of this was written:
 *
 *   A  WHO AND WHAT      "A buyer looking for an apartment", and how well it fits as a
 *                        WORD — Strong, Good, Possible. Never a percentage: 87% is a
 *                        number no customer can act on differently from 84%.
 *   B  THE HUMAN FACTS   city · budget · rooms · how recently they spoke. What somebody
 *                        would ask next, on one line, in the order they would ask it.
 *   C  THEIR OWN WORDS   the excerpt, and one sentence on how much agrees.
 *   D  ONE ACTION        a labelled button, and everything else behind one menu that has
 *                        words in it.
 *   E  THE EVIDENCE      every matched dimension, every gap, the platform, the language,
 *                        the freshness verdict and the score — behind "Why this match?",
 *                        closed by default.
 *
 * THE EVIDENCE IS NOT GONE, AND THAT MATTERS MORE THAN THE TIDINESS.
 *
 * "Why does this match?" is the entire reason to trust a match, and a product that
 * cannot answer it is asking to be taken on faith. Everything that was on the front of
 * the card is still on the card — the reasons, the mismatches that were stored since
 * matching was built and never rendered anywhere at all, the provenance, the raw score.
 * It moved behind a disclosure whose label says what it holds. Moving it is a
 * presentation decision; removing it would have been an accountability one.
 *
 * AND THE REASONS ARE NOW TRANSLATED. They are matcher literals from a closed set of
 * sixteen — see reasonKey() — so a Georgian reader gets Georgian, and an unrecognised
 * phrase still appears, in English, rather than vanishing.
 *
 * WHAT IS STILL SOLD, AND WHERE. A PAYG match that no campaign covered keeps its price.
 * A match a campaign already paid for does not: it is not blurred, it has no padlock,
 * and its button says View. Blurring a result the customer already bought charges them a
 * second time in the only currency an interface has.
 */
function MatchCard({
  match,
  counterpart,
  onUnlock,
  unlocking,
  onAskAI,
  onChat,
  onRequestViewing,
}: {
  match: Match;
  /** BUYER / TENANT / INVESTOR, from the property's own transaction type. */
  counterpart: Counterpart | null;
  onUnlock: (m: Match) => void;
  unlocking: boolean;
  onAskAI: (m: Match) => void;
  onChat: (m: Match) => void;
  onRequestViewing: (m: Match) => void;
}) {
  const { t } = useLanguage();
  const money = useMoney();
  const [showEvidence, setShowEvidence] = useState(false);

  /*
   * Already paid for by the campaign that found it.
   *
   * Read from the reservation or allowance id rather than from a price of zero. A zero
   * price can also mean "we have not worked out what this costs", and the two must not
   * render the same way — the whole reason pricing_state exists one layer down. A
   * reservation covers a PAYG run; an allowance covers an INCLUDED one, so the first
   * search of every month on the FREE plan needs the second id or it renders as
   * something to buy.
   */
  const included = (
    Boolean(match.unlock_included_reservation_id)
    || Boolean(match.unlock_included_allowance_id)
  ) && match.status !== 'UNLOCKED';

  const opened = match.status === 'UNLOCKED';

  /* The one boolean that decides whether anything is being sold. Blur, price and
     padlock all key off this and nothing else, so there is one answer per card rather
     than four places that decide separately and can disagree. */
  const forSale = !included && !opened;

  const tier = fitTier(match.signal_strength);
  const reasons = (match.match_reasons ?? []).filter(Boolean);
  const mismatches = (match.mismatch_reasons ?? []).filter(Boolean);
  const agreed = agreementCount(reasons);
  const gaps = agreementCount(mismatches);
  const freshness = freshnessLabel(t, match.evidence_freshness);

  /* A reason in the reader's language where we recognise it; the stored phrase where we
     do not. Never nothing. */
  const say = (reason: string) => {
    const key = reasonKey(reason);
    return key ? t(key) : reason;
  };

  const budgetStr =
    /* An absent bound is not zero: see src/lib/rangeSemantics.ts. This rendered
       USD60,000-0 for a buyer who stated no ceiling. */
    rangeShape(match.preview_budget_min, match.preview_budget_max).kind !== 'unknown'
      ? money(match.preview_budget_min, match.preview_budget_max, match.preview_currency)
      : null;

  /*
   * WHAT THE HEADLINE ALREADY SAID DOES NOT GET SAID AGAIN.
   *
   * The headline names the city, and the rooms when there is a city to put them next to;
   * whatever it used is dropped from this line rather than repeated under it. The line is
   * shorter for it, and the card two lines shorter on a phone.
   */
  const headline = headlineKey(counterpart, {
    city: Boolean(match.preview_city),
    rooms: Boolean(match.preview_bedrooms),
  });
  const saidCity = headline.endsWith('_city');
  const saidRooms = headline.endsWith('_rooms_city');

  /* "12d ago" is a string the matcher wrote in English and stored; translated here
     because there is no timestamp to reformat. An unrecognised label is shown as it was
     stored rather than dropped — when somebody spoke is not a detail to hide. */
  const recency = (() => {
    const parsed = recencyParts(match.preview_recency);
    return parsed ? t(parsed.key, { count: String(parsed.count) }) : match.preview_recency;
  })();

  const facts = [
    saidCity ? null : match.preview_city,
    budgetStr,
    saidRooms || !match.preview_bedrooms
      ? null
      : `${match.preview_bedrooms} ${t('matches_bedrooms')}`,
    recency,
  ].filter(Boolean) as string[];

  /*
   * THREE WORDS, THREE WEIGHTS, AND NO NEW PALETTE.
   *
   * Strong borrows the product's own primary; Good and Possible are the neutral
   * secondary at two weights. There is no green, no blue and no yellow here: a colour
   * invented for a tier is a colour nobody can read without a legend, and the previous
   * card had five of them.
   */
  const TIER_CHIP: Record<string, string> = {
    STRONG: 'border-primary/30 bg-primary/10 text-primary',
    GOOD: 'border-border bg-secondary text-foreground',
    POSSIBLE: 'border-border bg-secondary/50 text-muted-foreground',
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5 transition-colors hover:border-primary/30">
      {/* ── A. HOW WELL IT FITS, AND WHAT STATE IT IS IN ───────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span
          className={`inline-flex max-w-full rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TIER_CHIP[tier]}`}
        >
          <span className="break-words min-w-0">{t(`match_fit_${tier.toLowerCase()}`)}</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {match.status === 'NEW' && (
            <span className="text-[13px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded whitespace-normal">{t('matches_new_badge')}</span>
          )}
          {opened && (
            <span className="text-[13px] font-bold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 whitespace-normal">{t('matches_unlocked_badge')}</span>
          )}
          {included && (
            <span className="text-[13px] font-bold bg-green-500/10 text-green-400/90 px-1.5 py-0.5 rounded border border-green-500/20 whitespace-normal">{t('matches_included_badge')}</span>
          )}
        </div>
      </div>

      {/* ── A. WHO THIS IS AND WHAT THEY WANT ─────────────────────────────
        The first line of the card, because it is the only thing on it the customer came
        for. An i18n KEY chosen by the property's transaction type, not a sentence built
        by concatenation: Georgian and Arabic do not put "looking for" where English
        does. */}
      <h3 className="text-[15px] font-semibold leading-snug text-foreground break-words">
        {t(headline, {
          city: match.preview_city ?? '',
          rooms: String(match.preview_bedrooms ?? ''),
        })}
      </h3>

      {/* ── B. THE HUMAN FACTS ────────────────────────────────────────────
        One line of plain text rather than four icon pills. The pills cost a row of
        height each on a 320px phone and a magnifying glass next to a city name tells
        nobody anything they did not already know from the city name. */}
      {facts.length > 0 && (
        <p className="text-sm text-muted-foreground break-words leading-snug">
          {facts.join(' · ')}
        </p>
      )}

      {/* ── C. THEIR OWN WORDS ────────────────────────────────────────────
        Server-REDACTED before it reaches this component — URLs, handles and phone
        numbers stripped, then capped — so the blur is an affordance over already-safe
        text and not the security model. Applied only when something is genuinely for
        sale. */}
      {match.preview_excerpt && (
        <div className="space-y-1">
          <p
            className={`text-sm italic text-muted-foreground break-words line-clamp-2${
              forSale ? ' blur-[1.5px] select-none' : ''}`}
          >
            {match.preview_excerpt}
          </p>
          {/*
            ONE LINE SAYING WHY THE TEXT IS SOFT, AND ONLY WHEN IT IS.
            A blurred sentence with nothing explaining it is a worse card than a blurred
            sentence with a reason next to it. The companion line for a result the
            customer already owns is gone: an unblurred excerpt needs no note, and the
            "included" chip above already says who paid for it.
          */}
          {forSale && (
            <p className="text-[13px] text-muted-foreground/60 break-words">
              {t('matches_unlock_hint')}
            </p>
          )}
        </div>
      )}

      {/* ── C. HOW MUCH AGREES, AS A SENTENCE ─────────────────────────────
        A count, not a checklist and not a percentage. The count excludes the matcher's
        hedges — see agreementCount() — so it cannot claim agreement on a dimension the
        signal never stated. The gaps are named in the same line because a result that is
        wrong in one respect and right in four is more useful when the one is said out
        loud than when it is averaged into a lower score. */}
      {(agreed > 0 || gaps > 0) && (
        <p className="text-sm text-foreground/80 break-words leading-snug">
          {agreed > 0 ? t('match_fit_summary', { count: String(agreed) }) : null}
          {agreed > 0 && gaps > 0 ? ' · ' : null}
          {gaps > 0 ? (
            <span className="text-muted-foreground">{t('match_fit_gaps', { count: String(gaps) })}</span>
          ) : null}
        </p>
      )}

      {/* ── D. ONE ACTION, WITH A WORD ON IT ─────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {forSale ? (
          /* The one place a purchase is offered, and it carries a price because here the
             price is true: no campaign covered this result. */
          <Button
            size="sm"
            className="font-semibold h-auto min-h-9 py-1.5 gap-1.5 whitespace-normal text-start"
            onClick={() => onUnlock(match)}
            disabled={unlocking}
          >
            {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : null}
            <span className="break-words" dir="ltr">
              {t('matches_unlock_btn')}{' · '}{match.unlock_price_credits.toFixed(2)} CR
            </span>
          </Button>
        ) : (
          /* Not a purchase and not worded like one. The same handler runs — the RPC
             charges zero, writes the match_unlocks row and returns the full signal — but
             what the customer is asked to do is open a result they own. */
          <Button
            size="sm"
            className="font-semibold h-auto min-h-9 py-1.5 gap-1.5 whitespace-normal text-start"
            onClick={() => onUnlock(match)}
            disabled={unlocking}
          >
            {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : null}
            <span className="break-words">
              {opened ? t('matches_details_btn') : t('matches_included_view_btn')}
            </span>
          </Button>
        )}

        {/*
          ONE MENU INSTEAD OF A ROW OF MYSTERIES.
          There were four icon-only buttons — a robot, a speech bubble, a calendar and a
          chevron — each with its label behind `hidden md:inline`, which means that on
          every phone the product supports a customer had to press one to find out what
          it did. The menu items carry words at every width.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground h-auto min-h-9 py-1.5 gap-1.5 whitespace-normal text-start"
            >
              <MoreHorizontal className="h-4 w-4 shrink-0" />
              <span className="break-words">{t('match_more_btn')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[min(18rem,calc(100vw-2rem))]">
            {/* Ask the AI why — on a paid result and an unpaid one alike. */}
            <DropdownMenuItem className="gap-2" onClick={() => onAskAI(match)}>
              <Bot className="h-4 w-4 shrink-0" />
              <span className="break-words">{t('matches_ask_ai_title')}</span>
            </DropdownMenuItem>
            {opened && (
              <>
                <DropdownMenuItem className="gap-2" onClick={() => onChat(match)}>
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="break-words">{t('matches_chat_btn')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={() => onRequestViewing(match)}>
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  <span className="break-words">{t('matches_viewing_btn')}</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── E. THE EVIDENCE, BEHIND A DOOR THAT SAYS WHAT IS IN IT ─────── */}
      {hasEvidence(reasons, mismatches) && (
        <div className="border-t border-border/40 pt-2">
          <button
            type="button"
            onClick={() => setShowEvidence(open => !open)}
            aria-expanded={showEvidence}
            className="flex w-full items-center justify-between gap-2 rounded text-start text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="break-words min-w-0">{t('match_why_disclosure')}</span>
            {showEvidence
              ? <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          </button>

          {showEvidence && (
            <div className="mt-2 space-y-2">
              {reasons.length > 0 && (
                <ul className="space-y-0.5">
                  {reasons.map((reason, index) => (
                    <li
                      key={`${reason}-${index}`}
                      className="flex items-start gap-1.5 text-[13px] text-muted-foreground min-w-0"
                    >
                      <Check className="h-3 w-3 text-green-400/80 shrink-0 mt-0.5" />
                      <span className="break-words min-w-0">{say(reason)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {mismatches.length > 0 && (
                <ul className="space-y-0.5">
                  {mismatches.map((reason, index) => (
                    <li
                      key={`${reason}-${index}`}
                      className="flex items-start gap-1.5 text-[13px] text-muted-foreground/80 min-w-0"
                    >
                      {/* A typographic minus, in an expression rather than as text: it is
                          a glyph marking a list item, not copy, and the i18n audit is
                          right to want every bare string routed through t(). */}
                      <span className="text-muted-foreground/60 shrink-0 mt-0.5" aria-hidden="true">{'−'}</span>
                      <span className="break-words min-w-0">{say(reason)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/*
                PROVENANCE AND THE RAW SCORE, AND THIS IS WHERE THEY LIVE.
                Which platform read a signal, what language it was in, what the freshness
                contract concluded and what the matcher scored: all real, all recorded,
                and all of it material for somebody auditing a result rather than reasons
                a seller should act. They were on the front of the card as "GOOGLE · KA ·
                Score 87%", which is a log line.
              */}
              <p className="text-[13px] text-muted-foreground/70 break-words" dir="ltr">
                {[
                  match.preview_platform
                    ? t('match_found_on', { source: String(match.preview_platform) })
                    : null,
                  match.preview_language ? String(match.preview_language).toUpperCase() : null,
                  freshness,
                  `${t('matches_score')} ${Math.round(match.match_score)}%`,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Mock badge — dev only */}
      {match.mock_mode && import.meta.env.DEV && (
        <span className="inline-flex items-center gap-1 text-[13px] font-bold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-2 py-0.5 rounded-full">
          {t('matches_dev_signal')}
        </span>
      )}
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
            <Unlock className="h-4 w-4 text-primary" />
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
  const railFacts = [
    facts?.city,
    facts?.total_price
      ? `${facts.currency ?? '$'}${Number(facts.total_price).toLocaleString()}`
      : null,
    facts?.bedrooms ? `${facts.bedrooms} ${t('matches_bedrooms')}` : null,
  ].filter(Boolean) as string[];

  return (
    <AppLayout>
      {/*
        * max-w-3xl WAS A 768px PHONE COLUMN IN THE MIDDLE OF A 1920px SCREEN.
        *
        * Which is the composition the whole visual pass exists to remove: a narrow strip
        * of content with two-thirds of the canvas empty on either side. The list is the
        * page, and a list of opportunities on a desktop should read like a list, in
        * columns, the way a portal does — which is where the density reference comes from,
        * not the colours.
        *
        * 90rem matches the owner workspace so moving between the two does not change the
        * shape of the page under the reader. The MATCHES themselves go to a grid below;
        * the controls above stay one column, because a filter rail and a progress panel
        * spread across 1440px is the opposite failure.
        */}
      <div className="max-w-[90rem] mx-auto space-y-6">
        {/*
          * THE HEADER SAYS WHAT THIS LIST IS AND WHAT TO DO ABOUT IT. THAT IS ALL.
          *
          * IT HELD A WALLET BALANCE. "12.40 CR" in a coloured pill, top right, on a page
          * about one property — an account-level number in the header of a
          * property-level screen, and the first thing the eye landed on. A balance is
          * load-bearing at exactly one moment, when it is about to change, and the unlock
          * dialog already shows it there along with what the balance will be afterwards.
          * Deferred with the rest of the operator chrome behind
          * FEATURES.matchesCampaignOperatorControls; /credits is still a page and still
          * in the navigation.
          *
          * AND ITS HEADING WAS "MATCHES", which is the name of a database table's worth
          * of rows. It now names the people: buyers for a property that is for sale,
          * tenants for one to let, investors for an investment — and, when the transaction
          * type never made it through an import, a form that is true of any property
          * rather than a guess about which half of the market somebody is in.
          *
          * WHAT STAYED, and what would be broken by removing it: the primary action. It
          * is relabelled from "Start matching" (a mode to switch on) to "Find buyers" (a
          * thing to do), it still opens the budget-authorisation dialog, and pausing a
          * running search is still one click away with a word on it. Those are how a
          * customer gets matches at all and how they stay in control of what is spent.
          *
          * The row wraps and the title block is min-w-0: measured 2026-09-26 at 394px
          * scrollWidth against a 320 viewport in Georgian, because the action group was
          * shrink-0 and a Georgian button label does not shrink.
          */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 sm:flex-1">
            <h1 className="text-xl font-semibold text-foreground break-words">{t(titleKey)}</h1>
            {propertyLabel && (
              <p className="text-sm text-muted-foreground mt-0.5 break-words">{propertyLabel}</p>
            )}
            <p className="text-sm text-muted-foreground mt-0.5 break-words">
              {t('matches_header_summary', { total: String(counts.total), new: String(counts.newCount), strong: String(counts.strongCount) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {campaignActive ? (
              <Button
                size="sm"
                variant="outline"
                /* The label is no longer behind `hidden md:inline`. A button that stops a
                   process which spends money must say so at 320px too. */
                className="border-border text-muted-foreground h-auto min-h-9 py-1.5 gap-1.5 whitespace-normal text-start"
                onClick={() => setShowPauseConfirm(true)}
                disabled={campaignLoading}
              >
                {campaignLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : <Pause className="h-3.5 w-3.5 shrink-0" />}
                <span className="break-words">{t('matches_pause_matching')}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                /*
                 * WRAPS AND SHRINKS. shadcn's Button is whitespace-nowrap and was h-8
                 * here, so a Georgian label could neither wrap nor be clipped: the button
                 * grew, took the action group to 322px inside a 320px viewport, and the
                 * whole page scrolled sideways. min-h rather than h so a two-line label
                 * gets a taller button instead of an overflowing one.
                 */
                className="font-semibold h-auto min-h-9 py-1.5 gap-1.5 whitespace-normal text-start"
                onClick={() => setShowBudget(true)}
                disabled={campaignLoading}
              >
                {campaignLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : <Play className="h-3.5 w-3.5 shrink-0" />}
                <span className="break-words">{t(discoverKey)}</span>
              </Button>
            )}
          </div>
        </div>

        {/*
          * A SECOND REGION, BECAUSE ONE COLUMN OF CARDS IS NOT A DESKTOP PAGE.
          *
          * The previous composition put a 538px card in an 1152px content region and left
          * the rest empty — the same failure the owner workspace was rejected for, a phone
          * layout centred on a large screen. Widening the card was the other rejected
          * answer: one enormous listing stretched almost edge to edge.
          *
          * So neither. The page has two regions with different jobs. The list is the
          * subject and takes the width it needs; the rail carries the CONTEXT a person
          * reading matches keeps wanting — which property this is, what a search is doing
          * right now, and what more searching would reach. With one match the screen still
          * has two populated regions instead of a card adrift in grey.
          *
          * It stacks below xl. On a phone a rail is just more things above the results, so
          * there is no rail: the context follows the matches.
          */}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-5">
          {/* Filters */}
          <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)}>
            {/*
              * `overflow-x-auto` is the other half of the tabs primitive's
              * contract, and this screen never held up its end.
              *
              * src/components/ui/tabs.tsx deliberately makes triggers `shrink-0` so
              * a label cannot be squeezed until it runs across its neighbour, and
              * says so: "Now the row is genuinely wider than the phone,
              * `overflow-x-auto` has something to do, and the rail scrolls." Without
              * it, the row is genuinely wider than the phone and nothing scrolls —
              * the PAGE does.
              *
              * Measured at 320px in Georgian: four filters reading ყველა, ახალი,
              * ძლიერი and გახსნილი, each with a count in brackets. There is no width
              * at which those four fit across 320px, so the rail has to scroll.
              */}
            <TabsList className="bg-secondary max-w-full overflow-x-auto">
              <TabsTrigger value="all">{t('matches_filter_all')} ({counts.total})</TabsTrigger>
              <TabsTrigger value="new">{t('matches_filter_new')} ({counts.newCount})</TabsTrigger>
              <TabsTrigger value="strong">{t('matches_filter_strong')} ({counts.strongCount})</TabsTrigger>
              <TabsTrigger value="unlocked">{t('matches_filter_unlocked')}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Match list */}
          {loading ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 items-start">
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
              {/* p-12 is 96px of padding, which leaves 224px of a 320px phone for a
                  button whose Georgian label is wider than that. Roomy from `sm` up,
                  where there is room to be roomy. */}
              <CardContent className="p-6 sm:p-12 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{t('matches_empty')}</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">{t('matches_empty_desc')}</p>
                {!campaignActive && (
                  <Button
                    className="mt-6 max-w-full whitespace-normal h-auto py-2 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setShowBudget(true)}
                  >
                    <Play className="h-4 w-4 mr-2 shrink-0" />
                    {t(discoverKey)}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            /*
             * COLUMNS FROM lg, NOT ONE STACK FOREVER.
             *
             * A match card is about 200px tall, so a single column put four of them on a
             * 1080p screen and made 74 matches an afternoon of scrolling. Three columns at
             * 2xl give a ~440px card — wide enough for a Georgian headline on one or two
             * lines, narrow enough that a dozen are visible at once.
             *
             * With ONE match the card is one column wide and the rest of the row is empty,
             * which is what a list with one item in it should look like. It is deliberately
             * not stretched to 1440px: that was the over-correction the owner workspace was
             * rejected for, and a single enormous card is not a better lie about density
             * than a tiny one.
             */
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3 items-start">
              {filteredMatches.map(m => (
                <MatchCard
                  key={m.id}
                  match={m}
                  counterpart={counterpart}
                  onUnlock={handleUnlockClick}
                  unlocking={unlockLoading && pendingUnlock?.id === m.id}
                  onAskAI={handleAskAI}
                  onChat={handleChat}
                  onRequestViewing={handleRequestViewing}
                />
              ))}
              {hasMore && (
                <div className="flex justify-center pt-2 lg:col-span-2 2xl:col-span-3">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="border-border gap-2">
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('matches_load_more')}
                  </Button>
                </div>
              )}
            </div>
          )}
          </div>

          <aside className="min-w-0 space-y-4">
            {/*
              WHICH PROPERTY THIS IS ABOUT, on a screen reached per property and which used
              to name it nowhere at all. Their own property, so no address-visibility rule
              applies; it is the same asset the owner workspace lists.
            */}
            {property && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <p className="text-[13px] font-medium text-muted-foreground break-words">
                  {t('matches_rail_property')}
                </p>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground break-words">
                    {propertyLabel ?? t('matches_rail_untitled')}
                  </p>
                  {railFacts.length > 0 && (
                    <p className="text-sm text-muted-foreground break-words">
                      {railFacts.join(' · ')}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-border h-auto min-h-9 py-1.5 whitespace-normal text-start justify-center"
                  onClick={() => navigate(`/property/${propertyId}`)}
                >
                  <span className="break-words">{t('matches_rail_open')}</span>
                </Button>
              </div>
            )}

            {/*
              * THE PULSING GREEN BANNER, DEFERRED.
              *
              * "Matching is active", with an animated dot, on every visit. It reported a state
              * the customer had not asked to think about, and it derived that state from
              * `matchData.some(m => m.status !== 'ARCHIVED')` — the existence of any
              * non-archived match, which is not the same claim as "a search is running" and
              * was often false while the banner said it. Live progress is reported by
              * MatchingJobProgress below, from the job, which is where a claim about a running
              * search should come from.
              */}
            {FEATURES.matchesCampaignOperatorControls && campaignActive && (
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
            {/* Per-language reach counts: how an operator audits a campaign, not why a seller
                opens this page. Deferred with the rest of the operator chrome; the panel and
                its data are untouched. */}
            {FEATURES.matchesCampaignOperatorControls && campaignActive && propertyId && (
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

            {/*
              * "Homatch searched N relevant sources. More are available."
              *
              * Only after a settled sweep, and only when that sweep recorded
              * headroom. Renders nothing at all when there is nothing deeper, because
              * a panel announcing completeness would be noise on every successful
              * search. No plan name and no pricing route: this is pay-as-you-go
              * depth, not a subscription gate.
              */}
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

            {/*
              * TWO PUBLICATION CTAs THAT SAT IN FRONT OF THE RESULTS.
              *
              * A community-outreach panel that drafts and translates a post for Facebook
              * groups and Telegram channels, and a card of links out to Georgian portals. Both
              * do real work. Both answered "where else could I advertise this?" — above the
              * answer to the question this screen exists for, which is "who wants it?" A
              * customer scrolling to their first match read two calls to publish elsewhere on
              * the way.
              *
              * Deferred behind FEATURES.matchesOutboundPublication, not deleted: the
              * components, the drafting edge function, the translated copy and the portal
              * registry are all intact, and this belongs on a surface where publishing is the
              * subject.
              */}
            {FEATURES.matchesOutboundPublication && propertyId && (
              <CommunityOutreachPanel propertyId={propertyId} />
            )}
            {FEATURES.matchesOutboundPublication && (
              <ExternalSitesCard propertyId={propertyId} />
            )}
          </aside>
        </div>
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
