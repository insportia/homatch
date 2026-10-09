// Admin → Providers: Verify official sources.
//
// TAS implementation control (LEGACY browser workflow / API_FIRST public DWR
// client — both already deployed in the official worker; nothing executable
// is ever uploaded here), its live health, a bounded read-only TEST, and the
// recent-job diagnostics Verify keeps internally (TAS accounting, market
// ledgers, AI usage). Every switch is an audited admin_set_setting write.
//
// NAPR/MyGov and RS.ge are shown as what they are today — integrations
// awaiting their own workstreams — never with an invented health light.

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, FlaskConical, Undo2, Zap } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { getAdminSettings, updateAdminSetting } from '@/services/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

type Impl = 'LEGACY' | 'API_FIRST';
interface TasSetting { active: Impl; fallback: Impl | null }
interface ImplHealth {
  implementation: Impl;
  runs: number;
  successes: number;
  failures: number;
  fallbacksTriggered: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: string | null;
  lastDurationMs: number | null;
}

const fmtIn = (lang: string) => (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ka' ? 'ka-GE' : lang) : '—');
const secs = (ms?: number | null) => (typeof ms === 'number' ? `${Math.round(ms / 100) / 10}s` : '—');

async function invokeAdmin(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('research-agent', { body: { action, ...extra } });
  if (error) throw error;
  return data as any;
}

export function VerifyOfficialSourcesPanel() {
  const { t, lang } = useLanguage();
  const fmt = fmtIn(lang);
  const [setting, setSetting] = useState<TasSetting>({ active: 'LEGACY', fallback: null });
  const [health, setHealth] = useState<ImplHealth[] | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [marketOn, setMarketOn] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  /** The exact code the last TEST ran on — ACTIVATE is bound to it. */
  const [testedCode, setTestedCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** CAPTCHA service state from the worker + the Admin policy. Never holds a key. */
  const [captcha, setCaptcha] = useState<{ policy: any; worker: any } | null>(null);
  const [captchaBalance, setCaptchaBalance] = useState<number | null | undefined>(undefined);
  /** Developer Advertising Intelligence: policy, switches, recent stages; schema only on request (free). */
  const [ads, setAds] = useState<any>(null);
  const [adsChecking, setAdsChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, settings, diag, cap] = await Promise.all([
        invokeAdmin('tas-admin-health').catch(() => null),
        getAdminSettings(),
        invokeAdmin('verify-admin-diagnostics', { limit: 15 }).catch(() => null),
        invokeAdmin('captcha-admin-health').catch(() => null),
      ]);
      setCaptcha(cap ?? null);
      setAds(await invokeAdmin('developer-ads-admin-health').catch(() => null));
      if (h?.setting) setSetting(h.setting);
      if (h?.worker?.implementations) {
        setHealth(h.worker.implementations);
        setWorkerError(null);
      } else {
        setHealth(null);
        setWorkerError(h?.worker?.error ?? (h?.worker?.unavailable ? `HTTP ${h.worker.status ?? '?'}` : null));
      }
      const m = settings.find((s: any) => s.key === 'verify_marketplace_market_enabled');
      setMarketOn(m?.value === true || m?.value === 'true');
      setJobs(Array.isArray(diag?.jobs) ? diag.jobs : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: TasSetting, reason: string): Promise<boolean> => {
    setSaving(true);
    try {
      await updateAdminSetting('verify_tas_implementation', next, reason);
      setSetting(next);
      toast.success(t('adm_vos_saved'));
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestedCode(testCode.trim());
    try {
      setTestResult(await invokeAdmin('tas-admin-test', { query: testCode.trim() }));
    } catch (e: any) {
      setTestResult({ ok: false, result: { error: e?.message ?? String(e) } });
    } finally {
      setTesting(false);
    }
  };

  const saveCaptchaPolicy = async (next: any, reason: string) => {
    try {
      await updateAdminSetting('verify_captcha_auto_solve', next, reason);
      setCaptcha((c) => (c ? { ...c, policy: next } : c));
      toast.success(t('adm_vos_saved'));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    }
  };
  const saveAdsPolicy = async (next: any, reason: string) => {
    try {
      await updateAdminSetting('verify_developer_ads', next, reason);
      setAds((a: any) => (a ? { ...a, policy: next } : a));
      toast.success(t('adm_vos_saved'));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    }
  };
  const checkAdsSchema = async () => {
    setAdsChecking(true);
    try {
      setAds(await invokeAdmin('developer-ads-admin-health', { checkSchema: true }));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setAdsChecking(false);
    }
  };
  const checkBalance = async () => {
    try {
      const r = await invokeAdmin('captcha-admin-health', { balance: true });
      setCaptchaBalance(typeof r?.worker?.balanceUsd === 'number' ? r.worker.balanceUsd : null);
    } catch {
      setCaptchaBalance(null);
    }
  };

  // ACTIVATE is offered only after a TEST of THIS code passed in this session,
  // and a save (activate or rollback) spends that TEST.
  const testPassed = testResult?.ok === true && testedCode === testCode.trim();
  const apiHealth = health?.find((h) => h.implementation === 'API_FIRST');
  const legacyHealth = health?.find((h) => h.implementation === 'LEGACY');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t('adm_vos_title')}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label={t('adm_vos_refresh')}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── TAS ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">TAS</h3>
            <Badge variant="outline">{t('adm_vos_active')}: {setting.active}</Badge>
            <Badge variant="outline">{t('adm_vos_fallback')}: {setting.fallback ?? '—'}</Badge>
          </div>
          {workerError ? <p className="text-xs text-amber-600 break-words">{t('adm_vos_worker_unreachable')} {workerError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {[legacyHealth, apiHealth].map((h, i) => (
              <div key={i} className="rounded-lg border border-border p-3 text-xs space-y-1">
                <p className="font-medium">{i === 0 ? 'LEGACY' : 'API_FIRST'}</p>
                {h ? (
                  <>
                    <p>{t('adm_vos_runs')}: {h.runs} · ✓ {h.successes} · ✗ {h.failures} · ↩ {h.fallbacksTriggered}</p>
                    <p>{t('adm_vos_last_success')}: {fmt(h.lastSuccessAt)}</p>
                    <p>{t('adm_vos_last_failure')}: {fmt(h.lastFailureAt)}{h.lastFailure ? ` — ${h.lastFailure}` : ''}</p>
                    <p>{t('adm_vos_duration')}: {secs(h.lastDurationMs)}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">{t('adm_vos_no_data')}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">{t('adm_vos_health_note')}</p>

          <div className="flex flex-wrap items-end gap-2">
            <Input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder="01.18.06.019.055"
              className="h-9 w-56"
              aria-label={t('adm_vos_test_code')}
            />
            <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing || !testCode.trim()}>
              <FlaskConical className="me-1.5 h-4 w-4" />
              {testing ? t('adm_vos_testing') : t('adm_vos_test')}
            </Button>
            <Button
              size="sm"
              onClick={() => void save({ active: 'API_FIRST', fallback: 'LEGACY' }, `TAS API_FIRST activated after TEST ${testedCode}`).then((ok) => ok && setTestResult(null))}
              disabled={saving || !testPassed || setting.active === 'API_FIRST'}
              aria-describedby={testPassed ? undefined : 'adm-vos-activate-hint'}
            >
              <Zap className="me-1.5 h-4 w-4" />
              {t('adm_vos_activate')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void save({ active: 'LEGACY', fallback: null }, 'TAS rollback to LEGACY').then((ok) => ok && setTestResult(null))}
              disabled={saving || setting.active === 'LEGACY'}
            >
              <Undo2 className="me-1.5 h-4 w-4" />
              {t('adm_vos_rollback')}
            </Button>
            {setting.active === 'API_FIRST' ? (
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={setting.fallback === 'LEGACY'}
                  onCheckedChange={(on) => void save({ active: 'API_FIRST', fallback: on ? 'LEGACY' : null }, `TAS fallback ${on ? 'on' : 'off'}`)}
                  disabled={saving}
                />
                {t('adm_vos_fallback_switch')}
              </label>
            ) : null}
          </div>

          {!testPassed && setting.active !== 'API_FIRST' ? (
            <p id="adm-vos-activate-hint" className="text-2xs text-muted-foreground">{t('adm_vos_activate_requires_test')}</p>
          ) : null}
          {testResult ? (
            <div className="rounded-lg border border-border p-3 text-xs space-y-1 break-words">
              <p className={testResult.ok ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                {testResult.ok ? t('adm_vos_test_ok') : t('adm_vos_test_failed')}
                {testResult.result?.error ? ` — ${testResult.result.error}` : ''}
              </p>
              {testResult.result?.reconciliation ? (
                <p>
                  {t('adm_vos_documents')}: {testResult.result.reconciliation.uniqueDocumentIds} / {testResult.result.reconciliation.sourceTotal ?? '?'} ·{' '}
                  {testResult.result.reconciliation.reconciled ? t('adm_vos_reconciled') : t('adm_vos_not_reconciled')} · {testResult.result.reconciliation.stopReason}
                </p>
              ) : null}
              {testResult.result?.accounting ? (
                <p>
                  {t('adm_vos_motions')}: {testResult.result.accounting.motions} · {t('adm_vos_attachments')}: {testResult.result.accounting.attachments} ·{' '}
                  {t('adm_vos_visuals')}: {testResult.result.accounting.visualsExtracted}
                </p>
              ) : null}
              {testResult.result?.durationMs ? <p>{t('adm_vos_duration')}: {secs(testResult.result.durationMs)}</p> : null}
            </div>
          ) : null}
        </section>

        {/* ── Other official sources (honest state, no fake health) ── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('adm_vos_other_sources')}</h3>
          <ul className="space-y-1.5 text-xs">
            {(['mygov', 'enreg', 'debtor', 'rstax'] as const).map((p) => {
              const seen = jobs.map((j) => (j.providers ?? []).find((o: any) => o.provider === p)).filter(Boolean);
              const last = seen[0];
              const counts = seen.reduce((acc: Record<string, number>, o: any) => ({ ...acc, [o.state]: (acc[o.state] ?? 0) + 1 }), {});
              return (
                <li key={p} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`verify_ox_prov_${p}`)}</span>
                  {p === 'mygov' || p === 'rstax' ? <Badge variant="secondary">{t('adm_vos_pending_integration')}</Badge> : null}
                  {last ? (
                    <span className="text-muted-foreground break-words">
                      {t('adm_vos_last_outcome')}: <span className="font-mono">{last.state}</span>{last.reason ? ` (${last.reason})` : ''} · {Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' · ')}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('adm_vos_no_data')}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="rounded-lg border border-border p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{t('adm_vos_captcha_title')}</p>
              {captcha?.policy ? (
                <label className="flex items-center gap-2">
                  <Switch
                    checked={captcha.policy.enabled !== false}
                    onCheckedChange={(on) => void saveCaptchaPolicy({ ...captcha.policy, enabled: on }, `Verify automatic CAPTCHA ${on ? 'on' : 'off'}`)}
                    aria-label={t('adm_vos_captcha_auto')}
                  />
                  {t('adm_vos_captcha_auto')}
                </label>
              ) : null}
            </div>
            {captcha?.worker && !captcha.worker.unavailable ? (
              <>
                <p className="break-words">
                  {captcha.worker.configured ? (
                    <span className="text-emerald-600">{t('adm_vos_captcha_configured')}: <span className="font-mono">{captcha.worker.keyVariable}</span></span>
                  ) : (
                    <span className="text-amber-600">{t('adm_vos_captcha_not_configured')}</span>
                  )}
                  {captcha.worker.killSwitch ? <span className="text-amber-600"> · {t('adm_vos_captcha_kill_switch')}</span> : null}
                  {captcha.worker.breakerOpen ? <span className="text-amber-600"> · {t('adm_vos_captcha_breaker')}: {captcha.worker.breakerCode}</span> : null}
                </p>
                <p>
                  {t('adm_vos_captcha_today')}: {captcha.worker.usedToday} / {captcha.worker.dailyCap} · {t('adm_vos_captcha_cost_est')}: ${Number(captcha.worker.estCostPerSolveUsd ?? 0).toFixed(3)}
                  {' · '}
                  {captchaBalance === undefined ? (
                    <Button size="sm" variant="ghost" className="h-auto px-1 py-0 text-xs underline" onClick={() => void checkBalance()}>{t('adm_vos_captcha_balance_check')}</Button>
                  ) : (
                    <span>{t('adm_vos_captcha_balance')}: {captchaBalance === null ? '—' : `$${captchaBalance.toFixed(2)}`}</span>
                  )}
                </p>
                {Array.isArray(captcha.worker.recent) && captcha.worker.recent.length ? (
                  <p className="text-muted-foreground break-words">
                    {t('adm_vos_captcha_recent')}: {Object.entries(captcha.worker.recent.reduce((acc: Record<string, number>, e: any) => ({ ...acc, [`${e.provider} ${e.outcome}`]: (acc[`${e.provider} ${e.outcome}`] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(' · ')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-amber-600 break-words">{t('adm_vos_worker_unreachable')} {captcha?.worker?.error ?? ''}</p>
            )}
            {captcha?.policy ? (
              <div className="flex flex-wrap gap-4">
                {(['mygov', 'rstax'] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <Switch
                      checked={captcha.policy.providers?.[p] !== false}
                      disabled={captcha.policy.enabled === false}
                      onCheckedChange={(on) => void saveCaptchaPolicy({ ...captcha.policy, providers: { ...captcha.policy.providers, [p]: on } }, `Verify automatic CAPTCHA ${p} ${on ? 'on' : 'off'}`)}
                    />
                    {t(`verify_ox_prov_${p}`)}
                  </label>
                ))}
              </div>
            ) : null}
            <p>
              {t('adm_vos_captcha_required_count')}: {jobs.reduce((n, j) => n + (j.providers ?? []).filter((o: any) => o.state === 'CAPTCHA_REQUIRED' || o.state === 'CAPTCHA_FAILED').length, 0)} ·{' '}
              {t('adm_vos_captcha_unattended')}: {jobs.reduce((n, j) => n + (Number(j.unattendedVerificationSkips) || 0), 0)}
            </p>
          </div>
        </section>

        {/* ── Developer advertising (Verify's own memo23 stage; separate from Find Buyers) ── */}
        {ads?.policy ? (
          <section className="rounded-lg border border-border p-3 text-xs space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-semibold">{t('adm_vos_ads_title')}</span>
                <span className="block text-xs text-muted-foreground">{t('adm_vos_ads_desc')}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={ads.policy.enabled === true}
                  onCheckedChange={(on) => void saveAdsPolicy({ ...ads.policy, enabled: on }, `Verify developer advertising ${on ? 'on' : 'off'}`)}
                  aria-label={t('adm_vos_ads_enabled')}
                />
                <span className="text-xs">{t('adm_vos_ads_enabled')}</span>
              </span>
            </label>
            {ads.providerOff ? <p className="text-amber-600">{t('adm_vos_ads_provider_off')}</p> : null}
            {ads.configured === false ? <p className="text-amber-600">{t('adm_vos_ads_not_configured')}</p> : null}
            <p className="text-muted-foreground break-words">
              <span className="font-mono">{ads.policy.actorId}</span> · {t('adm_vos_ads_limits')}: {ads.policy.country} · {ads.policy.maxTerms} × {ads.policy.maxItems} · ≤ ${Number(ads.policy.maxChargeUsd).toFixed(2)} · {ads.policy.timeoutSeconds}s · {ads.policy.cacheHours}h
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={adsChecking} onClick={() => void checkAdsSchema()}>
                <FlaskConical className="h-3.5 w-3.5 me-1" aria-hidden="true" />
                {t('adm_vos_ads_check_schema')}
              </Button>
              {ads.schema?.error ? <span className="text-amber-600 break-words">{String(ads.schema.error)}</span> : null}
            </div>
            {ads.schema && !ads.schema.error ? (
              ads.schema.supported ? (
                <p className="break-words">
                  {t('adm_vos_ads_supported')}: <span className="font-mono">{(ads.schema.inputFieldsUsed ?? []).join(', ')}</span>
                  {ads.schema.pricing?.pricePer1kUsd != null ? ` · $${Number(ads.schema.pricing.pricePer1kUsd).toFixed(2)} / 1k` : ` · ${ads.schema.pricing?.model ?? ''}`}
                </p>
              ) : (
                <p className="text-amber-600">{t('adm_vos_ads_unsupported')}</p>
              )
            ) : null}
            {Array.isArray(ads.recent) && ads.recent.length ? (
              <p className="text-muted-foreground break-words">
                {t('adm_vos_ads_recent')}: {Object.entries(ads.recent.reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.state ?? '?']: (acc[r.state ?? '?'] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(' · ')}
                {' · $'}{ads.recent.reduce((n: number, r: any) => n + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0).toFixed(3)}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ── Market research ── */}
        <section className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold">{t('adm_vos_market_title')}</span>
              <span className="block text-xs text-muted-foreground">{t('adm_vos_market_desc')}</span>
            </span>
            <Switch
              checked={marketOn}
              onCheckedChange={async (on) => {
                try {
                  await updateAdminSetting('verify_marketplace_market_enabled', on, `Verify marketplace comparables ${on ? 'on' : 'off'}`);
                  setMarketOn(on);
                  toast.success(t('adm_vos_saved'));
                } catch (e: any) {
                  toast.error(e?.message ?? String(e));
                }
              }}
            />
          </label>
        </section>

        {/* ── Recent jobs ── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('adm_vos_recent_jobs')}</h3>
          {jobs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-start">
                    <th className="py-1 pe-3 text-start">{t('adm_vos_job')}</th>
                    <th className="py-1 pe-3 text-start">TAS</th>
                    <th className="py-1 pe-3 text-start">{t('adm_vos_documents')}</th>
                    <th className="py-1 pe-3 text-start">{t('adm_vos_attachments')}</th>
                    <th className="py-1 pe-3 text-start">{t('adm_vos_market')}</th>
                    <th className="py-1 pe-3 text-start">AI</th>
                    <th className="py-1 pe-3 text-start">{t('adm_vos_duration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const acc = j.tas?.accounting;
                    const o = acc?.attachmentOutcomes ?? {};
                    const mk = j.market?.marketplace;
                    return (
                      <tr key={j.id} className="border-t border-border align-top">
                        <td className="py-1.5 pe-3"><span className="font-mono">{j.id}</span><br /><span className="text-muted-foreground">{j.status} · {j.query}</span></td>
                        <td className="py-1.5 pe-3">
                          {j.tas?.execution?.implementation ?? '—'}{j.tas?.execution?.fallbackFrom ? ` ↩ ${j.tas.execution.fallbackFrom}` : ''}
                          <br /><span className="text-muted-foreground">{j.tas?.status ?? ''}</span>
                          {j.tas?.officialStatus ? (
                            <><br /><span>{t('adm_vos_status')}: {j.tas.officialStatus.state}{j.tas.officialStatus.since ? ` · ${j.tas.officialStatus.since}` : ''}{j.tas.officialStatus.conclusive ? '' : ' ?'}</span></>
                          ) : null}
                          {j.tas?.ledger?.incomplete ? (
                            <><br /><span className="text-amber-600">{t('adm_vos_incomplete')}: {(j.tas.ledger.incompleteReasons ?? []).join(', ')}</span></>
                          ) : null}
                        </td>
                        <td className="py-1.5 pe-3">{acc ? `${acc.detailsRead}/${acc.documents}` : j.tas?.documents ?? '—'}{j.tas?.reconciliation ? (j.tas.reconciliation.reconciled ? ' ✓' : ' ≠') : ''}</td>
                        <td className="py-1.5 pe-3">{acc ? `${acc.attachments} · ${t('adm_vos_read')} ${(o.READ_TEXT ?? 0) + (o.LOW_TEXT ?? 0)} · ${t('adm_vos_scan')} ${o.SCAN_OR_IMAGE_ONLY ?? 0} · ${t('adm_vos_unsupported')} ${o.UNSUPPORTED_FORMAT ?? 0} · ${t('adm_vos_skipped')} ${(o.NOT_PROCESSED_BUDGET ?? 0) + (o.DOWNLOAD_FAILED ?? 0)}` : '—'}<br /><span className="text-muted-foreground">{t('adm_vos_visuals')}: {j.visuals}{j.tas?.funnel ? ` · ${t('adm_vos_deferred')} ${j.tas.funnel.deferredAttachments} · ${t('adm_vos_milestones')} ${j.tas.funnel.milestones}` : ''}</span></td>
                        <td className="py-1.5 pe-3">{mk ? `MyHome ${mk.myhome?.listings ?? 0} · SS.ge ${mk.ssge?.listings ?? 0} · ${t('adm_vos_duplicates')} ${mk.crossPlatformDuplicatesRemoved ?? 0} · +${mk.added ?? 0} = ${mk.finalComparableCount ?? '?'}` : mk === null ? '—' : ''}{mk?.state ? ` (${mk.state})` : ''}</td>
                        <td className="py-1.5 pe-3">{j.ai?.researchTokens ? `${j.ai.researchTokens.input}/${j.ai.researchTokens.output}` : '—'}{j.ai?.synthesis ? ` + ${j.ai.synthesis.inputTokens ?? '?'}/${j.ai.synthesis.outputTokens ?? '?'}` : ''}</td>
                        <td className="py-1.5 pe-3 tabular-nums">{secs(j.durationMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('adm_vos_no_data')}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
