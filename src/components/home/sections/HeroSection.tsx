import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { Eyebrow, HERO_SPLIT, PAGE_INSET } from './primitives';

/**
 * REGION 02 — the hero.
 *
 * The reference's composition: an editorial copy column on cream, and a
 * photograph that owns the outer half of the frame, bleeding off the top and
 * outer edge and curving away from the copy on its inner corner.
 *
 * The media is absolutely positioned rather than a grid column, for one
 * concrete reason: as a grid item its intrinsic ratio would set the row
 * height and stretch the hero to whatever the image is tall. Absolute keeps
 * the copy in charge of the section's height, which is what makes the hero
 * proportion controllable. Both halves are still measured against the same
 * box — the full-width section — so they cannot collide at any width, which
 * is what went wrong when the copy lived in a centred container.
 */
export function HeroSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const proof = [t('mp_hero_proof_1'), t('mp_hero_proof_2'), t('mp_hero_proof_3')];

  return (
    <section className="relative isolate">
      {/* ── The photograph ──────────────────────────────────────────
          Below lg: a full-width band above the copy (first in the DOM), with
          a generous bottom radius and an upward dissolve into the cream.
          From lg: it starts where the copy column ends (--hero-split) and
          bleeds to the viewport edge, floor to ceiling. */}
      <div
        className="relative h-[clamp(280px,42vw,380px)] overflow-hidden rounded-b-[2.5rem] lg:absolute lg:inset-y-0 lg:end-0 lg:h-auto lg:w-auto lg:start-[var(--hero-split)] lg:rounded-b-none lg:rounded-bl-[4rem] lg:rtl:rounded-bl-none lg:rtl:rounded-br-[4rem]"
        style={{ ['--hero-split' as string]: HERO_SPLIT }}
      >
        <SceneMedia
          scene="hero"
          alt={t('mp_hero_image_alt')}
          priority
          // Desktop is a tall panel cut from a 3:2 frame, so it holds the
          // glazing, the sun and the seating and drops the far right wall.
          // The mobile band is nearly the source ratio and needs no shift.
          sizes="(min-width: 1024px) 56vw, 100vw"
          position="46% 52%"
          positionMobile="50% 50%"
        />

        {/* Cream dissolve. Upward on mobile so the copy below it starts on
            clean paper; inward on desktop so the photograph never ends on a
            hard vertical edge against the page. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent lg:hidden"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 start-0 hidden w-[26%] min-w-[8rem] bg-gradient-to-r from-background via-background/60 to-transparent rtl:bg-gradient-to-l lg:block"
          aria-hidden="true"
        />

        {/* The photograph's upper outer corner is bright sunset sky, so the
            pull-quote gets its own soft scrim rather than relying on a text
            shadow to carry white type over it. */}
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{ background: 'radial-gradient(38rem 26rem at 100% 0%, hsl(214 42% 10% / 0.62), transparent 62%)' }}
          aria-hidden="true"
        />

        {/* Pull-quote, as in the reference: white type at the upper outer
            corner, held by a gold rule. */}
        <figure className="absolute end-6 top-10 hidden max-w-[16rem] lg:block xl:end-12 xl:top-14 xl:max-w-[19rem]">
          <div className="flex gap-4">
            <span className="w-px shrink-0 self-stretch bg-gold/80" aria-hidden="true" />
            <div>
              <blockquote
                className="text-pretty leading-[1.45] text-white drop-shadow-[0_1px_12px_rgba(20,28,40,0.55)]"
                style={{ fontSize: 'clamp(0.95rem, 1.05vw, 1.15rem)' }}
              >
                {t('mp_hero_quote')}
              </blockquote>
              <figcaption className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-white/85">Homatch</figcaption>
            </div>
          </div>
        </figure>
      </div>

      {/* ── The copy column ─────────────────────────────────────── */}
      <div className="relative lg:w-[var(--hero-split)]" style={{ ['--hero-split' as string]: HERO_SPLIT }}>
        <div className={`${PAGE_INSET} pe-5 sm:pe-8 lg:pe-14`}>
          <div className="flex min-h-[clamp(28rem,62vh,42rem)] flex-col justify-center py-14 lg:py-24">
            <Eyebrow>{t('mp_hero_eyebrow')}</Eyebrow>

            <h1
              className="mt-6 text-balance font-semibold leading-[1.06] tracking-[-0.02em] text-foreground"
              style={{ fontSize: 'clamp(2rem, 2.9vw, 2.75rem)' }}
            >
              <span className="block">{t('mp_hero_line1')}</span>
              <span className="block">{t('mp_hero_line2')}</span>
              <span className="block text-gold">{t('mp_hero_line3')}</span>
            </h1>

            <p className="mt-7 max-w-[34rem] text-pretty text-[15px] leading-relaxed text-ink-soft sm:text-base">
              {t('mp_hero_sub')}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
              <Button
                className="h-[3.25rem] gap-2.5 rounded-full px-8 text-[15px]"
                onClick={() => navigate(session ? '/dashboard' : '/auth/signup')}
              >
                {t('mp_hero_cta_primary')}
                <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
              </Button>

              {/* Quiet secondary, not a second filled pill — the reference's
                  CTA hierarchy depends on there being exactly one loud one. */}
              <button
                type="button"
                onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="group inline-flex items-center gap-3 text-[15px] font-medium text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full border border-border transition-colors group-hover:border-gold/60">
                  <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                </span>
                {t('mp_hero_cta_secondary')}
              </button>
            </div>

            {/* The reference's metric strip. It carried invented counts, so
                this carries three things that are true instead. */}
            <ul className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-xs text-muted-foreground">
              {proof.map((item, i) => (
                <li key={item} className="flex items-center gap-5">
                  {/* Hidden rather than omitted below sm: a display:none child
                      is not a flex item, so it contributes no stray gap. */}
                  {i > 0 && <span className="hidden h-1 w-1 rounded-full bg-gold/70 sm:block" aria-hidden="true" />}
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
