import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import type { CampaignStats } from '@/services/emailStudio';
import { INK, INK_SOFT } from './styles';

/** Real numbers only. Opens are labelled approximate; replies say they are not tracked. */
export function CampaignResults({ stats, sent }: { stats: CampaignStats | null; sent: boolean }) {
  const { t, lang } = useLanguage();
  if (!stats || !sent) return <p className={cn('text-sm', INK_SOFT)}>{t('es_results_empty')}</p>;
  const nf = new Intl.NumberFormat(intlLocaleFor(lang));
  const tiles: Array<[string, number]> = [
    ['es_stat_sent', stats.sent],
    ['es_stat_delivered', stats.delivered],
    ['es_stat_bounced', stats.bounced],
    ['es_stat_complaints', stats.complaints],
    ['es_stat_unsubscribed', stats.unsubscribed],
    ['es_stat_clicked', stats.clicked],
    ['es_stat_opened', stats.opened],
  ];
  if (stats.skipped) tiles.push(['es_stat_skipped', stats.skipped]);
  if (stats.failed) tiles.push(['es_stat_failed', stats.failed]);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map(([key, value]) => (
          <div key={key} className="rounded-xl border border-[hsl(38_28%_88%)] bg-[hsl(40_30%_99%)] p-3.5">
            <dt className={cn('text-sm leading-snug', INK_SOFT)}>{t(key)}</dt>
            <dd className={cn('mt-1 font-display text-2xl font-bold tabular-nums', INK)}>{nf.format(value)}</dd>
          </div>
        ))}
      </dl>
      {!stats.repliedTracked ? <p className={cn('text-sm', INK_SOFT)}>{t('es_stat_replied_untracked')}</p> : null}
      {stats.opensApproximate ? <p className={cn('text-xs', INK_SOFT)}>{t('es_opens_note')}</p> : null}
    </div>
  );
}
