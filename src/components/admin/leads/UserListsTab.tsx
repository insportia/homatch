// ADMIN — Leads Database → User lists: oversight of customers' own uploaded contact lists.
// Metadata only; contents leave only through an export with a stated reason (audited). A private
// list never becomes catalog inventory.
import { Download, Lock } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Empty, ErrorNote, FilterBar, Pager, TextFilter, When } from '@/components/admin/control/AdminKit';
import { ScrollTable } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { exportUserList, listUserLists, type UserList } from '@/services/curatedLeadsAdmin';
import { downloadExport, errorText, nf, Pill, ReasonDialog } from './shared';

const LIMIT = 50;

export function UserListsTab() {
  const { t, lang } = useLanguage();
  const [draft, setDraft] = React.useState('');
  const [q, setQ] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [items, setItems] = React.useState<UserList[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<UserList | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listUserLists({ q, offset, limit: LIMIT })
      .then((r) => { if (live) { setItems(r.items ?? []); setTotal(Number(r.total ?? 0)); setError(null); } })
      .catch((e: unknown) => { if (live) { setItems([]); setError(errorText(e, t)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [q, offset, t]);

  const runExport = async (reason: string) => {
    if (!exporting) return;
    setBusy(true);
    try {
      const r = await exportUserList(exporting.id, reason);
      if (r.count === 0) toast.info(t('admin_ldb_export_empty'));
      else {
        downloadExport(r.rows, `HOMATCH list ${exporting.name}`);
        toast.success(t('admin_ldb_export_done', { n: nf(r.count, lang) }));
      }
      setExporting(null);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('admin_ldb_lists_notice')}</p>
      </div>
      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setQ(draft.trim()); }}
        onReset={() => { setDraft(''); setOffset(0); setQ(''); }}
        primary={<TextFilter label={t('admin_ldb_search')} value={draft} placeholder={t('admin_ldb_lists_search_ph')} onChange={setDraft} />}
      />
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading && items.length === 0 ? <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            : items.length === 0 ? <Empty>{t('admin_ldb_no_lists')}</Empty> : (
              <ScrollTable minWidth={980}>
                <table className={cn('w-full text-sm', loading && 'opacity-60')}>
                  <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_owner')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_list')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_source')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_file')}</th>
                      <th className="px-3 py-2 text-end">{t('admin_ldb_col_rows')}</th>
                      <th className="px-3 py-2 text-end">{t('admin_ldb_col_contacts')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_status')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_created')}</th>
                      <th className="px-3 py-2 text-end"><span className="sr-only">{t('admin_ldb_col_actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="max-w-[14rem] px-3 py-2">
                          <span className="block truncate font-medium">{l.ownerName || l.ownerEmail || '—'}</span>
                          {l.ownerName && l.ownerEmail && <span dir="ltr" className="block truncate text-2xs text-muted-foreground">{l.ownerEmail}</span>}
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-2">{l.name}</td>
                        <td className="px-3 py-2 text-xs">{[l.sourceKind, l.sourceFormat].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="max-w-[12rem] truncate px-3 py-2 text-xs">{l.sourceFilename ?? '—'}</td>
                        <td className="px-3 py-2 text-end text-xs tabular-nums">
                          {l.totalRows === null ? '—' : t('admin_ldb_rows_valid', { valid: nf(l.validRows ?? 0, lang), total: nf(l.totalRows, lang) })}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">{nf(l.contacts, lang)}</td>
                        <td className="px-3 py-2">{l.importStatus ? <Pill tone="muted">{l.importStatus}</Pill> : '—'}</td>
                        <td className="px-3 py-2 text-xs"><When at={l.createdAt} /></td>
                        <td className="px-3 py-2 text-end">
                          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setExporting(l)}>
                            <Download className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_export_short')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
        </CardContent>
      </Card>
      <Pager offset={offset} limit={LIMIT} total={total} count={items.length} onChange={setOffset} />

      <ReasonDialog
        open={exporting !== null}
        onOpenChange={(v) => { if (!v) setExporting(null); }}
        title={exporting ? t('admin_ldb_list_export_title', { name: exporting.name }) : ''}
        description={t('admin_ldb_list_export_desc')}
        confirmLabel={t('admin_ldb_export_short')}
        minLength={10}
        busy={busy}
        onConfirm={(r) => void runExport(r)}
      />
    </div>
  );
}
