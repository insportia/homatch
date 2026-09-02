// Password recovery landing page — reached only via the link Supabase Auth
// emails from resetPasswordForEmail(). Supabase's client automatically parses
// the recovery token out of the URL and fires a PASSWORD_RECOVERY auth event
// with a temporary session; this page waits for that, then lets the user set
// a new password via supabase.auth.updateUser({ password }).
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';

type Phase = 'waiting' | 'ready' | 'expired' | 'done';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();
  const { t, isRTL } = useLanguage();

  const [phase, setPhase] = useState<Phase>('waiting');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setPhase('ready');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) setPhase('ready');
    });

    const timeout = setTimeout(() => {
      if (!cancelled) setPhase(p => (p === 'waiting' ? 'expired' : p));
    }, 6000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error(t('reset_pw_too_short'));
      return;
    }
    if (password !== confirm) {
      toast.error(t('reset_pw_mismatch'));
      return;
    }
    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      toast.error(error);
      return;
    }
    setPhase('done');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4">
      <HomatchLogo size="md" />
      <div className="w-full max-w-sm">
        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">{t('reset_pw_waiting')}</p>
          </div>
        )}

        {phase === 'expired' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-foreground font-medium">{t('reset_pw_expired')}</p>
            <Button onClick={() => navigate('/auth/login')} className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {t('reset_pw_back_login')}
            </Button>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-400" />
            <p className="text-sm text-foreground font-medium">{t('reset_pw_success')}</p>
            <Button onClick={() => navigate('/dashboard')} className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90">
              {t('reset_pw_continue')}
            </Button>
          </div>
        )}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="space-y-1 text-center mb-2">
              <h1 className="text-lg font-semibold text-foreground">{t('reset_pw_title')}</h1>
              <p className="text-xs text-muted-foreground">{t('reset_pw_subtitle')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-sm">{t('reset_pw_new')}</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                  className="bg-secondary border-border h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground`}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-sm">{t('reset_pw_confirm')}</Label>
              <Input
                id="confirm-password"
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                className="bg-secondary border-border h-10"
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {submitting ? '…' : t('reset_pw_submit')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
