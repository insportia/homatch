import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, Info } from 'lucide-react';
import { getPricingConfig, updatePricingConfig } from '@/services/api';
import type { PricingConfig } from '@/types/types';
import { toast } from 'sonner';

type FieldDef = { key: keyof PricingConfig; label: string; hint: string; min: number; max: number; step: number };

const FIELDS: FieldDef[] = [
  { key: 'min_credits',             label: 'Min Price (credits)',       hint: 'No match priced below this',       min: 0.01, max: 5,    step: 0.01 },
  { key: 'max_credits',             label: 'Max Price (credits)',       hint: 'Hard ceiling on any unlock price', min: 1,    max: 50,   step: 0.5  },
  { key: 'base_potential',          label: 'Base — POTENTIAL',          hint: 'Lowest strength tier base',        min: 0.1,  max: 5,    step: 0.1  },
  { key: 'base_good',               label: 'Base — GOOD',               hint: '',                                 min: 0.1,  max: 10,   step: 0.1  },
  { key: 'base_strong',             label: 'Base — STRONG',             hint: '',                                 min: 0.5,  max: 15,   step: 0.25 },
  { key: 'base_very_strong',        label: 'Base — VERY_STRONG',        hint: '',                                 min: 1,    max: 20,   step: 0.25 },
  { key: 'base_exceptional',        label: 'Base — EXCEPTIONAL',        hint: 'Highest strength tier base',       min: 1,    max: 25,   step: 0.5  },
  { key: 'multiplier_recency',      label: 'Multiplier — Recency',      hint: 'Boost for signals < 24h old',      min: 1,    max: 3,    step: 0.05 },
  { key: 'multiplier_source_quality', label: 'Multiplier — Source Quality', hint: 'Boost for high-quality sources', min: 1, max: 3,    step: 0.05 },
  { key: 'multiplier_cogs',         label: 'Multiplier — COGS',         hint: 'COGS pass-through factor',         min: 1,    max: 2,    step: 0.05 },
];

export default function AdminPricingPage() {
  const [cfg, setCfg] = useState<PricingConfig | null>(null);
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPricingConfig().then(c => { setCfg(c); setDraft(c); }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await updatePricingConfig(draft);
      setCfg(draft);
      toast.success('Pricing config saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Pricing Config</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Server-side pricing engine settings. No qualified match can be free.</p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Engine Parameters</CardTitle>
          <CardDescription className="text-xs flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Changes take effect for new matches only. Existing unlocked matches are unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12" />) :
            draft && FIELDS.map(f => (
              <div key={f.key}>
                <Label className="text-xs font-medium">{f.label}</Label>
                {f.hint && <p className="text-[11px] text-muted-foreground mb-1">{f.hint}</p>}
                <Input
                  type="number"
                  min={f.min} max={f.max} step={f.step}
                  value={draft[f.key]}
                  onChange={e => setDraft(d => d ? { ...d, [f.key]: Number(e.target.value) } : d)}
                  className="h-9 text-sm"
                />
              </div>
            ))}
          <Button onClick={save} disabled={saving || loading} className="w-full gap-1.5 mt-2">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Pricing Config'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
