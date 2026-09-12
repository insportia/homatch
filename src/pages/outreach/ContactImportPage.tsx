// HOMATCH — the contact import wizard.
//
// §14's seven steps. The thing that makes it feel simple is that step 2 is
// usually a confirmation rather than a task: the columns are already mapped,
// including Georgian and Russian headers, so most people press Continue.
//
// THE STEP THAT IS NOT NEGOTIABLE
//
// Step 6, the consent attestation. Homatch is about to dial strangers on this
// customer's behalf, and the record of who said these contacts could be
// contacted, when, and against which terms, is what makes that defensible. It
// is stored on the list, not in a checkbox that disappears on submit.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Upload, Download, FileSpreadsheet, Loader2,
  CheckCircle2, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScrollTable, formatPhone } from '@/components/communications/primitives';
import {
  readFile, analyseSheet, prepareRows, sampleCsv,
  type ParsedSheet, type PreparedRow, type ImportSummary,
} from '@/lib/comm/importFile';
import type { DetectionResult, ContactField } from '@/lib/comm/headerDetect';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const STEPS = ['upload', 'mapping', 'country', 'preview', 'consent', 'done'] as const;
type Step = typeof STEPS[number];

const MAPPABLE: ContactField[] = [
  'phone', 'first_name', 'last_name', 'full_name', 'email', 'company',
  'country', 'language', 'city', 'budget_min', 'budget_max', 'notes',
];

/** The terms the attestation is recorded against. Bumped when the wording changes. */
const CONSENT_TERMS_VERSION = '2026-09-v1';

