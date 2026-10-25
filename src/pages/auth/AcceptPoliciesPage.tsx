import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { PolicyAcceptanceCheckbox } from '@/components/legal/PolicyAcceptanceCheckbox';
import { POLICIES_ACCEPTED_EVENT } from '@/components/legal/PolicyAcceptanceGate';
import { acceptCurrentPolicies, fetchPolicyStatus } from '@/lib/legal/policies';
import { takePendingPath } from '@/services/returnTo';
import { toast } from 'sonner';

/*
 * Where an account that owes an acceptance is held: a Google sign-up that
 * began without the signup page's tick, or an existing account after a
 * material policy change. Nothing else in the product opens until the box
 * is ticked; signing out is always available.
 */
export default function AcceptPoliciesPage() {
  useSurfaceTheme('light');
  const { session, supaUser, loading: authLoading, signOut } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState(false);
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!session) { navigate('/auth/login', { replace: true }); return; }
    // Opened directly by an account that owes nothing: move on.
    void fetchPolicyStatus().then((s) => {
      if (s && !s.required) navigate(takePendingPath() ?? '/dashboard', { replace: true });
    });
  }, [authLoading, session, navigate]);

  const isNew = supaUser?.created_at
    ? Date.now() - new Date(supaUser.created_at).getTime() < 24 * 60 * 60 * 1000
    : true;

  const handleContinue = async () => {
    if (!accepted) { setShowError(true); return; }
    setSaving(true);
    const r = await acceptCurrentPolicies(isNew ? 'onboarding' : 'reacceptance');
    setSaving(false);
    if (!r.ok) { toast.error(t('legal_accept_failed')); return; }
    window.dispatchEvent(new Event(POLICIES_ACCEPTED_EVENT));
    navigate(takePendingPath() ?? '/dashboard', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Link to="/"><HomatchLogo size="sm" /></Link>
        <LanguageSwitcher />
      </div>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">
              {isNew ? t('legal_accept_title_new') : t('legal_accept_title_updated')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isNew ? t('legal_accept_body_new') : t('legal_accept_body_updated')}
            </p>
          </div>
          <PolicyAcceptanceCheckbox checked={accepted} onChange={(v) => { setAccepted(v); if (v) setShowError(false); }} showError={showError} />
          <Button
            type="button"
            onClick={handleContinue}
            disabled={saving}
            className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {saving ? t('general_loading') : t('legal_accept_continue')}
          </Button>
          <button
            type="button"
            onClick={() => { void signOut(); navigate('/', { replace: true }); }}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            {t('legal_accept_sign_out')}
          </button>
        </div>
      </main>
    </div>
  );
}
