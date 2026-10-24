// SENDING DOMAINS — /outreach/email/domains
//
// A customer connects their own domain (ideally a subdomain such as mail.company.com),
// adds the DNS records Resend issues, and verifies. Status comes from Resend only: a
// domain is VERIFIED when Resend says so, never because it was typed. Sending records
// are separate from receiving: nothing here asks anyone to change their MX records,
// and replies keep arriving in the HOMATCH inbox through HOMATCH's reply routing.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Copy, Globe2, Loader2, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { EmailSettingsTabs } from '@/components/emailStudio/EmailSettingsTabs';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { PageHeader } from '@/components/communications/primitives';
import {
  type SendingDomain, EmailMarketingError, addDomain, disconnectDomain, listDomains, refreshDomain, setDomainSender, verifyDomainNow,
} from '@/services/emailMarketing';

const ADD_ERR: Record<string, string> = {
  INVALID_DOMAIN: 'emd_err_invalid', DOMAIN_RESERVED: 'emd_err_reserved', DOMAIN_IN_USE: 'emd_err_in_use',
  DOMAIN_ALREADY_ADDED: 'emd_err_already', DOMAIN_CAPACITY_REACHED: 'emd_err_capacity', RATE_LIMITED: 'emx_err_rate_limited',
  PROVIDER_NOT_CONFIGURED: 'emx_err_provider', PROVIDER_ERROR: 'emx_err_provider',
};
const TONE: Record<string, string> = {
  VERIFIED: 'bg-[hsl(158_45%_90%)] text-[hsl(158_64%_22%)]', FAILED: 'bg-[hsl(350_60%_95%)] text-[hsl(350_60%_35%)]',
  RESTRICTED: 'bg-[hsl(350_60%_95%)] text-[hsl(350_60%_35%)]',
};

