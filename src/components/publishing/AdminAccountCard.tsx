// Admin: the HOMATCH account on one portal.
//
// What HOMATCH publishes through: the account's identity (login name / e-mail —
// never a password; HOMATCH does not ask for one), the HOMATCH contact phone every
// listing posted there carries, how it is used, and its real state. "Connected"
// can only come from a test against the real account through the portal's
// adapter; no adapter has a verified mechanism, so the test answers honestly and
// the account stays "Publishing restricted — posted by hand from the queue".

import { Loader2, ShieldCheck, Unplug } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { dateTime, useErrorText } from '@/components/publishing/parts';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/publishing/contacts';
import type { PortalId } from '@/publishing/model';
import { AdminAutomationPanel } from '@/components/publishing/AdminAutomationPanel';
import { type AdminAccount, PublishingError, adminAccounts, adminDisconnectAccount, adminSaveAccount, adminTestAccount } from '@/services/publishing';

const INPUT = 'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25';
const TONE: Record<AdminAccount['status'], string> = {
  NOT_CONFIGURED: 'bg-secondary text-muted-foreground', CONNECTED: 'bg-emerald-50 text-emerald-800', PUBLISHING_AVAILABLE: 'bg-emerald-50 text-emerald-800',
  AUTH_REQUIRED: 'bg-amber-50 text-amber-900', SESSION_EXPIRED: 'bg-amber-50 text-amber-900', PUBLISHING_RESTRICTED: 'bg-sky-50 text-sky-800',
  TEMPORARILY_UNAVAILABLE: 'bg-red-50 text-red-800', UNSUPPORTED: 'bg-red-50 text-red-800',
};

export function AccountStatusBadge({ status }: { status: AdminAccount['status'] }) {
  const { t } = useLanguage();
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold', TONE[status])} data-testid="admin-account-status" data-status={status}>{t(`pubw_acct_${status.toLowerCase()}`)}</span>;
}

export function useAdminAccounts() {
  const [state, setState] = useState<{ data: Awaited<ReturnType<typeof adminAccounts>> | null; error: string | null }>({ data: null, error: null });
  const load = useCallback(async () => {
    try { setState({ data: await adminAccounts(), error: null }); } catch (e) { setState({ data: null, error: e instanceof PublishingError ? e.code : 'NETWORK_ERROR' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

export function AdminAccountCard({ portalId, portalName }: { portalId: PortalId; portalName: string }) {
  const { t, lang } = useLanguage();
  const errorText = useErrorText();
  const { data, error, reload } = useAdminAccounts();
  const entry = data?.accounts.find((a) => a.portal.id === portalId) ?? null;
  const account = entry?.account ?? null;
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  useEffect(() => { setLabel(account?.account_label ?? ''); setPhone(account?.contact_phone ?? ''); }, [account?.account_label, account?.contact_phone]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await reload(); } catch (e) { toast.error(errorText(e instanceof PublishingError ? e.code : 'NETWORK_ERROR')); } finally { setBusy(null); }
  };
  if (error) return <p className="text-sm text-red-700">{errorText(error)}</p>;
  if (!account) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t('pubw_loading')} />;
  const locale = lang;
  const rows: Array<[string, React.ReactNode]> = [
    ['pubw_acct_method', account.connection_method ? t(`pubw_acct_method_${account.connection_method.toLowerCase()}`) : '—'],
    ['pubw_acct_identity', account.account_label ?? '—'],
    ['pubw_acct_phone', account.contact_phone ? <span dir="ltr">{formatPhone(account.contact_phone)}</span> : '—'],
    ['pubw_acct_session', account.session_expires_at ? dateTime(account.session_expires_at, locale) : t('pubw_acct_no_session')],
    ['pubw_acct_verified', account.verified_at ? dateTime(account.verified_at, locale) : t('pubw_acct_never_verified')],
    ['pubw_acct_last_test', account.verification_result ? errorText(account.verification_result) : '—'],
    ['pubw_acct_last_published', account.last_published_at ? dateTime(account.last_published_at, locale) : '—'],
    ['pubw_acct_failures', String(account.failure_count)],
  ];

  return (
    <div className="space-y-3" data-testid="admin-account">
      <div className="flex flex-wrap items-center gap-2"><AccountStatusBadge status={account.status} /><span className="text-2xs text-muted-foreground">{t(`pubw_acct_${account.status.toLowerCase()}_note`)}</span></div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm min-[420px]:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-2xs text-muted-foreground">{t(k)}</dt><dd className="break-words font-medium text-foreground">{v}</dd></div>)}
      </dl>
      <form className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        void run('save', async () => { const r = await adminSaveAccount(portalId, { accountLabel: label, contactPhone: phone, connectionMethod: 'MANUAL' }); if (r.rerouted) toast.message(t('pubw_acct_rerouted', { n: r.rerouted })); }, t('pubw_acct_saved', { portal: portalName }));
      }}>
        <label className="block min-w-0 space-y-1"><span className="text-2xs font-semibold">{t('pubw_acct_identity')}</span>
          <input className={INPUT} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" maxLength={120} placeholder={t('pubw_acct_identity_ph')} data-testid="admin-account-label" /></label>
        <label className="block min-w-0 space-y-1"><span className="text-2xs font-semibold">{t('pubw_acct_phone')}</span>
          <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" autoComplete="off" placeholder="+995 32 2 00 00 00" data-testid="admin-account-phone" /></label>
        <p className="flex items-start gap-2 text-2xs text-muted-foreground sm:col-span-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('pubw_acct_no_password')}</p>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" size="sm" disabled={busy !== null || !label || !phone} data-testid="admin-account-save">{busy === 'save' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t(account.status === 'NOT_CONFIGURED' ? 'pubw_acct_register' : 'pubw_acct_update')}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null || account.status === 'NOT_CONFIGURED'} data-testid="admin-account-test"
            onClick={() => void run('test', async () => setTestResult((await adminTestAccount(portalId)).result))}>
            {busy === 'test' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t('pubw_admin_test_connection')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-red-700" disabled={busy !== null || account.status === 'NOT_CONFIGURED'} data-testid="admin-account-disconnect"
            onClick={() => { if (window.confirm(t('pubw_acct_disconnect_confirm', { portal: portalName }))) void run('disconnect', () => adminDisconnectAccount(portalId), t('pubw_acct_disconnected')); }}>
            <Unplug className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('pubw_acct_disconnect')}
          </Button>
          {testResult ? <span className="self-center text-2xs font-semibold text-muted-foreground" data-testid="admin-account-test-result">{errorText(testResult)}</span> : null}
        </div>
      </form>
      <div className="border-t border-border pt-3"><h3 className="mb-2 text-sm font-semibold">{t('pubw_auto_title')}</h3><AdminAutomationPanel portalId={portalId} entry={entry!} onChanged={reload} /></div>
    </div>
  );
}
