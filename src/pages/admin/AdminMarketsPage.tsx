import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';

export default function AdminMarketsPage() {
  const [markets, setMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.from('markets').select('*').order('country_name').then(({ data }) => {
      setMarkets(data ?? []);
      setLoading(false);
    });
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    setMarkets(m => m.map(x => x.id === id ? { ...x, enabled } : x));
    const { error } = await supabase.from('markets').update({ enabled }).eq('id', id);
    if (error) {
      toast.error('Failed to update market');
      setMarkets(m => m.map(x => x.id === id ? { ...x, enabled: !enabled } : x));
    } else {
      toast.success(`Market ${enabled ? 'enabled' : 'disabled'}`);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Markets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Enable or disable markets</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Country</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Code</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Currency</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Priority</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : markets.map(m => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap font-medium">{m.country_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{m.country_code}</Badge></td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{m.default_currency ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{m.launch_priority ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Switch checked={!!m.enabled} onCheckedChange={v => toggle(m.id, v)} />
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
