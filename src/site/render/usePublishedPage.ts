import { useEffect, useState } from 'react';
import { fetchPublishedPage, type PageSlug } from '@/services/siteContent';
import type { SitePageContent } from '../model';

/**
 * Published overrides for a public page.
 *
 * Starts at `null`, which the renderer reads as "no overrides" and draws the
 * site exactly as the code describes it. So the first paint is the real
 * design, immediately, with no session, no spinner and no layout shift — and
 * if the request never comes back, that first paint is simply what stays.
 *
 * The consequence is that overrides arrive a beat after the page does. That
 * is the right trade for a site that is mostly code-authored: the cost of an
 * override appearing on the second frame is a small correction, while the
 * cost of waiting is a blank screen on every visit for a feature most pages
 * are not using.
 */
export function usePublishedPage(slug: PageSlug): SitePageContent | null {
  const [content, setContent] = useState<SitePageContent | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchPublishedPage(slug).then(page => {
      if (alive && page) setContent(page);
    });
    return () => { alive = false; };
  }, [slug]);

  return content;
}
