import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileSignature, CheckCircle2, Banknote, CalendarCheck, Settings2,
} from 'lucide-react';
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
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, PaymentStatusPill, Fact, formatDate, StatTile, formatNumber,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import { listLedger, listSchedule, markDealSold } from '@/services/developer/sales';
import {
  listContracts, setContractStatus, updateContractDetails, type ContractRow,
} from '@/services/developer/finance';
import { devErrorText } from '@/services/developer/client';
import { CONTRACT_STATUSES } from '@/services/developer/types';
import type {
  SalesLedgerRow, DevScheduleRow, ContractStatus, DealPaymentMethod,
} from '@/services/developer/types';

/**
 * CONTRACTS — the sale, the paperwork, and what is still owed on it.
 *
 * ONE SCREEN, DELIBERATELY. There were nearly two: a "deals" list showing
 * money outstanding, and a "contracts" list showing document status. They
 * would have been two views of the same row, and the first time they
 * disagreed about a cancelled sale nobody would have known which to believe.
 *
 * WHERE EACH NUMBER COMES FROM. Money is read from the sales ledger, never
 * recomputed here: `paid` is the sum of CONFIRMED payments and `outstanding`
 * follows from it, and that derivation lives in exactly one place. The
 * contract's own fields come from dev_deals and are merged in by deal_id.
 *
 * TWO CLOCKS. `deal_status` is where the SALE is. `contract_status` is where
 * the PAPERWORK is, and it moves separately — a contract sits in REVIEW with
 * a lawyer for a fortnight while the deal is unambiguously live. Collapsing
 * them is how a pipeline starts claiming revenue nobody has signed for.
 */
