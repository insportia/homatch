/*
 * VERIFY BUDGET — what the customer sees of the money. Nothing more.
 *
 *   before   required balance (the authorised maximum), its approximate value
 *            in a currency of their choice, one sentence, one action
 *   during   credits used, credits available
 *   awaiting the next check needs another +25: one premium question,
 *            Continue Investigation / Stop & View Results (never automatic)
 *   limit    the 100-credit maximum is reached: results are saved
 *   paused   used, returned, partial results, Resume
 *   done     final cost, unused credits returned
 *
 * Every number comes from the server (verify_launch_quote, the status
 * response's `billing`). No cost, rate, VAT, margin or provider ever reaches
 * this file, and a currency conversion is display only: it never changes the
 * credits charged. A currency appears only when an exchange rate is
 * configured (fx_rates); without one the value is shown in USD only.
 *
 * DESIGN: Verify's own premium system (UI_CONTRACTS.md) — the light
 * `.hm-invest` ground, white hairline panels, a gold eyebrow, the deep navy
 * band for the one figure that matters, and Verify's gold call to action.
 * Every button is the same framed 48 px control. The dialog renders in a
 * portal outside the page, so it carries the `.hm-invest` scope itself.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pause, Play, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

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
  /** Authorisations granted so far (25 each); the approval screen sends it back. */
  authorizations?: number | null;
  increment?: number | null;
  /** The increment's value in USD cents at the configured credit rate (display only). */
  incrementUsdCents?: number | null;
  maxBudget?: number | null;
  canExtend?: boolean;
  /** Why a paused job waits: the customer's approval of +25, or the 100 maximum. */
  hold?: 'APPROVAL' | 'LIMIT' | null;
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

/* ── The controls: one size, one radius, one frame ─────────────────────── */
// Verify's own call to action (the search button on the Verification Center).
const GOLD_ACTION =
  'h-auto min-h-12 w-full whitespace-normal rounded-xl border border-[hsl(38_70%_46%)] bg-[hsl(38_92%_54%)] px-6 py-3 text-[15px] font-bold leading-snug text-[#161309] shadow-card hover:bg-[hsl(38_92%_60%)] focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)] focus-visible:ring-offset-2 disabled:border-transparent disabled:bg-[hsl(38_30%_88%)] disabled:text-[#161309]/45 disabled:opacity-100';
// The framed secondary: same box, a drawn line instead of a fill.
const FRAMED_ACTION =
  'h-auto min-h-12 w-full whitespace-normal rounded-xl border border-foreground/20 bg-white px-6 py-3 text-[15px] font-semibold leading-snug text-foreground shadow-card hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold-soft))] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2';

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">{children}</p>
);

