// HOMATCH — an in-page view that replaces the whole screen starts at its top.
//
// Some products swap their entire screen without changing the URL: Investment
// goes from "choose a strategy" to that strategy's workspace in place. To the
// person it is a new page, and ScrollToTop never hears about it because the
// path did not change, so the workspace opened wherever the strategy card had
// been, usually near the bottom (owner, 2026-10-25).
//
// Keyed on the view, never on the first render: arriving on the page is
// ScrollToTop's business, and a second jump on mount would be its own jank.

import { useLayoutEffect, useRef } from 'react';

export function useScrollTopOnChange(view: unknown): void {
  const last = useRef(view);
  useLayoutEffect(() => {
    if (Object.is(last.current, view)) return;
    last.current = view;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [view]);
}
