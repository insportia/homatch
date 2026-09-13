// HOMATCH — what Communications has cost.
//
// §47 and §153. This is a VIEW over the wallet every other Homatch product
// already uses, not a second one:
//
//   balance and reserved   billing_my_entitlements(), the same RPC the
//                          Credits page reads
//   top-up                 startTopUp(), the same checkout
//   usage                  outreach_sends and comm_messages, which are the
//                          rows the dispatcher and the webhooks already write
//
// Nothing here computes a price. §45 puts markup and tax in the database, and
// a figure derived in the browser is a figure a customer can edit.
//
// WHAT A CUSTOMER IS NOT SHOWN
//
// §47: "Normal users should see their charge. Do not expose raw margin."
// There is no provider cost, no COGS, no margin and no provider name on this
// screen. Those live in Admin Finance, against finance_provider_cost_events.
// The types this page imports do not carry them, so a component here cannot
// render one by accident.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ArrowUpRight, Phone, MessageSquare, AudioLines, AlertTriangle } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Kpi, KpiRow, PageHeader, LoadingBlock, EmptyState, ErrorState,
  ScrollTable, formatUsd, relativeTime,
} from '@/components/communications/primitives';
import { getMyEntitlements, startTopUp, getCatalogue } from '@/services/billing';
import { getCommunicationsSpend } from '@/services/communications';
import type { BillingEntitlements } from '@/types/billing';
import type { CommunicationsSpend } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
type Range = '30d' | '90d' | 'month';

/**
 * When to warn. Deliberately a RATIO of recent daily spend rather than a fixed
 * number of credits: "low" for an account spending $2 a day is a different
 * number from "low" for one spending $200, and a fixed threshold is wrong for
 * both.
 */
const LOW_BALANCE_DAYS = 3;

