// BROKER DESK — the professional's own workspace.
//
// One call, broker_desk_summary(), returns everything on this page for the
// caller only: the account (and whether it is suspended), the ONE profile with
// its directory and verification state, the portfolio with each property's
// CURRENT leads (the canonical 30-day active-demand window — never every match
// a property ever had), lead counts by workflow state, the broker's client
// searches with their private labels, credits and directory purchases.
//
// Every action is a server RPC that re-checks the rule: submitting for review,
// uploading verification documents, buying the directory period (priced from
// the admin catalogue, idempotent), labelling a client search.
//
// THE ANALYTICS SAY WHAT WAS MEASURED. "Call clicks" is a count of clicks on
// a phone link. It is never presented as completed calls, because Homatch has
// no call-completion telemetry for these links, and a label that promises
// more than the platform knows is a fake metric.

import {
  BadgeCheck, Building2, CalendarClock, Check, Circle, Coins, Eye, FileUp, Globe, Home, Loader2, Mail,
  MousePointerClick, Phone, Plus, Search, ShieldAlert, Store, Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerSurface, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { brokerErrorKey } from '@/components/broker/errors';
import {
  BrokerRpcError, LEAD_STATES, brokerDeskSummary, newIdempotencyKey, purchaseBrokerListing,
  submitBrokerDirectory, submitBrokerVerification, uploadVerificationDocument,
  type BrokerDeskSummary, type DeskClientSearch,
} from '@/services/brokerDesk';
import { brokerProfileEventStats, type BrokerEventStats } from '@/services/brokers';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { statusLabel } from '@/components/matching/MatchingJobProgress';

const DOC_KINDS = ['LICENSE', 'COMPANY_REGISTRATION', 'ID_DOCUMENT', 'OTHER'] as const;
const SUBMITTABLE = ['DRAFT', 'NEEDS_CHANGES', 'REJECTED'];
const PURCHASABLE = ['APPROVED', 'ACTIVE', 'EXPIRED'];

const btn = 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-[hsl(var(--gold-ink))] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const primaryBtn = 'inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-2xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function ClientSearchRow({ row, onSaved }: { row: DeskClientSearch; onSaved: () => void }) {
  const { t } = useLanguage();
  const [label, setLabel] = useState(row.client_label ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dirty = label.trim() !== (row.client_label ?? '');
  const criteria = row.criteria ?? {};
  const summary = [criteria.city, criteria.propertyType ?? criteria.property_type, criteria.transactionType ?? criteria.transaction_type]
    .filter((v) => typeof v === 'string' && v).join(' · ');
  const save = async () => {
    setSaving(true);
    setFailed(false);
    /* Owner-scoped by RLS (active_search_update: user_id = auth_user_id()). */
    const { error } = await supabase
      .from('active_search_subscriptions')
      .update({ client_label: label.trim() || null, on_behalf: label.trim() !== '' })
      .eq('id', row.id);
    setSaving(false);
    if (error) { setFailed(true); return; }
    onSaved();
  };
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold text-foreground">{summary || t('broker_desk_search_untitled')}</p>
        <span className="text-2xs text-muted-foreground">
          {row.is_active ? t('broker_desk_search_active') : t('broker_desk_search_paused')}
          {' · '}{new Date(row.created_at).toLocaleDateString()}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={`cl-${row.id}`} className="sr-only">{t('broker_desk_client_label')}</label>
        <Input
          id={`cl-${row.id}`}
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 80))}
          placeholder={t('broker_desk_client_label')}
          className="h-10 min-w-0 flex-1 bg-card"
        />
        <button type="button" className={btn} disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('broker_desk_save')}
        </button>
      </div>
      {failed && <p role="alert" className="mt-1.5 text-2xs text-destructive">{t('broker_apply_err_generic')}</p>}
    </li>
  );
}

