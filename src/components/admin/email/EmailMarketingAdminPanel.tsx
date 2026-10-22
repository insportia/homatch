// ADMIN — Email Marketing operations and economics (Admin → Communication → Email).
//
// Five layers, never blended: customer revenue (gross / VAT / net), the internal
// 37/63 allocation (an allocation, not a cost), recorded provider cost (cost_events),
// the provider's own usage and limits (Resend GET /usage snapshot), and modelled
// scenario economics from the verified price tables (labelled as estimates).
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { RESEND_TX_TIERS, allocate, overageBlock, scenario, usd } from '@/emailMarketing/economics';
import { adminEmailEconomics, adminEmailOps, adminRefreshUsage } from '@/services/emailMarketing';

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <p className="text-lg font-semibold tabular-nums" dir="ltr">{value}</p>
      <p className="text-2xs leading-snug text-muted-foreground">{label}</p>
      {hint ? <p className="text-2xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

export function EmailMarketingAdminPanel() {
  const { t } = useLanguage();
  const [ops, setOps] = useState<Obj | null>(null);
  const [eco, setEco] = useState<Obj | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [usageNote, setUsageNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [o, e] = await Promise.all([adminEmailOps(30), adminEmailEconomics(30)]); setOps(o); setEco(e); }
    catch { toast.error(t('admin_emx_load_failed')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const refreshUsage = async () => {
    setRefreshing(true);
    try {
      const r = await adminRefreshUsage();
      setUsageNote(r.keyFallback ? t('admin_emx_key_fallback', { env: r.keyEnv ?? '—' }) : t('admin_emx_key_dedicated', { env: r.keyEnv ?? '—' }));
      await load();
    } catch (e) { toast.error(`${t('admin_emx_usage_failed')} ${(e as Error).message}`); } finally { setRefreshing(false); }
  };

  if (!ops || !eco) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />…</div>;

  const rev = (eco.revenue ?? {}) as Obj;
  const costs = (eco.providerCosts ?? {}) as Obj;
  const latest = (eco.latestUsage ?? null) as Obj | null;
  const usage = (latest?.usage ?? null) as Obj | null;
  const emails = ((usage?.emails ?? {}) as Obj);
  const monthly = (emails.monthly ?? {}) as Obj;
  const contacts = (usage?.contacts ?? {}) as Obj;
  const domains = (usage?.domains ?? {}) as Obj;
  const volume = (eco.customerVolume ?? {}) as Obj;
  const switches = (ops.switches ?? {}) as Obj;
  const committed = num(volume.committedAllowance);
  const providerMonthlyLimit = typeof monthly.limit === 'number' ? monthly.limit : null;
  const overCommitted = providerMonthlyLimit != null && committed > providerMonthlyLimit;
  const pro = allocate(50); const scale = allocate(220);
  const scen = [
    scenario('PRO', 'TRANSACTIONAL', 50_000, 0, RESEND_TX_TIERS[3]),
    scenario('PRO', 'BROADCAST', 50_000, 5_000),
    scenario('PRO', 'BROADCAST', 50_000, 50_000),
    scenario('SCALE', 'TRANSACTIONAL', 100_000, 0, RESEND_TX_TIERS[3]),
    scenario('SCALE', 'BROADCAST', 100_000, 10_000),
    scenario('SCALE', 'BROADCAST', 100_000, 100_000),
  ];
  const ob = overageBlock(RESEND_TX_TIERS[3]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-muted-foreground">{t('admin_emx_intro')}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_emx_reload')}</Button>
          <Button size="sm" onClick={() => void refreshUsage()} disabled={refreshing}>{refreshing ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />}{t('admin_emx_refresh_usage')}</Button>
        </div>
      </div>
      {usageNote && <p className="text-2xs text-muted-foreground">{usageNote}</p>}

      <section aria-label={t('admin_emx_switches')} className="flex flex-wrap gap-2 text-2xs">
        {Object.entries(switches).map(([k, v]) => <span key={k} className="rounded-full bg-muted px-2.5 py-1 font-mono">{k}: {JSON.stringify(v)}</span>)}
      </section>

      <section aria-labelledby="emx-provider" className="space-y-2">
        <h3 id="emx-provider" className="text-sm font-semibold">{t('admin_emx_provider')}</h3>
        {!latest ? <p className="text-2xs text-muted-foreground">{t('admin_emx_no_usage')}</p> : latest.ok === false ? (
          <p className="flex items-center gap-1.5 text-2xs text-[hsl(350_60%_40%)]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_emx_usage_error')}: {String(latest.error ?? '')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label={t('admin_emx_tx_month')} value={`${num(monthly.used).toLocaleString()} / ${monthly.limit == null ? '∞' : num(monthly.limit).toLocaleString()}`} hint={t('admin_emx_resets', { at: String(monthly.resets_at ?? '—') })} />
            <Stat label={t('admin_emx_contacts')} value={`${num(contacts.used).toLocaleString()} / ${contacts.limit == null ? '∞' : num(contacts.limit).toLocaleString()}`} />
            <Stat label={t('admin_emx_domains')} value={`${num(domains.used).toLocaleString()} / ${domains.limit == null ? '∞' : num(domains.limit).toLocaleString()}`} />
            <Stat label={t('admin_emx_received')} value={num(monthly.received).toLocaleString()} />
          </div>
        )}
        {overCommitted && (
          <p className="flex items-start gap-1.5 rounded-lg bg-[hsl(350_60%_96%)] p-2.5 text-2xs text-[hsl(350_60%_30%)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('admin_emx_overcommitted', { committed: committed.toLocaleString(), limit: num(providerMonthlyLimit).toLocaleString() })}</p>
        )}
      </section>

      <section aria-labelledby="emx-revenue" className="space-y-2">
        <h3 id="emx-revenue" className="text-sm font-semibold">{t('admin_emx_revenue')}</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <Stat label={t('admin_emx_gross')} value={usd(num(rev.grossUsd))} />
          <Stat label={t('admin_emx_vat')} value={usd(num(rev.vatUsd))} />
          <Stat label={t('admin_emx_net')} value={usd(num(rev.netUsd))} />
          <Stat label={t('admin_emx_homatch_alloc')} value={usd(num(rev.homatchAllocationUsd))} hint={t('admin_emx_allocation_hint')} />
          <Stat label={t('admin_emx_exec_alloc')} value={usd(num(rev.executionAllocationUsd))} hint={t('admin_emx_allocation_hint')} />
          <Stat label={t('admin_emx_provider_cost')} value={usd(num(costs.recordedUsd))} hint={t('admin_emx_unpriced', { n: String(num(costs.unpricedLines)) })} />
        </div>
        <p className="text-2xs text-muted-foreground">{t('admin_emx_margin', { margin: usd(num(rev.netUsd) - num(costs.recordedUsd)) })}</p>
      </section>

      <section aria-labelledby="emx-units" className="space-y-2">
        <h3 id="emx-units" className="text-sm font-semibold">{t('admin_emx_unit_economics')}</h3>
        <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-border">
          <table className="w-full min-w-[44rem] text-2xs">
            <thead className="bg-muted/50"><tr>{['admin_emx_col_case', 'admin_emx_gross', 'admin_emx_net', 'admin_emx_exec_alloc', 'admin_emx_col_provider', 'admin_emx_col_contribution', 'admin_emx_col_headroom'].map((k) => <th key={k} scope="col" className="px-2.5 py-2 text-start font-semibold">{t(k)}</th>)}</tr></thead>
            <tbody>
              {scen.map((s, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2.5 py-2">{s.plan} · {s.route === 'TRANSACTIONAL' ? t('admin_emx_route_tx') : t('admin_emx_route_bc')} · {s.emails.toLocaleString()} {s.route === 'BROADCAST' ? `· ${s.contacts.toLocaleString()} ${t('admin_emx_contacts_short')}` : ''}</td>
                  <td className="px-2.5 py-2 tabular-nums">{usd(s.revenue.gross)}</td>
                  <td className="px-2.5 py-2 tabular-nums">{usd(s.revenue.net)}</td>
                  <td className="px-2.5 py-2 tabular-nums">{usd(s.revenue.execution)}</td>
                  <td className="px-2.5 py-2 tabular-nums">{usd(s.providerCostUsd)}</td>
                  <td className={`px-2.5 py-2 tabular-nums ${(s.contributionUsd ?? 0) < 0 ? 'text-[hsl(350_60%_40%)]' : ''}`}>{usd(s.contributionUsd)}</td>
                  <td className={`px-2.5 py-2 tabular-nums ${(s.executionHeadroomUsd ?? 0) < 0 ? 'text-[hsl(350_60%_40%)]' : ''}`}>{usd(s.executionHeadroomUsd)}</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="px-2.5 py-2">{t('admin_emx_overage_block')}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.gross)}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.net)}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.execution)}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.providerCostUsd)}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.net - (ob.providerCostUsd ?? 0))}</td>
                <td className="px-2.5 py-2 tabular-nums">{usd(ob.execution - (ob.providerCostUsd ?? 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-muted-foreground">{t('admin_emx_estimate_note', { pro: `${usd(pro.net)} / ${usd(pro.vat)} / ${usd(pro.homatch)} / ${usd(pro.execution)}`, scale: `${usd(scale.net)} / ${usd(scale.vat)} / ${usd(scale.homatch)} / ${usd(scale.execution)}` })}</p>
      </section>

      <section aria-labelledby="emx-ops" className="space-y-2">
        <h3 id="emx-ops" className="text-sm font-semibold">{t('admin_emx_ops')}</h3>
        <pre className="max-h-80 overflow-auto rounded-xl bg-muted/40 p-3 text-2xs" dir="ltr">{JSON.stringify({ outreach: ops.outreach, studio: ops.studio, webhooks: ops.webhooks, inbound: ops.inbound, domains: ops.domains, subscriptions: ops.subscriptions, quota: ops.quota, billing: ops.billing, customerVolume: volume, activePaid: eco.activePaid }, null, 2)}</pre>
      </section>
    </div>
  );
}

export default EmailMarketingAdminPanel;
