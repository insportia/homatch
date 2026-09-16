import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Upload, Download, Eye, EyeOff, Search, LayoutGrid, Rows3, ExternalLink, Plus, Box,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDebounce } from '@/hooks/use-debounce';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  UnitStatusPill, Money, formatArea, UNIT_STATUS_KEYS,
} from '@/components/developer/primitives';
import { VisualBuilding } from '@/components/developer/VisualBuilding';
import { UnitDrawer } from '@/components/developer/UnitDrawer';
import { ImportInventoryDialog } from '@/components/developer/ImportInventoryDialog';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  getProject, listBuildings, listUnits, setProjectPublished, setUnitsPublished,
  listPaymentPlans,
} from '@/services/developer/inventory';
import { exportInventoryXlsx } from '@/services/developer/exports';
import { devErrorText } from '@/services/developer/client';
import { BulkEditDialog } from '@/components/developer/BulkEditDialog';
import { ShareProjectPanel } from '@/components/developer/ShareProjectPanel';
import { ProjectTwinPanel } from '@/components/developer/ProjectTwinPanel';
import { ProjectHeader } from '@/components/developer/ProjectHeader';
import type {
  DevProject, DevBuilding, DevUnit, UnitStatus, DevPaymentPlan,
} from '@/services/developer/types';
import { CONSTRUCTION_KEYS } from './DeveloperProjectsPage';

/**
 * ONE PROJECT, TWO WAYS OF LOOKING AT IT.
 *
 * TABLE is the operational view: filter, sort, select, act in bulk, export.
 * It is what a sales director uses at a desk.
 *
 * VISUAL is the same inventory as a building. It is what a salesperson turns
 * towards a buyer, and what makes "floor 7, the corner one" a thing you point
 * at rather than a row you scroll to.
 *
 * ONE SOURCE (§44). They are two renderings of the same fetched rows, not two
 * data paths; switching between them cannot show two different answers.
 *
 * FILTERING IS SERVER-SIDE. A developer with four thousand apartments must
 * not be sent four thousand rows so the browser can hide most of them (§90) —
 * except in the visual view, which genuinely needs the whole building at once
 * and says so by asking for it explicitly.
 */

const PAGE_SIZE = 50;
const ALL_STATUSES: UnitStatus[] = [
  'AVAILABLE', 'ON_HOLD', 'NEGOTIATION', 'RESERVED', 'CONTRACT_PENDING', 'SOLD', 'HIDDEN',
];

type ViewMode = 'visual' | 'table' | 'twin' | 'share';

