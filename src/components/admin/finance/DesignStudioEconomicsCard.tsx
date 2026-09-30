import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getDesignStudioEconomics, num } from '@/services/finance';
import { Money, Pill, TableWrap, Empty, UnpricedBadge, LoadError } from './FinanceKit';

/**
 * DESIGN STUDIO AI ECONOMICS — what one AI job costs us, from real samples.
 *
 * Every cost figure is server-calculated from usage_events, over PRICED
 * samples only: an unpriced job is counted, never averaged in as zero. The
 * candidate price below is a planning calculator. It sets nothing: Design
 * Studio pricing stays off until an admin configures it in the price book.
 * Variable COGS only — fixed platform costs live in the Fixed costs tab.
 */

interface ModelRow { model: string; samples: number; avg_landed_cents: number | null }
interface OperationRow {
  product_code: string; samples: number; priced: number; unpriced: number; credits_charged: number;
  avg_input_tokens: number | null; avg_output_tokens: number | null;
  avg_ai_cents: number | null; avg_landed_cents: number | null; median_landed_cents: number | null;
  p90_landed_cents: number | null; p95_landed_cents: number | null; max_landed_cents: number | null;
  by_model: ModelRow[];
}

/** 10 credits = $1. */
const USD_PER_CREDIT = 0.1;
/** The margin below which a price is unsafe. A floor, not a target. */
const SAFETY_FLOOR = 0.3;

const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Number(cents) / 100);

export function marginAt(priceUsd: number, cogsUsd: number | null) {
  if (cogsUsd === null || !(priceUsd > 0)) return null;
  const profit = priceUsd - cogsUsd;
  return { profit, margin: profit / priceUsd, markup: cogsUsd > 0 ? profit / cogsUsd : null };
}

function MarginPill({ margin }: { margin: number }) {
  const { t } = useLanguage();
  if (margin < SAFETY_FLOOR) return <Pill tone="bad">{t('ds_fin_below_floor')}</Pill>;
  if (margin >= 0.75 && margin <= 0.85) return <Pill tone="good">{t('ds_fin_in_band')}</Pill>;
  if (margin >= 0.7) return <Pill tone="good">{t('ds_fin_above_70')}</Pill>;
  return <Pill tone="muted">{t('ds_fin_above_floor')}</Pill>;
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function DesignStudioEconomicsCard() {
  const { t } = useLanguage();
  const [ops, setOps] = useState<OperationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState('');

  useEffect(() => {
    let alive = true;
    getDesignStudioEconomics(90)
      .then((r) => { if (alive) setOps(((r as { operations?: OperationRow[] } | null)?.operations ?? [])); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const priceUsd = useMemo(() => {
    const c = Number(credits);
    return Number.isFinite(c) && c > 0 ? c * USD_PER_CREDIT : 0;
  }, [credits]);

  if (error) return <LoadError message={error} />;
  if (!ops) return null;

  return (
    <Card data-testid="ds-economics">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t('ds_fin_title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('ds_fin_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {ops.length === 0 && <Empty message={t('ds_fin_no_samples')} />}
        {ops.length > 0 && (
          <TableWrap>
            <table className="w-full min-w-[46rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                  <th className="py-2 text-end font-medium">{t('ds_fin_samples')}</th>
                  <th className="py-2 text-end font-medium">{t('ds_fin_tokens')}</th>
                  <th className="py-2 text-end font-medium">{t('ds_fin_avg_ai')}</th>
                  <th className="py-2 text-end font-medium">{t('ds_fin_avg_landed')}</th>
                  <th className="py-2 text-end font-medium">{t('ds_fin_median')}</th>
                  <th className="py-2 text-end font-medium">P90</th>
                  <th className="py-2 text-end font-medium">P95</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.product_code} className="border-b border-border/50 align-top">
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium" dir="ltr">{o.product_code}</span>
                        <UnpricedBadge count={o.unpriced} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                        {o.by_model.map((m) => `${m.model} × ${m.samples}`).join(' · ')}
                      </div>
                    </td>
                    <td className="py-2 text-end tabular-nums">{num(o.priced)} / {num(o.samples)}</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground" dir="ltr">
                      {o.avg_input_tokens === null ? '—' : `${num(o.avg_input_tokens)} / ${num(o.avg_output_tokens ?? 0)}`}
                    </td>
                    <td className="py-2 text-end"><Money value={usd(o.avg_ai_cents)} frac={4} /></td>
                    <td className="py-2 text-end"><Money value={usd(o.avg_landed_cents)} frac={4} /></td>
                    <td className="py-2 text-end"><Money value={usd(o.median_landed_cents)} frac={4} /></td>
                    <td className="py-2 text-end"><Money value={usd(o.p90_landed_cents)} frac={4} /></td>
                    <td className="py-2 text-end"><Money value={usd(o.p95_landed_cents)} frac={4} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        {ops.length > 0 && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="ds-fin-candidate" className="text-xs font-medium">{t('ds_fin_candidate')}</label>
              <Input
                id="ds-fin-candidate" inputMode="decimal" className="h-8 w-28" dir="ltr"
                value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="0"
              />
              <span className="text-xs text-muted-foreground">
                {t('ds_fin_credits_eq', { usd: priceUsd.toFixed(2) })}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('ds_fin_planning_only')}</p>
            {priceUsd > 0 && (
              <TableWrap>
                <table className="w-full min-w-[40rem] border-collapse text-xs" data-testid="ds-economics-candidate">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                      <th className="py-2 text-start font-medium">{t('ds_fin_basis')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_profit')}</th>
                      <th className="py-2 text-end font-medium">{t('ds_fin_margin')}</th>
                      <th className="py-2 text-end font-medium">{t('ds_fin_markup')}</th>
                      <th className="py-2 text-end font-medium">{t('ds_fin_scenario_100')}</th>
                      <th className="py-2 text-start font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {ops.flatMap((o) => ([
                      ['ds_fin_median', o.median_landed_cents],
                      ['P90', o.p90_landed_cents],
                      ['P95', o.p95_landed_cents],
                    ] as const).map(([basis, cents]) => {
                      const cogs = usd(cents);
                      const m = marginAt(priceUsd, cogs);
                      // A customer spending $100 at this price: how many jobs, and what they cost us.
                      const jobs = Math.floor(100 / priceUsd);
                      return (
                        <tr key={`${o.product_code}-${basis}`} className="border-b border-border/50">
                          <td className="py-2" dir="ltr">{o.product_code}</td>
                          <td className="py-2">{basis.startsWith('ds_') ? t(basis) : basis}</td>
                          <td className="py-2 text-end"><Money value={m?.profit ?? null} frac={4} /></td>
                          <td className="py-2 text-end tabular-nums" dir="ltr">{pct(m?.margin ?? null)}</td>
                          <td className="py-2 text-end tabular-nums" dir="ltr">{pct(m?.markup ?? null)}</td>
                          <td className="py-2 text-end text-muted-foreground" dir="ltr">
                            {m && cogs !== null
                              ? t('ds_fin_scenario_cell', { jobs: num(jobs), profit: (jobs * (priceUsd - cogs)).toFixed(2) })
                              : '—'}
                          </td>
                          <td className="py-2">{m && <MarginPill margin={m.margin} />}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
