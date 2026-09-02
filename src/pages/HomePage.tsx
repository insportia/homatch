import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  ArrowRight, Search, Sparkles, Shield, Building2, Home, Users, Globe,
  Zap, Lock, TrendingDown, Copy, BarChart2, ShieldCheck, Bot,
  MessageSquare, Bell, Eye, CheckCircle2, ChevronDown, ChevronUp,
  ExternalLink, Star, Clock, MapPin, Mail, PhoneCall, Radio,
} from 'lucide-react';
import { useState } from 'react';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';

const PENDING_URL_KEY = 'homatch_pending_url';

// ── Demo match cards ──────────────────────────────────────────
// Machine-stable fields (score/price/area/beds/source/location/trustHigh)
// are never translated. Only the presentation labels/badges route through
// translation keys — the underlying data never changes by language.
const DEMO_MATCHES = [
  { score: 94, labelKey: 'home_demo_label_exceptional', price: '$142,000', area: '76 m²', beds: 2, source: 'Homatch', location: 'Vake, Tbilisi', trustHigh: true, badgeKey: 'home_demo_badge_internal' },
  { score: 87, labelKey: 'home_demo_label_strong',      price: '$138,500', area: '74 m²', beds: 2, source: 'myhome.ge', location: 'Vake, Tbilisi', trustHigh: true, badgeKey: 'home_demo_badge_verified' },
  { score: 79, labelKey: 'home_demo_label_good',        price: '$148,000', area: '81 m²', beds: 2, source: 'ss.ge', location: 'Saburtalo, Tbilisi', trustHigh: false, badgeKey: 'home_demo_badge_external' },
];

// ── Features — every user-facing string is a translation key, never a
// hardcoded literal, so the whole grid follows the selected language. ──
const FEATURES = [
  { icon: Bot,          titleKey: 'home_feat_ai_search_title',    descKey: 'home_feat_ai_search_desc',    route: '/ai' },
  { icon: Users,        titleKey: 'home_feat_matching_title',     descKey: 'home_feat_matching_desc',     route: '/property/add' },
  { icon: Globe,        titleKey: 'home_feat_multisource_title',  descKey: 'home_feat_multisource_desc',  route: '/ai' },
  { icon: TrendingDown, titleKey: 'home_feat_cheaper_title',      descKey: 'home_feat_cheaper_desc',      route: '/property/import' },
  { icon: Copy,         titleKey: 'home_feat_duplicate_title',    descKey: 'home_feat_duplicate_desc',    route: '/property/import' },
  { icon: ShieldCheck,  titleKey: 'home_feat_trust_title',        descKey: 'home_feat_trust_desc',        route: '/verify' },
  { icon: Search,       titleKey: 'home_feat_cadastral_title',    descKey: 'home_feat_cadastral_desc',    route: '/verify' },
  { icon: BarChart2,    titleKey: 'home_feat_developer_title',    descKey: 'home_feat_developer_desc',    route: '/verify?tab=developer' },
  { icon: Bell,         titleKey: 'home_feat_active_search_title',descKey: 'home_feat_active_search_desc',route: '/active-search' },
  { icon: MessageSquare,titleKey: 'home_feat_chat_title',         descKey: 'home_feat_chat_desc',         route: '/chat' },
  { icon: Radio,        titleKey: 'home_feat_livechat_title',     descKey: 'home_feat_livechat_desc',     route: '/live-chat' },
  { icon: Eye,          titleKey: 'home_feat_viewing_title',      descKey: 'home_feat_viewing_desc',      route: '/viewings' },
  { icon: Globe,        titleKey: 'home_feat_multilingual_title', descKey: 'home_feat_multilingual_desc', route: null },
];

// ── AI Outreach Engine showcase ──────────────────────────────
const CALL_FEATURE_KEYS = ['home_call_feature_1', 'home_call_feature_2', 'home_call_feature_3'];
const EMAIL_FEATURE_KEYS = ['home_email_feature_1', 'home_email_feature_2', 'home_email_feature_3'];
const SMS_FEATURE_KEYS = ['home_sms_feature_1', 'home_sms_feature_2', 'home_sms_feature_3'];

