// The broker's recent notifications — their own rows (RLS), newest first, each
// opening where it points. The full inbox stays at /notifications.
import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';

interface Row { id: string; title: string; body: string | null; created_at: string; read: boolean; deep_link: string | null }

export function NotificationsPanel({ limit = 15 }: { limit?: number }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('notifications').select('id,title,body,created_at,read,deep_link')
      .order('created_at', { ascending: false }).limit(limit)
      .then(({ data }) => { if (live) setRows((data ?? []) as Row[]); });
    return () => { live = false; };
  }, [limit]);
  if (rows === null) return <Skeleton className="h-32 rounded-xl" />;
  return (
    <div className="space-y-2" data-broker-notifications>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t('broker_ws_no_notifications')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((n) => {
            const inner = (
              <div className="flex items-start gap-3 px-4 py-3">
                <Bell className={cn('mt-0.5 h-4 w-4 shrink-0', n.read ? 'text-muted-foreground' : 'text-[hsl(var(--gold-ink))]')} aria-hidden="true" />
                <div className="min-w-0">
                  <p className={cn('break-words text-sm', n.read ? 'text-muted-foreground' : 'font-semibold text-foreground')}>{n.title}</p>
                  {n.body && <p className="mt-0.5 break-words text-2xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-2xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              </div>
            );
            return <li key={n.id}>{n.deep_link?.startsWith('/') ? <Link to={n.deep_link} className="block hover:bg-secondary/40">{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
      <Link to="/notifications" className="inline-flex min-h-10 items-center text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline">
        {t('broker_ws_all_notifications')}
      </Link>
    </div>
  );
}
