import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { getFinanceProviders, getProviderRegistry, usd, num, relativeTime } from '@/services/finance';
import type { ProviderRow, ProviderRegistry } from '@/types/finance';
import { Pill, ShareBar, TableWrap, Empty, UnpricedBadge, SectionTitle, LoadError } from './FinanceKit';

/**
 * Provider spend, rendered from the REGISTRY.
 *
 * There is no per-provider branch anywhere in this file. Categories, units,
 * capabilities and ordering all arrive as data, which is what makes a newly
 * registered channel — a WhatsApp sender, a telephony carrier, a lead
 * database — appear here correctly without this component being touched.
 */
export function FinanceProvidersTab() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [registry, setRegistry] = useState<ProviderRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getFinanceProviders(30), getProviderRegistry(30, true)])
      .then(([p, r]) => { if (alive) { setRows(p ?? []); setRegistry(r); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }
  if (error) return <LoadError message={error} />;

  const spending = rows.filter(r => Number(r.spend_usd) > 0 || r.events > 0);
  const idle = rows.filter(r => Number(r.spend_usd) === 0 && r.events === 0);

  // Group by the registry's own categories, in the registry's own order.
  const categories = registry?.categories ?? [];
  const byCategory = categories
    .map(c => ({ ...c, providers: spending.filter(p => p.category === c.code) }))
    .filter(c => c.providers.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_provider_spend')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {spending.length === 0 && <Empty message={t('fin_no_provider_spend')} />}

          {byCategory.map(cat => (
            <div key={cat.code}>
              <SectionTitle title={cat.label} />
              <div className="space-y-3">
                {cat.providers.map(p => (
                  <div key={p.provider_id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{p.provider_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {num(p.events)} {t('fin_events')} · {num(p.quantity, 0)} {p.billing_unit}
                          {p.last_seen_at && ` · ${relativeTime(p.last_seen_at)}`}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-base font-semibold tabular-nums" dir="ltr">{usd(p.spend_usd)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                          {(p.share_bps / 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    <div className="mt-2"><ShareBar bpsValue={p.share_bps} /></div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <UnpricedBadge count={p.unpriced_events} quantity={p.unpriced_quantity} />
                      {p.cost_per_unit_usd !== null && (
                        <Pill tone="muted">
                          {usd(p.cost_per_unit_usd, 6)} / {p.billing_unit}
                        </Pill>
                      )}
                      {p.cache_hits > 0 && (
                        <Pill tone="good">{t('fin_cache_hits')}: {num(p.cache_hits)}</Pill>
                      )}
                      {/* An invoice that disagrees with the meter is the most
                          valuable thing this panel can surface. */}
                      {p.metered_vs_invoiced_delta_usd !== null && (
                        <Pill tone={Math.abs(Number(p.metered_vs_invoiced_delta_usd)) > 0.01 ? 'warn' : 'good'}>
                          {t('fin_vs_invoice')}: {usd(p.metered_vs_invoiced_delta_usd)}
                        </Pill>
                      )}
                    </div>

                    {p.by_product.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.by_product.map(bp => (
                          <span key={bp.product}
                                className="rounded bg-muted/40 px-1.5 py-0.5 text-[12px] text-muted-foreground">
                            {bp.product} · {usd(bp.usd)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Registered but not spending. Kept visible so a provider that has
          quietly stopped reporting is distinguishable from one that was never
          switched on. */}
      {idle.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('fin_registered_no_spend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TableWrap>
              <table className="w-full min-w-[30rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_provider')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_category')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_unit')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_capabilities')}</th>
                  </tr>
                </thead>
                <tbody>
                  {idle.map(p => (
                    <tr key={p.provider_id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{p.provider_name}</td>
                      <td className="py-2 text-muted-foreground">{p.category_label}</td>
                      <td className="py-2 text-muted-foreground">{p.billing_unit}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {p.supports_live_metering && <Pill tone="muted">{t('fin_cap_metering')}</Pill>}
                          {p.supports_usage_import && <Pill tone="muted">{t('fin_cap_import')}</Pill>}
                          {p.supports_manual_invoice && <Pill tone="muted">{t('fin_cap_invoice')}</Pill>}
                          {p.supports_effective_dated_pricing && <Pill tone="muted">{t('fin_cap_pricing')}</Pill>}
                        </div>
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