// ── Buyer / seller flow steps ────────────────────────────────
const BUYER_FLOW = [
  { stepKey: 'home_buyer_step1', descKey: 'home_buyer_step1_desc' },
  { stepKey: 'home_buyer_step2', descKey: 'home_buyer_step2_desc' },
  { stepKey: 'home_buyer_step3', descKey: 'home_buyer_step3_desc' },
  { stepKey: 'home_buyer_step4', descKey: 'home_buyer_step4_desc' },
  { stepKey: 'home_buyer_step5', descKey: 'home_buyer_step5_desc' },
];

const SELLER_FLOW = [
  { stepKey: 'home_seller_step1', descKey: 'home_seller_step1_desc' },
  { stepKey: 'home_seller_step2', descKey: 'home_seller_step2_desc' },
  { stepKey: 'home_seller_step3', descKey: 'home_seller_step3_desc' },
  { stepKey: 'home_seller_step4', descKey: 'home_seller_step4_desc' },
  { stepKey: 'home_seller_step5', descKey: 'home_seller_step5_desc' },
];

// ── How it works ──────────────────────────────────────────────
const HOW_STEPS = [
  { icon: Search,        stepKey: 'home_how_1_step', titleKey: 'home_how_1_title', descKey: 'home_how_1_desc' },
  { icon: Zap,           stepKey: 'home_how_2_step', titleKey: 'home_how_2_title', descKey: 'home_how_2_desc' },
  { icon: MessageSquare, stepKey: 'home_how_3_step', titleKey: 'home_how_3_title', descKey: 'home_how_3_desc' },
  { icon: ShieldCheck,   stepKey: 'home_how_4_step', titleKey: 'home_how_4_title', descKey: 'home_how_4_desc' },
];

// ── Pricing — plan codes (name) are stable identifiers used for routing
// logic and display; only the feature copy is translated. ──
const PLANS = [
  { name: 'FREE', price: '$0', period: '/month', featureKeys: ['home_plan_free_f1', 'home_plan_free_f2', 'home_plan_free_f3', 'home_plan_free_f4'], highlight: false },
  { name: 'PLUS', price: '$4.90', period: '/month', featureKeys: ['home_plan_plus_f1', 'home_plan_plus_f2', 'home_plan_plus_f3', 'home_plan_plus_f4', 'home_plan_plus_f5'], highlight: true },
  { name: 'PRO',  price: '$9.90', period: '/month', featureKeys: ['home_plan_pro_f1', 'home_plan_pro_f2', 'home_plan_pro_f3', 'home_plan_pro_f4', 'home_plan_pro_f5', 'home_plan_pro_f6'], highlight: false },
];

// ── FAQ ───────────────────────────────────────────────────────
const FAQ_KEYS = [
  { qKey: 'home_faq_1_q', aKey: 'home_faq_1_a' },
  { qKey: 'home_faq_2_q', aKey: 'home_faq_2_a' },
  { qKey: 'home_faq_3_q', aKey: 'home_faq_3_a' },
  { qKey: 'home_faq_4_q', aKey: 'home_faq_4_a' },
  { qKey: 'home_faq_5_q', aKey: 'home_faq_5_a' },
  { qKey: 'home_faq_6_q', aKey: 'home_faq_6_a' },
];

// ── Why Homatch ───────────────────────────────────────────────
const WHY_KEYS = [
  { titleKey: 'home_why_1_title', descKey: 'home_why_1_desc' },
  { titleKey: 'home_why_2_title', descKey: 'home_why_2_desc' },
  { titleKey: 'home_why_3_title', descKey: 'home_why_3_desc' },
  { titleKey: 'home_why_4_title', descKey: 'home_why_4_desc' },
  { titleKey: 'home_why_5_title', descKey: 'home_why_5_desc' },
  { titleKey: 'home_why_6_title', descKey: 'home_why_6_desc' },
];

// ── Verification teaser tags ────────────────────────────────────
const VERIFY_TAG_KEYS = ['home_verify_teaser_tag_cadastral', 'home_verify_teaser_tag_address', 'home_verify_teaser_tag_developer', 'home_verify_teaser_tag_project'];

function FaqItem({ qKey, aKey }: { qKey: string; aKey: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 hover:text-primary transition-colors"
        aria-expanded={open}>
        <span className="text-sm font-medium text-foreground">{t(qKey)}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-primary" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{t(aKey)}</p>}
    </div>
  );
}

function MatchScoreBars({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-green-500' : score >= 80 ? 'bg-primary' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${score >= 90 ? 'text-green-400' : score >= 80 ? 'text-primary' : 'text-blue-400'}`}>{score}%</span>
    </div>
  );
}

