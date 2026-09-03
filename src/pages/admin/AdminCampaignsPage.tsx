import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminCampaigns } from '@/services/api';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default', PAUSED: 'secondary', DRAFT: 'outline', COMPLETED: 'outline',
};

const STATUS_KEYS: Record<string, string> = {
  ACTIVE: 'admin_campaigns_status_active',
  PAUSED: 'admin_campaigns_status_paused',
  DRAFT: 'admin_campaigns_status_draft',
  COMPLETED: 'admin_campaigns_status_completed',
};

export default function AdminCampaignsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminCampaigns(200).then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_campaigns_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_campaigns_subtitle', { count: items.length })}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_property')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_owner')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_status')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_budget')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_started')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t('admin_campaigns_empty')}</td></tr>
                ) : items.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-medium truncate max-w-[160px]">{c.properties?.title ?? c.property_id}</div>
                      <div className="text-xs text-muted-foreground">{c.properties?.property_facts?.city ?? ''}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{c.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_COLOR[c.status] ?? 'outline'} className="text-[10px]">{STATUS_KEYS[c.status] ? t(STATUS_KEYS[c.status]) : c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {c.monthly_budget_credits != null ? `$${Number(c.monthly_budget_credits).toFixed(0)}/mo` : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {c.started_at ? format(new Date(c.started_at), 'MMM d, yyyy') : '—'}
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