export default function ContactImportPage() {
  const { t } = useLanguage();
  const { supaUser: user } = useAuth();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [listName, setListName] = useState('');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [defaultCountry, setDefaultCountry] = useState('GE');
  const [duplicateMode, setDuplicateMode] = useState<'SKIP' | 'UPDATE'>('SKIP');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  const reanalyse = useCallback((from: ParsedSheet, country: string) => {
    const result = analyseSheet(from, { defaultCountry: country });
    setDetection(result.detection);
    setPrepared(result.prepared);
    setSummary(result.summary);
  }, []);

  const onFile = useCallback(async (file: File) => {
    setReading(true);
    try {
      const parsed = await readFile(file);
      setSheet(parsed);

      if (parsed.error) {
        toast.error(t(
          parsed.error === 'XLS_LEGACY' ? 'comm_import_xls_legacy'
          : parsed.error === 'TOO_LARGE' ? 'comm_import_too_large'
          : parsed.error === 'EMPTY' ? 'comm_import_empty'
          : 'comm_import_unreadable',
        ));
        return;
      }

      if (!listName.trim()) setListName(file.name.replace(/\.[^.]+$/, '').slice(0, 80));
      reanalyse(parsed, defaultCountry);
      setStep('mapping');
    } finally {
      setReading(false);
    }
  }, [listName, defaultCountry, reanalyse, t]);

  const setColumnField = useCallback((index: number, field: ContactField | 'IGNORE' | 'CUSTOM') => {
    if (!detection || !sheet) return;
    const columns = detection.columns.map((c) => {
      if (c.index !== index) {
        // A field can only be claimed once; assigning it here releases it
        // wherever it was, so two columns cannot both be "Phone".
        return field !== 'IGNORE' && field !== 'CUSTOM' && c.field === field
          ? { ...c, field: null, confidence: 'NONE' as const }
          : c;
      }
      return {
        ...c,
        field: field === 'IGNORE' || field === 'CUSTOM' ? null : field,
        keepAsCustom: field === 'CUSTOM',
        confidence: 'EXACT' as const,
      };
    });

    setDetection({ ...detection, columns, missingPhone: !columns.some((c) => c.field === 'phone') });

    // Rows are re-decided against the CORRECTED mapping, not the detected one,
    // so the preview always reflects what will actually be imported.
    const prep = prepareRows(sheet.rows, columns, { defaultCountry });
    setPrepared(prep.prepared);
    setSummary(prep.summary);
  }, [detection, sheet, defaultCountry]);

  const onCountryChange = useCallback((country: string) => {
    setDefaultCountry(country);
    if (sheet && detection) {
      const prep = prepareRows(sheet.rows, detection.columns, { defaultCountry: country });
      setPrepared(prep.prepared);
      setSummary(prep.summary);
    }
  }, [sheet, detection]);

  const importable = useMemo(
    () => prepared.filter((r) => r.status === 'VALID' || (duplicateMode === 'UPDATE' && r.status === 'DUPLICATE')),
    [prepared, duplicateMode],
  );

  const onImport = useCallback(async () => {
    if (!user?.id || !summary || !consent) return;
    setBusy(true);
    try {
      const { data: list, error: listError } = await supabase.from('outreach_contact_lists').insert({
        owner_id: user.id,
        name: listName.trim() || t('comm_import_untitled'),
        source_format: sheet?.format === 'XLSX' ? 'XLSX' : 'CSV',
        total_rows: summary.total,
        valid_rows: summary.valid,
        invalid_rows: summary.invalid,
        duplicate_rows: summary.duplicates,
        missing_phone: summary.invalid,
        import_status: 'ANALYZING',
        column_map: Object.fromEntries(
          (detection?.columns ?? []).filter((c) => c.field).map((c) => [c.header, c.field!]),
        ),
        default_country: defaultCountry,
        // §14 step 6, recorded on the list itself rather than in a transient
        // checkbox.
        consent_attested_at: new Date().toISOString(),
        consent_attested_by: user.id,
        consent_terms_version: CONSENT_TERMS_VERSION,
      }).select('id').maybeSingle();

      if (listError || !list) { toast.error(t('comm_import_failed')); return; }

      // Written in batches. One 40,000-row insert is a request that times out
      // and leaves the list half-populated with no way to tell.
      const BATCH = 500;
      for (let i = 0; i < importable.length; i += BATCH) {
        const slice = importable.slice(i, i + BATCH);
        const { error } = await supabase.from('outreach_contacts').insert(
          slice.map((row) => ({
            list_id: list.id,
            owner_id: user.id,
            phone: row.phone.e164,
            phone_raw: row.fields.phone ?? null,
            phone_valid: row.phone.valid,
            phone_e164_confidence: row.phone.confidence,
            country: row.phone.country ?? row.fields.country ?? null,
            country_inferred: row.phone.countryInferred,
            full_name: row.fields.full_name ?? null,
            email: row.fields.email ?? null,
            email_valid: row.fields.email ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.fields.email) : null,
            company: row.fields.company ?? null,
            language: row.fields.language ?? null,
            city: row.fields.city ?? null,
            notes: row.fields.notes ?? null,
            // The attestation applies to the contacts it covered.
            consent_status: 'CONSENTED',
            consent_source: `import:${CONSENT_TERMS_VERSION}`,
            raw_row: row.fields,
            normalized_data: { e164: row.phone.e164, kind: row.phone.kind },
            validation_status: row.status,
            custom_fields: Object.fromEntries(
              Object.entries(row.fields).filter(([k]) => k.startsWith('custom:')),
            ),
          })),
        );
        if (error) { toast.error(t('comm_import_partial')); break; }
      }

      await supabase.from('outreach_contact_lists')
        .update({ import_status: 'READY' }).eq('id', list.id);

      toast.success(t('comm_import_done'));
      setStep('done');
    } finally {
      setBusy(false);
    }
  }, [user?.id, summary, consent, listName, sheet, detection, defaultCountry, importable, t]);

  const downloadSample = useCallback(() => {
    const blob = new Blob([sampleCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'homatch-contacts-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <RouteGuard>
      <AppLayout>
        <div className="mx-auto max-w-3xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/contact-lists')}>
            <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_contact_lists')}
          </Button>

          <div>
            <h1 className="text-xl font-semibold">{t('comm_import_title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('comm_import_subtitle')}</p>
          </div>

          <ol className="flex overflow-x-auto rounded-lg border bg-card p-1">
            {STEPS.map((s, i) => (
              <li key={s} className="min-w-0 flex-1">
                <span className={cn(
                  'block truncate rounded-md px-2 py-1.5 text-center text-[13px] font-medium',
                  i === stepIndex ? 'bg-foreground text-background'
                    : i < stepIndex ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {t(`comm_istep_${s}` as TKey)}
                </span>
              </li>
            ))}
          </ol>

          {step === 'upload' ? (
            <Card><CardContent className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_import_list_name')}</Label>
                <Input value={listName} onChange={(e) => setListName(e.target.value)} className="h-9 text-sm" maxLength={80} />
              </div>

              {/* §14's exact user-facing guidance. */}
              <Alert>
                <AlertDescription className="text-xs">{t('comm_import_guidance')}</AlertDescription>
              </Alert>

              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 transition-colors hover:border-foreground/30"
              >
                {reading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                  : <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
                <span className="mt-2 text-sm font-medium">{t('comm_import_choose')}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">{t('comm_import_formats')}</span>
              </button>
              <input
                ref={fileInput} type="file" className="sr-only"
                accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />

              {sheet?.error === 'XLS_LEGACY' ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{t('comm_import_xls_legacy_long')}</AlertDescription>
                </Alert>
              ) : null}

              <Button variant="outline" size="sm" onClick={downloadSample}>
                <Download className="me-1.5 h-3.5 w-3.5" />{t('comm_import_sample')}
              </Button>
            </CardContent></Card>
          ) : null}

          {step === 'mapping' && detection ? (
            <Card><CardContent className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">{t('comm_import_mapping_help')}</p>

              {detection.headerRowLooksLikeData ? (
                <Alert>
                  <AlertDescription className="text-[13px]">{t('comm_import_no_header_row')}</AlertDescription>
                </Alert>
              ) : null}

              {detection.missingPhone ? (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{t('comm_import_no_phone_column')}</AlertDescription>
                </Alert>
              ) : null}

              <ul className="space-y-1.5">
                {detection.columns.map((col) => (
                  <li key={col.index} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{col.header || `#${col.index + 1}`}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                    <Select
                      value={col.field ?? (col.keepAsCustom ? 'CUSTOM' : 'IGNORE')}
                      onValueChange={(v) => setColumnField(col.index, v as ContactField | 'IGNORE' | 'CUSTOM')}
                    >
                      <SelectTrigger className="h-7 w-[150px] text-xs" aria-label={col.header}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IGNORE">{t('comm_import_ignore')}</SelectItem>
                        <SelectItem value="CUSTOM">{t('comm_import_keep_custom')}</SelectItem>
                        {MAPPABLE.map((f) => (
                          <SelectItem key={f} value={f}>{t(`comm_field_${f}` as TKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {col.confidence === 'FROM_DATA' ? (
                      <Badge variant="outline" className="shrink-0 text-[13px]">{t('comm_import_from_data')}</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent></Card>
          ) : null}

          {step === 'country' ? (
            <Card><CardContent className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">{t('comm_import_country_help')}</p>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_import_default_country')}</Label>
                <Select value={defaultCountry} onValueChange={onCountryChange}>
                  <SelectTrigger className="h-9 w-[200px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['GE', 'RU', 'TR', 'AM', 'AZ', 'UA', 'IL', 'AE', 'GB', 'US', 'DE'].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {summary ? (
                <p className="text-[13px] text-muted-foreground">
                  {t('comm_import_country_effect')
                    .replace('{valid}', String(summary.valid))
                    .replace('{total}', String(summary.total))}
                </p>
              ) : null}
            </CardContent></Card>
          ) : null}

          {step === 'preview' && summary ? (
            <Card><CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat labelKey="comm_import_valid" value={summary.valid} tone="good" />
                <Stat labelKey="comm_import_review" value={summary.review} tone="warn" />
                <Stat labelKey="comm_import_invalid" value={summary.invalid} tone="bad" />
                <Stat labelKey="comm_import_duplicates" value={summary.duplicates} />
                <Stat labelKey="comm_import_suppressed" value={summary.suppressed} tone="bad" />
              </div>

              {summary.suppressed > 0 ? (
                // §14 step 5's rule, said out loud so nobody expects otherwise.
                <Alert>
                  <ShieldCheck className="h-4 w-4" />
                  <AlertDescription className="text-[13px]">{t('comm_import_suppressed_note')}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_import_duplicates_mode')}</Label>
                <Select value={duplicateMode} onValueChange={(v) => setDuplicateMode(v as 'SKIP' | 'UPDATE')}>
                  <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SKIP">{t('comm_import_dup_skip')}</SelectItem>
                    <SelectItem value="UPDATE">{t('comm_import_dup_update')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <ScrollTable minWidth={640}>
                <table className="w-full text-[13px]">
                  <thead className="border-b bg-muted/40">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                      <th>{t('comm_col_status')}</th>
                      <th>{t('comm_field_phone')}</th>
                      <th>{t('comm_field_full_name')}</th>
                      <th>{t('comm_field_email')}</th>
                      <th>{t('comm_field_country')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prepared.slice(0, 25).map((row) => (
                      <tr key={row.index} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1">
                        <td>
                          <Badge variant="outline" className={cn(
                            'text-[13px]',
                            row.status === 'VALID' && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                            row.status === 'INVALID' && 'border-red-500/40 text-red-700 dark:text-red-400',
                            row.status === 'REVIEW' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
                          )}>
                            {t(`comm_row_${row.status.toLowerCase()}` as TKey)}
                          </Badge>
                        </td>
                        <td className="font-mono">{formatPhone(row.phone.e164) || row.fields.phone || '·'}</td>
                        <td className="max-w-[140px] truncate">{row.fields.full_name ?? '·'}</td>
                        <td className="max-w-[160px] truncate">{row.fields.email ?? '·'}</td>
                        <td>{row.phone.country ?? '·'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
              {prepared.length > 25 ? (
                <p className="text-[13px] text-muted-foreground">
                  {t('comm_import_preview_more').replace('{n}', String(prepared.length - 25))}
                </p>
              ) : null}
            </CardContent></Card>
          ) : null}

          {step === 'consent' ? (
            <Card><CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">{t('comm_import_consent_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('comm_import_consent_body')}</p>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                  aria-label={t('comm_import_consent_label')}
                />
                <span className="text-xs">{t('comm_import_consent_label')}</span>
              </label>
              <p className="text-[13px] text-muted-foreground">
                {t('comm_import_consent_record').replace('{v}', CONSENT_TERMS_VERSION)}
              </p>
            </CardContent></Card>
          ) : null}

          {step === 'done' && summary ? (
            <Card><CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                <p className="text-sm font-medium">{t('comm_import_done_title')}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t('comm_import_imported')}</dt><dd className="font-medium tabular-nums">{importable.length}</dd></div>
                <div><dt className="text-muted-foreground">{t('comm_import_invalid')}</dt><dd className="font-medium tabular-nums">{summary.invalid}</dd></div>
                <div><dt className="text-muted-foreground">{t('comm_import_duplicates')}</dt><dd className="font-medium tabular-nums">{summary.duplicates}</dd></div>
                <div><dt className="text-muted-foreground">{t('comm_import_suppressed')}</dt><dd className="font-medium tabular-nums">{summary.suppressed}</dd></div>
              </dl>
              {Object.keys(summary.byCountry).length ? (
                <div>
                  <p className="text-xs font-medium">{t('comm_import_by_country')}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(summary.byCountry).sort(([, a], [, b]) => b - a).map(([c, n]) => (
                      <Badge key={c} variant="outline" className="text-[13px]">{c} {n}</Badge>
                    ))}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate('/outreach/campaigns/new')}>{t('comm_new_campaign')}</Button>
                <Button size="sm" variant="outline" onClick={() => navigate('/outreach/contact-lists')}>
                  {t('comm_contact_lists')}
                </Button>
              </div>
            </CardContent></Card>
          ) : null}

          {step !== 'done' ? (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button
                variant="outline" size="sm" disabled={stepIndex === 0}
                onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
              >
                <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_back')}
              </Button>
              {step === 'consent' ? (
                <Button size="sm" disabled={!consent || busy || !importable.length} onClick={() => void onImport()}>
                  {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="me-1.5 h-3.5 w-3.5" />}
                  {t('comm_import_button').replace('{n}', String(importable.length))}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!sheet || (step === 'mapping' && Boolean(detection?.missingPhone))}
                  onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)])}
                >
                  {t('comm_continue')}<ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" />
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

function Stat({ labelKey, value, tone }: { labelKey: string; value: number; tone?: 'good' | 'warn' | 'bad' }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-md border p-2">
      <p className="truncate text-[13px] text-muted-foreground">{t(labelKey as TKey)}</p>
      <p className={cn(
        'text-lg font-semibold tabular-nums',
        tone === 'good' && value > 0 && 'text-emerald-600 dark:text-emerald-400',
        tone === 'warn' && value > 0 && 'text-amber-600 dark:text-amber-400',
        tone === 'bad' && value > 0 && 'text-red-600 dark:text-red-400',
      )}>
        {value}
      </p>
    </div>
  );
}