/** One figure in a framed tile: the number large, its unit small beside it (wraps, never clips). */
function Stat({ label, value, unit, strong, quiet }: { label: string; value: string; unit?: string; strong?: boolean; quiet?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-[hsl(var(--sand))] px-4 py-3">
      <dt className="text-2xs font-medium leading-snug text-muted-foreground break-words">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 [font-variant-numeric:tabular-nums]">
        <bdi className={cn(quiet ? 'text-base font-medium text-muted-foreground' : 'font-semibold text-foreground', !quiet && (strong ? 'text-2xl' : 'text-xl'))}>{value}</bdi>
        {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
      </dd>
    </div>
  );
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
      <DialogContent className="hm-invest w-[calc(100vw-2rem)] max-w-md gap-0 overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-0 text-foreground shadow-[var(--shadow-hover)] sm:rounded-2xl">
        <div className="h-1 w-full bg-[hsl(38_92%_54%)]" aria-hidden="true" />
        <div className="space-y-5 p-6 sm:p-7">
          <DialogHeader className="space-y-2 pr-8 text-start">
            <Eyebrow>{t('verify_budget_eyebrow')}</Eyebrow>
            <DialogTitle className="font-display text-2xl font-semibold leading-tight text-foreground">{t('verify_budget_title')}</DialogTitle>
          </DialogHeader>

          {quote ? (
            <div className="rounded-xl bg-[#0C1119] p-5 text-white shadow-card">
              <p className="text-2xs font-medium uppercase tracking-[0.12em] text-white/60">{t('verify_budget_required')}</p>
              <p className="mt-1.5 whitespace-nowrap font-display text-4xl font-semibold leading-none tracking-tight [font-variant-numeric:tabular-nums]">
                <bdi>
                  {formatCreditAmount(quote.maxCredits, lang)}
                  <span className="ms-2 align-baseline text-base font-medium text-[hsl(38_92%_62%)]">{t('verify_budget_unit')}</span>
                </bdi>
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <span className="text-sm text-white/75" title={t('verify_budget_approx')}>
                  {value ? t('verify_budget_approx_value', { v: value }) : null}
                </span>
                {options.length > 1 ? (
                  <label className="inline-flex items-center">
                    <span className="sr-only">{t('verify_budget_currency')}</span>
                    <select
                      value={shown}
                      onChange={(e) => pick(e.target.value)}
                      className="h-9 rounded-lg border border-white/20 bg-white/5 px-2.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)] [&>option]:text-[#0C1119]"
                    >
                      {options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {shown !== 'USD' ? <p className="mt-2 text-xs text-white/55">{t('verify_budget_approx')}</p> : null}
            </div>
          ) : (
            <div className="flex justify-center rounded-xl border border-border py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /></div>
          )}

          <DialogDescription className="text-sm leading-6 text-muted-foreground">{t('verify_budget_note')}</DialogDescription>

          {quote && missing > 0 ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4">
              <p className="text-sm font-medium leading-6 text-foreground break-words">{t('verify_budget_missing', { n: formatCreditAmount(missing, lang) })}</p>
              <Button asChild className={FRAMED_ACTION}>
                <Link to="/credits"><Wallet className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t('verify_budget_add_credits')}</Link>
              </Button>
            </div>
          ) : null}

          <Button type="button" className={GOLD_ACTION} disabled={!quote || busy || missing > 0} onClick={onConfirm}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('verify_budget_start')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** During research: used and remaining, nothing else. */
export function VerifyBudgetLine({ billing }: { billing: PublicBilling | null }) {
  const { t, lang } = useLanguage();
  if (!billing || billing.state !== 'ACTIVE') return null;
  const total = Number(billing.authorized) || 0;
  const share = total > 0 && !billing.calculating ? Math.min(100, Math.max(0, (Number(billing.used) / total) * 100)) : null;
  return (
    <section className="hm-invest-panel p-4 sm:p-5" aria-live="polite">
      <dl className="grid grid-cols-2 gap-3">
        <Stat label={t('verify_budget_used')} value={billing.calculating ? t('verify_budget_calculating') : formatCreditAmount(billing.used, lang)} unit={billing.calculating ? undefined : t('verify_budget_unit')} quiet={billing.calculating} />
        <Stat label={t('verify_budget_available')} value={formatCreditAmount(billing.remaining, lang)} unit={t('verify_budget_unit')} />
      </dl>
      {share != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--sand))]" role="presentation">
          <div className="h-full rounded-full bg-[hsl(38_92%_54%)] transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
        </div>
      ) : null}
    </section>
  );
}

