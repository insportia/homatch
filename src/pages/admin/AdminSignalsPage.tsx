import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { getAdminSignals } from '@/services/api';
import { format } from 'date-fns';

const STATUSES = ['ALL', 'PENDING', 'CLASSIFIED', 'REJECTED', 'NOISE'];
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  CLASSIFIED: 'default', PENDING: 'secondary', REJECTED: 'destructive', NOISE: 'outline',
};

export default function AdminSignalsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('ALL');

  useEffect(() => {
    setLoading(true);
    getAdminSignals(100, 0, status === 'ALL' ? undefined : status)
      .then(setItems).finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">Signals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Raw signals collected from all sources</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <Button key={s} variant={status === s ? 'default' : 'outline'} size="sm"
            className="text-xs" onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Excerpt</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Platform</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Lang</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Discovered</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No signals found</td></tr>
                ) : items.map(s => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 max-w-[300px]">
                      <p className="text-xs truncate">{s.raw_text?.slice(0, 120) ?? '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px]">{s.platform ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{s.language ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_VARIANT[s.classification_status] ?? 'outline'} className="text-[10px]">
                        {s.classification_status ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {s.discovered_at ? format(new Date(s.discovered_at), 'MMM d, HH:mm') : '—'}
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
