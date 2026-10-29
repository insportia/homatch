// Matching workspace — selection bar → exact server quote → confirmation → unlock → success.
//
// Nothing here computes a price: the bar and the dialog show the server's quote (already
// unlocked contacts are named and never charged again), the confirmation sends the total the
// customer saw (curated: expectedCredits) with one idempotency key that a retry of the SAME
// confirmation reuses. Nothing is ever sent to anyone: the success panel only opens the
// existing campaign screen on a list.

import { AlertTriangle, CheckCircle2, Loader2, Lock, Mail, ShieldCheck, Wallet, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/leads/kit';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { creditsToUsd, formatCount, formatCredits, formatUsd } from './format';
import type { WsProduct } from './urlState';

export interface WsQuote {
  selected: number;
  alreadyUnlocked: number;
  newCount: number;
  totalCredits: number;
  balance: number | null;
  /** Curated: the server's price is active (sales on). Internal quotes are always priced. */
  active: boolean;
  /** Curated only: the USD the customer pays, from the server's cents. */
  usd: number | null;
  /** Internal only: one line per price, so the customer sees what each price is for. */
  lines?: { key: 'STANDARD' | 'EXACT' | 'PREMIUM' | 'MORTGAGE' | 'MORTGAGE_MATCH' | 'EXPAT'; count: number; unit: number; credits: number }[];
}

const LINE_KEY = { STANDARD: 'hl_bulk_standard', EXACT: 'hl_bulk_exact', PREMIUM: 'hl_bulk_premium', MORTGAGE: 'hl_bulk_mortgage', MORTGAGE_MATCH: 'hl_bulk_mortgage_match', EXPAT: 'hl_bulk_expat' } as const;

export function quoteUsd(q: WsQuote): number {
  return q.usd ?? creditsToUsd(q.totalCredits);
}

export function SelectionBar({
  product, count, quote, quoting, quoteError, notice, onClear, onUnlock,
}: {
  product: WsProduct;
  count: number;
  quote: WsQuote | null;
  quoting: boolean;
  quoteError: boolean;
  notice: string | null;
  onClear: () => void;
  onUnlock: () => void;
}) {
  const { t, lang } = useLanguage();
  const cr = (n: number) => formatCredits(n, lang);
  const overBalance = quote != null && quote.balance != null && quote.totalCredits > quote.balance;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-4" data-testid="mw-selection-bar">
      <div className="mx-auto flex max-w-4xl flex-col gap-2.5 rounded-2xl border border-[hsl(40_60%_70%)] bg-[#0C1119] p-3 text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0 text-sm" aria-live="polite">
          <p className="text-2xs font-bold uppercase tracking-[0.16em] text-[hsl(38_92%_62%)]" data-testid="mw-selected-count">
            {t('mw_selected_n', { n: formatCount(count, lang) })}
          </p>
          <p className="mt-0.5 min-w-0 break-words text-white/90" data-testid="mw-quote">
            {quoting && !quote ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('mw_quote_loading')}</span>
              : quoteError ? t('mw_quote_failed')
                : quote ? (
                  <>
                    {t('mw_quote_new', { n: formatCount(quote.newCount, lang), credits: cr(quote.totalCredits) })}
                    {product === 'external' ? <span dir="ltr"> ({formatUsd(quoteUsd(quote), lang)})</span> : null}
                    {quote.alreadyUnlocked > 0 ? <span className="block text-[hsl(40_94%_74%)]" data-testid="mw-quote-already">{t('mw_quote_already', { n: formatCount(quote.alreadyUnlocked, lang) })}</span> : null}
                    {quote.balance != null ? <span className={cn('block text-xs', overBalance ? 'text-[hsl(0_85%_75%)]' : 'text-white/70')}>{t('mw_balance', { credits: cr(quote.balance) })}</span> : null}
                  </>
                ) : null}
          </p>
          {notice ? <p className="mt-1 text-xs text-[hsl(40_94%_74%)]" data-testid="mw-selection-notice">{notice}</p> : null}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white hover:bg-white/10" data-testid="mw-clear-selection">
            <X className="h-4 w-4" aria-hidden="true" />{t('mw_clear_selection')}
          </button>
          <button type="button" onClick={onUnlock} disabled={!quote || quote.newCount === 0 || (product === 'external' && !quote.active)}
            className={cn(BTN_PRIMARY, 'flex-1 sm:flex-none')} data-testid="mw-unlock">
            <Lock className="h-4 w-4" aria-hidden="true" />{t('mw_unlock_selected')}
          </button>
        </div>
      </div>
    </div>
  );
}

