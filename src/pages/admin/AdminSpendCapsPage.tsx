import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, AlertTriangle, ShieldOff } from 'lucide-react';
import { getSpendCapStatus, updateSpendCaps } from '@/services/api';
import type { SpendCapStatus, SpendCapConfig } from '@/types/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const PROVIDERS = ['global', 'dataforseo', 'apify', 'zenrows', 'scrapingbee', 'brightdata', 'openai'] as const;

export default function AdminSpendCapsPage() {
  const [caps, setCaps] = useState<SpendCapStatus[]>([]);
  const [draft, setDraft] = useState<Partial<SpendCapConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getSpendCapStatus().then(data => {
      setCaps(data);
      const d: Partial<SpendCapConfig> = {};
      for (const c of data) {
        const k = c.provider.toLowerCase() as keyof SpendCapConfig;
        d[k] = c.cap_usd;
      }
      setDraft(d);
    }).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setSaving(true);
    try {
      await updateSpendCaps(draft);
      toast.success('Spend caps updated');
      load();
    } catch {
      toast.error('Failed to save caps');
    } finally {
      setSaving(false);
    }
  };

  const capFor = (p: string) => caps.find(c => c.provider.toLowerCase() === p);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Spend Caps</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monthly USD caps per provider. Warning at 80%, hard block at 100%.</p>
      </div>

      {/* Status bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Current Month Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-8" />) :
            caps.map(cap => (
              <div key={cap.provider} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="font-medium">{cap.provider}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-muted-foreground">${cap.spent_usd.toFixed(2)} / ${cap.cap_usd}</span>
                    {cap.blocked && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 gap-0.5">
                        <ShieldOff className="h-2.5 w-2.5" /> BLOCKED
                      </Badge>
                    )}
                    {!cap.blocked && cap.warning && (
                      <Badge variant="outline" className="text-[10px] px-1.5 gap-0.5 border-amber-400 text-amber-600">
                        <AlertTriangle className="h-2.5 w-2.5" /> WARNING
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all',
                      cap.blocked ? 'bg-destructive' : cap.warning ? 'bg-amber-500' : 'bg-primary'
                    )}
                    style={{ width: `${Math.min(cap.pct, 100)}%` }}
                  />
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* Edit caps */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Edit Monthly Caps (USD)</CardTitle>
          <CardDescription className="text-xs">
            Set to a high value to effectively remove a cap. The GLOBAL cap applies across all providers combined.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12" />) :
            PROVIDERS.map(p => {
              const status = capFor(p);
              return (
                <div key={p}>
                  <Label className="text-xs font-medium uppercase">{p}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground w-5">$</span>
                    <Input
                      type="number" min={0} step={5}
                      value={draft[p as keyof SpendCapConfig] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [p]: Number(e.target.value) }))}
                      className="h-9 text-sm flex-1"
                    />
                    {status && (
                      <span className={cn('text-xs shrink-0', status.blocked ? 'text-destructive' : status.warning ? 'text-amber-600' : 'text-muted-foreground')}>
                        {status.pct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          <Button onClick={save} disabled={saving || loading} className="w-full gap-1.5 mt-2">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Spend Caps'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
