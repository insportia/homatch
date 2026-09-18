// HOMATCH INVESTMENT INTELLIGENCE — where the money actually goes.
//
// WHY THIS IS NOT A FLOWCHART
//
// A flowchart draws every arrow the same width, which means it tells you
// the STRUCTURE of an investment and nothing about its proportions. The
// structure is the same for every property; the proportions are the deal.
// So the ribbons here are scaled to the money travelling along them — a
// mortgage that eats most of the rent is a thick band into "interest" and
// a thin one into the investor's pocket, and that is visible before a
// single figure is read.
//
// FIVE COLUMNS, LEFT TO RIGHT, BECAUSE THAT IS THE ORDER IT HAPPENS
//
//   cash in → the property → what it produces → the exit → what is left
//
// A node with no figure yet is drawn dim and empty rather than omitted, so
// the diagram keeps its shape while the consultation fills it in. The
// picture becoming real as the conversation progresses is the intended
// experience, not a side effect.
//
// RTL: the column order is flipped by the container's own direction, and
// the SVG is mirrored with it, so an Arabic or Hebrew reader follows the
// flow in the direction they read.

import React, { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { CapitalFlowModel, InvestmentModel } from '@/investment/types';
import { Module, formatMoney, intlLocaleFor } from './primitives';

/** Which column each node lives in. The order money moves through them. */
const COLUMNS: string[][] = [
  ['investorCash', 'loan'],
  ['equity', 'acquisition', 'renovation', 'furnishing'],
  ['property'],
  ['rent', 'operating', 'interest', 'principal', 'netCashFlow'],
  ['exit', 'sellingCosts', 'debtPayoff', 'equityReturned', 'finalResult'],
];

const COLUMN_TITLE_KEYS = [
  'inv_flow_col_sources',
  'inv_flow_col_deployment',
  'inv_flow_col_asset',
  'inv_flow_col_operation',
  'inv_flow_col_exit',
];

export function CapitalFlowModule({
  model,
  focused,
}: {
  model: InvestmentModel;
  focused: boolean;
}) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const currency = model.currency;
  const flow: CapitalFlowModel | null = model.capitalFlow;

  const byId = useMemo(() => {
    const map = new Map<string, CapitalFlowModel['nodes'][number]>();
    for (const node of flow?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [flow]);

  const peak = useMemo(() => {
    const amounts = (flow?.nodes ?? [])
      .map((n) => n.amount)
      .filter((a): a is number => a !== null && Number.isFinite(a) && a > 0);
    return amounts.length ? Math.max(...amounts) : 1;
  }, [flow]);

  if (!flow) return null;

  return (
    <Module
      id="capital-flow"
      eyebrowKey="inv_mod_flow_eyebrow"
      titleKey="inv_mod_flow_title"
      subtitleKey="inv_mod_flow_sub"
      focused={focused}
    >
      <div className="-mx-2 overflow-x-auto px-2 pb-2">
        <div className="flex min-w-[46rem] gap-3">
          {COLUMNS.map((columnIds, columnIndex) => {
            const nodes = columnIds
              .map((id) => byId.get(id))
              .filter((n): n is CapitalFlowModel['nodes'][number] => Boolean(n));
            if (!nodes.length) return null;
            return (
              <div key={COLUMN_TITLE_KEYS[columnIndex]} className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t(COLUMN_TITLE_KEYS[columnIndex])}
                </p>
                {nodes.map((node) => {
                  const known = node.amount !== null && Number.isFinite(node.amount);
                  const share = known ? Math.min(1, Math.abs(node.amount as number) / peak) : 0;
                  return (
                    <div
                      key={node.id}
                      className={cn(
                        'relative overflow-hidden rounded-lg border px-3 py-2.5 transition-opacity',
                        known ? 'border-border bg-[hsl(var(--secondary))]' : 'border-dashed border-border opacity-55',
                      )}
                    >
                      {/* The proportional band. It IS the money: its width
                          is this node's share of the largest figure in the
                          diagram, so the picture is to scale. */}
                      {known ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute inset-y-0 start-0 transition-[width] duration-700',
                            toneFor(node.kind, node.signed),
                          )}
                          style={{ width: `${Math.max(3, share * 100)}%` }}
                        />
                      ) : null}
                      <span className="relative block text-2xs leading-tight text-muted-foreground">
                        {t(node.labelKey)}
                      </span>
                      <span className="relative mt-0.5 block text-sm font-medium tabular-nums text-foreground">
                        {known
                          ? `${node.signed ? '−' : ''}${formatMoney(Math.abs(node.amount as number), currency, locale, { compact: true })}`
                          : t('inv_flow_pending')}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs text-muted-foreground">
        <LegendSwatch className="bg-[hsl(var(--gold)/0.28)]" labelKey="inv_flow_legend_cash" />
        <LegendSwatch className="bg-[hsl(var(--destructive)/0.22)]" labelKey="inv_flow_legend_cost" />
        <LegendSwatch className="bg-[hsl(var(--info)/0.22)]" labelKey="inv_flow_legend_debt" />
        <LegendSwatch className="bg-[hsl(var(--success)/0.22)]" labelKey="inv_flow_legend_income" />
      </div>
      <p className="mt-3 text-2xs text-muted-foreground">{t('inv_flow_note')}</p>
    </Module>
  );
}

function toneFor(kind: CapitalFlowModel['nodes'][number]['kind'], signed: boolean): string {
  if (signed && kind === 'COST') return 'bg-[hsl(var(--destructive)/0.22)]';
  switch (kind) {
    case 'SOURCE':
      return 'bg-[hsl(var(--gold)/0.28)]';
    case 'DEBT':
      return 'bg-[hsl(var(--info)/0.22)]';
    case 'INCOME':
      return 'bg-[hsl(var(--success)/0.22)]';
    case 'ASSET':
      return 'bg-[hsl(var(--gold)/0.18)]';
    case 'EXIT':
      return 'bg-[hsl(var(--chart-4)/0.22)]';
    case 'RESULT':
      return 'bg-[hsl(var(--gold)/0.32)]';
    default:
      return 'bg-[hsl(var(--muted))]';
  }
}

function LegendSwatch({ className, labelKey }: { className: string; labelKey: string }) {
  const { t } = useLanguage();
  return (
    <span className="flex items-center gap-2">
      <span className={cn('inline-block h-3 w-5 rounded-sm', className)} aria-hidden="true" />
      {t(labelKey)}
    </span>
  );
}
