// HOMATCH Admin — bank mortgage products: create, edit, verify, retire.
//
// Writes go straight to public.mortgage_bank_products under its admin-only
// RLS policies (migration 20261201092000); the table's trigger stamps
// created_by / updated_by and writes every insert and update to
// admin_audit_log, so nothing here writes the audit row itself. Each write
// asks for the stored row back: a write that matched nothing (not an admin,
// row gone) is reported as a failure, never as "saved".
//
// Customers see a product only while it is VERIFIED, inside its review
// window and started (RLS). The rules an edit obeys are in
// src/admin/mortgageBankProducts.ts.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Confirm, Empty, ErrorNote, Field, inputClass } from '@/components/admin/control/AdminKit';
import {
  BANK_PRODUCT_CURRENCIES, BANK_PRODUCT_RATE_TYPES, allowedMoves, editWrite, emptyBankProductForm, formFromRow,
  localToday, publicVisibility, validateBankProductForm, verifyWrite,
  type BankProductForm, type BankProductRow, type BankProductStatus, type FormErrors,
} from '@/admin/mortgageBankProducts';

const COLUMNS = 'id,bank_name,product_name,currency,min_term_months,max_term_months,rate_from_percent,rate_to_percent,rate_type,effective_rate_from_percent,min_down_payment_percent,notes,source_url,verified_at,effective_from,review_due_days,review_status,updated_at';

type Editing = { id: string | null; status: BankProductStatus | null; form: BankProductForm };
type VerifyState = { row: BankProductRow; url: string; date: string; error: string | null };

const VIS_TONE: Record<string, string> = {
  SHOWN: 'bg-emerald-500/15 text-emerald-800',
  STALE: 'bg-amber-500/15 text-amber-800',
  NOT_STARTED: 'bg-sky-500/15 text-sky-800',
  DRAFT: 'bg-muted text-muted-foreground',
  RETIRED: 'bg-muted text-muted-foreground',
};

