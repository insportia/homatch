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
const DEMO_MATCHES = [
  { score: 94, label: 'Exceptional', price: '$142,000', area: '76 m²', beds: 2, source: 'Homatch', location: 'Vake, Tbilisi', trustHigh: true, badge: 'Internal Match' },
  { score: 87, label: 'Strong',      price: '$138,500', area: '74 m²', beds: 2, source: 'myhome.ge', location: 'Vake, Tbilisi', trustHigh: true, badge: 'Verified Listing' },
  { score: 79, label: 'Good',        price: '$148,000', area: '81 m²', beds: 2, source: 'ss.ge', location: 'Saburtalo, Tbilisi', trustHigh: false, badge: 'External' },
];

// ── Features ──────────────────────────────────────────────────
const FEATURES = [
  { icon: Bot,          title: 'AI PROPERTY SEARCH',       desc: 'Describe what you need in plain language. Homatch searches internal and external sources.', route: '/ai' },
  { icon: Users,        title: 'BUYER ↔ SELLER MATCHING',  desc: 'Upload your property once. AI finds qualified demand. Sellers and buyers both benefit.', route: '/property/add' },
  { icon: Globe,        title: 'MULTI-SOURCE DISCOVERY',   desc: 'One request covers Homatch network, property portals, social groups and forums.', route: '/ai' },
  { icon: TrendingDown, title: 'FIND SAME PROPERTY CHEAPER', desc: 'Paste any listing — Homatch finds the same property listed cheaper across other sources.', route: '/property/import' },
  { icon: Copy,         title: 'DUPLICATE DETECTION',      desc: 'Identify duplicate listings and inflated prices before you pay.', route: '/property/import' },
  { icon: ShieldCheck,  title: 'HOMATCH TRUST SCORE',      desc: 'Every listing is scored for consistency, data quality and potential red flags.', route: '/verify' },
  { icon: Search,       title: 'CADASTRAL VERIFICATION',   desc: 'Verify cadastral records, ownership status and area discrepancies before you decide.', route: '/verify' },
  { icon: BarChart2,    title: 'DEVELOPER TRUST PROFILE',  desc: 'Check developer history, active permits, project completion and public risk indicators.', route: '/verify?tab=developer' },
  { icon: Bell,         title: 'ACTIVE AI SEARCH',         desc: 'Set once. AI keeps watching and alerts you when new matches appear.', route: '/active-search' },
  { icon: MessageSquare,title: 'REAL-TIME CHAT',           desc: 'Connect directly with matched buyers, renters or sellers in-app.', route: '/chat' },
  { icon: Radio,        title: 'LIVE CHAT',                desc: 'One global room for the whole Homatch community — pick a nickname and jump in.', route: '/live-chat' },
  { icon: Eye,          title: 'VIEWING REQUESTS',         desc: 'Schedule property viewings directly through Homatch.', route: '/viewings' },
  { icon: Globe,        title: 'MULTILINGUAL DISCOVERY',   desc: 'Search in Georgian, Russian, English, Turkish, Arabic and Hebrew.', route: null },
];

// ── AI Outreach Engine showcase (new) ───────────────────────────
const CALL_FEATURES = ['AI dials and talks to leads live — no human on the line', 'Every call transcribed and summarized automatically', 'Recordings and live status the moment a call ends'];
const EMAIL_FEATURES = ['Personalized to each contact list, sent in seconds', 'Live sent / opened / replied counters', 'Works in all 6 supported languages'];
const SMS_FEATURES = ['Instant delivery to qualified leads', 'Real-time delivered / failed tracking', 'Two-way — replies land straight in your inbox'];

// ── Buyer flow steps ──────────────────────────────────────────
const BUYER_FLOW = [
  { step: 'Tell AI', desc: 'Describe your needs in any language' },
  { step: 'Homatch Matches', desc: 'Internal network searched first (free)' },
  { step: 'External Discovery', desc: 'Portals & social sources if needed' },
  { step: 'Ranked Results', desc: 'Sorted by match score + trust' },
  { step: 'Connect', desc: 'Chat, view, verify — in one place' },
];