export default function BrokerCrmPage() {
  const { t } = useLanguage();
  const { session } = useAuth();
  const authId = session?.user?.id ?? null;

  const [desk, setDesk] = useState<BrokerDeskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stats, setStats] = useState<BrokerEventStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const [docKind, setDocKind] = useState<string>('LICENSE');
  const purchaseKey = useRef<string | null>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const [searchByProperty, setSearchByProperty] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const d = await brokerDeskSummary();
      setDesk(d);
      setLoadFailed(false);
      /* The latest search per property, read under the owner's own RLS. */
      const ids = d.properties.map((p) => p.id);
      if (ids.length > 0) {
        const { data: jobs } = await supabase.from('matching_jobs')
          .select('property_id,status,created_at').in('property_id', ids)
          .order('created_at', { ascending: false }).limit(200);
        const latest: Record<string, string> = {};
        for (const j of (jobs ?? []) as Array<{ property_id: string; status: string }>) latest[j.property_id] ??= j.status;
        setSearchByProperty(latest);
      }
      if (d.profile) setStats(await brokerProfileEventStats(d.profile.id, 30));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authId) void load(); }, [authId, load]);

  const run = async (key: string, fn: () => Promise<unknown>, okKey: TranslationKey) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', text: t(okKey) });
      await load();
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: t(brokerErrorKey(e instanceof BrokerRpcError ? e.code : 'UNKNOWN')) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const listing = desk?.profile ?? null;
  const suspended = desk?.account?.suspended === true;
  const isPublic = listing?.status === 'ACTIVE'
    && Boolean(listing.paid_until)
    && Date.parse(listing!.paid_until as string) > Date.now();
  const price = desk?.listing_price_credits ?? null;
  const days = desk?.listing_duration_days ?? 30;
  const balance = desk?.balance ?? null;

  const totals = stats?.totals ?? {};
  const views = (totals.IMPRESSION ?? 0) + (totals.PROFILE_OPEN ?? 0);
  const contactClicks = (totals.PHONE_CLICK ?? 0) + (totals.EMAIL_CLICK ?? 0)
    + (totals.WHATSAPP_CLICK ?? 0) + (totals.WEBSITE_CLICK ?? 0) + (totals.MESSAGE_CLICK ?? 0);

  const metric = (icon: React.ReactNode, labelKey: TranslationKey, value: number) => (
    <div className="hm-customer-panel flex min-w-0 items-start gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--gold))]/10 text-[hsl(var(--gold-ink))] ring-1 ring-inset ring-[hsl(var(--gold))]/25" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-semibold leading-none text-foreground tabular-nums">{value}</p>
        <p className="mt-1 text-2xs leading-snug text-muted-foreground">{t(labelKey)}</p>
      </div>
    </div>
  );

  const hasContact = Boolean(listing && (listing.contact_phone || listing.contact_email || listing.whatsapp || listing.telegram || listing.website));
  const steps: { done: boolean; key: TranslationKey }[] = listing ? [
    { done: true, key: 'broker_desk_step_profile' },
    { done: hasContact && (listing.cities?.length ?? 0) > 0, key: 'broker_desk_step_contact' },
    { done: listing.verification_state === 'VERIFIED' || listing.verification_state === 'PENDING', key: 'broker_desk_step_verification' },
    { done: listing.status !== 'DRAFT', key: 'broker_desk_step_review' },
    { done: (desk?.properties.length ?? 0) > 0, key: 'broker_desk_step_property' },
    { done: isPublic, key: 'broker_desk_step_public' },
  ] : [];

  const totalLeads = LEAD_STATES.reduce((n, s) => n + (desk?.leads[s] ?? 0), 0);

  return (
    <AppLayout noPadding surfaceClass="hm-customer hm-customer-canvas min-h-[calc(100dvh-4rem)]">
      <CustomerSurface className="max-w-5xl space-y-6 pt-6 sm:pt-8">
        <PageHero
          compact
          eyebrow={t('broker_crm_eyebrow')}
          title={t('broker_crm_title')}
          subtitle={t('broker_crm_sub')}
        />

        {loading && <Skeleton className="h-56 rounded-2xl" />}

        {!loading && loadFailed && (
          <div role="alert" className="hm-customer-panel flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">{t('broker_desk_load_error')}</p>
            <button type="button" className={btn} onClick={() => { setLoading(true); void load(); }}>{t('broker_desk_retry')}</button>
          </div>
        )}

        {!loading && suspended && (
          <div role="alert" className="hm-customer-panel flex items-start gap-3 border-destructive/40 p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t('broker_err_suspended')}</p>
              {desk?.account?.suspension_reason && (
                <p className="mt-1 break-words text-sm text-muted-foreground">{desk.account.suspension_reason}</p>
              )}
            </div>
          </div>
        )}

        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={cn('rounded-lg border px-4 py-3 text-sm', notice.kind === 'error'
            ? 'border-destructive/40 text-destructive'
            : 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-foreground')}
          >
            {notice.text}
          </p>
        )}

        {!loading && !loadFailed && !listing && (
          <div className="hm-customer-panel px-5 py-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mx-auto mt-3 max-w-md font-display text-base font-semibold text-foreground">
              {t('broker_crm_none_title')}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t('broker_crm_none_body')}
            </p>
            <Link
              to="/broker/onboarding"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('broker_crm_none_cta')}
            </Link>
          </div>
        )}

        {!loading && !loadFailed && listing && desk && (
          <>
            {/* ── Standing ─────────────────────────────────────────────── */}
            <section className="hm-customer-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {listing.logo_url && <img src={listing.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover" />}
                  <div className="min-w-0">
                    <h2 className="break-words font-display text-lg font-semibold text-foreground">{listing.display_name}</h2>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {listing.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={cn(
                    'rounded-full border px-3 py-1 text-2xs font-semibold',
                    isPublic
                      ? 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]'
                      : 'border-border bg-secondary text-muted-foreground',
                  )}
                  >
                    {t(`broker_status_${listing.status}` as TranslationKey)}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-2xs font-semibold',
                    listing.verification_state === 'VERIFIED'
                      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                      : 'border-border bg-secondary text-muted-foreground',
                  )}
                  >
                    {listing.verification_state === 'VERIFIED' && <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                    {t(`broker_verif_${listing.verification_state}` as TranslationKey)}
                  </span>
                </div>
              </div>

              {listing.review_note && (listing.status === 'NEEDS_CHANGES' || listing.status === 'REJECTED') && (
                <p className="mt-3 break-words rounded-lg border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--gold-ink))]">
                  {listing.review_note}
                </p>
              )}

              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_public_state')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">
                    {isPublic ? t('broker_crm_public_yes') : t('broker_crm_public_no')}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_paid_until')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">
                    {listing.paid_until ? new Date(listing.paid_until).toLocaleDateString() : '—'}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('broker_crm_listing_price')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground" dir="ltr">
                    {price != null ? `${price.toFixed(2)} CR / ${days}${t('broker_crm_days_suffix')}` : '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2.5">
                {isPublic && (
                  <Link to={`/brokers/${listing.id}`} className={btn}>
                    <Store className="h-4 w-4" aria-hidden="true" />
                    {t('broker_crm_view_public')}
                  </Link>
                )}
                <Link to="/broker/onboarding" className={btn}>
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  {t('broker_crm_edit_profile')}
                </Link>
                {SUBMITTABLE.includes(listing.status) && !suspended && (
                  <button type="button" className={primaryBtn} disabled={busy !== null}
                    onClick={() => void run('submit', submitBrokerDirectory, 'broker_desk_submitted')}
                  >
                    {busy === 'submit' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {t('broker_desk_submit_review')}
                  </button>
                )}
                {PURCHASABLE.includes(listing.status) && !suspended && price != null && (
                  <button type="button" className={primaryBtn} disabled={busy !== null}
                    onClick={() => { purchaseKey.current = purchaseKey.current ?? newIdempotencyKey('broker-listing'); setConfirmBuy(true); }}
                  >
                    <Coins className="h-4 w-4" aria-hidden="true" />
                    {listing.status === 'ACTIVE' ? t('broker_desk_renew') : t('broker_desk_buy')}
                  </button>
                )}
              </div>
              {listing.status === 'PENDING_REVIEW' && (
                <p className="mt-3 text-2xs text-muted-foreground">{t('broker_desk_pending_note')}</p>
              )}
            </section>

            <AlertDialog open={confirmBuy} onOpenChange={setConfirmBuy}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('broker_desk_buy_title')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('broker_desk_buy_body', { credits: price != null ? price.toFixed(2) : '—', days: String(days), balance: balance != null ? balance.toFixed(2) : '—' })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('broker_desk_cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy !== null}
                    onClick={async () => {
                      const key = purchaseKey.current ?? newIdempotencyKey('broker-listing');
                      purchaseKey.current = key;
                      const ok = await run('buy', () => purchaseBrokerListing(key), 'broker_desk_bought');
                      if (ok) purchaseKey.current = null;
                    }}
                  >
                    {t('broker_desk_buy_confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* ── Setup progress ────────────────────────────────────────── */}
            <section className="hm-customer-panel p-5 sm:p-6" aria-labelledby="desk-steps">
              <h2 id="desk-steps" className="font-display text-base font-semibold text-foreground">{t('broker_desk_steps_heading')}</h2>
              <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-sm text-foreground">
                    {s.done
                      ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" aria-hidden="true" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className={cn(!s.done && 'text-muted-foreground')}>{t(s.key)}</span>
                    <span className="sr-only">{s.done ? t('broker_desk_done') : t('broker_desk_todo')}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* ── Verification ──────────────────────────────────────────── */}
            <section className="hm-customer-panel space-y-3 p-5 sm:p-6" aria-labelledby="desk-verif">
              <h2 id="desk-verif" className="font-display text-base font-semibold text-foreground">{t('broker_desk_verif_heading')}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{t(`broker_verif_${listing.verification_state}_body` as TranslationKey)}</p>
              {listing.verification_note && (listing.verification_state === 'REJECTED' || listing.verification_state === 'SUSPENDED') && (
                <p className="break-words rounded-lg border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] px-4 py-3 text-sm text-[hsl(var(--gold-ink))]">{listing.verification_note}</p>
              )}
              {desk.documents.length > 0 && (
                <ul className="space-y-1.5">
                  {desk.documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                      <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="font-semibold text-foreground">{t(`broker_doc_${d.kind}` as TranslationKey)}</span>
                      <span>{new Date(d.created_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(listing.verification_state === 'UNVERIFIED' || listing.verification_state === 'REJECTED') && !suspended && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <label htmlFor="doc-kind" className="sr-only">{t('broker_desk_doc_kind')}</label>
                  <select
                    id="doc-kind"
                    value={docKind}
                    onChange={(e) => setDocKind(e.target.value)}
                    className="h-10 min-w-0 rounded-lg border border-input bg-card px-3 text-2xs font-semibold text-foreground"
                  >
                    {DOC_KINDS.map((k) => <option key={k} value={k}>{t(`broker_doc_${k}` as TranslationKey)}</option>)}
                  </select>
                  <input
                    ref={docInput}
                    id="doc-file"
                    type="file"
                    accept="application/pdf,image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && authId) void run('doc', () => uploadVerificationDocument(authId, docKind, f), 'broker_desk_doc_added');
                      if (docInput.current) docInput.current.value = '';
                    }}
                  />
                  <label htmlFor="doc-file" className={cn(btn, 'cursor-pointer')}>
                    {busy === 'doc' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                    {t('broker_desk_doc_upload')}
                  </label>
                  <button type="button" className={primaryBtn} disabled={busy !== null || desk.documents.length === 0}
                    onClick={() => void run('verify', submitBrokerVerification, 'broker_desk_verif_sent')}
                  >
                    {busy === 'verify' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {t('broker_desk_verif_submit')}
                  </button>
                </div>
              )}
              <p className="text-2xs leading-relaxed text-muted-foreground">{t('broker_desk_doc_private')}</p>
            </section>

            {/* ── Portfolio with current leads ──────────────────────────── */}
            <section className="space-y-3" aria-labelledby="desk-portfolio">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="desk-portfolio" className="font-display text-lg font-semibold text-foreground">{t('broker_desk_portfolio_heading')}</h2>
                <div className="flex flex-wrap gap-2">
                  <Link to="/property/add" className={primaryBtn}><Plus className="h-4 w-4" aria-hidden="true" />{t('broker_desk_add_property')}</Link>
                  <Link to="/property/import" className={btn}>{t('broker_desk_import_property')}</Link>
                </div>
              </div>
              <p className="text-2xs text-muted-foreground">{t('broker_desk_leads_window', { days: String(desk.active_window_days) })}</p>
              {desk.properties.length === 0 ? (
                <p className="hm-customer-panel p-5 text-sm text-muted-foreground">{t('broker_desk_portfolio_empty')}</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {desk.properties.map((p) => (
                    <li key={p.id} className="hm-customer-panel min-w-0 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-foreground">{p.title || t('broker_desk_untitled_property')}</p>
                          <p className="mt-0.5 text-2xs text-muted-foreground" dir="ltr">{p.homatch_id ? `#${p.homatch_id}` : ''}</p>
                        </div>
                        <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-2xs">
                        <div><dt className="text-muted-foreground">{t('broker_desk_current_leads')}</dt><dd className="text-base font-semibold tabular-nums text-foreground">{p.current_leads}</dd></div>
                        <div><dt className="text-muted-foreground">{t('broker_desk_opened_contacts')}</dt><dd className="text-base font-semibold tabular-nums text-foreground">{p.opened_contacts}</dd></div>
                        <div className="col-span-2" data-desk-search-status>
                          <dt className="text-muted-foreground">{t('broker_desk_last_search')}</dt>
                          <dd className="text-xs font-medium text-foreground">
                            {searchByProperty[p.id] ? statusLabel(searchByProperty[p.id], t as (k: string) => string) : t('broker_desk_no_search')}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/property/${p.id}/matches`} className={btn}>{t('broker_desk_open_leads')}</Link>
                        <Link to={`/property/${p.id}`} className={btn}>{t('broker_desk_open_property')}</Link>
                        {p.homatch_id && !p.archived_at && (
                          <Link to={`/outreach/meta/create?property=${encodeURIComponent(p.homatch_id)}`} className={btn}>{t('broker_desk_promote_meta')}</Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Lead workflow ─────────────────────────────────────────── */}
            <section className="hm-customer-panel p-5 sm:p-6" aria-labelledby="desk-leads">
              <h2 id="desk-leads" className="font-display text-base font-semibold text-foreground">{t('broker_desk_leads_heading')}</h2>
              {totalLeads === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('broker_desk_leads_empty')}</p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {LEAD_STATES.map((s) => (
                    <div key={s} className="rounded-lg border border-border bg-card p-3">
                      <dt className="text-2xs text-muted-foreground">{t(`lead_state_${s}` as TranslationKey)}</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{desk.leads[s] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">{t('broker_desk_leads_note')}</p>
            </section>

            {/* ── Client searches (private labels) ──────────────────────── */}
            <section className="hm-customer-panel space-y-3 p-5 sm:p-6" aria-labelledby="desk-clients">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="desk-clients" className="font-display text-base font-semibold text-foreground">{t('broker_desk_clients_heading')}</h2>
                <Link to="/find-property" className={btn}><Search className="h-4 w-4" aria-hidden="true" />{t('broker_desk_new_client_search')}</Link>
              </div>
              <p className="text-2xs leading-relaxed text-muted-foreground">{t('broker_desk_clients_note')}</p>
              {desk.client_searches.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('broker_desk_clients_empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {desk.client_searches.map((c) => <ClientSearchRow key={c.id} row={c} onSaved={() => void load()} />)}
                </ul>
              )}
            </section>

            {/* ── Credits ──────────────────────────────────────────────── */}
            <section className="hm-customer-panel p-5 sm:p-6" aria-labelledby="desk-credits">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="desk-credits" className="font-display text-base font-semibold text-foreground">{t('broker_desk_credits_heading')}</h2>
                <Link to="/credits" className={btn}><Coins className="h-4 w-4" aria-hidden="true" />{t('broker_desk_credits_open')}</Link>
              </div>
              <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-foreground" dir="ltr">
                {balance != null ? `${balance.toFixed(2)} CR` : '—'}
              </p>
              {desk.purchases.length > 0 && (
                <ul className="mt-3 space-y-1 text-2xs text-muted-foreground">
                  {desk.purchases.map((b) => (
                    <li key={b.created_at}>
                      {t('broker_desk_purchase_row', { credits: Number(b.credits).toFixed(2), date: new Date(b.period_end).toLocaleDateString() })}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Engagement, honestly labelled ─────────────────────────── */}
            <section className="space-y-3" aria-labelledby="broker-crm-analytics">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="broker-crm-analytics" className="font-display text-lg font-semibold text-foreground">
                  {t('broker_crm_analytics_heading')}
                </h2>
                <p className="text-2xs text-muted-foreground">{t('broker_crm_analytics_period')}</p>
              </div>

              {!isPublic && (
                <p className="text-sm leading-relaxed text-muted-foreground">{t('broker_crm_analytics_not_public')}</p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {metric(<Eye className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_views' as TranslationKey, views)}
                {metric(<Phone className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_phone_clicks' as TranslationKey, totals.PHONE_CLICK ?? 0)}
                {metric(<Mail className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_email_clicks' as TranslationKey, totals.EMAIL_CLICK ?? 0)}
                {metric(<Globe className="h-[17px] w-[17px]" strokeWidth={1.7} />, 'broker_crm_metric_website_clicks' as TranslationKey, totals.WEBSITE_CLICK ?? 0)}
              </div>

              {/* The trend renders ONLY from real rows. No rows, no chart —
                  an empty period says so in words instead of drawing zeros. */}
              {stats?.daily && stats.daily.length > 0 ? (
                <div className="hm-customer-panel p-4">
                  <div className="flex items-end gap-1" aria-hidden="true">
                    {stats.daily.slice(-30).map((d) => {
                      const max = Math.max(...stats.daily.map((x) => x.views + x.contacts), 1);
                      const h = Math.max(3, Math.round(((d.views + d.contacts) / max) * 56));
                      return (
                        <span
                          key={d.day}
                          title={`${d.day}: ${d.views + d.contacts}`}
                          className="flex-1 rounded-t bg-[hsl(var(--gold))]/70"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                  <p className="mt-2 text-2xs text-muted-foreground">
                    <MousePointerClick className="me-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
                    {t('broker_crm_trend_note', { total: String(views + contactClicks) })}
                  </p>
                </div>
              ) : (
                isPublic && <p className="text-sm text-muted-foreground">{t('broker_crm_no_events')}</p>
              )}

              <p className="max-w-[70ch] text-2xs leading-relaxed text-muted-foreground">
                {t('broker_crm_metrics_honesty')}
              </p>
            </section>
          </>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}