export default function CommunicationsBillingPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [entitlements, setEntitlements] = useState<BillingEntitlements | null>(null);
  const [spend, setSpend] = useState<CommunicationsSpend | null>(null);
  const [range, setRange] = useState<Range>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState(false);

  const since = useMemo(() => {
    if (range === 'month') {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    }
    return new Date(Date.now() - (range === '90d' ? 90 : 30) * 86_400_000).toISOString();
  }, [range]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ent, usage] = await Promise.all([getMyEntitlements(), getCommunicationsSpend(since)]);
      setEntitlements(ent);
      setSpend(usage);
    } catch {
      setError('comm_billing_load_failed');
    } finally {
      setLoading(false);
    }
  }, [since]);

  useEffect(() => { void load(); }, [load]);

  const onTopUp = useCallback(async () => {
    setToppingUp(true);
    try {
      // The same checkout the Credits page uses, and the amount comes from
      // topup_packs — never from this file (§43). If the catalogue cannot be
      // read, or has no packs, this hands over to the Credits page rather than
      // guessing an amount: a top-up button that charges a number the browser
      // invented is exactly what §43 forbids.
      const catalogue = await getCatalogue();
      const pack = catalogue?.topupPacks?.[0];
      if (!pack?.code) { navigate('/credits'); return; }

      const result = await startTopUp({ packCode: pack.code });
      if (result?.checkoutUrl) { window.location.href = result.checkoutUrl; return; }
      toast.error(result?.error ?? t('comm_billing_topup_failed'));
    } catch {
      toast.error(t('comm_billing_topup_failed'));
    } finally {
      setToppingUp(false);
    }
  }, [navigate, t]);

  const balance = entitlements?.wallet?.balance ?? null;
  const reserved = entitlements?.wallet?.reserved ?? null;
  const creditsPerUsd = entitlements?.wallet?.credits_per_usd ?? null;

  // Runway, only when there is enough history for the number to mean anything.
  const runwayDays = useMemo(() => {
    if (balance == null || !creditsPerUsd || !spend?.series?.length) return null;
    const recent = spend.series.slice(-14).filter((d) => d.amountUsd > 0);
    if (recent.length < 3) return null;
    const perDay = recent.reduce((s, d) => s + d.amountUsd, 0) / recent.length;
    if (perDay <= 0) return null;
    return Math.floor((balance / creditsPerUsd) / perDay);
  }, [balance, creditsPerUsd, spend]);

  const lowBalance = runwayDays !== null && runwayDays <= LOW_BALANCE_DAYS;
  const maxDaily = Math.max(0.0001, ...(spend?.series ?? []).map((d) => d.amountUsd));

  return (
    <CommsWorkspace>
        <div className="space-y-4">
          <PageHeader
            title={t('comm_billing_title')}
            subtitle={t('comm_billing_subtitle')}
            primary={{ label: t('comm_billing_topup'), onClick: () => void onTopUp(), busy: toppingUp }}
            secondary={{ label: t('comm_billing_all_credits'), onClick: () => navigate('/credits') }}
          >
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={t('comm_date_range')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{t('comm_billing_this_month')}</SelectItem>
                <SelectItem value="30d">{t('comm_range_30d')}</SelectItem>
                <SelectItem value="90d">{t('comm_range_90d')}</SelectItem>
              </SelectContent>
            </Select>
          </PageHeader>

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {/* §92: a low balance is stated before it becomes a paused campaign,
              not after. */}
          {lowBalance ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{t('comm_billing_low').replace('{days}', String(Math.max(0, runwayDays ?? 0)))}</span>
                <Button size="sm" variant="outline" onClick={() => void onTopUp()} disabled={toppingUp}>
                  <ArrowUpRight className="me-1.5 h-3.5 w-3.5" />{t('comm_billing_topup')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <KpiRow cols={4}>
            <Kpi
              labelKey="comm_billing_available"
              value={balance != null ? balance.toFixed(2) : null}
              sub={t('credits_balance_unit')}
              accent
              loading={loading}
            />
            <Kpi
              labelKey="comm_billing_reserved"
              value={reserved != null ? reserved.toFixed(2) : null}
              sub={reserved ? t('comm_billing_reserved_note') : null}
              loading={loading}
            />
            <Kpi
              labelKey="comm_billing_spend_period"
              value={formatUsd(spend?.totalUsd ?? null, language)}
              loading={loading}
            />
            <Kpi
              labelKey="comm_billing_runway"
              // §93: a runway computed from two days of history is not a
              // runway. It is absent until there is enough to divide by.
              value={runwayDays !== null ? t('comm_billing_days').replace('{n}', String(runwayDays)) : null}
              loading={loading}
            />
          </KpiRow>

          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardContent className="p-4">
                <h2 className="mb-3 text-sm font-semibold">{t('comm_billing_daily')}</h2>
                {loading ? <LoadingBlock rows={3} /> : !spend?.series?.length ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">{t('comm_billing_no_spend')}</p>
                ) : (
                  <>
                    <div className="flex h-36 items-end gap-0.5" role="img" aria-label={t('comm_billing_daily')}>
                      {spend.series.map((d) => (
                        <div
                          key={d.date}
                          className="min-w-0 flex-1 rounded-t-sm bg-foreground/70"
                          style={{ height: `${Math.max(1, (d.amountUsd / maxDaily) * 100)}%` }}
                          title={`${d.date}: ${formatUsd(d.amountUsd, language)}`}
                        />
                      ))}
                    </div>
                    {/* §84: the chart is reinforcement. The same numbers exist
                        as text for anyone who cannot read the bars. */}
                    <p className="mt-2 flex items-center justify-between text-[13px] text-muted-foreground">
                      <span>{spend.series[0]?.date}</span>
                      <span>
                        {t('comm_billing_peak')} {formatUsd(maxDaily, language)}
                      </span>
                      <span>{spend.series[spend.series.length - 1]?.date}</span>
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h2 className="mb-3 text-sm font-semibold">{t('comm_billing_by_product')}</h2>
                {loading ? <LoadingBlock rows={3} /> : (
                  <ul className="space-y-2.5">
                    {[
                      { key: 'AI_CALL', icon: Phone, labelKey: 'comm_channel_ai_call', row: spend?.byProduct.AI_CALL },
                      { key: 'WHATSAPP', icon: MessageSquare, labelKey: 'comm_channel_whatsapp', row: spend?.byProduct.WHATSAPP },
                      { key: 'AI_TALK', icon: AudioLines, labelKey: 'comm_billing_ai_talk', row: spend?.byProduct.AI_TALK },
                    ].map(({ key, icon: Icon, labelKey, row }) => (
                      <li key={key}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate">{t(labelKey as TKey)}</span>
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">
                            {formatUsd(row?.amountUsd ?? 0, language)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-foreground/50"
                              style={{
                                width: `${spend?.totalUsd ? ((row?.amountUsd ?? 0) / spend.totalUsd) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[13px] text-muted-foreground">
                            {t('comm_billing_units').replace('{n}', String(row?.units ?? 0))}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* §110/§93: a product with no configured price is said to have
                    none, rather than being shown as free. */}
                {spend?.unpricedProducts?.length ? (
                  <p className="mt-3 border-t pt-2 text-[13px] text-muted-foreground">
                    {t('comm_billing_unpriced')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <section aria-labelledby="usage">
            <h2 id="usage" className="mb-2 text-sm font-semibold">{t('comm_billing_recent')}</h2>
            {loading ? <LoadingBlock rows={4} /> : !spend?.items?.length ? (
              <EmptyState
                icon={Wallet}
                titleKey="comm_billing_no_usage"
                bodyKey="comm_billing_no_usage_body"
                action={{ labelKey: 'comm_new_campaign', onClick: () => navigate('/outreach/campaigns/new') }}
              />
            ) : (
              <ScrollTable minWidth={820}>
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/40">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                      <th>{t('comm_col_date')}</th>
                      <th>{t('comm_billing_type')}</th>
                      <th>{t('comm_col_campaign')}</th>
                      <th>{t('comm_billing_units_col')}</th>
                      <th>{t('comm_billing_amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spend.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
                        <td className="whitespace-nowrap text-muted-foreground">
                          {relativeTime(item.at, language)}
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            {item.product === 'AI_CALL'
                              ? <Phone className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                              : <MessageSquare className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                            {t(item.product === 'AI_CALL' ? 'comm_channel_ai_call' : 'comm_channel_whatsapp')}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate">{item.reference ?? '·'}</td>
                        <td className="whitespace-nowrap tabular-nums">{item.unitsLabel}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {item.amountUsd === null ? (
                            // A finished unit with no charge recorded is not
                            // free; it is unpriced, and saying "$0.00" would be
                            // a claim the platform cannot stand behind.
                            <Badge variant="outline" className="text-[13px] text-muted-foreground">
                              {t('comm_billing_unpriced_short')}
                            </Badge>
                          ) : (
                            formatUsd(item.amountUsd, language)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
          </section>

          {/* Estimates against actuals, for campaigns that have both (§110). */}
          {spend?.campaigns?.length ? (
            <section aria-labelledby="estimates">
              <h2 id="estimates" className="mb-2 text-sm font-semibold">{t('comm_billing_estimates')}</h2>
              <ScrollTable minWidth={720}>
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/40">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                      <th>{t('comm_col_campaign')}</th>
                      <th>{t('comm_col_status')}</th>
                      <th>{t('comm_billing_estimated')}</th>
                      <th>{t('comm_billing_actual')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spend.campaigns.map((c) => (
                      <tr key={c.id} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
                        <td className="max-w-[240px] truncate font-medium">{c.name}</td>
                        <td className="text-muted-foreground">
                          {t(`comm_status_${c.status.toLowerCase()}` as TKey)}
                        </td>
                        <td className="tabular-nums text-muted-foreground">{formatUsd(c.estimateUsd, language)}</td>
                        <td className={cn(
                          'tabular-nums font-medium',
                          c.actualUsd > c.estimateUsd && c.estimateUsd > 0 && 'text-amber-600 dark:text-amber-400',
                        )}>
                          {formatUsd(c.actualUsd, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{t('comm_estimate_note')}</p>
            </section>
          ) : null}
        </div>
    </CommsWorkspace>
  );
}
