// HOMATCH — About.
//
// WHAT THIS PAGE IS FOR
//
// Somebody who lands here has usually arrived from a search or a link and
// has not seen the homepage. They should be able to leave understanding the
// product, not the company. So there is no timeline, no team grid, no
// mission card and no founding story: the page explains what Homatch
// actually does, what it is built on top of, who it is for, and what it
// refuses to claim.
//
// WHAT IT DOES NOT CLAIM
//
//  1. Not "the first" anything. That is a claim about the whole Georgian
//     market which nothing in this repository can substantiate, and a
//     superlative nobody can check is worth less than a specific sentence
//     that is true. The positioning is "built in Georgia", which is.
//  2. Not complete coverage of every property in Georgia. The page says
//     Homatch is built to work ACROSS these property types, because that is
//     what the product is designed around, and says nothing about how much
//     of the market is indexed.
//  3. No supplier names, no provider architecture, no scraping detail. The
//     sources section is about the BREADTH of what gets looked at, which is
//     the part that matters to a buyer, and not about how it is fetched.
//  4. No legal representation, no guaranteed safety, no transaction
//     promise. Homatch gathers evidence and explains it. The closing
//     section says exactly that.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, Calculator, FileText, Globe, Landmark, LineChart,
  Mail, MapPinned, PhoneCall, Search, ShieldCheck, Sparkles, UserSearch,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, type HeaderLink } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { IntentCards } from '@/components/home/IntentCards';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from '@/components/home/sections/primitives';

/** The property kinds the platform is built to work across. */
const MARKET = [
  { key: 'apartments', icon: Building2, label: 'about_market_apartments' },
  { key: 'resale', icon: Landmark, label: 'about_market_resale' },
  { key: 'new', icon: Building2, label: 'about_market_new' },
  { key: 'houses', icon: Landmark, label: 'about_market_houses' },
  { key: 'land', icon: MapPinned, label: 'about_market_land' },
  { key: 'commercial', icon: Building2, label: 'about_market_commercial' },
  { key: 'rentals', icon: UserSearch, label: 'about_market_rentals' },
  { key: 'projects', icon: LineChart, label: 'about_market_projects' },
  { key: 'developers', icon: Landmark, label: 'about_market_developers' },
] as const;

/** The kinds of evidence a Homatch answer can be built from. */
const SOURCES = [
  { key: 'official', label: 'about_src_official', desc: 'about_src_official_d' },
  { key: 'listings', label: 'about_src_listings', desc: 'about_src_listings_d' },
  { key: 'projects', label: 'about_src_projects', desc: 'about_src_projects_d' },
  { key: 'web', label: 'about_src_web', desc: 'about_src_web_d' },
  { key: 'market', label: 'about_src_market', desc: 'about_src_market_d' },
  { key: 'documents', label: 'about_src_documents', desc: 'about_src_documents_d' },
  { key: 'yours', label: 'about_src_yours', desc: 'about_src_yours_d' },
  { key: 'intent', label: 'about_src_intent', desc: 'about_src_intent_d' },
] as const;

