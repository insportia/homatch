import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import { getAdminProperties } from '@/services/api';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

export default function AdminPropertiesPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    getAdminProperties(200).then(setItems).finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(p =>
    !q || p.title?.toLowerCase().includes(q.toLowerCase()) ||
    p.users?.email?.toLowerCase().includes(q.toLowerCase()) ||
    p.property_facts?.city?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_properties_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_properties_subtitle', { count: items.length })}</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input className="pl-9" placeholder={t('admin_properties_search_placeholder')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_campaigns_property')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_properties_owner')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('matches_city')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_properties_type')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_properties_source')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_properties_created')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('admin_properties_empty')}</td></tr>
                ) : filtered.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap max-w-[200px]">
                      <div className="font-medium truncate">{p.title ?? '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{p.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {[p.property_facts?.city, p.property_facts?.country_code].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px]">{p.property_facts?.property_type ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="secondary" className="text-[10px]">{p.source_type ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {p.created_at ? format(new Date(p.created_at), 'MMM d, yyyy') : '—'}
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
