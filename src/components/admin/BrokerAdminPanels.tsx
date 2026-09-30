// ADMIN — broker verification, the Broker Review queue, and one broker's
// full record. Every action is an audited SECURITY DEFINER RPC that re-checks
// is_admin(); verification documents live in a PRIVATE bucket and are opened
// through a five-minute signed link, never a public URL.

import { ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import {
  adminBrokerDetail, adminListBrokerReview, adminResolveBrokerReview, adminSetBrokerVerification,
  adminSetUserSuspension, adminSignedDocumentUrl, BrokerRpcError,
  type AdminBrokerDetail, type BrokerReviewItem, type VerificationState,
} from '@/services/brokerDesk';

const SELECT = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');

function errText(t: (k: TranslationKey, v?: Record<string, string>) => string, e: unknown): string {
  const code = e instanceof BrokerRpcError ? e.code : 'UNKNOWN';
  return t('admin_brokers_err_generic', { error: code });
}

// ── One broker ────────────────────────────────────────────────────────────

export function BrokerDetailDialog({ listingId, onClose, onChanged }: { listingId: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<AdminBrokerDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await adminBrokerDetail(listingId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [listingId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      toast.success(t('admin_brokers_done'));
      setNote('');
      setReason('');
      await load();
      onChanged();
    } catch (e) {
      toast.error(errText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const openDoc = async (path: string) => {
    const url = await adminSignedDocumentUrl(path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else toast.error(t('admin_brokers_err_generic', { error: 'SIGNED_URL' }));
  };

  const l = detail?.listing;
  const u = detail?.user;
  const verify = (state: VerificationState) => act(`v-${state}`, () => adminSetBrokerVerification(listingId, state, note.trim() || null));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">{l?.display_name ?? t('admin_broker_detail_title')}</DialogTitle>
          <DialogDescription>{t('admin_broker_detail_sub')}</DialogDescription>
        </DialogHeader>
        {!detail && !failed && <Skeleton className="h-48" />}
        {failed && <p role="alert" className="text-sm text-destructive">{t('broker_desk_load_error')}</p>}
        {detail && l && (
          <div className="space-y-5 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t('admin_brokers_col_owner')}</dt><dd className="break-all">{u?.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_broker_account_type')}</dt><dd>{u?.account_type ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_brokers_col_status')}</dt><dd>{t(`broker_status_${l.status}` as TranslationKey)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_broker_verification')}</dt><dd>{t(`broker_verif_${l.verification_state}` as TranslationKey)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_brokers_col_paid_until')}</dt><dd>{fmt(l.paid_until)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_broker_properties')}</dt><dd className="tabular-nums">{detail.properties}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{t('admin_brokers_col_contact')}</dt>
                <dd className="break-words" dir="ltr">{[l.contact_phone, l.contact_email, l.whatsapp, l.telegram, l.website].filter(Boolean).join(' · ') || '—'}</dd></div>
            </dl>

            <section className="space-y-2">
              <h3 className="font-semibold">{t('admin_broker_documents')}</h3>
              {detail.documents.length === 0 ? (
                <p className="text-muted-foreground">{t('admin_broker_no_documents')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span>{t(`broker_doc_${d.kind}` as TranslationKey)}</span>
                      <span className="text-xs text-muted-foreground">{fmt(d.created_at)}</span>
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => void openDoc(d.path)}>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_broker_open_document')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <label htmlFor="verif-note" className="block text-xs font-medium">{t('admin_broker_note')}</label>
              <Input id="verif-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy !== null || detail.documents.length === 0} onClick={() => void verify('VERIFIED')}>
                  {busy === 'v-VERIFIED' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('admin_broker_verify')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !note.trim()} onClick={() => void verify('REJECTED')}>{t('admin_broker_reject_verification')}</Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !note.trim()} onClick={() => void verify('SUSPENDED')}>{t('admin_broker_suspend_verification')}</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void verify('UNVERIFIED')}>{t('admin_broker_reset_verification')}</Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('admin_broker_note_hint')}</p>
            </section>

            {u && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t('admin_broker_account')}</h3>
                {u.suspended_at ? (
                  <>
                    <p className="text-destructive">{t('admin_broker_suspended_since', { date: fmt(u.suspended_at) })}{u.suspension_reason ? ` — ${u.suspension_reason}` : ''}</p>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act('unsuspend', () => adminSetUserSuspension(u.id, false, null))}>
                      {t('admin_broker_unsuspend')}
                    </Button>
                  </>
                ) : (
                  <>
                    <label htmlFor="susp-reason" className="block text-xs font-medium">{t('admin_broker_suspend_reason')}</label>
                    <Input id="susp-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                    <Button size="sm" variant="destructive" disabled={busy !== null || !reason.trim()} onClick={() => void act('suspend', () => adminSetUserSuspension(u.id, true, reason.trim()))}>
                      {t('admin_broker_suspend_account')}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t('admin_broker_suspend_hint')}</p>
                  </>
                )}
              </section>
            )}

            <section className="space-y-1.5">
              <h3 className="font-semibold">{t('admin_broker_purchases')}</h3>
              {detail.purchases.length === 0 ? <p className="text-muted-foreground">—</p> : (
                <ul className="space-y-1 text-xs">
                  {detail.purchases.map((p) => (
                    <li key={p.period_start} className="tabular-nums" dir="ltr">{`${Number(p.credits).toFixed(2)} CR · ${fmt(p.period_start)} → ${fmt(p.period_end)}`}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="font-semibold">{t('admin_broker_audit')}</h3>
              {detail.audit.length === 0 ? <p className="text-muted-foreground">—</p> : (
                <ul className="space-y-1 text-xs">
                  {detail.audit.slice(0, 30).map((a) => (
                    <li key={`${a.action}-${a.created_at}`} className="break-words"><span className="font-mono">{a.action}</span> · {new Date(a.created_at).toLocaleString()}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Verification queue ────────────────────────────────────────────────────

interface VerificationRow {
  id: string;
  display_name: string;
  role: string;
  status: string;
  verification_state: VerificationState;
  submitted_at: string | null;
  owner_email: string | null;
  owner_suspended: boolean;
  documents: number;
}

export function BrokerVerificationPanel({ onOpen }: { onOpen: (listingId: string) => void }) {
  const { t } = useLanguage();
  const [state, setState] = useState<string>('PENDING');
  const [rows, setRows] = useState<VerificationRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabase.rpc('admin_list_broker_verification', { p_state: state || null });
    if (error) { setFailed(true); setRows([]); return; }
    setFailed(false);
    setRows((data ?? []) as VerificationRow[]);
  }, [state]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT} value={state} onChange={(e) => setState(e.target.value)} aria-label={t('admin_broker_verification')}>
          <option value="">{t('admin_brokers_filter_all')}</option>
          {(['PENDING', 'UNVERIFIED', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const).map((s) => (
            <option key={s} value={s}>{t(`broker_verif_${s}` as TranslationKey)}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />{t('admin_refresh')}</Button>
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">{t('broker_desk_load_error')}</p>}
      {rows === null ? <Skeleton className="h-32" /> : rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{t('admin_broker_verification_empty')}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className="min-w-0 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">{r.display_name}</p>
                  <p className="break-all text-xs text-muted-foreground">{r.owner_email ?? '—'}</p>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-xs">{t(`broker_verif_${r.verification_state}` as TranslationKey)}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('admin_broker_docs_count', { count: String(r.documents) })} · {fmt(r.submitted_at)}
                {r.owner_suspended ? ` · ${t('broker_status_SUSPENDED')}` : ''}
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onOpen(r.id)}>{t('admin_broker_open')}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Broker Review queue ───────────────────────────────────────────────────

export function BrokerReviewPanel() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<string>('PENDING');
  const [rows, setRows] = useState<BrokerReviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await adminListBrokerReview(status || 'PENDING', 200));
      setFailed(false);
    } catch {
      setFailed(true);
      setRows([]);
    }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  const resolve = async (id: string, action: 'ACCEPT' | 'DISMISS') => {
    setBusy(id + action);
    try {
      const res = await adminResolveBrokerReview(id, action, notes[id]?.trim() || null);
      toast.success(res.status === 'DUPLICATE' ? t('admin_broker_review_duplicate') : t('admin_brokers_done'));
      await load();
    } catch (e) {
      const code = e instanceof BrokerRpcError ? e.code : 'UNKNOWN';
      toast.error(code === 'NO_PUBLIC_IDENTITY' ? t('admin_broker_review_no_identity') : errText(t, e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground max-w-3xl">{t('admin_broker_review_note')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('admin_brokers_filter_status')}>
          {(['PENDING', 'ACCEPTED', 'DISMISSED', 'DUPLICATE'] as const).map((s) => (
            <option key={s} value={s}>{t(`admin_broker_review_${s}` as TranslationKey)}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />{t('admin_refresh')}</Button>
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">{t('broker_desk_load_error')}</p>}
      {rows === null ? <Skeleton className="h-32" /> : rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{t('admin_broker_review_empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = (r.author_public_name as string | null) ?? t('broker_found_unnamed');
            const url = (r.author_public_url as string | null) ?? (r.source_url as string | null);
            return (
              <li key={r.id} className="min-w-0 rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.platform, r.city, r.language].filter(Boolean).join(' · ')} · {fmt(r.published_at as string | null)}
                      {r.confidence != null ? ` · ${Math.round(Number(r.confidence) * 100)}%` : ''}
                    </p>
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_broker_review_source')}
                    </a>
                  )}
                </div>
                {r.status === 'PENDING' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={notes[r.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder={t('admin_broker_note')}
                      aria-label={t('admin_broker_note')}
                      maxLength={500}
                      className="h-9 min-w-0 flex-1"
                    />
                    <Button size="sm" disabled={busy !== null} onClick={() => void resolve(r.id, 'ACCEPT')}>{t('admin_broker_review_accept')}</Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void resolve(r.id, 'DISMISS')}>{t('admin_broker_review_dismiss')}</Button>
                  </div>
                ) : (
                  <p className="mt-1.5 break-words text-xs text-muted-foreground">
                    {t(`admin_broker_review_${r.status}` as TranslationKey)}{r.note ? ` — ${String(r.note)}` : ''}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
