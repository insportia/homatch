import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, AlertTriangle, FileSignature } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Money, formatDateTime, formatDate,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listReservations, cancelReservation, convertReservation, listPaymentPlansForProject,
} from '@/services/developer/sales';
import { listUnits } from '@/services/developer/inventory';
import { listLeads, type LeadWithContact } from '@/services/developer/crm';
import { DevError } from '@/services/developer/client';
import type { DevReservation, DevUnit, DevPaymentPlan } from '@/services/developer/types';

/**
 * RESERVATIONS, AND THE ONE DECISION EACH OF THEM IS WAITING FOR.
 *
 * A hold that has run out is not quietly released (§135). It appears at the
 * top of this list, flagged, until a person decides — because the buyer
 * believes they are still holding that apartment, and re-listing it without
 * telling anybody is how two people are sold the same flat.
 */
export default function DeveloperReservationsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<DevReservation[]>([]);
  const [units, setUnits] = useState<Map<string, DevUnit>>(new Map());
  const [leads, setLeads] = useState<Map<string, LeadWithContact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<DevReservation | null>(null);
  const [releasing, setReleasing] = useState<DevReservation | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [reservations, unitPage, leadRows] = await Promise.all([
        listReservations(workspace.id, { status: ['ACTIVE', 'EXPIRED'] }),
        listUnits(workspace.id, { limit: 3000 }),
        listLeads(workspace.id, { limit: 400 }),
      ]);
      setRows(reservations);
      setUnits(new Map(unitPage.rows.map((u) => [u.id, u])));
      setLeads(new Map(leadRows.map((l) => [l.id, l])));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    const now = Date.now();
    const rank = (r: DevReservation) => {
      if (r.expires_at && new Date(r.expires_at).getTime() < now) return 0; // past due first
      if (r.expires_at) return 1;
      return 2;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b)
      || new Date(a.expires_at ?? a.reserved_at).getTime() - new Date(b.expires_at ?? b.reserved_at).getTime());
  }, [rows]);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_reservations_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && sorted.length === 0 && (
        <Panel>
          <EmptyState
            icon={<KeyRound className="h-7 w-7" />}
            title={t('dev_reservations_empty_title')}
            description={t('dev_reservations_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && sorted.length > 0 && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_unit')}</Th>
                  <Th>{t('dev_buyer')}</Th>
                  <Th className="text-right">{t('dev_reserve_amount')}</Th>
                  <Th>{t('dev_reserved_on')}</Th>
                  <Th>{t('dev_reserve_expires')}</Th>
                  <Th>{t('dev_status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((r) => {
                  const unit = units.get(r.unit_id);
                  const lead = leads.get(r.lead_id);
                  const expired = r.expires_at && new Date(r.expires_at) < new Date();
                  const soon = !expired && r.expires_at
                    && new Date(r.expires_at).getTime() - Date.now() < 7 * 86400000;
                  return (
                    <tr key={r.id} className={cn(expired && 'bg-amber-500/[0.05]')}>
                      <Td className="font-medium">{unit?.unit_number ?? '—'}</Td>
                      <Td>{lead?.contact?.full_name || t('dev_unnamed_buyer')}</Td>
                      <Td className="text-right">
                        <Money amount={r.amount} currency={r.currency} />
                      </Td>
                      <Td className="text-muted-foreground">{formatDate(r.reserved_at, language)}</Td>
                      <Td className={cn(expired && 'font-medium text-amber-700', soon && 'text-amber-700')}>
                        {r.expires_at ? formatDate(r.expires_at, language) : t('dev_reservation_no_expiry')}
                      </Td>
                      <Td>
                        {expired ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-600/45 bg-amber-500/[0.07] px-2 py-0.5 text-2xs font-medium text-amber-700">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            {t('dev_reservation_expired')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-gold-border bg-gold/[0.08] px-2 py-0.5 text-2xs font-medium text-gold-ink">
                            {t('dev_reservation_active')}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {can('sale') && r.status === 'ACTIVE' && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" onClick={() => setConverting(r)}>
                              <FileSignature className="mr-1.5 h-3.5 w-3.5" />
                              {t('dev_to_contract')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setReleasing(r)}>
                              {t('dev_release')}
                            </Button>
                          </div>
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

      {converting && (
        <ConvertDialog
          reservation={converting}
          unit={units.get(converting.unit_id) ?? null}
          onClose={() => setConverting(null)}
          onDone={() => { setConverting(null); void load(); }}
        />
      )}

      {releasing && (
        <ReleaseDialog
          reservation={releasing}
          onClose={() => setReleasing(null)}
          onDone={() => { setReleasing(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function ConvertDialog({
  reservation, unit, onClose, onDone,
}: {
  reservation: DevReservation;
  unit: DevUnit | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();
  const [plans, setPlans] = useState<DevPaymentPlan[]>([]);
  const [salePrice, setSalePrice] = useState(unit?.price != null ? String(unit.price) : '');
  const [contractNumber, setContractNumber] = useState('');
  const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0, 10));
  const [planId, setPlanId] = useState('NONE');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    listPaymentPlansForProject(workspace.id, unit?.project_id ?? null)
      .then((rows) => {
        setPlans(rows);
        const fallback = rows.find((p) => p.is_default) ?? rows[0];
        if (fallback) setPlanId(fallback.id);
      })
      .catch(() => {
        // Plans are optional — a deal can be created without a schedule and
        // one added later. The service layer has already reported the failure.
      });
  }, [workspace, unit]);

  const listPrice = unit?.price ?? null;
  const price = Number(salePrice);
  const discount = listPrice != null && Number.isFinite(price) ? Math.max(listPrice - price, 0) : 0;
  const discountPct = listPrice ? (discount / listPrice) * 100 : 0;
  // §134: a discount beyond list price is a decision somebody is accountable
  // for. Whoever cannot approve one is told before they type a number, not
  // after the server refuses it.
  const needsApproval = discountPct > 0 && !can('discount');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !Number.isFinite(price) || price <= 0) return;
    setSaving(true);
    try {
      await convertReservation({
        reservationId: reservation.id,
        salePrice: price,
        contractNumber: contractNumber.trim() || null,
        contractDate: contractDate || null,
        paymentPlanId: planId === 'NONE' ? null : planId,
      });
      toast.success(t('dev_deal_created'));
      onDone();
    } catch (error) {
      toast.error(t(error instanceof DevError ? error.key : 'dev_err_generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_to_contract')} · {unit?.unit_number ?? ''}</DialogTitle>
          <DialogDescription>{t('dev_convert_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-cv-price">{t('dev_sale_price')}</Label>
            <Input id="dev-cv-price" inputMode="decimal" value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)} required />
            {listPrice != null && (
              <p className="text-2xs text-muted-foreground">
                {t('dev_list_price')}: <Money amount={listPrice} currency={unit?.currency} />
                {discount > 0 && (
                  <> · {t('dev_discount')}: <Money amount={discount} currency={unit?.currency} />
                    {' '}({discountPct.toFixed(1)}%)</>
                )}
              </p>
            )}
            {needsApproval && (
              <p className="flex items-start gap-1.5 text-2xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {t('dev_discount_needs_approval')}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-cv-number">{t('dev_contract_number')}</Label>
              <Input id="dev-cv-number" value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-cv-date">{t('dev_contract_date')}</Label>
              <Input id="dev-cv-date" type="date" value={contractDate}
                onChange={(e) => setContractDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-cv-plan">{t('dev_payment_plan')}</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="dev-cv-plan"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t('dev_no_payment_plan')}</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">{t('dev_payment_plan_hint')}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={saving || needsApproval || !Number.isFinite(price) || price <= 0}>
              {saving ? t('dev_saving') : t('dev_create_deal')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDialog({
  reservation, onClose, onDone,
}: { reservation: DevReservation; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dev_release_reservation')}</DialogTitle>
          <DialogDescription>{t('dev_release_hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="dev-rel-reason">{t('dev_release_reason')}</Label>
          <Input id="dev-rel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            maxLength={200} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await cancelReservation(reservation.id, reason.trim());
                toast.success(t('dev_reservation_released'));
                onDone();
              } catch (error) {
                toast.error(t(error instanceof DevError ? error.key : 'dev_err_generic'));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t('dev_saving') : t('dev_release_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
