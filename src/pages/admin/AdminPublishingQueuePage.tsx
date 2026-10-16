// HOMATCH — Admin: Integrations → Publishing queue.
//
// Every publication a customer asked HOMATCH to post that is waiting on a person
// at HOMATCH: posts to make by hand in the HOMATCH account (no portal has a
// verified automated mechanism), removals to make, accounts to connect. One job
// opens the portal-ready copy — the HOMATCH number for the portal's contact
// field, the owner's name and number once at the end of the description (they
// consented) — and the actions that record what happened. Linking the listing
// URL is not "published": the public page check confirms it (or, where HOMATCH
// may not fetch, the admin's attestation, labelled as such).
//
// ACCESS CONTROL IS NOT THIS FILE'S JOB: every call re-checks is_admin() server-side.

import { Check, Copy, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/communications/primitives';
import { CustomerStatusMark, PortalLogo, dateTime, useErrorText } from '@/components/publishing/parts';
import { Button } from '@/components/ui/button';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type PortalId, customerStatus } from '@/publishing/model';
import { type AdminJob, type AdminJobAction, type AdminJobView, PublishingError, adminJob, adminJobAction, adminQueue } from '@/services/publishing';

const INPUT = 'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25';
const FILTERS = [
  { id: 'todo', statuses: ['ADMIN_ACTION_REQUIRED', 'PUBLISHING', 'UNPUBLISH_REQUESTED', 'VERIFICATION_FAILED'] },
  { id: 'auth', statuses: ['AUTH_REQUIRED'] },
  { id: 'verifying', statuses: ['VERIFYING'] },
  { id: 'live', statuses: ['PUBLISHED', 'OWNER_CONFIRMED'] },
  { id: 'closed', statuses: ['REJECTED', 'FAILED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY'] },
] as const;
type FilterId = typeof FILTERS[number]['id'];

