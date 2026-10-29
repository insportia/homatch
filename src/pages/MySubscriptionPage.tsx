import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RouteGuard } from '@/components/common/RouteGuard';
import { PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { planLabel } from '@/subscriptions/components';
import {
  getPlans, type PlanCode, type PlansResponse,SubscriptionError, startCheckout, subscriptionAction, 
} from '@/subscriptions/service';
import { featureOf, useEntitlementStatus } from '@/subscriptions/useEntitlementStatus';

/*
 * MY SUBSCRIPTION: status, period, usage counters, upgrade / downgrade / cancel.
 * Every number is the server's (entitlement_status_for_me). Upgrades go through checkout and start
 * a new period at once; downgrades and cancellations take effect at the period end. HOMI and
 * internal search are unlimited, so no chat counter is shown anywhere.
 */
function SubscriptionContent() {
  const { t, lang } = useLanguage();
  const { status, loading, refresh } = useEntitlementStatus();
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => { getPlans().then(setPlans).catch(() => setPlans(null)); }, []);

  const locale = lang === 'ka' ? 'ka-GE' : lang;
  const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const sub = status?.subscription ?? null;
  const live = sub && sub.status !== 'EXPIRED' ? sub : null;
  const currentTier = plans?.plans.find((p) => p.code === live?.planCode)?.priorityTier ?? 0;
  const connected = plans?.paymentsConnected === true;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      const code = e instanceof SubscriptionError ? e.code : '';
      setMessage(t(code.includes('NEXT_PERIOD_ALREADY_PAID') ? 'sub_err_next_paid' : code.includes('PAYMENTS_NOT_CONNECTED') ? 'sub_payments_pending_body' : 'sub_err_generic'));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  }
  async function pay(code: PlanCode) {
    setBusy(`pay:${code}`);
    setMessage(null);
    try {
      const r = await startCheckout(code);
      window.location.assign(r.redirectUrl);
    } catch (e) {
      const c = e instanceof SubscriptionError ? e.code : '';
      setMessage(t(c === 'ALREADY_ACTIVE' ? 'sub_err_already_active' : c === 'PAYMENTS_NOT_CONNECTED' ? 'sub_payments_pending_body' : 'sub_err_generic'));
      setBusy(null);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHero compact title={t('sub_go_subscription')} subtitle={live ? planLabel(t, live.planCode) : t('sub_none')} />

        {loading && !status ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        ) : !status ? (
          <p role="alert" className="text-sm text-muted-foreground">{t('sub_err_generic')}</p>
        ) : (
          <>
            {live ? (
              <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{planLabel(t, live.planCode)}</h2>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${live.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
                    {t(`sub_status_${live.status}`)}
                  </span>
                </div>
                {live.status === 'ACTIVE' ? <p className="text-sm">{t('sub_active_note')}</p> : null}
                <p className="text-sm text-muted-foreground">{t('sub_period', { start: date(live.currentPeriodStart), end: date(live.currentPeriodEnd) })}</p>
                {live.status === 'PAST_DUE' && live.graceUntil ? <p className="text-sm font-medium">{t('sub_grace_until', { date: date(live.graceUntil) })}</p> : null}
                {live.cancelAtPeriodEnd ? <p className="text-sm">{t('sub_cancel_scheduled', { date: date(live.currentPeriodEnd) })}</p> : null}
                {live.pendingPlanCode ? <p className="text-sm">{t('sub_downgrade_scheduled', { plan: planLabel(t, live.pendingPlanCode), date: date(live.currentPeriodEnd) })}</p> : null}
                {live.nextPeriodPaid ? <p className="text-sm">{t('sub_next_paid')}</p> : !live.cancelAtPeriodEnd ? <p className="text-sm text-muted-foreground">{t('sub_renews_on', { date: date(live.currentPeriodEnd) })}</p> : null}

                <div className="flex flex-wrap gap-2 pt-2">
                  {!live.nextPeriodPaid && !live.cancelAtPeriodEnd && (live.status === 'PAST_DUE' || new Date(live.renewalOpensAt) <= new Date()) ? (
                    <Button disabled={!connected || busy !== null} onClick={() => void pay((live.pendingPlanCode ?? live.planCode) as PlanCode)}>{t('sub_pay_next')}</Button>
                  ) : null}
                  {live.cancelAtPeriodEnd ? (
                    <Button variant="outline" disabled={busy !== null} onClick={() => void run('uncancel', () => subscriptionAction('UNDO_CANCEL'))}>{t('sub_undo')}</Button>
                  ) : confirmCancel ? (
                    <div className="w-full rounded-lg border border-border p-3 text-sm">
                      <p>{t('sub_cancel_confirm', { date: date(live.currentPeriodEnd) })}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void run('cancel', () => subscriptionAction('CANCEL'))}>{t('sub_cancel')}</Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>{t('sub_undo')}</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" disabled={busy !== null || live.nextPeriodPaid} onClick={() => setConfirmCancel(true)}>{t('sub_cancel')}</Button>
                  )}
                  {live.pendingPlanCode ? (
                    <Button variant="outline" disabled={busy !== null} onClick={() => void run('undown', () => subscriptionAction('UNDO_DOWNGRADE'))}>{t('sub_undo')}</Button>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-border bg-card p-5">
                {/* An ended subscription is said as such; a first visit gets the first-use rule. */}
                <p className="text-sm">{sub?.status === 'EXPIRED' ? t('sub_expired_note') : t('sub_none')}</p>
                {sub?.status !== 'EXPIRED' ? <p className="mt-1 text-sm text-muted-foreground">{t('sub_first_free_detail')}</p> : null}
                <Button asChild className="mt-3 bg-gold text-primary hover:bg-gold-hover"><Link to="/pricing">{t('sub_see_plans')}</Link></Button>
              </section>
            )}

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold">{t('sub_usage_title')}</h2>
              <ul className="mt-3 divide-y divide-border">
                {(['VERIFY', 'CONTRACT_ANALYSIS'] as const).map((code) => {
                  const f = featureOf(status, code);
                  if (!f) return null;
                  return (
                    <li key={code} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                      <span className="font-medium">{t(`sub_feature_${code}`)}</span>
                      <span className="text-muted-foreground">
                        {f.included ? (f.unlimited ? t('sub_unlimited') : t('sub_used_of', { used: String(f.used), limit: String(f.limit ?? 0) })) : null}
                        {f.trialEnabled ? <span className="ms-2">{f.trialAvailable ? t('sub_trial_available') : f.trialState === 'CONSUMED' ? t('sub_trial_used') : ''}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {live && plans ? (
              <section className="space-y-2 rounded-2xl border border-border bg-card p-5">
                {plans.plans.filter((p) => p.code !== live.planCode).map((p) => (
                  p.priorityTier > currentTier ? (
                    <Button key={p.code} className="me-2" disabled={!connected || busy !== null} onClick={() => void pay(p.code)}>
                      {t('sub_upgrade', { plan: planLabel(t, p.code) })}
                    </Button>
                  ) : live.pendingPlanCode === p.code ? null : (
                    <Button key={p.code} variant="outline" className="me-2" disabled={busy !== null || live.nextPeriodPaid}
                      onClick={() => void run(`down:${p.code}`, () => subscriptionAction('DOWNGRADE', p.code))}>
                      {t('sub_downgrade_to', { plan: planLabel(t, p.code) })}
                    </Button>
                  )
                ))}
                <p className="text-xs text-muted-foreground">{t('sub_upgrade_note')}</p>
                {!connected ? <p className="text-xs text-muted-foreground">{t('sub_payments_unavailable')}</p> : null}
              </section>
            ) : null}

            {status.hasLegacyBalance ? (
              <section className="rounded-2xl border border-border bg-card p-5 text-sm">
                <p className="font-medium">{t('sub_legacy_balance', { credits: status.legacyBalance.toFixed(1) })}</p>
                <p className="mt-1 text-muted-foreground">{t('sub_legacy_note')}</p>
              </section>
            ) : null}
            {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
          </>
        )}
      </div>
    </AppLayout>
  );
}

export default function MySubscriptionPage() {
  return <RouteGuard><SubscriptionContent /></RouteGuard>;
}
