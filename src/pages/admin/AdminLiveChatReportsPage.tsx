import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquareWarning, EyeOff, UserX, Check } from 'lucide-react';
import { getLiveChatReports, dismissLiveChatReport, hideLiveChatMessage, suspendLiveChatUser } from '@/services/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  DISMISSED: 'bg-muted text-muted-foreground',
  HIDDEN: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  USER_SUSPENDED: 'bg-destructive/10 text-destructive',
};

const STATUS_KEYS: Record<string, string> = {
  PENDING: 'admin_livechat_status_pending',
  DISMISSED: 'admin_livechat_status_dismissed',
  HIDDEN: 'admin_livechat_status_hidden',
  USER_SUSPENDED: 'admin_livechat_status_suspended',
};

export default function AdminLiveChatReportsPage() {
  const { t } = useLanguage();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = () => { setLoading(true); getLiveChatReports().then(setReports).finally(() => setLoading(false)); };
  useEffect(load, []);

  const act = async (fn: () => Promise<void>, id: string) => {
    setActing(id);
    try { await fn(); toast.success('Updated'); load(); } catch (e: any) { toast.error(e?.message ?? 'Action failed'); } finally { setActing(null); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><MessageSquareWarning className="h-5 w-5" /> {t('admin_livechat_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_livechat_subtitle')}</p>
      </div>

      {loading ? (
        Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t('admin_livechat_empty')}</p>
      ) : (
        <div className="space-y-3">
          {reports.map(r => {
            const msg = r.live_chat_messages;
            return (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge className={STATUS_COLOR[r.status] ?? STATUS_COLOR.PENDING}>{STATUS_KEYS[r.status] ? t(STATUS_KEYS[r.status]) : r.status}</Badge>
                    <span className="text-[11px] text-muted-foreground">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('admin_livechat_reason_label')} <span className="text-foreground">{r.reason}</span></p>
                  {msg && (
                    <div className="rounded-lg border border-border p-2.5 text-sm bg-secondary/40">
                      {msg.deleted_at ? <span className="italic text-muted-foreground">{t('admin_livechat_message_deleted')}</span> : msg.hidden_by_admin ? <span className="italic text-muted-foreground">{t('admin_livechat_already_hidden')}</span> : msg.body}
                    </div>
                  )}
                  {r.status === 'PENDING' && msg && (
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={acting === r.id} onClick={() => act(() => dismissLiveChatReport(r.id), r.id)}>
                        <Check className="h-3.5 w-3.5" /> {t('admin_livechat_dismiss')}
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={acting === r.id} onClick={() => act(() => hideLiveChatMessage(msg.id, r.id, r.reason), r.id)}>
                        <EyeOff className="h-3.5 w-3.5" /> {t('admin_livechat_hide_message')}
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1.5 text-xs" disabled={acting === r.id} onClick={() => act(() => suspendLiveChatUser(msg.user_id, r.id, r.reason), r.id)}>
                        <UserX className="h-3.5 w-3.5" /> {t('admin_livechat_suspend_user')}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
