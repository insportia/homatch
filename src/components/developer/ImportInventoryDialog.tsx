import React, { useCallback, useMemo, useState } from 'react';
import { Upload, ArrowRight, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { importUnits } from '@/services/developer/inventory';
import { IMPORT_FIELDS, suggestFieldForHeader, type ImportField } from '@/services/developer/exports';
/*
 * §187: the Communications import wizard already reads spreadsheets, and it
 * has been through the failures this code would otherwise repeat — the .xls
 * that needs re-saving, the CSV whose delimiter is a semicolon, the quoted
 * comma inside an address, and read-excel-file 9.x returning worksheets
 * rather than rows. Reusing it means inventory import inherits all of that
 * rather than rediscovering it one customer file at a time.
 */
import { readFile } from '@/lib/comm/importFile';
import { devErrorText } from '@/services/developer/client';
import { TableScroll, Th, Td, Eyebrow, GoldRule } from './primitives';
import type { ImportResult } from '@/services/developer/types';

/**
 * IMPORTING A DEVELOPER'S EXISTING SPREADSHEET (§71, §72).
 *
 * Five steps, and the fourth one is the point of the whole thing:
 *
 *   FILE     an xlsx or csv, read in the browser. The workbook is never
 *            uploaded anywhere and is never stored.
 *   MAP      each column of theirs is paired with a field of ours. Homatch
 *            SUGGESTS the pairing — including from Georgian, Russian and
 *            Turkish headers — and a person confirms it. A suggestion that
 *            applies itself is how an "Area" column ends up in "Price".
 *   PREVIEW  the first rows as they will actually be written, with the
 *            problems named before anything is committed.
 *   MODE     add only, or add and update. There is no mode that deletes, and
 *            there is no mode that silently overwrites — "add only" reports
 *            the duplicates it skipped rather than quietly resolving them.
 *   RESULT   what happened, row by row for anything that failed.
 *
 * The whole import is one database transaction on the server, so a sheet that
 * breaks on row 400 does not leave 399 apartments behind.
 */

type Step = 'file' | 'map' | 'preview' | 'result';

const FIELD_LABEL_KEYS: Record<ImportField, string> = {
  unit_number: 'dev_imp_unit_number',
  building: 'dev_imp_building',
  floor_level: 'dev_imp_floor',
  unit_type: 'dev_imp_type',
  bedrooms: 'dev_imp_bedrooms',
  rooms: 'dev_imp_rooms',
  area_total: 'dev_imp_area',
  area_internal: 'dev_imp_area_internal',
  area_balcony: 'dev_imp_area_balcony',
  orientation: 'dev_imp_orientation',
  view_text: 'dev_imp_view',
  price: 'dev_imp_price',
  currency: 'dev_imp_currency',
  notes: 'dev_imp_notes',
};

const NUMERIC_FIELDS: ImportField[] = [
  'floor_level', 'bedrooms', 'rooms', 'area_total', 'area_internal', 'area_balcony', 'price',
];

/**
 * A spreadsheet cell arrives as whatever the sheet held: a number, a Date, a
 * string with a currency symbol, a string with a comma decimal separator.
 * This turns it into the plain string the RPC casts, and refuses rather than
 * guesses when it cannot.
 */
function normalise(value: unknown, field: ImportField): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  let text = String(value).trim();
  if (!NUMERIC_FIELDS.includes(field)) return text;

  // Strip currency symbols, spaces and thousands separators, then settle the
  // decimal mark. "1 250,50 $" and "1,250.50" must both become 1250.50.
  text = text.replace(/[^\d.,\-]/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal mark; the other is a grouping mark.
    text = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A lone comma with two digits after it is a decimal mark; otherwise it
    // is grouping ("1,250").
    text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  return text;
}

export interface ImportInventoryDialogProps {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportInventoryDialog({
  open, projectId, projectName, onClose, onImported,
}: ImportInventoryDialogProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, ImportField | ''>>({});
  const [mode, setMode] = useState<'INSERT' | 'UPSERT'>('INSERT');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = useCallback(() => {
    setStep('file'); setFileName(''); setHeaders([]); setRows([]);
    setMapping({}); setMode('INSERT'); setResult(null); setBusy(false);
  }, []);

  const readSpreadsheet = async (file: File) => {
    setBusy(true);
    try {
      const sheet = await readFile(file);
      if (sheet.error === 'XLS_LEGACY') { toast.error(t('dev_imp_err_xls')); return; }
      if (sheet.error === 'TOO_LARGE') { toast.error(t('dev_err_file_too_large')); return; }
      if (sheet.error || sheet.headers.length === 0) { toast.error(t('dev_imp_err_empty')); return; }

      setFileName(file.name);
      setHeaders(sheet.headers);
      setRows(sheet.rows);

      const guessed: Record<number, ImportField | ''> = {};
      const taken = new Set<string>();
      sheet.headers.forEach((header, index) => {
        const suggestion = suggestFieldForHeader(header);
        // One column per field. A sheet with "Area" and "Area m2" must not map
        // both onto area_total and silently keep whichever wrote last.
        if (suggestion && !taken.has(suggestion) && IMPORT_FIELDS.includes(suggestion as ImportField)) {
          guessed[index] = suggestion as ImportField;
          taken.add(suggestion);
        } else {
          guessed[index] = '';
        }
      });
      setMapping(guessed);
      setStep('map');
    } catch {
      toast.error(t('dev_imp_err_read'));
    } finally {
      setBusy(false);
    }
  };

  const mappedRows = useMemo(() => {
    const entries = Object.entries(mapping)
      .filter(([, field]) => field !== '') as Array<[string, ImportField]>;
    return rows.map((row) => {
      const out: Record<string, string> = {};
      for (const [indexText, field] of entries) {
        out[field] = normalise(row[Number(indexText)], field);
      }
      return out;
    });
  }, [rows, mapping]);

  const hasUnitNumber = Object.values(mapping).includes('unit_number');

  const problems = useMemo(() => {
    const missing = mappedRows.filter((r) => !r.unit_number?.trim()).length;
    const seen = new Set<string>();
    let duplicates = 0;
    for (const row of mappedRows) {
      const key = row.unit_number?.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) duplicates += 1;
      seen.add(key);
    }
    const badPrice = mappedRows.filter(
      (r) => r.price !== undefined && r.price !== '' && !Number.isFinite(Number(r.price))).length;
    return { missing, duplicates, badPrice };
  }, [mappedRows]);

  const runImport = async () => {
    setBusy(true);
    try {
      const payload = mappedRows.filter((r) => r.unit_number?.trim());
      const res = await importUnits(projectId, payload, mode);
      setResult(res);
      setStep('result');
      onImported();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('dev_imp_title')}</DialogTitle>
          <DialogDescription>
            {t('dev_imp_subtitle').replace('{project}', projectName)}
          </DialogDescription>
        </DialogHeader>

        {step === 'file' && (
          <div className="space-y-4">
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center transition-colors',
                'hover:border-gold-border/70 focus-within:ring-2 focus-within:ring-ring',
              )}
            >
              <Upload className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">{t('dev_imp_choose_file')}</span>
              <span className="text-2xs text-muted-foreground">{t('dev_imp_formats')}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readSpreadsheet(file);
                  e.target.value = '';
                }}
              />
            </label>
            {busy && <p className="text-center text-xs text-muted-foreground">{t('dev_imp_reading')}</p>}
            <p className="text-2xs text-muted-foreground">{t('dev_imp_privacy_note')}</p>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span className="truncate">{fileName}</span>
              <span className="tabular">· {rows.length} {t('dev_imp_rows')}</span>
            </div>

            <div>
              <Eyebrow>{t('dev_imp_map_title')}</Eyebrow>
              <GoldRule className="mt-2" />
              <p className="mt-2 text-xs text-muted-foreground">{t('dev_imp_map_body')}</p>
            </div>

            <ul className="space-y-2">
              {headers.map((header, index) => (
                <li key={index} className="grid grid-cols-[1fr,auto,1fr] items-center gap-2">
                  <span className="truncate rounded-md bg-muted px-2.5 py-1.5 text-xs" title={header}>
                    {header || t('dev_imp_unnamed_column')}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <Select
                    value={mapping[index] || 'IGNORE'}
                    onValueChange={(v) => setMapping((m) => ({
                      ...m, [index]: v === 'IGNORE' ? '' : (v as ImportField),
                    }))}
                  >
                    <SelectTrigger aria-label={t('dev_imp_map_for').replace('{column}', header)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IGNORE">{t('dev_imp_ignore')}</SelectItem>
                      {IMPORT_FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>{t(FIELD_LABEL_KEYS[field])}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>

            {!hasUnitNumber && (
              <p className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                {t('dev_imp_need_unit_number')}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>{t('dev_back')}</Button>
              <Button disabled={!hasUnitNumber} onClick={() => setStep('preview')}>
                {t('dev_imp_preview')}
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div>
              <Eyebrow>{t('dev_imp_preview_title')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>

            <TableScroll className="rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    {(Object.values(mapping).filter(Boolean) as ImportField[]).map((field) => (
                      <Th key={field}>{t(FIELD_LABEL_KEYS[field])}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mappedRows.slice(0, 8).map((row, i) => (
                    <tr key={i}>
                      {(Object.values(mapping).filter(Boolean) as ImportField[]).map((field) => (
                        <Td key={field} className={cn(!row[field] && 'text-muted-foreground')}>
                          {row[field] || '—'}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            {mappedRows.length > 8 && (
              <p className="text-2xs text-muted-foreground">
                {t('dev_imp_more_rows').replace('{n}', String(mappedRows.length - 8))}
              </p>
            )}

            {(problems.missing > 0 || problems.duplicates > 0 || problems.badPrice > 0) && (
              <ul className="space-y-1 rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs">
                {problems.missing > 0 && (
                  <li>{t('dev_imp_problem_missing').replace('{n}', String(problems.missing))}</li>
                )}
                {problems.duplicates > 0 && (
                  <li>{t('dev_imp_problem_duplicates').replace('{n}', String(problems.duplicates))}</li>
                )}
                {problems.badPrice > 0 && (
                  <li>{t('dev_imp_problem_price').replace('{n}', String(problems.badPrice))}</li>
                )}
              </ul>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium">{t('dev_imp_mode_title')}</legend>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'INSERT' | 'UPSERT')}>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="INSERT" id="dev-imp-insert" className="mt-1" />
                  <Label htmlFor="dev-imp-insert" className="font-normal">
                    <span className="block text-sm font-medium">{t('dev_imp_mode_insert')}</span>
                    <span className="block text-2xs text-muted-foreground">{t('dev_imp_mode_insert_body')}</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="UPSERT" id="dev-imp-upsert" className="mt-1" />
                  <Label htmlFor="dev-imp-upsert" className="font-normal">
                    <span className="block text-sm font-medium">{t('dev_imp_mode_upsert')}</span>
                    <span className="block text-2xs text-muted-foreground">{t('dev_imp_mode_upsert_body')}</span>
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('map')}>{t('dev_back')}</Button>
              <Button disabled={busy} onClick={runImport}>
                {busy ? t('dev_imp_importing') : t('dev_imp_confirm')}
              </Button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              <p className="text-sm font-medium">{t('dev_imp_done')}</p>
            </div>

            <dl className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3">
                <dt className="text-2xs text-muted-foreground">{t('dev_imp_inserted')}</dt>
                <dd className="text-xl font-semibold tabular">{result.inserted}</dd>
              </div>
              <div className="rounded-md border border-border p-3">
                <dt className="text-2xs text-muted-foreground">{t('dev_imp_updated')}</dt>
                <dd className="text-xl font-semibold tabular">{result.updated}</dd>
              </div>
              <div className="rounded-md border border-border p-3">
                <dt className="text-2xs text-muted-foreground">{t('dev_imp_skipped')}</dt>
                <dd className="text-xl font-semibold tabular">{result.skipped}</dd>
              </div>
            </dl>

            {result.skipped > 0 && mode === 'INSERT' && (
              <p className="text-xs text-muted-foreground">{t('dev_imp_skipped_note')}</p>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('dev_imp_errors')}</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-2 text-2xs">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-muted-foreground">
                      {t('dev_imp_row')} {e.row}{e.unit ? ` (${e.unit})` : ''}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>{t('dev_imp_another')}</Button>
              <Button onClick={() => { onClose(); reset(); }}>{t('dev_done')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
