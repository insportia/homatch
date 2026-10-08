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

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const secs = (ms?: number | null) => (typeof ms === 'number' ? `${Math.round(ms / 100) / 10}s` : '—');

async function invokeAdmin(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('research-agent', { body: { action, ...extra } });
  if (error) throw error;
  return data as any;
}

export function VerifyOfficialSourcesPanel() {
  const { t } = useLanguage();
  const [setting, setSetting] = useState<TasSetting>({ active: 'LEGACY', fallback: null });
  const [health, setHealth] = useState<ImplHealth[] | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [marketOn, setMarketOn] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, settings, diag] = await Promise.all([
        invokeAdmin('tas-admin-health').catch(() => null),
        getAdminSettings(),
        invokeAdmin('verify-admin-diagnostics', { limit: 15 }).catch(() => null),
      ]);
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

  const save = async (next: TasSetting, reason: string) => {
    setSaving(true);
    try {
      await updateAdminSetting('verify_tas_implementation', next, reason);
      setSetting(next);
      toast.success(t('adm_vos_saved'));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await invokeAdmin('tas-admin-test', { query: testCode.trim() }));
    } catch (e: any) {
      setTestResult({ ok: false, result: { error: e?.message ?? String(e) } });
    } finally {
      setTesting(false);
    }
  };

  // ACTIVATE is offered only after a TEST in this session actually passed.
  const testPassed = testResult?.ok === true;
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
              onClick={() => void save({ active: 'API_FIRST', fallback: 'LEGACY' }, `TAS API_FIRST activated after TEST ${testCode.trim()}`)}
              disabled={saving || !testPassed || setting.active === 'API_FIRST'}
              title={testPassed ? undefined : t('adm_vos_activate_requires_test')}
            >
              <Zap className="me-1.5 h-4 w-4" />
              {t('adm_vos_activate')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void save({ active: 'LEGACY', fallback: null }, 'TAS rollback to LEGACY')}
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
          <ul className="space-y-1 text-xs">
            <li className="flex flex-wrap items-center gap-2"><span className="font-medium">NAPR / MyGov Service176</span><Badge variant="secondary">{t('adm_vos_pending_integration')}</Badge></li>
            <li className="flex flex-wrap items-center gap-2"><span className="font-medium">RS.ge</span><Badge variant="secondary">{t('adm_vos_pending_integration')}</Badge></li>
          </ul>
        </section>

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
                        <td className="py-1.5 pe-3">{acc ? `${acc.attachments} · ${t('adm_vos_read')} ${(o.READ_TEXT ?? 0) + (o.LOW_TEXT ?? 0)} · scan ${o.SCAN_OR_IMAGE_ONLY ?? 0} · ${t('adm_vos_unsupported')} ${o.UNSUPPORTED_FORMAT ?? 0} · ${t('adm_vos_skipped')} ${(o.NOT_PROCESSED_BUDGET ?? 0) + (o.DOWNLOAD_FAILED ?? 0)}` : '—'}<br /><span className="text-muted-foreground">{t('adm_vos_visuals')}: {j.visuals}{j.tas?.funnel ? ` · ${t('adm_vos_deferred')} ${j.tas.funnel.deferredAttachments} · milestones ${j.tas.funnel.milestones}` : ''}</span></td>
                        <td className="py-1.5 pe-3">{mk ? `MH ${mk.myhome?.listings ?? 0} · SS ${mk.ssge?.listings ?? 0} · dup ${mk.crossPlatformDuplicatesRemoved ?? 0} · +${mk.added ?? 0} = ${mk.finalComparableCount ?? '?'}` : mk === null ? '—' : ''}{mk?.state ? ` (${mk.state})` : ''}</td>
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
