/*
 * VERIFY BUDGET — what the customer sees of the money. Nothing more.
 *
 *   before   required balance (the authorised maximum), its approximate value
 *            in a currency of their choice, one sentence, one action
 *   during   credits used, credits remaining
 *   paused   used, returned, partial results, Resume
 *   done     final cost, unused credits returned
 *
 * Every number comes from the server (verify_launch_quote, the status
 * response's `billing`). No cost, rate, VAT, margin or provider ever reaches
 * this file, and a currency conversion is display only: it never changes the
 * credits charged. A currency appears only when an exchange rate is
 * configured (fx_rates); without one the value is shown in USD only.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pause, Play, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';

export interface LaunchQuote {
  enabled: boolean;
  maxCredits: number;
  usdCents: number;
  availableCredits: number | null;
  currencies: Array<{ code: string; usdPerUnit: number; asOf?: string }>;
}

export interface PublicBilling {
  state: 'ACTIVE' | 'PAUSED' | 'SETTLED' | 'RELEASED' | string | null;
  authorized: number | null;
  used: number | null;
  remaining: number | null;
  charged: number | null;
  live: boolean;
  calculating: boolean;
  lastReturned: number | null;
  lastCharged: number | null;
}

const INTL: Record<string, string> = { ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', he: 'he-IL' };
export const intlLocale = (lang: string) => INTL[lang] ?? 'en-US';

/** Credits as the wallet shows them: whole numbers whole, fractions to two places. */
export function formatCreditAmount(n: number | null | undefined, lang: string): string {
  const v = Number(n ?? 0);
  const r = Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
  return new Intl.NumberFormat(intlLocale(lang), { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 }).format(r);
}

/** USD cents → an approximate amount in `currency`, or null when no rate is configured. */
export function convertUsdCents(usdCents: number, currency: string, rates: LaunchQuote['currencies'], lang: string): string | null {
  const usd = Number(usdCents) / 100;
  if (!Number.isFinite(usd)) return null;
  if (currency === 'USD') return new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency: 'USD' }).format(usd);
  const rate = rates.find((r) => r.code === currency)?.usdPerUnit;
  if (!rate || !(Number(rate) > 0)) return null;
  try {
    return new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency }).format(usd / Number(rate));
  } catch {
    return null;
  }
}

const STORE = 'homatch.verify.displayCurrency';
function storedCurrency(): string {
  try {
    return localStorage.getItem(STORE) || 'USD';
  } catch {
    return 'USD';
  }
}

