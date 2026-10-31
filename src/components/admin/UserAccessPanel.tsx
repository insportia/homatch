import { Loader2, ShieldCheck } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { planLabel } from '@/subscriptions/components';
import {
  type AdminAccessDetail, type AdminGrant, type AllowanceInput, adminAccessGrant, adminAccessReset,
  adminAccessRevoke, adminAccessUpdate, adminAccessUser, type FeatureCode, type GrantKind, grantExpiry,
  isAccessForbidden, type PlanCode,
} from '@/subscriptions/service';

/*
 * ONE ACCOUNT'S ACCESS AND LIMITS (owner requirement 2026-10-30; on the user profile 2026-10-31).
 *
 * Unlimited, a manual plan, or custom per-service limits (unlimited, a total or a monthly number),
 * temporary or permanent, with reset and revoke. Shown on Admin → Money → User access
 * (/admin/access) and on the admin user profile (/admin/user360). Every write is an
 * admin_access_* RPC that re-checks admin, refuses self-grants and owner changes, requires a
 * reason and writes the audit row. This panel holds no rule of its own and asks for
 * confirmation before every write.
 */
const QUOTA: FeatureCode[] = ['VERIFY', 'CONTRACT_ANALYSIS', 'PREMIUM_DISCOVERY'];
const BOOLS: FeatureCode[] = ['HOMI_UNLIMITED', 'INTERNAL_SEARCH', 'INTERNAL_MATCHING', 'INTERNAL_UNLOCK_FREE'];
const PLANS: PlanCode[] = ['STANDARD', 'VIP', 'UNLIMITED'];
type Duration = '7' | '30' | '90' | 'CUSTOM' | 'PERMANENT';
type Row = { on: boolean; unlimited: boolean; limit: string; period: 'TOTAL' | 'MONTHLY' };
const emptyRows = (): Record<string, Row> =>
  Object.fromEntries([...QUOTA, ...BOOLS].map((f) => [f, { on: false, unlimited: BOOLS.includes(f), limit: '', period: 'TOTAL' as const }]));
const SELECT = 'block h-11 w-full rounded-md border border-input bg-background px-2 text-sm';