function DomainCard({ d, onChange, onRemove }: { d: SendingDomain; onChange: (d: SendingDomain) => void; onRemove: (d: SendingDomain) => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState(d.sender_local_part ?? 'marketing');
  const [name, setName] = useState(d.sender_name ?? '');
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success(t('emd_copied')); } catch { toast.error(t('emd_copy_failed')); } };
  const run = async (label: string, fn: () => Promise<SendingDomain | void>) => {
    setBusy(label);
    try { const r = await fn(); if (r) onChange(r); } catch (e) { toast.error(t(ADD_ERR[e instanceof EmailMarketingError ? e.code : ''] ?? 'emd_action_failed')); } finally { setBusy(null); }
  };
  return (
    <article className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold"><Globe2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate" dir="ltr">{d.domain}</span></h3>
        <span className={cn('rounded-full px-2.5 py-0.5 text-2xs font-semibold', TONE[d.status] ?? 'bg-muted')}>{t(`emd_status_${d.status.toLowerCase()}`)}</span>
      </div>
      {d.status !== 'VERIFIED' && (
        <div className="space-y-2">
          <p className="text-2xs text-muted-foreground">{t('emd_records_note')}</p>
          <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-border">
            <table className="w-full min-w-[34rem] text-start text-2xs">
              <thead className="bg-muted/50"><tr>{['emd_col_type', 'emd_col_name', 'emd_col_value', 'emd_col_status'].map((k) => <th key={k} scope="col" className="px-2.5 py-2 text-start font-semibold">{t(k)}</th>)}</tr></thead>
              <tbody>
                {(d.records ?? []).map((r, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-2.5 py-2 font-mono">{r.type}{r.priority != null ? ` ${r.priority}` : ''}</td>
                    <td className="px-2.5 py-2"><button type="button" onClick={() => void copy(r.name)} className="inline-flex max-w-[12rem] items-center gap-1 break-all font-mono hover:underline" dir="ltr">{r.name}<Copy className="h-3 w-3 shrink-0" aria-hidden="true" /></button></td>
                    <td className="px-2.5 py-2"><button type="button" onClick={() => void copy(r.value)} className="inline-flex max-w-[18rem] items-center gap-1 break-all text-start font-mono hover:underline" dir="ltr">{r.value}<Copy className="h-3 w-3 shrink-0" aria-hidden="true" /></button></td>
                    <td className="px-2.5 py-2">{r.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-1.5 rounded-lg bg-[hsl(42_100%_96%)] p-2.5 text-2xs text-[hsl(34_90%_28%)]"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('emd_mx_warning')}</p>
        </div>
      )}
      {d.status === 'VERIFIED' && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-2xs font-semibold">{t('emd_sender_address')}
            <span className="mt-1 flex items-center gap-1 rounded-xl bg-background px-3 ring-1 ring-inset ring-border" dir="ltr">
              <input value={local} onChange={(e) => setLocal(e.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
              <span className="shrink-0 text-sm text-muted-foreground">@{d.domain}</span>
            </span>
          </label>
          <label className="block text-2xs font-semibold">{t('emd_sender_name')}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} dir="auto" className="mt-1 h-10 w-full rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border" />
          </label>
          <Button disabled={busy !== null} onClick={() => void run('sender', async () => { await setDomainSender(d.id, local, name); toast.success(t('emd_sender_saved')); return { ...d, sender_local_part: local.toLowerCase(), sender_name: name || null }; })}>
            {busy === 'sender' ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="me-2 h-4 w-4" aria-hidden="true" />}{t('emd_save_sender')}
          </Button>
        </div>
      )}
      {d.last_error ? <p className="text-2xs text-[hsl(350_60%_40%)]">{t('emd_last_error')}: {d.last_error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {d.status !== 'VERIFIED' && (
          <Button size="sm" disabled={busy !== null} onClick={() => void run('verify', () => verifyDomainNow(d.id))}>
            {busy === 'verify' ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="me-2 h-4 w-4" aria-hidden="true" />}{t('emd_verify')}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('refresh', () => refreshDomain(d.id))}>
          <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{t('emd_check_status')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onRemove(d)}><Trash2 className="me-2 h-4 w-4" aria-hidden="true" />{t('emd_disconnect')}</Button>
      </div>
      {d.last_checked_at && <p className="text-2xs text-muted-foreground">{t('emd_checked_at', { at: new Date(d.last_checked_at).toLocaleString() })}</p>}
    </article>
  );
}

export default function EmailDomainsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  /* Opened from a campaign's Sender step (?return=…): a way straight back to it. */
  const [params] = useSearchParams();
  const returnTo = /^\/outreach\/email\/[\w/?=&%-]*$/.test(params.get('return') ?? '') ? params.get('return') : null;
  const [domains, setDomains] = useState<SendingDomain[] | null>(null);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SendingDomain | null>(null);

  const load = useCallback(async () => {
    try { setDomains(await listDomains()); } catch { setDomains([]); toast.error(t('emd_load_failed')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setAdding(true);
    try { const d = await addDomain(input); setDomains((all) => [...(all ?? []), d]); setInput(''); toast.success(t('emd_added')); }
    catch (e) { toast.error(t(ADD_ERR[e instanceof EmailMarketingError ? e.code : ''] ?? 'emd_action_failed')); }
    finally { setAdding(false); }
  };
  const remove = async () => {
    if (!removing) return;
    try { await disconnectDomain(removing.id); setDomains((all) => all?.filter((x) => x.id !== removing.id) ?? all); toast.success(t('emd_removed')); }
    catch { toast.error(t('emd_action_failed')); } finally { setRemoving(null); }
  };

  return (
    <CommsWorkspace product="email" header={(
      <PageHeader eyebrow={t('dnav_email')} title={t('emd_title')} subtitle={t('emd_subtitle')} />
    )}>
      {returnTo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
          <span className="me-auto">{t('ems_domains_return_note')}</span>
          <Button size="sm" className="h-8" onClick={() => navigate(returnTo)}>{t('ems_back_to_campaign')}</Button>
        </div>
      ) : null}
      <EmailSettingsTabs />
      <div className="space-y-4 pb-16">
        <form className="flex flex-col gap-2 rounded-2xl border bg-card p-4 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="block min-w-0 flex-1 text-2xs font-semibold">{t('emd_add_label')}
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="mail.company.com" dir="ltr" autoComplete="off"
              className="mt-1 h-10 w-full rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
            <span className="mt-1 block font-normal text-muted-foreground">{t('emd_subdomain_tip')}</span>
          </label>
          <Button type="submit" disabled={adding || !input.trim()}>{adding ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="me-2 h-4 w-4" aria-hidden="true" />}{t('emd_add')}</Button>
        </form>
        <p className="text-2xs text-muted-foreground">{t('emd_default_sender_note')}</p>
        {domains === null ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('emx_loading')}</div>
          : domains.length === 0 ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('emd_empty')}</p>
            : <div className="grid gap-3">{domains.map((d) => <DomainCard key={d.id} d={d} onChange={(n) => setDomains((all) => all?.map((x) => (x.id === n.id ? n : x)) ?? all)} onRemove={setRemoving} />)}</div>}
      </div>
      <AlertDialog open={removing !== null} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('emd_disconnect_title', { domain: removing?.domain ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('emd_disconnect_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>{t('emd_disconnect')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}
