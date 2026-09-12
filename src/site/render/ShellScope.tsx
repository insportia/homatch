import React, { useEffect, useState } from 'react';
import { SectionScope, useSectionScope } from '../content';
import { fetchPublishedPage } from '@/services/siteContent';
import type { SitePageContent, SiteSection } from '../model';

/**
 * THE HEADER AND FOOTER, AS EDITABLE CONTENT.
 *
 * Every other editable region belongs to a page. These two belong to the
 * SITE: the same header sits on seven pages, and an admin who renames
 * "Verify" expects it renamed everywhere rather than seven times.
 *
 * So they live on their own stored page, slug 'shell', which no route
 * renders. Site Studio opens it like any other page; the public site reads it
 * here.
 *
 * WHY ONE REQUEST, NOT TWO
 *
 * The header and the footer both need it, and they are siblings — neither can
 * hand it to the other. A module-level promise means the second asks for
 * something already in flight rather than repeating the request on every
 * page view.
 *
 * WHY IT IS NULL FIRST, AND WHY THAT IS THE POINT
 *
 * With no stored shell page — which is every environment until somebody edits
 * one — the header and footer render exactly the reviewed six-language copy
 * they render today. A failed request, a missing table and a revoked grant
 * are all the same answer: no overrides. This cannot take a navigation label
 * away, only replace one.
 */

/** In flight or resolved, once per page view. */
let shellRequest: Promise<SitePageContent | null> | null = null;

function loadShell(): Promise<SitePageContent | null> {
  shellRequest ??= fetchPublishedPage('shell');
  return shellRequest;
}

/** Test seam: forget what was fetched, so the next read asks again. */
export function resetShellCache(): void {
  shellRequest = null;
}

export function ShellScope({
  part, children,
}: { part: 'site_header' | 'site_footer'; children: React.ReactNode }) {
  const outer = useSectionScope();
  const [section, setSection] = useState<SiteSection | null>(null);

  /*
   * Inside Site Studio, the editor has already supplied the DRAFT section —
   * which is the whole point of a preview. Fetching the published one here
   * would replace it, and an admin would watch their edits vanish a moment
   * after making them.
   */
  const editing = outer.editing === true;

  useEffect(() => {
    if (editing) return;
    let alive = true;
    void loadShell().then(page => {
      if (!alive || !page) return;
      const found = page.sections.find(s => s.type === part) ?? null;
      // A hidden header is not something this product supports, so `enabled`
      // is read as "use the overrides" rather than "render nothing".
      setSection(found?.enabled ? found : null);
    });
    return () => { alive = false; };
  }, [part, editing]);

  if (editing) return <>{children}</>;
  return <SectionScope section={section}>{children}</SectionScope>;
}