const SELLER_FLOW = [
  { step: 'Upload / Import', desc: 'Add your property once' },
  { step: 'Demand Found', desc: 'Internal buyers/renters matched first' },
  { step: 'External Signals', desc: 'Social + forum buyer intent scanned' },
  { step: 'Ranked Demand', desc: 'Qualified leads ranked by fit' },
  { step: 'Unlock & Connect', desc: 'Chat or unlock external contacts' },
];

// ── How it works ──────────────────────────────────────────────
const HOW_STEPS = [
  { icon: Search,       step: '01 SEARCH',  title: 'One Request. Many Sources.', desc: 'Tell Homatch what you need. AI searches internal listings, then external sources — portals, Telegram, Facebook and more.' },
  { icon: Zap,          step: '02 MATCH',   title: 'AI Ranks Every Result',      desc: 'Each result gets a Match Score, Trust Score and duplicate check. Internal matches appear first.' },
  { icon: MessageSquare,step: '03 CONNECT', title: 'Chat, View, Unlock',         desc: 'Internal users connect directly. External contacts are previewed before unlock. Real-time chat and viewing scheduling included.' },
  { icon: ShieldCheck,  step: '04 VERIFY',  title: 'Before You Pay, Verify',     desc: 'Check cadastral records, developer history, area discrepancies and risk indicators from the Verification Center.' },
];

// ── Pricing ───────────────────────────────────────────────────
const PLANS = [
  { name: 'FREE', price: '$0', period: '/month', features: ['5 AI searches/month', '3 property matches', 'Basic Trust Score', 'Verification Center access'], highlight: false },
  { name: 'PLUS', price: '$4.90', period: '/month', features: ['50 AI searches/month', 'Unlimited matches', 'Full Trust Score', 'Active AI Search', 'Real-time Chat'], highlight: true },
  { name: 'PRO',  price: '$9.90', period: '/month', features: ['Unlimited AI searches', 'Priority matching', 'Developer Profiles', 'PAYG external contacts', 'Viewing requests', 'Export & API'], highlight: false },
];

