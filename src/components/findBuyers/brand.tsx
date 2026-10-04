// The FIND BUYERS visual kit — HOMATCH navy + gold, no neutral grey.
//
// Navy frames (the brand's structural ink), gold for what matters (strength,
// progress, primary actions), white working surfaces, and each source in its
// own recognisable colour. Secondary text is a navy tint, never a grey.

import React from 'react';
import {
  Facebook, Globe2, Instagram, Linkedin, MessageCircle, MessagesSquare, Send, Twitter, Youtube,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* Navy tints for text on white (contrast ≥ 7:1 / ≥ 4.8:1). */
export const INK = 'text-[hsl(218_45%_14%)]';
export const INK_SOFT = 'text-[hsl(218_28%_38%)]';
/* Deep navy band (the identity frame). */
export const NAVY_BAND = 'bg-[linear-gradient(135deg,hsl(218_52%_11%)_0%,hsl(220_48%_17%)_55%,hsl(224_44%_22%)_100%)]';
export const GOLD_TEXT = 'text-[hsl(40_94%_64%)]';
export const GOLD_FILL = 'bg-[linear-gradient(135deg,hsl(42_96%_62%),hsl(34_90%_50%))]';

interface SourceStyle { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }
export const SOURCE_STYLE: Record<string, SourceStyle> = {
  FACEBOOK: { label: 'Facebook', color: '#1877F2', Icon: Facebook },
  INSTAGRAM: { label: 'Instagram', color: '#D62976', Icon: Instagram },
  TIKTOK: { label: 'TikTok', color: '#0F0F14', Icon: MessageCircle },
  VK: { label: 'VK', color: '#0077FF', Icon: MessagesSquare },
  TELEGRAM: { label: 'Telegram', color: '#229ED9', Icon: Send },
  LINKEDIN: { label: 'LinkedIn', color: '#0A66C2', Icon: Linkedin },
  REDDIT: { label: 'Reddit', color: '#FF4500', Icon: MessagesSquare },
  QUORA: { label: 'Quora', color: '#B92B27', Icon: MessageCircle },
  X: { label: 'X', color: '#0F1419', Icon: Twitter },
  THREADS: { label: 'Threads', color: '#101010', Icon: MessageCircle },
  BLUESKY: { label: 'Bluesky', color: '#1185FE', Icon: MessageCircle },
  YOUTUBE: { label: 'YouTube', color: '#FF0000', Icon: Youtube },
  FORUM: { label: 'Forum', color: '#7C3AED', Icon: MessagesSquare },
  WEB: { label: 'Web', color: '#0E7490', Icon: Globe2 },
};
export const sourceStyle = (s: string): SourceStyle => SOURCE_STYLE[s] ?? { label: s, color: '#1E3A8A', Icon: Globe2 };

/** The source, in its own colour: a filled mark and its name. */
export function SourceBadge({ source, onDark = false, className }: { source: string; onDark?: boolean; className?: string }) {
  const s = sourceStyle(source);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-0.5 text-2xs font-semibold',
      onDark ? 'bg-white/10 text-white ring-1 ring-inset ring-white/15' : `bg-white ${INK} ring-1 ring-inset ring-[hsl(218_40%_88%)]`, className)}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: s.color }}>
        <s.Icon className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="truncate">{s.label}</span>
    </span>
  );
}

/** An icon in a soft gold (or navy) chip. */
export function IconChip({ icon: Icon, tone = 'gold', className }: { icon: React.ComponentType<{ className?: string }>; tone?: 'gold' | 'navy' | 'onDark'; className?: string }) {
  const t = tone === 'gold'
    ? 'bg-[hsl(42_100%_94%)] text-[hsl(34_90%_34%)] ring-[hsl(40_80%_78%)]'
    : tone === 'navy' ? 'bg-[hsl(218_70%_96%)] text-[hsl(220_60%_30%)] ring-[hsl(218_50%_86%)]'
    : 'bg-white/10 text-[hsl(40_94%_64%)] ring-white/15';
  return (
    <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', t, className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

/** A circular gold meter with the value in the middle (0–100). */
export function RingMeter({ value, size = 52, onDark = false, label }: { value: number | null; size?: number; onDark?: boolean; label: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const id = React.useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value == null ? '—' : `${v}%`}`} className="shrink-0">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(44 98% 62%)" />
          <stop offset="100%" stopColor="hsl(32 92% 48%)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={onDark ? 'rgba(255,255,255,0.14)' : 'hsl(218 50% 93%)'} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        stroke={`url(#g${id})`} strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.27} fontWeight={700}
        fill={onDark ? '#fff' : 'hsl(218 45% 14%)'} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value == null ? '—' : v}
      </text>
    </svg>
  );
}

/** A framed action: gold hairline frame, navy text, icon first. 44px tall. */
export const FRAMED_ACTION = cn(
  'inline-flex min-h-11 items-center gap-2 rounded-xl border border-[hsl(40_80%_60%)] bg-white px-3.5 text-2xs font-semibold',
  INK,
  'shadow-[0_1px_0_hsl(40_80%_60%/0.25)] transition-all hover:-translate-y-px hover:border-[hsl(36_90%_50%)] hover:bg-[hsl(42_100%_97%)] hover:shadow-[0_6px_16px_-8px_hsl(36_90%_40%/0.45)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2',
);
/** The primary framed action: navy fill, gold text. */
export const PRIMARY_ACTION = cn(
  'inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-2xs font-semibold',
  NAVY_BAND, GOLD_TEXT,
  'ring-1 ring-inset ring-[hsl(40_80%_55%/0.55)] shadow-[0_8px_20px_-10px_hsl(218_60%_10%/0.7)] transition-all hover:-translate-y-px hover:ring-[hsl(40_94%_64%)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2',
);
