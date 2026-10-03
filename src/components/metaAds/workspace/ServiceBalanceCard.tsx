// META ADS — the HOMATCH service balance, one block per currency:
// DEPOSITED / AVAILABLE / RESERVED / CONSUMED / RELEASED. Amounts in
// different currencies are never added together. The non-refundable
// disclosure is mandatory wherever a deposit can be made or is held.
//
// A 0% fee on the customer's own ad account (a FEE_EXEMPT policy, decided by
// the server) needs no HOMATCH balance at all: no Add funds, no deposit
// dialog, and no deposit disclosure unless money is already held.
import { useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { depositCheckout, moneyIn, type ServiceBalanceRow } from '@/services/metaAds';

/** Stripe checkout minimum, in cents ($5). */
export const MIN_DEPOSIT_CENTS = 500;

export function ServiceBalanceCard({ rows, feePercent, billing }: {
  rows: ServiceBalanceRow[]; feePercent?: number | null; billing?: 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET';
}) {
  const { t, lang } = useLanguage();
  const balanceCopy = serviceBalanceCopy(t as T, lang, feePercent);
  /* Server-decided: the customer's effective percent and the billing mode. */
  const noDepositNeeded = isNoDepositNeeded(feePercent, billing);
  const holdsMoney = rows.some((r) => Number(r.deposited_cents) > 0 || Number(r.available_cents) > 0);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);

  const deposit = async () => {
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < MIN_DEPOSIT_CENTS) { toast.error(t('mads_deposit_min')); return; }
    setBusy(true);
    try {
      const { url } = await depositCheckout(cents);
      window.location.href = url;
    } catch {
      toast.error(t('mads_deposit_unavailable'));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mm-w-bal-title" className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
      <h2 id="mm-w-bal-title" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">
        <Wallet className="h-4 w-4" aria-hidden="true" />{t('mm_w_bal_title')}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-white/75">{balanceCopy.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {rows.map(r => (
            <div key={r.currency} aria-label={t('mm_w_bal_currency', { currency: r.currency })}>
              {rows.length > 1 && <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-white/60">{t('mm_w_bal_currency', { currency: r.currency })}</p>}
              <p className="text-2xs text-white/60">{t('mm_w_bal_available')}</p>
              <p className="font-display text-3xl font-bold tabular-nums" dir="ltr">{moneyIn(r.available_cents, r.currency, lang)}</p>
              <dl className="mt-2 space-y-1.5 text-[13px] text-white/80 tabular-nums">
                <Line label={t('mm_w_bal_deposited')} value={moneyIn(r.deposited_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_reserved')} hint={t('mm_w_bal_reserved_hint')} value={moneyIn(r.reserved_service_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_consumed')} hint={t('mm_w_bal_consumed_hint')} value={moneyIn(r.consumed_service_cents, r.currency, lang)} />
                <Line label={t('mm_w_bal_released')} hint={t('mm_w_bal_released_hint')} value={moneyIn(r.released_cents, r.currency, lang)} />
              </dl>
            </div>
          ))}
        </div>
      )}

      {balanceCopy.feeLabel && <p className="mt-3 text-[13px] text-white/70">{balanceCopy.feeLabel}</p>}

      {balanceCopy.card && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/80">
          {balanceCopy.card}
        </p>
      )}
      {/* Mandatory wherever a deposit can be made or is held: non-refundable, reusable, released to HOMATCH Balance. */}
      {(!noDepositNeeded || holdsMoney) && <p className="mt-2 text-2xs leading-relaxed text-white/60">{t('mm_w_bal_disclosure')}</p>}

      {!noDepositNeeded && (
        <Button onClick={() => setOpen(true)}
          className="mt-4 w-full bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
          {t('mads_add_funds')}
        </Button>
      )}

      {!noDepositNeeded && <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden p-0 md:max-w-sm">
          <DialogHeader className="shrink-0 pl-6 pr-14 pt-6">
            <DialogTitle>{t('mads_add_funds')}</DialogTitle>
            <DialogDescription>{balanceCopy.dialog}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4">
          <label className="flex items-center gap-2" dir="ltr">
            <span className="text-lg font-bold" aria-hidden="true">$</span>
            <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label={t('mads_add_funds')} />
          </label>
          <p className="text-[13px] text-muted-foreground">{t('mm_w_bal_min')}</p>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('general_cancel')}</Button>
            <Button onClick={deposit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_deposit_go')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </section>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="min-w-0">
        <span>{label}</span>
        {hint && <span className="block text-2xs text-white/55">{hint}</span>}
      </dt>
      <dd className="shrink-0" dir="ltr">{value}</dd>
    </div>
  );
}


/** 0% on the customer's own ad account: HOMATCH holds nothing for a launch. */
export function isNoDepositNeeded(feePercent: number | null | undefined, billing?: 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET'): boolean {
  return feePercent != null && Number(feePercent) === 0 && (billing ?? 'CUSTOMER_AD_ACCOUNT') === 'CUSTOMER_AD_ACCOUNT';
}

/**
 * The card's words for this customer's fee. The percent comes only from the
 * server (status.settings.feePercent: their policy over the standard
 * setting); nothing here assumes a number. Unknown → no fee example at all.
 */
type T = (key: string, params?: Record<string, string | number>) => string;
function serviceBalanceCopy(t: T, lang: string, feePercent?: number | null) {
  if (feePercent == null || !Number.isFinite(Number(feePercent))) {
    return { empty: t('mm_w_bal_std_empty'), feeLabel: null as string | null, card: null as string | null, dialog: t('mm_w_bal_std_empty') };
  }
  const pct = Number(feePercent);
  if (pct === 0) {
    return { empty: t('mm_w_bal_zero_empty'), feeLabel: t('mm_w_bal_zero_fee'), card: t('mm_w_bal_zero_card'), dialog: t('mm_w_bal_zero_dialog') };
  }
  const fee = (100 * pct / 100).toLocaleString(lang, { maximumFractionDigits: 2 });
  const pctText = pct.toLocaleString(lang, { maximumFractionDigits: 2 });
  return {
    empty: t('mm_w_bal_std_empty'),
    feeLabel: t('mm_w_bal_std_fee', { pct: pctText }),
    card: t('mm_w_bal_std_card', { pct: pctText, fee }),
    dialog: t('mm_w_bal_std_dialog', { pct: pctText, fee }),
  };
}
