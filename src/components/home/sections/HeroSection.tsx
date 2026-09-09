import React from 'react';
import { Building2, Calculator, ShieldCheck, Sparkles, UserSearch } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { HomatchAsk, type AskAction } from '@/components/home/HomatchAsk';
import { Eyebrow, HERO_SPLIT, PAGE_INSET } from './primitives';

/**
 * REGION 01 — the hero.
 *
 * THE INTERACTION IS THE PRODUCT
 *
 * This hero has no "Get started" and no "See how it works". A landing page
 * that leads with those is describing a product; Homatch's whole claim is
 * that you can ask it something, so the primary — and only — interaction
 * here is the Homatch AI console, with prepared intelligence actions beneath
 * it. Both go into the real assistant (see HomatchAsk).
 *
 * There is deliberately no cadastral field here either. Verification is one
 * capability of several, and putting its search in the hero would say the
 * product is a cadastral lookup. It lives in the verification region, where
 * it belongs.
 *
 * THE PHOTOGRAPH IS DESKTOP-ONLY
 *
 * Below lg the photograph is not rendered at all — not hidden with CSS,
 * removed from the DOM, so a phone never downloads it. Stacked above a hero
 * whose subject is a text field, it pushed the actual interaction below the
 * fold and made the first screen read as a property advertisement. On mobile
 * the hero is type plus the console, which is a truer first impression.
 *
 * There is no pull-quote on the photograph. It was decoration over someone
 * else's composition; the image reads better with nothing on it.
 */
export function HeroSection() {
  const { t } = useLanguage();

  /* Icon-led shortcuts into the assistant. Each is a question a real
     customer actually has; `prompt` is what gets sent when the visible label
     is a shorter form of it. */
  const actions: AskAction[] = [
    { key: 'client', icon: UserSearch, label: t('mp_hero_action_client'), prompt: t('mp_hero_action_client_prompt') },
    { key: 'property', icon: Building2, label: t('mp_hero_action_property'), prompt: t('mp_hero_action_property_prompt') },
    { key: 'verify', icon: ShieldCheck, label: t('mp_hero_action_verify'), prompt: t('mp_hero_action_verify_prompt') },
    { key: 'mortgage', icon: Calculator, label: t('mp_hero_action_mortgage'), prompt: t('mp_hero_action_mortgage_prompt') },
    { key: 'capabilities', icon: Sparkles, label: t('mp_hero_action_capabilities'), prompt: t('mp_hero_action_capabilities_prompt') },
  ];

  return (
    <section className="relative isolate">
      {/* ── The photograph: lg and up only ──────────────────────────
          Starts where the copy column ends (--hero-split) and bleeds to the
          viewport edge, floor to ceiling, with one large inner-bottom
          radius. Absolute rather than a grid column so the copy governs the
          hero's height instead of the image's aspect ratio doing it. */}
      <div
        className="absolute inset-y-0 end-0 hidden overflow-hidden rounded-bl-[3.5rem] rtl:rounded-bl-none rtl:rounded-br-[3.5rem] lg:block"
        style={{ insetInlineStart: HERO_SPLIT }}
      >
        <SceneMedia
          scene="hero"
          alt={t('mp_hero_image_alt')}
          priority
          sizes="52vw"
          position="46% 52%"
        />
        {/* The warm-white dissolve on the inner edge, so the photograph never
            ends on a hard vertical line against the page. */}
        <div
          className="pointer-events-none absolute inset-y-0 start-0 w-[26%] min-w-[8rem] bg-gradient-to-r from-background via-background/55 to-transparent rtl:bg-gradient-to-l"
          aria-hidden="true"
        />
      </div>

      {/* ── The copy column ─────────────────────────────────────── */}
      <div className="relative lg:w-[var(--hero-split)]" style={{ ['--hero-split' as string]: HERO_SPLIT }}>
        <div className={`${PAGE_INSET} pe-5 sm:pe-8 lg:pe-14`}>
          <div className="flex min-h-[clamp(28rem,64vh,42rem)] flex-col justify-center py-16 lg:py-24">
            <Eyebrow>{t('mp_hero_eyebrow')}</Eyebrow>

            <h1
              className="mt-6 text-balance font-semibold leading-[1.05] tracking-[-0.028em] text-foreground"
              style={{ fontSize: 'clamp(2.1rem, 3vw, 2.95rem)' }}
            >
              <span className="block">{t('mp_hero_line1')}</span>
              <span className="block">{t('mp_hero_line2')}</span>
              <span className="block text-gold-ink">{t('mp_hero_line3')}</span>
            </h1>

            <p className="mt-6 max-w-[33rem] text-pretty text-[15px] leading-[1.75] text-ink-soft">
              {t('mp_hero_sub')}
            </p>

            <HomatchAsk
              className="mt-10 max-w-[42rem]"
              variant="console"
              heading={t('ai_title')}
              placeholder={t('mp_hero_ai_placeholder')}
              actions={actions}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
