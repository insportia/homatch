import React, { useMemo, useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
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
import { useLanguage } from '@/contexts/LanguageContext';
import { bulkUpdateUnits } from '@/services/developer/finance';
import { devErrorText } from '@/services/developer/client';
import { formatMoney, formatNumber, UNIT_STATUS_KEYS } from './primitives';
import { WORKFLOW_ONLY_STATUSES } from '@/services/developer/types';
import type { DevUnit, UnitStatus, DevPaymentPlan } from '@/services/developer/types';

/**
 * REPRICING FIVE HUNDRED APARTMENTS WITHOUT OPENING FIVE HUNDRED DRAWERS.
 *
 * A developer raises a whole phase by 4% on a Monday morning. Doing that one
 * unit at a time is not a workflow, it is a reason to keep the real prices in
 * a spreadsheet — which is the failure this product exists to end.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. RESERVED, CONTRACT_PENDING and SOLD are
 * refused: those statuses mean money has moved, and they are set by the
 * reservation and contract workflow or not at all. The database refuses them
 * twice — dev_bulk_update_units raises before it writes, and a BEFORE UPDATE
 * trigger on dev_units would refuse anyway — so this dialog is explaining the
 * rule, not enforcing it.
 *
 * Units that are already reserved or sold are skipped rather than failing the
 * whole operation, and the count that comes back is the number actually
 * changed. A dialog that says "500 updated" when 37 were under contract would
 * be lying about the one thing that matters.
 */
type Mode = 'PRICE_SET' | 'PRICE_PCT' | 'STATUS' | 'PLAN';

export function BulkEditDialog({
  units, paymentPlans, currency, onClose, onDone,
}: {
  units: DevUnit[];
  paymentPlans: DevPaymentPlan[];
  currency: string | null | undefined;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [mode, setMode] = useState<Mode>('PRICE_PCT');
  const [price, setPrice] = useState('');
  const [pct, setPct] = useState('');
  const [status, setStatus] = useState<UnitStatus>('AVAILABLE');
  const [planId, setPlanId] = useState('');
  const [saving, setSaving] = useState(false);

  /* Split before anything is sent, so the dialog can say what will actually
     happen rather than reporting it afterwards. */
  const locked = useMemo(
    () => units.filter((u) => WORKFLOW_ONLY_STATUSES.includes(u.status)),
    [units],
  );
  const editable = useMemo(
    () => units.filter((u) => !WORKFLOW_ONLY_STATUSES.includes(u.status)),
    [units],
  );

  // A price change touches every selected unit; a status change skips the
  // locked ones. Saying which is which is the honest version of a count.
  const affected = mode === 'STATUS' ? editable : units;

  const preview = useMemo(() => {
    if (mode !== 'PRICE_PCT') return null;
    const n = Number(pct);
    if (!Number.isFinite(n) || n === 0) return null;
    const priced = affected.filter((u) => u.price != null);
    if (priced.length === 0) return null;
    const before = priced.reduce((s, u) => s + Number(u.price), 0);
    const after = before * (1 + n / 100);
    return { count: priced.length, before, after };
  }, [mode, pct, affected]);

  const valid = mode === 'PRICE_SET'
    ? Number.isFinite(Number(price)) && Number(price) > 0
    : mode === 'PRICE_PCT'
      ? Number.isFinite(Number(pct)) && Number(pct) !== 0
      : mode === 'PLAN'
        ? planId !== ''
        : true;

  async function apply() {
    setSaving(true);
    try {
      const updated = await bulkUpdateUnits(units.map((u) => u.id), {
        price: mode === 'PRICE_SET' ? Number(price) : null,
        priceDeltaPct: mode === 'PRICE_PCT' ? Number(pct) : null,
        status: mode === 'STATUS' ? status : null,
        paymentPlanId: mode === 'PLAN' ? planId : null,
      });
      toast.success(
        t('dev_bulk_updated').replace('{n}', formatNumber(updated, language)),
      );
      await onDone();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  // The statuses a person may set here. The three the workflow owns are not
  // in this list at all, rather than being offered and then refused.
  const settableStatuses: UnitStatus[] =
    (['AVAILABLE', 'ON_HOLD', 'NEGOTIATION', 'HIDDEN'] as UnitStatus[]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('dev_bulk_title').replace('{n}', formatNumber(units.length, language))}
          </DialogTitle>
          <DialogDescription>{t('dev_bulk_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-mode">{t('dev_bulk_what')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger id="bulk-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PRICE_PCT">{t('dev_bulk_mode_pct')}</SelectItem>
                <SelectItem value="PRICE_SET">{t('dev_bulk_mode_price')}</SelectItem>
                <SelectItem value="STATUS">{t('dev_bulk_mode_status')}</SelectItem>
                {paymentPlans.length > 0 && (
                  <SelectItem value="PLAN">{t('dev_bulk_mode_plan')}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {mode === 'PRICE_PCT' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-pct">{t('dev_bulk_pct')}</Label>
              <Input
                id="bulk-pct" type="number" step="0.1" inputMode="decimal"
                value={pct} onChange={(e) => setPct(e.target.value)}
                placeholder="4"
              />
              <p className="text-2xs text-muted-foreground">{t('dev_bulk_pct_hint')}</p>
            </div>
          )}

          {mode === 'PRICE_SET' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-price">{t('dev_bulk_price')}</Label>
              <Input
                id="bulk-price" type="number" min="0" step="1" inputMode="decimal"
                value={price} onChange={(e) => setPrice(e.target.value)}
              />
              <p className="text-2xs text-muted-foreground">{t('dev_bulk_price_hint')}</p>
            </div>
          )}

          {mode === 'STATUS' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-status">{t('dev_status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as UnitStatus)}>
                <SelectTrigger id="bulk-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {settableStatuses.map((s) => (
                    <SelectItem key={s} value={s}>{t(UNIT_STATUS_KEYS[s])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
                <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                {t('dev_bulk_status_locked_note')}
              </p>
            </div>
          )}

          {mode === 'PLAN' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-plan">{t('dev_payment_plan')}</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="bulk-plan">
                  <SelectValue placeholder={t('dev_bulk_pick_plan')} />
                </SelectTrigger>
                <SelectContent>
                  {paymentPlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* What this will actually do, in money, before it is done. */}
          {preview && (
            <div className="rounded-md border border-gold-border/60 bg-gold/[0.05] px-3 py-2.5">
              <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                {t('dev_bulk_preview')}
              </p>
              <p className="mt-1 text-sm">
                {formatMoney(preview.before, currency, language)}
                {' → '}
                <span className="font-semibold">
                  {formatMoney(preview.after, currency, language)}
                </span>
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {t('dev_bulk_preview_hint')
                  .replace('{n}', formatNumber(preview.count, language))}
              </p>
            </div>
          )}

          {mode === 'STATUS' && locked.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('dev_bulk_skipping')
                .replace('{n}', formatNumber(locked.length, language))}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button
            onClick={() => void apply()}
            disabled={saving || !valid || affected.length === 0}
          >
            {saving
              ? t('dev_saving')
              : t('dev_bulk_apply').replace('{n}', formatNumber(affected.length, language))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
