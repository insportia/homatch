// HOMATCH — the public Main Page.
//
// Rebuilt against the supplied design reference: a cream / navy / gold
// composition led by a photographic hero, a prominent Homatch AI panel, four
// capability cards, and a closing brand section.
//
// TWO RULES SHAPED WHAT IS ON THIS PAGE
//
//  1. Every destination is a route that exists, and every CTA lands in the
//     real product — the assistant, the matching flow, the Verification
//     Center, the mortgage tools. There are no decorative buttons here.
//  2. Nothing on this page states a figure Homatch cannot stand behind. The
//     reference's headline metrics (10,000+ users, 500+ brokers, 99.9%
//     uptime) were invented by the image generator, so the same band of the
//     composition carries four true capability statements instead. The
//     mortgage card shows the calculator's *inputs* rather than an example
//     rate, because an illustrative rate on a landing page reads as an offer.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, CheckCircle2, CircleDollarSign, Mail, PhoneCall,
  Play, Search, ShieldCheck, Sparkles, Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { HeroMedia } from '@/components/home/HeroMedia';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';

/* ------------------------------------------------------------------ *
 * Small shared pieces                                                 *
 * ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">{children}</p>
  );
}

function IconTile({ icon: Icon, tone = 'sand' }: { icon: React.ElementType; tone?: 'sand' | 'gold' }) {
  return (
    <div
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
        tone === 'gold' ? 'bg-gold/15 text-gold' : 'bg-sand text-foreground'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

/** A card's illustrative panel. Labelled, never numeric — see the file header. */
function VisualFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/60 p-3">
      {children}
      <p className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page                                                                *
 * ------------------------------------------------------------------ */

