// ADMIN — Leads Database: the small pieces every tab shares (labels, errors, the reason
// dialog, the lead editor, the export download). Strings: admin_ldb_* (admin chunk).
import { AlertTriangle, Loader2 } from 'lucide-react';
import React from 'react';
import { Confirm, inputClass } from '@/components/admin/control/AdminKit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS } from '@/leads/importMapping';
import { cn } from '@/lib/utils';
import { buildWorkbook, type CellValue, downloadBlob, type SheetColumn, safeFileName, toCsv } from '@/lib/xlsx';
import {
  AdminLeadsError, type CanonicalField, type CanonicalRow, type LegalBasis, type SourceClass,
} from '@/services/curatedLeadsAdmin';

export type T = (key: string, vars?: Record<string, string | number>) => string;

const SERVER_ERRORS: Record<string, string> = {
  FORBIDDEN: 'admin_ldb_err_forbidden',
  NOT_FOUND: 'admin_ldb_err_not_found',
  REASON_REQUIRED: 'admin_ldb_err_reason',
  BATCH_NOT_STAGING: 'admin_ldb_err_not_staging',
  INVALID_ARGUMENT: 'admin_ldb_err_invalid',
  EMAIL_DUPLICATE: 'admin_ldb_rowerr_EMAIL_DUPLICATE',
  EXPORT_RATE_LIMITED: 'admin_ldb_err_export_rate',
  EXPORT_TOO_LARGE: 'admin_ldb_err_export_large',
};

/** A thrown refusal as a sentence: known codes translated, anything else "try again". */
export function errorText(e: unknown, t: T): string {
  const code = e instanceof AdminLeadsError ? e.code : '';
  return t(SERVER_ERRORS[code] ?? 'admin_ldb_err_generic');
}

const NUMBER_FIELDS = ['BUDGET_MIN', 'BUDGET_MAX', 'AREA_MIN', 'AREA_MAX', 'ROOMS_MIN', 'ROOMS_MAX'];
const ROW_ERRORS = new Set(['FIRST_NAME_REQUIRED', 'LAST_NAME_REQUIRED', 'EMAIL_REQUIRED', 'EMAIL_INVALID', 'EMAIL_DUPLICATE',
  'INTEREST_REQUIRED', 'INTEREST_UNKNOWN', 'COUNTRY_REQUIRED', 'COUNTRY_INVALID', 'LANGUAGE_INVALID', 'LANGUAGE_UNKNOWN',
  'CATEGORY_INVALID', 'CURRENCY_INVALID', 'DATE_INVALID']);

/** The bare code of a row problem ("INTEREST_UNKNOWN:kupit" → "INTEREST_UNKNOWN"). */
export const problemCode = (raw: string) => raw.split(':')[0];

/** A row problem in words. Codes carry the offending value after ':'. */
export function problemText(raw: string, t: T): string {
  const [code, ...rest] = raw.split(':');
  const value = rest.join(':');
  if (NUMBER_FIELDS.includes(code.replace(/_INVALID$/, ''))) {
    const field = code.replace(/_INVALID$/, '').toLowerCase();
    return t('admin_ldb_rowerr_NUMBER_INVALID', { field: t(`admin_ldb_f_${field}`) });
  }
  /* Contact details in pre-purchase free text, and table limits ("DESCRIPTION_TOO_LONG"). */
  if (code === 'CONTACT_IN_TEXT') return t('admin_ldb_rowerr_CONTACT_IN_TEXT', { field: t(`admin_ldb_f_${value}`) });
  if (code.endsWith('_TOO_LONG')) return t('admin_ldb_rowerr_TOO_LONG', { field: t(`admin_ldb_f_${code.replace(/_TOO_LONG$/, '').toLowerCase()}`) });
  if (code === 'LANGUAGES_TOO_MANY') return t('admin_ldb_rowerr_LANGUAGES_TOO_MANY');
  if (!ROW_ERRORS.has(code)) return code;
  return t(`admin_ldb_rowerr_${code}`, { value: value || '—' });
}

export function problemSummaryText(code: string, t: T): string {
  if (NUMBER_FIELDS.includes(code.replace(/_INVALID$/, ''))) return problemText(code, t);
  if (code === 'INTEREST_UNKNOWN' || code === 'LANGUAGE_INVALID') return t(`admin_ldb_rowsum_${code}`);
  return problemText(code, t);
}

export const fieldLabel = (f: CanonicalField, t: T) => t(`admin_ldb_f_${f}`);
export const sourceLabel = (s: SourceClass, t: T) => t(`admin_ldb_src_${s}`);
export const basisLabel = (b: LegalBasis, t: T) => t(`admin_ldb_lb_${b}`);
export const interestLabel = (i: string, t: T) => (['BUY', 'RENT', 'INVEST'].includes(i) ? t(`admin_ldb_int_${i}`) : i);

const TONES = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  bad: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300',
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-semibold', TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  VALID: 'good', INVALID: 'bad', DUPLICATE: 'warn', IMPORTED: 'info', SKIPPED: 'muted',
  STAGING: 'warn', COMMITTED: 'good', ARCHIVED: 'muted', PUBLISHED: 'good', HIDDEN: 'muted',
};

