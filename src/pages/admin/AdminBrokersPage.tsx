// ADMIN — BROKERS. Two records on one screen, and nothing that joins them.
//
//   DIRECTORY LISTINGS   broker_directory_listings: firms that APPLIED. Owner, status,
//                        paid_until, and whether the public view shows them right now.
//                        Read through admin_list_broker_directory, because the table's
//                        RLS lets an owner read their own row and everyone read a current
//                        listing, and gives an admin nothing else.
//   DISCOVERED BROKERS   broker_intelligence + broker_intelligence_sources: firms that
//                        discovery OBSERVED. Identity key, provenance, freshness. Read
//                        through admin_list_broker_intelligence, because those tables have
//                        RLS with no policies at all.
//
// WHAT AN ADMIN CAN DO
//
// Activate, suspend or expire a LISTING, through admin_set_broker_listing_status —
// SECURITY DEFINER, is_admin() checked in its own body, every change written to
// admin_audit_log with the old and new status and paid_until.
//
// Activation asks for two things and infers neither. There is no payment path for
// directory listings yet, so "paid" is something the admin states: a paid-until date in
// the future and the invoice or payment reference it rests on, plus a confirmation that
// the money arrived. The function refuses without them and records the result as
// ADMIN_ASSERTED, so nobody later mistakes it for a verified charge.
//
// WHAT AN ADMIN CANNOT DO, BY DESIGN
//
// Anything with a discovered broker except read it. There is no "promote", "invite",
// "approve" or "list" on that tab and there is no function behind one: a discovered firm
// becomes a listing by applying, or not at all.

import { AlertTriangle, BadgeCheck, Inbox, RefreshCw, Store, Radar } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { BrokerDetailDialog, BrokerReviewPanel, BrokerVerificationPanel } from '@/components/admin/BrokerAdminPanels';

type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'NEEDS_CHANGES' | 'REJECTED' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';

interface ListingRow {
  id: string;
  owner_user_id: string;
  owner_email: string | null;
  owner_name: string | null;
  display_name: string;
  role: string;
  cities: string[] | null;
  languages: string[] | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  status: ListingStatus;
  paid_until: string | null;
  is_public: boolean;
  created_at: string;
}

interface IntelRow {
  id: string;
  key_kind: string;
  natural_key: string;
  role: string;
  display_name: string | null;
  cities: string[] | null;
  languages: string[] | null;
  first_seen_at: string;
  last_seen_at: string;
  last_verified_at: string | null;
  validation_state: string;
  observation_count: number;
  source_count: number;
  provenance_rows: number;
  distinct_sources: number;
  adapters: string[] | null;
}

type Freshness = '' | '7d' | '30d' | 'stale';
const DAY = 86_400_000;

function freshnessOf(lastSeen: string, now: number): Exclude<Freshness, ''> {
  const age = now - Date.parse(lastSeen);
  if (age <= 7 * DAY) return '7d';
  if (age <= 30 * DAY) return '30d';
  return 'stale';
}

const SELECT = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
const TH = 'text-start px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2.5 align-top';

/** The server's refusal codes, in words. Anything else is shown verbatim to an admin. */
function explain(t: (k: TranslationKey, v?: Record<string, string>) => string, message: string): string {
  if (message.includes('PAID_UNTIL_REQUIRED_IN_FUTURE')) return t('admin_brokers_err_paid_until');
  if (message.includes('PAYMENT_BASIS_REQUIRED')) return t('admin_brokers_err_basis');
  return t('admin_brokers_err_generic', { error: message });
}

