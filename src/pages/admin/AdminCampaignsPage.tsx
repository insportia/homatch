import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminCampaigns } from '@/services/api';
import { format } from 'date-fns';

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default', PAUSED: 'secondary', DRAFT: 'outline', COMPLETED: 'outline',
};

export default function AdminCampaignsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminCampaigns(200).then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">Campaigns</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{items.length} matching campaigns</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Property</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Owner</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Budget</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Started</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No campaigns</td></tr>
                ) : items.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-medium truncate max-w-[160px]">{c.properties?.title ?? c.property_id}</div>
                      <div className="text-xs text-muted-foreground">{c.properties?.property_facts?.city ?? ''}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{c.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_COLOR[c.status] ?? 'outline'} className="text-[10px]">{c.status}</Badge>
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