export function UserAccessPanel({ userId, onChanged }: { userId: string; onChanged?: () => void }) {
  const { t, lang } = useLanguage();
  const locale = lang === 'ka' ? 'ka-GE' : lang;
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const [detail, setDetail] = useState<AdminAccessDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // New grant form.
  const [kind, setKind] = useState<GrantKind>('UNLIMITED');
  const [plan, setPlan] = useState<PlanCode>('STANDARD');
  const [rows, setRows] = useState<Record<string, Row>>(emptyRows);
  const [duration, setDuration] = useState<Duration>('30');
  const [customDate, setCustomDate] = useState('');
  // Edits of existing grants, keyed by grant id.
  const [edits, setEdits] = useState<Record<string, { duration: Duration | 'KEEP'; date: string; limits: Record<string, string> }>>({});

  const fail = useCallback((e: unknown) => {
    const m = String((e as Error)?.message ?? e);
    toast.error(isAccessForbidden(m) ? t('acc_forbidden') : m.includes('INVALID_EXPIRY') ? t('acc_err_expiry') : m.includes('REASON_REQUIRED') ? t('acc_reason_needed') : t('sub_err_generic'));
  }, [t]);

  const selected = userId;
  const open = useCallback(async (id: string) => {
    setLoading(true); setPending(null);
    try { setDetail(await adminAccessUser(id)); } catch (e) { fail(e); setDetail(null); } finally { setLoading(false); }
  }, [fail]);
  useEffect(() => { setDetail(null); setReason(''); setEdits({}); void open(userId); }, [open, userId]);

  function ask(label: string, run: () => Promise<unknown>) {
    if (reason.trim().length < 3) { toast.error(t('acc_reason_needed')); return; }
    setPending({ label, run });
  }
  async function confirm() {
    if (!pending || !selected) return;
    setBusy(true);
    try {
      await pending.run();
      toast.success(t('acc_updated'));
      setPending(null); setReason(''); setRows(emptyRows()); setEdits({});
      await open(selected); onChanged?.();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  function submitGrant(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    let expiresAt: string | null;
    try { expiresAt = grantExpiry(duration, customDate || null); } catch (err) { fail(err); return; }
    const allowances: AllowanceInput[] | null = kind === 'CUSTOM'
      ? Object.entries(rows).filter(([, r]) => r.on).map(([feature, r]) => ({
          feature: feature as FeatureCode, unlimited: r.unlimited, limit: r.unlimited ? null : Number(r.limit || 0), period: r.period }))
      : null;
    if (kind === 'CUSTOM' && (!allowances || allowances.length === 0)) { toast.error(t('acc_err_pick_feature')); return; }
    const label = kind === 'UNLIMITED' ? t('acc_grant_unlimited') : t('acc_grant');
    const userId = detail.user.id;
    ask(label, () => adminAccessGrant(userId, kind, kind === 'PLAN' ? plan : null, allowances, expiresAt, reason.trim()));
  }

  function saveEdit(g: AdminGrant) {
    const ed = edits[g.id];
    if (!ed) return;
    let mode: 'KEEP' | 'PERMANENT' | 'DATE' = 'KEEP';
    let expiresAt: string | null = null;
    try {
      if (ed.duration === 'PERMANENT') mode = 'PERMANENT';
      else if (ed.duration !== 'KEEP') { mode = 'DATE'; expiresAt = grantExpiry(ed.duration, ed.date || null); }
    } catch (err) { fail(err); return; }
    const changed = g.allowances.filter((a) => !a.unlimited && ed.limits[a.feature] !== undefined && ed.limits[a.feature] !== String(a.limit));
    const allowances: AllowanceInput[] | null = changed.length
      ? changed.map((a) => ({ feature: a.feature, unlimited: false, limit: Number(ed.limits[a.feature] || 0), period: a.period }))
      : null;
    ask(t('acc_save'), () => adminAccessUpdate(g.id, mode, expiresAt, allowances, reason.trim()));
  }

  const editOf = (g: AdminGrant) => edits[g.id] ?? { duration: 'KEEP' as const, date: '', limits: {} };
  const setEdit = (g: AdminGrant, patch: Partial<ReturnType<typeof editOf>>) => setEdits({ ...edits, [g.id]: { ...editOf(g), ...patch } });
  const featureName = (f: string) => t(`acc_feature_${f}`);
  const kindName = (g: { kind: GrantKind; planCode: PlanCode | null }) =>
    g.kind === 'UNLIMITED' ? t('acc_unlimited') : g.kind === 'PLAN' && g.planCode ? t('acc_manual_plan', { plan: planLabel(t, g.planCode) }) : t('acc_custom_limits');
  const roleOf = (u: { owner: boolean; isAdmin: boolean }) => (u.owner ? t('acc_role_owner') : u.isAdmin ? t('acc_role_admin') : t('acc_role_customer'));
  const st = detail?.status ?? null;
  const accessType = !detail || !st ? '' : st.access?.owner || st.access?.unlimited ? t('acc_unlimited')
    : st.subscription?.hasAccess ? planLabel(t, st.subscription.planCode)
    : (st.access?.grants.length ?? 0) > 0 ? t('acc_manual_grant') : t('sub_plan_FREE');

  return (
    loading && !detail ? (
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
    ) : detail && st ? (
        <div className="space-y-5" data-testid="admin-access-detail">
          <Card>
            <CardHeader><CardTitle className="break-words text-lg" dir="auto">{detail.user.fullName || detail.user.email}</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{t('acc_email')}</dt><dd className="break-all" dir="ltr">{detail.user.email ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">{t('acc_role')}</dt><dd>{roleOf(detail.user)}</dd></div>
                <div><dt className="text-muted-foreground">{t('acc_access_type')}</dt><dd className="font-semibold">{accessType}</dd></div>
                <div><dt className="text-muted-foreground">{t('acc_status')}</dt><dd>{detail.user.suspended ? t('acc_status_suspended') : t('acc_status_active')}{detail.user.verified ? '' : ` · ${t('acc_not_verified')}`}</dd></div>
                <div><dt className="text-muted-foreground">{t('acc_plan')}</dt><dd>{st.subscription?.hasAccess ? `${planLabel(t, st.subscription.planCode)} · ${t('acc_paid_until', { date: when(st.subscription.currentPeriodEnd) })}` : t('sub_plan_FREE')}</dd></div>
                <div><dt className="text-muted-foreground">{t('acc_legacy_balance')}</dt><dd className="tabular-nums" dir="ltr">{Number(detail.legacyBalance).toFixed(2)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">ID</dt><dd className="break-all font-mono text-xs" dir="ltr">{detail.user.id}</dd></div>
              </dl>
              {detail.user.owner ? (
                <p className="mt-4 flex gap-2 rounded-lg bg-gold-soft p-3 text-sm text-gold-ink" role="status">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('acc_owner_notice')} {t('acc_owner_protected')}</span>
                </p>
              ) : !detail.manageable ? (
                <p className="mt-4 text-sm text-muted-foreground" role="status">{t('acc_forbidden')}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{t('acc_allowances')}</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {st.features.map((f) => (
                  <li key={f.feature} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                    <span className="font-medium">{featureName(f.feature)}</span>
                    <span className="text-muted-foreground">
                      {t(`acc_source_${f.source ?? 'NONE'}`)}
                      {f.source === 'OWNER' || ((f.source === 'GRANT' || f.included) && f.unlimited) ? ` · ${t('acc_unlimited')}`
                        : f.limit != null ? ` · ${t('acc_used_of', { used: String(f.used), limit: String(f.limit) })} · ${t('acc_remaining')}: ${f.remaining ?? 0}` : ''}
                      {f.kind === 'QUOTA' && f.trialEnabled ? ` · ${t('acc_trial')}: ${f.trialState === 'CONSUMED' ? t('acc_trial_used') : f.trialAvailable ? t('acc_trial_available') : st.accountEligibleForTrials ? t(`acc_trial_${f.trialState}`) : t('acc_trial_not_eligible')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{t('acc_grants')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {detail.grants.length === 0 ? <p className="text-sm text-muted-foreground">{t('acc_no_grants')}</p> : detail.grants.map((g) => {
                const ed = editOf(g);
                const editable = detail.manageable && g.status === 'ACTIVE' && !g.expired;
                return (
                  <section key={g.id} className="space-y-3 rounded-xl border border-border p-4 text-sm" aria-label={kindName(g)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{kindName(g)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${g.live ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>
                        {g.status === 'REVOKED' ? t('acc_status_revoked') : g.expired ? t('acc_status_expired') : t('acc_status_live')}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {t('acc_expiry')}: {g.permanent ? t('acc_permanent') : when(g.expiresAt)} · {t('acc_granted_at', { date: when(g.createdAt) })}
                    </p>
                    <p className="break-words text-muted-foreground" dir="auto">{g.reason}</p>
                    {g.revokedAt ? <p className="break-words text-muted-foreground" dir="auto">{t('acc_revoked_at', { date: when(g.revokedAt) })}: {g.revokeReason}</p> : null}
                    <ul className="space-y-1.5">
                      {g.allowances.map((a) => (
                        <li key={a.feature} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1">{featureName(a.feature)}</span>
                          {a.unlimited ? <span>{t('acc_unlimited')}</span> : (
                            <>
                              <span className="text-muted-foreground">{t('acc_used_of', { used: String(a.used), limit: String(a.limit) })} · {t(`acc_period_${a.period}`)}</span>
                              <span className="font-medium">{t('acc_remaining')}: {a.remaining}</span>
                              {editable ? (
                                <>
                                  <Input className="h-10 w-20" inputMode="numeric" aria-label={`${featureName(a.feature)} ${t('acc_limit')}`}
                                    value={ed.limits[a.feature] ?? String(a.limit ?? '')}
                                    onChange={(e) => setEdit(g, { limits: { ...ed.limits, [a.feature]: e.target.value.replace(/\D/g, '') } })} />
                                  <Button type="button" size="sm" variant="outline" className="min-h-10" onClick={() => ask(t('acc_reset'), () => adminAccessReset(g.id, a.feature, reason.trim()))}>{t('acc_reset')}</Button>
                                </>
                              ) : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    {editable ? (
                      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                        <div className="min-w-[10rem] flex-1">
                          <Label htmlFor={`dur-${g.id}`}>{t('acc_expiry')}</Label>
                          <select id={`dur-${g.id}`} className={SELECT} value={ed.duration} onChange={(e) => setEdit(g, { duration: e.target.value as Duration | 'KEEP' })}>
                            <option value="KEEP">{t('acc_keep_expiry')}</option>
                            <option value="7">{t('acc_days', { n: '7' })}</option>
                            <option value="30">{t('acc_days', { n: '30' })}</option>
                            <option value="90">{t('acc_days', { n: '90' })}</option>
                            <option value="CUSTOM">{t('acc_custom_date')}</option>
                            <option value="PERMANENT">{t('acc_permanent')}</option>
                          </select>
                        </div>
                        {ed.duration === 'CUSTOM' ? (
                          <Input type="date" className="h-11 w-44" aria-label={t('acc_custom_date')} value={ed.date} onChange={(e) => setEdit(g, { date: e.target.value })} />
                        ) : null}
                        <Button type="button" className="min-h-11" onClick={() => saveEdit(g)}>{t('acc_save')}</Button>
                        <Button type="button" variant="destructive" className="min-h-11" onClick={() => ask(t('acc_revoke'), () => adminAccessRevoke(g.id, reason.trim()))}>{t('acc_revoke')}</Button>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </CardContent>
          </Card>

          {detail.manageable ? (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('acc_grant')}</CardTitle></CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={submitGrant}>
                  <div>
                    <Label htmlFor="acc-kind">{t('acc_access_type')}</Label>
                    <select id="acc-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as GrantKind)}>
                      <option value="UNLIMITED">{t('acc_unlimited')}</option>
                      <option value="PLAN">{t('acc_kind_PLAN')}</option>
                      <option value="CUSTOM">{t('acc_custom_limits')}</option>
                    </select>
                  </div>
                  {kind === 'PLAN' ? (
                    <div>
                      <Label htmlFor="acc-plan">{t('acc_plan')}</Label>
                      <select id="acc-plan" className={SELECT} value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
                        {PLANS.map((p) => <option key={p} value={p}>{planLabel(t, p)}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">{t('acc_plan_manual_note')}</p>
                    </div>
                  ) : null}
                  {kind === 'CUSTOM' ? (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">{t('acc_custom_limits')}</legend>
                      {[...QUOTA, ...BOOLS].map((f) => {
                        const r = rows[f];
                        const set = (patch: Partial<Row>) => setRows({ ...rows, [f]: { ...r, ...patch } });
                        return (
                          <div key={f} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-2.5 text-sm">
                            <label className="flex min-w-[12rem] flex-1 items-center gap-2"><Switch checked={r.on} onCheckedChange={(v) => set({ on: v })} /> {featureName(f)}</label>
                            {r.on && QUOTA.includes(f) ? (
                              <>
                                <label className="flex items-center gap-1.5"><Switch checked={r.unlimited} onCheckedChange={(v) => set({ unlimited: v })} /> {t('acc_unlimited_short')}</label>
                                {!r.unlimited ? (
                                  <>
                                    <Input className="h-10 w-20" inputMode="numeric" aria-label={`${featureName(f)} ${t('acc_limit')}`} value={r.limit}
                                      onChange={(e) => set({ limit: e.target.value.replace(/\D/g, '') })} />
                                    <select aria-label={`${featureName(f)} ${t('acc_period')}`} className="h-10 rounded-md border border-input bg-background px-2" value={r.period} onChange={(e) => set({ period: e.target.value as Row['period'] })}>
                                      <option value="TOTAL">{t('acc_period_TOTAL')}</option>
                                      <option value="MONTHLY">{t('acc_period_MONTHLY')}</option>
                                    </select>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </fieldset>
                  ) : null}
                  <fieldset>
                    <legend className="text-sm font-medium">{t('acc_expiry')}</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(['7', '30', '90', 'CUSTOM', 'PERMANENT'] as Duration[]).map((d) => (
                        <label key={d} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${duration === d ? 'border-[hsl(38_92%_54%)] bg-gold-soft' : 'border-border'}`}>
                          <input type="radio" name="acc-duration" value={d} checked={duration === d} onChange={() => setDuration(d)} />
                          {d === 'PERMANENT' ? t('acc_permanent') : d === 'CUSTOM' ? t('acc_custom_date') : t('acc_days', { n: d })}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{duration === 'PERMANENT' ? t('acc_permanent') : t('acc_temporary')}</p>
                    {duration === 'CUSTOM' ? <Input type="date" className="mt-2 h-11 w-48" aria-label={t('acc_custom_date')} value={customDate} onChange={(e) => setCustomDate(e.target.value)} /> : null}
                  </fieldset>
                  <Button type="submit" className="min-h-11 w-full bg-gold text-primary hover:bg-gold-hover sm:w-auto">
                    {kind === 'UNLIMITED' ? t('acc_grant_unlimited') : t('acc_grant')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {detail.manageable ? (
            <div className="sticky bottom-2 z-10 space-y-2 rounded-xl border border-border bg-card p-4 shadow-card">
              <Label htmlFor="acc-reason">{t('acc_reason')}</Label>
              <Input id="acc-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} />
              {pending ? (
                <div className="space-y-2 rounded-lg border border-[hsl(38_92%_54%)]/50 bg-gold-soft p-3 text-sm" role="alertdialog" aria-label={pending.label}>
                  <p className="font-medium">{t('acc_confirm_body', { action: pending.label })}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="min-h-11" disabled={busy} onClick={() => void confirm()}>
                      {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('acc_confirm')}
                    </Button>
                    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setPending(null)}>{t('acc_cancel')}</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <Card>
            <CardHeader><CardTitle className="text-base">{t('acc_usage_history')}</CardTitle></CardHeader>
            <CardContent>
              {detail.usage.length === 0 ? <p className="text-sm text-muted-foreground">{t('acc_no_usage')}</p> : (
                <ul className="divide-y divide-border text-sm">
                  {detail.usage.map((u) => (
                    <li key={u.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2">
                      <span className="font-medium">{featureName(u.feature)}</span>
                      <span className="text-muted-foreground">{t(`acc_source_${u.funding}`)} · {t(`acc_state_${u.state}`)}{u.overAllowance ? ` · ${t('acc_over_allowance')}` : ''}</span>
                      <span className="w-full text-xs text-muted-foreground">{when(u.committedAt ?? u.releasedAt ?? u.reservedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{t('acc_audit_history')}</CardTitle></CardHeader>
            <CardContent>
              {detail.events.length === 0 ? <p className="text-sm text-muted-foreground">{t('acc_no_events')}</p> : (
                <ul className="divide-y divide-border text-sm">
                  {detail.events.map((e) => (
                    <li key={e.id} className="space-y-0.5 py-2">
                      <p className="font-medium">{t(`acc_action_${e.action}`)} · {e.new ? kindName(e.new) : e.previous ? kindName(e.previous) : ''}</p>
                      <p className="break-words text-muted-foreground" dir="auto">{e.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        <span dir="ltr">{e.actorEmail ?? e.actorId}</span> · {when(e.createdAt)}
                        {e.expiresAt ? ` · ${t('acc_expiry')}: ${when(e.expiresAt)}` : ` · ${t('acc_permanent')}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
    ) : null
  );
}