const STATUS_TONE: Record<ContractStatus, string> = {
  DRAFT: 'border-border text-muted-foreground bg-muted/60',
  REVIEW: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  SIGNED: 'border-gold-border text-gold-ink bg-gold/[0.08]',
  ACTIVE: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/[0.07]',
  COMPLETED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  CANCELLED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

const STATUS_KEY: Record<ContractStatus, string> = {
  DRAFT: 'dev_contract_status_draft',
  REVIEW: 'dev_contract_status_review',
  SIGNED: 'dev_contract_status_signed',
  ACTIVE: 'dev_contract_status_active',
  COMPLETED: 'dev_contract_status_completed',
  CANCELLED: 'dev_contract_status_cancelled',
};

const PAYMENT_METHODS: DealPaymentMethod[] = ['CASH', 'INSTALMENTS', 'MORTGAGE', 'MIXED', 'OTHER'];

const METHOD_KEY: Record<DealPaymentMethod, string> = {
  CASH: 'dev_contract_method_cash',
  INSTALMENTS: 'dev_contract_method_instalments',
  MORTGAGE: 'dev_contract_method_mortgage',
  MIXED: 'dev_contract_method_mixed',
  OTHER: 'dev_contract_method_other',
};

/** A ledger row with the contract's own fields merged in. */
interface Row extends SalesLedgerRow {
  contract_status: ContractStatus;
  contract_signed_at: string | null;
  payment_method: DealPaymentMethod | null;
  handover_target_date: string | null;
}

export default function DeveloperContractsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<DevScheduleRow[]>([]);
  const [closing, setClosing] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [filter, setFilter] = useState<ContractStatus | 'ALL'>('ALL');

  // Legal moves the paperwork; so does anybody who can close a sale. The
  // server checks the same pair again — this only decides what we offer.
  const mayMove = can('legal') || can('sale');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [ledger, contracts] = await Promise.all([
        listLedger(workspace.id),
        listContracts(workspace.id),
      ]);
      const byId = new Map<string, ContractRow>(contracts.map((c) => [c.id, c]));
      setRows(ledger.map((row) => {
        const deal = byId.get(row.deal_id);
        return {
          ...row,
          contract_status: deal?.contract_status ?? 'DRAFT',
          contract_signed_at: deal?.contract_signed_at ?? null,
          payment_method: deal?.payment_method ?? null,
          handover_target_date: deal?.handover_target_date ?? null,
        };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.contract_status] = (out[r.contract_status] ?? 0) + 1;
    return out;
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.contract_status === filter)),
    [rows, filter],
  );

  const expand = async (row: Row) => {
    if (expanded === row.deal_id) { setExpanded(null); return; }
    setExpanded(row.deal_id);
    try {
      setSchedule(await listSchedule(row.deal_id));
    } catch (e) {
      toast.error(devErrorText(e, t));
      setSchedule([]);
    }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_contracts_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      actions={rows.length > 0 ? (
        <Select value={filter} onValueChange={(v) => setFilter(v as ContractStatus | 'ALL')}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('dev_contracts_filter_all')}</SelectItem>
            {CONTRACT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(STATUS_KEY[s])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : undefined}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CONTRACT_STATUSES.map((s) => (
            <StatTile
              key={s}
              label={t(STATUS_KEY[s])}
              value={formatNumber(counts[s] ?? 0, language)}
              tone={s === 'REVIEW' && (counts[s] ?? 0) > 0 ? 'attention' : 'default'}
              onClick={() => setFilter(filter === s ? 'ALL' : s)}
            />
          ))}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <Panel>
          <EmptyState
            icon={<FileSignature className="h-7 w-7" />}
            title={t(rows.length === 0 ? 'dev_contracts_empty_title' : 'dev_contracts_none_in_filter')}
            description={t(
              rows.length === 0 ? 'dev_contracts_empty_body' : 'dev_contracts_none_in_filter_body',
            )}
          />
        </Panel>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((row) => (
            <Panel key={row.deal_id}>
              <button
                type="button"
                onClick={() => void expand(row)}
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
                <span className={cn(
                  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                  STATUS_TONE[row.contract_status],
                )}>
                  {t(STATUS_KEY[row.contract_status])}
                </span>
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
                    <Fact
                      label={t('dev_unit_price_sqm')}
                      value={<Money amount={row.sale_price_per_sqm} currency={row.currency} />}
                    />
                    <Fact
                      label={t('dev_contract_method')}
                      value={row.payment_method ? t(METHOD_KEY[row.payment_method]) : '—'}
                    />
                    <Fact
                      label={t('dev_contract_signed_on')}
                      value={formatDate(row.contract_signed_at, language)}
                    />
                    <Fact
                      label={t('dev_contract_handover_target')}
                      value={formatDate(row.handover_target_date, language)}
                    />
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
                              <Td><PaymentStatusPill status={s.status} /></Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                      <Settings2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      {t('dev_contract_manage')}
                    </Button>
                    {can('sale') && row.deal_status === 'CONTRACT_PENDING' && (
                      <Button size="sm" onClick={() => setClosing(row)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('dev_mark_sold')}
                      </Button>
                    )}
                  </div>
                  {can('sale') && row.deal_status === 'CONTRACT_PENDING' && (
                    <p className="mt-1.5 text-2xs text-muted-foreground">{t('dev_mark_sold_hint')}</p>
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

      {editing && (
        <ContractDialog
          row={editing}
          canMove={mayMove}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
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
}: { row: Row; onClose: () => void; onDone: () => void }) {
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
            <Input
              id="dev-sold-date" type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
                toast.error(devErrorText(error, t));
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

function ContractDialog({
  row, canMove, onClose, onSaved,
}: {
  row: Row;
  canMove: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [number, setNumber] = useState(row.contract_number ?? '');
  const [date, setDate] = useState(row.contract_date ?? '');
  const [method, setMethod] = useState<DealPaymentMethod | ''>(row.payment_method ?? '');
  const [handoverDate, setHandoverDate] = useState(row.handover_target_date ?? '');
  const [status, setStatus] = useState<ContractStatus>(row.contract_status);
  const [signedOn, setSignedOn] = useState(row.contract_signed_at ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const statusChanged = status !== row.contract_status;

  async function save() {
    setSaving(true);
    try {
      // Details first, so that if the transition is refused on a permission
      // the typing is not lost along with it.
      const patch = {
        contract_number: number.trim() || null,
        contract_date: date || null,
        payment_method: (method || null) as DealPaymentMethod | null,
        handover_target_date: handoverDate || null,
      };
      const changed = patch.contract_number !== row.contract_number
        || patch.contract_date !== row.contract_date
        || patch.payment_method !== row.payment_method
        || patch.handover_target_date !== row.handover_target_date;
      if (changed) await updateContractDetails(row.deal_id, patch);

      if (statusChanged) {
        await setContractStatus(row.deal_id, status, signedOn || null, note.trim() || null);
      }
      toast.success(t('dev_contract_saved'));
      await onSaved();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('dev_contract_dialog_title').replace('{unit}', row.unit_number)}
          </DialogTitle>
          <DialogDescription>
            {[row.buyer, row.project].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contract-number">{t('dev_contract_number')}</Label>
              <Input
                id="contract-number" value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder={t('dev_contract_number_placeholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract-date">{t('dev_contract_date')}</Label>
              <Input
                id="contract-date" type="date" value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contract-method">{t('dev_contract_method')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as DealPaymentMethod)}>
                <SelectTrigger id="contract-method">
                  <SelectValue placeholder={t('dev_contract_method_unset')} />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{t(METHOD_KEY[m])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handover-target">{t('dev_contract_handover_target')}</Label>
              <Input
                id="handover-target" type="date" value={handoverDate}
                onChange={(e) => setHandoverDate(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="contract-status">{t('dev_contract_paperwork')}</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as ContractStatus)}
                disabled={!canMove}
              >
                <SelectTrigger id="contract-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(STATUS_KEY[s])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!canMove && (
                <p className="text-2xs text-muted-foreground">{t('dev_contract_no_permission')}</p>
              )}
            </div>

            {statusChanged && status === 'SIGNED' && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="signed-on">{t('dev_contract_signed_on')}</Label>
                <Input
                  id="signed-on" type="date" value={signedOn}
                  onChange={(e) => setSignedOn(e.target.value)}
                />
                <p className="text-2xs text-muted-foreground">{t('dev_contract_signed_on_hint')}</p>
              </div>
            )}

            {statusChanged && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="status-note">{t('dev_contract_note')}</Label>
                <Textarea
                  id="status-note" rows={2} value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('dev_contract_note_placeholder')}
                />
              </div>
            )}
          </div>

          {row.contract_signed_at && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dev_contract_signed_fact').replace(
                '{date}', formatDate(row.contract_signed_at, language),
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
