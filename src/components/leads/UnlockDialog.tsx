// HOMATCH Leads — the unlock confirmation, for one contact or a selection.
//
// The server quotes the selection (members already unlocked cost nothing; the same
// member twice is one unlock) and the customer confirms the exact total. The
// idempotency key is created when the dialog opens and reused if the confirm is
// retried, so a double click or a flaky network can never charge twice.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, ShieldCheck, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  newUnlockKey, quoteUnlock, unlockLeads, UnlockError, type UnlockQuote, type UnlockResult,
} from '@/services/homatchLeads';
import { BTN_PRIMARY, BTN_SECONDARY } from './kit';
import { formatCreditsLabel } from './LeadCard';

export function UnlockDialog({
  open, matchIds, onClose, onUnlocked,
}: {
  open: boolean;
  matchIds: string[];
  onClose: () => void;
  onUnlocked: (result: UnlockResult) => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<UnlockQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idsKey = matchIds.join(',');
  /* One key per opened confirmation: retries reuse it, a new selection gets a new one. */
  const key = useMemo(() => (open ? newUnlockKey() : ''), [open, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !matchIds.length) return;
    let alive = true;
    setLoading(true); setError(null); setQuote(null);
    quoteUnlock(matchIds)
      .then((q) => { if (alive) setQuote(q); })
      .catch(() => { if (alive) setError('QUOTE_FAILED'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const cr = (n: number) => formatCreditsLabel(n, lang);
  const bulk = matchIds.length > 1;
  const nothingToPay = quote != null && quote.totalCredits === 0;
  const overBalance = quote != null && quote.balance != null && quote.totalCredits > quote.balance;

  async function confirm() {
    setSubmitting(true); setError(null);
    try {
      const result = await unlockLeads(matchIds, key);
      onUnlocked(result);
    } catch (e) {
      setError(e instanceof UnlockError ? e.code : 'INTERNAL');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto bg-white sm:max-w-md [&>*]:min-w-0" data-testid="unlock-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{t(bulk ? 'hl_bulk_title' : 'hl_unlock_title')}</DialogTitle>
          <DialogDescription className="text-sm text-[hsl(224_14%_30%)]">{t('hl_unlock_body')}</DialogDescription>
        </DialogHeader>

        {loading || !quote ? (
          <div className="flex items-center justify-center py-8" aria-busy="true">
            {error ? <p className="text-sm text-[hsl(0_55%_38%)]">{t('hl_error_generic')}</p> : <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--gold-ink))]" />}
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
              {quote.standardCount > 0 ? (
                <div className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt>{t('hl_bulk_standard', { n: quote.standardCount, price: cr(quote.prices.STANDARD) })}</dt>
                  <dd className="font-semibold tabular-nums" dir="ltr">{cr(quote.standardCredits)}</dd>
                </div>
              ) : null}
              {quote.premiumCount > 0 ? (
                <div className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt>{t('hl_bulk_premium', { n: quote.premiumCount, price: cr(quote.prices.PREMIUM) })}</dt>
                  <dd className="font-semibold tabular-nums" dir="ltr">{cr(quote.premiumCredits)}</dd>
                </div>
              ) : null}
              {quote.alreadyUnlocked > 0 ? (
                <div className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm text-[hsl(224_14%_30%)]">
                  <dt>{t('hl_bulk_already', { n: quote.alreadyUnlocked })}</dt>
                  <dd className="tabular-nums" dir="ltr">0</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3 bg-[hsl(42_60%_97%)] px-3 py-3">
                <dt className="text-sm font-semibold">{t('hl_bulk_total')}</dt>
                <dd className="font-display text-lg font-bold tabular-nums text-[hsl(var(--gold-ink))]" dir="ltr">{t('hl_credits_n', { n: cr(quote.totalCredits) })}</dd>
              </div>
            </dl>
            {quote.balance != null ? (
              <p className="flex items-center gap-1.5 text-xs text-[hsl(224_14%_30%)]">
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_bulk_balance', { n: cr(quote.balance) })}
              </p>
            ) : null}
            {quote.eligible < quote.requested ? (
              <p className="text-xs text-[hsl(224_14%_30%)]">{t('hl_bulk_skipped_note')}</p>
            ) : null}
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(224_14%_30%)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('hl_unlock_privacy')}
            </p>
            {error ? (
              <p role="alert" className="rounded-lg bg-[hsl(0_60%_97%)] px-3 py-2 text-sm text-[hsl(0_55%_34%)]">
                {t(error === 'INSUFFICIENT_CREDITS' ? 'hl_error_credits' : error === 'PRODUCT_DISABLED' ? 'hl_error_disabled' : 'hl_error_generic')}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={submitting}>{t('hl_cancel')}</button>
              {overBalance || error === 'INSUFFICIENT_CREDITS' ? (
                <button type="button" className={BTN_PRIMARY} onClick={() => navigate('/credits')}>
                  <Wallet className="h-4 w-4" aria-hidden="true" />{t('hl_top_up')}
                </button>
              ) : (
                <button type="button" className={cn(BTN_PRIMARY, 'sm:min-w-[12rem]')} onClick={confirm}
                  disabled={submitting || quote.eligible === 0 || !quote.prices.active && !nothingToPay} data-testid="unlock-confirm">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                  {nothingToPay ? t('hl_unlock_confirm_free') : t('hl_unlock_confirm', { n: cr(quote.totalCredits) })}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
