// ADMIN — Leads Database → Import: template → upload → map columns → batch details + preview →
// stage (chunked) → validation results / fixes / commit (StagedBatch). Nothing is published here.
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import React from 'react';
import { Field, inputClass } from '@/components/admin/control/AdminKit';
import { ScrollTable } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildCuratedTemplate } from '@/leads/curatedTemplate';
import {
  assignColumn, autoMapHeaders, buildCountryResolver, buildLanguageResolver, type ColumnMapping, exampleRowCount,
  IMPORT_FIELDS, type MappedRow, mapRows, missingRequired, REQUIRED_IMPORT_FIELDS, unresolvedCountries,
} from '@/leads/importMapping';
import { countryOptions } from '@/lib/comm/countries';
import { readFile } from '@/lib/comm/importFile';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/lib/xlsx';
import {
  type CanonicalField, LEGAL_BASES, type LegalBasis, SOURCE_CLASSES, type SourceClass, saveBatch, stageRows,
} from '@/services/curatedLeadsAdmin';
import { StagedBatch } from './StagedBatch';
import { basisLabel, errorText, fieldLabel, Notice, nf, sourceLabel } from './shared';

const MAX_ROWS = 250_000;
const MAX_MB = 50;
const PREVIEW_ROWS = 20;

type Step = 'upload' | 'map' | 'details';
interface Loaded { fileName: string; headers: string[]; rows: string[][] }
interface Details {
  name: string; sourceClass: SourceClass; sourceDescription: string; acquiredAt: string;
  legalBasis: LegalBasis; rightsVerified: boolean; notes: string;
}

