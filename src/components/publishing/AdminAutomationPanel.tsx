// Admin: the backend browser worker on one portal.
//
// What it can do there and how sure we are (verification level per operation),
// the HOMATCH account's captured session and its real check, the owner's two
// switches — run automation at all, and (separately, with explicit approval)
// let it press the portal's final publish button — and the live operations with
// their stages and screenshots. Nothing here starts a portal action by itself.

import { ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { dateTime, useErrorText } from '@/components/publishing/parts';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { PortalId } from '@/publishing/model';
import { type AdminAccountsView, type AdminOperation, PublishingError, adminOperations, adminSetAutomation } from '@/services/publishing';

const LEVEL_TONE: Record<string, string> = {
  NOT_EXPLORED: 'text-muted-foreground', FIXTURE_TESTED: 'text-amber-800', LIVE_NAVIGATION_VERIFIED: 'text-sky-800', LIVE_OPERATION_VERIFIED: 'text-emerald-800',
};
/** A shell command, the same in every language. */
const captureCommand = (portal: string) => `node scripts/publishing/capture-session.mjs ${portal}`;
const KINDS = ['CHECK_SESSION', 'CREATE', 'STATUS', 'UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE'];

export function AdminAutomationPanel({ portalId, entry, onChanged }: { portalId: PortalId; entry: AdminAccountsView['accounts'][number]; onChanged: () => Promise<void> }) {
  const { t, lang } = useLanguage();
  const errorText = useErrorText();
  const [ops, setOps] = useState<AdminOperation[] | null>(null);
  const [shots, setShots] = useState<Array<{ operation_id: string; stage: string | null; url: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await adminOperations({ portalId }); setOps(r.operations); setShots(r.artifacts); } catch { setOps([]); }
  }, [portalId]);
  useEffect(() => { void load(); }, [load]);
  const browser = entry.browser ?? {};
  if (!Object.values(browser).some((l) => l !== 'NOT_EXPLORED')) {
    return <p className="text-sm text-muted-foreground" data-testid="admin-automation-none">{t('pubw_auto_no_adapter')}</p>;
  }
  const a = entry.account;
  const set = async (patch: Parameters<typeof adminSetAutomation>[1]) => {
    setBusy(true);
    try { await adminSetAutomation(portalId, patch); await onChanged(); toast.success(t('pubw_auto_saved')); } catch (e) { toast.error(errorText(e instanceof PublishingError ? e.code : 'NETWORK_ERROR')); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="admin-automation">
      <div>
        <p className="mb-1 text-2xs font-semibold text-muted-foreground">{t('pubw_auto_levels')}</p>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[420px]:grid-cols-2">
          {KINDS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-2" data-testid={`admin-auto-level-${k}`}>
              <span>{t(`pubw_op_${k.toLowerCase()}`)}</span>
              <span className={cn('text-end text-2xs font-semibold', LEVEL_TONE[browser[k] ?? 'NOT_EXPLORED'])}>{t(`pubw_level_${(browser[k] ?? 'NOT_EXPLORED').toLowerCase()}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-secondary/40 p-3 text-sm" data-testid="admin-auto-session">
        <p className="font-semibold">{t('pubw_auto_session')}: {t(`pubw_session_${(entry.session?.status ?? 'none').toLowerCase()}`)}</p>
        {entry.session ? <p className="text-2xs text-muted-foreground">{t('pubw_auto_session_meta', { saved: dateTime(entry.session.saved_at, lang), checked: entry.session.verified_at ? dateTime(entry.session.verified_at, lang) : '—' })}</p> : null}
        <p className="mt-2 text-2xs text-muted-foreground">{t('pubw_auto_capture_how')}</p>
        <code className="mt-1 block overflow-x-auto rounded-lg bg-[#0C1119] px-3 py-2 text-2xs text-white" dir="ltr">{captureCommand(portalId)}</code>
      </div>

      <label className="flex items-start justify-between gap-3 text-sm">
        <span><span className="block font-semibold">{t('pubw_auto_enable')}</span><span className="block text-2xs text-muted-foreground">{t('pubw_auto_enable_note')}</span></span>
        <Switch checked={!!a.automation_enabled} disabled={busy || a.status === 'NOT_CONFIGURED'} onCheckedChange={(on) => void set({ enabled: on })} data-testid="admin-auto-enabled" />
      </label>
      <label className="flex items-start justify-between gap-3 text-sm">
        <span><span className="block font-semibold">{t('pubw_auto_live')}</span><span className="block text-2xs text-muted-foreground">{t('pubw_auto_live_note')}</span>
          {a.live_submit_approved_at ? <span className="block text-2xs text-muted-foreground">{t('pubw_auto_live_since', { when: dateTime(a.live_submit_approved_at, lang) })}</span> : null}</span>
        <Switch checked={!!a.live_submit_approved} disabled={busy || !a.automation_enabled} data-testid="admin-auto-live"
          onCheckedChange={(on) => { if (!on) void set({ liveSubmit: false }); else if (window.confirm(t('pubw_auto_live_confirm'))) void set({ liveSubmit: true, confirm: 'APPROVE_LIVE_PUBLISHING' }); }} />
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between"><p className="text-2xs font-semibold text-muted-foreground">{t('pubw_auto_operations')}</p>
          <button type="button" className="text-2xs font-semibold text-[hsl(var(--gold-ink))]" onClick={() => void load()}>{t('pubw_admin_refresh')}</button></div>
        {ops === null ? <Loader2 className="h-4 w-4 animate-spin" aria-label={t('pubw_loading')} /> : ops.length === 0 ? <p className="text-2xs text-muted-foreground">{t('pubw_auto_no_operations')}</p> : (
          <ul className="space-y-1.5" data-testid="admin-auto-operations">
            {ops.slice(0, 15).map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 text-2xs">
                <span className="font-semibold">{t(`pubw_op_${o.kind.toLowerCase()}`)} · {t(`pubw_opstatus_${o.status.toLowerCase()}`)}{o.stage ? ` · ${t(`pubw_stage_${o.stage.toLowerCase()}`)}` : ''}{o.last_error ? ` · ${errorText(o.last_error.split(':')[0])}` : ''}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {shots.filter((s) => s.operation_id === o.id && s.url).slice(0, 3).map((s, i) => <a key={i} href={s.url!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[hsl(var(--gold-ink))]">{s.stage ? t(`pubw_stage_${s.stage.toLowerCase()}`) : t('pubw_auto_screenshot')}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>)}
                  {dateTime(o.updated_at, lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
