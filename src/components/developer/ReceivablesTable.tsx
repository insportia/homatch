import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Panel, PanelHeader, TableScroll, Th, Td, Money, formatDate, EmptyState,
} from './primitives';
import type { SalesLedgerRow } from '@/services/developer/types';

/**
 * WHO OWES WHAT, ON WHICH APARTMENT, AND WHEN.
 *
 * Payments could show money that had arrived and instalments that were already
 * late. It could not answer the question a finance manager actually opens the
 * screen with — what is outstanding across the book, and what falls due next —
 * because that is a per-CONTRACT view and every table on the page was a view
 * of one instalment or one receipt.
 *
 * Every column here is read straight from the sales ledger, which is a VIEW
 * over the deals, the schedule and the confirmed payments. There is no second
 * copy of these figures and nothing here recomputes them: `paid` is confirmed
 * money, `outstanding` is the contract's own arithmetic, and the next
 * instalment is the next unpaid row of the signed schedule.
 *
 * Sorted by what is late, then by what is due soonest, because that is the
 * order the work gets done in.
 */
export function ReceivablesTable({
  rows, className,
}: { rows: SalesLedgerRow[]; className?: string }) {
  const { t, lang: language } = useLanguage();

  const owing = rows.filter((row) => Number(row.outstanding ?? 0) > 0);
  const now = Date.now();
  const isLate = (row: SalesLedgerRow) => Boolean(
    row.next_payment_due && new Date(row.next_payment_due).getTime() < now,
  );

  const ordered = [...owing].sort((a, b) => {
    const lateA = isLate(a) ? 0 : 1;
    const lateB = isLate(b) ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    const dueA = a.next_payment_due ? new Date(a.next_payment_due).getTime() : Infinity;
    const dueB = b.next_payment_due ? new Date(b.next_payment_due).getTime() : Infinity;
    return dueA - dueB;
  });

  if (ordered.length === 0) {
    return (
      <Panel className={className}>
        <EmptyState
          title={t('dev_receivables_clear_title')}
          description={t('dev_receivables_clear_body')}
        />
      </Panel>
    );
  }

  return (
    <Panel className={className}>
      <PanelHeader
        title={t('dev_receivables_by_contract')}
        description={t('dev_receivables_by_contract_sub')}
      />
      <TableScroll>
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr>
              <Th>{t('dev_unit')}</Th>
              <Th>{t('dev_buyer')}</Th>
              <Th className="text-right">{t('dev_stat_contracted')}</Th>
              <Th className="text-right">{t('dev_stat_collected')}</Th>
              <Th className="text-right">{t('dev_receivables_remaining')}</Th>
              <Th className="text-right">{t('dev_receivables_next')}</Th>
              <Th>{t('dev_due')}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ordered.map((row) => {
              const late = isLate(row);
              return (
                <tr key={row.deal_id} className={cn(late && 'bg-amber-500/[0.05]')}>
                  <Td className="tabular font-medium">{row.unit_number}</Td>
                  <Td className="truncate">{row.buyer ?? '—'}</Td>
                  <Td className="text-right tabular">
                    <Money amount={row.sale_price} currency={row.currency} />
                  </Td>
                  <Td className="text-right tabular text-emerald-700 dark:text-emerald-400">
                    <Money amount={row.paid} currency={row.currency} />
                  </Td>
                  <Td className="text-right tabular font-semibold">
                    <Money amount={row.outstanding} currency={row.currency} />
                  </Td>
                  <Td className="text-right tabular">
                    {row.next_payment_amount != null
                      ? <Money amount={row.next_payment_amount} currency={row.currency} />
                      : '—'}
                  </Td>
                  <Td className={late ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                    <span className="inline-flex items-center gap-1.5">
                      {late && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      {row.next_payment_due ? formatDate(row.next_payment_due, language) : '—'}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}
