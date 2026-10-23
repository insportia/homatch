// ADMIN — Leads Database → Batches: every import with its provenance (legal basis, rights
// verification) and counts. Rights, legal basis, publish / hide all, archive — each confirmed.
// Withdrawing rights or archiving hides the batch's published leads (server-side).
import { Archive, Eye, EyeOff, FileSearch, List, MoreHorizontal, RefreshCw, Scale } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Confirm, Empty, ErrorNote, Field, inputClass, Pager, When } from '@/components/admin/control/AdminKit';
import { ScrollTable } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type BatchSummary, LEGAL_BASES, type LegalBasis, listBatches, saveBatch, setPublished } from '@/services/curatedLeadsAdmin';
import { basisLabel, errorText, Notice, nf, StatusPill, sourceLabel } from './shared';

const LIMIT = 50;
type Action =
  | { kind: 'rights'; batch: BatchSummary; next: boolean }
  | { kind: 'basis'; batch: BatchSummary; basis: LegalBasis }
  | { kind: 'publish' | 'hide' | 'archive'; batch: BatchSummary };

export function BatchesTab({ onOpenStaged, onOpenLeads }: { onOpenStaged: (id: string) => void; onOpenLeads: (id: string) => void }) {
  const { t, lang } = useLanguage();
  const [offset, setOffset] = React.useState(0);
  const [items, setItems] = React.useState<BatchSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<Action | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await listBatches(offset, LIMIT);
      setItems(r.items); setTotal(r.total); setError(null);
    } catch (e) {
      setItems([]); setError(errorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [offset, t]);

  React.useEffect(() => { void load(); }, [load]);

  const run = async () => {
    if (!action) return;
    setBusy(true);
    try {
      const b = action.batch;
      if (action.kind === 'rights') {
        await saveBatch({ id: b.id, rightsVerified: action.next });
        toast.success(t(action.next ? 'admin_ldb_rights_on_done' : 'admin_ldb_rights_off_done', { name: b.name }));
      } else if (action.kind === 'basis') {
        await saveBatch({ id: b.id, legalBasis: action.basis });
        toast.success(t('admin_ldb_basis_done', { name: b.name }));
      } else if (action.kind === 'archive') {
        await saveBatch({ id: b.id, status: 'ARCHIVED' });
        toast.success(t('admin_ldb_archive_done', { name: b.name }));
      } else {
        const r = await setPublished({ batchId: b.id }, action.kind === 'publish');
        toast.success(t(action.kind === 'publish' ? 'admin_ldb_published_n' : 'admin_ldb_hidden_n', { n: nf(r.changed, lang) }));
        if ((r.blockedUnverified ?? 0) > 0) toast.warning(t('admin_ldb_blocked_unverified', { n: nf(r.blockedUnverified, lang) }));
      }
      setAction(null);
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const confirmText = (): { title: string; desc: string; label: string; destructive?: boolean } => {
    if (!action) return { title: '', desc: '', label: '' };
    const name = action.batch.name;
    switch (action.kind) {
      case 'rights': return action.next
        ? { title: t('admin_ldb_rights_on_title', { name }), desc: t('admin_ldb_rights_on_desc'), label: t('admin_ldb_rights_on_btn') }
        : { title: t('admin_ldb_rights_off_title', { name }), desc: t('admin_ldb_rights_off_desc'), label: t('admin_ldb_rights_off_btn'), destructive: true };
      case 'basis': return { title: t('admin_ldb_basis_title', { name }), desc: t('admin_ldb_basis_desc'), label: t('admin_ldb_save') };
      case 'publish': return { title: t('admin_ldb_publish_all_title', { name }), desc: t('admin_ldb_publish_all_desc'), label: t('admin_ldb_publish_all') };
      case 'hide': return { title: t('admin_ldb_hide_all_title', { name }), desc: t('admin_ldb_hide_all_desc'), label: t('admin_ldb_hide_all') };
      case 'archive': return { title: t('admin_ldb_archive_title', { name }), desc: t('admin_ldb_archive_desc'), label: t('admin_ldb_archive'), destructive: true };
    }
  };
  const c = confirmText();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_ldb_batches_hint')}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_refresh')}
        </Button>
      </div>
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading && items.length === 0 ? <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            : items.length === 0 ? <Empty>{t('admin_ldb_no_batches')}</Empty> : (
              <ScrollTable minWidth={1100}>
                <table className={cn('w-full text-sm', loading && 'opacity-60')}>
                  <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_batch')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_status')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_b_legal_basis')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_rights')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_rows')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_published')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_created_by')}</th>
                      <th className="px-3 py-2 text-end"><span className="sr-only">{t('admin_ldb_col_actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((b) => {
                      const archived = b.status === 'ARCHIVED';
                      return (
                        <tr key={b.id} className="border-t border-border align-top">
                          <td className="max-w-[16rem] px-3 py-2">
                            <span className="block truncate font-medium">{b.name}</span>
                            <span className="block truncate text-2xs text-muted-foreground">
                              {[sourceLabel(b.source_class, t), b.file_name].filter(Boolean).join(' · ')}
                            </span>
                          </td>
                          <td className="px-3 py-2"><StatusPill status={b.status} /></td>
                          <td className="px-3 py-2 text-xs">{basisLabel(b.legal_basis, t)}</td>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <Switch checked={b.rights_verified} disabled={archived || busy}
                                      aria-label={t('admin_ldb_col_rights')}
                                      onCheckedChange={(v) => setAction({ kind: 'rights', batch: b, next: v })} />
                              <span className={cn('text-xs', b.rights_verified ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
                                {t(b.rights_verified ? 'admin_ldb_rights_verified' : 'admin_ldb_rights_unverified')}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs tabular-nums">
                            {t('admin_ldb_counts', { total: nf(b.total_rows, lang), valid: nf(b.valid_rows, lang), invalid: nf(b.invalid_rows, lang), duplicate: nf(b.duplicate_rows, lang), imported: nf(b.imported_rows, lang) })}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{nf(b.published ?? 0, lang)} / {nf(b.leads ?? 0, lang)}</td>
                          <td className="px-3 py-2 text-xs">
                            <span dir="ltr" className="block truncate">{b.createdByEmail ?? '—'}</span>
                            <span className="text-muted-foreground"><When at={b.created_at} /></span>
                          </td>
                          <td className="px-3 py-2 text-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="sm" variant="outline" className="h-8" aria-label={t('admin_ldb_col_actions')}>
                                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onOpenLeads(b.id)}><List className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_view_leads')}</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onOpenStaged(b.id)}><FileSearch className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_open_staged')}</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem disabled={archived} onSelect={() => setAction({ kind: 'basis', batch: b, basis: b.legal_basis })}>
                                  <Scale className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_edit_basis')}
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={archived || !b.rights_verified || !b.leads} onSelect={() => setAction({ kind: 'publish', batch: b })}>
                                  <Eye className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_publish_all')}
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={!b.published} onSelect={() => setAction({ kind: 'hide', batch: b })}>
                                  <EyeOff className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_hide_all')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem disabled={archived} className="text-destructive" onSelect={() => setAction({ kind: 'archive', batch: b })}>
                                  <Archive className="me-2 h-4 w-4" aria-hidden="true" />{t('admin_ldb_archive')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            )}
        </CardContent>
      </Card>
      <Pager offset={offset} limit={LIMIT} total={total} count={items.length} onChange={setOffset} />

      <Confirm open={action !== null} onOpenChange={(v) => { if (!v) setAction(null); }} title={c.title} description={c.desc}
               confirmLabel={c.label} destructive={c.destructive} busy={busy} onConfirm={() => void run()}>
        {action?.kind === 'basis' && (
          <div className="space-y-1">
            <Field label={t('admin_ldb_b_legal_basis')} htmlFor="ldb-basis-edit">
              <select id="ldb-basis-edit" className={inputClass} value={action.basis}
                      onChange={(e) => setAction({ ...action, basis: e.target.value as LegalBasis })}>
                {LEGAL_BASES.map((lb) => <option key={lb} value={lb}>{basisLabel(lb, t)}</option>)}
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">{t(`admin_ldb_lb_${action.basis}_desc`)}</p>
          </div>
        )}
        {action?.kind === 'rights' && !action.next && action.batch.published ? (
          <Notice tone="warn">{t('admin_ldb_rights_off_hides', { n: nf(action.batch.published, lang) })}</Notice>
        ) : null}
      </Confirm>
    </div>
  );
}
