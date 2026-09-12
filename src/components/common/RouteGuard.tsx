import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface RouteGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export function RouteGuard({ children, requireAuth = true }: RouteGuardProps) {
  const { session, loading, homatchUser, refreshUser, signOut } = useAuth();
  const location = useLocation();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground text-sm">{t('general_loading')}</span>
        </div>
      </div>
    );
  }

  if (requireAuth && !session) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  /*
   * SIGNED IN, BUT NO PROFILE.
   *
   * Almost every screen behind this guard begins its data fetch with
   * `if (!homatchUser) return;` — and then sets `loading` to false in the
   * fetch's `finally`. So when the profile never arrives, the fetch never
   * starts, the finally never runs, and the page sits on a skeleton
   * forever: no content, no empty state, no error, no way out. Measured
   * on the notifications and activity screens, which rendered their
   * heading and nothing else at every width.
   *
   * It happens to a real account whose profile row is missing or whose
   * read is refused, and patching it page by page would mean getting it
   * right in a dozen places and in every page added later. The guard
   * already owns 'we do not yet know who you are'; this is the same
   * question with a settled answer of nobody.
   *
   * `loading` is only false once the profile fetch has SETTLED, so
   * reaching this line genuinely means the answer came back empty.
   */
  if (requireAuth && session && !homatchUser) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-[1rem] border border-border bg-secondary">
          <UserX className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.015em]">{t('profile_missing_title')}</h1>
        <p className="measure text-base leading-relaxed text-ink-soft">{t('profile_missing_body')}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => { void refreshUser(); }}>{t('profile_missing_retry')}</Button>
          <Button variant="outline" onClick={() => { void signOut(); }}>{t('nav_logout')}</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
