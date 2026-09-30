// ADMIN — META NOTIFICATION + AI ECONOMICS. What the monitor cost and what it
// sent. Unpriced AI calls are counted and called out: an unknown cost is
// never shown as zero.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { adminMetaEconomics } from '@/services/metaAds';
import { Breakdown, errorText, Panel, Stat } from './kit';

type Econ = Awaited<ReturnType<typeof adminMetaEconomics>>;
const PERIODS = [7, 30, 90] as const;

const usd = (n: number) => `$${(Number(n) || 0).toFixed(4)}`;

export function EconomicsPanel() {
  const { t } = useLanguage();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Econ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await adminMetaEconomics(days)); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('mm_a_econ_period')} className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card p-1">
          {PERIODS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`min-h-8 rounded-full px-3 text-2xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${days === d ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
              {t('mm_a_econ_days', { n: d })}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          {t('mm_a_refresh')}
        </Button>
        {data && <span className="text-2xs text-muted-foreground">{t('mm_a_econ_since', { at: new Date(data.since).toLocaleString() })}</span>}
      </div>

      {error && (
        <Panel>
          <p role="alert" className="text-sm text-destructive">{t('mm_a_load_failed')}</p>
          <p dir="ltr" className="mt-1 break-words text-2xs text-muted-foreground">{error}</p>
        </Panel>
      )}
      {loading && !data ? <Skeleton className="h-60 rounded-2xl" /> : data && (
        <>
          <Panel title={t('mm_a_ai_title')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t('mm_a_ai_calls')} value={data.ai.calls.toLocaleString()} />
              <Stat label={t('mm_a_ai_tokens_in')} value={data.ai.inputTokens.toLocaleString()} />
              <Stat label={t('mm_a_ai_tokens_out')} value={data.ai.outputTokens.toLocaleString()} />
              <Stat label={t('mm_a_ai_raw_cost')} value={usd(data.ai.rawCostUsd)} />
              <Stat label={t('mm_a_ai_landed_cost')} value={usd(data.ai.landedCostUsd)} />
              <Stat label={t('mm_a_ai_unpriced')} value={data.ai.unpriced} tone={data.ai.unpriced > 0 ? 'warn' : undefined} />
            </div>
            {data.ai.unpriced > 0 && (
              <p role="status" className="mt-2 text-2xs text-[hsl(var(--gold-ink))]">{t('mm_a_ai_unpriced_warn', { n: data.ai.unpriced })}</p>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Breakdown title={t('mm_a_by_purpose')} data={data.ai.byPurpose} />
              <Breakdown title={t('mm_a_by_trigger')} data={data.ai.byTrigger} />
              <Breakdown title={t('mm_a_by_model')} data={data.ai.byModel} />
            </div>
          </Panel>

          <Panel title={t('mm_a_notif_title')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t('mm_a_notif_total')} value={data.notifications.total.toLocaleString()} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Breakdown title={t('mm_a_by_transition')} data={data.notifications.byTransition} />
              <Breakdown title={t('mm_a_by_severity')} data={data.notifications.bySeverity} />
              <Breakdown title={t('mm_a_by_channel')} data={data.notifications.byChannel} />
            </div>
          </Panel>

          <Panel title={t('mm_a_deliveries_title')}>
            <div className="grid gap-4 md:grid-cols-2">
              <Breakdown title={t('mm_a_by_channel_status')} data={data.deliveries.byChannelStatus} />
              <Breakdown title={t('mm_a_skipped_reasons')} data={data.deliveries.skippedReasons} />
            </div>
          </Panel>

          <Panel title={t('mm_a_events_title')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t('mm_a_events_open')} value={data.events.open.toLocaleString()} />
            </div>
            <div className="mt-4">
              <Breakdown title={t('mm_a_by_type')} data={data.events.byType} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
