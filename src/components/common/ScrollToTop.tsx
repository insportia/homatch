// HOMATCH — a new page starts at the beginning of itself.
//
// React Router does not scroll on navigation and never has: it swaps the
// elements and leaves the viewport where it was. So reading to the bottom of
// the home page and then opening Investment put the customer at the bottom of
// Investment, looking at whatever happened to be there, with no indication
// that they had arrived anywhere. The page had loaded correctly and looked
// broken.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// Back and forward are left alone. The browser restores the position it
// remembers for a POP, and that is the behaviour a person expects from the
// back button — returning to a list at the item they clicked, not at its top.
//
// Anchors are left alone. A location carrying a hash was asked to land on a
// particular element, and forcing the top would be undoing the request.
//
// The QUERY is left alone. This keys on pathname only, so a tab, a filter, a
// page of results or a drawer that writes to the search string does not
// yank the viewport back to the top while somebody is reading — the exact
// failure this kind of fix usually introduces.

import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const ScrollToTop: React.FC = () => {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  /*
   * Layout effect, not effect: this runs before the browser paints, so the
   * new page is never briefly visible at the old scroll position.
   */
  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    if (hash) return;
    /* `instant` rather than smooth — a page ARRIVING should already be at its
       top, not animate there while the reader watches. */
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash, navigationType]);

  return null;
};

export default ScrollToTop;
