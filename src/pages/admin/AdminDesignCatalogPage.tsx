/**
 * Admin → Design Studio catalogue.
 *
 * Every imported catalogue asset (models, materials, environments), filtered
 * and paged on the server, with checkbox selection, "select all matching",
 * and audited bulk actions. Availability is not storage: Disable only stops
 * new selection (saved designs keep their files); physical deletion is a
 * separate step (Request deletion → Delete files) that the database and the
 * server refuse for anything a saved design or public share still uses.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, RotateCcw, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  EMPTY_FILTERS, MAX_BULK, PAGE_SIZE, dependencies, filterOptions, idsMatching, listCatalog, purge, recentEvents,
  requeue, setLifecycle, thumbnailsFor,
  type AdminEvent, type CatalogFilters, type CatalogRow, type Dependency, type Lifecycle,
} from '@/services/designStudio/adminCatalog';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
type Action = 'DISABLE' | 'ENABLE' | 'REQUEST_DELETE' | 'CANCEL_DELETE' | 'PURGE' | 'REPROCESS';

const ANY = 'ANY';
const PURGE_MAX = 200;
const LIFECYCLES: Lifecycle[] = ['UNPUBLISHED', 'ACTIVE', 'DISABLED', 'PENDING_DELETE', 'DELETED'];
const LIFECYCLE_KEY: Record<Lifecycle, TKey> = {
  UNPUBLISHED: 'admin_dsc_life_unpublished', ACTIVE: 'admin_dsc_life_active', DISABLED: 'admin_dsc_life_disabled',
  PENDING_DELETE: 'admin_dsc_life_pending_delete', DELETED: 'admin_dsc_life_deleted',
};
const LIFECYCLE_TONE: Record<Lifecycle, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  UNPUBLISHED: 'outline', ACTIVE: 'default', DISABLED: 'secondary', PENDING_DELETE: 'destructive', DELETED: 'outline',
};
const KIND_KEY: Record<CatalogRow['kind'], TKey> = { MODEL: 'admin_dsc_kind_model', MATERIAL: 'admin_dsc_kind_material', ENVIRONMENT: 'admin_dsc_kind_environment' };
const ACTION_KEY: Record<Action, TKey> = {
  DISABLE: 'admin_dsc_act_disable', ENABLE: 'admin_dsc_act_enable', REQUEST_DELETE: 'admin_dsc_act_request_delete',
  CANCEL_DELETE: 'admin_dsc_act_cancel_delete', PURGE: 'admin_dsc_act_purge', REPROCESS: 'admin_dsc_act_reprocess',
};
const EVENT_KEY: Record<string, TKey> = {
  ACTIVATE: 'admin_dsc_ev_activate', DISABLE: 'admin_dsc_ev_disable', REQUEST_DELETE: 'admin_dsc_ev_request_delete',
  CANCEL_DELETE: 'admin_dsc_ev_cancel_delete', DELETED: 'admin_dsc_ev_deleted', DELETE_BLOCKED: 'admin_dsc_ev_delete_blocked',
  REPROCESS: 'admin_dsc_ev_reprocess',
};

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
/** A destructive action on many assets asks for the count to be typed, not clicked. */
export const needsTypedCount = (action: Action, n: number) => action === 'PURGE' || action === 'REQUEST_DELETE' || n >= 50;

