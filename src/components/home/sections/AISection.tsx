import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, Building2, Calculator, FileText, Mail, Plane, Search, ShieldCheck, TrendingUp, UserSearch,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { IntentCards } from '@/components/home/IntentCards';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import { HomiHomeStage } from '@/components/homi/HomiHomeStage';
import type { HomiGesture } from '@/components/homi/HomiStage3D';

/**
 * REGION 09 — Homatch AI.
 *
 * The hero carries a field and three questions, so the assistant is reachable
 * from the first screen. THIS is where it is explained, and where the full
 * set of starter questions lives.
 *
 * WHY THE QUESTIONS ARE THE SECTION
 *
 * The previous pass put a console here with four chips named after features,
 * and a capability list beside it. The list is still the honest part: it is
 * what separates an assistant from a chat widget. But the chips asked a
 * visitor to pick a feature, and nobody arrives thinking in features. They
 * arrive thinking "is this price normal" and "what do I check before I
 * sign". Eight of those are now the centre of the region, and each is one
 * click into the real conversation.
 *
 * HOMI (2026-10-24, owner instruction): the assistant is introduced here by
 * name and in person. The 3D HOMI greets once when the region appears, points
 * at the questions a visitor hovers and gestures over the capability list;
 * the 2D HOMI stands in until (and unless) the 3D one can load. The region's
 * layout and black/gold identity are unchanged.
 */
