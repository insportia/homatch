// Shared pieces for the campaign drill-down: formatting in the viewer's
// locale, the calm error mapping for write-through calls, and the small
// presentational atoms every section uses. Nothing here fetches.
import React from 'react';
import { cn } from '@/lib/utils';
import { moneyIn, type HealthStateRow } from '@/services/metaAds';

export type Evidence = 'INSUFFICIENT_DATA' | 'EARLY_SIGNAL' | 'MEANINGFUL_SIGNAL' | 'HIGH_CONFIDENCE';
const RANK: Record<string, number> = { INSUFFICIENT_DATA: 0, EARLY_SIGNAL: 1, MEANINGFUL_SIGNAL: 2, HIGH_CONFIDENCE: 3 };
/** Same ladder as src/lib/metaAds/analysis.ts atLeast(). Unknown = no evidence. */
export const atLeast = (e: string | null | undefined, min: Evidence) => (RANK[String(e)] ?? 0) >= RANK[min];

export type T = (key: string, vars?: Record<string, string | number>) => string;

export interface Fmt {
  lang: string;
  currency: string;
  money: (minor: number | null | undefined) => string;
  num: (n: number | null | undefined, digits?: number) => string;
  pct: (ratio: number | null | undefined, digits?: number) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  rel: (iso: string | null | undefined) => string | null;
}

export function makeFmt(lang: string, currency: string): Fmt {
  const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(lang, o);
  return {
    lang,
    currency,
    money: (minor) => moneyIn(minor, currency, lang),
    num: (n, digits = 0) => (n == null || !Number.isFinite(n) ? '—' : nf({ maximumFractionDigits: digits }).format(n)),
    pct: (r, digits = 1) => (r == null || !Number.isFinite(r) ? '—' : nf({ style: 'percent', maximumFractionDigits: digits }).format(r)),
    date: (iso) => (iso ? new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '—'),
    dateTime: (iso) => (iso ? new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'),
    rel: (iso) => {
      if (!iso) return null;
      const diff = (Date.parse(iso) - Date.now()) / 1000;
      if (!Number.isFinite(diff)) return null;
      const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
      return rtf.format(Math.round(diff / 86_400), 'day');
    },
  };
}

/** Error codes the lifecycle / recommendation endpoints return, each with calm copy. */
export const KNOWN_ERRORS = [
  'META_CONNECTION_NEEDS_ATTENTION', 'CAMPAIGN_UNDER_REVIEW', 'META_ADS_ACCESS_SUSPENDED', 'INSUFFICIENT_FUNDS',
  'BUDGET_OUT_OF_RANGE', 'DURATION_OUT_OF_RANGE', 'META_DID_NOT_CONFIRM', 'BAD_TRANSITION', 'NOT_APPLICABLE', 'NOT_OPEN',
] as const;

export function errorCode(e: unknown): string {
  const x = e as { code?: unknown; body?: { code?: unknown; error?: unknown }; message?: unknown } | null;
  return String(x?.code ?? x?.body?.code ?? x?.body?.error ?? x?.message ?? '');
}

/** One localized, non-accusatory sentence for a failed write. Never a raw code. */
export function errorText(t: T, e: unknown, fmt: Fmt): string {
  const code = errorCode(e);
  const body = ((e as { body?: Record<string, unknown> } | null)?.body ?? {}) as Record<string, unknown>;
  if (!(KNOWN_ERRORS as readonly string[]).includes(code)) return t('mm_c_err_GENERIC');
  if (code === 'BUDGET_OUT_OF_RANGE') {
    return t('mm_c_err_BUDGET_OUT_OF_RANGE', {
      min: body.min != null ? fmt.money(Number(body.min)) : '—',
      max: body.max != null ? fmt.money(Number(body.max)) : '—',
    });
  }
  if (code === 'DURATION_OUT_OF_RANGE') {
    return t('mm_c_err_DURATION_OUT_OF_RANGE', { min: body.min != null ? String(body.min) : '—' });
  }
  return t(`mm_c_err_${code}`);
}

/* ── ATOMS ─────────────────────────────────────────────────────────────── */

export function Card({ title, id, children, className, actions }: {
  title?: string; id?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined}
      className={cn('min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 id={headingId} className="font-display text-base font-semibold text-foreground">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground', className)}>{children}</p>;
}

const TONE = {
  good: 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]',
  watch: 'border-[hsl(32_78%_36%)]/30 bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_30%)]',
  act: 'border-destructive/30 bg-destructive/10 text-destructive',
  gold: 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  quiet: 'border-border bg-[hsl(var(--secondary))] text-muted-foreground',
} as const;
export type Tone = keyof typeof TONE;

export function Chip({ tone = 'quiet', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold', TONE[tone], className)}>
      {children}
    </span>
  );
}

export const healthTone = (s: HealthStateRow | string): Tone =>
  s === 'HEALTHY' ? 'good' : s === 'WATCH' ? 'watch' : s === 'ACTION_RECOMMENDED' ? 'act' : 'quiet';

export const evidenceTone = (e: string): Tone =>
  e === 'HIGH_CONFIDENCE' ? 'good' : e === 'MEANINGFUL_SIGNAL' ? 'gold' : 'quiet';

export function EvidenceChip({ t, evidence }: { t: T; evidence: string }) {
  const key = RANK[evidence] != null ? evidence : 'INSUFFICIENT_DATA';
  return <Chip tone={evidenceTone(key)}>{t(`mm_ev_${key}`)}</Chip>;
}

/** A labelled number. Numbers stay LTR inside RTL text so digits and signs read correctly. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold tabular-nums text-foreground" dir="ltr">{value}</p>
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Meta ad ids → readable ad names (entities first, creatives second). */
export function adNamer(t: T, entities: Array<{ kind: string; external_id: string; name: string | null; local_creative_id: string | null }>,
  creatives: Array<{ id: string; headline: string | null }>) {
  const ads = entities.filter((e) => e.kind === 'AD');
  return (key: string) => {
    const i = ads.findIndex((a) => a.external_id === key);
    const ent = i >= 0 ? ads[i] : null;
    const cr = ent?.local_creative_id ? creatives.find((c) => c.id === ent.local_creative_id) : null;
    return ent?.name || cr?.headline || t('mm_c_ad_fallback', { n: i >= 0 ? i + 1 : 1 });
  };
}

/** Meta placement label (placementLabel() output) → localized name. */
const PLACEMENTS = ['FACEBOOK_FEED', 'INSTAGRAM_FEED', 'FACEBOOK_STORIES', 'INSTAGRAM_STORIES', 'INSTAGRAM_REELS', 'FACEBOOK_REELS',
  'MARKETPLACE', 'MESSENGER', 'INSTAGRAM_EXPLORE', 'AUDIENCE_NETWORK', 'FACEBOOK_VIDEO_FEEDS', 'FACEBOOK_RIGHT_COLUMN', 'FACEBOOK_SEARCH', 'OTHER'];
export const placementName = (t: T, key: string) => t(`mm_c_pl_${PLACEMENTS.includes(key) ? key : 'OTHER'}`);

/** "25-34|female" → "25-34 · Women". */
export function ageGenderName(t: T, key: string) {
  const [age, g] = key.split('|');
  const gender = g === 'female' ? t('mm_c_gender_female') : g === 'male' ? t('mm_c_gender_male') : t('mm_c_gender_unknown');
  return t('mm_c_age_gender', { age: age || '—', gender });
}

export function countryName(lang: string, code: string) {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch { return code; }
}
