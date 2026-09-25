// HOMATCH — About.
//
// WHAT THIS PAGE IS FOR
//
// Somebody who lands here has usually arrived from a search or a link and
// has not seen the homepage. They should be able to leave understanding the
// product, not the company. So there is no timeline, no team grid, no
// mission card and no founding story: the page explains what Homatch
// actually does, what it is built on top of, who it is for, and what it
// refuses to claim.
//
// WHAT IT DOES NOT CLAIM
//
//  1. Not "the first" anything. That is a claim about the whole Georgian
//     market which nothing in this repository can substantiate, and a
//     superlative nobody can check is worth less than a specific sentence
//     that is true. The positioning is "built in Georgia", which is.
//  2. Not complete coverage of every property in Georgia. The page says
//     Homatch is built to work ACROSS these property types, because that is
//     what the product is designed around, and says nothing about how much
//     of the market is indexed.
//  3. No supplier names, no provider architecture, no scraping detail. The
//     sources section is about the BREADTH of what gets looked at, which is
//     the part that matters to a buyer, and not about how it is fetched.
//  4. No legal representation, no guaranteed safety, no transaction
//     promise. Homatch gathers evidence and explains it. The closing
//     section says exactly that.
//
// The six regions themselves are in components/home/sections/about.tsx, and
// their order is DEFAULT_ABOUT_ORDER in site/render/SitePage.tsx, so Site
// Studio can re-word and reorder them. Nothing published means this page
// renders exactly as described above.
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import LocalSectionNav from '@/components/common/LocalSectionNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { SitePage } from '@/site/render/SitePage';
import { usePublishedPage } from '@/site/render/usePublishedPage';

export default function AboutPage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const published = usePublishedPage('about');

  const headerLinks = usePublicNavLinks();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      {/*
        * The page's own three sections, restored as LOCAL navigation.
        * They used to be in the site header, where they competed with
        * Verify and Pricing as though a part of this page were a product
        * area of its own.
        */}
      <LocalSectionNav
        ariaLabelKey="nav_on_this_page"
        sections={[
          { id: 'what', labelKey: 'about_nav_what' },
          { id: 'market', labelKey: 'about_nav_market' },
          { id: 'sources', labelKey: 'about_nav_sources' },
        ]}
      />

      <main>
        <SitePage slug="about" content={published} />
      </main>

      <SiteFooter />
    </div>
  );
}
