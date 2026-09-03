import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Shield } from 'lucide-react';
import { getAdminUsers } from '@/services/api';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

export default function AdminUsersPage() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    getAdminUsers(200).then(setUsers).finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(u =>
    !q || u.email?.toLowerCase().includes(q.toLowerCase()) || u.full_name?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_users_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_users_subtitle', { count: users.length })}</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input className="pl-9" placeholder={t('admin_users_search_placeholder')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_credits_user')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_users_balance')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_users_role')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_users_joined')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t('admin_users_empty')}</td></tr>
                ) : filtered.map(u => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-medium truncate max-w-[200px]">{u.email}</div>
                      {u.full_name && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{u.full_name}</div>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {u.credit_accounts?.[0]?.balance != null ? `$${Number(u.credit_accounts[0].balance).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {u.is_admin
                        ? <Badge variant="default" className="gap-1 text-xs"><Shield className="h-3 w-3" />{t('admin_users_admin_badge')}</Badge>
                        : <Badge variant="outline" className="text-xs">{t('admin_users_customer_badge')}</Badge>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {u.created_at ? format(new Date(u.created_at), 'MMM d, yyyy') : '—'}
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
