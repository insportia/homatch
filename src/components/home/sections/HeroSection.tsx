import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { HomatchAsk } from '@/components/home/HomatchAsk';
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
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

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

          {/* The product statement. "Homatch" is set as its own mass so the
              name is unmistakable before the sentence is even read. */}
          <h1
            className="mt-5 text-balance font-semibold leading-[1.07] tracking-[-0.03em] text-white sm:mt-6"
            style={{ fontSize: 'clamp(1.6rem, 7.4vw, 3.9rem)' }}
          >
            {t('mp_hero_h1')}
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

          {/* Two ways in, then the assistant. The assistant is present and
              one keystroke deep, but it no longer stands in for the
              explanation of the platform — the launcher below does that. */}
          <div className="mt-7 flex flex-col gap-2.5 sm:mt-9 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/verify')}
              className="group inline-flex h-auto min-h-[3rem] items-center justify-center gap-2.5 rounded-full bg-gold px-5 py-3 text-center text-sm font-semibold text-[#0A0A0A] sm:px-6 transition-colors duration-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#080808] motion-reduce:transition-none"
            >
              <ShieldCheck className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
              {t('mp_verify_capability_cta')}
              <ArrowRight
                className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={() => {
                document.getElementById('start')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="inline-flex h-auto min-h-[3rem] items-center justify-center rounded-full border border-white/30 px-5 py-3 text-center text-sm font-medium text-white sm:px-6 transition-colors duration-300 hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
            >
              {t('mp_hero_explore')}
            </button>
          </div>

          <HomatchAsk
            className="mt-7 max-w-[34rem] sm:mt-10"
            variant="card"
            tone="dark"
            heading={t('ai_title')}
            placeholder={t('mp_hero_ai_placeholder')}
            actions={[]}
          />
        </div>
      </div>
    </section>
  );
}
