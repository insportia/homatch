import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCostEvents, exportCostFacts, getFxStatus, usd, num,
} from '@/services/finance';
import type { CostEventPage, CostFactRow, FxStatus } from '@/types/finance';
import { Money, Pill, TableWrap, Empty } from './FinanceKit';

const PAGE = 100;

/**
 * Cost event drill-down: every measurable cost, filterable, with its source
 * of truth on every row.
 *
 * A row's cost_source says how the figure was arrived at — reported by the
 * provider, measured and calculated here, allocated, entered by hand, or not
 * priced at all. Mixing those silently is what makes a cost report untrue,
 * so the column is never hidden.
 */
export function FinanceEventsTab() {
  const { t } = useLanguage();
  const [page, setPage] = useState<CostEventPage | null>(null);
  const [fx, setFx] = useState<FxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [provider, setProvider] = useState('');
  const [product, setProduct] = useState('');
  const [jobRef, setJobRef] = useState('');
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCostEvents({
        provider: provider.trim() || undefined,
        product: product.trim() || undefined,
        jobRef: jobRef.trim() || undefined,
        unpricedOnly,
        limit: PAGE,
        offset,
      });
      setPage(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [provider, product, jobRef, unpricedOnly, offset]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { getFxStatus().then(setFx).catch(() => { /* optional panel */ }); }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      const csv = await exportCostFacts({
        provider: provider.trim() || undefined,
        product: product.trim() || undefined,
      });
      // Built and revoked locally: the CSV never leaves the browser except
      // as the file the operator asked for.
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homatch-cost-facts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const rows: CostFactRow[] = page?.rows ?? [];

  return (
    <div className="space-y-4">
      {/* An unconvertible currency is a visible gap, not a missing number. */}
      {fx && fx.missing.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 text-xs">
            {t('fin_fx_missing').replace('{list}', fx.missing.map(m => m.currency).join(', '))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_cost_events')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">{t('fin_col_provider')}</Label>
              <Input value={provider} onChange={e => { setOffset(0); setProvider(e.target.value); }}
                     className="h-8 text-xs" placeholder="OPENAI" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('fin_col_product')}</Label>
              <Input value={product} onChange={e => { setOffset(0); setProduct(e.target.value); }}
                     className="h-8 text-xs" placeholder="VERIFY" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('fin_col_job')}</Label>
              <Input value={jobRef} onChange={e => { setOffset(0); setJobRef(e.target.value); }}
                     className="h-8 text-xs" />
            </div>
            <div className="flex items-end">
              <Button
                variant={unpricedOnly ? 'default' : 'outline'}
                size="sm" className="h-8 w-full text-xs"
                onClick={() => { setOffset(0); setUnpricedOnly(v => !v); }}
              >
                {t('fin_unpriced_only')}
              </Button>
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" className="h-8 w-full text-xs"
                      onClick={doExport} disabled={exporting}>
                {exporting ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                           : <Download className="me-1 h-3.5 w-3.5" />}
                {t('fin_export_csv')}
              </Button>
            </div>
          </div>

          {page && (
            <p className="text-xs text-muted-foreground">
              {t('fin_events_summary')
                .replace('{n}', num(page.total))
                .replace('{v}', usd(page.sum_usd))}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <Empty message={t('fin_no_events')} />
          ) : (
            <TableWrap>
              <table className="w-full min-w-[52rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_when')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_provider')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_operation')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_quantity')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_cost')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.fact_key} className="border-b border-border/50">
                      <td className="py-2 whitespace-nowrap text-muted-foreground" dir="ltr">
                        {new Date(r.occurred_at).toLocaleString()}
                      </td>
                      <td className="py-2 font-medium">{r.provider}</td>
                      <td className="py-2 text-muted-foreground">{r.product}</td>
                      <td className="py-2 text-muted-foreground">
                        {r.stage ?? r.operation}
                        {r.model && <span className="ms-1 text-muted-foreground/60">{r.model}</span>}
                      </td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">
                        {num(r.quantity)} <span className="text-muted-foreground/60">{r.unit}</span>
                      </td>
                      <td className="py-2 text-end">
                        {/* Unpriced never renders as $0.00. */}
                        {r.is_unpriced
                          ? <Pill tone="warn">{t('fin_unpriced')}</Pill>
                          : <Money value={r.cost_usd} />}
                      </td>
                      <td className="py-2">
                        <Pill tone={r.is_unpriced ? 'warn' : 'muted'}>
                          {t(`fin_src_${r.cost_source.toLowerCase()}`)}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}

          {page && page.total > PAGE && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t('fin_prev')}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                {offset + 1}–{Math.min(offset + PAGE, page.total)} / {num(page.total)}
              </span>
              <Button variant="outline" size="sm" className="h-8 text-xs"
                      disabled={offset + PAGE >= page.total}
                      onClick={() => setOffset(offset + PAGE)}>
                {t('fin_next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
