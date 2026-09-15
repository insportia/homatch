import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, StatTile, EmptyState, LoadingRows, ErrorState,
  Money, Eyebrow, GoldRule,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import { listLeads, type LeadWithContact } from '@/services/developer/crm';
import { getOverview } from '@/services/developer/workspace';
import { PIPELINE_STAGES } from '@/services/developer/types';
import type { LeadStage, WorkspaceOverview } from '@/services/developer/types';

/**
 * THE SALES FUNNEL, COUNTED (§75).
 *
 * Counts of rows, in stage order, with the money that is actually attached to
 * them. No conversion percentage is printed between two stages unless both
 * sides of it are counts of the same population — a "lead to viewing rate"
 * computed from all-time leads against this month's viewings is a number that
 * looks like insight and means nothing.
 *
 * The one ratio shown is stage share of the live pipeline, which is a
 * division of the same set and is honest.
 */
export default function DeveloperSalesOverviewPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { workspace, can } = useDeveloperWorkspace();

  const [leads, setLeads] = useState<LeadWithContact[]>([]);
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, o] = await Promise.all([
        listLeads(workspace.id, { limit: 1000 }),
        getOverview(workspace.id),
      ]);
      setLeads(rows);
      setOverview(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const funnel = useMemo(() => {
    const counts = new Map<LeadStage, number>();
    for (const stage of PIPELINE_STAGES) counts.set(stage, 0);
    for (const lead of leads) counts.set(lead.stage, (counts.get(lead.stage) ?? 0) + 1);
    const live = leads.filter((l) => !['LOST', 'SOLD'].includes(l.stage)).length;
    return { counts, live };
  }, [leads]);

  const lostReasons = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads) {
      if (lead.stage !== 'LOST' || !lead.lost_reason) continue;
      map.set(lead.lost_reason, (map.get(lead.lost_reason) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const maxCount = Math.max(...Array.from(funnel.counts.values()), 1);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_sales_overview_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && leads.length === 0 && (
        <Panel>
          <EmptyState
            icon={<TrendingUp className="h-7 w-7" />}
            title={t('dev_sales_overview_empty_title')}
            description={t('dev_sales_overview_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && leads.length > 0 && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t('dev_stat_live_pipeline')} value={funnel.live} />
            <StatTile label={t('dev_stat_reservations_active')} value={overview.reservations.active}
              onClick={() => navigate('/developers/sales/reservations')} />
            <StatTile label={t('dev_stat_sold_this_month')} value={overview.sales.this_month}
              hint={<Money amount={overview.sales.value_this_month} currency={workspace?.default_currency} />} />
            <StatTile label={t('dev_stat_contracted')}
              value={<Money amount={overview.sales.contracted_value} currency={workspace?.default_currency} />}
              onClick={() => navigate('/developers/sales/ledger')} />
          </div>

          <section>
            <div className="mb-3">
              <Eyebrow>{t('dev_funnel')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>
            <Panel className="p-4">
              <ul className="space-y-2">
                {PIPELINE_STAGES.map((stage) => {
                  const count = funnel.counts.get(stage) ?? 0;
                  const share = funnel.live > 0 && !['LOST', 'SOLD'].includes(stage)
                    ? Math.round((count / funnel.live) * 100) : null;
                  return (
                    <li key={stage} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-xs">
                        {t(`dev_stage_${stage.toLowerCase()}`)}
                      </span>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={
                            stage === 'LOST' ? 'h-full rounded-full bg-muted-foreground/40'
                              : stage === 'SOLD' ? 'h-full rounded-full bg-emerald-500/70'
                                : 'h-full rounded-full bg-gold/70'
                          }
                          style={{ width: `${(count / maxCount) * 100}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right tabular text-xs">
                        <span className="font-semibold">{count}</span>
                        {share !== null && <span className="text-muted-foreground"> · {share}%</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </section>

          {lostReasons.length > 0 && (
            <section>
              <div className="mb-3">
                <Eyebrow>{t('dev_why_lost')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <Panel>
                <PanelHeader title={t('dev_why_lost')} description={t('dev_why_lost_body')} />
                <ul className="divide-y divide-border">
                  {lostReasons.map(([reason, count]) => (
                    <li key={reason} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <span className="text-sm">{t(`dev_lost_${reason.toLowerCase()}`)}</span>
                      <span className="tabular text-sm font-semibold">{count}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </section>
          )}
        </div>
      )}
    </DeveloperShell>
  );
}
