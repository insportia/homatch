import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Plus, Check, X, AlertTriangle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import { SalesContext } from '@/components/developer/SalesContext';
import { ReceivablesTable } from '@/components/developer/ReceivablesTable';
import {
  Panel, PanelHeader, StatTile, EmptyState, LoadingRows, ErrorState,
  TableScroll, Th, Td, Money, PaymentStatusPill, formatDate,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listPayments, confirmPayment, rejectPayment, recordPayment,
  listLedger, listSchedule, listReceivables,
} from '@/services/developer/sales';
import { devErrorText } from '@/services/developer/client';
import type { DevPayment, SalesLedgerRow, DevScheduleRow } from '@/services/developer/types';

/**
 * COLLECTIONS (§35, §36, §79).
 *
 * The distinction this whole screen turns on: RECORDED is somebody's claim
 * that money arrived. CONFIRMED is a person with the finance capability
 * saying they have seen it. Only CONFIRMED counts towards a single figure
 * anywhere in this product — the tiles here, the ledger, the home screen.
 *
 * Which is why a payment awaiting confirmation is at the top of the page in
 * its own section rather than mixed into the history, and why the collected
 * tile and the awaiting tile are two different numbers rather than one.
 *
 * It is NOT accounting software and does not claim to be (§163). It tracks
 * what a sales department needs to chase: contracted, received, outstanding,
 * overdue.
 */
