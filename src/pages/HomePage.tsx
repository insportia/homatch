// HOMATCH — the public Main Page.
//
// This file is a running order, nothing else. Each region owns its own
// composition, geometry and copy (src/components/home/sections/), which is
// what keeps a twelve-region editorial page from turning into one
// nine-hundred-line component nobody can safely change.
//
// The supplied design reference is the source of truth for COMPOSITION; the
// Homatch codebase is the source of truth for CONTENT and FUNCTION. The
// region map that reconciles the two is in
// docs/design/main-page-reference-map.md and was written before this pass.
//
// TWO RULES THAT DECIDED WHAT IS HERE
//
//  1. Every destination is a route that exists, and every control lands in
//     the real product. There are no decorative buttons on this page.
//  2. Nothing states a figure Homatch cannot stand behind. The reference's
//     metrics (10,000+ users, 500+ brokers, 99.9% uptime) are generator
//     fiction, so the hero's proof strip carries three true statements
//     instead, and the one region that shows product output marks itself
//     illustrative in the UI.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { HeroSection } from '@/components/home/sections/HeroSection';
import { PrimaryIntentSection } from '@/components/home/sections/PrimaryIntentSection';
import { AISection } from '@/components/home/sections/AISection';
import { CapabilitiesSection } from '@/components/home/sections/CapabilitiesSection';
import { VerificationSection } from '@/components/home/sections/VerificationSection';
import { ProcessSection } from '@/components/home/sections/ProcessSection';
import { ResultPreviewSection } from '@/components/home/sections/ResultPreviewSection';
import { ProfessionalToolsSection } from '@/components/home/sections/ProfessionalToolsSection';
import { PlatformStorySection } from '@/components/home/sections/PlatformStorySection';
import { ClosingCTASection } from '@/components/home/sections/ClosingCTASection';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function HomePage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();

  const headerLinks: HeaderLink[] = [
    { key: 'capabilities', label: t('mp_nav_capabilities'), target: 'capabilities' },
    { key: 'how', label: t('mp_nav_how'), target: 'how' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'partners', label: t('home_nav_partners'), target: '/partners' },
    { key: 'company', label: t('mp_nav_company'), target: 'company' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      {/* The running order, and the tonal rhythm it produces. Each image lands
          where the approved artwork was assigned, with content between every
          pair so no two photographs sit in the same register back to back. */}
      <main>
        <HeroSection />              {/* cream + hero photograph            */}
        <PrimaryIntentSection />     {/* cream                              */}
        <AISection />                {/* NAVY                               */}
        <CapabilitiesSection />      {/* cream                              */}
        <VerificationSection />      {/* stone + verification photograph    */}
        <PlatformStorySection />     {/* city photograph + network overlay  */}
        <ProcessSection />           {/* cream                              */}
        <ResultPreviewSection />     {/* NAVY                               */}
        <ProfessionalToolsSection /> {/* cream                              */}
        <ClosingCTASection />        {/* cinematic closing photograph       */}
      </main>

      <SiteFooter />
    </div>
  );
}