export default function DeveloperProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { workspace, can } = useDeveloperWorkspace();

  const [project, setProject] = useState<DevProject | null>(null);
  const [buildings, setBuildings] = useState<DevBuilding[]>([]);
  const [units, setUnits] = useState<DevUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>((params.get('view') as ViewMode) ?? 'visual');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<UnitStatus[]>([]);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ by: 'unit_number' | 'price' | 'area_total' | 'floor_level' | 'status'; asc: boolean }>(
    { by: 'unit_number', asc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [paymentPlans, setPaymentPlans] = useState<DevPaymentPlan[]>([]);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const debouncedSearch = useDebounce(search, 250);

  const loadShell = useCallback(async () => {
    if (!id) return;
    try {
      const [p, b] = await Promise.all([getProject(id), listBuildings(id)]);
      setProject(p);
      setBuildings(b);
      // Plans a bulk change can assign. Scoped to this project's own
      // workspace, and read after the project so the id is known.
      setPaymentPlans(await listPaymentPlans(p.workspace_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    }
  }, [id]);

  const loadUnits = useCallback(async () => {
    if (!workspace || !id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listUnits(workspace.id, {
        projectId: id,
        search: debouncedSearch || undefined,
        status: statusFilter.length > 0 ? statusFilter : undefined,
        orderBy: sort.by,
        ascending: sort.asc,
        // The visual view draws the building, so it needs the building.
        limit: view === 'table' ? PAGE_SIZE : 3000,
        offset: view === 'table' ? page * PAGE_SIZE : 0,
      });
      setUnits(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, id, debouncedSearch, statusFilter, sort, page, view]);

  useEffect(() => { void loadShell(); }, [loadShell]);
  useEffect(() => { void loadUnits(); }, [loadUnits]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [debouncedSearch, statusFilter, view]);

  const switchView = (next: ViewMode) => {
    setView(next);
    params.set('view', next);
    setParams(params, { replace: true });
  };

  const buildingNames = useMemo(
    () => new Map(buildings.map((b) => [b.id, b.name])), [buildings]);

  const toggleSort = (by: typeof sort.by) => {
    setSort((s) => (s.by === by ? { by, asc: !s.asc } : { by, asc: true }));
  };

  const allOnPageSelected = units.length > 0 && units.every((u) => selected.has(u.id));

  const bulkPublish = async (published: boolean) => {
    try {
      await setUnitsPublished([...selected], published);
      toast.success(published ? t('dev_bulk_published') : t('dev_bulk_unpublished'));
      setSelected(new Set());
      await loadUnits();
    } catch (e) {
      toast.error(devErrorText(e, t));
    }
  };

  const exportInventory = async () => {
    if (!workspace || !project) return;
    try {
      // Export what the filter describes, not just the page on screen — and
      // say so in the file (§81), which subtitles below does.
      const all = await listUnits(workspace.id, {
        projectId: project.id,
        search: debouncedSearch || undefined,
        status: statusFilter.length > 0 ? statusFilter : undefined,
        orderBy: sort.by, ascending: sort.asc, limit: 5000,
      });
      exportInventoryXlsx(all.rows, buildingNames, {
        workspaceName: workspace.name,
        projectName: project.name,
        filters: [
          statusFilter.length > 0
            ? `${t('dev_filter_status')}: ${statusFilter.map((s) => t(UNIT_STATUS_KEYS[s])).join(', ')}`
            : `${t('dev_filter_status')}: ${t('dev_filter_all')}`,
          debouncedSearch ? `${t('dev_search')}: ${debouncedSearch}` : '',
        ].filter(Boolean),
      });
    } catch (e) {
      toast.error(devErrorText(e, t));
    }
  };

  const publicUrl = project?.is_published && workspace?.slug && project.slug
    ? `/projects/${workspace.slug}/${project.slug}`
    : null;

  return (
    <DeveloperShell
      ownHeading={Boolean(project)}
      title={project?.name ?? t('dev_nav_projects')}
      description={project ? [
        [project.district, project.city].filter(Boolean).join(', '),
        t(CONSTRUCTION_KEYS[project.construction_status]),
      ].filter(Boolean).join(' · ') : undefined}
      actions={(
        <>
          {publicUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('dev_view_public')}
              </a>
            </Button>
          )}
          {can('publish') && project && (
            <Button
              variant="outline" size="sm"
              onClick={async () => {
                try {
                  const updated = await setProjectPublished(project.id, !project.is_published);
                  setProject(updated);
                  toast.success(updated.is_published ? t('dev_project_published') : t('dev_project_unpublished'));
                } catch (e) {
                  toast.error(devErrorText(e, t));
                }
              }}
            >
              {project.is_published
                ? <><EyeOff className="mr-2 h-4 w-4" />{t('dev_unpublish')}</>
                : <><Eye className="mr-2 h-4 w-4" />{t('dev_publish')}</>}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportInventory} disabled={total === 0}>
            <Download className="mr-2 h-4 w-4" />
            {t('dev_export')}
          </Button>
          {can('inventory') && (
            <Button size="sm" onClick={() => setImporting(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {t('dev_import_inventory')}
            </Button>
          )}
        </>
      )}
    >
      {/* WHICH BUILDING YOU ARE IN, BEFORE ANYTHING YOU CAN DO TO IT. */}
      {project && (
        <ProjectHeader
          project={project}
          units={view === 'table' ? units : units}
          currency={workspace?.default_currency}
          className="mb-6"
        />
      )}

      {/* THE PROJECT'S OWN NAVIGATION.
          Four places rather than a segmented control tucked into the corner
          of a toolbar: the building, the inventory behind it, the three
          dimensions of it, and the link a buyer gets. */}
      <div className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label={t('dev_view_mode')}>
        {([
          ['visual', t('dev_view_visual'), LayoutGrid],
          ['table', t('dev_view_table'), Rows3],
          ['twin', t('dev_view_twin'), Box],
          ['share', t('dev_view_share'), Share2],
        ] as Array<[ViewMode, string, typeof Rows3]>).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => switchView(key)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              view === key
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
            {view === key && (
              <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gold" />
            )}
          </button>
        ))}
      </div>

      {/* Inventory controls belong to the two inventory views, not to the
          walkthrough and not to the share link. */}
      {(view === 'table' || view === 'visual') && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('dev_search_units')}
              aria-label={t('dev_search_units')}
              className="pl-8"
            />
          </div>

          <Select
            value={statusFilter.length === 1 ? statusFilter[0] : 'ALL'}
            onValueChange={(v) => setStatusFilter(v === 'ALL' ? [] : [v as UnitStatus])}
          >
            <SelectTrigger className="w-auto min-w-[9rem]" aria-label={t('dev_filter_status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('dev_filter_all')}</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(UNIT_STATUS_KEYS[s])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {view === 'twin' && workspace && project && (
        <ProjectTwinPanel
          workspace={workspace}
          project={project}
          units={units}
          onSelectUnit={(unit) => setOpenUnitId(unit.id)}
        />
      )}


      {/* Sharing is about the project, not its inventory, so it does not
          wait on the unit query or show its empty states. */}
      {view === 'share' && workspace && project && (
        <ShareProjectPanel workspace={workspace} project={project} />
      )}

      {view !== 'share' && view !== 'twin' && loading && <LoadingRows rows={8} />}
      {view !== 'share' && view !== 'twin' && !loading && error && (
        <ErrorState message={error} onRetry={loadUnits} />
      )}

      {view !== 'share' && view !== 'twin' && !loading && !error && total === 0 && !debouncedSearch && statusFilter.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Upload className="h-7 w-7" />}
            title={t('dev_empty_units_title')}
            description={t('dev_empty_units_body')}
            action={can('inventory') ? (
              <Button onClick={() => setImporting(true)}>
                <Upload className="mr-2 h-4 w-4" />
                {t('dev_import_inventory')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {view !== 'share' && view !== 'twin' && !loading && !error && total === 0 && (debouncedSearch || statusFilter.length > 0) && (
        <Panel>
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title={t('dev_no_matching_units')}
            action={(
              <Button variant="outline" onClick={() => { setSearch(''); setStatusFilter([]); }}>
                {t('dev_clear_filters')}
              </Button>
            )}
          />
        </Panel>
      )}

      {!loading && !error && total > 0 && view === 'visual' && (
        <Panel className="p-4">
          <VisualBuilding
            units={units}
            buildings={buildings}
            onSelectUnit={(u) => setOpenUnitId(u.id)}
            selectedUnitId={openUnitId}
          />
        </Panel>
      )}

      {!loading && !error && total > 0 && view === 'table' && (
        <Panel>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
              <span className="text-xs font-medium">
                {t('dev_n_selected').replace('{n}', String(selected.size))}
              </span>
              {can('inventory') && (
                <Button size="sm" onClick={() => setBulkOpen(true)}>
                  {t('dev_bulk_edit')}
                </Button>
              )}
              {can('publish') && (
                <>
                  <Button size="sm" variant="outline" onClick={() => bulkPublish(true)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />{t('dev_publish')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => bulkPublish(false)}>
                    <EyeOff className="mr-1.5 h-3.5 w-3.5" />{t('dev_unpublish')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('dev_clear_selection')}
              </Button>
            </div>
          )}

          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  {can('publish') && (
                    <Th className="w-10">
                      <Checkbox
                        checked={allOnPageSelected}
                        aria-label={t('dev_select_all')}
                        onCheckedChange={(checked) => {
                          const next = new Set(selected);
                          for (const u of units) { checked ? next.add(u.id) : next.delete(u.id); }
                          setSelected(next);
                        }}
                      />
                    </Th>
                  )}
                  <SortableTh label={t('dev_unit')} active={sort.by === 'unit_number'} asc={sort.asc}
                    onClick={() => toggleSort('unit_number')} />
                  <Th>{t('dev_unit_building')}</Th>
                  <SortableTh label={t('dev_unit_floor')} active={sort.by === 'floor_level'} asc={sort.asc}
                    onClick={() => toggleSort('floor_level')} />
                  <Th>{t('dev_unit_bedrooms')}</Th>
                  <SortableTh label={t('dev_unit_area')} active={sort.by === 'area_total'} asc={sort.asc}
                    onClick={() => toggleSort('area_total')} />
                  <SortableTh label={t('dev_unit_price')} active={sort.by === 'price'} asc={sort.asc}
                    onClick={() => toggleSort('price')} className="text-right" />
                  <Th className="text-right">{t('dev_unit_price_sqm')}</Th>
                  <SortableTh label={t('dev_unit_status')} active={sort.by === 'status'} asc={sort.asc}
                    onClick={() => toggleSort('status')} />
                  <Th>{t('dev_published')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {units.map((unit) => (
                  <tr
                    key={unit.id}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => setOpenUnitId(unit.id)}
                  >
                    {can('publish') && (
                      <Td onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(unit.id)}
                          aria-label={`${t('dev_select')} ${unit.unit_number}`}
                          onCheckedChange={(checked) => {
                            const next = new Set(selected);
                            checked ? next.add(unit.id) : next.delete(unit.id);
                            setSelected(next);
                          }}
                        />
                      </Td>
                    )}
                    <Td className="font-medium">{unit.unit_number}</Td>
                    <Td className="text-muted-foreground">
                      {unit.building_id ? buildingNames.get(unit.building_id) ?? '—' : '—'}
                    </Td>
                    <Td className="tabular">{unit.floor_level ?? '—'}</Td>
                    <Td className="tabular">{unit.bedrooms ?? '—'}</Td>
                    <Td className="tabular">{formatArea(unit.area_total, language)}</Td>
                    <Td className="text-right font-medium">
                      <Money amount={unit.price} currency={unit.currency} />
                    </Td>
                    <Td className="text-right text-muted-foreground">
                      <Money amount={unit.price_per_sqm} currency={unit.currency} />
                    </Td>
                    <Td><UnitStatusPill status={unit.status} /></Td>
                    <Td>
                      {unit.is_published
                        ? <Eye className="h-4 w-4 text-emerald-600" aria-label={t('dev_published')} />
                        : <EyeOff className="h-4 w-4 text-muted-foreground" aria-label={t('dev_unpublished')} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <p className="text-xs text-muted-foreground tabular">
                {t('dev_showing')
                  .replace('{from}', String(page * PAGE_SIZE + 1))
                  .replace('{to}', String(Math.min((page + 1) * PAGE_SIZE, total)))
                  .replace('{total}', String(total))}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  {t('dev_previous')}
                </Button>
                <Button size="sm" variant="outline"
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}>
                  {t('dev_next')}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      <UnitDrawer
        unitId={openUnitId}
        onClose={() => setOpenUnitId(null)}
        onChanged={() => { void loadUnits(); }}
      />

      {bulkOpen && (
        <BulkEditDialog
          units={units.filter((u) => selected.has(u.id))}
          paymentPlans={paymentPlans}
          currency={project?.currency}
          onClose={() => setBulkOpen(false)}
          onDone={async () => {
            setBulkOpen(false);
            setSelected(new Set());
            await loadUnits();
          }}
        />
      )}

      {project && (
        <ImportInventoryDialog
          open={importing}
          projectId={project.id}
          projectName={project.name}
          onClose={() => setImporting(false)}
          onImported={() => { void loadUnits(); void loadShell(); }}
        />
      )}
    </DeveloperShell>
  );
}

function SortableTh({
  label, active, asc, onClick, className,
}: { label: string; active: boolean; asc: boolean; onClick: () => void; className?: string }) {
  return (
    <Th className={className} aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <span aria-hidden="true" className={cn('text-2xs', !active && 'opacity-0')}>
          {asc ? '▲' : '▼'}
        </span>
      </button>
    </Th>
  );
}
