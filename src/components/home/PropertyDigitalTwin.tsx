import React, { useEffect, useRef, useState } from 'react';
import { useScroll, useTransform, useReducedMotion, type MotionValue } from 'motion/react';
import { KeyRound, FileText, Scale, History as HistoryIcon, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { BuildingIllustration } from './BuildingIllustration';
import { IntelligenceNode } from './IntelligenceNode';
import { EXPLODE_OFFSET, NODE_ANCHOR, NODE_SIDE, SCAN_RANGE, type LayerKey } from './buildingGeometry';

// Phase boundaries along scroll progress (0 → 1). Kept in one place so the
// scan / explode / reveal / synthesis timings stay in sync everywhere.
const P = { scanStart: 0.14, scanEnd: 0.32, explodeEnd: 0.58, revealEnd: 0.82 };

const NODES: { key: LayerKey; icon: typeof KeyRound; labelKey: string }[] = [
  { key: 'foundation', icon: KeyRound, labelKey: 'home_twin_label_ownership' },
  { key: 'floor1', icon: FileText, labelKey: 'home_twin_label_documents' },
  { key: 'floor2', icon: Scale, labelKey: 'home_twin_label_legal' },
  { key: 'floor3', icon: HistoryIcon, labelKey: 'home_twin_label_history' },
  { key: 'roof', icon: TrendingUp, labelKey: 'home_twin_label_market' },
];

function useLayerMotion(progress: MotionValue<number>, key: LayerKey) {
  const off = EXPLODE_OFFSET[key];
  const x = useTransform(progress, [0, P.scanEnd, P.explodeEnd, P.revealEnd, 1], [0, 0, off.tx, off.tx, 0]);
  const y = useTransform(progress, [0, P.scanEnd, P.explodeEnd, P.revealEnd, 1], [0, 0, off.ty, off.ty, 0]);
  const rotate = useTransform(progress, [0, P.scanEnd, P.explodeEnd, P.revealEnd, 1], [0, 0, off.rot, off.rot, 0]);
  return { x, y, rotate };
}

function DesktopTwin() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });

  const foundation = useLayerMotion(scrollYProgress, 'foundation');
  const floor1 = useLayerMotion(scrollYProgress, 'floor1');
  const floor2 = useLayerMotion(scrollYProgress, 'floor2');
  const floor3 = useLayerMotion(scrollYProgress, 'floor3');
  const roof = useLayerMotion(scrollYProgress, 'roof');

  const scanOpacity = useTransform(scrollYProgress,
    [0, P.scanStart, P.scanStart + 0.02, P.scanEnd - 0.02, P.scanEnd, 1],
    [0, 0, 1, 1, 0, 0]);
  const scanY = useTransform(scrollYProgress, [P.scanStart, P.scanEnd], [SCAN_RANGE.top, SCAN_RANGE.bottom]);
  const connectorsOpacity = useTransform(scrollYProgress,
    [P.explodeEnd, P.explodeEnd + 0.05, P.revealEnd - 0.05, P.revealEnd],
    [0, 1, 1, 0]);
  const glowOpacity = useTransform(scrollYProgress, [P.revealEnd, 1], [0, 0.9]);

  const { t } = useLanguage();

  return (
    <div ref={trackRef} className="relative hidden md:block" style={{ height: '300vh' }}>
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="max-w-6xl mx-auto w-full px-8 grid grid-cols-2 gap-12 items-center">
          <div className="space-y-4 pr-4">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest">{t('home_twin_eyebrow')}</p>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground leading-tight text-balance">
              {t('home_twin_title')}
            </h2>
            <p className="text-sm lg:text-base text-muted-foreground leading-relaxed max-w-md text-pretty">
              {t('home_twin_subtitle')}
            </p>
          </div>
          <div className="relative">
            <BuildingIllustration
              layerMotion={{ foundation, floor1, floor2, floor3, roof }}
              scanOpacity={scanOpacity}
              scanY={scanY}
              connectorsOpacity={connectorsOpacity}
              glowOpacity={glowOpacity}
            />
            {NODES.map(n => (
              <IntelligenceNode
                key={n.key}
                icon={n.icon}
                label={t(n.labelKey)}
                leftPct={NODE_ANCHOR[n.key].leftPct}
                topPct={NODE_ANCHOR[n.key].topPct}
                side={NODE_SIDE[n.key]}
                opacity={connectorsOpacity}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Discrete phases the mobile sequence steps through on a timer once it
 *  scrolls into view — no pinning, no scroll-jacking, normal document flow. */
type MobilePhase = 'idle' | 'scan' | 'explode' | 'reveal' | 'synthesis';
const MOBILE_SEQUENCE: MobilePhase[] = ['idle', 'scan', 'explode', 'reveal', 'synthesis'];
const MOBILE_STEP_MS = 1100;

function useMobilePhase(active: boolean) {
  const [phase, setPhase] = useState<MobilePhase>('idle');
  useEffect(() => {
    if (!active) return;
    let i = 0;
    setPhase(MOBILE_SEQUENCE[0]);
    const id = setInterval(() => {
      i += 1;
      if (i >= MOBILE_SEQUENCE.length) { clearInterval(id); return; }
      setPhase(MOBILE_SEQUENCE[i]);
    }, MOBILE_STEP_MS);
    return () => clearInterval(id);
  }, [active]);
  return phase;
}

// Explicit per-phase target state for mobile — no scroll math, just "what
// should the building look like right now", mirroring the same four
// checkpoints the desktop scroll timeline passes through (unexploded →
// exploded+scanning → exploded+labeled → reassembled).
const EXPLODE_AMOUNT: Record<MobilePhase, number> = { idle: 0, scan: 0, explode: 1, reveal: 1, synthesis: 0 };

function MobileTwin() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const phase = useMobilePhase(inView);
  const explodeAmt = EXPLODE_AMOUNT[phase];
  const layerFor = (key: LayerKey) => {
    const off = EXPLODE_OFFSET[key];
    return { x: off.tx * explodeAmt, y: off.ty * explodeAmt, rotate: off.rot * explodeAmt };
  };

  const scanOpacity = phase === 'scan' ? 1 : 0;
  const scanY = phase === 'idle' ? SCAN_RANGE.top : SCAN_RANGE.bottom;
  const connectorsOpacity = phase === 'reveal' || phase === 'explode' ? 1 : 0;
  const glowOpacity = phase === 'synthesis' ? 0.9 : 0;

  return (
    <div ref={wrapRef} className="md:hidden py-10 px-4">
      <div className="text-center space-y-3 mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest">{t('home_twin_eyebrow')}</p>
        <h2 className="text-2xl font-bold text-foreground leading-tight text-balance">{t('home_twin_title')}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">{t('home_twin_subtitle')}</p>
      </div>
      <div className="relative max-w-sm mx-auto overflow-hidden">
        <BuildingIllustration
          layerMotion={{
            foundation: layerFor('foundation'),
            floor1: layerFor('floor1'),
            floor2: layerFor('floor2'),
            floor3: layerFor('floor3'),
            roof: layerFor('roof'),
          }}
          scanOpacity={scanOpacity}
          scanY={scanY}
          connectorsOpacity={connectorsOpacity}
          glowOpacity={glowOpacity}
          ambient={phase === 'idle'}
          animated
        />
        {NODES.map(n => (
          <IntelligenceNode
            key={n.key}
            icon={n.icon}
            label={t(n.labelKey)}
            leftPct={NODE_ANCHOR[n.key].leftPct}
            topPct={NODE_ANCHOR[n.key].topPct}
            side={NODE_SIDE[n.key]}
            opacity={connectorsOpacity}
            animated
          />
        ))}
      </div>
    </div>
  );
}

function StaticTwin() {
  // prefers-reduced-motion: show the finished, reassembled illustration —
  // no scroll hijack, no timers, no transitions.
  const { t } = useLanguage();
  const zero = 0;
  const still = { x: zero, y: zero, rotate: zero };
  return (
    <div className="py-16 px-4 border-t border-border">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4 text-center md:text-left">
          <p className="text-xs font-semibold text-primary uppercase tracking-widest">{t('home_twin_eyebrow')}</p>
          <h2 className="text-2xl md:text-3xl font-bold text-foreground leading-tight text-balance">{t('home_twin_title')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto md:mx-0 text-pretty">{t('home_twin_subtitle')}</p>
        </div>
        <div className="max-w-sm mx-auto w-full">
          <BuildingIllustration
            layerMotion={{ foundation: still, floor1: still, floor2: still, floor3: still, roof: still }}
            scanOpacity={0}
            scanY={SCAN_RANGE.top}
            connectorsOpacity={0}
            glowOpacity={0.5}
            ambient={false}
          />
        </div>
      </div>
    </div>
  );
}

export function PropertyDigitalTwinSection() {
  const reduce = useReducedMotion();
  const { t } = useLanguage();
  if (reduce) return <StaticTwin />;
  return (
    <section className="relative border-t border-border bg-card/10" aria-label={t('home_twin_section_aria')}>
      <DesktopTwin />
      <MobileTwin />
    </section>
  );
}
