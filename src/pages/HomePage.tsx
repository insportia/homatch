// HOMATCH — the public Main Page.
//
// This file is a running order, nothing else. Each region owns its own
// composition, geometry and copy (src/components/home/sections/).
//
// THE STORY, IN ORDER
//
//   what Homatch is → do something with it now → what it understands →
//   the AI that makes the calls → what a property check gives you →
//   how demand is found → the assistant → developers → start.
//
// WHAT CHANGED, AND WHY
//
// The previous order opened with an abstract couplet and then walked a
// visitor through five editorial bands before offering anything to press.
// It read as a well-set magazine article about a platform. The product is
// now second on the page: REGION 02 is a launcher of real tasks, and
// everything after it exists to explain one of those tasks rather than to
// set a mood.
//
// THREE RULES THAT DECIDED WHAT IS HERE
//
//  1. Every destination is a route that exists (see routes.tsx), and every
//     control lands in the real product. There is no "compare properties"
//     anywhere on this page, because Homatch has no comparison feature.
//  2. Nothing states a figure Homatch cannot stand behind. No counts, no
//     conversion rates, no invented transcripts; the two regions that show
//     product output mark themselves illustrative in the UI itself.
//  3. Black, white and gold. The only other colours on the page belong to
//     the capability glyphs in the launcher, which are product identities,
//     not page chrome.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { HeroSection } from '@/components/home/sections/HeroSection';
import { ActionLauncherSection } from '@/components/home/sections/ActionLauncherSection';
import { IntelligenceLayersSection } from '@/components/home/sections/IntelligenceLayersSection';
import { CallCenterSection } from '@/components/home/sections/CallCenterSection';
import { VerifyShowcaseSection } from '@/components/home/sections/VerifyShowcaseSection';
import { MatchingShowcaseSection } from '@/components/home/sections/MatchingShowcaseSection';
import { AISection } from '@/components/home/sections/AISection';
import { DeveloperB2BSection } from '@/components/home/sections/DeveloperB2BSection';
import { ClosingCTASection } from '@/components/home/sections/ClosingCTASection';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function HomePage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();

  const headerLinks: HeaderLink[] = [
    { key: 'start', label: t('mp_nav_start'), target: 'start' },
    { key: 'intelligence', label: t('mp_nav_capabilities'), target: 'intelligence' },
    { key: 'calls', label: t('call_center_title'), target: 'call-center' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'developers', label: t('mp_nav_developers'), target: 'developers' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      <main>
        <HeroSection />                  {/* BLACK  — what Homatch is           */}
        <ActionLauncherSection />        {/* WHITE  — start a real task now     */}
        <IntelligenceLayersSection />    {/* BLACK  — the seven layers          */}
        <CallCenterSection />            {/* BLACK  — AI Call Center, alone     */}
        <VerifyShowcaseSection />        {/* WHITE  — what a check gives back   */}
        <MatchingShowcaseSection />      {/* BLACK  — property → interested people */}
        <AISection />                    {/* WHITE  — the assistant             */}
        <DeveloperB2BSection />          {/* BLACK  — developers                */}
        <ClosingCTASection />            {/* photograph, graded to black        */}
      </main>

      <SiteFooter />
    </div>
  );
}