/** Paused: what it cost, what came back, the partial results, Resume. */
export function VerifyPausedCard({
  billing,
  resuming,
  onResume,
  onViewPartial,
  resumeError,
  onReviewApproval,
}: {
  billing: PublicBilling | null;
  resuming?: boolean;
  onResume: () => void;
  onViewPartial?: () => void;
  resumeError?: 'INSUFFICIENT_CREDITS' | 'BUDGET_EXHAUSTED' | string | null;
  /** Opens the +25 question again (the investigation is waiting on it). */
  onReviewApproval?: () => void;
}) {
  const { t, lang } = useLanguage();
  if (billing?.hold === 'LIMIT') return <VerifyBudgetLimitCard maxBudget={billing.maxBudget ?? 100} onView={onViewPartial} />;
  const needsApproval = (billing?.hold === 'APPROVAL' || resumeError === 'BUDGET_EXHAUSTED') && !!onReviewApproval;
  return (
    <section className="hm-invest-panel hm-invest-focus space-y-5 p-5 sm:p-7">
      <header className="space-y-1.5">
        <Eyebrow>{t('verify_budget_eyebrow')}</Eyebrow>
        <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold leading-tight text-foreground">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
            <Pause className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          </span>
          <span className="min-w-0 break-words">{t(needsApproval ? 'verify_awaiting_title' : 'verify_paused_title')}</span>
        </h2>
      </header>
      {billing ? (
        <dl className="grid grid-cols-2 gap-3">
          <Stat label={t('verify_budget_used')} value={formatCreditAmount(billing.charged, lang)} unit={t('verify_budget_unit')} />
          <Stat label={t('verify_paused_returned')} value={formatCreditAmount(billing.lastReturned, lang)} unit={t('verify_budget_unit')} />
        </dl>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">{t(needsApproval ? 'verify_awaiting_body' : 'verify_paused_partial')}</p>
      {resumeError === 'INSUFFICIENT_CREDITS' ? (
        <div className="space-y-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4">
          <p className="text-sm font-medium leading-6">{t('verify_resume_need_credits')}</p>
          <Button asChild className={FRAMED_ACTION}><Link to="/credits"><Wallet className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t('verify_budget_add_credits')}</Link></Button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" className={GOLD_ACTION} onClick={needsApproval ? onReviewApproval : onResume} disabled={resuming}>
          {resuming ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="me-2 h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />}
          {t(needsApproval ? 'verify_extend_continue' : 'verify_resume')}
        </Button>
        {onViewPartial ? (
          <Button type="button" variant="outline" className={FRAMED_ACTION} onClick={onViewPartial}>{t('verify_view_partial')}</Button>
        ) : null}
      </div>
    </section>
  );
}

/** Finished: the final cost and what came back. */
export function VerifyBudgetSummary({ billing }: { billing: PublicBilling | null }) {
  const { t, lang } = useLanguage();
  if (!billing || (billing.state !== 'SETTLED' && billing.state !== 'RELEASED')) return null;
  // Everything authorised and not charged went back to the wallet.
  const returned = billing.authorized != null && billing.charged != null ? Math.max(0, billing.authorized - billing.charged) : null;
  return (
    <section className="hm-invest-panel p-4 sm:p-5">
      <dl className="grid grid-cols-2 gap-3">
        <Stat strong label={t('verify_final_cost')} value={formatCreditAmount(billing.charged, lang)} unit={t('verify_budget_unit')} />
        {returned != null ? <Stat label={t('verify_unused_returned')} value={formatCreditAmount(returned, lang)} unit={t('verify_budget_unit')} /> : null}
      </dl>
    </section>
  );
}

/**
 * The extension question. Asked only when the server's gate says the next
 * paid check does not fit what the customer authorised; answered only by
 * the customer: nothing is reserved or charged until they continue, and the
 * request names the screen it answers so a double click is one extension.
 *
 * Calm on purpose: it is a spending AUTHORISATION ("up to"), never shown as
 * an automatic charge. Copy is the owner's exact wording (2026-10-10). The
 * currency line is display only, from a configured rate; no estimate of the
 * remaining checks is shown, because the server only holds conservative
 * stage ceilings — not a reliable expectation of what they will cost.
 */
export function VerifyBudgetExtendDialog({
  open,
  increment,
  incrementUsdCents,
  currencies,
  busy,
  needCredits,
  onContinue,
  onStop,
}: {
  open: boolean;
  increment: number;
  /** The increment's value in USD cents at the configured credit rate (display only). */
  incrementUsdCents?: number | null;
  currencies?: LaunchQuote['currencies'];
  busy?: boolean;
  /** The wallet cannot cover the extension: offer to add credits instead. */
  needCredits?: boolean;
  onContinue: () => void;
  onStop: () => void;
}) {
  const { t, lang } = useLanguage();
  const currency = storedCurrency();
  const money = incrementUsdCents != null && Number(incrementUsdCents) > 0
    ? convertUsdCents(Number(incrementUsdCents), currency, currencies ?? [], lang) ?? convertUsdCents(Number(incrementUsdCents), 'USD', [], lang)
    : null;
  const n = formatCreditAmount(increment, lang);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onStop(); }}>
      <DialogContent className="hm-invest max-h-[calc(100dvh-1rem)] w-[calc(100vw-2rem)] max-w-md gap-0 overflow-y-auto overscroll-contain rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-0 text-foreground shadow-[var(--shadow-hover)] sm:rounded-2xl">
        <div className="h-1 w-full bg-[hsl(38_92%_54%)]" aria-hidden="true" />
        <div className="space-y-3 px-5 pb-4 pt-4 sm:space-y-5 sm:p-7">
          <DialogHeader className="space-y-1.5 pr-8 text-start">
            <Eyebrow>{t('verify_budget_eyebrow')}</Eyebrow>
            <DialogTitle className="font-display text-[1.2rem] font-semibold leading-tight text-foreground sm:text-2xl">{t('verify_extend_title')}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-sm leading-[1.45rem] text-muted-foreground">{t('verify_extend_body')}</DialogDescription>

          <div className="rounded-xl bg-[#0C1119] px-5 py-3.5 text-white shadow-card sm:py-4">
            <p className="text-2xs font-medium uppercase tracking-[0.12em] text-white/60">{t('verify_extend_label')}</p>
            <p className="mt-1 font-display text-lg font-semibold leading-snug [font-variant-numeric:tabular-nums] sm:text-xl">
              <bdi>{t('verify_extend_amount', { n })}</bdi>
            </p>
            {money ? <p className="mt-0.5 text-sm font-medium text-[hsl(38_92%_62%)]"><bdi>{t('verify_extend_equiv', { v: money })}</bdi></p> : null}
          </div>

          <p className="text-sm leading-[1.45rem] text-muted-foreground">{t('verify_extend_note')}</p>
          <p className="flex items-start gap-2.5 rounded-xl border border-border bg-[hsl(var(--sand))] px-3.5 py-2.5 text-xs leading-[1.15rem] text-foreground/80">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
            <span className="min-w-0">{t('verify_extend_saved')}</span>
          </p>

          {needCredits ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4">
              <p className="text-sm font-medium leading-6 text-foreground break-words">{t('verify_resume_need_credits')}</p>
              <Button asChild className={FRAMED_ACTION}>
                <Link to="/credits"><Wallet className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t('verify_budget_add_credits')}</Link>
              </Button>
            </div>
          ) : null}
          <div className="grid gap-2.5">
            <Button type="button" className={GOLD_ACTION} disabled={busy || needCredits} onClick={onContinue}>
              {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('verify_extend_continue')}
            </Button>
            <Button type="button" variant="outline" className={FRAMED_ACTION} disabled={busy} onClick={onStop}>{t('verify_extend_stop')}</Button>
          </div>
          <p className="text-center text-2xs leading-5 text-muted-foreground">{t('verify_extend_consent', { n })}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The 100-credit maximum is reached: no further extension; what was found is kept. */
export function VerifyBudgetLimitCard({ maxBudget, onView }: { maxBudget: number; onView?: () => void }) {
  const { t, lang } = useLanguage();
  return (
    <section className="hm-invest-panel hm-invest-focus space-y-5 p-5 sm:p-7">
      <header className="space-y-1.5">
        <Eyebrow>{t('verify_budget_eyebrow')}</Eyebrow>
        <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold leading-tight text-foreground">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
            <ShieldCheck className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          </span>
          <span className="min-w-0 break-words">{t('verify_limit_title')}</span>
        </h2>
        <p className="text-sm font-semibold text-[hsl(var(--gold-ink))]">{t('verify_limit_max', { n: formatCreditAmount(maxBudget, lang) })}</p>
      </header>
      <p className="text-sm leading-6 text-muted-foreground">{t('verify_limit_body')}</p>
      {onView ? <Button type="button" className={GOLD_ACTION} onClick={onView}>{t('verify_limit_view')}</Button> : null}
    </section>
  );
}