export default function MortgageBankProductsAdmin() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<BankProductRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [verify, setVerify] = useState<VerifyState | null>(null);
  const [retire, setRetire] = useState<BankProductRow | null>(null);
  const [restore, setRestore] = useState<BankProductRow | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => localToday(), []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('mortgage_bank_products').select(COLUMNS)
      .order('review_status').order('bank_name').order('product_name');
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    setRows((data ?? []) as unknown as BankProductRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fail = (e: { message?: string } | null | undefined) => toast.error(t('admin_hs_bp_save_failed'), { description: e?.message ?? t('admin_hs_bp_err_not_saved') });

  /** Every write returns the stored row; no row back means nothing was written. */
  const write = async (id: string, patch: Record<string, unknown>) => {
    const { data, error } = await supabase.from('mortgage_bank_products').update(patch).eq('id', id).select('id').maybeSingle();
    if (error || !data) { fail(error); return false; }
    return true;
  };

  const save = async () => {
    if (!editing) return;
    const v = validateBankProductForm(editing.form);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setSaving(true);
    try {
      const patch = editWrite(editing.status, v.payload);
      let ok: boolean;
      if (editing.id === null) {
        const { data, error } = await supabase.from('mortgage_bank_products').insert(patch).select('id').maybeSingle();
        ok = !error && !!data;
        if (!ok) fail(error);
      } else {
        ok = await write(editing.id, patch);
      }
      if (ok) {
        toast.success(t(editing.status === 'VERIFIED' ? 'admin_hs_bp_saved_back_to_draft' : 'admin_hs_bp_saved'));
        setEditing(null);
        await load();
      }
    } finally { setSaving(false); }
  };

  const doVerify = async () => {
    if (!verify) return;
    const v = verifyWrite(verify.url, verify.date, today);
    if (!v.ok) { setVerify({ ...verify, error: v.error }); return; }
    setBusy(true);
    try {
      if (await write(verify.row.id, v.payload)) { toast.success(t('admin_hs_bp_verified_done')); setVerify(null); await load(); }
    } finally { setBusy(false); }
  };

  const setStatus = async (row: BankProductRow, status: BankProductStatus, done: string, close: () => void) => {
    setBusy(true);
    try {
      if (await write(row.id, { review_status: status })) { toast.success(t(done)); close(); await load(); }
    } finally { setBusy(false); }
  };

  const setField = (k: keyof BankProductForm, v: string) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  // The message sits outside the label and is linked by aria-describedby, so the field's name stays its label.
  const err = (k: keyof BankProductForm) => (errors[k] ? <span id={`bp-err-${k}`} role="alert" className="text-2xs text-destructive">{t(errors[k] as string)}</span> : null);
  const input = (k: keyof BankProductForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Field label={label}>
        <input className={cn(inputClass, errors[k] && 'border-destructive')} value={editing?.form[k] ?? ''} aria-invalid={!!errors[k]}
          aria-describedby={errors[k] ? `bp-err-${k}` : undefined} onChange={(e) => setField(k, e.target.value)} {...extra} />
      </Field>
      {err(k)}
    </div>
  );

  const rate = (r: BankProductRow) => {
    if (r.rate_from_percent === null || r.rate_from_percent === undefined) return t('admin_hs_bp_not_entered');
    const to = r.rate_to_percent !== null && r.rate_to_percent !== undefined && Number(r.rate_to_percent) !== Number(r.rate_from_percent) ? `–${r.rate_to_percent}` : '';
    return `${r.rate_from_percent}${to}%${r.rate_type ? ` · ${t(`admin_hs_bp_rate_${String(r.rate_type).toLowerCase()}`)}` : ''}`;
  };

  return (
    <section className="space-y-3" data-testid="admin-mortgage-bank-products">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('admin_hs_banks_title')}</h2>
          <p className="text-xs text-muted-foreground">{t('admin_hs_bp_sub')}</p>
        </div>
        <button type="button" onClick={() => { setErrors({}); setEditing({ id: null, status: null, form: emptyBankProductForm() }); }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_hs_bp_new')}
        </button>
      </div>

      {loadError ? <ErrorNote message={loadError} /> : null}

      {editing ? (
        <form className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={t(editing.id ? 'admin_hs_bp_edit_title' : 'admin_hs_bp_new')}
          onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h3 className="text-sm font-semibold">{t(editing.id ? 'admin_hs_bp_edit_title' : 'admin_hs_bp_new')}</h3>
          {editing.status === 'VERIFIED' ? <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">{t('admin_hs_bp_edit_verified_note')}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {input('bank_name', t('admin_hs_col_bank'), { required: true })}
            {input('product_name', t('admin_hs_col_product'), { required: true })}
            <Field label={t('admin_hs_bp_currency')}>
              <select className={inputClass} value={editing.form.currency} onChange={(e) => setField('currency', e.target.value)}>
                {BANK_PRODUCT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {err('currency')}
            </Field>
            {input('rate_from_percent', t('admin_hs_bp_rate_from'), { inputMode: 'decimal' })}
            {input('rate_to_percent', t('admin_hs_bp_rate_to'), { inputMode: 'decimal' })}
            <Field label={t('admin_hs_bp_rate_type')}>
              <select className={inputClass} value={editing.form.rate_type} onChange={(e) => setField('rate_type', e.target.value)}>
                <option value="">{t('admin_hs_bp_not_entered')}</option>
                {BANK_PRODUCT_RATE_TYPES.map((c) => <option key={c} value={c}>{t(`admin_hs_bp_rate_${c.toLowerCase()}`)}</option>)}
              </select>
              {err('rate_type')}
            </Field>
            {input('effective_rate_from_percent', t('admin_hs_bp_effective_rate'), { inputMode: 'decimal' })}
            {input('min_down_payment_percent', t('admin_hs_col_down'), { inputMode: 'decimal' })}
            {input('min_term_months', t('admin_hs_bp_min_term'), { inputMode: 'numeric' })}
            {input('max_term_months', t('admin_hs_bp_max_term'), { inputMode: 'numeric' })}
            {input('source_url', t('admin_hs_bp_source_url'), { type: 'url', required: true, dir: 'ltr', placeholder: 'https://' })}
            {input('effective_from', t('admin_hs_bp_effective_from'), { type: 'date' })}
            {input('review_due_days', t('admin_hs_bp_review_days'), { inputMode: 'numeric' })}
          </div>
          <Field label={t('admin_hs_bp_notes')}>
            <textarea className={cn(inputClass, 'h-20 py-2')} value={editing.form.notes} onChange={(e) => setField('notes', e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="min-h-9 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-60">{saving ? t('admin_hs_bp_saving') : t('admin_hs_bp_save')}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(null); setErrors({}); }} className="min-h-9 rounded-md border border-border px-3 text-sm">{t('admin_cc_cancel')}</button>
          </div>
        </form>
      ) : null}

      {rows && rows.length === 0 ? <Empty>{t('admin_hs_banks_empty')}</Empty> : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                {[t('admin_hs_col_bank'), t('admin_hs_col_product'), t('admin_hs_col_rate'), t('admin_hs_col_down'), t('admin_hs_col_status'), t('admin_hs_bp_public'), t('admin_hs_col_verified'), t('admin_hs_bp_actions')].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-start text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vis = publicVisibility(r, today);
                const moves = allowedMoves(r.review_status);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">{r.bank_name}</td>
                    <td className="px-3 py-2"><a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">{r.product_name}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a></td>
                    <td className="px-3 py-2 tabular-nums">{rate(r)} <span className="text-muted-foreground">{r.currency}</span></td>
                    <td className="px-3 py-2 tabular-nums">{r.min_down_payment_percent !== null ? `${r.min_down_payment_percent}%` : '—'}</td>
                    <td className="px-3 py-2">{t(`admin_hs_review_${r.review_status.toLowerCase()}`)}</td>
                    <td className="px-3 py-2"><span className={cn('rounded px-1.5 py-0.5 text-2xs font-semibold', VIS_TONE[vis])}>{t(`admin_hs_bp_vis_${vis.toLowerCase()}`)}</span></td>
                    <td className="px-3 py-2 tabular-nums">{r.verified_at ?? t('admin_hs_unverified')}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.review_status !== 'RETIRED' ? (
                          <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs"
                            onClick={() => { setErrors({}); setEditing({ id: r.id, status: r.review_status, form: formFromRow(r) }); }}>{t('admin_hs_bp_edit')}</button>
                        ) : null}
                        {moves.includes('verify') ? (
                          <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs"
                            onClick={() => setVerify({ row: r, url: r.source_url, date: today, error: null })}>{t(r.review_status === 'VERIFIED' ? 'admin_hs_bp_reverify' : 'admin_hs_bp_verify')}</button>
                        ) : null}
                        {moves.includes('retire') ? (
                          <button type="button" className="min-h-9 rounded-md border border-destructive/40 px-2 text-xs text-destructive" onClick={() => setRetire(r)}>{t('admin_hs_bp_retire')}</button>
                        ) : null}
                        {moves.includes('restore') ? (
                          <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs" onClick={() => setRestore(r)}>{t('admin_hs_bp_restore')}</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Confirm open={verify !== null} onOpenChange={(o) => { if (!o) setVerify(null); }} title={t('admin_hs_bp_verify_title')}
        description={t('admin_hs_bp_verify_body', { bank: verify?.row.bank_name ?? '', product: verify?.row.product_name ?? '' })}
        confirmLabel={t('admin_hs_bp_verify')} onConfirm={() => void doVerify()} busy={busy}>
        {verify ? (
          <div className="grid gap-3">
            <Field label={t('admin_hs_bp_source_url')}>
              <input className={inputClass} type="url" dir="ltr" value={verify.url} onChange={(e) => setVerify({ ...verify, url: e.target.value, error: null })} />
            </Field>
            <Field label={t('admin_hs_bp_verified_on')}>
              <input className={inputClass} type="date" max={today} value={verify.date} onChange={(e) => setVerify({ ...verify, date: e.target.value, error: null })} />
            </Field>
            {verify.error ? <p role="alert" className="text-xs text-destructive">{t(verify.error)}</p> : null}
          </div>
        ) : null}
      </Confirm>
      <Confirm open={retire !== null} onOpenChange={(o) => { if (!o) setRetire(null); }} title={t('admin_hs_bp_retire_title')} destructive
        description={t('admin_hs_bp_retire_body', { bank: retire?.bank_name ?? '', product: retire?.product_name ?? '' })}
        confirmLabel={t('admin_hs_bp_retire')} busy={busy}
        onConfirm={() => { if (retire) void setStatus(retire, 'RETIRED', 'admin_hs_bp_retired_done', () => setRetire(null)); }} />
      <Confirm open={restore !== null} onOpenChange={(o) => { if (!o) setRestore(null); }} title={t('admin_hs_bp_restore_title')}
        description={t('admin_hs_bp_restore_body')} confirmLabel={t('admin_hs_bp_restore')} busy={busy}
        onConfirm={() => { if (restore) void setStatus(restore, 'DRAFT', 'admin_hs_bp_restored_done', () => setRestore(null)); }} />
    </section>
  );
}
