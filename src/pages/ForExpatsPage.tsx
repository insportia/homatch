// HOMATCH FOR EXPATS — the landing experience.
//
// §65 gives a hierarchy and it is followed, with one deliberate change: the
// ecosystem block is last rather than buried, because a foreigner who has
// just worked out what their money buys is exactly the person who should
// be told Verify exists, and a grid of product cards near the top would be
// the "menu of features" opening §7 rules out.
//
// WHAT LOADS AND WHEN
//
// The hero and the pathways render from the bundle with no data at all, so
// the first viewport is never waiting on Supabase. Market readings and cost
// observations are fetched after mount and each section renders its own
// absence rather than holding up the page — §68 says general content must
// not block on research, and the same applies to anything over a network.
//
// WHY THE WHOLE PAGE WORKS SIGNED OUT
//
// §66. Everything here except the plan block is available to somebody who
// has never heard of Homatch. The account is offered where it adds
// something — a plan that remembers — and nowhere else.

import { ArrowRight, CircleDollarSign, FileSignature, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import '@/components/expats/expats.css';
import { usePathAvailable } from '@/lib/serviceControls';
import React from 'react';
import { Link } from 'react-router-dom';
import LocalSectionNav from '@/components/common/LocalSectionNav';
import PageMeta from '@/components/common/PageMeta';
import { ExpatHero } from '@/components/expats/ExpatHero';
import { ExpatSeo } from '@/components/expats/ExpatSeo';
import { GeorgiaAtAGlance } from '@/components/expats/GeorgiaAtAGlance';
import { GuideHub } from '@/components/expats/GuideHub';
import { WhatChanged } from '@/components/expats/WhatChanged';
import WhatDoYouNeed from '@/components/expats/WhatDoYouNeed';
import { ExpatPlanStarter } from '@/components/expats/ExpatPlanStarter';
import { PageBlocks } from '@/site/render/PageBlocks';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type ExpatTopic,
  type ExpatUpdate,
  getUpdates,
  listTopics,
} from '@/services/expats';

export default function ForExpatsPage() {
  const { t } = useLanguage();

  const [topics, setTopics] = React.useState<ExpatTopic[]>([]);
  const [updates, setUpdates] = React.useState<ExpatUpdate[]>([]);

  React.useEffect(() => {
    let live = true;
    // Independent reads, fired together.
    void Promise.all([listTopics(), getUpdates(4)]).then(([tp, up]) => {
      if (!live) return;
      setTopics(tp);
      setUpdates(up);
    });
    return () => {
      live = false;
    };
  }, []);


  return (
    <AppLayout noPadding>
      <div className="expat-page overflow-x-hidden bg-background text-foreground">
      <PageMeta title={t('expat_meta_title')} description={t('expat_meta_description')} />
      <ExpatSeo path="/for-expats/georgia" />

      {/*
        * FOR EXPATS IS PART OF HOMATCH, AND NOW LOOKS LIKE IT.
        *
        * These three pages rendered a bare fragment: no header, no footer,
        * no way back. A visitor who arrived from a search result was inside
        * what felt like a different product, with the rest of Homatch
        * unreachable and nothing saying where they were. Solid rather than
        * transparent because this hero is a light canvas -- the transparent
        * state only works over a full-bleed black hero, and on white it
        * renders the logo white on white.
        */}

      <ExpatHero />

      {/* Where the reader is inside a long page, and how to get about it. */}
      <LocalSectionNav
        ariaLabelKey="nav_on_this_page"
        sections={[
          { id: 'plan', labelKey: 'expat_journey_your_plan' },
          { id: 'needs', labelKey: 'expat_needs_title' },
          { id: 'topics', labelKey: 'expat_pathway_move_title' },
          { id: 'tools', labelKey: 'expat_pathway_invest_title' },
        ]}
      />

      <div className="mx-auto w-full max-w-[76rem] space-y-16 px-5 py-14 sm:py-20">
        {/* The front door (owner direction 2026-10-24): HOMI builds a plan
            with you and answers questions, before anything to read. */}
        <div id="plan" className="scroll-mt-24">
          <ExpatPlanStarter />
        </div>

        <GeorgiaAtAGlance />

        {/* The front door: one question, then the steps and the tool for
            each. Above the long sections because it is what most visitors
            actually came to resolve. */}
        <div id="needs" className="scroll-mt-24">
          <WhatDoYouNeed topics={topics} />
        </div>

        {/* The hero rows point here or to a topic guide. scroll-mt clears the
            sticky header. The monthly cost, budget and rental group sections
            were removed on the owner's instruction (2026-10-24). */}
        <div id="topics" className="scroll-mt-24">
          {/* The Georgia living guide: twelve categories, every card a sourced, dated guide. */}
          <section data-expat-guide>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">{t('expat_topics_eyebrow')}</p>
            <h2 className="mb-6 font-display text-2xl font-semibold text-foreground sm:text-3xl">{t('expat_topics_title')}</h2>
            <GuideHub topics={topics} />
          </section>
        </div>

        <WhatChanged updates={updates} />


        <div id="tools" className="scroll-mt-24">
          <Ecosystem />
        </div>
      </div>

      {/* Whatever an admin has added to this page. Additive: the guidance,
          the steps and the tools above are product rather than copy, and a
          page nobody has edited renders byte for byte what shipped. */}
      <PageBlocks slug="expat" />

    </div>
    </AppLayout>
  );
}


/**
 * The rest of Homatch, as a sentence rather than a grid.
 *
 * §58 asks for a premium connection between capabilities and explicitly
 * rules out a generic grid of product cards. These are rows describing
 * what each product answers, in the order a purchase actually happens,
 * and every one of them is a product that exists today.
 */
const ECOSYSTEM = [
  { to: '/ai', icon: Search, key: 'find' },
  { to: '/verify', icon: ShieldCheck, key: 'verify' },
  { to: '/investment', icon: TrendingUp, key: 'invest' },
  { to: '/mortgage', icon: CircleDollarSign, key: 'finance' },
  { to: '/contracts', icon: FileSignature, key: 'contract' },
] as const;

function Ecosystem() {
  const { t } = useLanguage();
  const pathAvailable = usePathAvailable(); // a paused product is not suggested
  return (
    <section data-expat-ecosystem>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_ecosystem_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {t('expat_ecosystem_body')}
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        {ECOSYSTEM.filter((item) => pathAvailable(item.to)).map((item, i) => (
          <Link
            key={item.key}
            to={item.to}
            data-expat-ecosystem-link={item.key}
            className={`group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent ${
              i > 0 ? 'border-t border-border' : ''
            }`}
          >
            <item.icon className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                {t(`expat_eco_${item.key}_title`)}
              </span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">
                {t(`expat_eco_${item.key}_body`)}
              </span>
            </span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
