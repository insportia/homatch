import React, { useEffect, useState } from 'react';
import { Eye, X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/db/supabase';
import { ImpersonationBanner } from '@/types/types';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

interface StoredSession {
  session_id: string;
  target_user: { id: string; email: string; full_name?: string };
  banner: ImpersonationBanner;
  started_at: string;
}

/**
 * ImpersonationBannerBar
 * Reads sessionStorage for an active impersonation session.
 * Renders a persistent top banner with Exit button.
 * On exit → calls impersonate-user EF with action:"end", clears session, redirects admin back to /admin.
 */
export function ImpersonationBannerBar() {
  const { t } = useLanguage();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('impersonation_session');
    if (raw) {
      try { setSession(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, []);

  if (!session) return null;

  const handleExit = async () => {
    setExiting(true);
    try {
      const { error } = await supabase.functions.invoke('impersonate-user', {
        body: { action: 'end', session_id: session.session_id },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      sessionStorage.removeItem('impersonation_session');
      toast.success(t('admin_impersonation_ended_toast'));
      window.location.href = '/admin/user360';
    } catch (err) {
      toast.error(t('admin_impersonation_end_failed_toast'));
      console.error(err);
      setExiting(false);
    }
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-amber-950 px-4 py-2 flex items-center gap-3 shadow-lg">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold uppercase tracking-wide me-2">{t('admin_impersonation_active')}</span>
        <span className="text-xs truncate">
          {t('admin_impersonation_viewing_as')} {session.target_user.full_name ?? session.target_user.email}
          {session.banner.reason ? ` · ${t('admin_impersonation_reason', { reason: session.banner.reason })}` : ''}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 h-7 text-amber-950 hover:bg-amber-600/30 border border-amber-700/40 gap-1.5 text-xs"
        onClick={handleExit}
        disabled={exiting}
      >
        {exiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        {t('admin_impersonation_exit')}
      </Button>
    </div>
  );
}