// ── FAQ ───────────────────────────────────────────────────────
const FAQ = [
  { q: 'What makes Homatch different from a listing portal?', a: 'Homatch is not a listing portal. It is an AI matching platform that works for both sides: buyers/renters tell AI what they need and Homatch finds supply; sellers/landlords upload once and Homatch finds demand. We search across internal and external sources, compare duplicates and help you verify before you decide.' },
  { q: 'How does AI property search work?', a: 'Type or speak what you need in any language. Homatch AI interprets your requirements, searches the internal network first, then scans external sources like property portals and social groups. Results are ranked by match score, trust and freshness.' },
  { q: 'What is the Trust Score?', a: 'Each listing is evaluated for consistency across sources, area discrepancies, duplicate images, data freshness and cadastral match. The output is a confidence label and risk indicators — not a guarantee, but a useful signal before you commit.' },
  { q: 'Can I verify a property before buying?', a: 'Yes. The Verification Center lets you search by property address, cadastral code, developer name or project. You can see official records, source-reported data, AI inference and what is unavailable — clearly labeled.' },
  { q: 'How does seller/landlord matching work?', a: 'Add or import your property. Homatch builds a demand profile and scans internal buyers/renters first. If more demand is needed, external sources are searched. Qualified leads are ranked and previewed before you unlock contact details.' },
  { q: 'Is Active AI Search really automatic?', a: 'Yes. Set your criteria once and Homatch keeps running. When new matching properties or buyer signals appear, you get notified automatically — no need to check manually.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-4 text-left gap-4 hover:text-primary transition-colors"
        aria-expanded={open}>
        <span className="text-sm font-medium text-foreground">{q}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-primary" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{a}</p>}
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
            aria-label="Homatch home"
          >
            <HomatchLogo size="sm" />
          </button>
          <div className="flex-1" />
          <LanguageSwitcher />
          <nav className="hidden md:flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-sm" onClick={() => navigate('/verify')}>
              Verify
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-sm" onClick={() => navigate('/partners')}>
              Partners
            </Button>
          </nav>
          {session ? (
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate('/dashboard')}>
              Dashboard
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hidden md:flex" onClick={() => navigate('/auth/login')}>Sign In</Button>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate('/auth/signup')}>Get Started</Button>
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
            <Sparkles className="h-3 w-3" /> AI Real Estate Platform
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight tracking-tight text-balance">
            <span className="gradient-text">HOMATCH</span> — AI Real Estate{' '}
            <span className="underline decoration-primary decoration-2 underline-offset-4">Search, Match</span>{' '}
            &amp; Verification
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto text-pretty">
            Tell Homatch what you need. We search, match, compare and help you verify — across internal listings and external sources.
          </p>

          {/* AI Input */}
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 p-1.5 rounded-2xl border border-primary/30 bg-card shadow-card">
              <div className="relative flex-1">
                <Bot className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary pointer-events-none" />
                <input
                  className="w-full pl-10 pr-4 py-2.5 bg-transparent text-foreground text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                  placeholder='Try: "2BR apartment in Vake under $150k" or "Find buyers for my property"'
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAISubmit()}
                />
              </div>
              <Button onClick={handleAISubmit} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 gap-2 px-5">
                Ask AI <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/50 mt-2">
              Works in Georgian, English, Russian, Turkish, Arabic &amp; Hebrew
            </p>
          </div>

          {/* 5 quick paths */}
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            {[
              { icon: Home,      label: 'Find a Property',        action: () => navigate(session ? '/ai' : '/auth/signup') },
              { icon: Users,     label: 'Find Buyers / Renters',  action: () => navigate(session ? '/property/add' : '/auth/signup') },
              { icon: ShieldCheck,label: 'Verify Property',       action: () => navigate('/verify') },
              { icon: Building2, label: 'Check a Developer',      action: () => navigate('/verify?tab=developer') },
              { icon: ExternalLink,label:'Paste Property Link',   action: () => navigate(session ? '/property/import' : '/auth/signup') },
            ].map(({ icon: Icon, label, action }) => (
              <button key={label} type="button" onClick={action}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card/60 hover:border-primary/40 hover:bg-primary/5 transition-colors text-sm text-muted-foreground hover:text-foreground">
                <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                {label}
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
              <Sparkles className="h-3 w-3" /> New
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">Homatch Doesn't Just Find Leads — It Reaches Them</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">Three AI-driven outreach engines, each built for one job.</p>
          </div>

          {/* Block 1 — AI Call Center */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4 order-2 md:order-1">
              <div className="w-11 h-11 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <PhoneCall className="h-5 w-5 text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">AI Call Center</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">A real AI voice agent calls your leads, has the conversation, and hands you a transcript and recording — you never have to dial.</p>
              <ul className="space-y-2">
                {CALL_FEATURES.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
              <Button className="bg-green-600 hover:bg-green-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/calls' : '/auth/signup')}>
                Open AI Call Center <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="order-1 md:order-2">
              <div className="rounded-2xl border border-border bg-card shadow-hover p-5 max-w-sm mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE CALL
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground">02:14</span>
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <PhoneCall className="h-5 w-5 text-primary" />
                    <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">Giorgi M.</p>
                    <p className="text-xs text-muted-foreground">+995 5●● ●● ●● ●●</p>
                  </div>
                  <div className="flex items-end gap-0.5 h-6 ml-auto shrink-0" aria-hidden>
                    {[0, 1, 2, 3, 4].map(i => (
                      <span key={i} className="w-1 rounded-full bg-green-400/70 animate-pulse" style={{ height: `${8 + (i % 3) * 5}px`, animationDelay: `${i * 100}ms` }} />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Live transcript</p>
                  <p className="text-xs text-foreground leading-relaxed">"...yes, I'm still interested in the 2-bedroom in Vake. Is it still available and can we—"</p>
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
                  <span className="text-[10px] text-muted-foreground ml-2">New Campaign</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Exclusive: 2BR in Vake — Priced to Sell</p>
                  <div className="space-y-1.5">
                    <div className="h-2 rounded bg-secondary w-full" />
                    <div className="h-2 rounded bg-secondary w-11/12" />
                    <div className="h-2 rounded bg-secondary w-4/5" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">142</p>
                      <p className="text-[10px] text-muted-foreground">Sent</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-blue-400">89</p>
                      <p className="text-[10px] text-muted-foreground">Opened</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-green-400">12</p>
                      <p className="text-[10px] text-muted-foreground">Replied</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Email Campaigns</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Send personalized outreach to your entire contact list in one click, and watch delivery, opens and replies update live.</p>
              <ul className="space-y-2">
                {EMAIL_FEATURES.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
              <Button className="bg-blue-600 hover:bg-blue-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/email' : '/auth/signup')}>
                Open Email Campaigns <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Block 3 — SMS Campaigns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4 order-2 md:order-1">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">SMS Campaigns</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Text leads directly — the channel with the highest read rate. Two-way replies land straight back in Homatch.</p>
              <ul className="space-y-2">
                {SMS_FEATURES.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
              <Button className="bg-purple-600 hover:bg-purple-600/90 text-white gap-2" onClick={() => navigate(session ? '/outreach/sms' : '/auth/signup')}>
                Open SMS Campaigns <ArrowRight className="h-4 w-4" />
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
                    Hi! We found buyers interested in your Vake listing 🏠 Reply YES for details.
                  </div>
                  <div className="flex items-center gap-1 justify-end pr-1">
                    <span className="text-[9px] text-muted-foreground">Delivered</span>
                    <CheckCircle2 className="h-2.5 w-2.5 text-purple-400" />
                  </div>
                  <div className="max-w-[70%] rounded-2xl rounded-bl-sm bg-secondary text-foreground text-xs px-3 py-2 leading-relaxed">
                    Yes, tell me more!
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
                <h3 className="text-lg font-bold text-foreground">Homatch Live Chat</h3>
                <Badge className="bg-primary text-primary-foreground text-[10px]">LIVE</Badge>
              </div>
              <p className="text-sm text-muted-foreground">One global room, open to every Homatch member — pick a public nickname and talk in real time. Separate from AI Assistant and from your private conversations.</p>
            </div>
            <ArrowRight className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-1 transition-transform hidden sm:block" />
          </div>
        </div>
      </section>

      {/* ── KEY FEATURES ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Platform Capabilities</p>
            <h2 className="text-2xl font-bold text-foreground">Everything in One Place</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc, route }) => {
              const clickable = Boolean(route);
              return (
                <div
                  key={title}
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
                    {title}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
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
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Both Sides. One Platform.</p>
            <h2 className="text-2xl font-bold text-foreground">Homatch Works for Everyone</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Buyer flow */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Home className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">BUYER / RENTER</p>
                  <p className="text-xs text-muted-foreground">I need to find a property</p>
                </div>
              </div>
              <div className="space-y-2">
                {BUYER_FLOW.map((s, i) => (
                  <div key={s.step} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{s.step}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.desc}</span>
                    </div>
                    {i < BUYER_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  </div>
                ))}
              </div>
              <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
                Start Searching <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {/* Seller flow */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
                  <Building2 className="h-4 w-4 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">SELLER / LANDLORD</p>
                  <p className="text-xs text-muted-foreground">I want to find buyers or renters</p>
                </div>
              </div>
              <div className="space-y-2">
                {SELLER_FLOW.map((s, i) => (
                  <div key={s.step} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent-foreground text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{s.step}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.desc}</span>
                    </div>
                    {i < SELLER_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="w-full border-border gap-2"
                onClick={() => navigate(session ? '/property/add' : '/auth/signup')}>
                Add My Property <ArrowRight className="h-4 w-4" />
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
              <span className="underline decoration-primary decoration-2 underline-offset-4">SEARCH</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">MATCH</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">CONNECT</span>
              {' → '}
              <span className="underline decoration-primary decoration-2 underline-offset-4">VERIFY</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_STEPS.map(({ icon: Icon, step, title, desc }) => (
              <div key={step} className="p-5 rounded-2xl border border-border bg-card space-y-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <p className="text-[10px] font-bold text-primary tracking-widest">{step}</p>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
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
              Demo — Sample Results Only
            </Badge>
            <h2 className="text-2xl font-bold text-foreground">See What Homatch Returns</h2>
            <p className="text-sm text-muted-foreground mt-2">AI query: "I need a 2-bedroom apartment in Vake under $150,000"</p>
          </div>
          <div className="space-y-3">
            {DEMO_MATCHES.map((m, i) => (
              <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-foreground">{m.price}</span>
                      <Badge variant="secondary" className="text-[10px] border-border">{m.source}</Badge>
                      {m.trustHigh && (
                        <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                          <ShieldCheck className="h-2.5 w-2.5 mr-1" /> High Trust
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] border-border">{m.badge}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 shrink-0" /> {m.location} · {m.area} · {m.beds} BR
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => {}} className="border border-border text-muted-foreground hover:text-foreground shrink-0" disabled>
                    <Lock className="h-3.5 w-3.5 mr-1.5" /> Unlock
                  </Button>
                </div>
                <MatchScoreBars score={m.score} />
                <p className="text-[10px] text-muted-foreground/50 italic">⚠️ Demo data only — not real listings</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
              Get Real Results <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── VERIFICATION TEASER ── */}
      <section className="py-14 px-4 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center space-y-4">
            <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Before you pay, verify.</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Check cadastral records, area discrepancies, developer history and risk indicators before making a commitment.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {['Cadastral Code', 'Property Address', 'Developer Name', 'Project'].map(tag => (
                <span key={tag} className="text-xs px-3 py-1.5 rounded-full border border-primary/30 text-primary/80 bg-primary/5">{tag}</span>
              ))}
            </div>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              onClick={() => navigate('/verify')}>
              Open Verification Center <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── WHY HOMATCH ── */}
      <section className="py-16 px-4 border-t border-border bg-card/20">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">Why Homatch?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Stop checking portals manually', desc: 'One AI request covers Homatch, property portals, Telegram and Facebook groups simultaneously.' },
              { title: 'Internal supply/demand first', desc: 'Your request is matched against the Homatch network before any external paid search runs.' },
              { title: 'AI filters and ranks', desc: 'Results are sorted by relevance, freshness and trust — not by who paid to be at the top.' },
              { title: 'Duplicates and price differences', desc: 'The same property on 3 sources at 3 prices? Homatch shows you the cheapest option.' },
              { title: 'Verify before you decide', desc: 'Cadastral records, ownership, developer history and risk signals — all in one place.' },
              { title: 'Active Searches work for you', desc: 'Set your criteria once and AI keeps watching. New matches arrive automatically.' },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
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
            <h2 className="text-2xl font-bold text-foreground">Simple, Transparent Pricing</h2>
            <p className="text-sm text-muted-foreground mt-2">Same plans for buyers, renters, sellers and landlords.</p>
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
                    <Star className="h-2.5 w-2.5 mr-1" /> Most Popular
                  </Badge>
                )}
                <div>
                  <p className="text-xs font-bold text-muted-foreground tracking-widest">{plan.name}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">
                    {plan.price}<span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
                  </p>
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={plan.highlight ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border-border'}
                  variant={plan.highlight ? 'default' : 'outline'}
                  onClick={() => navigate(session ? '/credits' : '/auth/signup')}
                >
                  {plan.name === 'FREE' ? 'Get Started Free' : `Start ${plan.name}`}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Additional external operations use Credits at actual cost ×2. No hidden fees.
          </p>
        </div>
      </section>

      {/* ── URL IMPORT strip ── */}
      <section className="py-10 px-4 border-t border-border bg-card/20">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <p className="text-sm font-semibold text-foreground">Paste any property listing URL</p>
          <p className="text-xs text-muted-foreground">Homatch imports the details, finds duplicates and searches for a better price.</p>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
              placeholder="https://myhome.ge/..."
              className="flex-1 bg-secondary border-border text-sm"
            />
            <Button onClick={handleUrlSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
              Import
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-2xl font-bold text-foreground text-center">Frequently Asked Questions</h2>
          <div className="rounded-2xl border border-border bg-card px-5">
            {FAQ.map(({ q, a }) => <FaqItem key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 px-4 border-t border-border bg-primary/5">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <Sparkles className="h-8 w-8 text-primary mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">Start with Homatch AI — free</h2>
          <p className="text-sm text-muted-foreground">Tell us what you need. We find it, match it and help you verify it.</p>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8 py-5"
            onClick={() => navigate(session ? '/ai' : '/auth/signup')}>
            Try Homatch AI Free <ArrowRight className="h-5 w-5" />
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
            aria-label="Homatch home"
          >
            <HomatchLogo size="sm" />
          </button>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <button type="button" onClick={() => navigate('/privacy')} className="hover:text-foreground transition-colors">Privacy</button>
            <button type="button" onClick={() => navigate('/terms')} className="hover:text-foreground transition-colors">Terms</button>
            <button type="button" onClick={() => navigate('/verify')} className="hover:text-foreground transition-colors">Verify</button>
            <button type="button" onClick={() => navigate('/partners')} className="hover:text-foreground transition-colors">Partners</button>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 Homatch. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
