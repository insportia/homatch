// HOMATCH — the public Main Page.
//
// This file is a running order, nothing else. Each region owns its own
// composition, geometry and copy (src/components/home/sections/), which is
// what keeps a ten-region editorial page from turning into one
// nine-hundred-line component nobody can safely change.
//
// THE STORY, IN ORDER
//
//   ask Homatch → find demand → find property → verify → understand
//   financing → reach people → run a development's sales operation →
//   see the market underneath it → what you get back → start.
//
// A visitor should be able to finish it in under a minute and come away
// knowing this is not a listings site, not only Verify, and not only
// matching.
//
// TWO RULES THAT DECIDED WHAT IS HERE
//
//  1. Every destination is a route that exists, and every control lands in
//     the real product. Product fragments inside the capability panels are
//     diagrams, not fake UI — nothing in them is clickable.
//  2. Nothing states a figure Homatch cannot stand behind. No counts, no
//     rates, no invented addresses; the one region that shows product output
//     marks itself illustrative in the UI.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { HeroSection } from '@/components/home/sections/HeroSection';
import { CoreIntelligenceSection } from '@/components/home/sections/CoreIntelligenceSection';
import { AISection } from '@/components/home/sections/AISection';
import { MarketingIntelligenceSection } from '@/components/home/sections/MarketingIntelligenceSection';
import { DeveloperB2BSection } from '@/components/home/sections/DeveloperB2BSection';
import { PlatformStorySection } from '@/components/home/sections/PlatformStorySection';
import { ResultPreviewSection } from '@/components/home/sections/ResultPreviewSection';
import { ClosingCTASection } from '@/components/home/sections/ClosingCTASection';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function HomePage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();

  const headerLinks: HeaderLink[] = [
    { key: 'capabilities', label: t('mp_nav_capabilities'), target: 'capabilities' },
    { key: 'how', label: t('mp_nav_how'), target: 'how' },
    { key: 'developers', label: t('mp_nav_developers'), target: 'developers' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'company', label: t('mp_nav_company'), target: 'company' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      <main>
        <HeroSection />                   {/* warm-white + hero photograph (lg+) */}
        <CoreIntelligenceSection />       {/* the four capabilities + cadastral  */}
        <AISection />                     {/* BLACK — how the intelligence flows */}
        <MarketingIntelligenceSection />  {/* AI Call Center + Email campaigns   */}
        <DeveloperB2BSection />           {/* BLACK — the largest region         */}
        <PlatformStorySection />          {/* city photograph — market/network   */}
        <ResultPreviewSection />          {/* BLACK — what you get back          */}
        <ClosingCTASection />             {/* cinematic closing photograph       */}
      </main>

      <SiteFooter />
    </div>
  );
}
