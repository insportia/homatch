import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { getOverview } from '@/services/developer/workspace';
import type { WorkspaceOverview } from '@/services/developer/types';
import { formatMoney, formatNumber } from './primitives';
import { Headline, MoneyBar, SalesBar } from './visuals';

/**
 * WHERE THE MONEY IS, ON EVERY SALES SCREEN.
 *
 * The nine screens under Sales — pipeline, viewings, offers, reservations,
 * contracts, payments, commissions, handover, ledger — each opened on a title,
 * a tab strip, a filter row, and then whatever rows existed. On a real sales
 * floor with one live reservation that is a line of text and six hundred
 * pixels of nothing; measured across the eight of them, 19-30% of the viewport
 * carried anything at all.
 *
 * None of them was missing information. They were missing CONTEXT: a person
 * looking at one offer wants to know what it is an offer against — how much of
 * the building is left, what is already contracted, what has actually been
 * collected, and what is overdue. That is the same four facts on all nine
 * screens, so it is one component rendered by all nine rather than nine
 * variations that can disagree.
 *
 * EVERY FIGURE IS A COUNT OR A SUM OF ROWS THAT EXIST. Collected is what
 * finance confirmed, never what was merely recorded — the distinction the rest
 * of the product is built on, kept here.
 */
export function SalesContext({ className }: { className?: string }) {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!workspace) return undefined;
    void getOverview(workspace.id)
      .then((o) => { if (!cancelled) setOverview(o); })
      .catch(() => { /* the page's own error state owns this */ });
    return () => { cancelled = true; };
  }, [workspace]);

  // Nothing sold and nothing to sell is a first-run workspace; the page's own
  // empty state is the right thing to see, not a band of zeroes above it.
  if (!overview || overview.units.total === 0) return null;

  const currency = workspace?.default_currency ?? 'USD';
  const money = can('finance') || can('sale');

  return (
    <Headline
      className={className}
      metrics={[
        {
          label: t('dev_stat_live_pipeline'),
          value: formatNumber(
            overview.units.negotiation + overview.units.reserved
            + overview.units.contract_pending, language),
          hint: t('dev_sales_context_pipeline_hint'),
        },
        ...(money ? [{
          label: t('dev_stat_contracted'),
          value: formatMoney(overview.sales.contracted_value, currency, language),
        }, {
          label: t('dev_stat_overdue'),
          value: formatMoney(overview.schedule.overdue_amount, currency, language),
          tone: overview.schedule.overdue_count > 0 ? ('attention' as const) : undefined,
          hint: t('dev_stat_overdue_hint').replace('{n}', String(overview.schedule.overdue_count)),
        }] : []),
      ]}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <SalesBar
          showLegend
          counts={{
            available: overview.units.available,
            negotiation: overview.units.negotiation,
            reserved: overview.units.reserved,
            contract_pending: overview.units.contract_pending,
            sold: overview.units.sold,
          }}
        />
        {money && (
          <MoneyBar
            collected={overview.money.collected}
            contracted={overview.sales.contracted_value}
            overdue={overview.schedule.overdue_amount}
            currency={currency}
          />
        )}
      </div>
    </Headline>
  );
}
