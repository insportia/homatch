// HOMATCH Leads — the button and surface contract, written once.
//
// Every action in the Leads workspace, Research budget and unlock flow uses one of
// these: 48px primary / 44px secondary minimum, one radius, one padding, one focus
// ring, a real disabled state. Primary is the approved HOMATCH gold (the Verify CTA);
// secondary is a white surface with a hairline; tertiary is text.

import { cn } from '@/lib/utils';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 focus-visible:ring-offset-white';
const MOTION = 'transition-[background-color,border-color,box-shadow,transform] duration-150 motion-reduce:transition-none';

export const BTN_PRIMARY = cn(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-bold leading-tight text-[#161309]',
  'bg-[hsl(38_92%_54%)] shadow-card hover:bg-[hsl(38_92%_60%)] hover:shadow-hover active:translate-y-px',
  'disabled:cursor-not-allowed disabled:bg-[hsl(38_30%_88%)] disabled:text-[#161309]/45 disabled:shadow-none',
  'text-center whitespace-normal', FOCUS, MOTION,
);

export const BTN_SECONDARY = cn(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-4 text-sm font-semibold leading-tight text-[hsl(224_14%_12%)]',
  'hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(42_100%_98%)] active:translate-y-px',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'text-center whitespace-normal', FOCUS, MOTION,
);

export const BTN_TERTIARY = cn(
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[hsl(var(--gold-ink))]',
  'underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50', FOCUS,
);

export const BTN_DESTRUCTIVE = cn(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(0_45%_80%)] bg-white px-4 text-sm font-semibold text-[hsl(0_55%_38%)]',
  'hover:bg-[hsl(0_60%_97%)] disabled:cursor-not-allowed disabled:opacity-50', FOCUS, MOTION,
);

/** The working surface: white, hairline, restrained shadow. */
export const SURFACE = 'rounded-2xl border border-[hsl(var(--border))] bg-white shadow-card';
export const SURFACE_HOVER = 'motion-safe:transition-shadow motion-safe:duration-200 hover:shadow-hover';

/** Small caps eyebrow in gold ink — the only gold allowed for text. */
export const EYEBROW = 'text-2xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--gold-ink))]';

/** Filter chip (44px touch target). */
export function chipClass(active: boolean) {
  return cn(
    'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold', FOCUS, MOTION,
    active
      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
      : 'border-[hsl(var(--border))] bg-white text-[hsl(224_14%_22%)] hover:border-[hsl(var(--gold-border))]',
  );
}
