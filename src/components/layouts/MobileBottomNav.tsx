import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { NavGlyphIcon, type NavGlyphName } from './NavGlyph';

/*
 * FIVE SLOTS, ORDERED BY WHAT A PHONE IS ACTUALLY FOR.
 *
 * The bar used to end with Alerts (/active-search) — a saved-search digest,
 * which is a thing you check occasionally, sitting in the most valuable
 * navigation real estate the product has. Conversation is what a phone is
 * held for, so Live Chat takes that slot and Verify moves to the end, where
 * a deliberate, considered action belongs.
 *
 * Alerts is not gone: it is in the rail, under Workspace, one tap away
 * through the drawer. Nothing here is a route that exists only for this bar.
 *
 * Five and no more. A sixth at 320px gives each item 53px, which is under a
 * thumb and under any label in Georgian.
 *
 * ── WHY CONTRACTS IS HERE AND CHAT IS NOT ────────────────────────────
 *
 * Contracts became a product of its own, alongside Verify, Mortgage and
 * Investment. It was reachable on a phone only through the drawer, which is
 * access without discovery: nobody opens a hamburger looking for a product
 * they have not been told exists.
 *
 * The ceiling above is real, so something had to leave. Chat did, and it
 * left by the rule this bar already follows — the rail's own Communications
 * group lists Chat LAST, below Calls, WhatsApp, Email and Live Chat, so it
 * is that group's lowest-ranked member, and Communications still holds a
 * slot here through Live Chat. Chat is exactly as far away as Alerts is:
 * one tap on the drawer, under Communications.
 *
 * The result reads as a product bar rather than a feature bar — the two
 * intelligence products a buyer actually came for, flanking the assistant.
 */
/* Same drawn glyph family as the sidebar (NavGlyph.tsx) — one semantic
   icon per product across the whole shell, adapted to this bar's own
   geometry and color hierarchy rather than wearing the rail's tile. */
const items: Array<{ key: string; path: string; glyph: NavGlyphName; highlight?: boolean }> = [
  { key: 'nav_dashboard',  path: '/dashboard',  glyph: 'dashboard' },
  { key: 'nav_verify',     path: '/verify',     glyph: 'verify' },
  { key: 'nav_ai',         path: '/ai',         glyph: 'ai', highlight: true },
  { key: 'nav_contracts',  path: '/contracts',  glyph: 'contracts' },
  { key: 'nav_live_chat',  path: '/live-chat',  glyph: 'live_chat' },
];

export function MobileBottomNav() {
  const { t } = useLanguage();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav
      /* The mobile sweep measures this bar at every width, font and
         language: item widths, touch heights and how much of each label
         survives. A stable hook, because a Tailwind class is a styling
         decision and a test should not break when one changes. */
      data-mobile-nav
      /*
        CHROME, NOT A PANEL. A hard top border and an opaque card ground made this read as
        a block stuck to the bottom of the page. A hairline at a third of its strength
        plus a blurred translucent ground lets the content scroll UNDER it, which is what
        tells somebody there is more below.
      */
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-[#0C1119]/[0.96] backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-stretch justify-around h-[3.75rem]">
        {items.map(item => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 pt-1.5 focus-visible:outline-none"
            >
              {/*
                THE MARK IS BEHIND THE ICON, which is where the thumb goes.
                It was a bar pinned to the bar's own top edge — against the content above
                it, at the far end of the tap target from the thing being tapped. A soft
                gold pill behind the live icon is found without being looked for.
              */}
              <span
                aria-hidden="true"
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                  active && !item.highlight ? 'bg-[hsl(38_92%_56%)]/[0.18]' : ''
                }`}
              >
                <NavGlyphIcon
                  name={item.glyph}
                  className={`h-[1.2rem] w-[1.2rem] ${
                    item.highlight
                      ? 'text-[hsl(38_92%_60%)]'
                      : active
                      ? 'text-[hsl(38_92%_60%)]'
                      : 'text-white/60'
                  }`}
                  strokeWidth={active ? 2 : 1.75}
                />
              </span>
              <span
                /* Georgian nav words are long and unhyphenated. At 320px
                   each of five slots is about 64px, which none of them
                   fit, so the label used to escape the bar. It truncates
                   instead — the icon above it carries the meaning — and
                   steps down one size only at the narrowest widths. */
                className={`w-full truncate text-center text-[12px] leading-tight sm:text-[13px] ${
                  item.highlight
                    ? 'font-semibold text-white/90'
                    : active
                    ? 'font-semibold text-white'
                    : 'font-medium text-white/60'
                }`}
              >
                {t(item.key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
