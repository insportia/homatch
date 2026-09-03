// OAuth / SSO callback — handles PKCE code exchange and hash-based implicit flow.
// After exchange, creates the users row if absent, then restores pending intent.
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { useLanguage } from '@/contexts/LanguageContext';

const PENDING_URL_KEY = 'homatch_pending_url';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      // ── Step 1: Exchange PKCE code if present in the URL ──────────────
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error('[auth/callback] PKCE exchange failed:', error.message);
        }
      }

      // ── Step 2: Get the resulting session ─────────────────────────────
      const { data: { session } } = await supabase.auth.getSession();

      if (!session || cancelled) {
        // Fallback: wait for onAuthStateChange (covers hash-based implicit flow)
        const { data: listener } = supabase.auth.onAuthStateChange(async (event, s) => {
          if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && s && !cancelled) {
            listener.subscription.unsubscribe();
            await ensureUserRow(s.user.id, s.user.email, s.user.user_metadata);
            redirect();
          }
        });

        // Timeout fallback after 8 s
        const t = setTimeout(() => {
          if (!cancelled) {
            listener.subscription.unsubscribe();
            navigate('/dashboard', { replace: true });
          }
        }, 8000);

        return () => {
          cancelled = true;
          clearTimeout(t);
          listener.subscription.unsubscribe();
        };
      }

      // ── Step 3: Session obtained — ensure row + redirect ──────────────
      await ensureUserRow(session.user.id, session.user.email, session.user.user_metadata);
      redirect();
    }

    async function ensureUserRow(
      authId: string,
      email: string | undefined,
      meta: Record<string, unknown>,
    ) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle();

      if (!existing) {
        await supabase.from('users').insert({
          auth_id: authId,
          email: email ?? null,
          full_name: (meta?.full_name ?? meta?.name ?? null) as string | null,
        });
      }
    }

    function redirect() {
      const pendingIntent = sessionStorage.getItem('homatch_pending_intent');
      const pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);
      sessionStorage.removeItem('homatch_pending_intent');

      if (pendingIntent === 'analyse' && pendingUrl) {
        sessionStorage.removeItem(PENDING_URL_KEY);
        navigate(`/property/import?url=${encodeURIComponent(pendingUrl)}`, { replace: true });
      } else if (pendingIntent === 'private') {
        navigate('/property/create', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }

    const cleanup = handleCallback();
    return () => {
      cancelled = true;
      cleanup.then(fn => fn?.());
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6">
      <HomatchLogo size="md" />
      <div className="flex flex-col items-center gap-3">
        <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">{t('auth_signing_in')}</p>
      </div>
    </div>
  );
}
