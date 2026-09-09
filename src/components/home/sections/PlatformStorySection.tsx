import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { Eyebrow, PAGE } from './primitives';

/**
 * REGION 07 — market and network intelligence.
 *
 * Market intelligence used to be one text row in a directory. It is not a
 * separate product with its own page — comparables, public evidence and
 * research context are gathered as part of a property check and feed Verify,
 * matching and discovery — so it is presented for what it is: the layer
 * underneath the others, over the city it actually covers.
 *
 * The city photograph carries the atmosphere; the network is drawn over it in
 * SVG rather than baked into the artwork, for three reasons: it stays crisp
 * at any density, it scales with the band instead of being cropped with the
 * photograph, and it can be turned down for reduced-motion and dark-contrast
 * without re-exporting an image.
 *
 * The overlay is deliberately faint. It is a suggestion of connection over a
 * real skyline, not a data visualisation — there is no dataset behind it and
 * it must not look like there is.
 */

/** Fixed nodes in a 1000×560 field, positioned over the city, not the sky. */
const NODES: [number, number, number][] = [
  // x, y, radius
  [148, 372, 4.5], [286, 318, 3], [352, 430, 5], [468, 352, 3.5],
  [560, 268, 4], [648, 404, 3], [742, 316, 5], [828, 396, 3.5], [906, 300, 4],
];

const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [3, 5], [5, 7], [6, 8], [7, 8], [1, 3], [5, 6],
];

function NetworkOverlay() {
  return (
    <svg
      viewBox="0 0 1000 560"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="net-node" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(40 90% 88%)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="hsl(38 70% 70%)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g stroke="hsl(40 80% 88%)" strokeOpacity="0.32" strokeWidth="1" fill="none">
        {LINKS.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} />
        ))}
      </g>

      {NODES.map(([x, y, r]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r * 4} fill="url(#net-node)" opacity="0.5" />
          <circle cx={x} cy={y} r={r} fill="hsl(42 92% 90%)" opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

export function PlatformStorySection() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const beliefs = [
    { key: '1', title: t('mp_market_1_title'), desc: t('mp_market_1_desc') },
    { key: '2', title: t('mp_market_2_title'), desc: t('mp_market_2_desc') },
    { key: '3', title: t('mp_market_3_title'), desc: t('mp_market_3_desc') },
    { key: '4', title: t('mp_market_4_title'), desc: t('mp_market_4_desc') },
  ];

  return (
    <section id="company" className="relative isolate scroll-mt-24 overflow-hidden">
      {/* The photograph and its treatment. Full-bleed, behind everything. */}
      <div className="absolute inset-0" aria-hidden="true">
        <SceneMedia
          scene="platform"
          alt=""
          sizes="100vw"
          position="50% 44%"
          positionMobile="58% 46%"
        />
        {/* Enough navy to carry body copy at AA, with the warm horizon still
            reading through the top of the frame. */}
        <div className="absolute inset-0 bg-[hsl(30_8%_7%/0.68)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(30_8%_6%/0.6)] via-[hsl(30_8%_6%/0.26)] to-[hsl(30_8%_5%/0.84)]" />
        <div className="absolute inset-0 opacity-45">
          <NetworkOverlay />
        </div>
      </div>

      <div className={`${PAGE} relative py-20 sm:py-24 lg:py-32`}>
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <Eyebrow tone="light">{t('mp_market_eyebrow')}</Eyebrow>
            <h2
              className="mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] text-white"
              style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
            >
              {t('mp_market_title')}
            </h2>
            <span className="mt-8 block h-px w-20 bg-gold" aria-hidden="true" />
            <p className="mt-8 max-w-[34rem] text-pretty text-[15px] leading-relaxed text-white/70 sm:text-base">
              {t('mp_market_body')}
            </p>
            <Button
              variant="outline"
              className="mt-9 h-12 gap-2.5 rounded-full border-white/30 bg-transparent px-7 text-sm text-white hover:bg-white/10 hover:text-white"
              onClick={() => navigate('/partners')}
            >
              {t('mp_market_cta')}
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-col">
            <ul className="flex-1">
              {beliefs.map((item, i) => (
                <li key={item.key} className={`py-6 ${i === 0 ? '' : 'border-t border-white/20'}`}>
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-pretty text-sm leading-relaxed text-white/70">{item.desc}</p>
                </li>
              ))}
            </ul>

            <p
              className="mt-10 text-end text-gold"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontSize: 'clamp(1.5rem, 2.6vw, 2.25rem)' }}
            >
              {t('brand_tagline')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
