import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, MinusCircle } from 'lucide-react';
import { getProviderHealth, getProviderCostBreakdown } from '@/services/api';
import type { ProviderHealth, AdminProviderCostRow } from '@/types/types';
import { format } from 'date-fns';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';

const STATUS_CONFIG = {
  NOT_CONFIGURED:      { label: 'Not Configured',       color: 'bg-muted text-muted-foreground',              icon: MinusCircle },
  MOCK:                { label: 'Mock (Dev Only)',        color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400', icon: AlertTriangle },
  CONFIGURED_UNVERIFIED: { label: 'Configured — Not Tested', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400', icon: Clock },
  REAL_TEST_PASSED:    { label: 'Real — Test Passed',    color: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400', icon: CheckCircle2 },
  ERROR:               { label: 'Error',                  color: 'bg-destructive/10 text-destructive',           icon: XCircle },
};

export default function AdminProvidersPage() {
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [costs, setCosts] = useState<AdminProviderCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getProviderHealth(), getProviderCostBreakdown()])
      .then(([h, c]) => { setHealth(h); setCosts(c); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const runProviderTest = async (provider: string) => {
    setTesting(provider);
    try {
      const { data, error } = await supabase.functions.invoke('provider-health-check', {
        body: { provider },
      });
      if (error) throw error;
      toast.success(`${provider}: ${data?.status ?? 'tested'}`);
      load();
    } catch (e: any) {
      toast.error(`Test failed: ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const costByProvider: Record<string, AdminProviderCostRow> = {};
  for (const c of costs) costByProvider[c.provider] = c;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Provider Health</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Status, latency, and costs per provider. Mock ≠ Real.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />) :
          health.map(h => {
            const cfg = STATUS_CONFIG[h.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.NOT_CONFIGURED;
            const Icon = cfg.icon;
            const cost = costByProvider[h.provider];
            const successRate = h.success_count + h.failure_count > 0
              ? Math.round((h.success_count / (h.success_count + h.failure_count)) * 100) : null;
            return (
              <Card key={h.provider} className="shadow-sm">
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">{h.provider}</CardTitle>
                    <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                      <Icon className="h-3 w-3 shrink-0" />
                      <span>{cfg.label}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-4 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Latency</p>
                      <p className="font-medium">{h.latency_ms != null ? `${h.latency_ms}ms` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Success</p>
                      <p className="font-medium">{successRate != null ? `${successRate}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Cost (MTD)</p>
                      <p className="font-medium">{cost ? `$${cost.total_cost_usd.toFixed(2)}` : '$0.00'}</p>
                    </div>
                  </div>
                  {h.last_error && (
                    <p className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={h.last_error}>
                      {h.last_error}
                    </p>
                  )}
                  {h.last_tested_at && (
                    <p className="text-[10px] text-muted-foreground">
                      Last tested: {format(new Date(h.last_tested_at), 'MMM d, HH:mm')}
                    </p>
                  )}
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 mt-1" disabled={testing === h.provider}
                    onClick={() => runProviderTest(h.provider)}>
                    {testing === h.provider ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Run Test
                  </Button>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