export default function HomePage() {
  useSurfaceTheme('light');
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const arrow = `h-4 w-4 ${isRTL ? 'rotate-180' : ''}`;
  /** Signed-out visitors reach an authenticated flow via sign-up, not a 404. */
  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');

  const headerLinks: HeaderLink[] = [
    { key: 'capabilities', label: t('mp_nav_capabilities'), target: 'capabilities' },
    { key: 'how', label: t('mp_nav_how'), target: 'how' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
    { key: 'mortgage', label: t('nav_mortgage'), target: '/mortgage' },
    { key: 'partners', label: t('home_nav_partners'), target: '/partners' },
    { key: 'company', label: t('mp_nav_company'), target: 'company' },
  ];

  const heroPills = [
    { key: 'client', icon: Users, title: t('mp_pill_client_title'), desc: t('mp_pill_client_desc') },
    { key: 'property', icon: Search, title: t('mp_pill_property_title'), desc: t('mp_pill_property_desc') },
    { key: 'verify', icon: ShieldCheck, title: t('mp_pill_verify_title'), desc: t('mp_pill_verify_desc') },
    { key: 'ai', icon: Sparkles, title: t('ai_title'), desc: t('mp_pill_ai_desc') },
  ];

  const askSuggestions = [
    { key: 'about', label: t('mp_ai_sugg_about') },
    { key: 'clients', label: t('mp_ai_sugg_clients') },
    { key: 'property', label: t('mp_ai_sugg_property') },
    { key: 'verify', label: t('mp_ai_sugg_verify') },
  ];

  const secondary = [
    { key: 'calls', icon: PhoneCall, title: t('call_center_title'), desc: t('mp_sec_calls_desc'), onClick: gated('/outreach/calls') },
    { key: 'email', icon: Mail, title: t('mp_sec_email_title'), desc: t('mp_sec_email_desc'), onClick: gated('/outreach/email') },
    { key: 'partners', icon: Building2, title: t('mp_sec_partners_title'), desc: t('mp_sec_partners_desc'), onClick: () => navigate('/partners') },
  ];

  const howSteps = [
    { key: '1', title: t('mp_how_1_title'), desc: t('mp_how_1_desc') },
    { key: '2', title: t('mp_how_2_title'), desc: t('mp_how_2_desc') },
    { key: '3', title: t('mp_how_3_title'), desc: t('mp_how_3_desc') },
    { key: '4', title: t('mp_how_4_title'), desc: t('mp_how_4_desc') },
  ];

  const beliefs = [
    { key: '1', title: t('mp_more_1_title'), desc: t('mp_more_1_desc') },
    { key: '2', title: t('mp_more_2_title'), desc: t('mp_more_2_desc') },
    { key: '3', title: t('mp_more_3_title'), desc: t('mp_more_3_desc') },
    { key: '4', title: t('mp_more_4_title'), desc: t('mp_more_4_desc') },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      {/* ── HERO ─────────────────────────────────────────────────────
          The reference's photograph bleeds off the top and outer edge and
          curves away from the copy on its inner corner.

          Both halves are measured against the SAME box — the full-width
          section — so they cannot collide at any viewport width. (Sizing the
          copy inside a centred max-width container while the media sat at 55%
          of the viewport is what slid the headline under the photograph past
          ~1500px.) The media stays absolute rather than becoming a grid
          column so it never contributes to the section's height: as a grid
          item its SVG would resolve to its intrinsic 9:10 ratio and stretch
          the hero to ~950px. The media is first in the DOM so it stacks above
          the copy below lg, where it is a static band instead. */}
      <section className="relative">
        <div className="relative h-[260px] overflow-hidden sm:h-[320px] lg:absolute lg:inset-y-0 lg:end-0 lg:h-auto lg:w-[55%] lg:rounded-bl-[3.5rem] lg:rtl:rounded-bl-none lg:rtl:rounded-br-[3.5rem]">
          <HeroMedia alt={t('mp_hero_image_alt')} />

          {/* Dissolve into the cream page: sideways on lg, upward on mobile,
              so the photograph never ends on a hard rectangular edge. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent lg:hidden"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-y-0 start-0 hidden w-40 bg-gradient-to-r from-background via-background/45 to-transparent rtl:bg-gradient-to-l lg:block"
            aria-hidden="true"
          />

          {/* Pull-quote, as in the reference: white on a soft scrim at the
              upper outer corner of the photograph. */}
          <figure className="absolute end-6 top-8 hidden max-w-[15rem] lg:block xl:end-10 xl:max-w-[17rem]">
            <div className="rounded-2xl bg-[hsl(214_42%_11%/0.62)] p-4 backdrop-blur-sm">
              <div className="flex gap-3">
                <span className="mt-1 w-0.5 shrink-0 self-stretch rounded-full bg-gold" aria-hidden="true" />
                <blockquote className="text-sm leading-relaxed text-white">{t('mp_hero_quote')}</blockquote>
              </div>
              <figcaption className="mt-2.5 ps-[1.4rem] text-xs font-medium tracking-wide text-white/70">Homatch</figcaption>
            </div>
          </figure>
        </div>

        {/* The copy column. Its inner start-padding is derived from the shared
            page gutter rather than a container of its own, so the headline
            stays left-aligned with the header logo at every width. */}
        <div className="relative lg:w-[45%]">
          <div className="w-full px-5 py-10 sm:px-8 lg:py-20 xl:py-24 lg:ps-[max(2.5rem,calc((100vw-100rem)/2+2.5rem))] lg:pe-10">
            <Eyebrow>{t('mp_hero_eyebrow')}</Eyebrow>

            <h1 className="mt-5 text-[2rem] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-[2.6rem] xl:text-[3.15rem]">
              <span className="block">{t('mp_hero_line1')}</span>
              <span className="block">{t('mp_hero_line2')}</span>
              <span className="block text-gold">{t('mp_hero_line3')}</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-soft">{t('mp_hero_sub')}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                className="h-12 gap-2 rounded-full px-7 text-sm"
                onClick={() => navigate(session ? '/dashboard' : '/auth/signup')}
              >
                {t('mp_hero_cta_primary')} <ArrowRight className={arrow} aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                className="h-12 gap-2 rounded-full border-border bg-card px-7 text-sm"
                onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {t('mp_hero_cta_secondary')} <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>

            {/* The reference's metrics band, carrying capabilities instead of
                invented counts — see the file header. */}
            <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-7 sm:grid-cols-4 lg:mt-12">
              {heroPills.map(pill => (
                <li key={pill.key} className="flex items-start gap-2.5">
                  <pill.icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight text-foreground">{pill.title}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{pill.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── HOMATCH AI ───────────────────────────────────────────────
          A real entry into the assistant, lifted over the hero seam the way
          the reference's panel is. */}
      <section className="relative z-10 mx-auto max-w-[100rem] px-5 pb-4 pt-10 sm:px-8 lg:px-10 lg:pt-14">
        <div className="rounded-[1.75rem] border border-border bg-card p-6 shadow-card md:p-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <IconTile icon={Sparkles} tone="gold" />
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('ai_title')}</h2>
                <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">{t('mp_ai_sub')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(session ? '/ai' : '/auth/signup')}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-gold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('mp_ai_examples')} <ArrowRight className={arrow} aria-hidden="true" />
            </button>
          </div>

          <HomatchAsk placeholder={t('mp_ai_placeholder')} suggestions={askSuggestions} />
        </div>
      </section>

      {/* ── CAPABILITIES ─────────────────────────────────────────── */}
      <section id="capabilities" className="mx-auto max-w-[100rem] scroll-mt-24 px-5 sm:px-8 lg:px-10 py-16 lg:py-24">
        <div className="max-w-2xl">
          <Eyebrow>{t('mp_cap_eyebrow')}</Eyebrow>
          <h2 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {t('mp_cap_title')}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{t('mp_cap_sub')}</p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {/* Find a client */}
          <article className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card card-hover">
            <IconTile icon={Users} />
            <h3 className="mt-4 text-base font-semibold text-foreground">{t('mp_cap_client_title')}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t('mp_cap_client_desc')}</p>
            <div className="mt-5">
              <VisualFrame label={t('mp_cap_client_visual_label')}>
                <div className="flex items-center">
                  {[0, 1, 2, 3].map(i => (
                    <span
                      key={i}
                      className="grid h-9 w-9 place-items-center rounded-full border-2 border-card bg-gradient-to-br from-sand to-gold/35 text-foreground/70 -ms-2 first:ms-0"
                      aria-hidden="true"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </span>
                  ))}
                  <span className="ms-1.5 grid h-9 w-9 place-items-center rounded-full bg-primary text-lg leading-none text-primary-foreground" aria-hidden="true">
                    +
                  </span>
                </div>
              </VisualFrame>
            </div>
            <Button variant="outline" className="mt-4 h-10 w-full justify-between rounded-xl border-border bg-card text-sm" onClick={gated('/property/add')}>
              {t('mp_cap_client_cta')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
          </article>

          {/* Find a property */}
          <article className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card card-hover">
            <IconTile icon={Search} />
            <h3 className="mt-4 text-base font-semibold text-foreground">{t('mp_cap_property_title')}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t('mp_cap_property_desc')}</p>
            <div className="mt-5">
              <VisualFrame label={t('mp_cap_property_visual_label')}>
                <div className="space-y-2">
                  {[92, 74, 56].map(width => (
                    <div key={width} className="flex items-center gap-2">
                      <span className="grid h-7 w-9 shrink-0 place-items-center rounded-md bg-card text-foreground/45" aria-hidden="true">
                        <Building2 className="h-3.5 w-3.5" />
                      </span>
                      <span className="h-1.5 rounded-full bg-gold/55" style={{ width: `${width}%` }} aria-hidden="true" />
                    </div>
                  ))}
                </div>
              </VisualFrame>
            </div>
            <Button variant="outline" className="mt-4 h-10 w-full justify-between rounded-xl border-border bg-card text-sm" onClick={gated('/ai')}>
              {t('mp_cap_property_cta')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
          </article>

          {/* Verification Center */}
          <article className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card card-hover">
            <IconTile icon={ShieldCheck} />
            <h3 className="mt-4 text-base font-semibold text-foreground">{t('mp_cap_verify_title')}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t('mp_cap_verify_desc')}</p>
            <div className="mt-5">
              <VisualFrame label={t('mp_cap_verify_state_confirmed')}>
                <div className="space-y-1.5">
                  {[
                    { key: 'cadastral', label: t('mp_cap_verify_row_cadastral'), ok: true },
                    { key: 'owner', label: t('mp_cap_verify_row_owner'), ok: true },
                    { key: 'restrictions', label: t('mp_cap_verify_row_restrictions'), ok: false },
                  ].map(row => (
                    <div key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5">
                      <span className="min-w-0 truncate text-[11px] text-ink-soft">{row.label}</span>
                      <span className={`shrink-0 text-[10px] font-medium ${row.ok ? 'text-success' : 'text-muted-foreground'}`}>
                        {row.ok ? t('mp_cap_verify_state_confirmed') : t('mp_cap_verify_state_unconfirmed')}
                      </span>
                    </div>
                  ))}
                </div>
              </VisualFrame>
            </div>
            <Button variant="outline" className="mt-4 h-10 w-full justify-between rounded-xl border-border bg-card text-sm" onClick={() => navigate('/verify')}>
              {t('mp_cap_verify_cta')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
          </article>

          {/* Mortgage intelligence */}
          <article className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card card-hover">
            <IconTile icon={CircleDollarSign} />
            <h3 className="mt-4 text-base font-semibold text-foreground">{t('mp_cap_mortgage_title')}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t('mp_cap_mortgage_desc')}</p>
            <div className="mt-5">
              <VisualFrame label={t('mp_cap_mortgage_result_hint')}>
                <div className="space-y-1.5">
                  {[t('mp_cap_mortgage_row_price'), t('mp_cap_mortgage_row_down'), t('mp_cap_mortgage_row_term')].map(label => (
                    <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5">
                      <span className="min-w-0 truncate text-[11px] text-ink-soft">{label}</span>
                      <span className="h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-primary px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-[11px] font-medium text-primary-foreground">{t('mp_cap_mortgage_row_result')}</span>
                    <span className="h-1.5 w-10 shrink-0 rounded-full bg-primary-foreground/40" aria-hidden="true" />
                  </div>
                </div>
              </VisualFrame>
            </div>
            <Button variant="outline" className="mt-4 h-10 w-full justify-between rounded-xl border-border bg-card text-sm" onClick={() => navigate('/mortgage')}>
              {t('mp_cap_mortgage_cta')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
          </article>
        </div>

        {/* Three supporting workflows */}
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {secondary.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-start shadow-card transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IconTile icon={item.icon} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{item.desc}</span>
              </span>
              <ArrowRight className={`mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none ${arrow}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-24 border-y border-border bg-secondary/40">
        <div className="mx-auto max-w-[100rem] px-5 sm:px-8 lg:px-10 py-16 lg:py-24">
          <div className="max-w-2xl">
            <Eyebrow>{t('mp_how_eyebrow')}</Eyebrow>
            <h2 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {t('mp_how_title')}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{t('mp_how_sub')}</p>
          </div>

          <ol className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {howSteps.map((step, index) => (
              <li key={step.key} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── MORE THAN A PLATFORM ─────────────────────────────────── */}
      <section id="company" className="mx-auto max-w-[100rem] scroll-mt-24 px-5 sm:px-8 lg:px-10 py-16 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>{t('mp_more_eyebrow')}</Eyebrow>
            <h2 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {t('mp_more_title')}
            </h2>
            <span className="mt-6 block h-px w-16 bg-gold" aria-hidden="true" />
            <p className="mt-6 text-[15px] leading-relaxed text-ink-soft">{t('mp_more_body')}</p>
            <Button
              variant="outline"
              className="mt-8 h-11 gap-2 rounded-full border-border bg-card px-6 text-sm"
              onClick={() => navigate('/partners')}
            >
              {t('mp_more_cta')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
          </div>

          <div>
            <ul className="space-y-6">
              {beliefs.map(item => (
                <li key={item.key} className="flex gap-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p
              className="mt-10 text-end text-2xl leading-tight text-gold sm:text-3xl"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}
            >
              {t('brand_tagline')}
            </p>
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-[100rem] px-5 sm:px-8 lg:px-10 pb-16 lg:pb-24">
        <div className="flex flex-col items-start gap-6 rounded-[1.75rem] bg-primary px-7 py-9 text-primary-foreground md:flex-row md:items-center md:justify-between md:px-12 md:py-11">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('mp_cta_title')}</h2>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-primary-foreground/75">{t('mp_cta_body')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button
              className="h-12 gap-2 rounded-full bg-gold px-7 text-sm text-primary hover:bg-gold/90"
              onClick={() => navigate(session ? '/dashboard' : '/auth/signup')}
            >
              {session ? t('nav_dashboard') : t('mp_cta_primary')} <ArrowRight className={arrow} aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              className="h-12 rounded-full border-primary-foreground/25 bg-transparent px-7 text-sm text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              onClick={() => navigate('/verify')}
            >
              {t('mp_cap_verify_cta')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-[100rem] gap-10 px-5 sm:px-8 lg:px-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <HomatchLogo size="md" withTagline />
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-muted-foreground">{t('mp_footer_tagline')}</p>
          </div>

          <nav aria-label={t('mp_footer_product')}>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{t('mp_footer_product')}</p>
            <ul className="mt-4 space-y-2.5">
              {[
                { key: 'verify', label: t('nav_verify'), path: '/verify' },
                { key: 'mortgage', label: t('nav_mortgage'), path: '/mortgage' },
                { key: 'ai', label: t('ai_title'), path: session ? '/ai' : '/auth/signup' },
              ].map(link => (
                <li key={link.key}>
                  <button type="button" onClick={() => navigate(link.path)} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('mp_footer_company')}>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{t('mp_footer_company')}</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <button type="button" onClick={() => navigate('/partners')} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  {t('home_nav_partners')}
                </button>
              </li>
            </ul>
          </nav>

          <nav aria-label={t('mp_footer_legal')}>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{t('mp_footer_legal')}</p>
            <ul className="mt-4 space-y-2.5">
              {[
                { key: 'privacy', label: t('home_footer_privacy'), path: '/privacy' },
                { key: 'terms', label: t('home_footer_terms'), path: '/terms' },
              ].map(link => (
                <li key={link.key}>
                  <button type="button" onClick={() => navigate(link.path)} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="border-t border-border">
          <p className="mx-auto max-w-[100rem] px-5 sm:px-8 lg:px-10 py-5 text-xs text-muted-foreground">
            {t('home_footer_copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}
