import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer, type HeaderLink } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { SitePage } from '@/site/render/SitePage';
import { usePublishedPage } from '@/site/render/usePublishedPage';

/**
 * HOMATCH FOR DEVELOPERS.
 *
 * WHY IT IS COMPOSED FROM SECTIONS RATHER THAN WRITTEN AS A PAGE
 *
 * Partners, Pricing, Privacy and Terms are JSX with a band of admin blocks
 * beside them, because their content changes twice a year and some of it is
 * legal text nobody should be able to delete by accident.
 *
 * This page is the opposite case. It is a commercial offer to a business
 * audience whose packaging is still being decided, in six languages, and
 * every sentence on it is something somebody will want to rephrase after the
 * first three conversations. So it is built the way the home page is: a
 * running order of registry sections, each field addressable, editable in
 * Site Studio, publishable without a deploy — and rendered from the shipped
 * order with shipped copy until somebody changes something, so it can never
 * come out empty.
 *
 * WHAT IS NOT ON IT
 *
 * No client logos, no customer counts, no conversion rates, no ROI. We do
 * not have those figures, and a page that prints them to look established is
 * making a claim rather than describing a product. The workflow
 * demonstration says in its own words that it is an illustration.
 */
export default function DevelopersPage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const published = usePublishedPage('developers');

  const headerLinks: HeaderLink[] = [
    { key: 'home', label: t('mp_nav_start'), target: '/' },
    { key: 'about', label: t('nav_about'), target: '/about' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'pricing', label: t('nav_pricing'), target: '/pricing' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />
      {/* `content` may be null — SitePage then renders the shipped order with
          no overrides, which is exactly the page this build ships. */}
      <main>
        <SitePage slug="developers" content={published} />
      </main>
      <SiteFooter />
    </div>
  );
}