export function AISection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);
  const [gesture, setGesture] = useState<HomiGesture>('idle');
  const [pointTo, setPointTo] = useState(1);
  /* One greeting, the first time the region is actually seen. */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer = 0;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setGesture('greeting');
        timer = window.setTimeout(() => setGesture((g) => (g === 'greeting' ? 'idle' : g)), 3400);
        io.disconnect();
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, []);
  const look = (g: HomiGesture, dir = 1) => () => { setGesture(g); setPointTo(dir); };
  const rest = () => setGesture('idle');

  /* What a question reaches — every tile opens the real product. AI Call
     Center is deliberately not listed here (owner, 2026-10-24); Investment
     and the expat services are. */
  const reach = [
    { key: 'find', icon: Search, to: '/find-property', label: sf('reach_find', 'mp_find_title') },
    { key: 'verify', icon: ShieldCheck, to: '/verify', label: sf('reach_verify', 'mp_verify_capability_title') },
    { key: 'mortgage', icon: Calculator, to: '/mortgage', label: sf('reach_mortgage', 'mp_mortgage_title') },
    { key: 'investment', icon: TrendingUp, to: '/investment', label: sf('reach_investment', 'homi_reach_investment') },
    { key: 'contract', icon: FileText, to: '/contracts', label: sf('reach_contract', 'mp_contract_title') },
    { key: 'expats', icon: Plane, to: '/for-expats/georgia', label: sf('reach_expats', 'homi_reach_expats') },
    { key: 'match', icon: UserSearch, to: '/property/add', label: sf('reach_match', 'mp_match_title') },
    { key: 'email', icon: Mail, to: '/outreach/email', label: sf('reach_email', 'mp_email_title') },
    { key: 'dev', icon: Building2, to: '/developers', label: sf('reach_dev', 'mp_dev_eyebrow') },
  ];
  const [active, setActive] = useState<string | null>(null);
  const activeItem = reach.find((r) => r.key === active) ?? null;
  const tileRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  /* Desktop: hover and keyboard focus select. Touch: the first tap selects
     (HOMI points and explains), the second opens. */
  const pinned = useRef(false);
  const focusTile = (key: string) => () => { setActive(key); setGesture('pointing'); setPointTo(1); };
  const leaveTile = () => { if (pinned.current) return; setActive(null); setGesture('idle'); };
  /* Read at pointer-down: a touch fires a synthetic hover just before its
     click, so by click time every tapped tile already looks selected. */
  const down = useRef<{ key: string; wasActive: boolean; touch: boolean } | null>(null);
  const pressTile = (key: string) => (e: React.PointerEvent) => {
    down.current = { key, wasActive: active === key, touch: e.pointerType !== 'mouse' };
  };
  const tapTile = (key: string) => (e: React.MouseEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || d.key !== key || !d.touch || d.wasActive) return; // a mouse click, or the second tap, opens it
    e.preventDefault();
    pinned.current = true;
    setActive(key); setGesture('pointing'); setPointTo(1);
  };

  return (
    <section ref={sectionRef} id="how" className={`${PAGE} scroll-mt-20 border-t border-border ${SECTION_Y}`}>
      <div className="flex items-center gap-3.5">
        <FeatureGlyph name="ai" size={48} className="sm:h-14 sm:w-14" />
        <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
          {sf('eyebrow', 'mp_flow_eyebrow')}
        </p>
      </div>

      <div className="mt-6 grid gap-5 sm:mt-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end lg:gap-16">
        <h2
          className="max-w-[34rem] text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
          style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
         {...fp('title')}>
          {sf('title', 'mp_flow_title')}
        </h2>
        <div>
          <p className="text-pretty text-[16px] leading-[1.65] text-ink-soft sm:text-base sm:leading-[1.7]" {...fp('body')}>
            {sf('body', 'mp_flow_sub')}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/ai"
              onMouseEnter={look('happy')} onMouseLeave={rest} onFocus={look('happy')} onBlur={rest}
              className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {t('homi_home_cta')}
            </Link>
            <a
              href="#homi-reach"
              onMouseEnter={look('pointing', 1)} onMouseLeave={rest} onFocus={look('pointing', 1)} onBlur={rest}
              className="inline-flex min-h-11 items-center rounded-full border border-foreground/25 px-5 text-[15px] font-medium text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
            >
              {t('homi_home_cta_secondary')}
            </a>
          </div>
        </div>
      </div>

      <div className="mt-8 min-w-0 sm:mt-10" onMouseEnter={look('pointing', -1)} onMouseLeave={rest} onFocusCapture={look('pointing', -1)} onBlurCapture={rest}>
        <HomatchAsk variant="console" placeholder={t('mp_hero_ai_placeholder')} actions={[]} />

        <p className="mt-7 text-[14px] font-semibold uppercase tracking-[0.16em] text-muted-foreground" {...fp('intent_label')}>
          {sf('intent_label', 'mp_intent_label')}
        </p>
        {/* Eight questions, eight fields. Keyed by the intent rather than
            numbered, because the set is fixed here and an admin's rewrite
            should follow the question it belongs to. */}
        <IntentCards
          className="mt-4"
          text={intent => sf(`q_${intent.key}`, intent.prompt)}
          mark={intent => fp(`q_${intent.key}`)}
        />
      </div>

      {/*
        * WHAT A QUESTION REACHES — the HOMI panel.
        *
        * The homepage's own black and gold. HOMI stands on the left and
        * follows whichever service a visitor hovers or tabs to; the bubble
        * beside HOMI says what that service does. Every tile is a real link
        * to the product, never a decorative chip.
        */}
      <div
        id="homi-reach"
        className="relative mt-10 scroll-mt-24 overflow-clip rounded-[1.5rem] border border-[hsl(38_92%_56%)]/25 bg-[#0C1119] px-3.5 py-5 text-white shadow-[0_30px_80px_-40px_rgba(0,0,0,0.6)] sm:mt-12 sm:p-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -start-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(245,166,35,0.22),transparent_65%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 end-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(79,178,255,0.14),transparent_65%)]" />
        <p className="relative text-[14px] font-semibold uppercase tracking-[0.16em] text-[hsl(38_92%_62%)]" {...fp('reach_label')}>
          {sf('reach_label', 'mp_ai_reach_label')}
        </p>
        {/* Phones: HOMI and its bubble side by side on top, the services as a
            compact 3 × 3 grid under them — the whole panel on one screen.
            From sm up: HOMI beside the list, bubble under HOMI. */}
        <div className="relative mt-4 grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
          <div className="flex items-center gap-3 self-start sm:flex-col sm:items-center lg:items-start">
            <HomiHomeStage
              gesture={gesture}
              pointTo={pointTo}
              target={active ? tileRefs.current[active] ?? null : null}
              className="h-[148px] w-[92px] shrink-0 sm:h-[280px] sm:w-[200px] lg:w-[230px]"
            />
            {/* HOMI's bubble: what the service in focus does, or how to use the panel. */}
            <div
              aria-live="polite"
              className="relative min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[14px] leading-snug text-white/90 sm:mt-2 sm:w-full sm:flex-none sm:px-4 sm:text-[15px]"
            >
              <span aria-hidden="true" className="absolute -start-1.5 top-8 h-3 w-3 rotate-45 border-b border-s border-white/10 bg-[#161d29] sm:-top-1.5 sm:start-10 sm:border-b-0 sm:border-t" />
              {activeItem ? (
                <>
                  <span className="block font-semibold text-white">{activeItem.label}</span>
                  <span className="mt-0.5 block text-white/75">{t(`homi_reach_${activeItem.key}_d`)}</span>
                  <Link
                    to={activeItem.to}
                    className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[hsl(38_92%_54%)] px-3.5 text-[13px] font-semibold text-[#161309] sm:hidden"
                  >
                    {t('homi_reach_open')}
                    <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  </Link>
                </>
              ) : (
                <span>{t('homi_reach_hint')}</span>
              )}
            </div>
          </div>

          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-1 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reach.map(item => {
              const on = active === item.key;
              return (
                <li key={item.key} className="min-w-0">
                  <Link
                    to={item.to}
                    ref={(el) => { tileRefs.current[item.key] = el; }}
                    data-reach={item.key}
                    aria-label={item.label}
                    onPointerDown={pressTile(item.key)}
                    onClick={tapTile(item.key)}
                    onMouseEnter={focusTile(item.key)} onMouseLeave={leaveTile}
                    onFocus={focusTile(item.key)} onBlur={leaveTile}
                    className={`group relative flex h-full min-h-[5.25rem] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border px-0.5 py-2 text-center transition-[transform,border-color,background-color,box-shadow] duration-300 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] sm:min-h-[5.5rem] sm:items-stretch sm:justify-between sm:gap-3 sm:rounded-2xl sm:p-4 sm:text-start ${
                      on
                        ? 'border-[hsl(38_92%_56%)]/70 bg-white/[0.08] shadow-[0_18px_40px_-24px_rgba(245,166,35,0.55)] motion-safe:-translate-y-0.5'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -start-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-[rgba(245,166,35,0.14)] to-transparent opacity-0 transition-[inset-inline-start,opacity] duration-700 group-hover:start-full group-hover:opacity-100 motion-reduce:hidden" />
                    <span className="flex items-start justify-center gap-3 sm:justify-between">
                      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors sm:h-10 sm:w-10 ${on ? 'border-[hsl(38_92%_56%)]/60 bg-[hsl(38_92%_56%)]/15 text-[hsl(38_92%_66%)]' : 'border-white/15 bg-white/[0.05] text-white/85'}`}>
                        <item.icon className="h-[17px] w-[17px] sm:h-[18px] sm:w-[18px]" strokeWidth={1.9} />
                      </span>
                      <ArrowUpRight aria-hidden="true" className={`hidden h-4 w-4 shrink-0 transition-[transform,color] duration-300 rtl:-scale-x-100 sm:block ${on ? 'text-[hsl(38_92%_66%)] motion-safe:-translate-y-0.5' : 'text-white/40'}`} />
                    </span>
                    {/* Phones: the short name. sm+: full name and what it does. */}
                    {(() => { const short = t(`homi_reach_${item.key}_s`); return (
                      <span aria-hidden="true" className={`block max-w-full font-semibold leading-tight text-white sm:hidden ${[...short].length >= 11 && !short.includes(" ") ? "text-[10.5px] tracking-[-0.015em]" : "text-[11.5px]"}`}>{short}</span>
                    ); })()}
                    <span className="hidden min-w-0 sm:block">
                      <span className="block text-[15px] font-semibold leading-snug text-white" {...fp(`reach_${item.key}`)}>{item.label}</span>
                      <span className="mt-1 block text-[13px] leading-snug text-white/60">{t(`homi_reach_${item.key}_d`)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
