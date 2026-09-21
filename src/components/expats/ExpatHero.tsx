// HOMATCH FOR EXPATS — the first viewport.
//
// WHAT IT HAD TO AVOID
//
// §7 lists the four openings this product is not allowed to have: a search
// box, article cards, a category grid, a chatbot. All four are the same
// mistake — they hand the visitor a tool before telling them what the thing
// is. Somebody who has never heard of Georgia cannot usefully search it.
//
// WHAT IT DOES INSTEAD
//
// Says what the product is in one line, then shows the four ways through
// it. The four are not cards. They are rows on a single dark panel,
// separated by hairlines, because four boxes read as four unrelated
// features and four rows read as four doors into one building — which is
// the actual claim: this is one connected thing, not a menu.
//
// WHY THE HERO IS DARK AND THE PAGE BELOW IT IS NOT
//
// It belongs to Verify and Investment by sharing their surface, which is
// the family resemblance §90 asks for. Then the page lightens, because
// everything below is reading rather than analysis and forty minutes of
// editorial copy on a near-black ground is punishing. A magazine opens on
// a full-bleed plate and sets the article in ink on paper.
//
// WHY THERE IS NO PHOTOGRAPH
//
// §64 asks for authentic premium imagery and §6 forbids tourism
// aesthetics, and the only images available here would be stock Tbilisi.
// A stock photograph of Old Town balconies is the exact aesthetic the
// brief rules out, and shipping one because the brief also asks for
// imagery would be following the letter against the intent. The plate is
// typographic until there is real photography to put in it.

import React from 'react';
import { ArrowRight, Compass, Home, KeyRound, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { EXPAT_PATHWAYS, type ExpatPathway } from '@/expats/types';

const PATHWAY_ICON: Record<ExpatPathway, typeof Compass> = {
  MOVE: Compass,
  LIVE: Home,
  BUY: KeyRound,
  INVEST: TrendingUp,
};

/**
 * Where each door leads.
 *
 * These are anchors into this page and not routes, which is what the name
 * has said all along. They once pointed at /for-expats/georgia/move and
 * three siblings, and no such routes exist — all four landed on "We do not
 * have this page". The fix is not to build four pages: this page already
 * IS the four pathways, in order, and each row describes a section of it.
 * MOVE is the entry and residence topics, LIVE is the month's cost, BUY is
 * what the budget reaches, and INVEST is the analysis tools its own line
 * promises. The ids live on the sections in ForExpatsPage.
 */
const PATHWAY_ANCHOR: Record<ExpatPathway, string> = {
  MOVE: '#topics',
  LIVE: '#cost-of-living',
  BUY: '#budget',
  INVEST: '#tools',
};

export function ExpatHero() {
  const { t } = useLanguage();

  return (
    <section
      data-expat-hero
      className="hm-workspace hm-workspace-canvas relative overflow-hidden"
    >
      <div className="mx-auto w-full max-w-[76rem] px-5 pb-14 pt-16 sm:pb-20 sm:pt-24">
        <p className="mb-4 text-2xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--gold-ink))]">
          {t('expat_hero_eyebrow')}
        </p>

        {/* Three short clauses, each its own line. A single wrapped
            sentence at this size breaks wherever the viewport decides,
            and the rhythm is the whole effect. */}
        <h1 className="max-w-[24ch] font-display text-[2.5rem] font-semibold leading-[1.05] text-foreground sm:text-[3.75rem]">
          <span className="block">{t('expat_hero_line1')}</span>
          <span className="block">{t('expat_hero_line2')}</span>
          <span className="block text-[hsl(var(--gold-ink))]">{t('expat_hero_line3')}</span>
        </h1>

        <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t('expat_hero_body')}
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-[hsl(var(--card))]">
          {EXPAT_PATHWAYS.map((pathway, i) => {
            const Icon = PATHWAY_ICON[pathway];
            return (
              <a
                key={pathway}
                href={PATHWAY_ANCHOR[pathway]}
                data-expat-pathway={pathway}
                className={cn(
                  'group flex items-center gap-4 px-5 py-5 transition-colors sm:gap-6 sm:px-7',
                  'hover:bg-[hsl(var(--accent))] focus-visible:bg-[hsl(var(--accent))]',
                  i > 0 && 'border-t border-border',
                )}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
                  <Icon className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-semibold text-foreground">
                    {t(`expat_pathway_${pathway.toLowerCase()}_title`)}
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                    {t(`expat_pathway_${pathway.toLowerCase()}_body`)}
                  </span>
                </span>
                <ArrowRight
                  className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
                  aria-hidden="true"
                />
              </a>
            );
          })}
        </div>

        <p className="mt-5 text-2xs text-muted-foreground">{t('expat_hero_free_note')}</p>
      </div>
    </section>
  );
}
