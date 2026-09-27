// AN OPPORTUNITY, BUILT AS ONE.
//
// This is not MatchCard with different children. MatchCard is deleted, and this component
// does not import Card, Badge or Button — the three shadcn primitives whose resolution on
// the root light palette produced the white rectangle, the grey pills and the black
// button that were rejected three times. See src/components/customer/surface.tsx for the
// full root-cause note.
//
// WHAT THE REJECTED COMPOSITION WAS, so it cannot be rebuilt by accident:
//
//     [ grey outlined pill ]            [ green outlined pill ]
//     large bold headline
//     budget text
//     large italic raw excerpt
//     "matches on 5 points"
//     [ BLACK DETAILS BUTTON ] [ GREY MORE BUTTON ]
//     ─────────────────────────────────────────────
//     why is this a match?                       v
//
// Seven stacked blocks, two of them full-width buttons, ~342px tall on a 390px phone —
// one result per screen on a product whose job is letting somebody scan many.
//
// WHAT IT IS NOW, at roughly 240px:
//
//     · Strong match                    2 days ago  NEW
//     Buyer looking for a 3-bedroom in Tbilisi
//     ⌖ Tbilisi   ₾ $220K–$280K   ⌂ 3 bedrooms
//     Fits your property on location, type and budget.
//     ▏ORIGINAL POST
//      "ვეძებ სამ საძინებლიან ბინას ვაკეში…"
//     View match →                                  ⋯
//
// The strength is a dot and a word, not a badge. The facts are icons and values, not
// capsules. The fit is a sentence naming WHAT agreed, not a count of how many things did.
// The excerpt is a marked quotation clamped to one line. One action, read as text.
//
// EVERYTHING THAT LEFT THE CARD IS IN THE DETAIL VIEW, which "View match" opens: every
// matched dimension, every gap, the platform, the language, the freshness verdict, the
// raw score and the full excerpt. Moving the evidence is a presentation decision;
// removing it would have been an accountability one, and "why does this match?" is the
// whole reason to trust a match.

import { BedDouble, Building2, Coins, Loader2, MapPin, MoreHorizontal } from 'lucide-react';
import React from 'react';
import { CardAction, Fact, SourceQuote, StrengthMark } from '@/components/customer/surface';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export interface OpportunityFacts {
  /** Where they are looking. */
  city?: string | null;
  /** Their budget, already formatted and range-aware. */
  budget?: string | null;
  /** How many bedrooms, as a number. */
  bedrooms?: number | string | null;
  /** What kind of property, already localised. */
  propertyType?: string | null;
}

export function OpportunityCard({
  strengthTier,
  strengthLabel,
  headline,
  freshness,
  state,
  facts,
  whyLine,
  excerpt,
  excerptLabel,
  excerptObscured,
  actionLabel,
  actionSuffix,
  onAction,
  actionBusy,
  overflow,
}: {
  strengthTier: string;
  strengthLabel: string;
  headline: string;
  /** How long ago the person spoke, in the reader's language. */
  freshness?: string | null;
  /** NEW / UNLOCKED / INCLUDED, or nothing. A word, never a capsule. */
  state?: { label: string; tone: 'new' | 'owned' } | null;
  facts: OpportunityFacts;
  /** One sentence naming what agreed. Null when nothing recognised did. */
  whyLine?: string | null;
  excerpt?: string | null;
  excerptLabel: string;
  /** Blur the quote, because this one genuinely has not been paid for. */
  excerptObscured?: boolean;
  actionLabel: string;
  actionSuffix?: string | null;
  onAction: () => void;
  actionBusy?: boolean;
  overflow?: React.ReactNode;
}) {
  const { t } = useLanguage();

  /*
   * The fact row, built from what exists.
   *
   * Never more than three, and the headline has first claim: it already names the city,
   * and often the bedrooms, so repeating them here would spend two of the three slots
   * saying what the line above just said. The caller decides what the headline consumed.
   */
  const shown = [
    facts.city ? { icon: MapPin, value: facts.city } : null,
    facts.budget ? { icon: Coins, value: facts.budget } : null,
    facts.propertyType ? { icon: Building2, value: facts.propertyType } : null,
    facts.bedrooms
      ? { icon: BedDouble, value: `${facts.bedrooms} ${t('matches_bedrooms')}` }
      : null,
  ].filter(Boolean).slice(0, 3) as Array<{
    icon: React.ComponentType<{ className?: string }>;
    value: string;
  }>;

  return (
    /*
     * hm-discovery-panel, the same module surface Investment and Mortgage use: the card
     * ground at 218 28% 10%, a hairline at 218 22% 18%, 1rem radius. On the navy canvas
     * this reads as a raised module. On white it read as a sheet of paper, which was the
     * problem.
     *
     * The hover lift is gold and comes from the same grammar — no new shadow, no new
     * radius, no new colour invented for this card.
     */
    <article
      className={cn(
        'hm-discovery-panel group/card p-3.5 transition-colors',
        'hover:border-[hsl(var(--ring))]/35',
      )}
    >
      {/* ── strength · freshness · state, one 13px line ─────────────── */}
      {/* Wraps. It was one row with a shrink-0 group on the right, so "კონტაქტი
          მიღებული" truncated the verdict beside it to "ძლიერი დამ…" — the first thing on
          the card, cut by a badge. A second line costs 17px on the few cards that need
          it. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <StrengthMark tier={strengthTier} label={strengthLabel} />
        <div className="flex items-center gap-2 text-2xs">
          {freshness ? <span className="text-muted-foreground">{freshness}</span> : null}
          {state ? (
            <span
              className={cn(
                'font-semibold',
                state.tone === 'new'
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {state.label}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── who this is and what they want ──────────────────────────── */}
      <h3 className="font-display text-[0.9375rem] font-semibold leading-snug text-foreground">
        {headline}
      </h3>

      {/* ── the facts, as values rather than capsules ───────────────── */}
      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {shown.map((fact) => (
            <Fact key={fact.value} icon={fact.icon}>
              {fact.value}
            </Fact>
          ))}
        </div>
      )}

      {/* ── what agreed, named ──────────────────────────────────────── */}
      {whyLine ? (
        <p className="mt-2 text-2xs leading-snug text-foreground/90">{whyLine}</p>
      ) : null}

      {/* ── their own words, marked as theirs ───────────────────────── */}
      {excerpt ? (
        <div className={cn('mt-2.5', excerptObscured && 'select-none blur-[1.5px]')}>
          <SourceQuote text={excerpt} label={excerptLabel} />
        </div>
      ) : null}

      {/* ── one action ──────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-border/50 pt-2.5">
        <CardAction
          label={actionLabel}
          suffix={actionSuffix}
          onClick={onAction}
          disabled={actionBusy}
          busy={actionBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
          overflow={overflow}
        />
      </div>
    </article>
  );
}

/** The overflow trigger's look, so callers do not each invent one. */
export function OverflowGlyph() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[hsl(var(--secondary))] hover:text-foreground">
      <MoreHorizontal className="h-4 w-4" />
    </span>
  );
}