export default function AdminBrokersPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'listings' | 'verification' | 'review' | 'intel'>('listings');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [intel, setIntel] = useState<IntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [market, setMarket] = useState('');
  const [status, setStatus] = useState<'' | ListingStatus>('');
  const [visibility, setVisibility] = useState<'' | 'public' | 'hidden'>('');
  const [validation, setValidation] = useState('');
  const [adapter, setAdapter] = useState('');
  const [freshness, setFreshness] = useState<Freshness>('');

  /* The one pending action. Activation and the two removals share a dialog because
     both are audited writes that need a written reason. */
  const [pending, setPending] = useState<{ row: ListingRow; to: Exclude<ListingStatus, 'PENDING_REVIEW'> } | null>(null);
  const [paidUntil, setPaidUntil] = useState('');
  const [basis, setBasis] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [l, i] = await Promise.all([
      supabase.rpc('admin_list_broker_directory'),
      supabase.rpc('admin_list_broker_intelligence', { p_limit: 2000 }),
    ]);
    if (l.error || i.error) setLoadError((l.error ?? i.error)?.message ?? 'error');
    setListings((l.data ?? []) as ListingRow[]);
    setIntel((i.data ?? []) as IntelRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allMarkets = useMemo(() => {
    const source = tab === 'listings' ? listings : intel;
    return [...new Set(source.flatMap((r) => r.cities ?? []).filter(Boolean))].sort();
  }, [tab, listings, intel]);
  const allAdapters = useMemo(
    () => [...new Set(intel.flatMap((r) => r.adapters ?? []))].sort(),
    [intel],
  );
  const allValidation = useMemo(() => [...new Set(intel.map((r) => r.validation_state))].sort(), [intel]);

  const needle = name.trim().toLowerCase();
  const shownListings = useMemo(() => listings.filter((r) => {
    if (needle && ![r.display_name, r.owner_email, r.contact_email, r.contact_phone, r.website]
      .some((v) => (v ?? '').toLowerCase().includes(needle))) return false;
    if (market && !(r.cities ?? []).includes(market)) return false;
    if (status && r.status !== status) return false;
    if (visibility === 'public' && !r.is_public) return false;
    if (visibility === 'hidden' && r.is_public) return false;
    return true;
  }), [listings, needle, market, status, visibility]);

  const now = Date.now();
  const shownIntel = useMemo(() => intel.filter((r) => {
    if (needle && ![r.display_name, r.natural_key].some((v) => (v ?? '').toLowerCase().includes(needle))) return false;
    if (market && !(r.cities ?? []).includes(market)) return false;
    if (validation && r.validation_state !== validation) return false;
    if (adapter && !(r.adapters ?? []).includes(adapter)) return false;
    if (freshness && freshnessOf(r.last_seen_at, now) !== freshness) return false;
    return true;
  }), [intel, needle, market, validation, adapter, freshness, now]);

  const open = (row: ListingRow, to: Exclude<ListingStatus, 'PENDING_REVIEW'>) => {
    setPending({ row, to });
    setPaidUntil('');
    setBasis('');
    setConfirmed(false);
    setActionError(null);
  };

  const submit = async () => {
    if (!pending) return;
    const activating = pending.to === 'ACTIVE';
    let until: string | null = null;
    if (activating) {
      /* End of the chosen day, in the admin's timezone, so "paid until the 30th" covers the 30th. */
      const parsed = paidUntil ? new Date(`${paidUntil}T23:59:59`) : null;
      if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        setActionError(t('admin_brokers_err_paid_until'));
        return;
      }
      if (!basis.trim()) { setActionError(t('admin_brokers_err_basis')); return; }
      until = parsed.toISOString();
    }
    /* The review verbs carry the reviewer's words to the applicant, and the
       server refuses them without a note — say so before the round trip. */
    if ((pending.to === 'NEEDS_CHANGES' || pending.to === 'REJECTED') && !basis.trim()) {
      setActionError(t('admin_brokers_err_review_note'));
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('admin_set_broker_listing_status', {
      p_listing_id: pending.row.id,
      p_status: pending.to,
      p_paid_until: until,
      p_reason: basis.trim() || null,
    });
    setSaving(false);
    if (error) {
      setActionError(explain(t, error.message ?? ''));
      return;
    }
    toast.success(t('admin_brokers_done'));
    setPending(null);
    void load();
  };

  const statusTone: Record<ListingStatus, string> = {
    DRAFT: 'border-border text-muted-foreground',
    PENDING_REVIEW: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
    APPROVED: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
    NEEDS_CHANGES: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
    REJECTED: 'border-destructive/40 text-destructive',
    ACTIVE: 'border-green-500/40 text-green-600 dark:text-green-400',
    SUSPENDED: 'border-destructive/40 text-destructive',
    EXPIRED: 'border-border text-muted-foreground',
  };

  const tabButton = (id: 'listings' | 'verification' | 'review' | 'intel', label: string, Icon: typeof Store, count: number | null) => (
    <button
      type="button"
      onClick={() => { setTab(id); setMarket(''); }}
      aria-pressed={tab === id}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      {count != null && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{t('admin_brokers_title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">{t('admin_brokers_subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('admin_refresh')}
        </Button>
      </div>

      <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
        {tabButton('listings', t('admin_brokers_tab_listings'), Store, listings.length)}
        {tabButton('verification', t('admin_brokers_tab_verification'), BadgeCheck, null)}
        {tabButton('review', t('admin_brokers_tab_review'), Inbox, null)}
        {tabButton('intel', t('admin_brokers_tab_intel'), Radar, intel.length)}
      </div>

      {loadError && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {loadError}
        </p>
      )}

      {tab === 'intel' && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('admin_brokers_intel_note')}
        </p>
      )}
      {tab === 'listings' && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('admin_brokers_payment_note')}
        </p>
      )}

      {tab === 'verification' && <BrokerVerificationPanel onOpen={setDetailId} />}
      {tab === 'review' && <BrokerReviewPanel />}
      {detailId && <BrokerDetailDialog listingId={detailId} onClose={() => setDetailId(null)} onChanged={() => void load()} />}

      {(tab === 'listings' || tab === 'intel') && (<>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('admin_brokers_filter_name')}
          aria-label={t('admin_brokers_filter_name')}
          className="h-9 w-full sm:w-64"
        />
        <select className={SELECT} value={market} onChange={(e) => setMarket(e.target.value)} aria-label={t('admin_brokers_filter_market')}>
          <option value="">{t('admin_brokers_filter_market')}: {t('admin_brokers_filter_all')}</option>
          {allMarkets.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {tab === 'listings' ? (
          <>
            <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as '' | ListingStatus)} aria-label={t('admin_brokers_filter_status')}>
              <option value="">{t('admin_brokers_filter_status')}: {t('admin_brokers_filter_all')}</option>
              {(['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'EXPIRED'] as const).map((s) => (
                <option key={s} value={s}>{t(`broker_status_${s}` as TranslationKey)}</option>
              ))}
            </select>
            <select className={SELECT} value={visibility} onChange={(e) => setVisibility(e.target.value as '' | 'public' | 'hidden')} aria-label={t('admin_brokers_filter_visibility')}>
              <option value="">{t('admin_brokers_filter_visibility')}: {t('admin_brokers_filter_all')}</option>
              <option value="public">{t('admin_brokers_public_yes')}</option>
              <option value="hidden">{t('admin_brokers_public_no')}</option>
            </select>
          </>
        ) : (
          <>
            <select className={SELECT} value={validation} onChange={(e) => setValidation(e.target.value)} aria-label={t('admin_brokers_filter_validation')}>
              <option value="">{t('admin_brokers_filter_validation')}: {t('admin_brokers_filter_all')}</option>
              {allValidation.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className={SELECT} value={adapter} onChange={(e) => setAdapter(e.target.value)} aria-label={t('admin_brokers_filter_source')}>
              <option value="">{t('admin_brokers_filter_source')}: {t('admin_brokers_filter_all')}</option>
              {allAdapters.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className={SELECT} value={freshness} onChange={(e) => setFreshness(e.target.value as Freshness)} aria-label={t('admin_brokers_filter_freshness')}>
              <option value="">{t('admin_brokers_filter_freshness')}: {t('admin_brokers_filter_all')}</option>
              <option value="7d">{t('admin_brokers_fresh_7d')}</option>
              <option value="30d">{t('admin_brokers_fresh_30d')}</option>
              <option value="stale">{t('admin_brokers_fresh_stale')}</option>
            </select>
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {tab === 'listings' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className={TH}>{t('admin_brokers_col_name')}</th>
                    <th className={TH}>{t('admin_brokers_col_owner')}</th>
                    <th className={TH}>{t('admin_brokers_col_status')}</th>
                    <th className={TH}>{t('admin_brokers_col_paid_until')}</th>
                    <th className={TH}>{t('admin_brokers_col_visibility')}</th>
                    <th className={TH}>{t('admin_brokers_col_markets')}</th>
                    <th className={TH}>{t('admin_brokers_col_contact')}</th>
                    <th className={TH}>{t('admin_brokers_col_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}><td colSpan={8} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                  )) : shownListings.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      {listings.length === 0 ? t('admin_brokers_empty_listings') : t('admin_brokers_no_match')}
                    </td></tr>
                  ) : shownListings.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className={TD}>
                        <p className="font-medium">{r.display_name}</p>
                        <p className="text-xs text-muted-foreground">{r.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}</p>
                      </td>
                      <td className={cn(TD, 'text-xs')}>
                        <p>{r.owner_email ?? r.owner_user_id}</p>
                        {r.owner_name && <p className="text-muted-foreground">{r.owner_name}</p>}
                      </td>
                      <td className={TD}>
                        <Badge variant="outline" className={cn('text-[13px] whitespace-nowrap', statusTone[r.status])}>
                          {t(`broker_status_${r.status}` as TranslationKey)}
                        </Badge>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-xs tabular-nums')}>{fmt(r.paid_until)}</td>
                      <td className={cn(TD, 'whitespace-nowrap text-xs')}>
                        {r.is_public ? t('admin_brokers_public_yes') : t('admin_brokers_public_no')}
                      </td>
                      <td className={cn(TD, 'text-xs text-muted-foreground')}>{(r.cities ?? []).join(', ') || '—'}</td>
                      <td className={cn(TD, 'text-xs')} dir="ltr">
                        {[r.contact_phone, r.contact_email, r.website].filter(Boolean).map((c) => <p key={c as string}>{c}</p>)}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDetailId(r.id)}>
                            {t('admin_broker_open')}
                          </Button>
                          {/* The review pass, before money: an application is
                              approved, sent back or declined on its merits;
                              ACTIVE stays a separate, paid act. */}
                          {(r.status === 'PENDING_REVIEW' || r.status === 'NEEDS_CHANGES') && (
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => open(r, 'APPROVED')}>
                              {t('admin_brokers_mark_approved')}
                            </Button>
                          )}
                          {r.status === 'PENDING_REVIEW' && (
                            <>
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => open(r, 'NEEDS_CHANGES')}>
                                {t('admin_brokers_needs_changes')}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => open(r, 'REJECTED')}>
                                {t('admin_brokers_reject')}
                              </Button>
                            </>
                          )}
                          {r.status !== 'ACTIVE' || !r.is_public ? (
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => open(r, 'ACTIVE')}>
                              {t('admin_brokers_approve')}
                            </Button>
                          ) : null}
                          {r.status !== 'SUSPENDED' && (
                            <Button size="sm" variant="outline" className="h-8 text-xs border-destructive/40 text-destructive" onClick={() => open(r, 'SUSPENDED')}>
                              {t('admin_brokers_suspend')}
                            </Button>
                          )}
                          {r.status !== 'EXPIRED' && (
                            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => open(r, 'EXPIRED')}>
                              {t('admin_brokers_expire')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className={TH}>{t('admin_brokers_col_name')}</th>
                    <th className={TH}>{t('admin_brokers_col_key')}</th>
                    <th className={TH}>{t('admin_brokers_col_role')}</th>
                    <th className={TH}>{t('admin_brokers_col_markets')}</th>
                    <th className={TH}>{t('admin_brokers_col_provenance')}</th>
                    <th className={TH}>{t('admin_brokers_col_validation')}</th>
                    <th className={TH}>{t('admin_brokers_col_last_seen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                  )) : shownIntel.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      {intel.length === 0 ? t('admin_brokers_empty_intel') : t('admin_brokers_no_match')}
                    </td></tr>
                  ) : shownIntel.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className={cn(TD, 'font-medium')}>{r.display_name ?? t('broker_no_name')}</td>
                      <td className={cn(TD, 'text-xs')} dir="ltr">
                        <span className="text-muted-foreground">{r.key_kind}</span> {r.natural_key}
                      </td>
                      <td className={cn(TD, 'text-xs')}>{r.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker')}</td>
                      <td className={cn(TD, 'text-xs text-muted-foreground')}>{(r.cities ?? []).join(', ') || '—'}</td>
                      <td className={cn(TD, 'text-xs')}>
                        <p className="whitespace-nowrap">
                          {t('admin_brokers_provenance_value', {
                            sources: String(r.distinct_sources),
                            rows: String(r.provenance_rows),
                            listings: String(r.observation_count),
                          })}
                        </p>
                        {(r.adapters ?? []).length > 0 && (
                          <p className="text-muted-foreground">{(r.adapters ?? []).join(', ')}</p>
                        )}
                      </td>
                      <td className={TD}>
                        <Badge variant="outline" className="text-[13px] whitespace-nowrap">{r.validation_state}</Badge>
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-xs tabular-nums')}>
                        {fmt(r.last_seen_at)}
                        {r.last_verified_at && <p className="text-muted-foreground">✓ {fmt(r.last_verified_at)}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
      </>)}

      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.to === 'ACTIVE' ? t('admin_brokers_activate_title') : t('admin_brokers_reason_title')}
            </DialogTitle>
            <DialogDescription>
              {pending?.to === 'ACTIVE' ? t('admin_brokers_activate_body') : t('admin_brokers_reason_body')}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{pending.row.display_name}</p>
              {pending.to === 'ACTIVE' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('admin_brokers_paid_until_label')}</span>
                  <Input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
                </label>
              )}
              <label className="block space-y-1">
                <span className="text-xs font-medium">
                  {pending.to === 'ACTIVE' ? t('admin_brokers_basis_label') : t('admin_brokers_reason_label')}
                </span>
                <Input value={basis} onChange={(e) => setBasis(e.target.value)} maxLength={300} />
              </label>
              {pending.to === 'ACTIVE' && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
                  <span>{t('admin_brokers_confirm_paid')}</span>
                </label>
              )}
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>{t('general_cancel')}</Button>
            <Button
              onClick={() => void submit()}
              disabled={saving || (pending?.to === 'ACTIVE' && !confirmed)}
              variant={pending?.to === 'ACTIVE' || pending?.to === 'APPROVED' ? 'default' : 'destructive'}
            >
              {saving && <RefreshCw className="h-3.5 w-3.5 me-1.5 animate-spin" />}
              {t('admin_brokers_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BrokerCommercePanel />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Commercial configuration — the two broker products, from the catalogue.
 *
 * The ONLY price source for broker discovery and directory listings is
 * billable_products; this panel edits those rows through the audited
 * admin_configure_broker_product RPC. No customer component holds a number.
 * ───────────────────────────────────────────────────────────────────────── */

function BrokerCommercePanel() {
  const { t } = useLanguage();
  const [discoveryCents, setDiscoveryCents] = useState('');
  const [listingCents, setListingCents] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [charging, setCharging] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('broker_discovery_pricing');
    const raw = (data ?? null) as Record<string, unknown> | null;
    if (!raw) return;
    setDiscoveryCents(String(Math.round(Number(raw.unitCredits ?? 0) * 10)));
    if (raw.listingPriceCredits != null) setListingCents(String(Math.round(Number(raw.listingPriceCredits) * 10)));
    if (raw.listingDurationDays != null) setDurationDays(String(raw.listingDurationDays));
    setCharging(raw.charging === true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (code: 'BROKER_DISCOVERY' | 'BROKER_DIRECTORY_LISTING') => {
    setBusy(true);
    const cents = code === 'BROKER_DISCOVERY' ? Number(discoveryCents) : Number(listingCents);
    const { error } = await supabase.rpc('admin_configure_broker_product', {
      p_code: code,
      p_standard_retail_cents: Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null,
      ...(code === 'BROKER_DIRECTORY_LISTING' && Number(durationDays) > 0
        ? { p_config: { duration_days: Math.round(Number(durationDays)) } }
        : {}),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('admin_brokers_pricing_saved'));
    void load();
  };

  const field = 'space-y-1';
  const labelCls = 'text-xs font-medium';

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold">{t('admin_brokers_pricing_heading')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('admin_brokers_pricing_note')}</p>
        {charging === false && (
          <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            {t('admin_brokers_pricing_off')}
          </p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold">{t('admin_brokers_pricing_discovery')}</p>
            <div className="mt-2 flex items-end gap-2">
              <label className={field}>
                <span className={labelCls}>{t('admin_brokers_pricing_cents')}</span>
                <Input value={discoveryCents} onChange={(e) => setDiscoveryCents(e.target.value)} inputMode="numeric" className="h-9 w-28" dir="ltr" />
              </label>
              <p className="pb-2 text-xs text-muted-foreground" dir="ltr">
                = {(Number(discoveryCents || 0) / 10).toFixed(2)} CR
              </p>
              <Button size="sm" className="h-9" disabled={busy} onClick={() => void save('BROKER_DISCOVERY')}>
                {t('general_save')}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold">{t('admin_brokers_pricing_listing')}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className={field}>
                <span className={labelCls}>{t('admin_brokers_pricing_cents')}</span>
                <Input value={listingCents} onChange={(e) => setListingCents(e.target.value)} inputMode="numeric" className="h-9 w-28" dir="ltr" />
              </label>
              <label className={field}>
                <span className={labelCls}>{t('admin_brokers_pricing_duration')}</span>
                <Input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} inputMode="numeric" className="h-9 w-20" dir="ltr" />
              </label>
              <Button size="sm" className="h-9" disabled={busy} onClick={() => void save('BROKER_DIRECTORY_LISTING')}>
                {t('general_save')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
