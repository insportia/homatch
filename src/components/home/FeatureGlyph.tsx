import React from 'react';

/**
 * THE ACTION-LAUNCHER ICON SYSTEM
 *
 * The page chrome is black, white and gold. These are the one sanctioned
 * exception: each Homatch capability gets its own drawn identity in its own
 * colour, the way a product's app icons differ from its interface.
 *
 * WHY NOT LUCIDE
 *
 * The launcher's job is to make someone want to press a card. A 20px
 * uniform-stroke outline glyph cannot do that — a row of them reads as a
 * settings list, which is exactly how the previous pass failed. These are
 * built as two-tone illustrations: a solid primary shape, a darker shade for
 * depth, a white cut-out for detail, on a tinted tile. Lucide is still the
 * right answer for everything else on the page and is used everywhere else.
 *
 * HOW THEY STAY A FAMILY
 *
 * One 64-unit grid, one tile radius, one optical weight, one construction
 * (tile → primary mass → darker accent → white detail). Only the hue and the
 * subject change. Nothing here animates on its own; the card supplies the
 * hover, and `motion-reduce` on the card governs it.
 */

export type GlyphName =
  | 'verify'
  | 'contract'
  | 'matching'
  | 'ai'
  | 'property'
  | 'mortgage'
  | 'calls';

interface Palette {
  /** The tile behind the art. */
  tile: string;
  /** The primary mass. */
  base: string;
  /** The darker shade that gives it depth. */
  deep: string;
}

/* Each capability's colour, chosen to be unmistakably distinct from its
   neighbours in the launcher grid and legible on both white and black. */
const PALETTES: Record<GlyphName, Palette> = {
  verify: { tile: '#E4F5EC', base: '#12A06B', deep: '#0A6E49' },
  contract: { tile: '#EDE8FF', base: '#7A4DF0', deep: '#4E2BA8' },
  matching: { tile: '#FFEBE1', base: '#F1672C', deep: '#B83C12' },
  ai: { tile: '#FFF2DD', base: '#F0A424', deep: '#8A5B12' },
  property: { tile: '#F0F0F0', base: '#1C1C1C', deep: '#C9800F' },
  mortgage: { tile: '#E6EEFF', base: '#2C63E8', deep: '#173C9B' },
  calls: { tile: '#DEF3F3', base: '#0E9C9C', deep: '#076767' },
};

