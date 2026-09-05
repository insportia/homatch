import React from 'react';
import { motion, type MotionValue } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

interface IntelligenceNodeProps {
  icon: LucideIcon;
  label: string;
  leftPct: number;
  topPct: number;
  side: 'left' | 'right';
  opacity: MotionValue<number> | number;
  /** true (mobile): tween opacity via `animate` so chips fade in/out between
   *  timed phases instead of popping. false (desktop): bind the MotionValue
   *  directly via `style`, tracking scroll 1:1. */
  animated?: boolean;
}

/** One small "intelligence signal" chip anchored beside an exploded building
 *  layer — icon + micro-label, nothing heavier. Positioned in HTML (not SVG)
 *  so text stays crisp and RTL-safe; its opacity is driven by the same
 *  progress value as the SVG connector line it lines up with. */
export function IntelligenceNode({ icon: Icon, label, leftPct, topPct, side, opacity, animated }: IntelligenceNodeProps) {
  const opacityProps = animated
    ? { animate: { opacity }, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } }
    : { style: { opacity } };
  return (
    <motion.div
      {...(opacityProps as any)}
      style={{
        position: 'absolute',
        left: `${leftPct}%`,
        top: `${topPct}%`,
        ...(animated ? {} : { opacity: opacity as any }),
        transform: `translateY(-50%) translateX(${side === 'right' ? '6px' : 'calc(-100% - 6px)'})`,
      }}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/30 bg-card/90 px-2.5 py-1 shadow-card backdrop-blur-sm pointer-events-none"
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <Icon className="h-3 w-3 text-primary shrink-0" />
      <span className="text-[10px] font-semibold tracking-wide text-foreground">{label}</span>
    </motion.div>
  );
}
