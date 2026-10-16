// HOMATCH — Admin: one property portal.
//
// Settings an admin may change (on/off, the create-listing link, the logo, photo
// and description limits, which fields the portal requires, owner confirmation
// instead of page checks) and facts they may not (domains, capabilities, the
// research behind them — those live in publishing-engine/providers.ts). Every
// change is validated server-side and written with an audit row.
//
// THE HOMATCH ACCOUNT on this portal (AdminAccountCard): identity, the HOMATCH
// contact phone, real status. None of the eight portals publishes an authorised
// API, so testing the account asks the adapter — which answers
// CAPABILITY_NOT_SUPPORTED — and listings are posted by hand from the queue.

import { ArrowLeft, ExternalLink, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState, LoadingBlock, ScrollTable } from '@/components/communications/primitives';
import { AdminAccountCard } from '@/components/publishing/AdminAccountCard';
import { PortalLogo, PublicationMark, dateTime, useErrorText } from '@/components/publishing/parts';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  type AdminPublication, type ProviderPatch, PublishingError, adminPublications, adminRecheckProvider, adminRetryPublication, adminUpdateProvider,
} from '@/services/publishing';
import { HealthMark, useAdminPortals } from './AdminPropertyPortalsPage';

const INPUT = 'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25';
const OPERATIONS = ['connectAccount', 'testConnection', 'createListing', 'updateListing', 'deleteListing', 'importListing'] as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-base font-semibold text-foreground">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export default function AdminPropertyPortalPage() {
  const { providerId = '' } = useParams();
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const errorText = useErrorText();
  const { data, error, loading, reload } = useAdminPortals();
  const provider = data?.providers.find((p) => p.id === providerId) ?? null;
  const [form, setForm] = useState<ProviderPatch>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pubs, setPubs] = useState<AdminPublication[] | null>(null);

  useEffect(() => {
    if (!provider) return;
    setForm({ createUrl: provider.createUrlVerified ? provider.createUrl : '', logoUrl: provider.logoUrl ?? '', maxPhotos: provider.maxPhotos, descriptionMax: provider.descriptionMax, requiredFields: provider.requiredFields, verification: provider.verification });
  }, [provider]);
  useEffect(() => {
    if (!provider) return;
    adminPublications(provider.id).then((r) => setPubs(r.publications)).catch(() => setPubs([]));
  }, [provider]);

  const audit = useMemo(() => (data?.audit ?? []).filter((a) => a.provider_id === providerId), [data, providerId]);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await reload(); } catch (e) { toast.error(errorText(e instanceof PublishingError ? e.code : 'NETWORK_ERROR')); } finally { setBusy(null); }
  };

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error) return <ErrorState messageKey={error === 'ADMIN_REQUIRED' ? 'pubw_err_admin_required' : 'pubw_admin_load_failed'} detail={error} onRetry={() => void reload()} />;
  if (!provider) return <ErrorState messageKey="pubw_admin_unknown_portal" detail={providerId} />;

  const termsBlocked = provider.verificationNote === 'TERMS_FORBID_AUTOMATED_ACCESS' || provider.verificationNote === 'BOT_CHALLENGE_ON_PUBLIC_PAGES';
  const fieldKeys = data?.fieldKeys ?? [];
  const toggleField = (k: string) => setForm((f) => ({ ...f, requiredFields: (f.requiredFields ?? []).includes(k) ? (f.requiredFields ?? []).filter((x) => x !== k) : [...(f.requiredFields ?? []), k] }));
  const num = (v: string) => (v === '' ? null : Number(v));
  const failures = (pubs ?? []).filter((p) => p.last_error);

  return (
    <div className="space-y-4" data-testid={`admin-portal-page-${provider.id}`}>
      <Link to="/admin/integrations/portals" className="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />{t('pubw_admin_title')}
      </Link>

      <header className="flex flex-wrap items-center gap-4 rounded-2xl bg-[#0C1119] px-5 py-5 text-white shadow-hover sm:px-7">
        <PortalLogo portal={provider} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">{t('pubw_admin_eyebrow')}</p>
          <h1 className="truncate font-display text-2xl font-bold text-white">{provider.name}</h1>
          <a href={provider.siteUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex items-center gap-1 text-sm text-white/75 hover:text-white">{provider.domains[0]}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
        </div>
        <label className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold">
          <Switch checked={provider.enabled} disabled={busy !== null} data-testid="admin-portal-enabled"
            onCheckedChange={(on) => void run('enabled', () => adminUpdateProvider(provider.id, { enabled: on }), t(on ? 'pubw_admin_enabled_toast' : 'pubw_admin_disabled_toast', { portal: provider.name }))} />
          {t(provider.enabled ? 'pubw_admin_on' : 'pubw_admin_off')}
        </label>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('pubw_admin_capabilities')}>
          <ul className="space-y-1.5" data-testid="admin-portal-capabilities">
            <li className="flex items-center justify-between gap-2 text-sm"><span>{t('pubw_admin_cap_central')}</span><span className="max-w-[55%] text-end text-2xs font-semibold text-sky-800" data-testid="admin-portal-automation">{t(`pubw_automation_${(provider.capabilities.automation ?? 'MANUAL_ADMIN').toLowerCase()}`)}</span></li>
            {provider.capabilities.automationNote ? <li className="text-2xs text-muted-foreground">{t(`pubw_automation_note_${provider.capabilities.automationNote.toLowerCase()}`)}</li> : null}
            <li className="flex items-center justify-between gap-2 text-sm"><span>{t('pubw_admin_cap_manual')}</span><span className="shrink-0 text-end text-2xs font-semibold text-emerald-700">{t('pubw_admin_supported')}</span></li>
            <li className="flex items-center justify-between gap-2 text-sm"><span>{t('pubw_admin_cap_verify')}</span>
              <span className={cn('max-w-[55%] text-end text-2xs font-semibold', provider.verification === 'PAGE_CHECK' ? 'text-emerald-700' : 'text-[hsl(var(--gold-ink))]')}>{t(provider.verification === 'PAGE_CHECK' ? 'pubw_admin_mode_check' : 'pubw_admin_mode_owner')}</span></li>
            {OPERATIONS.map((op) => (
              <li key={op} className="flex items-center justify-between gap-2 text-sm"><span>{t(`pubw_admin_op_${op.toLowerCase()}`)}</span><span className="shrink-0 text-end text-2xs font-semibold text-muted-foreground">{t('pubw_admin_not_available')}</span></li>
            ))}
          </ul>
        </Section>

        <Section title={t('pubw_admin_accounts')}>
          <AdminAccountCard portalId={provider.id} portalName={provider.name} />
        </Section>
      </div>

      <Section title={t('pubw_admin_settings')}>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          // Only what actually changed is sent, so the audit names exactly that.
          const next: ProviderPatch = {
            createUrl: form.createUrl || null, logoUrl: form.logoUrl || null, maxPhotos: form.maxPhotos ?? null,
            descriptionMax: form.descriptionMax ?? null, requiredFields: form.requiredFields ?? [],
            ...(termsBlocked ? {} : { verification: form.verification }),
          };
          const was: ProviderPatch = {
            createUrl: provider.createUrlVerified ? provider.createUrl : null, logoUrl: provider.logoUrl, maxPhotos: provider.maxPhotos,
            descriptionMax: provider.descriptionMax, requiredFields: provider.requiredFields, verification: provider.verification,
          };
          const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k as keyof ProviderPatch]))) as ProviderPatch;
          if (!Object.keys(patch).length) { toast.message(t('pubw_err_nothing_to_update')); return; }
          void run('save', () => adminUpdateProvider(provider.id, patch), t('pubw_admin_saved'));
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2"><span className="text-2xs font-semibold">{t('pubw_admin_create_url')}</span>
              <input className={INPUT} dir="ltr" type="url" value={form.createUrl ?? ''} onChange={(e) => setForm({ ...form, createUrl: e.target.value })} placeholder={provider.siteUrl} data-testid="admin-portal-create-url" />
              <span className="block text-2xs text-muted-foreground">{t('pubw_admin_create_url_hint', { domain: provider.domains[0] })}</span></label>
            <label className="block space-y-1 sm:col-span-2"><span className="text-2xs font-semibold">{t('pubw_admin_logo_url')}</span>
              <input className={INPUT} dir="ltr" type="url" value={form.logoUrl ?? ''} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />
              <span className="block text-2xs text-muted-foreground">{t('pubw_admin_logo_hint')}</span></label>
            <label className="block space-y-1"><span className="text-2xs font-semibold">{t('pubw_admin_max_photos')}</span>
              <input className={INPUT} type="number" min={1} max={100} value={form.maxPhotos ?? ''} onChange={(e) => setForm({ ...form, maxPhotos: num(e.target.value) })} /></label>
            <label className="block space-y-1"><span className="text-2xs font-semibold">{t('pubw_admin_description_max')}</span>
              <input className={INPUT} type="number" min={100} max={50000} value={form.descriptionMax ?? ''} onChange={(e) => setForm({ ...form, descriptionMax: num(e.target.value) })} /></label>
            <label className="block space-y-1 sm:col-span-2"><span className="text-2xs font-semibold">{t('pubw_admin_verification')}</span>
              <select className={INPUT} value={form.verification ?? 'PAGE_CHECK'} disabled={termsBlocked} onChange={(e) => setForm({ ...form, verification: e.target.value as ProviderPatch['verification'] })}>
                <option value="PAGE_CHECK">{t('pubw_admin_mode_check')}</option>
                <option value="OWNER_CONFIRMED">{t('pubw_admin_mode_owner')}</option>
              </select>
              {termsBlocked ? <span className="block text-2xs text-muted-foreground">{t(`pubw_admin_note_${provider.verificationNote!.toLowerCase()}`)}</span> : null}</label>
          </div>
          <fieldset>
            <legend className="mb-1 text-2xs font-semibold">{t('pubw_admin_required_fields')}</legend>
            <p className="mb-2 text-2xs text-muted-foreground">{t('pubw_admin_required_hint')}</p>
            <div className="flex flex-wrap gap-1.5" data-testid="admin-portal-fields">
              {fieldKeys.map((k) => {
                const on = (form.requiredFields ?? []).includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => toggleField(k)} data-testid={`admin-field-${k}`}
                    className={cn('min-h-9 rounded-full border px-3 text-2xs font-semibold', on ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border text-muted-foreground')}>
                    {on ? '* ' : ''}{t(`pubw_field_${k.replace('.', '_').toLowerCase()}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Button type="submit" size="sm" disabled={busy !== null} data-testid="admin-portal-save">{busy === 'save' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t('pubw_admin_save')}</Button>
        </form>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('pubw_admin_health')} aside={
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('recheck', () => adminRecheckProvider(provider.id))} data-testid="admin-portal-recheck">
            {busy === 'recheck' ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="me-1.5 h-3.5 w-3.5" />}{t('pubw_admin_recheck')}
          </Button>}>
          <dl className="grid grid-cols-2 gap-2 text-2xs">
            <div><dt className="text-muted-foreground">{t('pubw_admin_health_status')}</dt><dd><HealthMark status={provider.health.status} /></dd></div>
            <div><dt className="text-muted-foreground">{t('pubw_admin_health_checked')}</dt><dd className="font-semibold">{dateTime(provider.health.checkedAt, locale)}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">{t('pubw_admin_health_detail')}</dt><dd className="font-semibold" dir="ltr">{provider.health.detail ?? '—'}</dd></div>
          </dl>
          <p className="mt-3 text-2xs text-muted-foreground">{t(provider.verification === 'PAGE_CHECK' ? 'pubw_admin_recheck_hint' : 'pubw_admin_recheck_skipped')}</p>
        </Section>

        <Section title={t('pubw_admin_troubleshooting')}>
          <ul className="list-inside list-disc space-y-1 text-2xs text-foreground">
            <li>{t('pubw_admin_tip_manual', { portal: provider.name })}</li>
            <li>{t(provider.verification === 'PAGE_CHECK' ? 'pubw_admin_tip_check' : 'pubw_admin_tip_owner')}</li>
            <li>{t('pubw_admin_tip_url')}</li>
            {!provider.createUrlVerified ? <li>{t('pubw_admin_tip_create_url', { portal: provider.name })}</li> : null}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer text-2xs font-semibold text-muted-foreground">{t('pubw_admin_evidence')}</summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-2xs text-muted-foreground" dir="ltr">{provider.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
          </details>
        </Section>
      </div>

      <Section title={t('pubw_admin_publications')} aside={<span className="text-2xs text-muted-foreground">{pubs ? t('pubw_admin_publications_n', { n: pubs.length }) : ''}</span>}>
        {pubs === null ? <LoadingBlock rows={2} /> : pubs.length === 0 ? <p className="text-2xs text-muted-foreground">{t('pubw_admin_publications_empty')}</p> : (
          <ScrollTable minWidth={640}>
            <table className="w-full text-2xs">
              <thead><tr className="text-start text-muted-foreground">
                <th className="py-1.5 text-start font-semibold">{t('pubw_admin_col_status')}</th>
                <th className="py-1.5 text-start font-semibold">{t('pubw_publication_url')}</th>
                <th className="py-1.5 text-start font-semibold">{t('pubw_last_sync')}</th>
                <th className="py-1.5 text-start font-semibold">{t('pubw_admin_col_error')}</th>
                <th className="py-1.5" />
              </tr></thead>
              <tbody>
                {pubs.map((p) => (
                  <tr key={p.id} className="border-t border-border align-top">
                    <td className="py-2 pe-2"><PublicationMark status={p.status} /></td>
                    <td className="max-w-[16rem] py-2 pe-2">{p.external_url ? <a href={p.external_url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block truncate text-[hsl(var(--gold-ink))] hover:underline">{p.external_url}</a> : '—'}</td>
                    <td className="py-2 pe-2">{dateTime(p.last_checked_at, locale)}</td>
                    <td className="py-2 pe-2">{p.last_error ? errorText(p.last_error) : '—'}</td>
                    <td className="py-2 text-end">{p.status === 'VERIFICATION_FAILED' ? (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(`retry-${p.id}`, async () => { await adminRetryPublication(p.id); setPubs((await adminPublications(provider.id)).publications); }, t('pubw_admin_retried'))}>
                        <RotateCcw className="me-1 h-3.5 w-3.5" />{t('pubw_retry_verification')}
                      </Button>) : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
        {failures.length ? <p className="mt-2 text-2xs text-red-700">{t('pubw_admin_failures_n', { n: failures.length })}</p> : null}
      </Section>

      <Section title={t('pubw_admin_audit')}>
        {audit.length ? (
          <ol className="space-y-2">
            {audit.map((a) => {
              const changed = Object.keys(a.after).filter((k) => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(a.after[k]) !== JSON.stringify(a.before[k]));
              return (
                <li key={a.id} className="text-2xs">
                  <span className="font-semibold text-foreground">{t(a.action === 'RECHECK' ? 'pubw_admin_audit_recheck' : 'pubw_admin_audit_update')}</span>
                  <span className="text-muted-foreground"> · {dateTime(a.created_at, locale)}</span>
                  {changed.length ? <span className="block text-muted-foreground" dir="ltr">{changed.join(', ')}</span> : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="text-2xs text-muted-foreground">{t('pubw_admin_audit_empty')}</p>}
      </Section>
    </div>
  );
}
