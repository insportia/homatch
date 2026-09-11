import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { IntentChips } from '@/components/home/IntentCards';
import { PAGE } from './primitives';

/**
 * REGION 01 — the hero.
 *
 * WHAT IT HAS TO SAY, AND IN WHAT ORDER
 *
 * Homatch is smart real-estate decisions, on one platform. That sentence —
 * not a mood — is the hero. So the composition is: what this is, what it
 * covers, and then immediately a way in. The previous pass opened with an
 * abstract two-line couplet and a bare assistant field, which described a
 * feeling and left a visitor with nothing to press.
 *
 * WHY IT IS BLACK
 *
 * The page is black, white and gold, and the photograph is the one warm
 * object on it. Laid on white it dragged the whole first screen towards
 * beige. On black, graded down and washed with gold, it reads as texture
 * behind the type instead of as a property advertisement — and the white
 * launcher directly beneath it lands as a hard, bright cut.
 *
 * The hero is deliberately SHORT. It is sized so the first row of the action
 * launcher is already on screen at a normal laptop height; the product has
 * to be reachable, not scrolled to.
 *
 * Below lg the photograph is not rendered at all — removed from the DOM, not
 * hidden — so a phone never downloads it.
 */
export function HeroSection() {
  const { t } = useLanguage();

  return (
    <section className="relative isolate overflow-hidden bg-[#080808] text-white">
      {/* ── The photograph, lg and up ───────────────────────────── */}
      <div className="absolute inset-0 hidden lg:block" aria-hidden="true">
        {/* The plate runs well past the wipe's opaque end, so the image's own
            left edge never shows as a seam. Desaturated a little: the sunset
            is the one warm object on a black-white-gold page, and at full
            chroma it pulls the whole first screen orange. */}
        <div className="absolute inset-y-0 end-0 w-[78%] saturate-[0.72]">
          <SceneMedia scene="hero" alt="" priority sizes="78vw" position="52% 52%" />
        </div>
        <div className="absolute inset-0 bg-[#080808]/45" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#080808] from-30% via-[#080808]/88 to-transparent rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#080808] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#080808]/85 to-transparent" />
      </div>

      {/* One gold bloom, so the black is lit rather than flat. It is the only
          gold on this ground that is not a line or a control. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(58rem 30rem at 12% 0%, hsl(38 88% 54% / 0.11), transparent 62%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative`}>
        {/* pt covers the fixed header; the black band itself starts at y=0. */}
        <div className="flex min-h-[clamp(27rem,68vh,40rem)] max-w-[46rem] flex-col justify-center pb-11 pt-[6.5rem] sm:pb-16 sm:pt-[8rem] lg:pb-20 lg:pt-[9rem]">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-6 shrink-0 bg-gold" aria-hidden="true" />
            {t('mp_hero_eyebrow')}
          </p>

          {/* The lockup: the name on its own line, then the proposition.
              Two lines rather than one sentence, so the headline needs no
              full stop and no dash to hold them together, and the name is
              unmistakable before the phrase under it is even read. */}
          <h1
            className="mt-5 text-balance font-semibold leading-[1.07] tracking-[-0.03em] text-white sm:mt-6"
            style={{ fontSize: 'clamp(1.5rem, 7.4vw, 3.9rem)' }}
          >
            <span className="block">{t('brand_name')}</span>
            {/* Balanced from sm up, where equal line lengths look composed.
                On a narrow phone balance splits the phrase in the wrong
                place ("Smart real / estate decisions"), so the narrowest
                case fills greedily and breaks after the noun instead. */}
            <span className="block text-pretty text-white/90 sm:text-balance">{t('mp_hero_h1')}</span>
          </h1>

          <p
            className="mt-4 text-balance font-semibold leading-[1.25] tracking-[-0.015em] text-gold sm:mt-5"
            style={{ fontSize: 'clamp(0.98rem, 3.4vw, 1.5rem)' }}
          >
            {t('mp_hero_h2')}
          </p>

          <p className="mt-4 max-w-[38rem] text-pretty text-[14.5px] leading-[1.6] text-white/70 sm:mt-5 sm:text-base sm:leading-[1.7]">
            {t('mp_hero_scope')}
          </p>

          {/* THE ONLY INTERACTION IN THE HERO
              Two generic buttons used to sit here, "Open Verify" and "See
              what Homatch does". Both were doing the job the rest of the
              page now does better: the launcher IS the product tour, and
              Verify has its own tile with a live field in it. A landing page
              that opens with two buttons is describing itself.
              What remains is the assistant, and three questions underneath
              it so nobody has to invent one. Each goes straight into the
              conversation. */}
          <HomatchAsk
            className="mt-7 max-w-[34rem] sm:mt-9"
            variant="card"
            tone="dark"
            heading={t('ai_title')}
            placeholder={t('mp_hero_ai_placeholder')}
            actions={[]}
          />

          <IntentChips keys={['buy', 'price', 'contract']} className="mt-4 max-w-[36rem]" />
        </div>
      </div>
    </section>
  );
}
