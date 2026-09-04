import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { getAdminOutreachOverview } from '@/services/api';
import type { AdminOutreachOverview } from '@/services/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const CHANNEL_ICON: Record<string, React.ElementType> = { EMAIL: Mail, SMS: MessageSquare, AI_CALL: Phone };
const CHANNEL_LABEL_KEY: Record<string, string> = {
  EMAIL: 'admin_outreach_channel_email',
  SMS: 'admin_outreach_channel_sms',
  AI_CALL: 'admin_outreach_channel_call',
};
const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  RUNNING: 'default', DRAFT: 'outline', READY: 'secondary', PAUSED: 'secondary', COMPLETED: 'outline', CANCELLED: 'destructive',
};

export default function AdminOutreachPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<AdminOutreachOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminOutreachOverview(100).then(setData).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_outreach_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_outreach_subtitle')}</p>
      </div>

      {/* Per-channel breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {loading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />) :
          (data?.channels ?? []).map((c) => {
            const Icon = CHANNEL_ICON[c.channel];
            const rate = c.sent > 0 ? Math.round((c.success / c.sent) * 100) : null;
            return (
              <Card key={c.channel}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {t(CHANNEL_LABEL_KEY[c.channel])}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold">{c.sent}</span>
                    <span className="text-xs text-muted-foreground">{t('admin_outreach_sent')}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn(rate === null ? 'text-muted-foreground' : rate >= 90 ? 'text-green-600' : rate >= 60 ? 'text-amber-600' : 'text-destructive')}>
                      {rate === null ? '—' : `${rate}% ${t('admin_outreach_success_rate')}`}
                    </span>
                    <span className="text-muted-foreground">{c.failed} {t('admin_outreach_failed')}</span>
                  </div>
                  <div className="text-xs text-muted-foreground border-t border-border pt-1.5 mt-1.5">
                    ${c.cost_usd.toFixed(2)} {t('admin_outreach_spent')}
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* Recent campaigns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('admin_outreach_recent_campaigns')}</CardTitle>
          <CardDescription>{t('admin_outreach_recent_campaigns_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_name')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_owner')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_type')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_status')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_sent')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_cost')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_outreach_col_created')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : (data?.recent_campaigns.length ?? 0) === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('admin_outreach_empty')}</td></tr>
                ) : data!.recent_campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap font-medium truncate max-w-[200px]">{c.name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{c.owner_email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">{c.campaign_type}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_COLOR[c.status] ?? 'outline'} className="text-[10px]">{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">{c.sent_count}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">${c.cost_actual_usd.toFixed(2)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {c.created_at ? format(new Date(c.created_at), 'MMM d, yyyy') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
