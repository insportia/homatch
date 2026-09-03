import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminPayments } from '@/services/api';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  COMPLETED: 'default', PENDING: 'secondary', FAILED: 'destructive', REFUNDED: 'outline',
};

export default function AdminPaymentsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminPayments(200).then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_payments_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_payments_subtitle', { count: items.length })}</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_user')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_amount')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_credits')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_provider')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_status')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_idempotency_key')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_payments_date')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('admin_payments_empty')}</td></tr>
                ) : items.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{p.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono font-medium">
                      ${Number(p.amount_usd ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">
                      {p.credits_granted != null ? Number(p.credits_granted).toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px]">{p.provider ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_VARIANT[p.status] ?? 'outline'} className="text-[10px]">{p.status ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px] block">{p.idempotency_key ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {p.created_at ? format(new Date(p.created_at), 'MMM d, yyyy HH:mm') : '—'}
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
