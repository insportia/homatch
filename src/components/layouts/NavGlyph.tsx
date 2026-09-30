import React from 'react';

/*
 * THE CUSTOMER NAVIGATION'S OWN ICON FAMILY.
 *
 * One drawn set, deliberately UNIFORM — deep navy tile, crisp white
 * silhouette, one small gold accent per glyph — because a sidebar is
 * navigation and navigation reads best as a single visual language. (The
 * homepage's three service icons are the opposite case on purpose: services
 * carry individual color identities; navigation carries one.)
 *
 * Every glyph is semantic: the accent is the PRODUCT'S OWN detail — the
 * check inside Verify's shield, the coin on the mortgage roof, the pin on
 * the expat globe — not decoration sprinkled on a generic icon.
 *
 * Drawn on a 24×24 grid, silhouette in currentColor so each surface decides
 * the ink (white/85 in the rail tile, the bottom bar's own hierarchy on the
 * phone), accent pinned to HOMATCH gold so it carries on navy everywhere.
 */

export type NavGlyphName =
  | 'dashboard' | 'properties' | 'find_property' | 'brokers' | 'expats' | 'design_studio'
  | 'verify' | 'contracts' | 'mortgage' | 'investment'
  | 'calls' | 'whatsapp' | 'email' | 'live_chat' | 'chat' | 'meta_ads'
  | 'ai' | 'activity' | 'notifications' | 'credits' | 'profile';

const GOLD = 'hsl(38 92% 58%)';

