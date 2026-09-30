// A campaign's status in human words. Shared by the workspace, the dashboard
// and the campaign drill-down (re-exported from pages/outreach/MetaAdsPage).
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)] border-[hsl(152_40%_40%)]/30',
  META_REVIEW: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  SUBMITTED: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  PAUSED: 'bg-[hsl(var(--secondary))] text-muted-foreground border-border',
  DRAFT: 'bg-card text-muted-foreground border-border',
  READY: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  NEEDS_CHANGES: 'bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_32%)] border-[hsl(32_78%_36%)]/30',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/30',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/30',
  COMPLETED: 'bg-[hsl(var(--secondary))] text-foreground border-border',
};

export function CampaignStatusChip({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[13px] font-semibold',
      STATUS_TONE[status] ?? 'bg-card text-muted-foreground border-border')}>
      {t(`mads_status_${status.toLowerCase()}`)}
    </span>
  );
}
