import React, { useCallback, useEffect, useState } from 'react';
import { FileSignature, CheckCircle2, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, PaymentStatusPill, formatDate, Fact,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import { listLedger, listSchedule, markDealSold } from '@/services/developer/sales';
import { DevError } from '@/services/developer/client';
import type { SalesLedgerRow, DevScheduleRow } from '@/services/developer/types';

/**
 * DEALS — a contract that exists, and what is still owed on it.
 *
 * Reads the sales ledger rather than dev_deals directly, because the numbers
 * that matter on this screen (paid, outstanding, next instalment) are derived
 * from confirmed payments and the ledger is the one place that derivation
 * lives. Two screens computing "outstanding" two ways is how two screens come
 * to disagree.
 */
export default function DeveloperDealsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<SalesLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<DevScheduleRow[]>([]);
  const [closing, setClosing] = useState<SalesLedgerRow | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await listLedger(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const expand = async (row: SalesLedgerRow) => {
    if (expanded === row.deal_id) { setExpanded(null); return; }
    setExpanded(row.deal_id);
    try {
      setSchedule(await listSchedule(row.deal_id));
    } catch (error) {
      toast.error(t(error instanceof DevError ? error.key : 'dev_err_generic'));
      setSchedule([]);
    }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_deals_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={<FileSignature className="h-7 w-7" />}
            title={t('dev_deals_empty_title')}
            description={t('dev_deals_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <Panel key={row.deal_id}>
              <button
                type="button"
                onClick={() => expand(row)}
                aria-expanded={expanded === row.deal_id}
                className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              >
                <div className="min-w-[8rem]">
                  <p className="text-sm font-semibold">{row.unit_number}</p>
                  <p className="text-2xs text-muted-foreground">{row.project}</p>
                </div>
                <div className="min-w-[9rem]">
                  <p className="text-sm">{row.buyer ?? t('dev_unnamed_buyer')}</p>
                  <p className="text-2xs text-muted-foreground">
                    {row.contract_number ?? t('dev_no_contract_number')}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
                  <span className="text-sm font-semibold">
                    <Money amount={row.sale_price} currency={row.currency} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('dev_paid')} <Money amount={row.paid} currency={row.currency} />
                  </span>
                  <span className="text-xs">
                    {t('dev_outstanding')} <Money amount={row.outstanding} currency={row.currency} />
                  </span>
                  <PaymentStatusPill status={row.payment_status} />
                </div>
              </button>

              {expanded === row.deal_id && (
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <Fact label={t('dev_contract_date')} value={formatDate(row.contract_date, language)} />
                    <Fact label={t('dev_sale_date')} value={formatDate(row.sale_date, language)} />
                    <Fact label={t('dev_sales_manager')} value={row.sales_manager ?? '—'} />
                    <Fact label={t('dev_unit_price_sqm')}
                      value={<Money amount={row.sale_price_per_sqm} currency={row.currency} />} />
                  </dl>

                  {schedule.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('dev_no_schedule')}</p>
                  ) : (
                    <TableScroll className="rounded-md border border-border">
                      <table className="w-full text-sm" data-tabular>
                        <thead className="bg-muted/50">
                          <tr>
                            <Th>{t('dev_instalment')}</Th>
                            <Th>{t('dev_due')}</Th>
                            <Th className="text-right">{t('dev_amount')}</Th>
                            <Th className="text-right">{t('dev_paid')}</Th>
                            <Th>{t('dev_status')}</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {schedule.map((s) => (
                            <tr key={s.id}>
                              <Td>{s.label}</Td>
                              <Td className="text-muted-foreground">{formatDate(s.due_date, language)}</Td>
                              <Td className="text-right"><Money amount={s.amount} currency={s.currency} /></Td>
                              <Td className="text-right"><Money amount={s.paid_amount} currency={s.currency} /></Td>
                              <Td>
                                <PaymentStatusPill status={
                                  s.status === 'PAID' ? 'PAID'
                                    : s.status === 'OVERDUE' ? 'OVERDUE'
                                      : s.status === 'PARTIAL' ? 'PARTIAL' : 'PENDING'} />
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                  )}

                  {can('sale') && row.deal_status === 'CONTRACT_PENDING' && (
                    <div className="mt-4">
                      <Button size="sm" onClick={() => setClosing(row)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {t('dev_mark_sold')}
                      </Button>
                      <p className="mt-1.5 text-2xs text-muted-foreground">{t('dev_mark_sold_hint')}</p>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      {closing && (
        <MarkSoldDialog
          row={closing}
          onClose={() => setClosing(null)}
          onDone={() => { setClosing(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

/**
 * Marking a unit sold is irreversible through the interface (§115). It gets a
 * confirmation that states what will change, rather than a one-click button
 * sitting next to a row somebody is scrolling past.
 */
function MarkSoldDialog({
  row, onClose, onDone,
}: { row: SalesLedgerRow; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dev_mark_sold')} · {row.unit_number}</DialogTitle>
          <DialogDescription>{t('dev_mark_sold_confirm')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dev-sold-date">{t('dev_sale_date')}</Label>
            <Input id="dev-sold-date" type="date" value={date}
              onChange={(e) => setDate(e.target.value)} />
          </div>
          {row.outstanding > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              <Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('dev_mark_sold_outstanding_note')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await markDealSold(row.deal_id, date || null);
                toast.success(t('dev_marked_sold'));
                onDone();
              } catch (error) {
                toast.error(t(error instanceof DevError ? error.key : 'dev_err_generic'));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t('dev_saving') : t('dev_mark_sold')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
