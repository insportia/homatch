import { FlaskConical, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { completeSandbox } from '@/subscriptions/service';

/*
 * The SANDBOX provider's "bank page". Labelled on every line, admin-only on the server
 * (saas-checkout sandbox-complete), and its signed events never grant a subscription in
 * production (saas_payment_event_apply). It exists to exercise the real webhook path end to end.
 */
function SandboxContent() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const checkoutId = params.get('checkout') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function go(outcome: 'success' | 'fail') {
    setBusy(true);
    setError(false);
    try {
      await completeSandbox(checkoutId, outcome);
      navigate(`/subscription/confirm?checkout=${encodeURIComponent(checkoutId)}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-xl space-y-5 px-1 py-6">
        <p className="flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-500/10 px-3 py-3 text-sm font-bold uppercase">
          <FlaskConical className="h-5 w-5 shrink-0" aria-hidden="true" /> {t('sub_sandbox_label')}
        </p>
        <p className="text-sm text-muted-foreground">{t('sub_confirm_sandbox')}</p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || !checkoutId} onClick={() => void go('success')}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('sub_sandbox_pay')}
          </Button>
          <Button variant="outline" disabled={busy || !checkoutId} onClick={() => void go('fail')}>{t('sub_sandbox_fail')}</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{t('sub_err_generic')}</p> : null}
      </div>
    </AppLayout>
  );
}

export default function SubscriptionSandboxPayPage() {
  return <RouteGuard><SandboxContent /></RouteGuard>;
}
