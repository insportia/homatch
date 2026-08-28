import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowRight, Search, Lock, Zap, Globe, Users, TrendingUp, Home,
  MapPin, ChevronDown, ChevronUp, Star, Unlock,
} from 'lucide-react';

const PENDING_URL_KEY = 'homatch_pending_url';

// ── Who Homatch Finds ─────────────────────────────────────────
const WHO_ITEMS = [
  { icon: Home, key: 'who_buyer' },
  { icon: TrendingUp, key: 'who_investor' },
  { icon: Users, key: 'who_tenant' },
  { icon: MapPin, key: 'who_relocating' },
] as const;

// ── Where Homatch Searches ────────────────────────────────────
const WHERE_ITEMS = [
  { label: 'Public Web', sub: 'Google · Bing · News' },
  { label: 'Facebook', sub: 'Public Groups & Pages' },
  { label: 'Telegram', sub: 'Public Groups & Supergroups' },
  { label: 'Instagram', sub: 'Public Content' },
  { label: 'VK', sub: 'Public Communities' },
  { label: 'Forums', sub: 'Real-Estate Boards' },
] as const;

// ── Demo Match fixture ────────────────────────────────────────
const DEMO_MATCH = {
  score: 91,
  strength: 'STRONG',
  platform: 'Telegram',
  language: 'RU',
  city: 'Tbilisi · Vake',
  budget: '$130,000–$160,000',
  bedrooms: '2+',
  recency: '3h ago',
  excerpt: 'Ищу 2-комнатную квартиру в Ваке или Сабуртало…',
  unlockPrice: 3.5,
};

// ── FAQ ───────────────────────────────────────────────────────
const FAQ_ITEMS = [
  { q: 'faq_q1', a: 'faq_a1' },
  { q: 'faq_q2', a: 'faq_a2' },
  { q: 'faq_q3', a: 'faq_a3' },
  { q: 'faq_q4', a: 'faq_a4' },
  { q: 'faq_q5', a: 'faq_a5' },
] as const;

// Strength bar colours
const STRENGTH_CFG = {
  POTENTIAL: { color: 'text-muted-foreground', bg: 'bg-muted', bars: 1 },
  GOOD:      { color: 'text-blue-400',         bg: 'bg-blue-500', bars: 2 },
  STRONG:    { color: 'text-primary',          bg: 'bg-primary', bars: 3 },
  VERY_STRONG: { color: 'text-primary',        bg: 'bg-primary', bars: 4 },
  EXCEPTIONAL: { color: 'text-primary',        bg: 'bg-primary', bars: 5 },
} as const;

function SignalBars({ strength }: { strength: keyof typeof STRENGTH_CFG }) {
  const cfg = STRENGTH_CFG[strength] ?? STRENGTH_CFG.POTENTIAL;
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[1,2,3,4,5].map(i => (
        <div
          key={i}
          className={`w-1 rounded-sm transition-colors ${i <= cfg.bars ? cfg.bg : 'bg-muted'}`}
          style={{ height: `${40 + i * 12}%` }}
        />
      ))}
    </div>
  );
}

function FaqItem({ q, a, t }: { q: string; a: string; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 hover:text-primary transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-foreground">{t(q)}</span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-primary" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{t(a)}</p>
      )}
    </div>
  );
}

