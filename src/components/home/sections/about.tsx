// HOMATCH — About, as six independently editable regions.
//
// The markup is the one AboutPage shipped with, moved here unchanged so the
// page looks identical. What is new is that each region is its own component
// reading through useSectionField(), which means Site Studio can reorder,
// hide and re-word them. With no stored overrides every sf(...) call returns
// the same t(...) it replaced, so this split is invisible on the live site.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, Calculator, FileText, Globe, Landmark, LineChart,
  Mail, MapPinned, PhoneCall, Search, ShieldCheck, Sparkles, UserSearch,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { IntentCards } from '@/components/home/IntentCards';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { useSectionField } from '@/site/content';
import { PAGE, SECTION_Y } from './primitives';

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

const DARK_H2 = 'mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-white';
const LIGHT_H2 = 'mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground';
const H2_SIZE = { fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' } as const;

/* ── The statement ─────────────────────────────────────────────── */

export function AboutHeroSection() {
  const sf = useSectionField();
  return (
    <section className="relative isolate overflow-hidden bg-[#0D0D0D] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(58rem 30rem at 14% 0%, hsl(38 88% 54% / 0.13), transparent 62%)' }}
        aria-hidden="true"
      />
      <div className={`${PAGE} relative`}>
        <div className="max-w-[46rem] pb-12 pt-[6.5rem] sm:pb-16 sm:pt-[8rem] lg:pb-20 lg:pt-[9rem]">
          <p className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-6 shrink-0 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'about_eyebrow')}
          </p>
          <h1
            className="mt-5 text-balance font-semibold leading-[1.07] tracking-[-0.03em] text-white sm:mt-6"
            style={{ fontSize: 'clamp(1.5rem, 7vw, 3.4rem)' }}
          >
            {sf('title', 'about_title')}
          </h1>
          <p className="mt-5 max-w-[40rem] text-pretty text-[16px] leading-[1.7] text-white/75 sm:text-base sm:leading-[1.8]">
            {sf('body', 'about_lede')}
          </p>
          <p className="mt-4 max-w-[40rem] text-pretty text-[16px] leading-[1.7] text-gold sm:text-base">
            {sf('subtitle', 'about_lede_2')}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── What it is, against what it is not ────────────────────────── */

export function AboutWhatSection() {
  const { t, isRTL } = useLanguage();
  const sf = useSectionField();
  const navigate = useNavigate();

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
  ] as const;

  return (
    <section id="what" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="max-w-[44rem]">
        <p className="text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
          {sf('eyebrow', 'about_what_eyebrow')}
        </p>
        <h2 className={LIGHT_H2} style={H2_SIZE}>{sf('title', 'about_what_title')}</h2>
        <p className="mt-4 text-pretty text-[16px] leading-[1.7] text-ink-soft sm:text-base">
          {sf('body', 'about_what_body')}
        </p>
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
              <h3 className="mt-4 text-balance text-[17px] font-semibold leading-snug text-foreground">
                {t(cap.title)}
              </h3>
              <p className="mt-2 flex-1 text-pretty text-[16px] leading-relaxed text-ink-soft">{t(cap.desc)}</p>
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
  );
}

/* ── The market it is built around ─────────────────────────────── */

export function AboutMarketSection() {
  const { t } = useLanguage();
  const sf = useSectionField();

  return (
    <section id="market" className="scroll-mt-20 bg-[#0D0D0D] text-white">
      <div className={`${PAGE} ${SECTION_Y}`}>
        <div className="max-w-[44rem]">
          <p className="text-[14px] font-semibold uppercase tracking-[0.22em] text-gold">
            {sf('eyebrow', 'about_market_eyebrow')}
          </p>
          <h2 className={DARK_H2} style={H2_SIZE}>{sf('title', 'about_market_title')}</h2>
          <p className="mt-4 text-pretty text-[16px] leading-[1.7] text-white/70 sm:text-base">
            {sf('body', 'about_market_body')}
          </p>
        </div>

        <ul className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:mt-10 sm:grid-cols-3">
          {MARKET.map(item => (
            <li key={item.key} className="flex items-center gap-3 bg-[#171717] px-4 py-4">
              <item.icon className="h-[18px] w-[18px] shrink-0 text-gold" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 text-[16px] font-medium leading-tight text-white/85 sm:text-sm">
                {t(item.label)}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-5 max-w-[40rem] text-pretty text-[16px] leading-relaxed text-white/50">
          {sf('note', 'about_market_note')}
        </p>
      </div>
    </section>
  );
}

/* ── What the answers are built from ───────────────────────────── */

export function AboutSourcesSection() {
  const { t } = useLanguage();
  const sf = useSectionField();

  return (
    <section id="sources" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
            {sf('eyebrow', 'about_sources_eyebrow')}
          </p>
          <h2 className={LIGHT_H2} style={H2_SIZE}>{sf('title', 'about_sources_title')}</h2>
          <p className="mt-4 text-pretty text-[16px] leading-[1.7] text-ink-soft sm:text-base">
            {sf('body', 'about_sources_body')}
          </p>
          <p className="mt-4 text-pretty text-[16px] leading-relaxed text-muted-foreground">
            {sf('note', 'about_sources_note')}
          </p>
        </div>

        <ul className="grid gap-px overflow-hidden rounded-[0.9rem] border border-foreground/[0.14] bg-foreground/10 sm:grid-cols-2">
          {SOURCES.map(src => (
            <li key={src.key} className="bg-card p-4 sm:p-5">
              <h3 className="text-[16px] font-semibold leading-snug text-foreground">{t(src.label)}</h3>
              <p className="mt-1.5 text-pretty text-[16px] leading-relaxed text-ink-soft">{t(src.desc)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Who it is for ─────────────────────────────────────────────── */

export function AboutIntlSection() {
  const { t } = useLanguage();
  const sf = useSectionField();

  return (
    <section className="bg-[#0D0D0D] text-white">
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
              <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold">
                {sf('eyebrow', 'about_intl_eyebrow')}
              </p>
            </div>
            <h2 className={`${DARK_H2} mt-6 sm:mt-7`} style={H2_SIZE}>
              {sf('title', 'about_intl_title')}
            </h2>
            <p className="mt-4 max-w-[36rem] text-pretty text-[16px] leading-[1.7] text-white/70 sm:text-base">
              {sf('body', 'about_intl_body')}
            </p>
          </div>

          <ul className="grid gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:grid-cols-2 lg:grid-cols-1">
            {(['about_intl_1', 'about_intl_2', 'about_intl_3'] as const).map(key => (
              <li key={key} className="bg-[#171717] p-4 sm:p-5">
                <p className="text-pretty text-[16px] leading-relaxed text-white/85">{t(key)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── A way in, which is a question rather than a button ────────── */

export function AboutAskSection() {
  const sf = useSectionField();

  return (
    <section className={`${PAGE} ${SECTION_Y}`}>
      <div className="max-w-[44rem]">
        <p className="text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
          {sf('eyebrow', 'about_ask_eyebrow')}
        </p>
        <h2 className={LIGHT_H2} style={H2_SIZE}>{sf('title', 'about_ask_title')}</h2>
        <p className="mt-4 text-pretty text-[16px] leading-[1.7] text-ink-soft sm:text-base">
          {sf('body', 'about_ask_body')}
        </p>
      </div>
      <IntentCards className="mt-8 sm:mt-10 lg:grid-cols-4" />
      <p className="mt-6 max-w-[44rem] text-pretty text-[16px] leading-relaxed text-muted-foreground">
        {sf('note', 'about_limits')}
      </p>
    </section>
  );
}
