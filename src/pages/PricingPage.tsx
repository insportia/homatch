import { Clock, Gift, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeaderSpacer, PublicHeader } from '@/components/home/PublicHeader';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { usePublicNavLinks } from '@/site/publicNav';
import { PageBlocks } from '@/site/render/PageBlocks';
import { PlanCard } from '@/subscriptions/components';
import { getPlans, type PlanCode, type PlansResponse, SubscriptionError, startCheckout } from '@/subscriptions/service';
import { useEntitlementStatus } from '@/subscriptions/useEntitlementStatus';

/**
 * THE PRICING PAGE: THREE MONTHLY PLANS (owner decision 2026-10-29).
 *
 * Every price and every allowance comes from the server (saas_plans / saas_plan_entitlements via
 * saas-checkout `plans`), so an admin edit changes this page without a deploy. Prices are GEL,
 * VAT included.
 *
 * Choosing a plan creates a checkout on the server and sends the customer to the bank; access is
 * granted only when the bank's verified event arrives. Until a live bank is connected the page says
 * so plainly ("online payment activation pending") and offers no button that pretends to work.
 *
 * The Site Studio "pricing_intro" block is not rendered: its stored copy described the old
 * credits-only model. Anything else an admin added below still renders.
 */

const PAGE = 'mx-auto w-full max-w-[72rem] px-4 sm:px-8 lg:px-10';

const ERRORS: Record<string, string> = {
  ALREADY_ACTIVE: 'sub_err_already_active',
  USE_DOWNGRADE: 'sub_err_use_downgrade',
  NEXT_PERIOD_ALREADY_PAID: 'sub_err_next_paid',
  PAYMENTS_NOT_CONNECTED: 'sub_payments_pending_body',
  PROVIDER_NOT_CONFIGURED: 'sub_payments_pending_body',
};

export default function PricingPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  useSurfaceTheme('light');
  const headerLinks = usePublicNavLinks();
  const { status } = useEntitlementStatus();

  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState(false);

  useEffect(() => {
    let alive = true;
    getPlans()
      .then((p) => { if (alive) setPlans(p); })
      .catch(() => { if (alive) setPlans(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const currentPlan = status?.subscription?.hasAccess ? status.subscription.planCode : null;
  const currentTier = plans?.plans.find((p) => p.code === currentPlan)?.priorityTier ?? 0;
  const connected = plans?.paymentsConnected === true;

  async function choose(code: PlanCode) {
    if (!homatchUser) { navigate('/auth/signup?next=/pricing'); return; }
    setError(null);
    setBusy(code);
    try {
      const r = await startCheckout(code, { autoRenew: autoRenew && plans?.autoRenewAvailable === true });
      window.location.assign(r.redirectUrl);
    } catch (e) {
      const code2 = e instanceof SubscriptionError ? e.code : 'REQUEST_FAILED';
      setError(t(ERRORS[code2] ?? 'sub_err_generic'));
      setBusy(null);
    }
  }

  return (
    <div className="hm-public min-h-screen bg-background text-foreground">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main className={`${PAGE} py-10 sm:py-16`}>
        <header className="max-w-[48rem]">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t('sub_pricing_title')}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t('sub_pricing_sub')}</p>
        </header>

        {!loading && plans && !connected ? (
          <section role="status" className="mt-6 flex gap-3 rounded-xl border border-border bg-card p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-gold-ink" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{t('sub_payments_pending_title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('sub_payments_pending_body')}</p>
            </div>
          </section>
        ) : null}

        {loading ? (
          <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /></div>
        ) : !plans ? (
          <p className="mt-8 text-sm text-muted-foreground" role="alert">{t('sub_err_generic')}</p>
        ) : (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {plans.plans.map((p) => {
                const isCurrent = currentPlan === p.code;
                const lower = currentPlan !== null && p.priorityTier < currentTier;
                return (
                  <PlanCard
                    key={p.code}
                    plan={p}
                    current={isCurrent}
                    highlight={p.code === 'VIP'}
                    action={
                      !homatchUser ? (
                        <Button className="h-11 w-full" onClick={() => navigate('/auth/signup?next=/pricing')}>{t('sub_signin_to_subscribe')}</Button>
                      ) : isCurrent || lower ? (
                        <Button variant="outline" className="h-11 w-full" onClick={() => navigate('/account/subscription')}>{t('sub_go_subscription')}</Button>
                      ) : (
                        <Button
                          className="h-auto min-h-11 w-full whitespace-normal bg-gold text-primary hover:bg-gold-hover"
                          disabled={!connected || busy !== null}
                          onClick={() => void choose(p.code)}
                        >
                          {busy === p.code ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                          {busy === p.code ? t('sub_redirecting') : t('sub_choose', { plan: t(`sub_plan_${p.code}`) })}
                        </Button>
                      )
                    }
                  />
                );
              })}
            </div>
            {connected && plans.autoRenewAvailable && homatchUser ? (
              <label className="mt-4 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
                <span>{t('sub_auto_renew')}</span>
              </label>
            ) : null}
            {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
            {currentPlan ? <p className="mt-4 text-sm text-muted-foreground">{t('sub_upgrade_note')}</p> : null}
          </>
        )}

        <section className="mt-10 flex gap-3 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
          <Gift className="mt-0.5 h-5 w-5 shrink-0 text-gold-ink" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('sub_trials_title')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('sub_trials_body')}</p>
          </div>
        </section>
        <p className="mt-6 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{t('sub_extra_costs')}</p>
      </main>

      <PageBlocks slug="pricing" except={['pricing_intro']} />
      <SiteFooter />
    </div>
  );
}
