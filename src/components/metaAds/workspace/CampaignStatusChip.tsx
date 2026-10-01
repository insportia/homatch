// A campaign's status in human words — the CANONICAL status
// (src/lib/metaAds/uiStatus.ts), so a paused campaign reads "Paused" on every
// surface: the dashboard, the campaigns tab and the drill-down header.
// Shared by the workspace and re-exported from pages/outreach/MetaAdsPage.
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { uiStatus, type StatusInput, type UiStatus } from '@/lib/metaAds/uiStatus';

/* Semantic and restrained, from the design tokens: success for running,
   warning for paused and needing attention, destructive for failure, gold
   only where HOMATCH or Meta is actively working on it. */
export const STATUS_TONE: Record<UiStatus, string> = {
  ACTIVE: 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
  IN_REVIEW: 'border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  HOMATCH_REVIEW: 'border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  PAUSED: 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]',
  NEEDS_ATTENTION: 'border-[hsl(var(--warning))]/45 bg-[hsl(var(--warning))]/12 text-[hsl(var(--warning))]',
  LOCKED: 'border-[hsl(var(--warning))]/45 bg-[hsl(var(--warning))]/12 text-[hsl(var(--warning))]',
  ACCESS_LOST: 'border-destructive/35 bg-destructive/10 text-destructive',
  FAILED: 'border-destructive/35 bg-destructive/10 text-destructive',
  READY: 'border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]',
  DRAFT: 'border-border bg-card text-muted-foreground',
  ENDED: 'border-border bg-card text-foreground/70',
};
/** A small leading dot carries the state for colour-blind readers too (with the word). */
const DOT: Partial<Record<UiStatus, string>> = {
  ACTIVE: 'bg-[hsl(var(--success))]', PAUSED: 'bg-[hsl(var(--warning))]', IN_REVIEW: 'bg-[hsl(var(--gold))]', HOMATCH_REVIEW: 'bg-[hsl(var(--gold))]',
  NEEDS_ATTENTION: 'bg-[hsl(var(--warning))]', LOCKED: 'bg-[hsl(var(--warning))]', ACCESS_LOST: 'bg-destructive', FAILED: 'bg-destructive',
};

export function CampaignStatusChip({ status, campaign, className }: { status?: string; campaign?: StatusInput; className?: string }) {
  const { t } = useLanguage();
  const u = uiStatus(campaign ?? { status: status ?? '' });
  return (
    <span data-mm-status={u}
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-2xs font-semibold leading-5', STATUS_TONE[u], className)}>
      {DOT[u] && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[u])} aria-hidden="true" />}
      {t(`mm_st_${u}`)}
    </span>
  );
}