const ERROR_KEY: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'mw_err_insufficient', SUBSCRIPTION_REQUIRED: 'sub_prompt_subscribe', PRICE_CHANGED: 'mw_err_price_changed', SERVICE_DISABLED: 'mw_err_disabled',
  PRODUCT_DISABLED: 'mw_err_disabled', TOO_MANY_SELECTED: 'mw_err_too_many', NOTHING_SELECTED: 'mw_err_nothing',
};

export function UnlockConfirmDialog({
  open, product, quote, busy, error, onConfirm, onClose, onRequote,
}: {
  open: boolean;
  product: WsProduct;
  quote: WsQuote | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onRequote: () => void;
}) {
  const { t, lang } = useLanguage();
  const cr = (n: number) => formatCredits(n, lang);
  const overBalance = quote != null && quote.balance != null && quote.totalCredits > quote.balance;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md [&>*]:min-w-0" data-testid="mw-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="break-words font-display">{t(product === 'external' ? 'mw_confirm_title_external' : 'mw_confirm_title_internal')}</DialogTitle>
          <DialogDescription className="break-words">{t('mw_confirm_body')}</DialogDescription>
        </DialogHeader>
        {quote ? (
          <dl className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm" data-testid="mw-confirm-quote">
            <div className="flex justify-between gap-3"><dt>{t('mw_confirm_selected')}</dt><dd className="font-semibold tabular-nums" dir="ltr">{formatCount(quote.selected, lang)}</dd></div>
            {quote.alreadyUnlocked > 0 ? (
              <div className="flex justify-between gap-3 text-[hsl(152_55%_24%)]"><dt>{t('mw_confirm_already')}</dt><dd className="font-semibold tabular-nums" dir="ltr">{formatCount(quote.alreadyUnlocked, lang)}</dd></div>
            ) : null}
            {(quote.lines ?? []).filter((l) => l.count > 0).map((l) => (
              <div key={l.key} className="flex justify-between gap-3 text-[hsl(224_14%_26%)]" data-testid={`mw-confirm-line-${l.key}`}>
                <dt className="min-w-0">{t(LINE_KEY[l.key], { n: formatCount(l.count, lang), price: t(l.unit === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: cr(l.unit) }) })}</dt>
                <dd className="shrink-0 font-semibold tabular-nums" dir="ltr">{cr(l.credits)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3"><dt>{t('mw_confirm_new')}</dt><dd className="font-semibold tabular-nums" dir="ltr">{formatCount(quote.newCount, lang)}</dd></div>
            <div className="flex items-baseline justify-between gap-3 border-t border-[hsl(var(--border))] pt-2">
              <dt className="font-semibold">{t('mw_confirm_total')}</dt>
              <dd className="text-end font-display text-lg font-bold" data-testid="mw-confirm-total">
                <span dir="ltr">{t(quote.totalCredits === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: cr(quote.totalCredits) })}</span>
                {product === 'external' ? <span className="block text-xs font-semibold text-muted-foreground" dir="ltr">{formatUsd(quoteUsd(quote), lang)}</span> : null}
              </dd>
            </div>
            {quote.balance != null ? (
              <div className={cn('flex justify-between gap-3 text-xs', overBalance ? 'text-[hsl(0_60%_40%)]' : 'text-muted-foreground')}>
                <dt className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" aria-hidden="true" />{t('mw_confirm_balance')}</dt>
                <dd className="tabular-nums" dir="ltr">{t(quote.balance === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: cr(quote.balance) })}</dd>
              </div>
            ) : null}
          </dl>
        ) : <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>}
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          {t(product === 'external' ? 'mw_consent_note' : 'mw_internal_privacy_note')}
        </p>
        {error ? (
          <div className="rounded-xl border border-[hsl(0_45%_80%)] bg-[hsl(0_60%_97%)] p-3 text-sm text-[hsl(0_55%_30%)]" role="alert" data-testid="mw-confirm-error" data-code={error}>
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(ERROR_KEY[error] ?? 'mw_err_generic')}</p>
            {error === 'INSUFFICIENT_CREDITS' || error === 'SUBSCRIPTION_REQUIRED' ? <Link to="/pricing" className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4">{t('sub_see_plans')}</Link> : null}
            {error === 'PRICE_CHANGED' ? <button type="button" onClick={onRequote} className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4" data-testid="mw-requote">{t('mw_requote')}</button> : null}
          </div>
        ) : null}
        {overBalance && !error ? (
          /* Not enough credits by this quote: say so before the click. The button stays: the balance may
             have been topped up elsewhere since, and the server decides (a refusal charges nothing). */
          <div className="rounded-xl border border-[hsl(38_70%_75%)] bg-[hsl(42_90%_96%)] p-3 text-sm text-[hsl(30_60%_25%)]" role="status" data-testid="mw-confirm-over-balance">
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('mw_err_insufficient')}</p>
            <Link to="/pricing" className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-4">{t('sub_see_plans')}</Link>
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>{t('mw_cancel')}</button>
          <button type="button" className={BTN_PRIMARY} onClick={onConfirm} data-testid="mw-confirm"
            disabled={busy || !quote || quote.newCount === 0 || error === 'PRICE_CHANGED' || error === 'SERVICE_DISABLED'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
            {quote ? t('mw_confirm_cta', { credits: cr(quote.totalCredits) }) : t('mw_unlock_selected')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UnlockSuccess({
  count, credits, creating, onCreateCampaign, onViewUnlocked, onDismiss,
}: {
  count: number;
  credits: number;
  creating: boolean;
  onCreateCampaign: (() => void) | null;
  onViewUnlocked: (() => void) | null;
  onDismiss: () => void;
}) {
  const { t, lang } = useLanguage();
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[hsl(40_60%_80%)] bg-[linear-gradient(135deg,hsl(42_100%_98%),#fff)] p-4 shadow-card sm:p-5" data-testid="mw-success" aria-live="polite">
      <button type="button" onClick={onDismiss} className="absolute end-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5" aria-label={t('mw_dismiss')}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex items-start gap-3 pe-8">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(152_45%_92%)] text-[hsl(152_55%_26%)]"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('mw_success_title', { n: formatCount(count, lang) })}</h2>
          <p className="mt-0.5 text-sm text-[hsl(224_14%_30%)]">{credits > 0 ? t('mw_success_charged', { credits: formatCredits(credits, lang) }) : t('mw_success_free')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('mw_success_no_send')}</p>
          {/* No campaign offered (Email Marketing hidden, or nothing to put in one): the next step is copying. */}
          {!onCreateCampaign ? <p className="mt-1 text-xs text-[hsl(224_14%_30%)]" data-testid="mw-success-copy-hint">{t('mw_copy_hint')}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {onCreateCampaign ? (
          <button type="button" className={BTN_PRIMARY} onClick={onCreateCampaign} disabled={creating} data-testid="mw-create-campaign">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}{t('mw_create_campaign')}
          </button>
        ) : null}
        {onViewUnlocked ? <button type="button" className={BTN_SECONDARY} onClick={onViewUnlocked} data-testid="mw-success-view-unlocked">{t('mw_success_view_unlocked')}</button> : null}
      </div>
    </section>
  );
}
