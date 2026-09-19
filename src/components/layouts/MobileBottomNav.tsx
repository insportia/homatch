import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { LayoutDashboard, FileSignature, Shield, Sparkles, Bot } from 'lucide-react';

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
const items = [
  { key: 'nav_dashboard',  path: '/dashboard',  icon: LayoutDashboard },
  { key: 'nav_verify',     path: '/verify',     icon: Shield },
  { key: 'nav_ai',         path: '/ai',         icon: Bot, highlight: true },
  { key: 'nav_contracts',  path: '/contracts',  icon: FileSignature },
  { key: 'nav_live_chat',  path: '/live-chat',  icon: Sparkles },
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
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-card border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center justify-around h-16">
        {items.map(item => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5"
            >
              {/* The same gold bar the desktop rail draws beside an active
                  row, turned on its side. Previously the only signal was
                  foreground-vs-muted text, which on a phone in daylight is
                  not a signal. */}
              {active && (
                <span className="absolute inset-x-3 top-0 h-1 rounded-b-full bg-gold" aria-hidden="true" />
              )}
              <item.icon
                className={`h-5 w-5 ${
                  item.highlight
                    ? 'text-primary'
                    : active
                    ? 'text-gold-ink'
                    : 'text-muted-foreground'
                }`}
              />
              <span
                /* Georgian nav words are long and unhyphenated. At 320px
                   each of five slots is about 64px, which none of them
                   fit, so the label used to escape the bar. It truncates
                   instead — the icon above it carries the meaning — and
                   steps down one size only at the narrowest widths. */
                className={`w-full truncate text-center text-[12px] leading-tight sm:text-[13px] font-medium ${
                  item.highlight
                    ? 'text-primary'
                    : active
                    ? 'text-gold-ink'
                    : 'text-muted-foreground'
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
