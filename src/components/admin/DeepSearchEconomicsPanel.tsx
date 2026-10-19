// HOMATCH ADMIN — DEEP SEARCH ECONOMICS (Find Property paid campaigns).
//
// Per campaign, from RECORDED numbers only (find-property-run 'admin_campaigns'):
// customer revenue (credits and USD), provider cost per Actor run with its provider run id
// and pricing basis, reserved vs actual, aborted/failed runs that still cost money, provider
// budget utilisation, the result funnel and cost per available match. Gross spread is
// revenue − provider cost and is labelled as such: VAT and payment fees are not modelled,
// so net margin stays "not known" rather than being guessed. Plus the Admin switch for the
// temporary 20-credit TEST campaign (admins and listed testers only).
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { adminCampaignEconomics, type CampaignEconomics } from '@/services/paidCampaign';
import { allocateCampaign, PAID_DISCOVERY_CURRENT_POLICY } from '@/research-core/billing/paidDiscoveryPolicy';

const money = (v: number | null | undefined, d = 3) => (v == null ? '—' : `$${v.toFixed(d)}`);
const TEST_KEY = 'find_property_test_campaign';

export function DeepSearchEconomicsPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<CampaignEconomics[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [test, setTest] = useState<{ enabled: boolean; credits: number; testers: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [econ, setting] = await Promise.all([
        adminCampaignEconomics(20),
        supabase.from('admin_settings').select('value').eq('key', TEST_KEY).maybeSingle(),
      ]);
      setRows(econ);
      const v = (setting.data?.value ?? {}) as { enabled?: boolean; credits?: number; testers?: string[] };
      setTest({ enabled: v.enabled === true, credits: Number(v.credits ?? 20), testers: Array.isArray(v.testers) ? v.testers : [] });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleTest = async (on: boolean) => {
    if (!test) return;
    setBusy(true);
    const value = { ...test, enabled: on };
    const { error } = await supabase.from('admin_settings').upsert({ key: TEST_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setBusy(false);
    if (error) { toast.error(t('fpc_admin_save_failed')); return; }
    setTest(value);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card" data-testid="deep-search-economics">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('fpc_admin_title')}</h2>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('admin_disc_refresh')}
        </Button>
      </div>

      {test ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-dashed border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('fpc_admin_test_title', { credits: test.credits })}</p>
            <p className="text-xs leading-snug text-muted-foreground">{t('fpc_admin_test_body', { provider: (allocateCampaign(test.credits, 10, PAID_DISCOVERY_CURRENT_POLICY).providerBudgetMicros / 100_000).toFixed(1) /* execution credits, the shared policy */, testers: test.testers.length })}</p>
          </div>
          <Switch checked={test.enabled} disabled={busy} onCheckedChange={(on) => void toggleTest(on)} aria-label={t('fpc_admin_test_title', { credits: test.credits })} data-switch="find_property_test_campaign" />
        </div>
      ) : null}

      <p className="mb-3 text-2xs leading-relaxed text-muted-foreground">{t('fpc_admin_note')}</p>
      {!rows ? <p className="text-xs text-muted-foreground">{loading ? '…' : t('fpc_load_failed')}</p> : !rows.length ? <p className="text-xs text-muted-foreground">{t('fpc_admin_none')}</p> : (
        <div className="space-y-3">
          {rows.map((r) => (
            <details key={r.id} className="rounded-xl border border-border p-3 text-xs" data-campaign-economics={r.id}>
              <summary className="cursor-pointer select-none">
                <span className="font-semibold" dir="ltr">{r.id.slice(0, 8)}</span>{' · '}{r.status}{' · '}
                {t('fpc_admin_revenue')} {r.revenueCredits == null ? '—' : t('fpi_paid_credits_n', { n: r.revenueCredits })} ({money(r.revenueUsd, 2)}){' · '}
                {t('fpc_admin_provider')} {money(r.providerCostUsd)}{' · '}
                {t('fpc_admin_spread')} {money(r.grossSpreadUsd)}
                {r.outcome ? <> · {t('fpc_admin_available', { n: r.outcome.available })}</> : null}
              </summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                {([
                  ['fpc_admin_reserved', r.reservedCredits != null ? t('fpi_paid_credits_n', { n: r.reservedCredits }) : '—'],
                  ['fpc_admin_budget', money(r.providerBudgetUsd, 2)],
                  ['fpc_admin_provider_reserved', money(r.providerReservedUsd)],
                  ['fpc_admin_utilization', r.budgetUtilization == null ? '—' : `${Math.round(r.budgetUtilization * 100)}%`],
                  ['fpc_admin_cost_per_match', money(r.costPerAvailableUsd, 2)],
                  ['fpc_admin_vat', t('fpc_admin_not_modelled')],
                  ['fpc_admin_fees', t('fpc_admin_not_modelled')],
                  ['fpc_admin_net', t('fpc_admin_unknown')],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k}><dt className="text-muted-foreground">{t(k)}</dt><dd className="tabular-nums">{v}</dd></div>
                ))}
              </dl>
              {r.outcome ? (
                <p className="mt-2 text-muted-foreground">
                  {t('fpc_admin_funnel', { fetched: r.outcome.fetched, candidates: r.outcome.candidates, unique: r.outcome.unique, exact: r.outcome.exact, potential: r.outcome.potential, rejected: r.outcome.rejected })}
                </p>
              ) : null}
              <div className="-mx-1 mt-2 overflow-x-auto px-1">
                <table className="w-full min-w-[44rem]">
                  <thead><tr className="text-muted-foreground">
                    {['fpc_admin_col_network', 'fpc_admin_col_status', 'fpc_admin_col_reserved', 'fpc_admin_col_actual', 'fpc_admin_col_basis', 'fpc_admin_col_billed', 'fpc_admin_col_offers', 'fpc_admin_col_run'].map((k) => <th key={k} className="py-1 text-start font-medium">{t(k)}</th>)}
                  </tr></thead>
                  <tbody>
                    {r.actorRuns.map((a, i) => (
                      <tr key={`${a.providerRunId ?? i}`} className={a.status !== 'SUCCEEDED' && (a.actualUsd ?? 0) > 0 ? 'text-[hsl(32_78%_36%)]' : ''}>
                        <td className="py-1">{a.network} · {a.stage}</td>
                        <td>{a.status}</td>
                        <td className="tabular-nums">{money(a.reservedUsd)}</td>
                        <td className="tabular-nums">{money(a.actualUsd)}</td>
                        <td>{a.costBasis ?? '—'}</td>
                        <td className="tabular-nums">{a.billed ?? '—'} / {a.fetched ?? '—'}</td>
                        <td className="tabular-nums">{a.offers ?? '—'}</td>
                        <td dir="ltr" className="font-mono">{a.providerRunId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}