/** The launch confirmation. One sentence, one action. */
export function VerifyLaunchDialog({
  open,
  quote,
  busy,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  quote: LaunchQuote | null;
  busy?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useLanguage();
  const options = useMemo(() => ['USD', ...(quote?.currencies ?? []).map((c) => c.code).filter((c) => c !== 'USD')], [quote]);
  const [currency, setCurrency] = useState<string>(() => storedCurrency());
  const shown = options.includes(currency) ? currency : 'USD';
  const value = quote ? convertUsdCents(quote.usdCents, shown, quote.currencies, lang) : null;
  const available = quote?.availableCredits ?? null;
  const missing = quote && available != null ? Math.max(0, Math.round((quote.maxCredits - available) * 100) / 100) : 0;
  const pick = (c: string) => {
    setCurrency(c);
    try {
      localStorage.setItem(STORE, c);
    } catch {
      /* a remembered choice is a convenience */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-5 sm:rounded-2xl">
        <DialogHeader className="space-y-2 pr-8 text-start">
          <DialogTitle className="text-lg">{t('verify_budget_title')}</DialogTitle>
          <DialogDescription className="text-sm leading-6">{t('verify_budget_note')}</DialogDescription>
        </DialogHeader>

        {quote ? (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">{t('verify_budget_required')}</span>
              <span className="whitespace-nowrap text-2xl font-semibold tracking-tight [font-variant-numeric:tabular-nums]">
                <bdi>{t('verify_budget_credits', { n: formatCreditAmount(quote.maxCredits, lang) })}</bdi>
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground" title={t('verify_budget_approx')}>
                {value ? <bdi>≈ {value}</bdi> : null}
              </span>
              {options.length > 1 ? (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="sr-only">{t('verify_budget_currency')}</span>
                  <select
                    value={shown}
                    onChange={(e) => pick(e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {options.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {shown !== 'USD' ? <p className="text-xs text-muted-foreground">{t('verify_budget_approx')}</p> : null}
          </div>
        ) : (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        )}

        {quote && missing > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-2">
            <p className="break-words">{t('verify_budget_missing', { n: formatCreditAmount(missing, lang) })}</p>
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link to="/credits"><Wallet className="me-1.5 h-4 w-4" aria-hidden="true" />{t('verify_budget_add_credits')}</Link>
            </Button>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            className="w-full min-h-11"
            disabled={!quote || busy || missing > 0}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('verify_budget_start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** During research: used and remaining, nothing else. */
export function VerifyBudgetLine({ billing }: { billing: PublicBilling | null }) {
  const { t, lang } = useLanguage();
  if (!billing || billing.state !== 'ACTIVE') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-sm" aria-live="polite">
      <span>
        <span className="text-muted-foreground">{t('verify_budget_used')} </span>
        {billing.calculating ? (
          <span className="text-muted-foreground">{t('verify_budget_calculating')}</span>
        ) : (
          <bdi className="font-medium [font-variant-numeric:tabular-nums]">{formatCreditAmount(billing.used, lang)}</bdi>
        )}
      </span>
      <span>
        <span className="text-muted-foreground">{t('verify_budget_remaining')} </span>
        <bdi className="font-medium [font-variant-numeric:tabular-nums]">{formatCreditAmount(billing.remaining, lang)}</bdi>
      </span>
    </div>
  );
}

/** Paused: what it cost, what came back, the partial results, Resume. */
export function VerifyPausedCard({
  billing,
  resuming,
  onResume,
  onViewPartial,
  resumeError,
  extraCredits,
  onApproveExtra,
}: {
  billing: PublicBilling | null;
  resuming?: boolean;
  onResume: () => void;
  onViewPartial?: () => void;
  resumeError?: 'INSUFFICIENT_CREDITS' | 'BUDGET_EXHAUSTED' | string | null;
  extraCredits?: number;
  onApproveExtra?: () => void;
}) {
  const { t, lang } = useLanguage();
  return (
    <div className="rounded-2xl border border-primary/25 bg-card/70 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Pause className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="font-semibold">{t('verify_paused_title')}</p>
      </div>
      {billing ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('verify_budget_used')}</dt>
            <dd className="font-medium [font-variant-numeric:tabular-nums]"><bdi>{t('verify_budget_credits', { n: formatCreditAmount(billing.charged, lang) })}</bdi></dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('verify_paused_returned')}</dt>
            <dd className="font-medium [font-variant-numeric:tabular-nums]"><bdi>{t('verify_budget_credits', { n: formatCreditAmount(billing.lastReturned, lang) })}</bdi></dd>
          </div>
        </dl>
      ) : null}
      <p className="text-sm text-muted-foreground">{t('verify_paused_partial')}</p>
      {resumeError === 'INSUFFICIENT_CREDITS' ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-2">
          <p>{t('verify_resume_need_credits')}</p>
          <Button asChild size="sm"><Link to="/credits"><Wallet className="me-1.5 h-4 w-4" aria-hidden="true" />{t('verify_budget_add_credits')}</Link></Button>
        </div>
      ) : null}
      {resumeError === 'BUDGET_EXHAUSTED' && onApproveExtra ? (
        <div className="rounded-xl border border-border bg-background/60 p-3 text-sm space-y-2">
          <p>{t('verify_resume_budget_used', { n: formatCreditAmount(extraCredits ?? 0, lang) })}</p>
          <Button size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal py-2 text-center" onClick={onApproveExtra} disabled={resuming}>{t('verify_resume_approve_extra', { n: formatCreditAmount(extraCredits ?? 0, lang) })}</Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {resumeError === 'BUDGET_EXHAUSTED' && onApproveExtra ? null : (
        <Button type="button" className="h-auto min-h-11 whitespace-normal py-2" onClick={onResume} disabled={resuming}>
          {resuming ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
          {t('verify_resume')}
        </Button>
        )}
        {onViewPartial ? (
          <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal py-2" onClick={onViewPartial}>{t('verify_view_partial')}</Button>
        ) : null}
      </div>
    </div>
  );
}

/** Finished: the final cost and what came back. */
export function VerifyBudgetSummary({ billing }: { billing: PublicBilling | null }) {
  const { t, lang } = useLanguage();
  if (!billing || (billing.state !== 'SETTLED' && billing.state !== 'RELEASED')) return null;
  // Everything authorised and not charged went back to the wallet.
  const returned = billing.authorized != null && billing.charged != null ? Math.max(0, billing.authorized - billing.charged) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm">
      <span>
        <span className="text-muted-foreground">{t('verify_final_cost')} </span>
        <bdi className="font-semibold [font-variant-numeric:tabular-nums]">{t('verify_budget_credits', { n: formatCreditAmount(billing.charged, lang) })}</bdi>
      </span>
      {returned != null ? (
        <span>
          <span className="text-muted-foreground">{t('verify_unused_returned')} </span>
          <bdi className="font-medium [font-variant-numeric:tabular-nums]">{t('verify_budget_credits', { n: formatCreditAmount(returned, lang) })}</bdi>
        </span>
      ) : null}
    </div>
  );
}