/** Drawn on a 64 × 64 grid, inside a tile the component supplies. */
const ART: Record<GlyphName, (p: Palette) => React.ReactNode> = {
  /* A magnifier reading a record, with the confirmation inside the lens. */
  verify: p => (
    <>
      <circle cx="28" cy="28" r="14.5" fill="#FFFFFF" />
      <circle cx="28" cy="28" r="14.5" fill="none" stroke={p.base} strokeWidth="5" />
      <path d="M38.5 38.5 L49 49" stroke={p.deep} strokeWidth="6.5" strokeLinecap="round" />
      <path
        d="M21.5 28.2 L26 32.6 L34.6 23.6"
        fill="none"
        stroke={p.base}
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  /* A contract, read. The page carries clauses; the badge is the reading. */
  contract: p => (
    <>
      <path
        d="M14 12a5 5 0 0 1 5-5h16.5L48 19.5V52a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5z"
        fill={p.base}
      />
      <path d="M35.5 7 L48 19.5H39.5a4 4 0 0 1-4-4z" fill={p.deep} />
      <g fill="#FFFFFF" opacity="0.92">
        <rect x="21" y="26" width="20" height="3.4" rx="1.7" />
        <rect x="21" y="34" width="20" height="3.4" rx="1.7" />
        <rect x="21" y="42" width="12" height="3.4" rx="1.7" />
      </g>
      <circle cx="46.5" cy="45.5" r="11.5" fill={p.deep} stroke="#FFFFFF" strokeWidth="3.5" />
      <path
        d="M46.5 39.6l1.85 3.95 4.05.5-3 2.8.79 4.15-3.69-2.1-3.69 2.1.79-4.15-3-2.8 4.05-.5z"
        fill="#FFFFFF"
      />
    </>
  ),

  /* A property on the left, the people it turns out to suit on the right. */
  matching: p => (
    <>
      <g stroke={p.base} strokeWidth="2.6" fill="none" opacity="0.55">
        <path d="M27 32 C38 32 38 17 49 17" />
        <path d="M27 32 H49" />
        <path d="M27 32 C38 32 38 47 49 47" />
      </g>
      <path d="M9 28.5 L19 20.5 L29 28.5 V44a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 9 44z" fill={p.base} />
      <rect x="15.5" y="32" width="7" height="9" rx="1.4" fill="#FFFFFF" />
      <g fill={p.deep}>
        <circle cx="50" cy="17" r="7" />
        <circle cx="50" cy="32" r="7" />
        <circle cx="50" cy="47" r="7" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="50" cy="15" r="2.4" />
        <path d="M45.8 21.4a4.6 4.6 0 0 1 8.4 0z" />
        <circle cx="50" cy="30" r="2.4" />
        <path d="M45.8 36.4a4.6 4.6 0 0 1 8.4 0z" />
        <circle cx="50" cy="45" r="2.4" />
        <path d="M45.8 51.4a4.6 4.6 0 0 1 8.4 0z" />
      </g>
    </>
  ),

  /* The assistant: a conversation with the spark inside it. */
  ai: p => (
    <>
      <path
        d="M10 18a7 7 0 0 1 7-7h30a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H28.5L17 53.5V43h-.5a7 7 0 0 1-7-7z"
        fill="#151515"
      />
      <path
        d="M32 15.5l3.25 8.4 8.4 3.25-8.4 3.25L32 38.8l-3.25-8.4-8.4-3.25 8.4-3.25z"
        fill={p.base}
      />
      <circle cx="44.5" cy="17.5" r="3.1" fill={p.base} opacity="0.85" />
      <circle cx="21.5" cy="35.5" r="2.2" fill={p.base} opacity="0.6" />
    </>
  ),

  /* A property, searched. Black mass, gold instrument. */
  property: p => (
    <>
      <path d="M8 27 L32 9 L56 27 V50a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z" fill={p.base} />
      <rect x="26" y="36" width="12" height="19" rx="2" fill="#FFFFFF" opacity="0.16" />
      <circle cx="43.5" cy="40.5" r="11" fill="#FFFFFF" />
      <circle cx="43.5" cy="40.5" r="11" fill="none" stroke={p.deep} strokeWidth="4.4" />
      <path d="M51.5 48.5 L58 55" stroke={p.deep} strokeWidth="5.4" strokeLinecap="round" />
    </>
  ),

  /* Financing: what it costs, structured. */
  mortgage: p => (
    <>
      <rect x="9" y="16" width="46" height="34" rx="6" fill={p.base} />
      <rect x="9" y="16" width="46" height="9" rx="6" fill={p.deep} />
      <g fill="#FFFFFF">
        <circle cx="21.5" cy="36" r="4.2" />
        <circle cx="42.5" cy="36" r="4.2" />
        <path d="M43.6 29.5a1.9 1.9 0 0 1 2.9 2.4L24.2 45.3a1.9 1.9 0 0 1-2.2-3.1z" opacity="0.9" />
      </g>
      <path d="M32 5 L43 13 H21z" fill={p.deep} />
    </>
  ),

  /* An outbound call, in progress, with speech coming back. */
  calls: p => (
    <>
      <path
        d="M17.5 9.5h8.2a4 4 0 0 1 3.9 3l1.7 6.9a4 4 0 0 1-1.6 4.2l-3.6 2.5a30 30 0 0 0 12.8 12.8l2.5-3.6a4 4 0 0 1 4.2-1.6l6.9 1.7a4 4 0 0 1 3 3.9v8.2a5 5 0 0 1-5.4 5A44.5 44.5 0 0 1 12.5 14.9a5 5 0 0 1 5-5.4z"
        fill={p.base}
      />
      <g stroke={p.deep} strokeWidth="3.6" strokeLinecap="round" fill="none">
        <path d="M44 12v6" />
        <path d="M51.5 8.5v13" />
        <path d="M59 13v4" />
      </g>
    </>
  ),
};

/**
 * @param name  which capability this is
 * @param size  rendered edge in px; the art scales with it
 * @param tone  'light' draws the tinted tile (white cards); 'dark' drops it
 *              to a translucent white tile so the same art reads on black
 */
export function FeatureGlyph({
  name,
  size = 64,
  tone = 'light',
  className = '',
}: {
  name: GlyphName;
  size?: number;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const palette = PALETTES[name];
  const radius = size * 0.28;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0"
        y="0"
        width="64"
        height="64"
        rx={(radius / size) * 64}
        fill={tone === 'dark' ? '#FFFFFF' : palette.tile}
        opacity={tone === 'dark' ? 0.1 : 1}
      />
      {/* The art is inset from the tile so every glyph shares one optical
          margin regardless of how wide its subject is. */}
      <g transform="translate(32 32) scale(0.78) translate(-32 -32)">
        {ART[name](palette)}
      </g>
    </svg>
  );
}
