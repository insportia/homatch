// FIND BUYERS — admin tools for a controlled live test (2026-10-16), inside the
// Actors tab of the Find Buyers control center:
//
//   Register & verify   Actors HOMATCH knows (REGISTRY_SEEDS) but has not registered:
//                       the server writes them DISABLED, then reads their price and input
//                       schema from Apify. Free; enabling stays a separate switch.
//   Test cap            one campaign's provider ceiling for one property (testCap.ts):
//                       consumed by the next campaign started for it, once. Global pricing
//                       and every other owner are untouched.
//   Comment audit       how a campaign's Facebook post results reported comment counts,
//                       read from stored datasets (no Actor run, no charge, no text shown).
//   Re-check results    every stored lead of a property's searches judged again with the
//                       current qualification: preview first, then apply (no charge; nothing
//                       deleted — the previous reading stays in qualification.before).

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { auditCommentCounts, getFindBuyersTestCap, requalifyProperty, setFindBuyersSetting, usd, verifyActorFromApify, type RequalifySummary } from '@/services/findBuyers';
import { REGISTRY_SEEDS } from '@/findBuyers/actorCatalog';
import { parseTestCap, TEST_CAP_MAX_USD } from '@/findBuyers/testCap';

const FIELD = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function FindBuyersTestTools({ registered, onChanged }: { registered: string[]; onChanged: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [cap, setCap] = useState<ReturnType<typeof parseTestCap>>(null);
  const [propertyId, setPropertyId] = useState('');
  const [capUsd, setCapUsd] = useState('3');
  const [hours, setHours] = useState('48');
  const [jobId, setJobId] = useState('');
  const [audit, setAudit] = useState<unknown>(null);
  const [rqProperty, setRqProperty] = useState('');
  const [rqPreview, setRqPreview] = useState<{ propertyId: string; rows: RequalifySummary[] } | null>(null);
  const [rqApplied, setRqApplied] = useState<RequalifySummary[] | null>(null);

  const loadCap = useCallback(async () => {
    try { setCap(parseTestCap(await getFindBuyersTestCap())); } catch { setCap(null); }
  }, []);
  useEffect(() => { void loadCap(); }, [loadCap]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const unregistered = Object.values(REGISTRY_SEEDS).filter((s) => !registered.includes(s.actor_key));
  const capValue = Number(capUsd);
  const capValid = UUID.test(propertyId.trim()) && Number.isFinite(capValue) && capValue > 0 && capValue <= TEST_CAP_MAX_USD
    && Number(hours) >= 1 && Number(hours) <= 168;

  return (
    <div className="space-y-3" data-testid="fbx-test-tools">
      {unregistered.map((s) => (
        <div key={s.actor_key} className="rounded-xl border border-dashed border-border p-3" data-testid="fbx-actor-unregistered">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{s.actor_key} <span className="text-2xs font-normal text-muted-foreground">· {s.source} · {s.purpose}</span></p>
              <p className="break-all text-2xs text-muted-foreground" dir="ltr">{s.actor_id}</p>
              <p className="mt-1 text-2xs text-muted-foreground">{t('fbx_admin_not_registered')}</p>
            </div>
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => run(s.actor_key, async () => {
                const r = await verifyActorFromApify(s.actor_key);
                if (!r.success) throw new Error(r.error ?? 'verify failed');
                toast.success(t('fbx_admin_verified'));
                onChanged();
              })}>
              {busy === s.actor_key ? <Loader2 className="me-1 h-3.5 w-3.5 motion-safe:animate-spin" /> : <ShieldCheck className="me-1 h-3.5 w-3.5" />}
              {t('fbx_admin_register_verify')}
            </Button>
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-border p-3" data-testid="fbx-test-cap">
        <p className="text-sm font-semibold">{t('fbx_admin_test_cap_title')}</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">{t('fbx_admin_test_cap_hint')}</p>
        <p className="mt-2 text-2xs" data-testid="fbx-test-cap-current">
          {cap ? (
            <>
              <span dir="ltr">{t('fbx_admin_test_cap_current', { usd: usd(Math.round(cap.providerUsd * 1_000_000)), property: cap.propertyId, until: new Date(cap.expiresAt).toLocaleString() })}</span>
              {cap.consumedBy ? <span className="ms-1 font-semibold">· {t('fbx_admin_test_cap_consumed', { job: cap.consumedBy })}</span> : null}
            </>
          ) : t('fbx_admin_test_cap_none')}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto_auto] sm:items-end">
          <label className="text-2xs">{t('fbx_admin_test_cap_property')}
            <input className={FIELD} dir="ltr" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} data-testid="fbx-test-cap-property" />
          </label>
          <label className="text-2xs">{t('fbx_admin_test_cap_usd')}
            <input className={FIELD} dir="ltr" inputMode="decimal" value={capUsd} onChange={(e) => setCapUsd(e.target.value)} data-testid="fbx-test-cap-usd" />
          </label>
          <label className="text-2xs">{t('fbx_admin_test_cap_hours')}
            <input className={FIELD} dir="ltr" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <Button size="sm" disabled={!capValid || busy !== null} data-testid="fbx-test-cap-save"
            onClick={() => run('cap', async () => {
              await setFindBuyersSetting('find_buyers_test_cap', {
                propertyId: propertyId.trim(), providerUsd: Math.round(capValue * 100) / 100,
                expiresAt: new Date(Date.now() + Number(hours) * 3_600_000).toISOString(), consumedBy: null,
              });
              toast.success(t('fbx_admin_saved'));
              await loadCap();
            })}>{t('fbx_admin_test_cap_save')}</Button>
          <Button size="sm" variant="ghost" disabled={!cap || busy !== null}
            onClick={() => run('cap-clear', async () => { /* value is NOT NULL: {} is "no cap" (parseTestCap). */ await setFindBuyersSetting('find_buyers_test_cap', {}); await loadCap(); })}>
            {t('fbx_admin_test_cap_clear')}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border p-3" data-testid="fbx-comment-audit">
        <p className="text-sm font-semibold">{t('fbx_admin_comment_audit_title')}</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">{t('fbx_admin_comment_audit_hint')}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-2xs">{t('fbx_admin_comment_audit_job')}
            <input className={FIELD} dir="ltr" value={jobId} onChange={(e) => setJobId(e.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={!UUID.test(jobId.trim()) || busy !== null}
            onClick={() => run('audit', async () => setAudit(await auditCommentCounts(jobId.trim())))}>
            {busy === 'audit' ? <Loader2 className="me-1 h-3.5 w-3.5 motion-safe:animate-spin" /> : null}{t('fbx_admin_comment_audit_run')}
          </Button>
        </div>
        {audit ? <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 p-2 text-2xs" dir="ltr">{JSON.stringify(audit, null, 2)}</pre> : null}
      </div>

      {/* Re-check stored results with the current rules: a preview, then an explicit apply. */}
      <div className="rounded-xl border border-border p-3" data-testid="fbx-requalify">
        <p className="text-sm font-semibold">{t('fbx_admin_requalify_title')}</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">{t('fbx_admin_requalify_hint')}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-2xs">{t('fbx_admin_requalify_property')}
            <input className={FIELD} dir="ltr" value={rqProperty} data-testid="fbx-requalify-property"
              onChange={(e) => { setRqProperty(e.target.value); setRqPreview(null); setRqApplied(null); }} />
          </label>
          <Button size="sm" variant="outline" disabled={!UUID.test(rqProperty.trim()) || busy !== null} data-testid="fbx-requalify-preview"
            onClick={() => run('rq-preview', async () => {
              const id = rqProperty.trim();
              setRqApplied(null);
              setRqPreview({ propertyId: id, rows: await requalifyProperty(id, false) });
            })}>
            {busy === 'rq-preview' ? <Loader2 className="me-1 h-3.5 w-3.5 motion-safe:animate-spin" /> : null}{t('fbx_admin_requalify_preview')}
          </Button>
          <Button size="sm" disabled={!rqPreview || rqPreview.propertyId !== rqProperty.trim() || busy !== null} data-testid="fbx-requalify-apply"
            onClick={() => run('rq-apply', async () => {
              const rows = await requalifyProperty(rqPreview!.propertyId, true);
              setRqApplied(rows);
              toast.success(t('fbx_admin_requalify_done'));
            })}>
            {busy === 'rq-apply' ? <Loader2 className="me-1 h-3.5 w-3.5 motion-safe:animate-spin" /> : null}{t('fbx_admin_requalify_apply')}
          </Button>
        </div>
        {(rqApplied ?? rqPreview?.rows) && (
          <table className="mt-2 w-full text-2xs" data-testid="fbx-requalify-table">
            <thead><tr className="text-start text-muted-foreground"><th className="py-1 text-start">{t('fbx_admin_comment_audit_job')}</th><th className="text-end">{t('fbx_admin_requalify_shown_now')}</th><th className="text-end">{t('fbx_admin_requalify_shown_after')}</th></tr></thead>
            <tbody>
              {(rqApplied ?? rqPreview!.rows).map((r) => {
                const shown = (r.after.STRONG ?? 0) + (r.after.POTENTIAL ?? 0) + (r.after.WEAK ?? 0);
                return (
                  <tr key={r.jobId} className="border-t border-border">
                    <td className="py-1 font-mono" dir="ltr">{r.jobId.slice(0, 8)}{r.error ? ` · ${r.error}` : ''}</td>
                    <td className="text-end tabular-nums">{r.before}</td>
                    <td className="text-end tabular-nums">{shown} <span className="text-muted-foreground">({r.after.STRONG ?? 0}/{r.after.POTENTIAL ?? 0}/{r.after.WEAK ?? 0})</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default FindBuyersTestTools;