/** stroke-only helper attrs shared by every silhouette path. */
const S = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<NavGlyphName, React.ReactNode> = {
  /* Overview: three quiet panels, the live one gold. */
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.6" {...S} />
      <rect x="3.5" y="16.5" width="7.5" height="4" rx="1.4" {...S} />
      <rect x="14" y="11" width="6.5" height="9.5" rx="1.6" {...S} />
      <rect x="14" y="3.5" width="6.5" height="4.5" rx="1.4" fill={GOLD} stroke="none" />
    </>
  ),
  /* The owner workspace: the home, and the agreement it exists to reach. */
  properties: (
    <>
      <path d="M4 10.6 12 4l8 6.6" {...S} />
      <path d="M6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h9.2A1.4 1.4 0 0 0 18 19V9.4" {...S} />
      <path d="M9.2 15.6l1.9 1.7 3.7-3.6" fill="none" stroke={GOLD} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Find Property: the home being read by the lens. */
  find_property: (
    <>
      <path d="M4 10.2 10.6 5l6.6 5.2v7.4A1.4 1.4 0 0 1 15.8 19H5.4A1.4 1.4 0 0 1 4 17.6z" {...S} />
      <circle cx="16.6" cy="15.6" r="3.5" fill="none" stroke={GOLD} strokeWidth="1.9" />
      <path d="M19.2 18.2 21 20" stroke={GOLD} strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
  /* Brokers: the professional pair, the introduction marked gold. */
  brokers: (
    <>
      <circle cx="8.2" cy="8.6" r="2.7" {...S} />
      <path d="M3.8 19.2a4.6 4.6 0 0 1 8.8 0" {...S} />
      <circle cx="16.6" cy="9.6" r="2.2" {...S} />
      <path d="M14 18.4a3.9 3.9 0 0 1 6.4-1.8" {...S} />
      <circle cx="12.4" cy="13.4" r="1.5" fill={GOLD} stroke="none" />
    </>
  ),
  /* For Expats: the globe, the destination pinned. */
  expats: (
    <>
      <circle cx="11" cy="12" r="7.5" {...S} />
      <path d="M3.9 9.8h14.2M3.9 14.2h14.2M11 4.5c-2 2.2-2 12.8 0 15" {...S} />
      <path d="M18.6 11.2a3 3 0 0 1 3 3c0 2.2-3 5.3-3 5.3s-3-3.1-3-5.3a3 3 0 0 1 3-3z" fill={GOLD} stroke="none" />
      <circle cx="18.6" cy="14.2" r="1.1" fill="#101623" stroke="none" />
    </>
  ),
  /* Verify: the shield, and the confirmation inside it. */
  verify: (
    <>
      <path d="M12 3.6 5 6.2v5.3c0 4.4 3 7.4 7 8.9 4-1.5 7-4.5 7-8.9V6.2z" {...S} />
      <path d="M8.9 12.1l2.2 2.2 4-4.1" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Contracts: the document, read and sealed. */
  contracts: (
    <>
      <path d="M6.5 3.8h7.2L18 8.1v10.6a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.7V5.3a1.5 1.5 0 0 1 1.5-1.5z" {...S} />
      <path d="M13.7 3.8V8.1H18" {...S} />
      <path d="M8 12h6M8 15.2h4" {...S} />
      <circle cx="16.2" cy="17.2" r="3" fill={GOLD} stroke="none" />
      <path d="M15 17.2l.9.9 1.6-1.7" fill="none" stroke="#101623" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Mortgage: the home, financed — the coin sits where the cost does. */
  mortgage: (
    <>
      <path d="M4 10.6 12 4l8 6.6" {...S} />
      <path d="M6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h9.2A1.4 1.4 0 0 0 18 19V9.4" {...S} />
      <circle cx="12" cy="14.6" r="3.1" fill={GOLD} stroke="none" />
      <path d="M12 12.9v3.4M10.6 14.6h2.8" stroke="#101623" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  /* Investment: measured columns, the trend drawn in gold. */
  investment: (
    <>
      <path d="M4.5 20V9.8M10 20v-6.6M15.5 20V11M21 20H3.6" {...S} />
      <path d="M5 7.6l5.4 3 4.8-4.2 3.8 1.6" fill="none" stroke={GOLD} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.6 4.4h3v3" fill="none" stroke={GOLD} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* AI Calls: the handset, speaking. */
  calls: (
    <>
      <path d="M5.2 4.4h3l1.5 3.8-2 1.6a11.6 11.6 0 0 0 5.5 5.5l1.6-2 3.8 1.5v3a1.6 1.6 0 0 1-1.8 1.6C9.9 18.7 5.3 14.1 4.6 6.2a1.6 1.6 0 0 1 .6-1.8z" {...S} />
      <path d="M14.6 6.2a4.6 4.6 0 0 1 3.2 3.2M15.4 3.2a7.6 7.6 0 0 1 5.4 5.4" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  /* WhatsApp channel: the bubble that answers. */
  whatsapp: (
    <>
      <path d="M12 4a8 8 0 0 1 0 16 8.2 8.2 0 0 1-3.6-.8L4.4 20l.9-3.8A8 8 0 0 1 12 4z" {...S} />
      <path d="M9.3 9.6c.4-1 1.4-1 1.8-.1l.4.9-.8 1a5.8 5.8 0 0 0 2 1.9l1-.7.9.4c.9.5.8 1.5-.2 1.8-2.6.9-6.3-2.7-5.1-5.2z" fill={GOLD} stroke="none" />
    </>
  ),
  /* Meta Ads: the megaphone, with the gold burst that is the ad itself. */
  meta_ads: (
    <>
      <path d="M5 10v4h3l7 4V6l-7 4H5z" {...S} />
      <path d="M18.5 9.2l2-1.2M18.5 14.8l2 1.2M19 12h2.6" stroke={GOLD} strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
  /* Email campaigns: the envelope, sent. */
  email: (
    <>
      <rect x="3.5" y="6" width="14" height="11" rx="1.6" {...S} />
      <path d="M4.5 7.5 10.5 12l6-4.5" {...S} />
      <path d="M16 17.8l5-2.6-5-2.6.9 2.6z" fill={GOLD} stroke="none" />
    </>
  ),
  /* Live chat: the conversation happening NOW. */
  live_chat: (
    <>
      <path d="M4 6.8A2.3 2.3 0 0 1 6.3 4.5h9.4A2.3 2.3 0 0 1 18 6.8v6a2.3 2.3 0 0 1-2.3 2.3H9.6L5.8 18.5v-3.4H6A2.3 2.3 0 0 1 4 12.8z" {...S} />
      <circle cx="8.4" cy="9.9" r="1.1" fill={GOLD} stroke="none" />
      <circle cx="11.7" cy="9.9" r="1.1" fill={GOLD} stroke="none" />
      <circle cx="15" cy="9.9" r="1.1" fill={GOLD} stroke="none" />
      <path d="M19.6 9.4a4.3 4.3 0 0 1 0 5.8" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  /* Design Studio: a room's corner — two walls and the floor they stand on —
     and the gold swatch being tried on that floor. Space first, design on it. */
  design_studio: (
    <>
      <path d="M4 7.6 12 3.6l8 4v8l-8-4-8 4z" {...S} />
      <path d="M12 3.6v8" {...S} />
      <path d="M12 15.4l3.6 1.9-3.6 1.9-3.6-1.9z" fill={GOLD} stroke="none" />
    </>
  ),
  /* Messages: two people's bubbles. */
  chat: (
    <>
      <path d="M4 6.6A2.1 2.1 0 0 1 6.1 4.5h7.3a2.1 2.1 0 0 1 2.1 2.1v3.8a2.1 2.1 0 0 1-2.1 2.1H8.9L6 14.8v-2.3h.1A2.1 2.1 0 0 1 4 10.4z" {...S} />
      <path d="M11 15.9a2 2 0 0 0 2 1.9h3.6l2.9 2.2v-2.2a2 2 0 0 0 .5-3.9" {...S} />
      <path d="M8 8.5h4" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  /* The assistant: HOMATCH intelligence, sparked. */
  ai: (
    <>
      <rect x="5" y="7.5" width="14" height="10.5" rx="2.4" {...S} />
      <path d="M12 4.4v3.1M9 21h6" {...S} />
      <circle cx="9.4" cy="12.6" r="1.2" fill={GOLD} stroke="none" />
      <circle cx="14.6" cy="12.6" r="1.2" fill={GOLD} stroke="none" />
      <path d="M19.9 4.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill={GOLD} stroke="none" />
    </>
  ),
  /* Activity: the timeline, the latest event live. */
  activity: (
    <>
      <circle cx="12" cy="12" r="8" {...S} />
      <path d="M12 7.6V12l3 1.9" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Notifications: the bell, ringing once. */
  notifications: (
    <>
      <path d="M6.3 16.6V11a5.7 5.7 0 0 1 11.4 0v5.6l1.6 2H4.7z" {...S} />
      <path d="M10.2 20.6a2 2 0 0 0 3.6 0" {...S} />
      <circle cx="17" cy="6.4" r="2.4" fill={GOLD} stroke="none" />
    </>
  ),
  /* Credits: stored value. */
  credits: (
    <>
      <rect x="3.5" y="6.5" width="17" height="11.5" rx="2" {...S} />
      <path d="M3.5 10.2h17" {...S} />
      <circle cx="17" cy="14.4" r="1.5" fill={GOLD} stroke="none" />
    </>
  ),
  /* Profile: the account. */
  profile: (
    <>
      <circle cx="12" cy="9" r="3.4" {...S} />
      <path d="M5.4 19.6a6.9 6.9 0 0 1 13.2 0" {...S} />
      <circle cx="16.8" cy="6.4" r="1.4" fill={GOLD} stroke="none" />
    </>
  ),
};

/** The bare glyph — for surfaces that own their color hierarchy (the mobile
    bottom bar). Silhouette follows currentColor; the accent stays gold. */
export function NavGlyphIcon({
  name, className, strokeWidth = 1.75,
}: { name: NavGlyphName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

/**
 * The sidebar treatment: a compact navy tile the glyph sits in.
 *
 * DEFAULT  navy tile, white silhouette, gold accent, hairline ring.
 * HOVER    (via the row's `group`) the ring warms and the ink brightens.
 * ACTIVE   the silhouette itself turns gold and the ring says so.
 */
export function NavGlyph({ name, active = false }: { name: NavGlyphName; active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[0.55rem] bg-[#101623] ring-1 ring-inset transition-colors ${
        active
          ? 'text-[hsl(38_92%_62%)] ring-[hsl(38_92%_56%)]/60'
          : 'text-white/85 ring-white/10 group-hover:text-white group-hover:ring-[hsl(38_92%_56%)]/40'
      }`}
    >
      <NavGlyphIcon name={name} className="h-[18px] w-[18px]" strokeWidth={active ? 1.9 : 1.75} />
    </span>
  );
}
