import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { getLiveFeed, getFixedCosts, getPriceBook, usd, num, relativeTime } from '@/services/finance';
import type { FixedCosts, LiveFeed, PriceBook } from '@/types/finance';
import { Money, Pill, TableWrap, Empty, SectionTitle, StatCard } from './FinanceKit';

/**
 * The three remaining Finance surfaces: what is being spent right now, what
 * the company pays every month regardless of usage, and the rates every
 * calculated cost is derived from.
 */

// ── LIVE SPEND ───────────────────────────────────────────────
export function FinanceLiveSpendTab() {
  const { t } = useLanguage();
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => getLiveFeed(60)
      .then(f => { if (alive) setFeed(f); })
      .catch(() => { /* shell surfaces it */ })
      .finally(() => { if (alive) setLoading(false); });
    load();
    // Live means live. Cheap enough to poll: one indexed read.
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Activity} label={t('fin_live_5m')} value={usd(feed?.spend_5m)} />
        <StatCard label={t('fin_live_1h')} value={usd(feed?.spend_1h)}
                  sub={t('fin_live_events').replace('{n}', num(feed?.events_1h))} />
        <StatCard label={t('fin_live_today')} value={usd(feed?.spend_today)} />
        {/* Below a meaningful sample this is noise dressed as a number, so the
            server returns null and the card says so rather than guessing. */}
        <StatCard
          label={t('fin_live_burn_hour')}
          value={usd(feed?.burn_per_hour)}
          unavailable={feed?.burn_per_hour === null || feed?.burn_per_hour === undefined}
          unavailableNote={t('fin_live_burn_insufficient')}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_live_feed')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionTitle title="" hint={t('fin_live_feed_hint')} />
          {!feed?.events.length ? <Empty message={t('fin_no_events')} /> : (
            <TableWrap>
              <table className="w-full min-w-[44rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_when')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_provider')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_product')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_operation')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_quantity')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.events.map(e => (
                    <tr key={e.fact_key} className="border-b border-border/50">
                      <td className="py-2 whitespace-nowrap text-muted-foreground">
                        {relativeTime(e.occurred_at)}
                      </td>
                      <td className="py-2 font-medium">{e.provider}</td>
                      <td className="py-2 text-muted-foreground">{e.product}</td>
                      <td className="py-2 text-muted-foreground">
                        {e.stage ?? e.operation}
                        {e.model && <span className="ms-1 text-muted-foreground/60">{e.model}</span>}
                      </td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">
                        {num(e.quantity)} <span className="text-muted-foreground/60">{e.unit}</span>
                      </td>
                      <td className="py-2 text-end">
                        {e.is_unpriced
                          ? <Pill tone="warn">{t('fin_unpriced')}</Pill>
                          : <Money value={e.cost_usd} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── FIXED COSTS ──────────────────────────────────────────────
export function FinanceFixedCostsTab() {
  const { t } = useLanguage();
  const [data, setData] = useState<FixedCosts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getFixedCosts()
      .then(d => { if (alive) setData(d); })
      .catch(() => { /* shell surfaces it */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t('fin_fixed_monthly_total')} value={usd(data?.monthly_total_usd)} />
        {/* A subscription is an operating cost unless someone deliberately
            says otherwise, so this is reported apart from gross margin. */}
        <StatCard label={t('fin_fixed_in_cogs')} value={usd(data?.monthly_cogs_usd)}
                  sub={t('fin_fixed_cogs_hint')} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_fixed_costs')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionTitle title="" hint={t('fin_fixed_hint')} />
          {!data?.rows.length ? <Empty message={t('fin_no_fixed')} /> : (
            <TableWrap>
              <table className="w-full min-w-[42rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_name')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_vendor')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_frequency')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_amount')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_monthly')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2">
                        <span className="font-medium">{r.name}</span>
                        {r.counts_as_cogs && <Pill tone="gold">{t('fin_col_cogs')}</Pill>}
                        {r.notes && (
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{r.notes}</p>
                        )}
                      </td>
                      <td className="py-2 text-muted-foreground">{r.vendor}</td>
                      <td className="py-2 text-muted-foreground">
                        {t(`fin_freq_${r.billing_frequency.toLowerCase()}`)}
                      </td>
                      <td className="py-2 text-end"><Money value={r.amount_usd} /></td>
                      <td className="py-2 text-end"><Money value={r.monthly_usd} /></td>
                      <td className="py-2">
                        {/* Entered by a human. Never to be read as measured usage. */}
                        <Pill tone="muted">{t('fin_src_manual')}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {data && data.missing.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t('fin_fixed_missing')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.missing.map(m => (
              <div key={m.provider_id} className="text-xs">
                <span className="font-medium">{m.provider_name}</span>
                {m.hint && <span className="ms-2 text-muted-foreground">{m.hint}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── PRICE BOOK ───────────────────────────────────────────────
export function FinancePriceBookTab() {
  const { t } = useLanguage();
  const [book, setBook] = useState<PriceBook | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getPriceBook()
      .then(b => { if (alive) setBook(b); })
      .catch(() => { /* shell surfaces it */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  const current = (book?.model_rates ?? []).filter(r => r.current);
  const historical = (book?.model_rates ?? []).filter(r => !r.current);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_model_rates')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionTitle title="" hint={t('fin_model_rates_hint')} />
          {current.length === 0 ? <Empty message={t('fin_no_rates')} /> : (
            <TableWrap>
              <table className="w-full min-w-[44rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_provider')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_model')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_unit')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_rate')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_effective')}</th>
                  </tr>
                </thead>
                <tbody>
                  {current.map(r => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{r.provider}</td>
                      <td className="py-2 text-muted-foreground">{r.model ?? '—'}</td>
                      <td className="py-2 text-muted-foreground">{r.unit}</td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">
                        {usd(r.rate, 4)} <span className="text-muted-foreground/60">
                          / {num(r.per_units)}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground" dir="ltr">
                        {new Date(r.effective_from).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {historical.length > 0 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {t('fin_rates_superseded').replace('{n}', String(historical.length))}
            </p>
          )}
        </CardContent>
      </Card>

      {book && book.provider_rates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('fin_provider_rates')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TableWrap>
              <table className="w-full min-w-[40rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('fin_col_provider')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_operation')}</th>
                    <th className="py-2 text-start font-medium">{t('fin_col_unit')}</th>
                    <th className="py-2 text-end font-medium">{t('fin_col_rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {book.provider_rates.filter(r => r.current).map(r => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 font-medium">{r.provider_name ?? r.provider_id}</td>
                      <td className="py-2 text-muted-foreground">{r.operation}</td>
                      <td className="py-2 text-muted-foreground">{r.unit}</td>
                      <td className="py-2 text-end">
                        {/* A rate in a currency we cannot convert is not a
                            number we can report. */}
                        {r.convertible
                          ? <Money value={r.unit_cost_usd} />
                          : <Pill tone="warn">{t('fin_unpriced')}</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      {/* Where unpriced usage comes from, said out loud. */}
      {book && book.declared_but_unpriced.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t('fin_declared_unpriced')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SectionTitle title="" hint={t('fin_declared_unpriced_hint')} />
            <div className="flex flex-wrap gap-1.5">
              {book.declared_but_unpriced.map(p => (
                <Pill key={p.provider_id} tone="muted">
                  {p.provider_name} · {p.billing_unit}
                </Pill>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {book && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('fin_fx_rates')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {book.fx.rates.map(r => (
                <Pill key={r.currency} tone={r.currency === book.fx.reporting_currency ? 'good' : 'muted'}>
                  {/* Currency codes and the rate are data, not prose: composed
                      from the server's own reporting currency rather than a
                      hardcoded "USD". */}
                  <span dir="ltr">{`${r.currency} → ${book.fx.reporting_currency} · ${r.rate}`}</span>
                </Pill>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{t('fin_fx_hint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
