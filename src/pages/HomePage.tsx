// HOMATCH — the public Main Page.
//
// The page frame: header, the regions, footer. Each region owns its own
// composition, geometry and copy (src/components/home/sections/).
//
// The running order itself now lives in src/site/render/SitePage.tsx, as
// DEFAULT_HOME_ORDER, so that Site Studio can reorder and hide regions
// without this file changing. With nothing published, SitePage renders
// exactly the order and copy described below.
//
// THE STORY, IN ORDER
//
//   what Homatch is → do something with it now → what it understands →
//   what a property check gives you → what the contract says → how demand
//   is found → what the purchase costs → the AI that makes the calls → the
//   campaigns that follow them → the assistant behind all of it →
//   developers → start.
//
// EQUAL PRODUCTS, DIFFERENT SHAPES
//
// Every capability below is a shipped product on a real route, and none of
// them is presented as an accessory to another. What differs is the SHAPE of
// each region, because what each product does differs: Verify takes a code,
// matching produces a shortlist, financing produces a scenario, a call is a
// live event, a campaign is a thing you assemble. Rhythm comes from that,
// not from giving one feature a section and another a footnote.
//
// THREE RULES THAT DECIDED WHAT IS HERE
//
//  1. Every destination is a route that exists (see routes.tsx), and every
//     control lands in the real product. There is no "compare properties"
//     anywhere on this page, because Homatch has no comparison feature.
//  2. Nothing states a figure Homatch cannot stand behind. No counts, no
//     conversion rates, no invented transcripts, no fabricated payments; the
//     regions that show product output mark themselves illustrative in the
//     interface, and the financing region says outright that Homatch neither
//     arranges the loan nor promises approval.
//  3. Black, white and gold. The only other colours belong to the capability
//     glyphs, which are product identities rather than page chrome.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { SitePage } from '@/site/render/SitePage';
import { usePublishedPage } from '@/site/render/usePublishedPage';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function HomePage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const published = usePublishedPage('home');

  const headerLinks: HeaderLink[] = [
    { key: 'start', label: t('mp_nav_start'), target: 'start' },
    { key: 'intelligence', label: t('mp_nav_capabilities'), target: 'intelligence' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'developers', label: t('mp_nav_developers'), target: 'developers' },
    { key: 'about', label: t('nav_about'), target: '/about' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      <main>
        <SitePage slug="home" content={published} />
      </main>

      <SiteFooter />
    </div>
  );
}