export default function HomePage() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore pending URL if redirected back after auth
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_URL_KEY);
    if (pending) {
      setUrl(pending);
      sessionStorage.removeItem(PENDING_URL_KEY);
    }
  }, []);

  const handleAnalyse = () => {
    const trimmed = url.trim();
    if (!trimmed) { inputRef.current?.focus(); return; }
    if (!session) {
      sessionStorage.setItem(PENDING_URL_KEY, trimmed);
      navigate('/auth/login?intent=analyse');
      return;
    }
    navigate(`/property/import?url=${encodeURIComponent(trimmed)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAnalyse();
  };

  const handleCreatePrivate = () => {
    if (!session) {
      sessionStorage.setItem('homatch_pending_url', '');
      navigate('/auth/login?intent=private');
      return;
    }
    navigate('/property/create');
  };

  const steps = [
    { icon: Search, title: t('hero_step1_title'), desc: t('hero_step1_desc') },
    { icon: Zap,    title: t('hero_step2_title'), desc: t('hero_step2_desc') },
    { icon: Lock,   title: t('hero_step3_title'), desc: t('hero_step3_desc') },
    { icon: Unlock, title: t('hero_step4_title'), desc: t('hero_step4_desc') },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background overflow-x-hidden">

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 md:px-8 h-14 border-b border-border/50 shrink-0 sticky top-0 z-40 bg-background/95 backdrop-blur-sm">
        <HomatchLogo size="sm" />
        <div className="flex items-center gap-2 shrink-0">
          <LanguageSwitcher />
          {session ? (
            <Link to="/dashboard">
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground h-8 text-sm">
                {t('nav_dashboard')} →
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/auth/login">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-8 text-sm hidden md:inline-flex">
                  {t('auth_signin')}
                </Button>
              </Link>
              <Link to="/auth/signup">
                <Button size="sm" className="h-8 text-sm bg-primary text-primary-foreground hover:bg-primary/90">
                  {t('nav_signup')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">

        {/* ── Hero ────────────────────────────────────────────── */}
        <section className="flex flex-col items-center justify-center px-4 py-16 md:py-24 amber-glow">
          <div className="w-full max-w-2xl mx-auto text-center space-y-8 relative z-10">

            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary tracking-wide">{t('hero_badge')}</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl md:text-5xl font-semibold text-foreground leading-tight text-balance">
                {t('hero_headline')}
              </h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto text-pretty">
                {t('hero_subheadline')}
              </p>
            </div>

            <div className="space-y-4 w-full max-w-xl mx-auto">
              <div className={`flex gap-2 p-1.5 rounded-xl border border-border bg-card shadow-card ${isRTL ? 'flex-row-reverse' : ''}`}>
                <Input
                  ref={inputRef}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('hero_url_placeholder')}
                  className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 min-w-0 h-10"
                  dir="ltr"
                />
                <Button
                  onClick={handleAnalyse}
                  className="shrink-0 h-10 px-5 font-semibold tracking-wide bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
                >
                  {t('hero_analyse_btn')}
                  <ArrowRight className={`h-4 w-4 ${isRTL ? 'mr-1.5 rotate-180' : 'ml-1.5'}`} />
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium">{t('hero_or')}</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <Button
                variant="ghost"
                onClick={handleCreatePrivate}
                className="w-full h-10 border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 text-sm font-medium"
              >
                <Lock className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} text-muted-foreground`} />
                {t('hero_private_btn')}
              </Button>

              <p className="text-xs text-muted-foreground/60 flex items-center justify-center gap-1.5">
                <Globe className="h-3 w-3" />
                {t('hero_geo_hint')}
              </p>
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────── */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="max-w-4xl mx-auto">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-10">
              {t('hero_how_it_works')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {steps.map((step, i) => (
                <div key={i} className="relative p-5 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <step.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground mb-1 text-balance">{step.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                  <span className="absolute top-3 right-4 text-xs font-bold text-muted-foreground/20">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Who Homatch finds ────────────────────────────────── */}
        <section className="px-4 py-14 bg-card border-y border-border/40">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t('hero_who_title')}</p>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_who_headline')}</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {WHO_ITEMS.map(item => (
                <div key={item.key} className="p-5 rounded-xl border border-border bg-background hover:border-primary/30 transition-colors text-center space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{t(`${item.key}_title` as any)}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(`${item.key}_desc` as any)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Where Homatch searches ───────────────────────────── */}
        <section className="px-4 py-14 border-b border-border/40">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t('hero_where_title')}</p>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_where_headline')}</h2>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {WHERE_ITEMS.map(item => (
                <div key={item.label} className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors">
                  <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-none">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Demo Match card ──────────────────────────────────── */}
        <section className="px-4 py-14 bg-card border-b border-border/40">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t('hero_demo_title')}</p>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_demo_headline')}</h2>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto text-pretty">{t('hero_demo_desc')}</p>
            </div>

            <div className="max-w-md mx-auto">
              <div className="rounded-xl border border-primary/30 bg-background shadow-card p-5 space-y-4 relative">
                {/* DEMO badge */}
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-0.5 rounded-full text-[10px] font-bold tracking-widest bg-primary text-primary-foreground uppercase">
                    DEMO
                  </span>
                </div>

                {/* Header row */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <SignalBars strength="STRONG" />
                    <span className="text-xs font-semibold text-primary">Strong signal</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">NEW</span>
                </div>

                {/* Chips */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    DEMO_MATCH.platform,
                    DEMO_MATCH.language,
                    DEMO_MATCH.city,
                    DEMO_MATCH.budget,
                    `${DEMO_MATCH.bedrooms} bd`,
                    DEMO_MATCH.recency,
                  ].map(chip => (
                    <span key={chip} className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
                      {chip}
                    </span>
                  ))}
                </div>

                {/* Locked excerpt */}
                <div className="rounded-lg bg-secondary/50 border border-border/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground italic line-clamp-2 blur-[2px] select-none">
                    {DEMO_MATCH.excerpt}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <Lock className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[10px] text-muted-foreground/50">Unlock to read full signal</span>
                  </div>
                </div>

                {/* Score row */}
                <div className="flex items-center justify-between pt-1 border-t border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground">Match</p>
                      <p className="text-sm font-bold text-primary">{DEMO_MATCH.score}%</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[1,2,3,4,5].map(i => (
                        <Star key={i} className={`h-3 w-3 ${i <= 4 ? 'text-primary fill-primary' : 'text-muted-foreground'}`} />
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-8 px-4 text-xs gap-1.5"
                    onClick={() => navigate(session ? '/dashboard' : '/auth/signup')}
                  >
                    <Unlock className="h-3 w-3" />
                    UNLOCK · {DEMO_MATCH.unlockPrice} CR
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground/40 text-center">
                  This is a demo card. Real results appear after adding your property.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Private/Off-Market explanation ──────────────────── */}
        <section className="px-4 py-14 border-b border-border/40">
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-secondary">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">PRIVATE · OFF-MARKET</span>
              </div>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_private_exp_title')}</h2>
              <p className="text-sm text-muted-foreground text-pretty leading-relaxed">{t('hero_private_exp_desc')}</p>
            </div>
            <div className="space-y-3">
              {(['hero_private_bullet1','hero_private_bullet2','hero_private_bullet3'] as const).map(key => (
                <div key={key} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                  <p className="text-sm text-muted-foreground">{t(key as any)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Credits explanation ──────────────────────────────── */}
        <section className="px-4 py-14 bg-card border-b border-border/40">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t('hero_credits_title')}</p>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_credits_headline')}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([
                { icon: Zap, titleKey: 'hero_credits_c1_title', descKey: 'hero_credits_c1_desc' },
                { icon: Star, titleKey: 'hero_credits_c2_title', descKey: 'hero_credits_c2_desc' },
                { icon: TrendingUp, titleKey: 'hero_credits_c3_title', descKey: 'hero_credits_c3_desc' },
              ] as const).map(({ icon: Icon, titleKey, descKey }) => (
                <div key={titleKey} className="p-5 rounded-xl border border-border bg-background space-y-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{t(titleKey as any)}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(descKey as any)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="px-4 py-14 border-b border-border/40">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">FAQ</p>
              <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_faq_headline')}</h2>
            </div>
            <div className="rounded-xl border border-border bg-card px-5">
              {FAQ_ITEMS.map(item => (
                <FaqItem key={item.q} q={item.q} a={item.a} t={t as any} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────── */}
        <section className="px-4 py-16 bg-card">
          <div className="max-w-xl mx-auto text-center space-y-6">
            <h2 className="text-xl md:text-2xl font-semibold text-foreground text-balance">{t('hero_cta_title')}</h2>
            <p className="text-sm text-muted-foreground text-pretty">{t('hero_cta_desc')}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={handleCreatePrivate}
                className="h-11 px-8 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm"
              >
                <Lock className="h-4 w-4 mr-2" />
                {t('hero_private_btn')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="h-11 px-8 border border-border text-muted-foreground hover:text-foreground text-sm"
              >
                {t('hero_cta_or_import')}
              </Button>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 px-4 py-5">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
          <HomatchLogo size="sm" />
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">Terms of Service</Link>
          </div>
          <p className="text-xs text-muted-foreground/50">
            © {new Date().getFullYear()} Homatch. AI Property Matching.
          </p>
        </div>
      </footer>
    </div>
  );
}
