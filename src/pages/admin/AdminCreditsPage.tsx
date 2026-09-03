import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/db/supabase';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const TYPE_KEYS: Record<string, string> = {
  TOP_UP: 'credits_type_topup',
  MATCH_UNLOCK: 'credits_type_unlock',
};

export default function AdminCreditsPage() {
  const { t } = useLanguage();
  const [ledger, setLedger] = useState<any[]>([]);
  const [totals, setTotals] = useState({ purchased: 0, consumed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.from('credit_ledger')
      .select('*, users(email)')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        const rows = data ?? [];
        setLedger(rows);
        const purchased = rows.filter(r => r.type === 'TOP_UP').reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const consumed = rows.filter(r => r.type === 'MATCH_UNLOCK').reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
        setTotals({ purchased, consumed });
        setLoading(false);
      });
  }, []);

  const TYPE_ICON: Record<string, React.ElementType> = { TOP_UP: TrendingUp, MATCH_UNLOCK: TrendingDown };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_credits_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_credits_subtitle')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{t('admin_credits_total_topups')}</p>
            <p className="text-2xl font-bold">${totals.purchased.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{t('admin_credits_total_unlocks')}</p>
            <p className="text-2xl font-bold">${totals.consumed.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t('admin_credits_ledger_section')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_credits_user')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_credits_type')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_credits_amount')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_credits_date')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : ledger.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t('admin_credits_empty')}</td></tr>
                ) : ledger.map(e => {
                  const Icon = TYPE_ICON[e.type] ?? TrendingUp;
                  const isCredit = Number(e.amount) > 0;
                  return (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{e.users?.email ?? '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Badge variant="outline" className="text-[10px]">{TYPE_KEYS[e.type] ? t(TYPE_KEYS[e.type]) : e.type}</Badge>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 whitespace-nowrap text-xs font-mono font-medium ${isCredit ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                        {isCredit ? '+' : ''}{Number(e.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        {e.created_at ? format(new Date(e.created_at), 'MMM d, yyyy HH:mm') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
