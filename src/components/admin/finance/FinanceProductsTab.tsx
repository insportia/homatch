import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { getFinanceProducts, getVerifyDeepDive, num } from '@/services/finance';
import { Money, Pill, TableWrap, Empty, UnpricedBadge, SectionTitle } from './FinanceKit';

/** Per-product unit economics, plus the Verify stage breakdown. */
interface ProductJson {
  product_code: string; name: string; enabled: boolean; pricing_active: boolean;
  provider_cogs: number; cost_events: number; unpriced_events: number;
  executions: number; included_executions: number; payg_executions: number;
  credits_charged: number; revenue_usd: number; gross_profit_usd: number;
  avg_cogs_usd: number | null; median_cogs_usd: number | null;
  p90_cogs_usd: number | null; cogs_per_execution_usd: number | null;
}

export function FinanceProductsTab() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ProductJson[]>([]);
  const [verify, setVerify] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getFinanceProducts(30), getVerifyDeepDive(30)])
      .then(([p, v]) => {
        if (!alive) return;
        setRows((p ?? []) as unknown as ProductJson[]);
        setVerify(v);
      })
      .catch(() => { /* shell surfaces it */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const stages = (verify?.by_stage ?? []) as {
    stage: string; runs?: number; cost_usd: number; tokens?: number; web_searches?: number;
  }[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_product_economics')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && <Empty message={t('fin_no_products')} />}
          <TableWrap>
            <table className="w-full min-w-[46rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_executions')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_included')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_cogs')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_per_exec')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_revenue')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_profit')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.product_code} className="border-b border-border/50">
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{p.name}</span>
                        {/* A product registered but deliberately not priced
                            yet must read that way, not as a $0 product. */}
                        {!p.pricing_active && <Pill tone="muted">{t('fin_not_priced')}</Pill>}
                        {!p.enabled && <Pill tone="muted">{t('fin_disabled')}</Pill>}
                        <UnpricedBadge count={p.unpriced_events} />
                      </div>
                    </td>
                    <td className="py-2 text-end tabular-nums">{num(p.executions)}</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground">
                      {num(p.included_executions)}
                    </td>
                    <td className="py-2 text-end"><Money value={p.provider_cogs} /></td>
                    <td className="py-2 text-end">
                      <Money value={p.cogs_per_execution_usd} unknown={p.cogs_per_execution_usd === null} />
                    </td>
                    <td className="py-2 text-end"><Money value={p.revenue_usd} /></td>
                    <td className={`py-2 text-end ${Number(p.gross_profit_usd) < 0 ? 'text-red-400' : ''}`}>
                      <Money value={p.gross_profit_usd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('fin_product_note')}</p>
        </CardContent>
      </Card>

      {stages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('fin_verify_stages')}</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionTitle title="" hint={t('fin_verify_stages_hint')} />
            <TableWrap>
              <table className="w-full min-w-[30rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_stage')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_cost')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_tokens')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_searches')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map(s => (
                    <tr key={s.stage} className="border-b border-border/50">
                      <td className="py-2 font-medium">{s.stage}</td>
                      <td className="py-2 text-end"><Money value={s.cost_usd} /></td>
                      <td className="py-2 text-end tabular-nums text-muted-foreground">
                        {s.tokens === undefined ? '—' : num(s.tokens)}
                      </td>
                      <td className="py-2 text-end tabular-nums text-muted-foreground">
                        {s.web_searches === undefined ? '—' : num(s.web_searches)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
