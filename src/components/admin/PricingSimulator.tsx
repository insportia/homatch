import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/db/supabase';
import { Calculator, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

/**
 * THE PRICING SIMULATOR (Admin only).
 *
 * "This allows us to verify the economics visually."
 *
 * It calls billing_simulate_pricing(), which runs the SAME markup-multiple and
 * margin-floor arithmetic the live charge uses. That matters more than it
 * sounds: a simulator with its own copy of the formula would eventually flatter
 * a price the real engine would never produce, and the operator would be
 * planning against a number that does not exist.
 *
 * Tax and fee overrides are passed as ARGUMENTS, so asking "what if VAT goes to
 * 20%" never means editing the live setting to find out.
 *
 * Everything on this screen is internal: landed cost, the profit pool, the
 * margin, the markup. It is admin-only in the database (the function checks
 * is_admin() itself) as well as behind AdminLayout, because a route guard is a
 * UI fact and this is a data question.
 */

const PRODUCTS = ['VERIFY', 'FIND_CLIENTS', 'CONTRACT_INTELLIGENCE', 'BROKER_FINDER'];

interface SimPlan {
  plan_code: string;
  plan_name: string;
  plan_price_before_floor_cents: number;
  floor_applied: boolean;
  final_price_cents: number;
  gross_profit_cents: number;
  gross_margin_bps: number;
  markup_bps: number;
  credits: number;
}
interface SimResult {
  product_code: string;
  landed_cogs_cents: number;
  standard_price_cents: number;
  base_profit_pool_cents: number;
  floor_price_cents: number;
  markup_multiple: number;
  inputs: Record<string, number>;
  plans: SimPlan[];
}

const c = (cents: number) => `$${(Number(cents) / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
const pct = (bps: number) => `${(Number(bps) / 100).toFixed(2)}%`;

export function PricingSimulator() {
  const { t } = useLanguage();
  const [product, setProduct] = useState('VERIFY');
  const [rawCents, setRawCents] = useState('10');
  const [aiCents, setAiCents] = useState('0');
  const [taxBps, setTaxBps] = useState('1800');
  const [feeBps, setFeeBps] = useState('0');
  const [retailCents, setRetailCents] = useState('');
  const [minMarginBps, setMinMarginBps] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('billing_simulate_pricing', {
      p_product_code: product,
      p_raw_provider_cents: Number(rawCents) || 0,
      p_ai_cents: Number(aiCents) || 0,
      p_tax_bps: taxBps === '' ? null : Number(taxBps),
      p_fee_bps: feeBps === '' ? null : Number(feeBps),
      p_standard_retail_cents: retailCents === '' ? null : Number(retailCents),
      p_min_margin_bps: minMarginBps === '' ? null : Number(minMarginBps),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setResult(data as SimResult);
  };

  // Run once on mount with the mandate's worked example, so the screen opens
  // showing a number an operator can immediately sanity-check.
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Calculator className="h-4 w-4" /> {t('admin_sim_title')}
        </CardTitle>
        <CardDescription className="text-xs flex items-start gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {t('admin_sim_desc')}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5 col-span-2 md:col-span-1">
            <Label className="text-xs">{t('admin_sim_product')}</Label>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-secondary px-2 text-sm"
            >
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <NumField label={t('admin_sim_raw_cost')} value={rawCents} onChange={setRawCents} />
          <NumField label={t('admin_sim_ai_cost')} value={aiCents} onChange={setAiCents} />
          <NumField label={t('admin_sim_tax_bps')} value={taxBps} onChange={setTaxBps} />
          <NumField label={t('admin_sim_fee_bps')} value={feeBps} onChange={setFeeBps} />
          <NumField label={t('admin_sim_retail')} value={retailCents} onChange={setRetailCents} placeholder="—" />
          <NumField label={t('admin_sim_min_margin')} value={minMarginBps} onChange={setMinMarginBps} placeholder="—" />
          <div className="flex items-end">
            <Button onClick={run} disabled={busy} className="w-full h-9">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('admin_sim_run')}
            </Button>
          </div>
        </div>

        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <Stat label={t('admin_sim_landed')} value={c(result.landed_cogs_cents)} />
              <Stat label={t('admin_sim_standard')} value={c(result.standard_price_cents)} />
              <Stat label={t('admin_sim_pool')} value={c(result.base_profit_pool_cents)} />
              <Stat label={t('admin_sim_floor')} value={c(result.floor_price_cents)} />
              <Stat label={t('admin_sim_multiple')} value={`${Number(result.markup_multiple).toFixed(3)}x`} />
            </div>

            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[38rem] text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('admin_sim_plan')}</th>
                    <th className="py-2 text-end font-medium">{t('admin_sim_price')}</th>
                    <th className="py-2 text-end font-medium">{t('admin_sim_credits')}</th>
                    <th className="py-2 text-end font-medium">{t('admin_sim_profit')}</th>
                    <th className="py-2 text-end font-medium">{t('admin_sim_margin')}</th>
                    <th className="py-2 text-end font-medium">{t('admin_sim_markup')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.plans.map((p) => (
                    <tr key={p.plan_code} className="border-b border-border/50">
                      <td className="py-2 font-medium">
                        {p.plan_name}
                        {p.floor_applied && (
                          // The pre-floor figure is shown alongside, because
                          // "the floor engaged" is the single most important
                          // thing an operator can learn from this screen.
                          <span className="ms-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[12px] text-destructive">
                            {t('admin_sim_floor_applied')} {c(p.plan_price_before_floor_cents)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-end" dir="ltr">{c(p.final_price_cents)}</td>
                      <td className="py-2 text-end" dir="ltr">{Number(p.credits).toFixed(2)}</td>
                      <td className="py-2 text-end" dir="ltr">{c(p.gross_profit_cents)}</td>
                      <td className={`py-2 text-end ${p.gross_margin_bps < 3000 ? 'text-destructive font-semibold' : ''}`} dir="ltr">
                        {pct(p.gross_margin_bps)}
                      </td>
                      <td className="py-2 text-end text-muted-foreground" dir="ltr">{pct(p.markup_bps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number" step="any" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 bg-secondary border-border text-sm"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 p-2">
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold" dir="ltr">{value}</p>
    </div>
  );
}
