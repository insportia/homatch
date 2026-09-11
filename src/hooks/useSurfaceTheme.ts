import { useLayoutEffect } from 'react';

export type Surface = 'light';

/**
 * Opts a screen into an alternate Homatch surface palette for as long as it
 * is mounted.
 *
 * WHY <html> AND NOT A WRAPPER DIV
 *
 * The token overrides live on `:root[data-surface='…']` (see index.css).
 * Scoping them to a wrapper element would look identical *until* something
 * opens a Radix portal — dropdown menus, dialogs, sheets, the language
 * switcher — because those render into document.body, outside any wrapper,
 * and would keep rendering with the dark palette on top of a light page.
 * Stamping the attribute on the document element covers portalled content
 * too, while screens that never call this hook are untouched.
 *
 * WHY A COUNTER AND NOT A BOOLEAN
 *
 * React runs the effect of the *next* screen before the cleanup of the
 * previous one during a route transition. Two light screens in a row
 * (Dashboard → Home) would therefore run set → set → clear and strip the
 * attribute off a page that still wants it. Counting active claimants and
 * only clearing on the last release makes the hook safe to call from any
 * number of simultaneously-mounted components.
 */
let claims = 0;

export function useSurfaceTheme(surface: Surface) {
  // Layout effect, not effect: this runs before the browser paints, so a
  // light screen never flashes the dark palette for a frame on navigation.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-surface');
    claims += 1;
    root.setAttribute('data-surface', surface);

    return () => {
      claims -= 1;
      if (claims > 0) return;
      if (previous) root.setAttribute('data-surface', previous);
      else root.removeAttribute('data-surface');
    };
  }, [surface]);
}
