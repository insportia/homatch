// HOMATCH — the public Main Page.
//
// The page frame: header, the regions, footer. Each region owns its own
// composition and copy (src/components/home/sections/); the running order
// lives in src/site/render/order.ts so Site Studio can reorder and hide
// regions without this file changing. With nothing published, SitePage
// renders exactly the shipped order and copy.
//
// THE STORY, IN ORDER
//
//   what Homatch is, and the two ways in → the owner's path and the buyer's
//   path, with the public tools around them → where demand comes from and
//   what a match is → check the property → read the contract → what a match
//   looks like to the owner → plan the money → for professionals → start.
//
// THE RULES THAT DECIDED WHAT IS HERE
//
//  1. Every control lands somewhere real. The two authenticated products
//     (Find Property, the owner workspace) go to their public entry pages for
//     a visitor with no account and to the product for somebody signed in;
//     the public tools open directly. Nothing sends a visitor to a login
//     bounce with no explanation.
//  2. Nothing states a figure Homatch cannot stand behind. No counts, no
//     customers, no testimonials, no listings, no live activity. The product
//     illustrations are structure — field names, fit words, reasons — and a
//     match is always "potential interest", never a confirmed buyer.
//  3. The public site has its own presentation system, `.hm-public` in
//     src/index.css: white ground, ink, hairlines, gold as a signal only.
//     It is not the customer app's scope and does not borrow one.
import React from 'react';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SitePage } from '@/site/render/SitePage';
import { usePublishedPage } from '@/site/render/usePublishedPage';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function HomePage() {
  useSurfaceTheme('light');
  const published = usePublishedPage('home');

  const headerLinks = usePublicNavLinks({ onHome: true });

  return (
    <div className="hm-public min-h-screen overflow-x-hidden">
      <PublicHeader links={headerLinks} />
      <HeaderSpacer />

      <main>
        <SitePage slug="home" content={published} />
      </main>

      <SiteFooter />
    </div>
  );
}
