import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminMatches } from '@/services/api';
import { format } from 'date-fns';

const STRENGTH_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  EXCEPTIONAL: 'default', VERY_STRONG: 'default', STRONG: 'default',
  GOOD: 'secondary', POTENTIAL: 'outline',
};

export default function AdminMatchesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminMatches(200).then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">Matches</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{items.length} matches across all properties</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Property</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Owner</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Score</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Strength</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Price</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No matches</td></tr>
                ) : items.map(m => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap max-w-[160px]">
                      <div className="font-medium truncate text-xs">{m.properties?.title ?? m.property_id}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{m.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">{m.match_score ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STRENGTH_VARIANT[m.signal_strength] ?? 'outline'} className="text-[10px]">
                        {m.signal_strength ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={m.status === 'UNLOCKED' ? 'default' : 'outline'} className="text-[10px]">
                        {m.status ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {m.unlock_price_credits != null ? `$${Number(m.unlock_price_credits).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {m.created_at ? format(new Date(m.created_at), 'MMM d, HH:mm') : '—'}
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
