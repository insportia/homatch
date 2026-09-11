// HOMATCH — architectural scenes.
//
// WHAT THESE ARE, PLAINLY
//
// They are hand-built vector renderings, not photographs, and not an attempt
// to pass as photographs. The reference's hero image is a flattened,
// AI-generated composition that exists nowhere in this repository or its
// history, so there is no asset to recover; and a real photograph of a real
// building would be a claim — that Homatch holds or represents that property
// — which a design preview has no business making.
//
// So these carry the reference's ART DIRECTION at the density the page needs:
// late-afternoon light, warm stone and cream, deep navy accents, panoramic
// glazing, a hill horizon that reads as Tbilisi rather than Dubai or
// Manhattan. Depth comes from atmospheric haze on the far layers, contact
// shadows under the near ones, a warm grade over everything and a fine grain
// — the things that make an image read as photographic rather than as
// clip-art.
//
// Each is composed with QUIET ZONES where the layout needs them: the hero
// keeps its inner third and upper right calm, because the cream dissolve
// eats one and the pull-quote sits on the other.
//
// Every one of them is replaced by a real photograph the moment a file
// appears at the path its <SceneMedia> declares. Nothing about the layout
// changes when that happens.
import React from 'react';

export type SceneName = 'interior' | 'detail' | 'city';

/* Shared atmosphere: one warm grade + one grain, reused by all three scenes
   so they read as one photographic set rather than three illustrations. */
