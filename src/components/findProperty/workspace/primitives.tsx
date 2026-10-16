/*
 * Find Property workspace — the shared visual language.
 *
 * Ivory canvas (the `.hm-discovery` light tokens), white working surfaces, graphite
 * for structure and primary actions, gold only where the eye should land. Every
 * primitive here is presentation; numbers and states come from the server.
 */
import type { ReactNode } from 'react';
import type { SearchHistoryItem, SearchSummary } from '@/services/marketplaceSearch';
import { countText, rangeText, type T } from '../format';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const btn = {
  primary: `inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0C1119] px-5 text-sm font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_6px_16px_-8px_rgba(12,17,25,0.55)] transition hover:bg-[#1A2331] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  gold: `inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[hsl(var(--gold))] px-5 text-sm font-semibold text-[#0C1119] shadow-[0_6px_16px_-8px_hsl(var(--gold)/0.9)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  quiet: `inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold)/0.05)] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  ghost: `inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground ${focus}`,
  icon: `inline-grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground/80 transition hover:border-[hsl(var(--gold-border))] hover:text-foreground disabled:opacity-50 ${focus}`,
};

/** A white working surface with a hairline and a soft lift. */
export function Surface({ as: Tag = 'section', className, children, ...rest }: {
  as?: 'section' | 'article' | 'div' | 'aside' | 'li'; className?: string; children: ReactNode;
} & Record<string, unknown>) {
  return <Tag className={cx('rounded-2xl border border-[hsl(var(--border))] bg-card shadow-[0_1px_2px_rgba(12,17,25,0.04),0_12px_32px_-20px_rgba(12,17,25,0.28)]', className)} {...rest}>{children}</Tag>;
}

export type Tone = 'neutral' | 'live' | 'success' | 'warning' | 'danger' | 'gold';
const TONE: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  live: 'border-[hsl(214_62%_34%/0.22)] bg-[hsl(214_62%_34%/0.07)] text-[hsl(214_62%_30%)]',
  success: 'border-[hsl(152_46%_28%/0.22)] bg-[hsl(152_46%_28%/0.08)] text-[hsl(152_46%_24%)]',
  warning: 'border-[hsl(32_78%_36%/0.25)] bg-[hsl(32_78%_36%/0.08)] text-[hsl(32_78%_30%)]',
  danger: 'border-[hsl(0_66%_44%/0.22)] bg-[hsl(0_66%_44%/0.07)] text-[hsl(0_66%_38%)]',
  gold: 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.12)] text-[hsl(var(--gold-ink))]',
};
export function Pill({ tone = 'neutral', children, pulse, className }: { tone?: Tone; children: ReactNode; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-none', TONE[tone], className)}>
      {pulse ? <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true"><span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" /></span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]', className)}>{children}</p>;
}

const lang = () => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;

/** "Today, 14:05" / "Yesterday" / "3 days ago" / "11 Oct" — the browser's own locale data, in the interface language. */
export function naturalDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const locale = lang();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(at)) / 86_400_000);
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (days === 0) return `${capital(rtf.format(0, 'day'))}, ${time}`;
    if (days === 1) return capital(rtf.format(-1, 'day'));
    if (days > 1 && days < 7) return capital(rtf.format(-days, 'day'));
  } catch { /* fall through to the date */ }
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(at.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}
const capital = (s: string) => s.charAt(0).toLocaleUpperCase(lang()) + s.slice(1);

/** A day heading for grouped timelines. */
export function dayKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

type Brief = SearchHistoryItem['brief'];
/** "2-bedroom apartment to buy" — what, never the whole criteria list. */
export function searchTitle(b: Brief, t: T): string {
  const type = b.propertyType ? t(`mps_pt_${b.propertyType.value}`) : null;
  const deal = b.transactionType ? t(`mps_tx_${b.transactionType.value}`) : null;
  return [type, deal].filter(Boolean).join(' · ') || t('plan_page_title');
}
export function searchPlace(b: Brief, t: T): string {
  const districts = b.districts?.value ?? [];
  const city = b.city?.value ?? null;
  if (!districts.length) return city ?? t('fpw_card_any_place');
  const shown = districts.slice(0, 2).join(', ') + (districts.length > 2 ? ` +${districts.length - 2}` : '');
  return city ? `${shown} · ${city}` : shown;
}
export function searchBudget(b: Brief, t: T): string | null {
  return b.price?.value ? rangeText(b.price.value, t, 'price') : null;
}
/** At most three facts beyond what, where and budget: the ones a person scans for. */
export function keyFacts(b: Brief, t: T): string[] {
  const out: string[] = [];
  if (b.area?.value) out.push(rangeText(b.area.value, t, 'area'));
  if (b.bedrooms?.value) out.push(countText(b.bedrooms.value, t, 'bedrooms'));
  else if (b.rooms?.value) out.push(countText(b.rooms.value, t, 'rooms'));
  const renovation = b.renovationPreferences?.value?.filter((v) => v !== 'ANY') ?? [];
  if (renovation.length) out.push(renovation.map((v) => t(`mps_rn_${v}`)).join(' / '));
  return out.slice(0, 3);
}

/** One customer-facing state per source, from the worker run's real status. */
export type SourceState = 'WAITING' | 'SEARCHING' | 'FOUND' | 'NONE' | 'UNAVAILABLE' | 'FAILED' | 'TIMED_OUT';
type Source = NonNullable<SearchSummary['sources']>[number];
export function sourceState(s: Source, terminal: boolean): SourceState {
  const found = s.freshListings + s.cachedListings;
  const run = s.run ?? (s.state === 'REFRESHING' ? 'SEARCHING' : s.state === 'UNAVAILABLE' ? 'FAILED' : 'COMPLETE');
  if (run === 'QUEUED') return terminal ? 'TIMED_OUT' : 'WAITING';
  if (['SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'].includes(run)) return terminal ? 'TIMED_OUT' : 'SEARCHING';
  if (run === 'TIMED_OUT') return found > 0 ? 'FOUND' : 'TIMED_OUT';
  if (run === 'BLOCKED') return found > 0 ? 'FOUND' : 'UNAVAILABLE';
  if (run === 'FAILED') return found > 0 ? 'FOUND' : 'FAILED';
  return found > 0 ? 'FOUND' : 'NONE';
}
export const SOURCE_TONE: Record<SourceState, Tone> = {
  WAITING: 'neutral', SEARCHING: 'live', FOUND: 'success', NONE: 'neutral', UNAVAILABLE: 'warning', FAILED: 'danger', TIMED_OUT: 'warning',
};

export const HISTORY_TONE: Record<string, Tone> = {
  CREATED: 'live', READY: 'live', DISPATCHING: 'live', SEARCHING: 'live', PROCESSING: 'live', RESULTS_AVAILABLE: 'live',
  COMPLETE: 'success', PARTIAL_COMPLETE: 'success', FAILED: 'danger', CANCELLED: 'neutral',
};
export const RUNNING_STATUSES = ['CREATED', 'READY', 'DISPATCHING', 'SEARCHING', 'PROCESSING', 'RESULTS_AVAILABLE'];
