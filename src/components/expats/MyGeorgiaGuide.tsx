// MY GEORGIA BY HOMI — the living guide tab.
//
// This was the For Expats landing page. The owner moved it inside My Georgia
// (2026-10-25): For Expats now opens My Georgia, and the guide is one of its
// tabs. Same content, same order of need: the cities at a glance, what you
// need and the steps for it, every sourced topic, what changed lately, and the
// rest of HOMATCH. Open to everyone, signed in or not (§66).

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, FileSignature, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import { GeorgiaAtAGlance } from '@/components/expats/GeorgiaAtAGlance';
import { GuideHub } from '@/components/expats/GuideHub';
import { WhatChanged } from '@/components/expats/WhatChanged';
import WhatDoYouNeed from '@/components/expats/WhatDoYouNeed';
import { PageBlocks } from '@/site/render/PageBlocks';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePathAvailable } from '@/lib/serviceControls';
import type { GUIDE_CATEGORIES } from '@/myGeorgia/answers';
import type { ExpatTopic, ExpatUpdate } from '@/services/expats';

export function MyGeorgiaGuide({
  topics,
  updates,
  categories,
}: {
  topics: ExpatTopic[];
  updates: readonly ExpatUpdate[];
  /** The person's own order of categories, when there is a profile. */
  categories?: readonly (typeof GUIDE_CATEGORIES)[number][];
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-12" data-mg-guide>
      <div className="overflow-hidden rounded-3xl bg-[#0C1119] p-6 text-white sm:p-8">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">{t('mg_guide_title')}</h2>
        <p className="mt-2 max-w-[56ch] text-white/75">{t('mg_guide_sub')}</p>
      </div>

      <GeorgiaAtAGlance />

      <div id="needs" className="scroll-mt-24">
        <WhatDoYouNeed topics={topics} />
      </div>

      <div id="topics" className="scroll-mt-24">
        <section data-expat-guide>
          <h2 className="mb-6 font-display text-2xl font-semibold text-foreground sm:text-3xl">{t('expat_topics_title')}</h2>
          <GuideHub topics={topics} categories={categories} />
        </section>
      </div>

      <WhatChanged updates={updates} />

      <div id="tools" className="scroll-mt-24">
        <Ecosystem />
      </div>

      {/* Whatever an admin has added to the For Expats page. Additive: the guidance and
          the tools above are product rather than copy. */}
      <PageBlocks slug="expat" />
    </div>
  );
}

/**
 * The rest of HOMATCH, as a sentence rather than a grid: rows describing what
 * each product answers, in the order a purchase actually happens.
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
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{t('expat_ecosystem_title')}</h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{t('expat_ecosystem_body')}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        {ECOSYSTEM.filter((item) => pathAvailable(item.to)).map((item, i) => (
          <Link
            key={item.key}
            to={item.to}
            data-expat-ecosystem-link={item.key}
            className={`group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent motion-reduce:transition-none ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <item.icon className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{t(`expat_eco_${item.key}_title`)}</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">{t(`expat_eco_${item.key}_body`)}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default MyGeorgiaGuide;
