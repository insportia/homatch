import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { getFinancePlans, getCreditEconomics, getUserEconomics, usd, num } from '@/services/finance';
import type { CreditEconomics, PlanRow, UserEconomicsRow } from '@/types/finance';
import { Money, Pill, TableWrap, Empty, SectionTitle, LoadError } from './FinanceKit';

/**
 * Plans, credit economics and per-customer contribution.
 *
 * The distinction this panel exists to make: MEMBERSHIP and PROMOTIONAL
 * credits are not cash. They are a liability we issued against future cost,
 * and showing them beside money a customer actually paid would overstate
 * revenue. Only PURCHASED credits are cash-backed, and the table says so.
 */
function useLoad<T>(fn: () => Promise<T | null>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  // A failure must be visible. Swallowing it leaves an empty table that reads
  // as "nothing happened" rather than "this did not load".
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fn()
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

const Spinner = () => (
  <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
);

/** Subscriptions: what each plan earns, and what its included allowances cost. */
export function FinanceSubscriptionsTab() {
  const { t } = useLanguage();
  const { data, loading, error } = useLoad<PlanRow[]>(() => getFinancePlans(30));
  const plans = data ?? [];
  if (loading) return <Spinner />;
  if (error) return <LoadError message={error} />;

  return (
    <div className="space-y-4">
      {/* ── Plans ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_plan_economics')}</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 && <Empty message={t('fin_no_plans')} />}
          <TableWrap>
            <table className="w-full min-w-[46rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t('fin_col_plan')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_users')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_subs')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_mrr')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_included_cogs')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_payg')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_cogs')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_profit')}</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.plan_code} className="border-b border-border/50">
                    <td className="py-2">
                      <span className="font-medium">{p.plan_name}</span>
                      <span className="ms-1.5 text-muted-foreground" dir="ltr">
                        {usd(p.monthly_price_usd)}/mo
                      </span>
                    </td>
                    <td className="py-2 text-end tabular-nums">{num(p.active_users)}</td>
                    <td className="py-2 text-end tabular-nums">{num(p.active_subscriptions)}</td>
                    <td className="py-2 text-end"><Money value={p.mrr_usd} /></td>
                    {/* What the included allowances actually cost us. Revenue
                        on these is zero by design, so the cost is the whole
                        story. */}
                    <td className="py-2 text-end"><Money value={p.included_usage_cogs_usd} /></td>
                    <td className="py-2 text-end"><Money value={p.payg_revenue_usd} /></td>
                    <td className="py-2 text-end"><Money value={p.provider_cogs_usd} /></td>
                    <td className={`py-2 text-end ${Number(p.gross_profit_usd) < 0 ? 'text-red-400' : ''}`}>
                      <Money value={p.gross_profit_usd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </CardContent>
      </Card>

    </div>
  );
}

/** Credit economics: what is cash, and what was issued rather than sold. */
export function FinanceCreditsTab() {
  const { t } = useLanguage();
  const { data: credits, loading, error } = useLoad<CreditEconomics>(() => getCreditEconomics());
  if (loading) return <Spinner />;
  if (error) return <LoadError message={error} />;

  return (
    <div className="space-y-4">
      {credits && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('fin_credit_economics')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
                  {t('fin_cash_collected')}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                  {usd(credits.cash_collected_usd)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
                  {t('fin_outstanding_liability')}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                  {usd(credits.liability_outstanding_usd)}
                </p>
                <p className="text-[12px] text-muted-foreground tabular-nums" dir="ltr">
                  {num(credits.liability_outstanding_credits, 2)} CR
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
                  {t('fin_promo_redemptions')}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                  {num(credits.first_topup_promo.redemptions)}
                </p>
                <p className="text-[12px] text-muted-foreground tabular-nums" dir="ltr">
                  {num(credits.first_topup_promo.promo_credits_granted, 2)} CR
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
                  {t('fin_credits_per_usd')}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                  {num(credits.credits_per_usd)}
                </p>
              </div>
            </div>

            <div>
              <SectionTitle title={t('fin_by_provenance')} hint={t('fin_provenance_hint')} />
              <TableWrap>
                <table className="w-full min-w-[38rem] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t('fin_col_kind')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_issued')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_consumed')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_remaining')}</th>
                      <th className="py-2 text-end font-medium">{t('fin_col_nominal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credits.by_kind.map(k => (
                      <tr key={k.kind} className="border-b border-border/50">
                        <td className="py-2">
                          <span className="font-medium">{k.kind}</span>
                          {/* The distinction that keeps revenue honest. */}
                          <span className="ms-1.5">
                            <Pill tone={k.is_cash_backed ? 'good' : 'muted'}>
                              {k.is_cash_backed ? t('fin_cash_backed') : t('fin_issued_not_sold')}
                            </Pill>
                          </span>
                        </td>
                        <td className="py-2 text-end tabular-nums">{num(k.issued, 2)}</td>
                        <td className="py-2 text-end tabular-nums">{num(k.consumed, 2)}</td>
                        <td className="py-2 text-end tabular-nums">{num(k.remaining, 2)}</td>
                        <td className="py-2 text-end text-muted-foreground">
                          <Money value={k.nominal_usd} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

/** Per-customer contribution: revenue against attributed provider cost. */
export function FinanceUsersTab() {
  const { t } = useLanguage();
  const { data, loading, error } = useLoad<UserEconomicsRow[]>(() => getUserEconomics(30, 'cogs', 25));
  const users = data ?? [];
  if (loading) return <Spinner />;
  if (error) return <LoadError message={error} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('fin_user_economics')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionTitle title="" hint={t('fin_user_economics_hint')} />
          {users.length === 0 && <Empty message={t('fin_no_users')} />}
          <TableWrap>
            <table className="w-full min-w-[42rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t('fin_col_user')}</th>
                  <th className="py-2 text-start font-medium">{t('fin_col_plan')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_revenue')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_cogs')}</th>
                  <th className="py-2 text-end font-medium">{t('fin_col_profit')}</th>
                </tr>
              </thead>
              <tbody>
                {users.filter(u => u.provider_cogs_usd > 0 || u.topup_revenue_usd > 0).map(u => {
                  const revenue = Number(u.subscription_revenue_usd) + Number(u.topup_revenue_usd);
                  const loss = Number(u.gross_profit_usd) < 0;
                  return (
                    <tr key={u.user_id} className="border-b border-border/50">
                      <td className="py-2">
                        <span className="font-medium">{u.email ?? u.user_id.slice(0, 8)}</span>
                        {loss && <Pill tone="bad">{t('fin_loss_making')}</Pill>}
                      </td>
                      <td className="py-2 text-muted-foreground">{u.plan}</td>
                      <td className="py-2 text-end"><Money value={revenue} /></td>
                      <td className="py-2 text-end"><Money value={u.provider_cogs_usd} /></td>
                      <td className={`py-2 text-end ${loss ? 'text-red-400' : ''}`}>
                        <Money value={u.gross_profit_usd} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </CardContent>
      </Card>
    </div>
  );
}