export default function DeveloperPaymentsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [payments, setPayments] = useState<DevPayment[]>([]);
  const [deals, setDeals] = useState<SalesLedgerRow[]>([]);
  const [receivables, setReceivables] = useState<DevScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [rejecting, setRejecting] = useState<DevPayment | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [p, d, r] = await Promise.all([
        listPayments(workspace.id),
        listLedger(workspace.id),
        listReceivables(workspace.id, { status: ['OVERDUE', 'PENDING', 'PARTIAL'] }),
      ]);
      setPayments(p);
      setDeals(d);
      setReceivables(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const dealById = useMemo(() => new Map(deals.map((d) => [d.deal_id, d])), [deals]);
  const pending = useMemo(() => payments.filter((p) => p.status === 'RECORDED'), [payments]);
  const history = useMemo(() => payments.filter((p) => p.status !== 'RECORDED'), [payments]);

  const totals = useMemo(() => {
    const currency = workspace?.default_currency ?? 'USD';
    const confirmed = payments
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const awaiting = pending.reduce((sum, p) => sum + Number(p.amount), 0);
    const overdue = receivables
      .filter((s) => s.status === 'OVERDUE')
      .reduce((sum, s) => sum + (Number(s.amount) - Number(s.paid_amount)), 0);
    const contracted = deals.reduce((sum, d) => sum + Number(d.sale_price), 0);
    return { currency, confirmed, awaiting, overdue, contracted };
  }, [payments, pending, receivables, deals, workspace]);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_payments_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      actions={(can('finance') || can('sale')) && deals.length > 0 ? (
        <Button onClick={() => setRecording(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('dev_record_payment')}
        </Button>
      ) : undefined}
    >
      <SalesContext className="mb-6" />

      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && deals.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Banknote className="h-7 w-7" />}
            title={t('dev_payments_empty_title')}
            description={t('dev_payments_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && deals.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t('dev_stat_contracted')}
              value={<Money amount={totals.contracted} currency={totals.currency} />} />
            <StatTile label={t('dev_stat_collected')} tone="good"
              value={<Money amount={totals.confirmed} currency={totals.currency} />}
              hint={t('dev_stat_collected_hint')} />
            <StatTile label={t('dev_stat_awaiting')} tone={totals.awaiting > 0 ? 'attention' : 'default'}
              value={<Money amount={totals.awaiting} currency={totals.currency} />}
              hint={t('dev_stat_awaiting_hint').replace('{n}', String(pending.length))} />
            <StatTile label={t('dev_stat_overdue')} tone={totals.overdue > 0 ? 'attention' : 'default'}
              value={<Money amount={totals.overdue} currency={totals.currency} />} />
          </div>
          <p className="-mt-3 text-2xs text-muted-foreground">
            {t('dev_currency_note').replace('{currency}', totals.currency)}
          </p>

          {pending.length > 0 && (
            <Panel className="border-amber-600/40">
              <PanelHeader
                title={t('dev_payments_pending_title')}
                description={t('dev_payments_pending_body')}
              />
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_unit')}</Th>
                      <Th>{t('dev_buyer')}</Th>
                      <Th className="text-right">{t('dev_amount')}</Th>
                      <Th>{t('dev_paid_on')}</Th>
                      <Th>{t('dev_reference')}</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pending.map((p) => {
                      const deal = dealById.get(p.deal_id);
                      return (
                        <tr key={p.id}>
                          <Td className="font-medium">{deal?.unit_number ?? '—'}</Td>
                          <Td>{deal?.buyer ?? '—'}</Td>
                          <Td className="text-right font-medium">
                            <Money amount={p.amount} currency={p.currency} />
                          </Td>
                          <Td className="text-muted-foreground">{formatDate(p.paid_at, language)}</Td>
                          <Td className="text-muted-foreground">{p.reference ?? '—'}</Td>
                          <Td>
                            {can('finance') ? (
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await confirmPayment(p.id);
                                      toast.success(t('dev_payment_confirmed'));
                                      await load();
                                    } catch (error) {
                                      toast.error(devErrorText(error, t));
                                    }
                                  }}
                                >
                                  <Check className="mr-1.5 h-3.5 w-3.5" />
                                  {t('dev_confirm')}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setRejecting(p)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-2xs text-muted-foreground">
                                {t('dev_awaiting_finance')}
                              </span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )}

          {/* WHO OWES WHAT, per contract rather than per instalment. */}
          <ReceivablesTable rows={deals} />

          {receivables.filter((s) => s.status === 'OVERDUE').length > 0 && (
            <Panel>
              <PanelHeader title={t('dev_receivables_overdue_title')} />
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_unit')}</Th>
                      <Th>{t('dev_instalment')}</Th>
                      <Th>{t('dev_due')}</Th>
                      <Th className="text-right">{t('dev_outstanding')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {receivables.filter((s) => s.status === 'OVERDUE').map((s) => {
                      const deal = dealById.get(s.deal_id);
                      return (
                        <tr key={s.id}>
                          <Td className="font-medium">{deal?.unit_number ?? '—'}</Td>
                          <Td>{s.label}</Td>
                          <Td className="font-medium text-amber-700">{formatDate(s.due_date, language)}</Td>
                          <Td className="text-right">
                            <Money amount={Number(s.amount) - Number(s.paid_amount)} currency={s.currency} />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t('dev_payments_history')} />
            {history.length === 0 ? (
              <EmptyState title={t('dev_payments_history_empty')} />
            ) : (
              <TableScroll>
                <table className="w-full text-sm" data-tabular>
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <Th>{t('dev_unit')}</Th>
                      <Th>{t('dev_buyer')}</Th>
                      <Th className="text-right">{t('dev_amount')}</Th>
                      <Th>{t('dev_paid_on')}</Th>
                      <Th>{t('dev_method')}</Th>
                      <Th>{t('dev_status')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map((p) => {
                      const deal = dealById.get(p.deal_id);
                      return (
                        <tr key={p.id} className={cn(p.status === 'REJECTED' && 'opacity-60')}>
                          <Td className="font-medium">{deal?.unit_number ?? '—'}</Td>
                          <Td>{deal?.buyer ?? '—'}</Td>
                          <Td className="text-right"><Money amount={p.amount} currency={p.currency} /></Td>
                          <Td className="text-muted-foreground">{formatDate(p.paid_at, language)}</Td>
                          <Td className="text-muted-foreground">{p.method ?? '—'}</Td>
                          <Td>
                            <span className={cn(
                              'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium',
                              p.status === 'CONFIRMED'
                                ? 'border-emerald-600/40 bg-emerald-500/[0.07] text-emerald-700'
                                : 'border-border bg-muted/60 text-muted-foreground',
                            )}>
                              {t(`dev_payment_${p.status.toLowerCase()}`)}
                            </span>
                            {p.rejected_reason && (
                              <p className="mt-0.5 text-2xs text-muted-foreground">{p.rejected_reason}</p>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>
        </div>
      )}

      {recording && (
        <RecordPaymentDialog
          deals={deals}
          onClose={() => setRecording(false)}
          onDone={() => { setRecording(false); void load(); }}
        />
      )}

      {rejecting && (
        <RejectDialog
          payment={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function RecordPaymentDialog({
  deals, onClose, onDone,
}: { deals: SalesLedgerRow[]; onClose: () => void; onDone: () => void }) {
  const { t, lang: language } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [dealId, setDealId] = useState(deals[0]?.deal_id ?? '');
  const [schedule, setSchedule] = useState<DevScheduleRow[]>([]);
  const [scheduleId, setScheduleId] = useState('NONE');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dealId) { setSchedule([]); return; }
    listSchedule(dealId)
      .then((rows) => {
        setSchedule(rows);
        const next = rows.find((s) => s.status !== 'PAID');
        if (next) {
          setScheduleId(next.id);
          setAmount(String(Number(next.amount) - Number(next.paid_amount)));
        } else {
          setScheduleId('NONE');
        }
      })
      .catch(() => {
        // A deal with no plan simply has no instalments to attach to; the
        // payment is still recordable against the deal itself.
        setSchedule([]);
      });
  }, [dealId]);

  const deal = deals.find((d) => d.deal_id === dealId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace || !dealId || saving) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { toast.error(t('dev_err_invalid')); return; }
    setSaving(true);
    try {
      await recordPayment(workspace.id, {
        dealId,
        scheduleId: scheduleId === 'NONE' ? null : scheduleId,
        amount: value,
        currency: deal?.currency ?? workspace.default_currency,
        paidAt,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(t('dev_payment_recorded'));
      onDone();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_record_payment')}</DialogTitle>
          <DialogDescription>{t('dev_record_payment_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-pay-deal">{t('dev_deal')}</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger id="dev-pay-deal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {deals.map((d) => (
                  <SelectItem key={d.deal_id} value={d.deal_id}>
                    {d.unit_number} — {d.buyer ?? t('dev_unnamed_buyer')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {schedule.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="dev-pay-sched">{t('dev_instalment')}</Label>
              <Select
                value={scheduleId}
                onValueChange={(v) => {
                  setScheduleId(v);
                  const s = schedule.find((row) => row.id === v);
                  if (s) setAmount(String(Number(s.amount) - Number(s.paid_amount)));
                }}
              >
                <SelectTrigger id="dev-pay-sched"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{t('dev_no_instalment')}</SelectItem>
                  {schedule.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} · {formatDate(s.due_date, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-pay-amount">{t('dev_amount')}</Label>
              <Input id="dev-pay-amount" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-pay-date">{t('dev_paid_on')}</Label>
              <Input id="dev-pay-date" type="date" value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)} required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-pay-method">{t('dev_method')}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="dev-pay-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['BANK_TRANSFER', 'CARD', 'CASH', 'MORTGAGE', 'OTHER'].map((m) => (
                    <SelectItem key={m} value={m}>{t(`dev_method_${m.toLowerCase()}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-pay-ref">{t('dev_reference')}</Label>
              <Input id="dev-pay-ref" value={reference}
                onChange={(e) => setReference(e.target.value)} maxLength={120} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-pay-notes">{t('dev_unit_notes')}</Label>
            <Textarea id="dev-pay-notes" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>

          <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {t('dev_record_payment_note')}
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('dev_saving') : t('dev_record')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  payment, onClose, onDone,
}: { payment: DevPayment; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dev_reject_payment')}</DialogTitle>
          <DialogDescription>{t('dev_reject_payment_hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="dev-rej-reason">{t('dev_reason')}</Label>
          <Input id="dev-rej-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            maxLength={200} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button
            variant="destructive" disabled={!reason.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await rejectPayment(payment.id, reason.trim());
                toast.success(t('dev_payment_rejected'));
                onDone();
              } catch (error) {
                toast.error(devErrorText(error, t));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t('dev_saving') : t('dev_reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
