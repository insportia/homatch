import React from 'react';
import { SitePage } from './SitePage';
import { usePublishedPage } from './usePublishedPage';
import type { PageSlug } from '@/services/siteContent';

/**
 * THE BLOCKS AN ADMIN HAS ADDED TO THIS PAGE.
 *
 * Pricing, Partners, Mortgage, Privacy and Terms are written in JSX and are
 * staying that way. Rewriting five pages of shipped copy — legal text
 * included — into database rows would mean a bad save can leave a property
 * company with no terms of service, and the prize would be the ability to
 * edit prose that changes twice a year.
 *
 * So this sits WITH the coded page rather than replacing it: a band that
 * starts empty and holds whatever an admin adds, with the same blocks, the
 * same inline editing, the same reordering and the same undo as the pages
 * that are fully composed. Additive, and incapable of breaking what already
 * renders.
 *
 * It renders nothing at all until somebody adds something, so a page nobody
 * has touched is byte for byte the page that shipped.
 */
export function PageBlocks({ slug, except }: { slug: PageSlug; except?: readonly string[] }) {
  const published = usePublishedPage(slug);

  // No stored page, or a stored page with nothing in it: render nothing.
  // Not an empty wrapper — nothing, so there is no stray margin between the
  // coded content and the footer.
  if (!published || published.sections.length === 0) return null;

  /* `except` is how a page renders one of its own sections somewhere else.
     See SitePage's props: Pricing puts its heading above the plan grid and
     everything an admin adds below it. */
  return <SitePage slug={slug} content={published} except={except} />;
}