export function ImportTab({ batchId, onBatchChange }: { batchId: string; onBatchChange: (id: string | null) => void }) {
  const { t, lang } = useLanguage();
  const [step, setStep] = React.useState<Step>('upload');
  const [reading, setReading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>([]);
  const [details, setDetails] = React.useState<Details | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [stageError, setStageError] = React.useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = React.useState<string | null>(null);

  const resolvers = React.useMemo(() => ({
    country: buildCountryResolver(countryOptions('en').map((c) => c.code)),
    languages: buildLanguageResolver(),
  }), []);

  const mapped: MappedRow[] = React.useMemo(
    () => (loaded && step !== 'upload' ? mapRows(loaded.headers, loaded.rows, mapping, resolvers) : []),
    [loaded, mapping, resolvers, step],
  );

  if (batchId) {
    return <StagedBatch batchId={batchId} onNewImport={() => { reset(); onBatchChange(null); }} />;
  }

  function reset() {
    setStep('upload'); setLoaded(null); setMapping([]); setDetails(null); setProgress(null);
    setStageError(null); setPendingBatch(null); setFileError(null);
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setFileError(null);
    try {
      const sheet = await readFile(file, { maxRows: MAX_ROWS, maxBytes: MAX_MB * 1024 * 1024, onRowOverflow: 'error' });
      if (sheet.error) {
        setFileError(t(`admin_ldb_file_err_${sheet.error}`, { rows: nf(MAX_ROWS, lang), mb: MAX_MB }));
        return;
      }
      setLoaded({ fileName: file.name, headers: sheet.headers, rows: sheet.rows });
      setMapping(autoMapHeaders(sheet.headers));
      setDetails({
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 160), sourceClass: 'OTHER', sourceDescription: '', acquiredAt: '',
        legalBasis: 'UNVERIFIED', rightsVerified: false, notes: '',
      });
      setStep('map');
    } catch {
      setFileError(t('admin_ldb_file_err_UNREADABLE'));
    } finally {
      setReading(false);
    }
  };

  const stage = async () => {
    if (!loaded || !details) return;
    setStageError(null);
    setProgress({ done: 0, total: mapped.length });
    try {
      let id = pendingBatch;
      if (!id) {
        const b = await saveBatch({
          name: details.name.trim(), fileName: loaded.fileName, sourceClass: details.sourceClass,
          sourceDescription: details.sourceDescription.trim() || null, acquiredAt: details.acquiredAt || null,
          legalBasis: details.legalBasis, rightsVerified: details.rightsVerified, notes: details.notes.trim() || null,
        });
        id = b.id;
        setPendingBatch(id);
      }
      await stageRows(id, mapped.map((r) => ({ rowNo: r.rowNo, data: r.data, raw: r.raw })),
        (done, total) => setProgress({ done, total }));
      const done = id;
      reset();
      onBatchChange(done);
    } catch (e) {
      setStageError(errorText(e, t));
    }
  };

  const missing = missingRequired(mapping);
  const unresolved = unresolvedCountries(mapped);
  const examples = exampleRowCount(mapped);
  const mappedFields = IMPORT_FIELDS.filter((f) => mapping.includes(f));
  const staging = progress !== null && !stageError;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <FileSpreadsheet className="h-8 w-8 shrink-0 text-gold-ink" aria-hidden="true" />
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-semibold">{t('admin_ldb_tpl_title')}</p>
            <p className="text-xs text-muted-foreground">{t('admin_ldb_tpl_desc')}</p>
          </div>
          <Button type="button" size="sm" variant="outline"
                  onClick={() => downloadBlob(buildCuratedTemplate((s, v) => t(`admin_ldb_${s}`, v)), 'HOMATCH-leads-import-template.xlsx')}>
            <Download className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_tpl_download')}
          </Button>
        </CardContent>
      </Card>

      <ol className="flex flex-wrap gap-2 text-2xs font-medium" aria-label={t('admin_ldb_steps')}>
        {(['upload', 'map', 'details'] as Step[]).map((s, i) => (
          <li key={s} className={cn('rounded-full border px-2.5 py-1', step === s ? 'border-gold bg-gold/10 text-foreground' : 'text-muted-foreground')}
              aria-current={step === s ? 'step' : undefined}>
            {i + 1}. {t(`admin_ldb_step_${s}`)}
          </li>
        ))}
        <li className="rounded-full border px-2.5 py-1 text-muted-foreground">4. {t('admin_ldb_step_validate')}</li>
        <li className="rounded-full border px-2.5 py-1 text-muted-foreground">5. {t('admin_ldb_step_commit')}</li>
      </ol>

      {step === 'upload' && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin_ldb_upload_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('admin_ldb_upload_hint', { rows: nf(MAX_ROWS, lang), mb: MAX_MB })}</p>
            <label className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center hover:bg-accent/40',
              reading && 'pointer-events-none opacity-60')}>
              {reading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
              <span className="text-sm font-medium">{reading ? t('admin_ldb_reading') : t('admin_ldb_upload_choose')}</span>
              <input type="file" className="sr-only" accept=".xlsx,.csv,.tsv,.txt"
                     onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {fileError && <p role="alert" className="text-sm font-medium text-destructive">{fileError}</p>}
          </CardContent>
        </Card>
      )}

      {step === 'map' && loaded && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_ldb_map_title')}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('admin_ldb_map_file', { file: loaded.fileName, rows: nf(mapped.length, lang), cols: loaded.headers.length })}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('admin_ldb_map_hint')}</p>
            <ScrollTable minWidth={640}>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t('admin_ldb_map_col_header')}</th>
                    <th className="px-3 py-2 text-start">{t('admin_ldb_map_col_sample')}</th>
                    <th className="px-3 py-2 text-start">{t('admin_ldb_map_col_field')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.headers.map((h, col) => {
                    const samples = loaded.rows.map((r) => String(r[col] ?? '').trim()).filter(Boolean).slice(0, 2);
                    return (
                      <tr key={`${h}-${col}`} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{h || <span className="text-muted-foreground">{t('admin_ldb_map_unnamed', { n: col + 1 })}</span>}</td>
                        <td className="max-w-[16rem] truncate px-3 py-2 text-xs text-muted-foreground">{samples.join(' · ') || '—'}</td>
                        <td className="px-3 py-2">
                          <select className={cn(inputClass, 'h-8')} aria-label={t('admin_ldb_map_col_field')} value={mapping[col] ?? ''}
                                  onChange={(e) => setMapping(assignColumn(mapping, col, (e.target.value || null) as CanonicalField | null))}>
                            <option value="">{t('admin_ldb_map_ignore')}</option>
                            {IMPORT_FIELDS.map((f) => (
                              <option key={f} value={f}>{fieldLabel(f, t)}{REQUIRED_IMPORT_FIELDS.includes(f) ? ' *' : ''}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
            {missing.length > 0 && (
              <Notice tone="warn">{t('admin_ldb_map_missing', { fields: missing.map((f) => fieldLabel(f, t)).join(', ') })}</Notice>
            )}
            {unresolved.length > 0 && (
              <Notice tone="warn">{t('admin_ldb_map_country_unresolved', { n: unresolved.length, examples: unresolved.slice(0, 5).join(', ') })}</Notice>
            )}
            {!mapping.includes('languages') && <Notice>{t('admin_ldb_map_no_language')}</Notice>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />{t('admin_ldb_back')}
              </Button>
              <Button type="button" size="sm" disabled={missing.length > 0 || mapped.length === 0} onClick={() => setStep('details')}>
                {t('admin_ldb_continue')}<ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'details' && loaded && details && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('admin_ldb_details_title')}</CardTitle>
              <p className="text-xs text-muted-foreground">{t('admin_ldb_details_hint')}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`${t('admin_ldb_b_name')} *`} htmlFor="ldb-b-name">
                <input id="ldb-b-name" className={inputClass} maxLength={160} value={details.name} disabled={staging}
                       onChange={(e) => setDetails({ ...details, name: e.target.value })} />
              </Field>
              <Field label={t('admin_ldb_b_source_class')} htmlFor="ldb-b-src">
                <select id="ldb-b-src" className={inputClass} value={details.sourceClass} disabled={staging}
                        onChange={(e) => setDetails({ ...details, sourceClass: e.target.value as SourceClass })}>
                  {SOURCE_CLASSES.map((s) => <option key={s} value={s}>{sourceLabel(s, t)}</option>)}
                </select>
              </Field>
              <Field label={t('admin_ldb_b_source_desc')} htmlFor="ldb-b-srcdesc">
                <input id="ldb-b-srcdesc" className={inputClass} maxLength={600} value={details.sourceDescription} disabled={staging}
                       onChange={(e) => setDetails({ ...details, sourceDescription: e.target.value })} />
              </Field>
              <Field label={t('admin_ldb_b_acquired')} htmlFor="ldb-b-acq">
                <input id="ldb-b-acq" type="date" className={inputClass} value={details.acquiredAt} disabled={staging}
                       onChange={(e) => setDetails({ ...details, acquiredAt: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('admin_ldb_b_legal_basis')} htmlFor="ldb-b-lb">
                  <select id="ldb-b-lb" className={inputClass} value={details.legalBasis} disabled={staging}
                          onChange={(e) => setDetails({ ...details, legalBasis: e.target.value as LegalBasis })}>
                    {LEGAL_BASES.map((b) => <option key={b} value={b}>{basisLabel(b, t)}</option>)}
                  </select>
                </Field>
                <p className="mt-1 text-xs text-muted-foreground">{t(`admin_ldb_lb_${details.legalBasis}_desc`)}</p>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-border p-3 sm:col-span-2">
                <Checkbox id="ldb-b-rights" checked={details.rightsVerified} disabled={staging}
                          onCheckedChange={(v) => setDetails({ ...details, rightsVerified: v === true })} />
                <div className="min-w-0">
                  <label htmlFor="ldb-b-rights" className="text-sm font-medium">{t('admin_ldb_b_rights')}</label>
                  <p className="text-xs text-muted-foreground">{t('admin_ldb_b_rights_hint')}</p>
                </div>
              </div>
              <div className="sm:col-span-2">
                <Field label={t('admin_ldb_b_notes')} htmlFor="ldb-b-notes">
                  <Textarea id="ldb-b-notes" rows={2} value={details.notes} disabled={staging}
                            onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('admin_ldb_preview_title')}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t('admin_ldb_preview_hint', { n: Math.min(PREVIEW_ROWS, mapped.length), total: nf(mapped.length, lang) })}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {examples > 0 && <Notice tone="warn">{t('admin_ldb_example_rows_warn', { n: examples })}</Notice>}
              <ScrollTable minWidth={Math.max(640, mappedFields.length * 130)}>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-start">{t('admin_ldb_row')}</th>
                      {mappedFields.map((f) => <th key={f} className="px-2 py-2 text-start">{fieldLabel(f, t)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.slice(0, PREVIEW_ROWS).map((r) => (
                      <tr key={r.rowNo} className="border-t border-border">
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.rowNo}</td>
                        {mappedFields.map((f) => (
                          <td key={f} className={cn('max-w-[14rem] truncate px-2 py-1.5',
                            f === 'country' && r.data.country && !/^[A-Z]{2}$/.test(r.data.country) && 'text-destructive')}>
                            {r.data[f] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>

              {progress && (
                <div className="space-y-1" aria-live="polite">
                  <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                  <p className="text-xs text-muted-foreground">
                    {t('admin_ldb_staging', { done: nf(progress.done, lang), total: nf(progress.total, lang) })}
                  </p>
                </div>
              )}
              {stageError && <p role="alert" className="text-sm font-medium text-destructive">{stageError} {pendingBatch && t('admin_ldb_stage_retry_hint')}</p>}

              <div className="flex flex-wrap justify-between gap-2">
                <Button type="button" variant="outline" size="sm" disabled={staging || pendingBatch !== null} onClick={() => setStep('map')}>
                  <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />{t('admin_ldb_back')}
                </Button>
                <Button type="button" size="sm" disabled={staging || !details.name.trim()} onClick={() => void stage()}>
                  {staging && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  {t(stageError ? 'admin_ldb_stage_retry' : 'admin_ldb_stage_start', { n: nf(mapped.length, lang) })}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
