import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type AdminOverview, type AdminProvider, 
  adminAudit, adminConnectivity, adminOverview, adminPaymentEvents, adminProviders, adminRefund, adminSetEntitlement,
  adminSetPlan, adminSetSetting, adminSetTrial, adminSubscriptions, adminSupport, type FeatureCode, formatGel,type PlanCode,
} from '@/subscriptions/service';

/*
 * ADMIN → PLANS AND ENTITLEMENTS (owner decision 2026-10-29).
 *
 * Every write is an audited RPC (admin_saas_*): actor, time, old and new value, and a reason that
 * the server refuses to do without. The page holds no rule of its own; it edits rows and shows
 * the server's answers. Support overrides are the only way to activate a plan until a live bank is
 * connected. SANDBOX rows are labelled wherever they appear.
 */
const QUOTA: FeatureCode[] = ['VERIFY', 'CONTRACT_ANALYSIS', 'PREMIUM_DISCOVERY'];
const BOOLS: FeatureCode[] = ['HOMI_UNLIMITED', 'INTERNAL_SEARCH', 'INTERNAL_MATCHING', 'INTERNAL_UNLOCK_FREE'];

export default function AdminPlansPage() {
  const { t } = useLanguage();
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [providers, setProviders] = useState<{ liveProvider: string | null; providers: AdminProvider[] } | null>(null);
  const [subs, setSubs] = useState<Array<Record<string, any>>>([]);
  const [events, setEvents] = useState<Array<Record<string, any>>>([]);
  const [audit, setAudit] = useState<Array<Record<string, any>>>([]);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [support, setSupport] = useState({ userId: '', plan: 'STANDARD' as PlanCode, days: '30' });

  const load = useCallback(async () => {
    try {
      const [o, e, a] = await Promise.all([adminOverview(), adminPaymentEvents(), adminAudit()]);
      setOv(o); setEvents(e ?? []); setAudit(a ?? []);
      setPrices(Object.fromEntries(o.plans.map((p) => [p.code, (p.price_gel_tetri / 100).toFixed(2)])));
      setLimits(Object.fromEntries(o.entitlements.map((x) => [`${x.plan_code}:${x.feature}`, x.limit_per_period == null ? '' : String(x.limit_per_period)])));
    } catch (e) { toast.error(String((e as Error).message)); }
    adminProviders().then(setProviders).catch(() => setProviders(null));
    adminSubscriptions(null).then((s) => setSubs(s ?? [])).catch(() => setSubs([]));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    if (reason.trim().length < 3) { toast.error(t('admin_sub_reason_needed')); return; }
    try { await fn(); toast.success(t('admin_sub_saved')); await load(); } catch (e) { toast.error(String((e as Error).message)); }
  }

  const ent = (plan: PlanCode, f: FeatureCode) => ov?.entitlements.find((x) => x.plan_code === plan && x.feature === f);
  const setting = (k: string) => ov?.settings?.[k];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin_sub_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin_sub_intro')}</p>
        {ov ? <p className="mt-2 text-sm">{t('admin_sub_counts', { active: ov.counts.active, pastDue: ov.counts.pastDue, expired: ov.counts.expired, trials: ov.counts.trialsConsumed })}</p> : null}
      </div>

      <div className="max-w-xl">
        <Label htmlFor="saas-reason">{t('admin_sub_reason')}</Label>
        <Input id="saas-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_plans')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {ov?.plans.map((p) => (
            <div key={p.code} className="flex flex-wrap items-end gap-3">
              <div className="w-28 font-semibold">{p.code}</div>
              <div>
                <Label htmlFor={`price-${p.code}`}>{t('admin_sub_price')}</Label>
                <Input id={`price-${p.code}`} className="w-28" inputMode="decimal" value={prices[p.code] ?? ''} onChange={(e) => setPrices({ ...prices, [p.code]: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={p.enabled} onCheckedChange={(v) => void act(() => adminSetPlan(p.code, null, v, reason))} /> {t('admin_sub_enabled')}
              </label>
              <Button size="sm" onClick={() => void act(() => adminSetPlan(p.code, Math.round(Number(prices[p.code]) * 100), null, reason))}>{t('admin_sub_save')}</Button>
              <span className="text-xs text-muted-foreground">{formatGel(p.price_gel_tetri)} ₾</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_entitlements')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {ov?.plans.map((p) => (
            <div key={p.code} className="space-y-2">
              <div className="font-semibold">{p.code}</div>
              {QUOTA.map((f) => {
                const e = ent(p.code, f);
                const k = `${p.code}:${f}`;
                return (
                  <div key={k} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-44">{f}</span>
                    <label className="flex items-center gap-1.5"><Switch checked={!!e?.enabled} onCheckedChange={(v) => void act(() => adminSetEntitlement(p.code, f, v, e?.limit_per_period ?? 0, !!e?.unlimited, reason))} /> {t('admin_sub_enabled')}</label>
                    <label className="flex items-center gap-1.5"><Switch checked={!!e?.unlimited} onCheckedChange={(v) => void act(() => adminSetEntitlement(p.code, f, e?.enabled ?? true, v ? null : Number(limits[k] || 0), v, reason))} /> {t('admin_sub_unlimited')}</label>
                    {!e?.unlimited ? (
                      <>
                        <Input className="w-20" inputMode="numeric" aria-label={`${p.code} ${f}`} value={limits[k] ?? ''} onChange={(ev) => setLimits({ ...limits, [k]: ev.target.value })} />
                        <Button size="sm" variant="outline" onClick={() => void act(() => adminSetEntitlement(p.code, f, e?.enabled ?? true, Number(limits[k] || 0), false, reason))}>{t('admin_sub_save')}</Button>
                      </>
                    ) : null}
                  </div>
                );
              })}
              {BOOLS.map((f) => {
                const e = ent(p.code, f);
                return (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <Switch checked={!!e?.enabled} onCheckedChange={(v) => void act(() => adminSetEntitlement(p.code, f, v, null, true, reason))} /> {f}
                  </label>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_trials')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {ov?.features.filter((f) => f.kind === 'QUOTA').map((f) => (
            <label key={f.feature} className="flex items-center gap-2 text-sm">
              <Switch checked={f.trial_enabled} onCheckedChange={(v) => void act(() => adminSetTrial(f.feature, v, reason))} /> {f.feature}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_settings')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="grace">{t('admin_sub_grace_days')}</Label>
              <Input id="grace" className="w-20" defaultValue={String(setting('saas_past_due_grace_days') ?? 3)}
                onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== Number(setting('saas_past_due_grace_days'))) void act(() => adminSetSetting('saas_past_due_grace_days', v, reason)); }} />
            </div>
            <div>
              <Label htmlFor="live">{t('admin_sub_live_provider')}</Label>
              <select id="live" className="block h-10 rounded-md border border-input bg-background px-2" value={String(setting('saas_default_payment_provider') ?? 'NONE')}
                onChange={(e) => void act(() => adminSetSetting('saas_default_payment_provider', e.target.value, reason))}>
                <option value="NONE">{t('admin_sub_none')}</option>
                <option value="BOG">{t('admin_sub_bog')}</option>
                <option value="TBC">TBC</option>
              </select>
            </div>
            <label className="flex items-center gap-2">
              <Switch checked={setting('saas_sandbox_payments_enabled') === true} onCheckedChange={(v) => void act(() => adminSetSetting('saas_sandbox_payments_enabled', v, reason))} />
              <span className="rounded bg-amber-500/15 px-1.5 font-semibold">SANDBOX</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin_sub_sandbox_badge')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_providers')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {providers?.providers.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.id}</span>
                {p.test ? <span className="rounded bg-amber-500/15 px-1.5 text-xs font-semibold">SANDBOX</span> : null}
                {providers.liveProvider === p.id ? <span className="rounded bg-emerald-500/15 px-1.5 text-xs font-semibold">LIVE</span> : null}
                <span className="text-xs">{p.configured ? t('admin_sub_configured') : t('admin_sub_not_configured', { names: (p.missingSecrets ?? []).join(', ') || '-' })}</span>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{t('admin_sub_callback_url')}: {p.callbackUrl}</p>
              <p className="break-all text-xs text-muted-foreground">{p.successUrl} / {p.failUrl}</p>
              <p className="text-xs text-muted-foreground">{t('admin_sub_caps', { recurring: String(p.recurring), refunds: String(p.refunds), lookup: String(p.lookup) })}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={async () => {
                try { const r = await adminConnectivity(p.id); (r.ok ? toast.success : toast.error)(r.detail ?? r.reason ?? ''); } catch (e) { toast.error(String((e as Error).message)); }
              }}>{t('admin_sub_test_connectivity')}</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin_sub_support')}</CardTitle>
          <CardDescription>{t('admin_sub_support_note')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 text-sm">
          <div><Label htmlFor="sup-user">{t('admin_sub_user_id')}</Label><Input id="sup-user" className="w-80 max-w-full" value={support.userId} onChange={(e) => setSupport({ ...support, userId: e.target.value.trim() })} /></div>
          <div>
            <Label htmlFor="sup-plan">{t('admin_sub_plans')}</Label>
            <select id="sup-plan" className="block h-10 rounded-md border border-input bg-background px-2" value={support.plan} onChange={(e) => setSupport({ ...support, plan: e.target.value as PlanCode })}>
              {ov?.plans.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
            </select>
          </div>
          <div><Label htmlFor="sup-days">{t('admin_sub_days')}</Label><Input id="sup-days" className="w-20" inputMode="numeric" value={support.days} onChange={(e) => setSupport({ ...support, days: e.target.value })} /></div>
          <Button size="sm" onClick={() => void act(() => adminSupport('GRANT', support.userId, support.plan, Number(support.days), reason))}>{t('admin_sub_grant')}</Button>
          <Button size="sm" variant="outline" onClick={() => void act(() => adminSupport('EXTEND', support.userId, null, Number(support.days), reason))}>{t('admin_sub_extend')}</Button>
          <Button size="sm" variant="outline" onClick={() => void act(() => adminSupport('CANCEL_AT_PERIOD_END', support.userId, null, null, reason))}>{t('admin_sub_cancel_end')}</Button>
          <Button size="sm" variant="destructive" onClick={() => void act(() => adminSupport('CANCEL_NOW', support.userId, null, null, reason))}>{t('admin_sub_cancel_now')}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_subscriptions')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <Input aria-label={t('admin_sub_search')} placeholder={t('admin_sub_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => adminSubscriptions(search.trim() || null).then((s) => setSubs(s ?? []))}>{t('admin_sub_search')}</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-b border-border">
                    <td className="py-1.5 pe-2">{s.email}</td><td className="pe-2">{s.plan_code}</td><td className="pe-2">{s.status}</td>
                    <td className="pe-2">{String(s.current_period_end ?? '').slice(0, 10)}</td><td className="pe-2">{s.provider}</td>
                    <td><button type="button" className="underline" onClick={() => setSupport({ ...support, userId: s.user_id })}>{t('admin_sub_user_id')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_payments')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border">
                  <td className="py-1.5 pe-2">{String(e.received_at ?? '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="pe-2">{e.provider}{e.is_test ? <span className="ms-1 rounded bg-amber-500/15 px-1 font-semibold">SANDBOX</span> : null}</td>
                  <td className="pe-2">{e.type}</td><td className="pe-2">{e.amount_tetri == null ? '' : `${formatGel(e.amount_tetri)} ${e.currency ?? ''}`}</td>
                  <td className="pe-2">{e.checkout_status}</td><td className="pe-2">{e.result?.applied ?? e.result?.reason ?? ''}</td>
                  <td>{e.checkout_status === 'PAID' && !e.is_test ? (
                    <Button size="sm" variant="outline" onClick={() => void act(() => adminRefund(e.checkout_id, reason))}>{t('admin_sub_refund')}</Button>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('admin_sub_audit')}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {audit.map((a) => (
            <div key={a.id} className="border-b border-border py-1">
              <span className="font-semibold">{a.action}</span> {a.entity_id} · {String(a.created_at ?? '').slice(0, 16).replace('T', ' ')} · {a.metadata?.reason ?? ''}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