export function StatusPill({ status }: { status: string }) {
  const { t } = useLanguage();
  return <Pill tone={STATUS_TONE[status] ?? 'muted'}>{t(`admin_ldb_status_${status}`)}</Pill>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={cn('flex gap-2 rounded-lg border p-3 text-sm', tone === 'warn' ? TONES.warn : 'border-border bg-muted/40 text-muted-foreground')}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export const nf = (n: number | null | undefined, lang: string) =>
  (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat(lang).format(Number(n)));

export const list = (v: string[] | string | null | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

/**
 * A confirmation that requires (or offers) a written reason. `minLength` > 0 makes it required;
 * the confirm button stays disabled until it is long enough.
 */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, minLength = 0, busy, destructive, onConfirm, children }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; confirmLabel: string;
  minLength?: number; busy?: boolean; destructive?: boolean; onConfirm: (reason: string) => void; children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { if (open) setReason(''); }, [open]);
  const short = minLength > 0 && reason.trim().length < minLength;
  const id = React.useId();
  return (
    <Confirm open={open} onOpenChange={onOpenChange} title={title} description={description} confirmLabel={confirmLabel}
             busy={busy} destructive={destructive} confirmDisabled={short} onConfirm={() => onConfirm(reason.trim())}>
      {children}
      <div className="space-y-1">
        <label htmlFor={id} className="text-2xs font-medium text-muted-foreground">
          {minLength > 0 ? t('admin_ldb_reason_required', { n: minLength }) : t('admin_ldb_reason_optional')}
        </label>
        <Textarea id={id} value={reason} rows={3} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        {minLength > 0 && short && reason.length > 0 && (
          <p className="text-2xs text-destructive">{t('admin_ldb_reason_short', { n: minLength })}</p>
        )}
      </div>
    </Confirm>
  );
}

const CATEGORIES = ['PRIVATE', 'CORPORATE', 'DIASPORA', 'EXPAT', 'OTHER'];
const LONG_FIELDS = new Set<CanonicalField>(['description', 'investment_prefs', 'source_description', 'admin_notes']);

/** Values as the editor shows them: arrays joined, numbers as text. */
export function toEditable(src: Record<string, unknown>): CanonicalRow {
  const out: CanonicalRow = {};
  for (const f of IMPORT_FIELDS) {
    const v = src[f];
    if (v === null || v === undefined || v === '') continue;
    out[f] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/**
 * Edit every canonical field of one lead or staged row. The server re-validates; its problems
 * come back in `errors` and are listed above the form, and the dialog stays open.
 */
export function LeadFieldsDialog({ open, onOpenChange, title, description, initial, errors, warnings, busy, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string;
  initial: CanonicalRow; errors: string[]; warnings?: string[]; busy?: boolean; onSave: (data: CanonicalRow) => void;
}) {
  const { t } = useLanguage();
  const [data, setData] = React.useState<CanonicalRow>(initial);
  React.useEffect(() => { if (open) setData(initial); }, [open, initial]);
  const required = new Set<CanonicalField>(REQUIRED_IMPORT_FIELDS);
  const set = (f: CanonicalField, v: string) => setData((d) => ({ ...d, [f]: v }));
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="flex max-h-[90vh] max-w-[calc(100%-2rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form id="ldb-lead-form" className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1"
              onSubmit={(e) => { e.preventDefault(); onSave(data); }}>
          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-semibold text-destructive">{t('admin_ldb_fix_problems')}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs text-foreground">
                {errors.map((e) => <li key={e}>{problemText(e, t)}</li>)}
              </ul>
            </div>
          )}
          {warnings && warnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">{warnings.map((w) => <li key={w}>{problemText(w, t)}</li>)}</ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => {
              const id = `ldb-f-${f}`;
              const label = `${fieldLabel(f, t)}${required.has(f) ? ' *' : ''}`;
              return (
                <div key={f} className={cn('flex min-w-0 flex-col gap-1', LONG_FIELDS.has(f) && 'sm:col-span-2')}>
                  <label htmlFor={id} className="text-2xs font-medium text-muted-foreground">{label}</label>
                  {f === 'category' ? (
                    <select id={id} className={inputClass} value={data.category ?? ''} onChange={(e) => set(f, e.target.value)}>
                      <option value="">—</option>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{t(`admin_ldb_cat_${c}`)}</option>)}
                    </select>
                  ) : LONG_FIELDS.has(f) ? (
                    <Textarea id={id} rows={2} value={data[f] ?? ''} onChange={(e) => set(f, e.target.value)} />
                  ) : (
                    <input id={id} className={inputClass} value={data[f] ?? ''} onChange={(e) => set(f, e.target.value)}
                           dir={['email', 'phone', 'whatsapp', 'telegram', 'facebook', 'linkedin', 'other_social'].includes(f) ? 'ltr' : undefined}
                           type={['collected_at', 'last_verified_at'].includes(f) ? 'date' : 'text'} />
                  )}
                </div>
              );
            })}
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('admin_cc_cancel')}</Button>
          <Button type="submit" form="ldb-lead-form" disabled={busy}>
            {busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {t('admin_ldb_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rows returned by an audited export → a .xlsx and a .csv download, same columns. */
export function downloadExport(rows: Array<Record<string, unknown>>, baseName: string): void {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const columns: SheetColumn[] = keys.map((k) => ({ header: k, field: k, width: Math.min(40, Math.max(12, k.length + 4)) }));
  const flat = rows.map((r) => Object.fromEntries(keys.map((k) => {
    const v = r[k];
    const cell: CellValue = Array.isArray(v) ? v.join(', ') : v !== null && typeof v === 'object' ? JSON.stringify(v)
      : (v as CellValue);
    return [k, cell];
  })));
  downloadBlob(buildWorkbook([{ name: 'Export', columns, rows: flat }]), safeFileName(baseName, 'xlsx'));
  downloadBlob(new Blob([`﻿${toCsv(columns, flat)}`], { type: 'text/csv;charset=utf-8' }), safeFileName(baseName, 'csv'));
}
