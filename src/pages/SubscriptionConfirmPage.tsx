import { CheckCircle2, FlaskConical, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { type CheckoutState, checkoutStatus } from '@/subscriptions/service';
import { invalidateEntitlementStatus } from '@/subscriptions/useEntitlementStatus';

/*
 * "CONFIRMING PAYMENT". The bank sends the customer here on success AND on failure; this page
 * believes neither. It asks the server (saas-checkout status, which also re-reads the bank when the
 * provider supports it) until the checkout is PAID or FAILED. Access exists only once the
 * verified provider event was applied on the server.
 */
const FINAL_FAIL = new Set(['FAILED', 'EXPIRED', 'CANCELLED', 'AMOUNT_MISMATCH']);
const POLL_MS = 3000;
const SLOW_AFTER_MS = 90_000;

function ConfirmContent() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const checkoutId = params.get('checkout') ?? '';
  const [state, setState] = useState<CheckoutState | null>(null);
  const [error, setError] = useState(false);
  const started = useRef(Date.now());
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!checkoutId) { setError(true); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const s = await checkoutStatus(checkoutId);
        if (!alive) return;
        setState(s);
        if (s.status === 'PAID') { invalidateEntitlementStatus(); return; }
        if (FINAL_FAIL.has(s.status) || s.status === 'SANDBOX_NO_GRANT') return;
      } catch {
        if (alive) setError(true);
        return;
      }
      if (Date.now() - started.current > SLOW_AFTER_MS) setSlow(true);
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [checkoutId]);

  const status = state?.status ?? null;
  return (
    <AppLayout>
      <div className="mx-auto max-w-xl space-y-5 px-1 py-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('sub_confirm_title')}</h1>
        {state?.sandbox ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" /> {t('sub_sandbox_label')}
          </p>
        ) : null}
        <div role="status" aria-live="polite" className="rounded-2xl border border-border bg-card p-5">
          {error ? (
            <p className="flex gap-2 text-sm"><XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />{t('sub_err_generic')}</p>
          ) : status === 'PAID' ? (
            <p className="flex gap-2 text-sm font-medium"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />{t('sub_confirm_paid')}</p>
          ) : status === 'SANDBOX_NO_GRANT' ? (
            <p className="flex gap-2 text-sm"><FlaskConical className="h-5 w-5 shrink-0" aria-hidden="true" />{t('sub_confirm_sandbox')}</p>
          ) : status && FINAL_FAIL.has(status) ? (
            <p className="flex gap-2 text-sm"><XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />{t('sub_confirm_failed')}</p>
          ) : (
            <p className="flex gap-2 text-sm">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {slow ? t('sub_confirm_slow') : t('sub_confirm_wait')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link to="/account/subscription">{t('sub_go_subscription')}</Link></Button>
          <Button asChild variant="outline"><Link to="/pricing">{t('sub_back_pricing')}</Link></Button>
        </div>
      </div>
    </AppLayout>
  );
}

export default function SubscriptionConfirmPage() {
  return <RouteGuard><ConfirmContent /></RouteGuard>;
}
