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
import React from 'react';
import { Link } from 'react-router-dom';
import LocalSectionNav from '@/components/common/LocalSectionNav';
import PageMeta from '@/components/common/PageMeta';
import { CostOfLiving } from '@/components/expats/CostOfLiving';
import { ExpatHero } from '@/components/expats/ExpatHero';
import { ExpatSeo } from '@/components/expats/ExpatSeo';
import { GeorgiaAtAGlance } from '@/components/expats/GeorgiaAtAGlance';
import { RentalCommunities } from '@/components/expats/RentalCommunities';
import { TopicIndex } from '@/components/expats/TopicIndex';
import { WhatCanIBuy } from '@/components/expats/WhatCanIBuy';
import { WhatChanged } from '@/components/expats/WhatChanged';
import WhatDoYouNeed from '@/components/expats/WhatDoYouNeed';
import { PageBlocks } from '@/site/render/PageBlocks';
import { HeaderSpacer, PublicHeader } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cityName, EXPAT_CITIES } from '@/expats/geography';
import type { LocatedSnapshot } from '@/expats/marketContext';
import { EMPTY_PROFILE } from '@/expats/types';
import {
  type CostObservationRow,
  type ExpatTopic,
  type ExpatUpdate,
  getCostObservations,
  getMarketReadings,
  getRentalCommunities,
  getUpdates,
  listTopics,
  type RentalCommunity,
} from '@/services/expats';
import { usePublicNavLinks } from '@/site/publicNav';

export default function ForExpatsPage() {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();

  const [topics, setTopics] = React.useState<ExpatTopic[]>([]);
  const [snapshots, setSnapshots] = React.useState<LocatedSnapshot[]>([]);
  const [costs, setCosts] = React.useState<CostObservationRow[]>([]);
  const [communities, setCommunities] = React.useState<RentalCommunity[]>([]);
  const [updates, setUpdates] = React.useState<ExpatUpdate[]>([]);

  const tbilisi = EXPAT_CITIES[0];

  React.useEffect(() => {
    let live = true;
    // Five independent reads, fired together. Sequencing them would make
    // the slowest one the page's load time for no reason.
    void Promise.all([
      listTopics(),
      getMarketReadings(tbilisi.nameKa),
      getCostObservations(tbilisi.nameEn),
      getRentalCommunities(tbilisi.nameEn),
      getUpdates(4),
    ]).then(([tp, sn, co, cm, up]) => {
      if (!live) return;
      setTopics(tp);
      setSnapshots(sn);
      setCosts(co);
      setCommunities(cm);
      setUpdates(up);
    });
    return () => {
      live = false;
    };
  }, [tbilisi.nameKa, tbilisi.nameEn]);

  const headerLinks = usePublicNavLinks();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
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
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <ExpatHero />

      {/* Where the reader is inside a long page, and how to get about it. */}
      <LocalSectionNav
        ariaLabelKey="nav_on_this_page"
        sections={[
          { id: 'needs', labelKey: 'expat_needs_title' },
          { id: 'cost-of-living', labelKey: 'expat_pathway_live_title' },
          { id: 'budget', labelKey: 'expat_pathway_buy_title' },
          { id: 'topics', labelKey: 'expat_pathway_move_title' },
          { id: 'tools', labelKey: 'expat_pathway_invest_title' },
        ]}
      />

      <div className="mx-auto w-full max-w-[76rem] space-y-16 px-5 py-14 sm:py-20">
        <GeorgiaAtAGlance />

        {/* The front door: one question, then the steps and the tool for
            each. Above the long sections because it is what most visitors
            actually came to resolve. */}
        <div id="needs" className="scroll-mt-24">
          <WhatDoYouNeed topics={topics} />
        </div>

        {/* The four hero rows are anchors into this page, so the sections
            they name carry the ids. scroll-mt clears the sticky header;
            without it the heading lands underneath it and the reader
            arrives mid-paragraph. */}
        <div id="cost-of-living" className="scroll-mt-24">
          <CostOfLiving
            city={cityName(tbilisi, lang)}
            observations={costs}
            profile={EMPTY_PROFILE}
          />
        </div>

        <div id="budget" className="scroll-mt-24">
          <WhatCanIBuy cityKey={tbilisi.key} snapshots={snapshots} />
        </div>

        <RentalCommunities communities={communities} />

        <div id="topics" className="scroll-mt-24">
          <TopicIndex topics={topics} />
        </div>

        <WhatChanged updates={updates} />

        <PlanInvitation signedIn={Boolean(homatchUser)} />

        <div id="tools" className="scroll-mt-24">
          <Ecosystem />
        </div>
      </div>

      {/* Whatever an admin has added to this page. Additive: the guidance,
          the steps and the tools above are product rather than copy, and a
          page nobody has edited renders byte for byte what shipped. */}
      <PageBlocks slug="expat" />

      <SiteFooter />
    </div>
  );
}

/**
 * The account offer, placed after the free value rather than before it.
 *
 * Somebody who has already priced a month and seen what their budget
 * reaches has a reason to want the plan. The same block above the fold is
 * a signup wall with a product behind it.
 */
function PlanInvitation({ signedIn }: { signedIn: boolean }) {
  const { t } = useLanguage();
  return (
    <section
      data-expat-plan-invite
      className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/30 p-6 sm:p-10"
    >
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
        {t('expat_plan_eyebrow')}
      </p>
      <h2 className="max-w-[26ch] font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_plan_invite_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {t('expat_plan_invite_body')}
      </p>
      <Link
        to={signedIn ? '/for-expats/plan' : '/auth/signup?next=/for-expats/plan'}
        data-expat-plan-cta
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[hsl(var(--gold-hover))]"
      >
        {signedIn ? t('expat_plan_open') : t('expat_plan_start')}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Link>
    </section>
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
  return (
    <section data-expat-ecosystem>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_ecosystem_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {t('expat_ecosystem_body')}
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        {ECOSYSTEM.map((item, i) => (
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