export default function AboutPage() {
  useSurfaceTheme('light');
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const headerLinks: HeaderLink[] = [
    { key: 'home', label: t('mp_nav_start'), target: '/' },
    { key: 'what', label: t('about_nav_what'), target: 'what' },
    { key: 'market', label: t('about_nav_market'), target: 'market' },
    { key: 'sources', label: t('about_nav_sources'), target: 'sources' },
    { key: 'verify', label: t('nav_verify'), target: '/verify' },
  ];

  /* The eight capabilities, each pointing at the real route behind it. */
  const CAPABILITIES = [
    { key: 'verify', glyph: 'verify' as const, icon: ShieldCheck, title: 'mp_verify_capability_title', desc: 'about_cap_verify', to: '/verify' },
    { key: 'contract', glyph: 'contract' as const, icon: FileText, title: 'mp_contract_title', desc: 'about_cap_contract', to: '/verify' },
    { key: 'match', glyph: 'matching' as const, icon: UserSearch, title: 'mp_tile_match_t', desc: 'about_cap_match', to: '/property/add' },
    { key: 'mortgage', glyph: 'mortgage' as const, icon: Calculator, title: 'mp_mortgage_title', desc: 'about_cap_mortgage', to: '/mortgage' },
    { key: 'calls', glyph: 'calls' as const, icon: PhoneCall, title: 'call_center_title', desc: 'about_cap_calls', to: '/outreach/calls' },
    { key: 'email', glyph: 'email' as const, icon: Mail, title: 'mp_email_title', desc: 'about_cap_email', to: '/outreach/email' },
    { key: 'find', glyph: 'property' as const, icon: Search, title: 'mp_find_title', desc: 'about_cap_find', to: '/ai' },
    { key: 'ai', glyph: 'ai' as const, icon: Sparkles, title: 'ai_title', desc: 'about_cap_ai', to: '/ai' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} />

      <main>
        {/* ── The statement ─────────────────────────────────── */}
        <section className="relative isolate overflow-hidden bg-[#080808] text-white">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(58rem 30rem at 14% 0%, hsl(38 88% 54% / 0.13), transparent 62%)' }}
            aria-hidden="true"
          />
          <div className={`${PAGE} relative`}>
            <div className="max-w-[46rem] pb-12 pt-[6.5rem] sm:pb-16 sm:pt-[8rem] lg:pb-20 lg:pt-[9rem]">
              <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                <span className="h-px w-6 shrink-0 bg-gold" aria-hidden="true" />
                {t('about_eyebrow')}
              </p>
              <h1
                className="mt-5 text-balance font-semibold leading-[1.07] tracking-[-0.03em] text-white sm:mt-6"
                style={{ fontSize: 'clamp(1.5rem, 7vw, 3.4rem)' }}
              >
                {t('about_title')}
              </h1>
              <p className="mt-5 max-w-[40rem] text-pretty text-[14.5px] leading-[1.7] text-white/75 sm:text-base sm:leading-[1.8]">
                {t('about_lede')}
              </p>
              <p className="mt-4 max-w-[40rem] text-pretty text-[14.5px] leading-[1.7] text-gold sm:text-base">
                {t('about_lede_2')}
              </p>
            </div>
          </div>
        </section>

        {/* ── What it is, against what it is not ────────────── */}
        <section id="what" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
          <div className="max-w-[44rem]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">{t('about_what_eyebrow')}</p>
            <h2
              className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
              style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
            >
              {t('about_what_title')}
            </h2>
            <p className="mt-4 text-pretty text-[14.5px] leading-[1.7] text-ink-soft sm:text-base">{t('about_what_body')}</p>
          </div>

          {/* The eight things that are normally eight separate errands. */}
          <ul className="mt-8 grid gap-3.5 sm:mt-10 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(cap => (
              <li key={cap.key}>
                <button
                  type="button"
                  onClick={() => navigate(cap.to)}
                  className="group flex h-full w-full flex-col rounded-[1.1rem] border border-foreground/[0.14] bg-card p-5 text-start transition-[border-color,box-shadow] duration-300 hover:border-foreground/45 hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  <FeatureGlyph
                    name={cap.glyph}
                    size={40}
                    className="transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:transform-none"
                  />
                  <h3 className="mt-4 text-balance text-[15px] font-semibold leading-snug text-foreground">
                    {t(cap.title)}
                  </h3>
                  <p className="mt-2 flex-1 text-pretty text-[13px] leading-relaxed text-ink-soft">{t(cap.desc)}</p>
                  <ArrowRight
                    className={`mt-4 h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-300 group-hover:text-gold-ink motion-reduce:transform-none ${
                      isRTL ? 'rotate-180 group-hover:-translate-x-1' : 'group-hover:translate-x-1'
                    }`}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ── The market it is built around ─────────────────── */}
        <section id="market" className="scroll-mt-20 bg-[#080808] text-white">
          <div className={`${PAGE} ${SECTION_Y}`}>
            <div className="max-w-[44rem]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{t('about_market_eyebrow')}</p>
              <h2
                className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white"
                style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
              >
                {t('about_market_title')}
              </h2>
              <p className="mt-4 text-pretty text-[14.5px] leading-[1.7] text-white/70 sm:text-base">
                {t('about_market_body')}
              </p>
            </div>

            <ul className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:mt-10 sm:grid-cols-3">
              {MARKET.map(item => (
                <li key={item.key} className="flex items-center gap-3 bg-[#0C0C0C] px-4 py-4">
                  <item.icon className="h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0 text-[13px] font-medium leading-tight text-white/85 sm:text-sm">
                    {t(item.label)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-5 max-w-[40rem] text-pretty text-[13px] leading-relaxed text-white/50">
              {t('about_market_note')}
            </p>
          </div>
        </section>

        {/* ── What the answers are built from ───────────────── */}
        <section id="sources" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
          <div className="grid gap-9 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
                {t('about_sources_eyebrow')}
              </p>
              <h2
                className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
                style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
              >
                {t('about_sources_title')}
              </h2>
              <p className="mt-4 text-pretty text-[14.5px] leading-[1.7] text-ink-soft sm:text-base">
                {t('about_sources_body')}
              </p>
              <p className="mt-4 text-pretty text-[13px] leading-relaxed text-muted-foreground">
                {t('about_sources_note')}
              </p>
            </div>

            <ul className="grid gap-px overflow-hidden rounded-[0.9rem] border border-foreground/[0.14] bg-foreground/10 sm:grid-cols-2">
              {SOURCES.map(src => (
                <li key={src.key} className="bg-card p-4 sm:p-5">
                  <h3 className="text-[14px] font-semibold leading-snug text-foreground">{t(src.label)}</h3>
                  <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-ink-soft">{t(src.desc)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Who it is for ─────────────────────────────────── */}
        <section className="bg-[#080808] text-white">
          <div className={`${PAGE} ${SECTION_Y}`}>
            <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16">
              <div className="min-w-0">
                <div className="flex items-center gap-3.5">
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-[0.7rem] border border-white/25 bg-white/[0.07] text-gold sm:h-14 sm:w-14"
                    aria-hidden="true"
                  >
                    <Globe className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                    {t('about_intl_eyebrow')}
                  </p>
                </div>
                <h2
                  className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:mt-7"
                  style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
                >
                  {t('about_intl_title')}
                </h2>
                <p className="mt-4 max-w-[36rem] text-pretty text-[14.5px] leading-[1.7] text-white/70 sm:text-base">
                  {t('about_intl_body')}
                </p>
              </div>

              <ul className="grid gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:grid-cols-2 lg:grid-cols-1">
                {['about_intl_1', 'about_intl_2', 'about_intl_3'].map(key => (
                  <li key={key} className="bg-[#0C0C0C] p-4 sm:p-5">
                    <p className="text-pretty text-[13.5px] leading-relaxed text-white/85">{t(key)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── A way in, which is a question rather than a button ── */}
        <section className={`${PAGE} ${SECTION_Y}`}>
          <div className="max-w-[44rem]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">{t('about_ask_eyebrow')}</p>
            <h2
              className="mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
              style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
            >
              {t('about_ask_title')}
            </h2>
            <p className="mt-4 text-pretty text-[14.5px] leading-[1.7] text-ink-soft sm:text-base">{t('about_ask_body')}</p>
          </div>
          <IntentCards className="mt-8 sm:mt-10 lg:grid-cols-4" />
          <p className="mt-6 max-w-[44rem] text-pretty text-[13px] leading-relaxed text-muted-foreground">
            {t('about_limits')}
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
