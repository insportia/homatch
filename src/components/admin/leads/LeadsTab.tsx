// ADMIN — Leads Database → Leads: browse the catalog (100 per page), select, publish / hide,
// edit one lead, and export AUTHORISED records (verified rights) for a stated, audited reason.
import { Download, Eye, EyeOff, Pencil, X } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import {
  Confirm, Empty, ErrorNote, FilterBar, Pager, SelectFilter, TextFilter, When,
} from '@/components/admin/control/AdminKit';
import { ScrollTable } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  type AdminLead, type BatchSummary, type CanonicalRow, exportLeads, listBatches, listLeads, setPublished, updateLead,
} from '@/services/curatedLeadsAdmin';
import { EMPTY_FILTERS, type Interest, type MatchingFilters } from '@/services/matchingWorkspace';
import {
  downloadExport, errorText, interestLabel, LeadFieldsDialog, nf, Pill, ReasonDialog, StatusPill, toEditable,
} from './shared';

const PAGE = 100;
interface Draft { q: string; status: string; batch: string; countries: string; languages: string; interest: string }
const EMPTY: Draft = { q: '', status: '', batch: '', countries: '', languages: '', interest: '' };

const codes = (v: string, upper: boolean) =>
  v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => (upper ? x.toUpperCase() : x.toLowerCase()));

function toFilters(d: Draft): MatchingFilters {
  return {
    ...EMPTY_FILTERS,
    countries: codes(d.countries, true),
    languages: codes(d.languages, false),
    interests: d.interest ? [d.interest as Interest] : [],
  };
}

