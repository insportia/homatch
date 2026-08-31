import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, Info, Percent } from 'lucide-react';
import { getPricingConfig, updatePricingConfig, getResearchProducts, updateResearchProduct, getVatRateBps, updateVatRateBps } from '@/services/api';
import type { PricingConfig, ResearchProduct } from '@/types/types';
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

  const [products, setProducts] = useState<ResearchProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [savingProduct, setSavingProduct] = useState<string | null>(null);
  const [vatBps, setVatBps] = useState(1800);
  const [vatDraft, setVatDraft] = useState(1800);
  const [savingVat, setSavingVat] = useState(false);

  useEffect(() => {
    getPricingConfig().then(c => { setCfg(c); setDraft(c); }).finally(() => setLoading(false));
    Promise.all([getResearchProducts(), getVatRateBps()]).then(([prods, bps]) => {
      setProducts(prods);
      setVatBps(bps);
      setVatDraft(bps);
    }).finally(() => setProductsLoading(false));
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

  const saveVat = async () => {
    setSavingVat(true);
    try {
      await updateVatRateBps(vatDraft);
      setVatBps(vatDraft);
      toast.success('VAT rate updated — applies to new payments only, historical payments keep their snapshot');
    } catch {
      toast.error('Failed to save VAT rate');
    } finally {
      setSavingVat(false);
    }
  };

  const toggleProductEnabled = async (code: string, enabled: boolean) => {
    setSavingProduct(code);
    try {
      await updateResearchProduct(code, { enabled });
      setProducts(prev => prev.map(p => (p.code === code ? { ...p, enabled } : p)));
    } catch {
      toast.error('Failed to update product');
    } finally {
      setSavingProduct(null);
    }
  };

  const updateProductPrice = async (code: string, priceCents: number) => {
    setSavingProduct(code);
    try {
      await updateResearchProduct(code, { price_cents: priceCents });
      setProducts(prev => prev.map(p => (p.code === code ? { ...p, price_cents: priceCents } : p)));
      toast.success('Price updated');
    } catch {
      toast.error('Failed to update price');
    } finally {
      setSavingProduct(null);
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5"><Percent className="h-4 w-4" /> VAT Rate</CardTitle>
          <CardDescription className="text-xs">Centrally-configurable VAT rate applied to new research-product purchases. Historical payments keep their own snapshot and are never recalculated.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number" min={0} max={5000} step={10}
              value={vatDraft}
              onChange={e => setVatDraft(Number(e.target.value))}
              className="h-9 text-sm w-32"
            />
            <span className="text-xs text-muted-foreground">basis points = {(vatDraft / 100).toFixed(2)}%</span>
          </div>
          <Button onClick={saveVat} disabled={savingVat || vatDraft === vatBps} size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {savingVat ? 'Saving…' : 'Save VAT Rate'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Research Products</CardTitle>
          <CardDescription className="text-xs">Fixed retail packages. Price is VAT-inclusive. Provider COGS is internal only — never shown to customers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {productsLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />) :
            products.map(p => (
              <div key={p.code} className="flex items-center gap-3 p-3 rounded-lg border border-border flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    COGS ${(p.reference_cogs_cents / 100).toFixed(2)} · Target contribution ${(p.target_contribution_cents / 100).toFixed(2)} · VAT {(p.vat_rate_bps / 100).toFixed(0)}%
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input
                    type="number" step={0.01} defaultValue={(p.price_cents / 100).toFixed(2)}
                    className="h-8 w-24 text-sm"
                    onBlur={e => {
                      const cents = Math.round(Number(e.target.value) * 100);
                      if (cents > 0 && cents !== p.price_cents) updateProductPrice(p.code, cents);
                    }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch checked={p.enabled} disabled={savingProduct === p.code} onCheckedChange={v => toggleProductEnabled(p.code, v)} />
                  <span className="text-xs text-muted-foreground">{p.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
