import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Zap } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const PENDING_URL_KEY = 'homatch_pending_url';

export default function SignupPage() {
  const { signUp, signInWithGoogle, session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get('intent');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Preserve intent through OAuth redirect
  useEffect(() => {
    if (intent) sessionStorage.setItem('homatch_pending_intent', intent);
  }, [intent]);

  useEffect(() => {
    if (!session) return;
    const pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);
    const pendingIntent = sessionStorage.getItem('homatch_pending_intent') ?? intent;
    if (pendingIntent === 'analyse' && pendingUrl) {
      sessionStorage.removeItem(PENDING_URL_KEY);
      sessionStorage.removeItem('homatch_pending_intent');
      navigate(`/property/import?url=${encodeURIComponent(pendingUrl)}`);
    } else if (pendingIntent === 'private') {
      sessionStorage.removeItem('homatch_pending_intent');
      navigate('/property/create');
    } else {
      navigate('/dashboard', { replace: true });
    }
  }, [session, intent, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, fullName || undefined);
    setLoading(false);
    if (error) {
      toast.error(error);
    } else {
      toast.success('Account created! Welcome to Homatch.');
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast.error(error);
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Left panel */}
      <div className="hidden md:flex md:w-1/2 bg-card border-r border-border flex-col justify-between p-10 relative overflow-hidden">
        <div className="amber-glow absolute inset-0 pointer-events-none" />
        <Link to="/" className="relative z-10 w-fit">
          <HomatchLogo size="md" />
        </Link>
        <div className="relative z-10 space-y-4">
          <h2 className="text-2xl font-semibold text-foreground text-balance">
            {t('auth_signup_hero_title1')} <span className="text-primary">{t('auth_signup_hero_title2')}</span>
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm text-pretty">
            {t('auth_signup_hero_desc')}
          </p>
        </div>
        <p className="text-xs text-muted-foreground/40 relative z-10">
          © {new Date().getFullYear()} Homatch
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border md:border-0">
          <Link to="/" className="md:hidden"><HomatchLogo size="sm" /></Link>
          <div className="ml-auto"><LanguageSwitcher /></div>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-[calc(100%-2rem)] md:max-w-sm space-y-6">
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold text-foreground">{t('auth_signup')}</h1>
              {intent === 'analyse' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-xs text-primary">{t('auth_analysing_after')}</p>
                </div>
              )}
            </div>

            {/* Google Sign-Up */}
            <Button
              type="button"
              variant="ghost"
              onClick={handleGoogle}
              disabled={googleLoading || loading}
              className="w-full h-10 border border-border bg-secondary hover:bg-secondary/80 text-foreground font-medium gap-2.5 text-sm"
            >
              {googleLoading ? (
                <span className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              ) : <GoogleIcon />}
              {t('auth_continue_google')}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{t('auth_or_email')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="space-y-1.5">
                <Label htmlFor="fullname" className="text-sm font-medium">
                  {t('auth_full_name')}{' '}
                  <span className="text-muted-foreground font-normal">({t('form_optional')})</span>
                </Label>
                <Input
                  id="fullname"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder={t('auth_fullname_ph')}
                  autoComplete="name"
                  className="bg-secondary border-border h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium">{t('auth_email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('auth_email_ph')}
                  required
                  autoComplete="email"
                  className="bg-secondary border-border h-10"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium">{t('auth_password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="new-password"
                    className="bg-secondary border-border h-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground`}
                    aria-label={showPw ? t('auth_hide_password') : t('auth_show_password')}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || googleLoading || !email || !password}
                className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    {t('general_loading')}
                  </span>
                ) : t('auth_signup_btn')}
              </Button>

              <p className="text-xs text-muted-foreground/60 text-center">{t('auth_terms')}</p>
            </form>

            <p className="text-sm text-center text-muted-foreground">
              {t('auth_have_account')}{' '}
              <Link
                to={`/auth/login${intent ? `?intent=${intent}` : ''}`}
                className="text-primary hover:underline font-medium"
              >
                {t('auth_signin')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
