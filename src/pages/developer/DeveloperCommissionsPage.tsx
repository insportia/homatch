import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Percent, Plus, Check, Banknote, X } from 'lucide-react';
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
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, formatDate, StatTile, formatMoney, PermissionState,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listCommissions, createCommission, setCommissionStatus, commissionAmount,
  listContracts, type CommissionRow, type ContractRow,
} from '@/services/developer/finance';
import { listTeam } from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import type { DevCommission, DevMember } from '@/services/developer/types';

/**
 * COMMISSIONS — WHAT THE COMPANY OWES, NOT WHAT IT COLLECTED.
 *
 * Deliberately a separate object from the deal's money. A commission is an
 * expense owed to somebody, and putting it in the same table that sums to
 * "collected" is how a sales report quietly starts double-counting a sale.
 *
 * The totals here are three sums of rows that exist — pending, approved, paid
 * — and they are never netted against revenue anywhere in this product.
 *
 * APPROVING AND PAYING ARE FINANCE'S ACTS. The server checks that again
 * (dev_set_commission_status raises 42501 for anybody else), so the read-only
 * view a sales director gets here is not the enforcement, only the honesty.
 */
const STATUS_TONE: Record<DevCommission['status'], string> = {
  PENDING: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  APPROVED: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/[0.07]',
  PAID: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  CANCELLED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

const STATUS_KEY: Record<DevCommission['status'], string> = {
  PENDING: 'dev_commission_status_pending',
  APPROVED: 'dev_commission_status_approved',
  PAID: 'dev_commission_status_paid',
  CANCELLED: 'dev_commission_status_cancelled',
};

export default function DeveloperCommissionsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [team, setTeam] = useState<DevMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DevCommission['status'] | 'ALL'>('ALL');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Finance approves and pays. A sales director sees the register because
  // they have to manage it; they cannot move a row.
  const mayApprove = can('finance');
  const mayCreate = can('finance') || can('crm_all');
  const mayView = mayCreate || can('view');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [commissions, deals, members] = await Promise.all([
        listCommissions(workspace.id),
        listContracts(workspace.id),
        listTeam(workspace.id),
      ]);
      setRows(commissions);
      setContracts(deals);
      setTeam(members);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Totals are per currency, never summed across them. A workspace selling in
   * USD and GEL has two numbers, and adding them without a rate somebody can
   * point at would be inventing a figure.
   */
  const totals = useMemo(() => {
    const out = new Map<string, { pending: number; approved: number; paid: number }>();
    for (const r of rows) {
      const bucket = out.get(r.currency) ?? { pending: 0, approved: 0, paid: 0 };
      if (r.status === 'PENDING') bucket.pending += Number(r.amount);
      if (r.status === 'APPROVED') bucket.approved += Number(r.amount);
      if (r.status === 'PAID') bucket.paid += Number(r.amount);
      out.set(r.currency, bucket);
    }
    return Array.from(out.entries());
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  async function move(row: CommissionRow, status: DevCommission['status']) {
    setBusy(row.id);
    try {
      await setCommissionStatus(row.id, status);
      toast.success(t('dev_commission_updated'));
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  if (!mayView) {
    return (
      <DeveloperShell title={t('dev_nav_sales')} tabs={<SubNav items={salesTabs(can)} />}>
        <Panel><PermissionState /></Panel>
      </DeveloperShell>
    );
  }

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_commissions_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as DevCommission['status'] | 'ALL')}
          >
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('dev_commissions_filter_all')}</SelectItem>
              {(Object.keys(STATUS_KEY) as DevCommission['status'][]).map((s) => (
                <SelectItem key={s} value={s}>{t(STATUS_KEY[s])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mayCreate && contracts.length > 0 && (
            <Button type="button" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('dev_commission_add')}
            </Button>
          )}
        </div>
      }
    >
      <SalesContext className="mb-6" />

      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && totals.length > 0 && (
        <div className="mb-4 space-y-3">
          {totals.map(([currency, bucket]) => (
            <div key={currency} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label={t('dev_commission_status_pending')}
                value={formatMoney(bucket.pending, currency, language)}
                tone={bucket.pending > 0 ? 'attention' : 'default'}
              />
              <StatTile
                label={t('dev_commission_status_approved')}
                value={formatMoney(bucket.approved, currency, language)}
              />
              <StatTile
                label={t('dev_commission_status_paid')}
                value={formatMoney(bucket.paid, currency, language)}
                tone="good"
              />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Percent className="h-7 w-7" />}
            title={t(rows.length === 0 ? 'dev_commissions_empty_title' : 'dev_commissions_none_in_filter')}
            description={t(rows.length === 0 ? 'dev_commissions_empty_body' : 'dev_contracts_none_in_filter_body')}
            action={mayCreate && contracts.length > 0 ? (
              <Button type="button" size="sm" onClick={() => setAdding(true)}>
                {t('dev_commission_add')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && visible.length > 0 && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_commission_beneficiary')}</Th>
                  <Th>{t('dev_unit')}</Th>
                  <Th>{t('dev_contract_number')}</Th>
                  <Th className="text-right">{t('dev_commission_basis')}</Th>
                  <Th className="text-right">{t('dev_commission_amount')}</Th>
                  <Th>{t('dev_status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <Td>
                      <span className="font-medium">
                        {row.beneficiary_label || t('dev_commission_unnamed')}
                      </span>
                      <span className="ml-1.5 text-2xs uppercase tracking-wider text-muted-foreground">
                        {t(`dev_commission_kind_${row.beneficiary_kind.toLowerCase()}`)}
                      </span>
                    </Td>
                    <Td>{row.unit_number ?? '—'}</Td>
                    <Td className="text-muted-foreground">{row.contract_number ?? '—'}</Td>
                    <Td className="text-right text-muted-foreground">
                      {row.basis === 'PERCENT' && row.rate != null
                        ? `${row.rate}%`
                        : t('dev_commission_basis_fixed')}
                    </Td>
                    <Td className="text-right font-medium">
                      <Money amount={row.amount} currency={row.currency} />
                    </Td>
                    <Td>
                      <span className={cn(
                        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                        STATUS_TONE[row.status],
                      )}>
                        {t(STATUS_KEY[row.status])}
                      </span>
                      {row.paid_at && (
                        <span className="ml-2 text-2xs text-muted-foreground">
                          {formatDate(row.paid_at, language)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {mayApprove && row.status === 'PENDING' && (
                          <>
                            <Button
                              type="button" variant="outline" size="sm"
                              disabled={busy === row.id}
                              onClick={() => void move(row, 'APPROVED')}
                            >
                              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              {t('dev_commission_approve')}
                            </Button>
                            <Button
                              type="button" variant="ghost" size="sm"
                              disabled={busy === row.id}
                              onClick={() => void move(row, 'CANCELLED')}
                              aria-label={t('dev_commission_cancel')}
                              title={t('dev_commission_cancel')}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                        {mayApprove && row.status === 'APPROVED' && (
                          <Button
                            type="button" variant="outline" size="sm"
                            disabled={busy === row.id}
                            onClick={() => void move(row, 'PAID')}
                          >
                            <Banknote className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            {t('dev_commission_mark_paid')}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {adding && workspace && (
        <AddCommissionDialog
          workspaceId={workspace.id}
          contracts={contracts}
          team={team}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function AddCommissionDialog({
  workspaceId, contracts, team, onClose, onSaved,
}: {
  workspaceId: string;
  contracts: ContractRow[];
  team: DevMember[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [dealId, setDealId] = useState(contracts[0]?.id ?? '');
  const [kind, setKind] = useState<DevCommission['beneficiary_kind']>('AGENT');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [rate, setRate] = useState('3');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const deal = contracts.find((c) => c.id === dealId) ?? null;

  // Shown before saving, computed from the sale price this commission is
  // actually against — so nobody approves a percentage they have not seen
  // turned into money.
  const amount = useMemo(() => {
    const r = Number(rate);
    if (!deal || !Number.isFinite(r) || r <= 0) return 0;
    return commissionAmount(basis, r, Number(deal.sale_price));
  }, [deal, basis, rate]);

  const valid = dealId !== '' && amount > 0
    && (kind !== 'AGENT' || userId !== '' || name.trim() !== '');

  async function save() {
    if (!deal || !valid) return;
    setSaving(true);
    try {
      await createCommission(workspaceId, {
        dealId: deal.id,
        beneficiaryKind: kind,
        userId: kind === 'AGENT' && userId ? userId : null,
        beneficiaryName: name.trim() || null,
        basis,
        rate: Number(rate),
        amount,
        currency: deal.currency,
        note: note.trim() || null,
      });
      toast.success(t('dev_commission_created'));
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
          <DialogTitle>{t('dev_commission_add')}</DialogTitle>
          <DialogDescription>{t('dev_commission_add_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="comm-deal">{t('dev_commission_on_sale')}</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger id="comm-deal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {[c.unit_number, c.buyer_name, c.contract_number].filter(Boolean).join(' · ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {deal && (
              <p className="text-2xs text-muted-foreground">
                {t('dev_commission_sale_price_is').replace(
                  '{amount}', formatMoney(deal.sale_price, deal.currency, language),
                )}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="comm-kind">{t('dev_commission_beneficiary')}</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as DevCommission['beneficiary_kind'])}
              >
                <SelectTrigger id="comm-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AGENT">{t('dev_commission_kind_agent')}</SelectItem>
                  <SelectItem value="BROKER">{t('dev_commission_kind_broker')}</SelectItem>
                  <SelectItem value="OTHER">{t('dev_commission_kind_other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind === 'AGENT' ? (
              <div className="space-y-1.5">
                <Label htmlFor="comm-user">{t('dev_commission_team_member')}</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="comm-user">
                    <SelectValue placeholder={t('dev_commission_pick_member')} />
                  </SelectTrigger>
                  <SelectContent>
                    {team.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name || m.email || m.user_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="comm-name">{t('dev_commission_name')}</Label>
                <Input
                  id="comm-name" value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('dev_commission_name_placeholder')}
                />
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="comm-basis">{t('dev_commission_basis')}</Label>
              <Select value={basis} onValueChange={(v) => setBasis(v as 'PERCENT' | 'FIXED')}>
                <SelectTrigger id="comm-basis"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">{t('dev_commission_basis_percent')}</SelectItem>
                  <SelectItem value="FIXED">{t('dev_commission_basis_fixed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comm-rate">
                {t(basis === 'PERCENT' ? 'dev_commission_rate_pct' : 'dev_commission_rate_fixed')}
              </Label>
              <Input
                id="comm-rate" type="number" min="0" step="0.01" inputMode="decimal"
                value={rate} onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>

          {deal && (
            <div className="rounded-md border border-gold-border/60 bg-gold/[0.05] px-3 py-2.5">
              <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                {t('dev_commission_amount')}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular">
                {formatMoney(amount, deal.currency, language)}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="comm-note">{t('dev_commission_note')}</Label>
            <Textarea
              id="comm-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !valid}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
