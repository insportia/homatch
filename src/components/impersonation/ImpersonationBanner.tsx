/*
 * "Viewing as <user>" — on every screen of a tab that is impersonating.
 *
 * Mounted once, at the root of the app, above both shells — so it is there on
 * the customer's dashboard, their chat, their properties, and on any admin
 * URL the tab wanders onto. It cannot be dismissed, only exited: a banner an
 * operator could close is a tab in which they forget whose account it is.
 *
 * Exit ends the session on the server from inside the impersonated session
 * (the minted token can do exactly that and nothing else), revokes it, then
 * clears this tab's marker and reloads into the admin's own, untouched login.
 * If the server call fails — an expired token, a dropped connection — the
 * tab still leaves, and the admin page it lands on ends the session by id.
 */
import { Eye, Loader2, LogOut } from 'lucide-react';
import React from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { clearImpersonation, readImpersonation } from '@/lib/impersonation';

export function ImpersonationBanner() {
  const { t } = useLanguage();
  const [state] = React.useState(() => (typeof window === 'undefined' ? null : readImpersonation()));
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  const [exiting, setExiting] = React.useState(false);

  React.useEffect(() => {
    if (!state) return;
    document.documentElement.setAttribute('data-impersonating', '');
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => {
      window.clearInterval(timer);
      document.documentElement.removeAttribute('data-impersonating');
    };
  }, [state]);

  const exit = React.useCallback(async () => {
    if (!state || exiting) return;
    setExiting(true);
    try {
      await supabase.functions.invoke('impersonate-user', { body: { action: 'end_self' } });
    } catch {
      /* Leaving matters more than the courtesy call; the admin page closes
         the row by id if this did not. */
    }
    clearImpersonation();
    window.location.assign(`/admin/user360?user=${encodeURIComponent(state.target_user.id)}&ended=${encodeURIComponent(state.session_id)}`);
  }, [state, exiting]);

  /* "Sign out" anywhere in the app means "stop viewing" in this tab. */
  React.useEffect(() => {
    const onExit = () => { void exit(); };
    window.addEventListener('homatch:impersonation-exit', onExit);
    return () => window.removeEventListener('homatch:impersonation-exit', onExit);
  }, [exit]);

  if (!state) return null;

  const name = state.target_user.full_name || state.target_user.email || state.target_user.id;
  const minutesLeft = Math.max(0, Math.ceil((state.expires_at - now) / 60));
  const expired = state.expires_at <= now;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="impersonation-banner"
      className="fixed inset-x-0 top-0 z-[10000] flex h-10 items-center gap-2 bg-amber-400 px-3 text-amber-950 shadow-md sm:px-4"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-xs sm:text-sm">
        <span className="font-semibold">{t('admin_imp_banner_viewing_as', { name })}</span>
        <span className="ms-2 hidden rounded bg-amber-950/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide sm:inline">
          {t('admin_imp_banner_read_only')}
        </span>
        <span className="ms-2 hidden text-2xs md:inline">
          {expired ? t('admin_imp_banner_expired') : t('admin_imp_banner_minutes_left', { minutes: minutesLeft })}
        </span>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => { void exit(); }}
        disabled={exiting}
        className="h-7 shrink-0 gap-1.5 border-amber-950/40 bg-amber-50/60 px-2.5 text-xs text-amber-950 hover:bg-amber-50"
      >
        {exiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LogOut className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />}
        {t('admin_imp_banner_exit')}
      </Button>
    </div>
  );
}
