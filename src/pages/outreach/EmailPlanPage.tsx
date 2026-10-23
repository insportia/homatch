// EMAIL PLAN & USAGE — /outreach/email/plan
//
// What the account may send, read from my_email_plan (never computed in the browser):
// the current allowance (Free's 50 is lifetime; Pro and Scale reset each paid month),
// what has been used and what is reserved by sends in flight. Buying a month is an
// explicit, confirmed wallet charge; renewal is off until the customer turns it on;
// overage is off until the customer turns it on, with an optional cap. Prices include
// 18% VAT.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CreditCard, Gauge, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { PageHeader } from '@/components/communications/primitives';
import {
  type BillingEvent, type EmailPlanView, EmailMarketingError, getEmailPlan, listBillingEvents, purchasePlan, setAutoRenew, setOverage,
} from '@/services/emailMarketing';

const PURCHASE_ERR: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'emp_err_insufficient', ALREADY_ACTIVE: 'emp_err_already_active', PRODUCT_DISABLED: 'emp_err_unavailable',
};

export default function EmailPlanPage() {
  const { t, lang } = useLanguage();
  const [plan, setPlan] = useState<EmailPlanView | null>(null);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [buying, setBuying] = useState<'PRO' | 'SCALE' | null>(null);
  const [busy, setBusy] = useState(false);
  const [capInput, setCapInput] = useState('');
  const requestId = useRef<string>(crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      const p = await getEmailPlan();
      setPlan(p);
      setCapInput(p.overageMaxBlocks ? String(p.overageMaxBlocks) : '');
      setEvents(await listBillingEvents());
    } catch { toast.error(t('emp_load_failed')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(lang, { dateStyle: 'medium' }) : '—');
  const n = (v: number) => v.toLocaleString(lang);

  const buy = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      const r = await purchasePlan(buying, requestId.current, true);
      requestId.current = crypto.randomUUID();
      toast.success(t(r.duplicate ? 'emp_already_recorded' : 'emp_purchased'));
      await load();
    } catch (e) {
      const code = e instanceof EmailMarketingError ? e.code : '';
      toast.error(t(PURCHASE_ERR[code] ?? 'emp_purchase_failed'));
    } finally { setBusy(false); setBuying(null); }
  };
  const toggleRenew = async (enabled: boolean) => {
    setBusy(true);
    try { setPlan(await setAutoRenew(enabled, null)); toast.success(t(enabled ? 'emp_renew_on' : 'emp_renew_off')); }
    catch { toast.error(t('emp_update_failed')); } finally { setBusy(false); }
  };
  const toggleOverage = async (enabled: boolean) => {
    const cap = capInput.trim() ? Math.max(1, Math.min(1000, Math.floor(Number(capInput)))) : null;
    setBusy(true);
    try { setPlan(await setOverage(enabled, enabled ? cap : null)); toast.success(t(enabled ? 'emp_overage_on' : 'emp_overage_off')); }
    catch { toast.error(t('emp_update_failed')); } finally { setBusy(false); }
  };

  const period = plan?.period;
  const usedPct = period && period.included > 0 ? Math.min(100, ((period.used + period.reserved) / period.included) * 100) : 0;
  const buyingPlan = plan?.plans.find((p) => p.code === buying);

  return (
    <CommsWorkspace product="email" header={(
      <PageHeader
        eyebrow={t('dnav_email')}
        title={t('emp_title')}
        subtitle={t('emp_subtitle')}
        secondary={{ label: t('emx_refresh'), onClick: () => void load(), icon: RefreshCw }}
      />
    )}>
      {!plan || !period ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('emx_loading')}</div>
      ) : (
        <div className="space-y-5 pb-16">
          {/* ── current allowance ── */}
          <section className="rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="emp-current">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{t('emp_current')}</p>
                <h2 id="emp-current" className="text-2xl font-semibold">{t(`emp_plan_${period.kind === 'MONTHLY' ? plan.effectivePlan.toLowerCase() : 'free'}`)}</h2>
                <p className="text-2xs text-muted-foreground">
                  {period.kind === 'FREE_LIFETIME' ? t('emp_free_lifetime_note') : t('emp_period', { from: fmtDate(period.startsAt), to: fmtDate(period.endsAt) })}
                </p>
                {plan.status === 'LAPSED' && <p className="mt-1 text-2xs font-semibold text-[hsl(350_60%_40%)]">{t('emp_lapsed')}</p>}
              </div>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div><dd className="text-xl font-semibold tabular-nums">{n(period.remaining)}</dd><dt className="text-2xs text-muted-foreground">{t('emp_remaining')}</dt></div>
                <div><dd className="text-xl font-semibold tabular-nums">{n(period.used)}</dd><dt className="text-2xs text-muted-foreground">{t('emp_used')}</dt></div>
                <div><dd className="text-xl font-semibold tabular-nums">{n(period.included)}</dd><dt className="text-2xs text-muted-foreground">{t('emp_included')}</dt></div>
              </dl>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={period.included} aria-valuenow={period.used + period.reserved} aria-label={t('emp_used')}>
              <div className={cn('h-full rounded-full', usedPct >= 90 ? 'bg-[hsl(350_60%_50%)]' : 'bg-[hsl(38_92%_50%)]')} style={{ width: `${usedPct}%` }} />
            </div>
            {period.reserved > 0 && <p className="mt-1 text-2xs text-muted-foreground">{t('emp_reserved', { n: n(period.reserved) })}</p>}
            {period.kind === 'MONTHLY' && period.overageUsed > 0 && (
              <p className="mt-1 text-2xs text-muted-foreground">{t('emp_overage_used', { n: n(period.overageUsed), blocks: String(period.overageBlocksBilled) })}</p>
            )}
            <p className="mt-2 text-2xs text-muted-foreground">{t('emp_unit_note')}</p>
          </section>

          {/* ── plans ── */}
          <section aria-labelledby="emp-plans" className="space-y-3">
            <h2 id="emp-plans" className="text-base font-semibold">{t('emp_plans')}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {plan.plans.map((p) => {
                const current = (period.kind === 'MONTHLY' && plan.effectivePlan === p.code) || (period.kind === 'FREE_LIFETIME' && p.code === 'FREE');
                return (
                  <article key={p.code} className={cn('flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4', current && 'ring-2 ring-[hsl(38_92%_50%)]', p.code === 'SCALE' && 'bg-[linear-gradient(160deg,hsl(218_52%_11%),hsl(222_46%_20%))] text-white')}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold">{t(`emp_plan_${p.code.toLowerCase()}`)}</h3>
                      {current && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(38_92%_50%)] px-2 py-0.5 text-2xs font-bold text-black"><Check className="h-3 w-3" aria-hidden="true" />{t('emp_current_badge')}</span>}
                    </div>
                    <p className="text-3xl font-semibold tabular-nums">
                      ${p.priceUsd.toFixed(0)}
                      <span className={cn('ms-1 text-sm font-normal', p.code === 'SCALE' ? 'text-white/70' : 'text-muted-foreground')}>{p.period === 'MONTH' ? t('emp_per_month') : t('emp_once')}</span>
                    </p>
                    <p className="text-sm">{t(p.period === 'MONTH' ? 'emp_emails_month' : 'emp_emails_lifetime', { n: n(p.includedEmails) })}</p>
                    <p className={cn('text-2xs', p.code === 'SCALE' ? 'text-white/70' : 'text-muted-foreground')}>{t('emp_vat_included')}</p>
                    {p.code !== 'FREE' && (
                      <Button className="mt-auto h-auto min-h-10 whitespace-normal py-2 text-center leading-snug" variant={p.code === 'SCALE' ? 'secondary' : 'default'} disabled={busy}
                        onClick={() => setBuying(p.code as 'PRO' | 'SCALE')}>
                        <CreditCard className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t(current ? 'emp_buy_next_month' : 'emp_choose', { credits: n(p.credits) })}
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="text-2xs text-muted-foreground">{t('emp_wallet_note')} <Link to="/credits" className="font-semibold underline">{t('emp_top_up')}</Link></p>
          </section>

          {/* ── renewal & overage consent ── */}
          <section className="grid gap-3 md:grid-cols-2" aria-label={t('emp_controls')}>
            <div className="space-y-2 rounded-2xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('emp_auto_renew')}</h3>
              <p className="text-2xs text-muted-foreground">{t('emp_auto_renew_note')}</p>
              <label className="flex items-start gap-2.5 text-sm leading-snug">
                <input type="checkbox" checked={plan.autoRenew} disabled={busy || period.kind !== 'MONTHLY'} onChange={(e) => void toggleRenew(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[hsl(38_92%_50%)]" />
                <span>{t(plan.autoRenew ? 'emp_auto_renew_enabled' : 'emp_auto_renew_disabled')}</span>
              </label>
              {period.kind === 'MONTHLY' && plan.autoRenew && <p className="text-2xs text-muted-foreground">{t('emp_next_renewal', { date: fmtDate(period.endsAt) })}</p>}
            </div>
            <div className="space-y-2 rounded-2xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" aria-hidden="true" />{t('emp_overage')}</h3>
              <p className="text-2xs text-muted-foreground">{t('emp_overage_note', { price: plan.overagePricePer1kUsd.toFixed(2) })}</p>
              <label className="flex flex-wrap items-center justify-between gap-2 text-2xs">
                <span className="min-w-0 flex-1">{t('emp_overage_cap')}</span>
                <input type="number" min={1} max={1000} value={capInput} onChange={(e) => setCapInput(e.target.value)} disabled={busy}
                  className="h-9 w-24 shrink-0 rounded-lg bg-background px-2 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" aria-describedby="emp-cap-hint" />
              </label>
              <p id="emp-cap-hint" className="text-2xs text-muted-foreground">{t('emp_overage_cap_hint')}</p>
              <label className="flex items-start gap-2.5 text-sm leading-snug">
                <input type="checkbox" checked={plan.overageEnabled} disabled={busy || period.kind !== 'MONTHLY'} onChange={(e) => void toggleOverage(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[hsl(38_92%_50%)]" />
                <span>{t('emp_overage_consent')}</span>
              </label>
              {plan.overageConsentedAt && <p className="flex items-center gap-1 text-2xs text-[hsl(158_64%_28%)]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('emp_overage_consented', { date: fmtDate(plan.overageConsentedAt) })}</p>}
              {period.kind !== 'MONTHLY' && <p className="text-2xs text-muted-foreground">{t('emp_paid_only')}</p>}
            </div>
          </section>

          {/* ── billing history ── */}
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="emp-history">
            <h2 id="emp-history" className="mb-2 text-sm font-semibold">{t('emp_history')}</h2>
            {events.length === 0 ? <p className="text-2xs text-muted-foreground">{t('emp_history_empty')}</p> : (
              <ul className="divide-y divide-border text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{t(`emp_event_${e.kind.toLowerCase()}`)}{e.plan_code ? ` · ${t(`emp_plan_${e.plan_code.toLowerCase()}`)}` : ''}{e.blocks ? ` · ${t('emp_blocks', { n: String(e.blocks) })}` : ''}</span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">${Number(e.gross_usd).toFixed(2)} · {n(Number(e.credits))} {t('cost_credits')} · {fmtDate(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <AlertDialog open={buying !== null} onOpenChange={(o) => { if (!o) setBuying(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('emp_confirm_title', { plan: buying ? t(`emp_plan_${buying.toLowerCase()}`) : '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {buyingPlan ? t('emp_confirm_body', { price: buyingPlan.priceUsd.toFixed(2), credits: n(buyingPlan.credits), emails: n(buyingPlan.includedEmails) }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void buy()} disabled={busy}>{t('emp_confirm_pay')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}