function Atmosphere({ id }: { id: string }) {
  return (
    <>
      <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="7" result="n" />
        <feColorMatrix in="n" type="saturate" values="0" />
      </filter>
      <filter id={`${id}-haze`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="18" />
      </filter>
      <radialGradient id={`${id}-vignette`} cx="50%" cy="42%" r="78%">
        <stop offset="55%" stopColor="hsl(24 30% 10%)" stopOpacity="0" />
        <stop offset="100%" stopColor="hsl(24 34% 8%)" stopOpacity="0.30" />
      </radialGradient>
    </>
  );
}

function Finish({ id, w, h }: { id: string; w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} fill={`url(#${id}-vignette)`} />
      <rect width={w} height={h} filter={`url(#${id}-grain)`} opacity="0.06" style={{ mixBlendMode: 'overlay' }} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * HERO — a contemporary living space behind panoramic glazing,        *
 * late afternoon, hills beyond.                                       *
 * ------------------------------------------------------------------ */
function InteriorScene() {
  const id = 'sc-int';
  return (
    <svg viewBox="0 0 1400 1100" preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <Atmosphere id={id} />
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="hsl(35 62% 84%)" />
          <stop offset="38%" stopColor="hsl(28 54% 76%)" />
          <stop offset="72%" stopColor="hsl(22 42% 68%)" />
          <stop offset="100%" stopColor="hsl(30 34% 72%)" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="72%" cy="30%" r="46%">
          <stop offset="0%" stopColor="hsl(42 88% 88%)" stopOpacity="0.92" />
          <stop offset="45%" stopColor="hsl(36 72% 80%)" stopOpacity="0.36" />
          <stop offset="100%" stopColor="hsl(32 60% 74%)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-hill-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(214 22% 56%)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="hsl(220 20% 62%)" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${id}-hill-mid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(212 24% 42%)" stopOpacity="0.48" />
          <stop offset="100%" stopColor="hsl(206 22% 48%)" stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id={`${id}-hill-near`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(150 16% 34%)" stopOpacity="0.56" />
          <stop offset="100%" stopColor="hsl(140 14% 30%)" stopOpacity="0.40" />
        </linearGradient>
        <linearGradient id={`${id}-floor`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="hsl(32 30% 74%)" />
          <stop offset="42%" stopColor="hsl(30 26% 66%)" />
          <stop offset="100%" stopColor="hsl(26 22% 52%)" />
        </linearGradient>
        <linearGradient id={`${id}-ceiling`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(30 26% 40%)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="hsl(32 30% 62%)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="hsl(32 24% 44%)" />
          <stop offset="60%" stopColor="hsl(32 26% 58%)" />
          <stop offset="100%" stopColor="hsl(33 30% 68%)" />
        </linearGradient>
        <linearGradient id={`${id}-sofa`} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="hsl(34 30% 82%)" />
          <stop offset="55%" stopColor="hsl(32 26% 72%)" />
          <stop offset="100%" stopColor="hsl(28 22% 58%)" />
        </linearGradient>
        <linearGradient id={`${id}-shaft`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="hsl(44 90% 92%)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="hsl(40 80% 88%)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-contact`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(24 30% 22%)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="hsl(24 30% 22%)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Beyond the glass ───────────────────────────────────────── */}
      <rect width="1400" height="1100" fill={`url(#${id}-sky)`} />
      <rect width="1400" height="1100" fill={`url(#${id}-sun)`} />

      <g filter={`url(#${id}-haze)`}>
        <path d="M0 470 L170 392 L300 448 L438 356 L582 434 L712 368 L864 448 L1010 380 L1160 452 L1290 400 L1400 446 L1400 720 L0 720 Z" fill={`url(#${id}-hill-far)`} />
        <path d="M0 566 L146 506 L286 560 L430 486 L560 552 L706 494 L852 566 L980 516 L1122 574 L1270 522 L1400 570 L1400 780 L0 780 Z" fill={`url(#${id}-hill-mid)`} />
      </g>

      {/* A restrained hint of a hillside city — slender, low-contrast, never
          a skyline. */}
      <g opacity="0.30" filter={`url(#${id}-haze)`}>
        {[
          [520, 520, 16, 62], [548, 534, 13, 48], [806, 528, 15, 54],
          [832, 540, 12, 42], [1052, 536, 14, 50], [1078, 548, 11, 38],
        ].map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="2" fill="hsl(214 18% 34%)" />
        ))}
      </g>

      <path d="M0 660 L180 606 L340 654 L500 596 L660 648 L820 600 L1000 656 L1160 610 L1310 660 L1400 630 L1400 820 L0 820 Z" fill={`url(#${id}-hill-near)`} />

      {/* Terrace planting, just inside the glass. */}
      <g opacity="0.5">
        <ellipse cx="1180" cy="704" rx="150" ry="34" fill="hsl(146 20% 30%)" />
        <ellipse cx="330" cy="712" rx="118" ry="26" fill="hsl(146 18% 32%)" />
      </g>

      {/* ── The glazing ───────────────────────────────────────────── */}
      <g stroke="hsl(214 30% 20%)" strokeOpacity="0.5" fill="none">
        <path d="M300 0 V742" strokeWidth="6" />
        <path d="M700 0 V742" strokeWidth="6" />
        <path d="M1100 0 V742" strokeWidth="6" />
        <path d="M0 130 H1400" strokeWidth="5" strokeOpacity="0.34" />
      </g>
      {/* Reflection on the glass — two long, very soft diagonals. */}
      <g opacity="0.16">
        <path d="M120 0 L470 0 L150 742 L-40 742 Z" fill="hsl(40 80% 96%)" />
        <path d="M900 0 L1010 0 L800 742 L700 742 Z" fill="hsl(40 80% 96%)" />
      </g>

      {/* ── Inside ────────────────────────────────────────────────── */}
      <path d="M0 742 L1400 742 L1400 1100 L0 1100 Z" fill={`url(#${id}-floor)`} />
      {/* Floor reflection of the window light. */}
      <g opacity="0.30" filter={`url(#${id}-soft)`}>
        <path d="M330 742 L470 742 L360 1100 L120 1100 Z" fill="hsl(44 86% 92%)" />
        <path d="M1010 742 L1110 742 L1240 1100 L1050 1100 Z" fill="hsl(44 86% 92%)" />
      </g>

      <path d="M0 0 L1400 0 L1400 96 L0 130 Z" fill={`url(#${id}-ceiling)`} />

      {/* Left return wall — warm stone, keeps the inner edge of the frame
          calm where the page dissolves it into cream. */}
      <path d="M0 60 L172 128 L172 900 L0 1010 Z" fill={`url(#${id}-wall)`} />
      <path d="M96 96 L96 952" stroke="hsl(30 22% 38%)" strokeOpacity="0.22" strokeWidth="3" />

      {/* Light shafts across the interior. */}
      <g style={{ mixBlendMode: 'screen' }}>
        <path d="M310 140 L470 140 L300 1100 L20 1100 Z" fill={`url(#${id}-shaft)`} />
        <path d="M1020 140 L1120 140 L1290 1100 L1080 1100 Z" fill={`url(#${id}-shaft)`} />
      </g>

      {/* Sofa — a long low silhouette across the lower third. */}
      <ellipse cx="820" cy="1012" rx="420" ry="52" fill={`url(#${id}-contact)`} />
      <g>
        <rect x="470" y="852" width="700" height="120" rx="34" fill={`url(#${id}-sofa)`} />
        <rect x="486" y="782" width="668" height="94" rx="30" fill="hsl(32 28% 76%)" />
        <rect x="486" y="782" width="668" height="94" rx="30" fill="hsl(26 20% 40%)" opacity="0.12" />
        {/* Cushions */}
        <rect x="530" y="806" width="150" height="66" rx="20" fill="hsl(34 32% 84%)" opacity="0.9" />
        <rect x="700" y="806" width="150" height="66" rx="20" fill="hsl(30 24% 68%)" opacity="0.85" />
        <rect x="870" y="806" width="150" height="66" rx="20" fill="hsl(214 18% 42%)" opacity="0.42" />
        {/* Legs */}
        <rect x="512" y="966" width="14" height="36" rx="5" fill="hsl(28 26% 34%)" opacity="0.7" />
        <rect x="1112" y="966" width="14" height="36" rx="5" fill="hsl(28 26% 34%)" opacity="0.7" />
      </g>

      {/* Low table */}
      <ellipse cx="470" cy="1042" rx="150" ry="26" fill={`url(#${id}-contact)`} />
      <ellipse cx="470" cy="1000" rx="140" ry="34" fill="hsl(30 24% 60%)" />
      <ellipse cx="470" cy="992" rx="140" ry="34" fill="hsl(34 30% 78%)" />
      <rect x="462" y="1010" width="16" height="42" rx="5" fill="hsl(28 24% 38%)" opacity="0.65" />

      {/* Floor lamp — a single thin arc, right of the sofa. */}
      <g stroke="hsl(214 26% 26%)" strokeOpacity="0.55" fill="none" strokeLinecap="round">
        <path d="M1268 1010 V812" strokeWidth="7" />
        <path d="M1268 812 Q1268 744 1196 744" strokeWidth="7" />
      </g>
      <ellipse cx="1196" cy="754" rx="34" ry="16" fill="hsl(42 78% 84%)" opacity="0.75" />

      {/* Planting inside, sparingly. */}
      <g>
        <path d="M232 1006 h96 l-13 74 h-70 z" fill="hsl(30 22% 52%)" />
        <g stroke="hsl(146 22% 34%)" strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.85">
          <path d="M280 1006 C266 946 234 924 216 906" />
          <path d="M280 1006 C292 942 322 922 344 906" />
          <path d="M280 1006 C280 936 278 906 276 878" />
        </g>
        <g fill="hsl(148 24% 36%)" opacity="0.85">
          <ellipse cx="212" cy="900" rx="30" ry="15" transform="rotate(-28 212 900)" />
          <ellipse cx="348" cy="900" rx="30" ry="15" transform="rotate(26 348 900)" />
          <ellipse cx="276" cy="872" rx="26" ry="14" />
        </g>
      </g>

      <Finish id={id} w={1400} h={1100} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * VERIFICATION — a facade detail. Stone, glass and shadow at close    *
 * range: the register of "look closely at this building".             *
 * ------------------------------------------------------------------ */
function DetailScene() {
  const id = 'sc-det';
  return (
    <svg viewBox="0 0 900 1100" preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <Atmosphere id={id} />
        <linearGradient id={`${id}-stone`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="hsl(34 30% 82%)" />
          <stop offset="48%" stopColor="hsl(32 24% 70%)" />
          <stop offset="100%" stopColor="hsl(28 20% 52%)" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="hsl(206 30% 46%)" stopOpacity="0.86" />
          <stop offset="52%" stopColor="hsl(214 32% 30%)" stopOpacity="0.92" />
          <stop offset="100%" stopColor="hsl(30 40% 62%)" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id={`${id}-slab`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(36 34% 88%)" />
          <stop offset="100%" stopColor="hsl(30 22% 62%)" />
        </linearGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="hsl(42 84% 90%)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="hsl(38 70% 80%)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="900" height="1100" fill={`url(#${id}-stone)`} />

      {/* Four cantilevered floors seen from below-left. */}
      {[0, 1, 2, 3].map(i => {
        const y = 120 + i * 250;
        return (
          <g key={i}>
            {/* Glazed bay */}
            <path d={`M120 ${y + 42} L900 ${y - 18} L900 ${y + 172} L120 ${y + 214} Z`} fill={`url(#${id}-glass)`} />
            {/* Mullions */}
            <g stroke="hsl(214 34% 18%)" strokeOpacity="0.5" strokeWidth="4">
              {[250, 400, 550, 700].map(x => (
                <path key={x} d={`M${x} ${y + 42 - (x - 120) * 0.077} V${y + 214 - (x - 120) * 0.054}`} />
              ))}
            </g>
            {/* Slab edge — the bright horizontal that gives the facade rhythm */}
            <path d={`M108 ${y + 214} L900 ${y + 172} L900 ${y + 214} L108 ${y + 258} Z`} fill={`url(#${id}-slab)`} />
            {/* Soffit shadow under the slab */}
            <path d={`M108 ${y + 258} L900 ${y + 214} L900 ${y + 244} L108 ${y + 290} Z`} fill="hsl(24 28% 22%)" opacity="0.20" />
            {/* Balustrade */}
            <g stroke="hsl(30 20% 40%)" strokeOpacity="0.28" strokeWidth="3">
              {[200, 320, 440, 560, 680, 800].map(x => (
                <path key={x} d={`M${x} ${y + 214 - (x - 108) * 0.053} v34`} />
              ))}
            </g>
          </g>
        );
      })}

      {/* Vertical stone pier holding the left edge quiet. */}
      <path d="M0 0 L112 0 L112 1100 L0 1100 Z" fill="hsl(32 24% 58%)" />
      <path d="M0 0 L112 0 L112 1100 L0 1100 Z" fill="hsl(26 20% 34%)" opacity="0.18" />

      {/* Raking late light across the facade. */}
      <path d="M0 0 L420 0 L120 1100 L0 1100 Z" fill={`url(#${id}-sun)`} style={{ mixBlendMode: 'screen' }} />

      <Finish id={id} w={900} h={1100} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * CLOSING — the hillside city at golden hour. Wide, calm, and quiet   *
 * enough in the middle to carry centred type over a scrim.            *
 * ------------------------------------------------------------------ */
function CityScene() {
  const id = 'sc-cty';
  return (
    <svg viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <Atmosphere id={id} />
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="hsl(26 46% 62%)" />
          <stop offset="42%" stopColor="hsl(30 54% 74%)" />
          <stop offset="78%" stopColor="hsl(36 62% 82%)" />
          <stop offset="100%" stopColor="hsl(32 46% 72%)" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="34%" cy="76%" r="42%">
          <stop offset="0%" stopColor="hsl(44 92% 90%)" stopOpacity="0.85" />
          <stop offset="60%" stopColor="hsl(38 78% 82%)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="hsl(34 64% 76%)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-ridge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(216 24% 46%)" stopOpacity="0.40" />
          <stop offset="100%" stopColor="hsl(214 22% 52%)" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id={`${id}-town`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(28 26% 44%)" stopOpacity="0.62" />
          <stop offset="100%" stopColor="hsl(24 24% 30%)" stopOpacity="0.82" />
        </linearGradient>
      </defs>

      <rect width="1600" height="700" fill={`url(#${id}-sky)`} />
      <rect width="1600" height="700" fill={`url(#${id}-sun)`} />

      <g filter={`url(#${id}-haze)`}>
        <path d="M0 306 L188 236 L344 292 L512 214 L676 286 L848 226 L1020 296 L1196 232 L1372 300 L1600 244 L1600 460 L0 460 Z" fill={`url(#${id}-ridge)`} />
      </g>

      {/* Hillside settlement — low, dense, warm; roofs rather than towers. */}
      <path d="M0 452 L1600 396 L1600 700 L0 700 Z" fill={`url(#${id}-town)`} />
      <g opacity="0.55">
        {Array.from({ length: 46 }, (_, i) => {
          const x = i * 35 + (i % 3) * 6;
          const h = 26 + ((i * 37) % 62);
          const y = 452 - (x / 1600) * 56 - h;
          return <rect key={i} x={x} y={y} width={22 + (i % 4) * 5} height={h} rx="2" fill="hsl(26 26% 34%)" />;
        })}
      </g>
      {/* Warm windows catching the last light. */}
      <g fill="hsl(42 88% 82%)" opacity="0.5">
        {Array.from({ length: 34 }, (_, i) => {
          const x = i * 47 + 14;
          const y = 470 - (x / 1600) * 46 + ((i * 23) % 90);
          return <rect key={i} x={x} y={y} width="7" height="9" rx="1.5" />;
        })}
      </g>

      {/* Two contemporary residential volumes, the subject of the frame. */}
      <g>
        <path d="M1140 250 L1420 214 L1420 700 L1140 700 Z" fill="hsl(30 22% 48%)" opacity="0.9" />
        <g stroke="hsl(38 60% 82%)" strokeOpacity="0.34" strokeWidth="3">
          {[300, 372, 444, 516, 588].map(y => <path key={y} d={`M1140 ${y} L1420 ${y - 34}`} />)}
        </g>
        <path d="M232 322 L438 296 L438 700 L232 700 Z" fill="hsl(28 22% 42%)" opacity="0.82" />
        <g stroke="hsl(38 60% 82%)" strokeOpacity="0.26" strokeWidth="3">
          {[366, 428, 490, 552, 614].map(y => <path key={y} d={`M232 ${y} L438 ${y - 26}`} />)}
        </g>
      </g>

      <Finish id={id} w={1600} h={700} />
    </svg>
  );
}

const SCENES: Record<SceneName, () => React.JSX.Element> = {
  interior: InteriorScene,
  detail: DetailScene,
  city: CityScene,
};

export function ArchitecturalScene({ scene }: { scene: SceneName }) {
  const Scene = SCENES[scene];
  return <Scene />;
}
