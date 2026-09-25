import React from 'react';
import { PublicHeader } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';

/**
 * THE HEADER, AS SITE STUDIO SEES IT.
 *
 * The real component, with the real navigation the home page passes it, so
 * what an admin edits is the header they will get. Two differences, both
 * forced by the canvas rather than chosen:
 *
 *   `solid`, because the transparent state only works over a full-bleed black
 *   hero, and in the editor this block is on its own.
 *
 *   NOT fixed. On the real site the header is pinned to the viewport; in the
 *   preview that viewport is the iframe, so a fixed header would float over
 *   the footer beneath it and over its own editing controls. It is put back
 *   in the flow here, by the one CSS rule that does it, rather than by
 *   threading a prop through a component that has no business knowing it is
 *   being previewed.
 */
export function SiteHeaderBlock() {

  /*
   * The same navigation the site renders, from the same file. The Studio
   * preview showing a DIFFERENT set of links than the live header is how
   * Investment came to be missing from one and not the other.
   */
  const links = usePublicNavLinks({ onHome: true });

  return (
    <div className="relative [&>header]:!static">
      <PublicHeader links={links} solid />
    </div>
  );
}