export default function AdminPublishingQueuePage() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const errorText = useErrorText();
  const [filter, setFilter] = useState<FilterId>('todo');
  const [portal, setPortal] = useState<PortalId | ''>('');
  const [jobs, setJobs] = useState<AdminJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const statuses = [...FILTERS.find((f) => f.id === filter)!.statuses];
      setJobs((await adminQueue({ statuses, ...(portal ? { portalId: portal } : {}) })).jobs);
    } catch (e) { setError(e instanceof PublishingError ? e.code : 'NETWORK_ERROR'); setJobs([]); }
  }, [filter, portal]);
  useEffect(() => { setJobs(null); void load(); }, [load]);

  return (
    <div className="space-y-5" data-testid="admin-publishing-queue">
      <PageHeader eyebrow={t('pubw_admin_eyebrow')} title={t('pubw_queue_title')} subtitle={t('pubw_queue_subtitle')} secondary={{ label: t('pubw_admin_refresh'), onClick: () => void load() }} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('pubw_queue_filter')} className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`queue-filter-${f.id}`}
              className={cn('min-h-9 rounded-lg px-3 text-2xs font-semibold', filter === f.id ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {t(`pubw_queue_filter_${f.id}`)}
            </button>
          ))}
        </div>
        <select className={cn(INPUT, 'w-auto')} value={portal} onChange={(e) => setPortal(e.target.value as PortalId | '')} aria-label={t('pubw_queue_portal')}>
          <option value="">{t('pubw_queue_all_portals')}</option>
          {['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome'].map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <Link to="/admin/integrations/portals" className="text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline">{t('pubw_queue_accounts_link')}</Link>
      </div>

      {error ? <ErrorState messageKey={error === 'ADMIN_REQUIRED' ? 'pubw_err_admin_required' : 'pubw_admin_load_failed'} detail={error} onRetry={() => void load()} /> : null}
      {jobs === null ? <LoadingBlock rows={4} /> : jobs.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground" data-testid="queue-empty">{t('pubw_queue_empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="queue-jobs">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-2xl border border-border bg-card shadow-card">
              <button type="button" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id} data-testid={`queue-job-${j.id}`}
                className="flex w-full min-w-0 flex-wrap items-center gap-3 p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{j.listing?.title || t('pubw_untitled')}</span>
                  <span className="block text-2xs text-muted-foreground">{[j.portal_id, j.listing?.city, j.listing?.price != null ? `${j.listing.price} ${j.listing.currency}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <CustomerStatusMark status={customerStatus(null, j)} />
                {j.outdated ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-900">{t('pubw_queue_outdated')}</span> : null}
                <span className="text-2xs text-muted-foreground">{dateTime(j.updated_at, locale)}</span>
              </button>
              {open === j.id ? <JobDetail jobId={j.id} onChanged={load} errorText={errorText} locale={locale} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobDetail({ jobId, onChanged, errorText, locale }: { jobId: string; onChanged: () => Promise<void>; errorText: (c: string) => string; locale: string }) {
  const { t } = useLanguage();
  const [view, setView] = useState<AdminJobView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    try { setView(await adminJob(jobId)); } catch (e) { toast.error(errorText(e instanceof PublishingError ? e.code : 'NETWORK_ERROR')); }
  }, [jobId, errorText]);
  useEffect(() => { void load(); }, [load]);
  const act = async (op: AdminJobAction, extra: { externalUrl?: string; reason?: string } = {}) => {
    setBusy(op);
    try { await adminJobAction(jobId, op, extra); toast.success(t(`pubw_queue_done_${op.toLowerCase()}`)); await load(); await onChanged(); } catch (e) {
      toast.error(errorText(e instanceof PublishingError ? e.code : 'NETWORK_ERROR'));
    } finally { setBusy(null); }
  };
  const copies = useMemo(() => Object.entries(view?.copies ?? {}), [view]);
  if (!view) return <div className="border-t border-border p-4"><Loader2 className="h-4 w-4 animate-spin" aria-label={t('pubw_loading')} /></div>;
  const s = view.job.status;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('pubw_copied')); } catch { toast.error(t('pubw_copy_failed')); } };

  return (
    <div className="space-y-4 border-t border-border p-4" data-testid="queue-job-detail">
      <div className="flex flex-wrap items-center gap-3">
        <PortalLogo portal={view.portal} size="sm" />
        <span className="text-sm font-semibold">{view.portal.name}</span>
        <a href={view.portal.createUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{t('pubw_queue_open_portal')}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
        <span className="text-2xs text-muted-foreground">{t('pubw_queue_account', { account: view.account.account_label ?? '—' })}</span>
      </div>
      {view.job.status_reason ? <p className="text-2xs text-red-700">{view.job.status_reason}</p> : null}

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-secondary/40 p-3"><dt className="text-2xs text-muted-foreground">{t('pubw_publish_listing_phone')}</dt>
          <dd className="font-semibold" dir="ltr" data-testid="queue-contact-phone">{copies[0]?.[1].contactPhoneDisplay ?? t('pubw_queue_no_account_phone')}</dd></div>
        <div className="rounded-xl border border-border bg-secondary/40 p-3"><dt className="text-2xs text-muted-foreground">{t('pubw_queue_facts')}</dt>
          <dd className="break-words">{[view.listing.propertyType, view.listing.dealType, view.listing.price != null ? `${view.listing.price} ${view.listing.currency}` : null, view.listing.area ? `${view.listing.area} m²` : null, view.listing.city, view.listing.district, view.listing.street].filter(Boolean).join(' · ')}</dd></div>
      </dl>

      {copies.map(([l, c]) => (
        <div key={l} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs font-semibold uppercase text-muted-foreground">{l} · {c.title}</span>
            <button type="button" className="inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))]" onClick={() => void copy(`${c.title}\n\n${c.description}`)}><Copy className="h-3 w-3" aria-hidden="true" />{t('pubw_copy_text')}</button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-3 font-sans text-sm" dir="auto" data-testid={`queue-copy-${l}`}>{c.description}</pre>
        </div>
      ))}

      {view.photos.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {view.photos.map((p, i) => <li key={p.id}>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" download><img src={p.url} alt={t('pubw_queue_photo', { n: i + 1 })} className="aspect-square w-full rounded-lg object-cover" loading="lazy" /></a> : null}</li>)}
        </ul>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3">
        {s === 'ADMIN_ACTION_REQUIRED' ? <Button size="sm" disabled={busy !== null} onClick={() => void act('claim')} data-testid="queue-claim">{t('pubw_queue_claim')}</Button> : null}
        {['ADMIN_ACTION_REQUIRED', 'PUBLISHING', 'QUEUED', 'VERIFICATION_FAILED'].includes(s) ? (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act('complete', { externalUrl: url }); }}>
            <input className={cn(INPUT, 'flex-1')} value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" placeholder={t('pubw_queue_url_ph', { portal: view.portal.name })} aria-label={t('pubw_queue_url')} data-testid="queue-url" />
            <Button type="submit" size="sm" disabled={busy !== null || !url} data-testid="queue-complete">{busy === 'complete' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="me-1.5 h-3.5 w-3.5" />}{t(view.portal.verification === 'OWNER_CONFIRMED' ? 'pubw_queue_complete_attest' : 'pubw_queue_complete')}</Button>
          </form>
        ) : null}
        {s === 'PUBLISHING' ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act('release')}>{t('pubw_queue_release')}</Button> : null}
        {s === 'VERIFYING' ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act('check')}><RefreshCw className="me-1.5 h-3.5 w-3.5" />{t('pubw_queue_check')}</Button> : null}
        {s === 'UNPUBLISH_REQUESTED' ? <Button size="sm" disabled={busy !== null} onClick={() => void act('confirmRemoved')} data-testid="queue-removed">{t('pubw_queue_confirm_removed')}</Button> : null}
        {view.job.listing_version != null && view.listing.version > view.job.listing_version && ['PUBLISHED', 'OWNER_CONFIRMED'].includes(s) ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act('markUpdated')}>{t('pubw_queue_mark_updated')}</Button> : null}
        {['ADMIN_ACTION_REQUIRED', 'PUBLISHING', 'QUEUED', 'AUTH_REQUIRED', 'VERIFYING', 'VERIFICATION_FAILED'].includes(s) ? (
          <div className="flex flex-wrap gap-2">
            <input className={cn(INPUT, 'flex-1')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('pubw_queue_reason_ph')} aria-label={t('pubw_queue_reason')} data-testid="queue-reason" />
            <Button size="sm" variant="outline" disabled={busy !== null || !reason.trim()} onClick={() => void act('reject', { reason })} data-testid="queue-reject"><X className="me-1.5 h-3.5 w-3.5" />{t('pubw_queue_reject')}</Button>
            <Button size="sm" variant="outline" disabled={busy !== null || !reason.trim()} onClick={() => void act('fail', { reason })}>{t('pubw_queue_fail')}</Button>
          </div>
        ) : null}
      </div>

      {view.events.length ? (
        <ol className="space-y-1 border-t border-border pt-3 text-2xs text-muted-foreground">
          {view.events.slice(0, 10).map((e) => <li key={e.id} className="flex justify-between gap-2"><span>{t(`pubw_event_${e.kind.toLowerCase()}`)}</span><span>{dateTime(e.created_at, locale)}</span></li>)}
        </ol>
      ) : null}
    </div>
  );
}
