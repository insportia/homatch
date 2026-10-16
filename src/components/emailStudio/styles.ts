// HOMATCH EMAIL STUDIO — the premium light system, as class recipes.
// Warm white canvas, white surfaces, deep navy ink, refined gold. 44–48px targets,
// visible focus, logical (RTL-safe) spacing, motion only when the user allows it.

export const INK = 'text-[hsl(218_45%_14%)]';
export const INK_SOFT = 'text-[hsl(218_22%_36%)]';
export const CANVAS = 'bg-[hsl(40_33%_97%)]';
export const CARD = 'rounded-2xl border border-[hsl(38_28%_88%)] bg-white shadow-[0_1px_2px_hsl(218_40%_20%/0.05),0_8px_24px_-16px_hsl(218_40%_20%/0.18)]';
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2';
export const GOLD_BUTTON = `inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-6 text-[15px] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:cursor-not-allowed disabled:bg-[hsl(38_30%_88%)] disabled:text-[hsl(218_15%_45%)] motion-safe:transition-colors ${FOCUS}`;
export const NAVY_BUTTON = `inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(218_52%_14%)] px-5 text-[15px] font-semibold text-[hsl(40_94%_70%)] hover:bg-[hsl(218_48%_20%)] disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors ${FOCUS}`;
export const QUIET_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(40_70%_62%)] bg-white px-4 text-sm font-semibold ${INK} hover:bg-[hsl(42_100%_97%)] disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors ${FOCUS}`;
export const ICON_BUTTON = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[hsl(38_28%_86%)] bg-white ${INK} hover:bg-[hsl(42_100%_97%)] disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS}`;
export const FIELD = `w-full rounded-xl border border-[hsl(38_22%_82%)] bg-white px-3.5 py-3 text-[15px] ${INK} placeholder:text-[hsl(218_12%_58%)] ${FOCUS}`;
export const LABEL = `mb-1.5 block text-sm font-semibold ${INK}`;
export const GOLD_EYEBROW = 'text-[13px] font-semibold uppercase tracking-[0.18em] text-[hsl(36_80%_42%)]';
