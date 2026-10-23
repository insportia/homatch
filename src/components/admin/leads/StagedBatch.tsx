// ADMIN — Leads Database → Import results for one batch: counts, problems by code (in words),
// the staged rows (filter + pages), a per-row Fix (re-validated in place, nothing restarts),
// and Commit (valid rows become HIDDEN leads; duplicates skipped or, on request, update).
import { CheckCircle2, Loader2, Plus, RefreshCw, Wrench } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Confirm, Empty, ErrorNote, inputClass, Pager, When } from '@/components/admin/control/AdminKit';
import { Kpi, KpiRow, ScrollTable } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  type BatchSummary, batchRows, type CanonicalRow, commitBatch, fixRow, type StagedRow, type StagedStatus,
} from '@/services/curatedLeadsAdmin';
import {
  basisLabel, errorText, LeadFieldsDialog, list, Notice, nf, Pill, problemSummaryText, problemText, StatusPill, toEditable,
} from './shared';

const LIMIT = 50;
const STATUSES: StagedStatus[] = ['VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED'];

export function StagedBatch({ batchId, onNewImport }: { batchId: string; onNewImport: () => void }) {
  const { t, lang } = useLanguage();
  const [status, setStatus] = React.useState<StagedStatus | ''>('');
  const [offset, setOffset] = React.useState(0);
  const [batch, setBatch] = React.useState<BatchSummary | null>(null);
  const [rows, setRows] = React.useState<StagedRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [summary, setSummary] = React.useState<Record<string, number>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [fixing, setFixing] = React.useState<{ row: StagedRow; initial: CanonicalRow; errors: string[]; warnings: string[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [updateDups, setUpdateDups] = React.useState(false);
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; updated: number } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await batchRows(batchId, { status: status || null, offset, limit: LIMIT });
      setBatch(d.batch); setRows(d.items ?? []); setTotal(Number(d.total ?? 0)); setSummary(d.errorSummary ?? {}); setError(null);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [batchId, status, offset, t]);

  React.useEffect(() => { void load(); }, [load]);

  const saveFix = async (data: CanonicalRow) => {
    if (!fixing) return;
    setBusy(true);
    try {
      const r = await fixRow(fixing.row.id, data);
      if (r.errors.length > 0) {
        setFixing({ ...fixing, initial: data, errors: r.errors, warnings: r.warnings });
        toast.warning(t('admin_ldb_fix_still_invalid'));
      } else {
        setFixing(null);
        toast.success(t(r.status === 'DUPLICATE' ? 'admin_ldb_fix_saved_dup' : 'admin_ldb_fix_saved', { row: r.rowNo }));
      }
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await commitBatch(batchId, updateDups);
      setResult(r);
      setCommitOpen(false);
      toast.success(t('admin_ldb_commit_result', { created: nf(r.created, lang), updated: nf(r.updated, lang) }));
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const staging = batch?.status === 'STAGING';
  const summaryEntries = Object.entries(summary).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {batch ? (
            <>
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{batch.name}<StatusPill status={batch.status} /></h2>
              <p className="text-xs text-muted-foreground">
                {[batch.file_name, basisLabel(batch.legal_basis, t)].filter(Boolean).join(' · ')} · <When at={batch.created_at} />
              </p>
            </>
          ) : <Skeleton className="h-6 w-48" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_refresh')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onNewImport}>
            <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_new_import')}
          </Button>
        </div>
      </div>
      {error && <ErrorNote message={error} />}

      <KpiRow cols={5}>
        <Kpi labelKey="admin_ldb_kpi_rows" loading={!batch} value={batch ? nf(batch.total_rows, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_valid" loading={!batch} value={batch ? nf(batch.valid_rows, lang) : null} accent />
        <Kpi labelKey="admin_ldb_kpi_invalid" loading={!batch} value={batch ? nf(batch.invalid_rows, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_duplicate" loading={!batch} value={batch ? nf(batch.duplicate_rows, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_imported" loading={!batch} value={batch ? nf(batch.imported_rows, lang) : null} />
      </KpiRow>

      {batch && !batch.rights_verified && <Notice tone="warn">{t('admin_ldb_rights_unverified_warn')}</Notice>}

      {summaryEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin_ldb_problems_title')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {summaryEntries.map(([code, n]) => (
                <li key={code} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">{problemSummaryText(code, t)}</span>
                  <Pill tone="bad">{nf(n, lang)}</Pill>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {staging && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_ldb_commit_title')}</CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin_ldb_commit_hint')}</p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Checkbox id="ldb-update-dups" checked={updateDups} onCheckedChange={(v) => setUpdateDups(v === true)} />
              <div>
                <label htmlFor="ldb-update-dups" className="text-sm font-medium">{t('admin_ldb_commit_update_dups')}</label>
                <p className="text-xs text-muted-foreground">{t('admin_ldb_commit_update_dups_hint')}</p>
              </div>
            </div>
            <Button type="button" disabled={busy || !batch || batch.valid_rows + (updateDups ? batch.duplicate_rows : 0) === 0}
                    onClick={() => setCommitOpen(true)}>
              {t('admin_ldb_commit')}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t('admin_ldb_commit_result', { created: nf(result.created, lang), updated: nf(result.updated, lang) })}</p>
            <p className="text-xs text-muted-foreground">{t('admin_ldb_commit_next')}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">{t('admin_ldb_rows_title')}</CardTitle>
          <select className={cn(inputClass, 'h-8 w-auto')} aria-label={t('admin_ldb_filter_status')} value={status}
                  onChange={(e) => { setOffset(0); setStatus(e.target.value as StagedStatus | ''); }}>
            <option value="">{t('admin_ldb_all_statuses')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`admin_ldb_status_${s}`)}</option>)}
          </select>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && rows.length === 0 ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            : rows.length === 0 ? <Empty>{t('admin_ldb_no_rows')}</Empty> : (
              <ScrollTable minWidth={920}>
                <table className={cn('w-full text-sm', loading && 'opacity-60')}>
                  <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_row')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_status')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_person')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_country')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_interests')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_languages')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_issues')}</th>
                      <th className="px-3 py-2 text-end"><span className="sr-only">{t('admin_ldb_col_actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.rowNo}</td>
                        <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                        <td className="px-3 py-2">
                          <span className="block font-medium">{[r.data.first_name, r.data.last_name].filter(Boolean).join(' ') || '—'}</span>
                          <span dir="ltr" className="block text-2xs text-muted-foreground">{r.data.email ?? ''}</span>
                        </td>
                        <td className="px-3 py-2">{r.data.country ?? '—'}</td>
                        <td className="px-3 py-2">{list(r.data.interests) || '—'}</td>
                        <td className="px-3 py-2">{list(r.data.languages) || <span className="text-muted-foreground">{t('admin_ldb_unknown')}</span>}</td>
                        <td className="max-w-[22rem] px-3 py-2 text-xs">
                          <ul className="space-y-0.5">
                            {r.errors.map((e) => <li key={e} className="text-destructive">{problemText(e, t)}</li>)}
                            {r.warnings.map((w) => <li key={w} className="text-muted-foreground">{problemText(w, t)}</li>)}
                            {r.status === 'DUPLICATE' && (
                              <li className="text-amber-700 dark:text-amber-300">
                                {r.duplicateRow ? t('admin_ldb_dup_in_file', { row: r.duplicateRow }) : t('admin_ldb_dup_in_catalog')}
                              </li>
                            )}
                          </ul>
                        </td>
                        <td className="px-3 py-2 text-end">
                          {staging && r.status !== 'IMPORTED' && (
                            <Button type="button" size="sm" variant="outline" className="h-8"
                                    onClick={() => setFixing({ row: r, initial: toEditable(r.data as Record<string, unknown>), errors: r.errors, warnings: r.warnings })}>
                              <Wrench className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_fix')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
          <Pager offset={offset} limit={LIMIT} total={total} count={rows.length} onChange={setOffset} />
        </CardContent>
      </Card>

      <LeadFieldsDialog
        open={fixing !== null}
        onOpenChange={(v) => { if (!v) setFixing(null); }}
        title={fixing ? t('admin_ldb_fix_title', { row: fixing.row.rowNo }) : ''}
        description={t('admin_ldb_fix_desc')}
        initial={fixing?.initial ?? EMPTY_ROW}
        errors={fixing?.errors ?? []}
        warnings={fixing?.warnings}
        busy={busy}
        onSave={(d) => void saveFix(d)}
      />

      <Confirm
        open={commitOpen}
        onOpenChange={setCommitOpen}
        title={t('admin_ldb_commit_confirm_title')}
        description={batch ? t(updateDups ? 'admin_ldb_commit_confirm_desc_update' : 'admin_ldb_commit_confirm_desc', {
          valid: nf(batch.valid_rows, lang), dups: nf(batch.duplicate_rows, lang), invalid: nf(batch.invalid_rows, lang),
        }) : undefined}
        confirmLabel={t('admin_ldb_commit')}
        busy={busy}
        onConfirm={() => void commit()}
      >
        {busy && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('admin_ldb_committing')}</p>}
      </Confirm>
    </div>
  );
}

const EMPTY_ROW: CanonicalRow = {};