export function LeadsTab({ initialBatch }: { initialBatch: string }) {
  const { t, lang } = useLanguage();
  const [draft, setDraft] = React.useState<Draft>({ ...EMPTY, batch: initialBatch });
  const [applied, setApplied] = React.useState<Draft>({ ...EMPTY, batch: initialBatch });
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<AdminLead[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [batches, setBatches] = React.useState<BatchSummary[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulk, setBulk] = React.useState<'publish' | 'hide' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{ lead: AdminLead; initial: CanonicalRow; errors: string[] } | null>(null);

  React.useEffect(() => {
    listBatches(0, 200).then((r) => setBatches(r.items)).catch(() => setBatches([]));
  }, []);

  React.useEffect(() => {
    setDraft((d) => ({ ...d, batch: initialBatch }));
    setApplied((a) => ({ ...a, batch: initialBatch }));
    setPage(1);
  }, [initialBatch]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await listLeads({
        status: (applied.status || null) as AdminLead['status'] | null, batchId: applied.batch || null, q: applied.q.trim(),
        filters: toFilters(applied), page, pageSize: PAGE,
      });
      setItems(r.items ?? []); setTotal(Number(r.total ?? 0)); setError(null);
    } catch (e) {
      setItems([]); setError(errorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [applied, page, t]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { setSelected(new Set()); }, [applied, page]);

  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggleAll = (on: boolean) => setSelected(on ? new Set(items.map((l) => l.id)) : new Set());
  const toggle = (id: string, on: boolean) => setSelected((s) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });

  const runBulk = async () => {
    if (!bulk) return;
    setBusy(true);
    try {
      const r = await setPublished({ ids: [...selected] }, bulk === 'publish');
      toast.success(t(bulk === 'publish' ? 'admin_ldb_published_n' : 'admin_ldb_hidden_n', { n: nf(r.changed, lang) }));
      if ((r.blockedUnverified ?? 0) > 0) toast.warning(t('admin_ldb_blocked_unverified', { n: nf(r.blockedUnverified, lang) }));
      setBulk(null); setSelected(new Set());
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const runExport = async (reason: string) => {
    setBusy(true);
    try {
      const r = await exportLeads({ filters: toFilters(applied), status: applied.status || null, batchId: applied.batch || null }, reason);
      if (r.count === 0) toast.info(t('admin_ldb_export_empty'));
      else {
        downloadExport(r.rows, 'HOMATCH curated leads');
        toast.success(t('admin_ldb_export_done', { n: nf(r.count, lang) }));
        if (r.count >= 50000) toast.warning(t('admin_ldb_export_capped'));
      }
      setExportOpen(false);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (data: CanonicalRow) => {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await updateLead(editing.lead.id, data);
      if (!r.ok) {
        setEditing({ ...editing, initial: data, errors: r.errors ?? [] });
      } else {
        setEditing(null);
        toast.success(t('admin_ldb_lead_saved'));
        void load();
      }
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <FilterBar
        busy={loading}
        onApply={() => { setPage(1); setApplied(draft); }}
        onReset={() => { setDraft(EMPTY); setPage(1); setApplied(EMPTY); }}
        primary={<>
          <TextFilter label={t('admin_ldb_search')} value={draft.q} placeholder={t('admin_ldb_search_ph')} onChange={(v) => setDraft({ ...draft, q: v })} />
          <SelectFilter label={t('admin_ldb_col_status')} value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })}
                        options={[{ value: 'PUBLISHED', label: t('admin_ldb_status_PUBLISHED') }, { value: 'HIDDEN', label: t('admin_ldb_status_HIDDEN') }]} />
          <SelectFilter label={t('admin_ldb_col_batch')} value={draft.batch} onChange={(v) => setDraft({ ...draft, batch: v })}
                        options={batches.map((b) => ({ value: b.id, label: b.name }))} />
          <SelectFilter label={t('admin_ldb_f_interests')} value={draft.interest} onChange={(v) => setDraft({ ...draft, interest: v })}
                        options={['BUY', 'RENT', 'INVEST'].map((i) => ({ value: i, label: interestLabel(i, t) }))} />
        </>}
        more={<>
          <TextFilter label={t('admin_ldb_filter_countries')} value={draft.countries} placeholder={t('admin_ldb_filter_countries_ph')} onChange={(v) => setDraft({ ...draft, countries: v })} />
          <TextFilter label={t('admin_ldb_filter_languages')} value={draft.languages} placeholder={t('admin_ldb_filter_languages_ph')} onChange={(v) => setDraft({ ...draft, languages: v })} />
        </>}
      />
      {error && <ErrorNote message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('admin_ldb_leads_total', { n: nf(total, lang) })}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setExportOpen(true)} disabled={busy}>
          <Download className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_export')}
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-card p-2 shadow-sm">
          <span className="px-2 text-sm font-medium">{t('admin_ldb_selected', { n: selected.size })}</span>
          <Button type="button" size="sm" onClick={() => setBulk('publish')}><Eye className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_publish')}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setBulk('hide')}><EyeOff className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_hide_action')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_clear')}</Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && items.length === 0 ? <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            : items.length === 0 ? <Empty>{t('admin_ldb_no_leads')}</Empty> : (
              <ScrollTable minWidth={1040}>
                <table className={cn('w-full text-sm', loading && 'opacity-60')}>
                  <thead className="bg-muted/50 text-2xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2 text-start">
                        <Checkbox checked={allOnPage} onCheckedChange={(v) => toggleAll(v === true)} aria-label={t('admin_ldb_select_page')} />
                      </th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_person')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_status')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_country')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_languages')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_f_interests')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_batch')}</th>
                      <th className="px-3 py-2 text-end">{t('admin_ldb_col_unlocks')}</th>
                      <th className="px-3 py-2 text-start">{t('admin_ldb_col_created')}</th>
                      <th className="px-3 py-2 text-end"><span className="sr-only">{t('admin_ldb_col_actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l) => (
                      <tr key={l.id} className={cn('border-t border-border', selected.has(l.id) && 'bg-gold/[0.05]')}>
                        <td className="px-3 py-2">
                          <Checkbox checked={selected.has(l.id)} onCheckedChange={(v) => toggle(l.id, v === true)}
                                    aria-label={t('admin_ldb_select_one', { name: `${l.first_name} ${l.last_name}` })} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="block font-medium">{l.first_name} {l.last_name}</span>
                          <span dir="ltr" className="block text-2xs text-muted-foreground">{l.email}</span>
                        </td>
                        <td className="px-3 py-2"><StatusPill status={l.status} /></td>
                        <td className="px-3 py-2">{l.country}</td>
                        <td className="px-3 py-2">{l.languages.length ? l.languages.join(', ') : <span className="text-muted-foreground">{t('admin_ldb_unknown')}</span>}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">{l.interests.map((i) => <Pill key={i} tone="info">{interestLabel(i, t)}</Pill>)}</span>
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2 text-xs">{l.batchName ?? '—'}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{nf(l.unlocks, lang)}</td>
                        <td className="px-3 py-2 text-xs"><When at={l.created_at} /></td>
                        <td className="px-3 py-2 text-end">
                          <Button type="button" size="sm" variant="ghost" className="h-8"
                                  onClick={() => setEditing({ lead: l, initial: toEditable(l as unknown as Record<string, unknown>), errors: [] })}>
                            <Pencil className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_edit')}
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
      <Pager offset={(page - 1) * PAGE} limit={PAGE} total={total} count={items.length} onChange={(o) => setPage(Math.floor(o / PAGE) + 1)} />

      <Confirm
        open={bulk !== null}
        onOpenChange={(v) => { if (!v) setBulk(null); }}
        title={t(bulk === 'publish' ? 'admin_ldb_publish_confirm_title' : 'admin_ldb_hide_confirm_title', { n: selected.size })}
        description={t(bulk === 'publish' ? 'admin_ldb_publish_confirm_desc' : 'admin_ldb_hide_confirm_desc')}
        confirmLabel={t(bulk === 'publish' ? 'admin_ldb_publish' : 'admin_ldb_hide_action')}
        busy={busy}
        onConfirm={() => void runBulk()}
      />

      <ReasonDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={t('admin_ldb_export_title')}
        description={t('admin_ldb_export_desc')}
        confirmLabel={t('admin_ldb_export')}
        minLength={10}
        busy={busy}
        onConfirm={(r) => void runExport(r)}
      />

      <LeadFieldsDialog
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        title={editing ? t('admin_ldb_edit_title', { name: `${editing.lead.first_name} ${editing.lead.last_name}` }) : ''}
        description={t('admin_ldb_edit_desc')}
        initial={editing?.initial ?? NO_ROW}
        errors={editing?.errors ?? []}
        busy={busy}
        onSave={(d) => void saveEdit(d)}
      />
    </div>
  );
}

const NO_ROW: CanonicalRow = {};
