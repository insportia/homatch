import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { IntentChips } from '@/components/home/IntentCards';
import { AiTalkPanel } from '@/components/home/AiTalkPanel';
import { PAGE } from './primitives';
import { useSectionField, useSectionMedia } from '@/site/content';

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
  const photo = useSectionMedia()('photo');
  const sf = useSectionField();
  const { t } = useLanguage();

  return (
    <section className="relative isolate overflow-hidden bg-[#0D0D0D] text-white">
      {/* ── The photograph, lg and up ───────────────────────────────
          WHAT CHANGED HERE, AND WHAT DID NOT

          This plate used to be the whole of the hero's right-hand side: a
          photograph under a wipe, with nothing to press. AI TALK now occupies
          that space (§26), and the photograph stays as what it always really
          was — the one warm object on a black-white-gold page — pushed a
          little further back so the panel reads as the thing in front of it.

          It is still bound to Site Studio's `photo` field, so a published hero
          image keeps working. Nothing in the left column moved, the band's own
          height is unchanged, and the panel reserves its space before any
          voice code loads (§133). */}
      <div className="absolute inset-0 hidden lg:block" aria-hidden="true">
        <div className="absolute inset-y-0 end-0 w-[78%] saturate-[0.6] opacity-75">
          <SceneMedia scene="hero" alt={photo?.alt ?? ''} priority sizes="78vw" position="52% 52%" overrideUrl={photo?.url} />
        </div>
        <div className="absolute inset-0 bg-[#0D0D0D]/58" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0D0D0D] from-30% via-[#0D0D0D]/88 to-transparent rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#0D0D0D] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0D0D0D]/85 to-transparent" />
      </div>

      {/* One gold bloom, so the black is lit rather than flat. It is the only
          gold on this ground that is not a line or a control. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(58rem 30rem at 12% 0%, hsl(38 88% 54% / 0.11), transparent 62%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative`}>
        {/* THE ONE STRUCTURAL CHANGE ON THIS PAGE.
            A two-column grid from lg up. The left column keeps its own
            max-w-[46rem] and every class it had, so the copy sits exactly
            where it sat; the right column is the space the photograph used to
            fill on its own. Below lg there is one column and the panel follows
            the chips, sized so it never takes the whole viewport (§81). */}
        <div className="grid min-h-[clamp(27rem,68vh,40rem)] items-center gap-8 lg:grid-cols-[minmax(0,46rem)_minmax(0,1fr)] lg:gap-10">
          {/* pt covers the fixed header; the black band itself starts at y=0. */}
          <div className="flex max-w-[46rem] flex-col justify-center pb-11 pt-[6.5rem] sm:pb-16 sm:pt-[8rem] lg:pb-20 lg:pt-[9rem]">
          <p className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-6 shrink-0 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'mp_hero_eyebrow')}
          </p>

          {/* The lockup: the name on its own line, then the proposition.
              Two lines rather than one sentence, so the headline needs no
              full stop and no dash to hold them together, and the name is
              unmistakable before the phrase under it is even read. */}
          <h1
            className="mt-5 text-balance font-semibold leading-[1.07] tracking-[-0.03em] text-white sm:mt-6"
            style={{ fontSize: 'clamp(1.5rem, 7.4vw, 3.9rem)' }}
          >
            <span className="block">{sf('brand', 'brand_name')}</span>
            {/* Balanced from sm up, where equal line lengths look composed.
                On a narrow phone balance splits the phrase in the wrong
                place ("Smart real / estate decisions"), so the narrowest
                case fills greedily and breaks after the noun instead. */}
            <span className="block text-pretty text-white/90 sm:text-balance">{sf('title', 'mp_hero_h1')}</span>
          </h1>

          <p
            className="mt-4 text-balance font-semibold leading-[1.25] tracking-[-0.015em] text-gold sm:mt-5"
            style={{ fontSize: 'clamp(0.98rem, 3.4vw, 1.5rem)' }}
          >
            {sf('subtitle', 'mp_hero_h2')}
          </p>

          <p className="mt-4 max-w-[38rem] text-pretty text-[16px] leading-[1.6] text-white/70 sm:mt-5 sm:text-base sm:leading-[1.7]">
            {sf('body', 'mp_hero_scope')}
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
            placeholder={sf('placeholder', 'mp_hero_ai_placeholder')}
            actions={[]}
          />

          <IntentChips keys={['buy', 'price', 'contract']} className="mt-4 max-w-[36rem]" />
          </div>

          {/* AI TALK. A marketing demonstration of what Homatch understands,
              not a second assistant: HomatchAsk above is still AI Chat, on its
              own route, unchanged (§26). */}
          <div className="pb-11 sm:pb-16 lg:pb-20 lg:pt-[9rem]">
            <AiTalkPanel className="mx-auto max-w-[26rem] lg:mx-0 lg:max-w-none" />
          </div>
        </div>
      </div>
    </section>
  );
}