export default function HomePage() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [aiInput, setAiInput] = useState('');
  const [url, setUrl] = useState('');

  const QUICK_PATHS = [
    { icon: Home,       labelKey: 'home_quick_find_property', action: () => navigate(session ? '/ai' : '/auth/signup') },
    { icon: Users,      labelKey: 'home_quick_find_buyers',   action: () => navigate(session ? '/property/add' : '/auth/signup') },
    { icon: ShieldCheck,labelKey: 'home_quick_verify_property', action: () => navigate('/verify') },
    { icon: Building2,  labelKey: 'home_quick_check_developer', action: () => navigate('/verify?tab=developer') },
    { icon: ExternalLink,labelKey:'home_quick_paste_link',    action: () => navigate(session ? '/property/import' : '/auth/signup') },
  ];

  const handleAISubmit = () => {
    const text = aiInput.trim();
    if (!text) return;
    if (!session) {
      sessionStorage.setItem(PENDING_URL_KEY, text);
      navigate('/auth/login');
      return;
    }
    navigate('/ai', { state: { prompt: text } });
  };

  const handleUrlSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!session) {
      sessionStorage.setItem(PENDING_URL_KEY, trimmed);
      navigate('/auth/login');
      return;
    }
    navigate(`/property/import?url=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Public nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-center h-14 px-4 md:px-8 gap-4 max-w-7xl mx-auto">
          <button
            type="button"
            onClick={() => { navigate('/'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="shrink-0 cursor-pointer"
            aria-label={t('home_nav_home_aria')}
          >
            <HomatchLogo size="sm" />
          </button>
          <div className="flex-1" />
          <LanguageSwitcher />
          <nav className="hidden md:flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-sm" onClick={() => navigate('/verify')}>
              {t('nav_verify')}
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-sm" onClick={() => navigate('/partners')}>
              {t('home_nav_partners')}
            </Button>
          </nav>
          {session ? (
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate('/dashboard')}>
              {t('nav_dashboard')}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hidden md:flex" onClick={() => navigate('/auth/login')}>{t('nav_login')}</Button>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate('/auth/signup')}>{t('nav_signup')}</Button>
            </div>
          )}
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative pt-16 pb-20 px-4 overflow-hidden">
        {/* Background grain */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/4 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center space-y-6 relative">
          <Badge variant="secondary" className="border-primary/30 text-primary bg-primary/10 text-xs px-3 py-1 gap-1.5">
            <Sparkles className="h-3 w-3" /> {t('home_hero_badge')}
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight tracking-tight text-balance">
            <span className="gradient-text">HOMATCH</span> — {t('home_hero_title_lead')}{' '}
            <span className="underline decoration-primary decoration-2 underline-offset-4">{t('home_hero_title_highlight')}</span>{' '}
            &amp; {t('home_hero_title_verification')}
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto text-pretty">
            {t('home_hero_subtitle')}
          </p>

          {/* AI Input */}
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 p-1.5 rounded-2xl border border-primary/30 bg-card shadow-card">
              <div className="relative flex-1">
                <Bot className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary pointer-events-none" />
                <input
                  className="w-full pl-10 pr-4 py-2.5 bg-transparent text-foreground text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                  placeholder={t('home_ai_input_placeholder')}
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAISubmit()}
                />
              </div>
              <Button onClick={handleAISubmit} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 gap-2 px-5">
                {t('nav_ask_ai_short')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/50 mt-2">
              {t('home_works_in_langs')}
            </p>
          </div>

          {/* 5 quick paths */}
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            {QUICK_PATHS.map(({ icon: Icon, labelKey, action }) => (
              <button key={labelKey} type="button" onClick={action}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card/60 hover:border-primary/40 hover:bg-primary/5 transition-colors text-sm text-muted-foreground hover:text-foreground">
                <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI OUTREACH ENGINE — 3 separate showcase blocks, right at the top ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto space-y-16">
          <div className="text-center">
            <Badge variant="secondary" className="border-primary/30 text-primary bg-primary/10 text-xs px-3 py-1 gap-1.5 mb-3">
              <Sparkles className="h-3 w-3" /> {t('home_outreach_badge_new')}
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">{t('home_outreach_title')}</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">{t('home_outreach_subtitle')}</p>
          </div>

          {/* Block 1 — AI Call Center */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4 order-2 md:order-1">
              <div className="w-11 h-11 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <PhoneCall className="h-5 w-5 text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">{t('home_call_title')}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('home_call_desc')}</p>
              <ul className="space-y-2">
                {CALL_FEATURE_KEYS.map(k => (
                  <li key={k} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />{t(k)}
                  </li>
                ))}
              </ul>
              <Button className="bg-green-600 hover:bg-green-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/calls' : '/auth/signup')}>
                {t('home_call_cta')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="order-1 md:order-2">
              <div className="rounded-2xl border border-border bg-card shadow-hover p-5 max-w-sm mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> {t('home_call_live_badge')}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground" dir="ltr">02:14</span>
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <PhoneCall className="h-5 w-5 text-primary" />
                    <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">Giorgi M.</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">+995 5●● ●● ●● ●●</p>
                  </div>
                  <div className="flex items-end gap-0.5 h-6 ml-auto shrink-0" aria-hidden>
                    {[0, 1, 2, 3, 4].map(i => (
                      <span key={i} className="w-1 rounded-full bg-green-400/70 animate-pulse" style={{ height: `${8 + (i % 3) * 5}px`, animationDelay: `${i * 100}ms` }} />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t('home_call_transcript_label')}</p>
                  <p className="text-xs text-foreground leading-relaxed">{t('home_call_transcript_text')}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Block 2 — Email Campaigns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="rounded-2xl border border-border bg-card shadow-hover overflow-hidden max-w-sm mx-auto">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-secondary/40">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                  <span className="text-[10px] text-muted-foreground ml-2">{t('home_email_new_campaign')}</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">{t('home_email_subject_demo')}</p>
                  <div className="space-y-1.5">
                    <div className="h-2 rounded bg-secondary w-full" />
                    <div className="h-2 rounded bg-secondary w-11/12" />
                    <div className="h-2 rounded bg-secondary w-4/5" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">142</p>
                      <p className="text-[10px] text-muted-foreground">{t('home_email_stat_sent')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-blue-400">89</p>
                      <p className="text-[10px] text-muted-foreground">{t('home_email_stat_opened')}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-green-400">12</p>
                      <p className="text-[10px] text-muted-foreground">{t('home_email_stat_replied')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">{t('home_email_title')}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('home_email_desc')}</p>
              <ul className="space-y-2">
                {EMAIL_FEATURE_KEYS.map(k => (
                  <li key={k} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />{t(k)}
                  </li>
                ))}
              </ul>
              <Button className="bg-blue-600 hover:bg-blue-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/email' : '/auth/signup')}>
                {t('home_email_cta')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Block 3 — SMS Campaigns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4 order-2 md:order-1">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">{t('home_sms_title')}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('home_sms_desc')}</p>
              <ul className="space-y-2">
                {SMS_FEATURE_KEYS.map(k => (
                  <li key={k} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />{t(k)}
                  </li>
                ))}
              </ul>
              <Button className="bg-purple-600 hover:bg-purple-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/sms' : '/auth/signup')}>
                {t('home_sms_cta')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="order-1 md:order-2">
              <div className="rounded-2xl border border-border bg-card shadow-hover p-4 max-w-sm mx-auto">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
                  <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-purple-400" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Homatch</p>
                </div>
                <div className="space-y-2">
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-purple-600 text-white text-xs px-3 py-2 leading-relaxed">
                    {t('home_sms_demo_message')}
                  </div>
                  <div className="flex items-center gap-1 justify-end pr-1">
                    <span className="text-[9px] text-muted-foreground">{t('home_sms_delivered')}</span>
                    <CheckCircle2 className="h-2.5 w-2.5 text-purple-400" />
                  </div>
                  <div className="max-w-[70%] rounded-2xl rounded-bl-sm bg-secondary text-foreground text-xs px-3 py-2 leading-relaxed">
                    {t('home_sms_demo_reply')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE CHAT — prominent, standalone from AI chat ── */}
      <section className="py-14 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate(session ? '/live-chat' : '/auth/signup')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(session ? '/live-chat' : '/auth/signup'); } }}
            className="flex flex-col sm:flex-row items-center gap-5 p-6 sm:p-8 rounded-2xl border border-primary/20 bg-primary/5 hover:border-primary/40 hover:shadow-hover transition-all cursor-pointer group"
          >
            <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
              <Radio className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                <h3 className="text-lg font-bold text-foreground">{t('home_livechat_title')}</h3>
                <Badge className="bg-primary text-primary-foreground text-[10px]">{t('home_livechat_badge')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t('home_livechat_desc')}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-1 transition-transform hidden sm:block" />
          </div>
        </div>
      </section>

      {/* ── KEY FEATURES ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t('home_capabilities_label')}</p>
            <h2 className="text-2xl font-bold text-foreground">{t('home_capabilities_title')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, titleKey, descKey, route }) => {
              const clickable = Boolean(route);
              return (
                <div
                  key={titleKey}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => navigate(session ? route! : '/auth/signup') : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(session ? route! : '/auth/signup'); } } : undefined}
                  className={`text-left p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-hover hover:-translate-y-0.5 transition-all group ${clickable ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                    {clickable && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-primary/70 group-hover:translate-x-0.5 transition-all" />}
                  </div>
                  <p className="text-xs font-bold text-foreground underline decoration-primary decoration-1 underline-offset-2 mb-1.5">
                    {t(titleKey)}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(descKey)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── DUAL FLOW ── */}
      <section className="py-16 px-4 border-t border-border bg-card/20">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t('home_dual_flow_label')}</p>
            <h2 className="text-2xl font-bold text-foreground">{t('home_dual_flow_title')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Buyer flow */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Home className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{t('home_buyer_badge')}</p>
                  <p className="text-xs text-muted-foreground">{t('home_buyer_subtitle')}</p>
                </div>
              </div>
              <div className="space-y-2">
                {BUYER_FLOW.map((s, i) => (
                  <div key={s.stepKey} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{t(s.stepKey)}</span>
                      <span className="text-xs text-muted-foreground ml-2">{t(s.descKey)}</span>
                    </div>
                    {i < BUYER_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  </div>
                ))}
              </div>
              <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
                {t('home_buyer_cta')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {/* Seller flow */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
                  <Building2 className="h-4 w-4 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{t('home_seller_badge')}</p>
                  <p className="text-xs text-muted-foreground">{t('home_seller_subtitle')}</p>
                </div>
              </div>
              <div className="space-y-2">
                {SELLER_FLOW.map((s, i) => (
                  <div key={s.stepKey} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent-foreground text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{t(s.stepKey)}</span>
                      <span className="text-xs text-muted-foreground ml-2">{t(s.descKey)}</span>
                    </div>
                    {i < SELLER_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="w-full border-border gap-2"
                onClick={() => navigate(session ? '/property/add' : '/auth/signup')}>
                {t('home_seller_cta')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">
              <span className="underline decoration-primary decoration-2 underline-offset-4">{t('home_how_search')}</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">{t('home_how_match')}</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">{t('home_how_connect')}</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">{t('home_how_verify')}</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_STEPS.map(({ icon: Icon, stepKey, titleKey, descKey }) => (
              <div key={stepKey} className="p-5 rounded-2xl border border-border bg-card space-y-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <p className="text-[10px] font-bold text-primary tracking-widest">{t(stepKey)}</p>
                <p className="text-sm font-semibold text-foreground">{t(titleKey)}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEMO RESULTS ── */}
      <section className="py-16 px-4 border-t border-border bg-card/20">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="text-center">
            <Badge variant="secondary" className="border-amber-500/30 text-amber-400 bg-amber-500/10 mb-3">
              {t('home_demo_badge')}
            </Badge>
            <h2 className="text-2xl font-bold text-foreground">{t('home_demo_title')}</h2>
            <p className="text-sm text-muted-foreground mt-2">{t('home_demo_query')}</p>
          </div>
          <div className="space-y-3">
            {DEMO_MATCHES.map((m, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-foreground" dir="ltr">{m.price}</span>
                      <Badge variant="secondary" className="text-[10px] border-border">{m.source}</Badge>
                      {m.trustHigh && (
                        <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                          <ShieldCheck className="h-2.5 w-2.5 mr-1" /> {t('home_demo_high_trust')}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] border-border">{t(m.badgeKey)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 shrink-0" /> {m.location} · {m.area} · {m.beds} {t('home_demo_br_suffix')}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => {}} className="border border-border text-muted-foreground hover:text-foreground shrink-0" disabled>
                    <Lock className="h-3.5 w-3.5 mr-1.5" /> {t('home_demo_unlock')}
                  </Button>
                </div>
                <MatchScoreBars score={m.score} />
                <p className="text-[10px] text-muted-foreground/50 italic">{t('home_demo_disclaimer')}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
              {t('home_demo_cta')} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── VERIFICATION TEASER ── */}
      <section className="py-14 px-4 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center space-y-4">
            <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-xl font-bold text-foreground">{t('home_verify_teaser_title')}</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {t('home_verify_teaser_desc')}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {VERIFY_TAG_KEYS.map(tagKey => (
                <span key={tagKey} className="text-xs px-3 py-1.5 rounded-full border border-primary/30 text-primary/80 bg-primary/5">{t(tagKey)}</span>
              ))}
            </div>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => navigate('/verify')}>
              {t('home_verify_teaser_cta')} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── WHY HOMATCH ── */}
      <section className="py-16 px-4 border-t border-border bg-card/20">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">{t('home_why_title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_KEYS.map(({ titleKey, descKey }) => (
              <div key={titleKey} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t(titleKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">{t('home_pricing_title')}</h2>
            <p className="text-sm text-muted-foreground mt-2">{t('home_pricing_subtitle')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(plan => (
              <div key={plan.name} className={`p-6 rounded-2xl border flex flex-col gap-4 ${
                plan.highlight
                  ? 'border-primary bg-primary/5 shadow-hover'
                  : 'border-border bg-card'
              }`}>
                {plan.highlight && (
                  <Badge className="self-start bg-primary/20 text-primary border-primary/40 text-[10px]">
                    <Star className="h-2.5 w-2.5 mr-1" /> {t('home_pricing_most_popular')}
                  </Badge>
                )}
                <div>
                  <p className="text-xs font-bold text-muted-foreground tracking-widest" dir="ltr">{plan.name}</p>
                  <p className="text-3xl font-bold text-foreground mt-1" dir="ltr">
                    {plan.price}<span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
                  </p>
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.featureKeys.map(fk => (
                    <li key={fk} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />{t(fk)}
                    </li>
                  ))}
                </ul>
                <Button
                  className={plan.highlight ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border-border'}
                  variant={plan.highlight ? 'default' : 'outline'}
                  onClick={() => navigate(session ? '/credits' : '/auth/signup')}
                >
                  {plan.name === 'FREE' ? t('home_pricing_get_started_free') : t('home_pricing_start_plan', { plan: plan.name })}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {t('home_pricing_footnote')}
          </p>
        </div>
      </section>

      {/* ── URL IMPORT strip ── */}
      <section className="py-10 px-4 border-t border-border bg-card/20">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <p className="text-sm font-semibold text-foreground">{t('home_url_import_title')}</p>
          <p className="text-xs text-muted-foreground">{t('home_url_import_desc')}</p>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
              placeholder={t('home_url_import_placeholder')}
              dir="ltr"
              className="flex-1 bg-secondary border-border text-sm"
            />
            <Button onClick={handleUrlSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
              {t('home_url_import_button')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-2xl font-bold text-foreground text-center">{t('home_faq_title')}</h2>
          <div className="rounded-2xl border border-border bg-card px-5">
            {FAQ_KEYS.map(({ qKey, aKey }) => <FaqItem key={qKey} qKey={qKey} aKey={aKey} />)}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 px-4 border-t border-border bg-primary/5">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <Sparkles className="h-8 w-8 text-primary mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">{t('home_cta_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('home_cta_desc')}</p>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8 py-5"
            onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
            {t('home_cta_button')} <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => { navigate('/'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="cursor-pointer"
            aria-label={t('home_nav_home_aria')}
          >
            <HomatchLogo size="sm" />
          </button>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <button type="button" onClick={() => navigate('/privacy')} className="hover:text-foreground transition-colors">{t('home_footer_privacy')}</button>
            <button type="button" onClick={() => navigate('/terms')} className="hover:text-foreground transition-colors">{t('home_footer_terms')}</button>
            <button type="button" onClick={() => navigate('/verify')} className="hover:text-foreground transition-colors">{t('nav_verify')}</button>
            <button type="button" onClick={() => navigate('/partners')} className="hover:text-foreground transition-colors">{t('home_nav_partners')}</button>
          </div>
          <p className="text-xs text-muted-foreground">{t('home_footer_copyright', { year: String(new Date().getFullYear()) })}</p>
        </div>
      </footer>
    </div>
  );
}
