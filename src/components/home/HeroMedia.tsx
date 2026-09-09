import React, { useState } from 'react';

/**
 * THE HERO PHOTOGRAPH SLOT
 *
 * The Main Page reference is a flattened, AI-generated composition: the
 * interior photograph in it does not exist anywhere in this repository or
 * anywhere in its git history (checked across every branch — the only raster
 * assets the project has ever contained are icons and the brand mark). The
 * original isolated asset is therefore unavailable, and rather than
 * substituting an unrelated stock photo silently, this component keeps the
 * reference's *composition* and makes the photograph itself a one-line swap.
 *
 * TO USE THE REAL PHOTOGRAPH
 *
 * Drop the file at `public/images/hero/homatch-hero.jpg` (or change
 * HERO_IMAGE_SRC below). Nothing else needs to change: the crop, the rounded
 * bleed, the cream dissolve and the scrim are all defined here, so the hero
 * layout, the headline column and the pull-quote stay exactly where they are.
 * Add `homatch-hero.webp`/`.avif` beside it and the <picture> sources below
 * pick them up automatically.
 *
 * UNTIL THEN
 *
 * The fallback is deliberately *not* a photo-substitute. It is a warm
 * architectural drawing rendered as inline SVG — it holds the same visual
 * mass and the same warm palette as the reference, so the composition reads
 * correctly, while being self-evidently a placeholder rather than a claim
 * about a real building. It also costs no network request and no layout
 * shift.
 */
export const HERO_IMAGE_SRC = '/images/hero/homatch-hero.jpg';

function HeroDrawing() {
  return (
    <svg
      viewBox="0 0 900 1000"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hm-sky" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="hsl(36 46% 86%)" />
          <stop offset="42%" stopColor="hsl(30 34% 72%)" />
          <stop offset="100%" stopColor="hsl(20 22% 52%)" />
        </linearGradient>
        <linearGradient id="hm-ridge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(214 26% 38%)" stopOpacity="0.52" />
          <stop offset="100%" stopColor="hsl(214 30% 26%)" stopOpacity="0.26" />
        </linearGradient>
        <linearGradient id="hm-slab" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(38 44% 54%)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="hsl(38 44% 54%)" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      <rect width="900" height="1000" fill="url(#hm-sky)" />

      {/* Distant ridgeline — the reference's mountain horizon. */}
      <path d="M0 505 L150 432 L268 486 L392 398 L520 470 L648 405 L780 468 L900 424 L900 1000 L0 1000 Z" fill="url(#hm-ridge)" />
      <path d="M0 585 L182 528 L330 574 L470 512 L610 566 L742 520 L900 572 L900 1000 L0 1000 Z" fill="hsl(214 24% 32%)" opacity="0.10" />

      {/* Terraced elevation — cantilevered slabs, drawn not photographed. */}
      <g stroke="hsl(38 44% 44%)" strokeWidth="2" fill="none" opacity="0.85">
        <path d="M120 690 H720" />
        <path d="M150 792 H690" />
        <path d="M186 894 H654" />
      </g>
      <g fill="url(#hm-slab)">
        <rect x="120" y="690" width="600" height="12" rx="3" />
        <rect x="150" y="792" width="540" height="12" rx="3" />
        <rect x="186" y="894" width="468" height="12" rx="3" />
      </g>
      <g stroke="hsl(214 26% 30%)" strokeWidth="1.25" opacity="0.28" fill="none">
        <path d="M120 690 V702 M300 690 V702 M480 690 V702 M720 690 V702" />
        <path d="M212 702 V792 M392 702 V792 M572 702 V792" />
        <path d="M248 804 V894 M420 804 V894 M592 804 V894" />
        <path d="M186 906 V1000 M340 906 V1000 M496 906 V1000 M654 906 V1000" />
      </g>

      {/* Warm interior glow behind the openings — the light the reference's
          photograph carries, without pretending to be that photograph. */}
      <g fill="hsl(38 60% 62%)" opacity="0.22">
        <rect x="222" y="716" width="76" height="66" rx="4" />
        <rect x="402" y="716" width="76" height="66" rx="4" />
        <rect x="258" y="818" width="76" height="66" rx="4" />
        <rect x="430" y="818" width="76" height="66" rx="4" />
      </g>
    </svg>
  );
}

interface HeroMediaProps {
  /** Accessible description of the photograph, already translated. */
  alt: string;
  className?: string;
}

export function HeroMedia({ alt, className = '' }: HeroMediaProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-sand ${className}`}>
      {failed ? (
        <HeroDrawing />
      ) : (
        <picture>
          <source srcSet="/images/hero/homatch-hero.avif" type="image/avif" />
          <source srcSet="/images/hero/homatch-hero.webp" type="image/webp" />
          <img
            src={HERO_IMAGE_SRC}
            alt={alt}
            // Above the fold on every viewport: eager + high priority, and an
            // explicit intrinsic ratio so swapping the real photo in later
            // cannot introduce a layout shift.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            width={1600}
            height={1800}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover object-center"
          />
        </picture>
      )}
    </div>
  );
}