export default function AdminDesignCatalogPage() {
  const { t } = useLanguage();
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [draftSearch, setDraftSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<{ batches: string[]; categories: string[]; subcategories: string[]; providers: string[] }>({ batches: [], categories: [], subcategories: [], providers: [] });
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<Map<string, Dependency>>(new Map());
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [pending, setPending] = useState<Action | null>(null);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listCatalog(filters, page);
      setRows(r.rows); setTotal(r.total);
      thumbnailsFor(r.rows.map((x) => x.homatchAssetId)).then(setThumbs).catch(() => setThumbs(new Map()));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { filterOptions().then(setOptions).catch(() => undefined); recentEvents().then(setEvents).catch(() => undefined); }, []);

  const set = (patch: Partial<CatalogFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); setSelected(new Set()); setUsage(new Map()); };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = rows.map((r) => r.homatchAssetId);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });

  const selectAllMatching = async () => {
    try {
      const r = await idsMatching(filters);
      setSelected(new Set(r.ids));
      if (r.total > MAX_BULK) toast.warning(t('admin_dsc_too_many', { max: String(MAX_BULK) }));
    } catch (e) { toast.error((e as Error).message); }
  };

  const checkUsage = async () => {
    try {
      const d = await dependencies([...selected].slice(0, MAX_BULK));
      setUsage(new Map(d.map((x) => [x.homatchAssetId, x])));
      const used = d.filter((x) => x.versions + x.published > 0).length;
      toast.info(t('admin_dsc_usage_summary', { used: String(used), total: String(d.length) }));
    } catch (e) { toast.error((e as Error).message); }
  };

  const ids = useMemo(() => [...selected], [selected]);
  const open = (a: Action) => {
    if (!ids.length) return;
    if (ids.length > (a === 'PURGE' ? PURGE_MAX : MAX_BULK)) { toast.warning(t('admin_dsc_too_many', { max: String(a === 'PURGE' ? PURGE_MAX : MAX_BULK) })); return; }
    setPending(a); setTyped(''); setReason('');
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending === 'PURGE') {
        const r = await purge(ids, ids.length);
        toast.success(t('admin_dsc_purged', { n: String(r.deleted), objects: String(r.objects), size: fmtBytes(r.bytes) }));
        if (r.blocked.length) toast.warning(t('admin_dsc_blocked', { n: String(r.blocked.length) }));
      } else if (pending === 'REPROCESS') {
        const r = await requeue(ids, ids.length, reason);
        toast.success(t('admin_dsc_requeued', { n: String(r.queued) }));
      } else {
        const target = pending === 'DISABLE' ? 'DISABLED' : pending === 'ENABLE' ? 'ACTIVE' : pending === 'REQUEST_DELETE' ? 'PENDING_DELETE' : 'CANCEL_DELETE';
        const r = await setLifecycle(ids, target, ids.length, reason);
        toast.success(t('admin_dsc_changed', { n: String(r.changed) }));
        if (r.blocked.length) {
          setUsage((u) => { const n = new Map(u); r.blocked.forEach((b) => n.set(b.homatch_asset_id, { homatchAssetId: b.homatch_asset_id, versions: b.versions, projects: b.projects, published: b.published })); return n; });
          toast.warning(t('admin_dsc_blocked', { n: String(r.blocked.length) }));
        }
        if (r.skipped.length) toast.info(t('admin_dsc_skipped', { n: String(r.skipped.length) }));
      }
      setPending(null); setSelected(new Set());
      await load(); recentEvents().then(setEvents).catch(() => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const typedOk = !pending || !needsTypedCount(pending, ids.length) || typed.trim() === String(ids.length);
  const pick = (label: TKey, value: string | null, values: string[], onChange: (v: string | null) => void, render?: (v: string) => string) => (
    <div className="space-y-1 min-w-0">
      <Label className="text-xs">{t(label)}</Label>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('admin_dsc_any')}</SelectItem>
          {values.map((v) => <SelectItem key={v} value={v}>{render ? render(v) : v}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <Boxes className="h-6 w-6 mt-1 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('admin_dsc_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin_dsc_subtitle')}</p>
        </div>
      </div>

      <Card><CardContent className="p-4 space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); set({ search: draftSearch }); }}>
          <Input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder={t('admin_dsc_search')} aria-label={t('admin_dsc_search')} />
          <Button type="submit" variant="secondary" aria-label={t('admin_dsc_search')}><Search className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" onClick={() => { setDraftSearch(''); set(EMPTY_FILTERS); }} aria-label={t('admin_dsc_reset')}><RotateCcw className="h-4 w-4" /></Button>
        </form>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {pick('admin_dsc_f_provider', filters.provider, options.providers, (v) => set({ provider: v }))}
          {pick('admin_dsc_f_kind', filters.kind, ['MODEL', 'MATERIAL', 'ENVIRONMENT'], (v) => set({ kind: v }), (v) => t(KIND_KEY[v as CatalogRow['kind']]))}
          {pick('admin_dsc_f_category', filters.category, options.categories, (v) => set({ category: v }))}
          {pick('admin_dsc_f_subtype', filters.subcategory, options.subcategories, (v) => set({ subcategory: v }))}
          {pick('admin_dsc_f_license', filters.license, ['CC0', 'ROYALTY_FREE', 'UNKNOWN'], (v) => set({ license: v }))}
          {pick('admin_dsc_f_tier', filters.tier, ['PREMIUM', 'STANDARD', 'FALLBACK', 'REJECT'], (v) => set({ tier: v }))}
          {pick('admin_dsc_f_batch', filters.batch, options.batches, (v) => set({ batch: v }))}
          {pick('admin_dsc_f_state', filters.state, ['DISCOVERED', 'QUEUED', 'READY', 'FAILED', 'EXCLUDED'], (v) => set({ state: v }))}
          {pick('admin_dsc_f_lifecycle', filters.lifecycle, LIFECYCLES, (v) => set({ lifecycle: v }), (v) => t(LIFECYCLE_KEY[v as Lifecycle]))}
          <div className="space-y-1"><Label className="text-xs" htmlFor="dsc-from">{t('admin_dsc_f_from')}</Label>
            <Input id="dsc-from" type="date" className="h-9" value={filters.importedFrom ?? ''} onChange={(e) => set({ importedFrom: e.target.value || null })} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor="dsc-to">{t('admin_dsc_f_to')}</Label>
            <Input id="dsc-to" type="date" className="h-9" value={filters.importedTo ?? ''} onChange={(e) => set({ importedTo: e.target.value || null })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">{t('admin_dsc_availability_note')}</p>
      </CardContent></Card>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('admin_dsc_bulk')}>
        <span className="text-sm font-medium">{t('admin_dsc_selected', { n: String(selected.size) })}</span>
        <Button size="sm" variant="outline" onClick={selectAllMatching} disabled={!total}>{t('admin_dsc_select_all_matching', { n: String(Math.min(total, MAX_BULK)) })}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setUsage(new Map()); }} disabled={!selected.size}>{t('admin_dsc_clear')}</Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button size="sm" variant="outline" onClick={checkUsage} disabled={!selected.size}>{t('admin_dsc_check_usage')}</Button>
        {(['DISABLE', 'ENABLE', 'REPROCESS', 'REQUEST_DELETE', 'CANCEL_DELETE', 'PURGE'] as Action[]).map((a) => (
          <Button key={a} size="sm" variant={a === 'PURGE' || a === 'REQUEST_DELETE' ? 'destructive' : a === 'DISABLE' ? 'secondary' : 'outline'}
            onClick={() => open(a)} disabled={!selected.size}>{t(ACTION_KEY[a])}</Button>
        ))}
      </div>

      <Card><CardContent className="p-0">
        {error ? <p className="p-4 text-sm text-destructive">{t('admin_dsc_error')}: {error}</p>
          : loading ? <p className="p-4 text-sm text-muted-foreground">{t('admin_dsc_loading')}</p>
          : !rows.length ? <p className="p-4 text-sm text-muted-foreground">{t('admin_dsc_empty')}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="p-2 w-8"><Checkbox checked={allOnPage} onCheckedChange={togglePage} aria-label={t('admin_dsc_select_page')} /></th>
                    <th className="p-2 text-start">{t('admin_dsc_col_asset')}</th>
                    <th className="p-2 text-start">{t('admin_dsc_col_type')}</th>
                    <th className="p-2 text-start">{t('admin_dsc_col_license')}</th>
                    <th className="p-2 text-start">{t('admin_dsc_col_batch')}</th>
                    <th className="p-2 text-start">{t('admin_dsc_col_status')}</th>
                    <th className="p-2 text-end">{t('admin_dsc_col_size')}</th>
                    <th className="p-2 text-start">{t('admin_dsc_col_usage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const u = usage.get(r.homatchAssetId);
                    const thumb = thumbs.get(r.homatchAssetId);
                    return (
                      <tr key={r.homatchAssetId} className="border-b last:border-0 align-top">
                        <td className="p-2"><Checkbox checked={selected.has(r.homatchAssetId)} onCheckedChange={() => toggle(r.homatchAssetId)} aria-label={r.name} /></td>
                        <td className="p-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-10 w-10 shrink-0 rounded bg-muted overflow-hidden">
                              {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate max-w-[16rem]">{r.name}</div>
                              <div className="text-xs text-muted-foreground truncate max-w-[16rem]">{r.provider} · {r.sourceAssetId}</div>
                              <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[16rem]">{r.homatchAssetId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2"><div>{t(KIND_KEY[r.kind])}</div><div className="text-xs text-muted-foreground">{r.subcategory.replace(/_/g, ' ').toLowerCase()}</div></td>
                        <td className="p-2"><div>{r.license}</div>{r.tier ? <div className="text-xs text-muted-foreground">{r.tier}</div> : null}</td>
                        <td className="p-2 text-xs font-mono">{r.batch ?? '—'}<div className="font-sans text-muted-foreground">{new Date(r.importedAt).toLocaleDateString()}</div></td>
                        <td className="p-2 space-y-1">
                          <Badge variant={LIFECYCLE_TONE[r.lifecycle]}>{t(LIFECYCLE_KEY[r.lifecycle])}</Badge>
                          <div className="text-xs text-muted-foreground">{r.state}</div>
                          {r.lastError ? <div className="text-xs text-destructive line-clamp-2 max-w-[14rem]" title={r.lastError}>{r.lastError}</div> : null}
                        </td>
                        <td className="p-2 text-end tabular-nums">{fmtBytes(r.storedBytes)}</td>
                        <td className="p-2 text-xs">
                          {u ? (u.versions + u.published > 0
                            ? <span className="text-amber-700 dark:text-amber-400">{t('admin_dsc_usage_line', { versions: String(u.versions), projects: String(u.projects), published: String(u.published) })}</span>
                            : <span className="text-muted-foreground">{t('admin_dsc_usage_none')}</span>) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <div className="flex items-center justify-between gap-2 p-3 border-t text-sm">
          <span className="text-muted-foreground">{t('admin_dsc_pager', { page: String(page + 1), pages: String(pages), total: String(total) })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t('admin_dsc_prev')}</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>{t('admin_dsc_next')}</Button>
          </div>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <h2 className="text-sm font-semibold mb-2">{t('admin_dsc_recent')}</h2>
        {!events.length ? <p className="text-sm text-muted-foreground">{t('admin_dsc_recent_empty')}</p> : (
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground tabular-nums">{new Date(e.at).toLocaleString()}</span>
                <span className="font-medium">{t(EVENT_KEY[e.action] ?? 'admin_dsc_ev_other')}</span>
                <span>{t('admin_dsc_ev_count', { n: String(e.assetCount) })}</span>
                {e.batches.length ? <span className="font-mono text-xs text-muted-foreground">{e.batches.slice(0, 3).join(', ')}</span> : null}
                {e.reason ? <span className="text-muted-foreground">— {e.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? t('admin_dsc_confirm_title', { action: t(ACTION_KEY[pending]), n: String(ids.length) }) : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending === 'PURGE' ? t('admin_dsc_confirm_purge') : pending === 'REQUEST_DELETE' ? t('admin_dsc_confirm_request_delete')
                : pending === 'DISABLE' ? t('admin_dsc_confirm_disable') : pending === 'REPROCESS' ? t('admin_dsc_confirm_reprocess') : t('admin_dsc_confirm_generic')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            {pending && needsTypedCount(pending, ids.length) ? (
              <div className="space-y-1">
                <Label htmlFor="dsc-typed">{t('admin_dsc_type_count', { n: String(ids.length) })}</Label>
                <Input id="dsc-typed" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </div>
            ) : null}
            {pending !== 'PURGE' ? (
              <div className="space-y-1">
                <Label htmlFor="dsc-reason">{t('admin_dsc_reason')}</Label>
                <Input id="dsc-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('admin_dsc_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !typedOk} onClick={(e) => { e.preventDefault(); run(); }}>
              {pending ? t(ACTION_KEY[pending]) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
