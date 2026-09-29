// HOMATCH DESIGN STUDIO — the launcher.
//
// Not a dashboard of cards. One structural band that says what the product
// is and offers the three ways in (your property, your 3D model, your floor
// plan), and one white working surface listing the design projects you
// already have. Choosing a way in creates a project and goes straight into
// the workspace; the launcher never asks for something HOMATCH already has.
//
// Entry with context:
//   /design-studio?property=<uuid>  from Property Details — the picker opens
//                                   on that property; nobody searches again
//   /design-studio?unit=<uuid>      a published developer apartment — a
//                                   project is created on that unit's
//                                   published geometry (never a copy of it)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowRight, Box, FileImage, Loader2, MoreHorizontal, Search, X } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { PRODUCT_SURFACE } from '@/components/customer/surface';
import { DesignStudioGate } from '@/components/designStudio/DesignStudioGate';
import { RoomSketch } from '@/components/designStudio/RoomSketch';
import { SpaceStatus } from '@/components/designStudio/SpaceStatus';
import { relativeTimeFrom } from '@/components/designStudio/format';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  attachDeveloperUnit, createOriginalVersion, createProject, DesignStudioError, getSource, listLauncherProperties,
  listProjects, renameProject, setActiveSource, setProjectStatus,
  type LauncherProperty, type ProjectListItem,
} from '@/services/designStudio/projects';
import { resolveSpatialSource } from '@/lib/designStudio/spatialSource';
import { signedUrls } from '@/services/designStudio/files';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import { cn } from '@/lib/utils';

const GOLD_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[hsl(38_92%_54%)] px-5 text-[15px] font-semibold text-[#161309] '
  + 'transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]/60 '
  + 'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C1119] disabled:opacity-60';

const QUIET_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-4 text-[15px] font-medium text-white/90 '
  + 'transition-colors hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 '
  + 'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/20';

function errorKey(error: unknown): string {
  const code = error instanceof DesignStudioError ? error.code : '';
  switch (code) {
    case 'DS_PROPERTY_NOT_OWNED': return 'ds_error_property_not_owned';
    case 'DS_UNIT_NOT_PUBLISHED':
    case 'DS_NO_PUBLISHED_SCENE': return 'ds_error_unit_unavailable';
    default: return 'ds_error_generic';
  }
}

export default function DesignStudioPage() {
  return (
    <RouteGuard>
      <DesignStudioGate>
        <AppLayout noPadding surfaceClass={PRODUCT_SURFACE}>
          <Launcher />
        </AppLayout>
      </DesignStudioGate>
    </RouteGuard>
  );
}

function Launcher() {
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  const userId = homatchUser?.id ?? '';

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadError(false);
    try {
      setProjects(await listProjects(userId, view));
    } catch {
      setLoadError(true);
      setProjects([]);
    }
  }, [userId, view]);

  useEffect(() => { void load(); }, [load]);

  // Version thumbnails live in R2; a short-lived URL is minted to show them.
  useEffect(() => {
    const keys = (projects ?? []).map((p) => p.thumbnail_key).filter((k): k is string => !!k);
    if (keys.length) signedUrls(keys).then(setThumbs).catch(() => {});
  }, [projects]);

  const preselectedProperty = params.get('property');
  useEffect(() => {
    if (preselectedProperty) setPickerOpen(true);
  }, [preselectedProperty]);

  /* A published developer apartment: project on its pinned geometry. */
  const unitParam = params.get('unit');
  useEffect(() => {
    if (!unitParam || !userId || busy) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setActionError(null);
      try {
        const project = await createProject({ userId, name: t('ds_default_project_unit') });
        const sourceId = await attachDeveloperUnit(project.id, unitParam);
        /* Name it after the apartment the developer published, not generically. */
        const source = await getSource(sourceId);
        const unit = source?.provenance?.unit_number;
        if (unit) {
          const building = source?.provenance?.building_name;
          await renameProject(project.id, building
            ? t('ds_default_project_unit_building', { building: String(building), unit: String(unit) })
            : t('ds_default_project_unit_number', { unit: String(unit) }));
        }
        await setActiveSource(project.id, sourceId);
        await createOriginalVersion({ userId, projectId: project.id, sourceId, name: t('ds_version_original') });
        if (!cancelled) navigate(`/design-studio/${project.id}`, { replace: true });
      } catch (error) {
        if (!cancelled) {
          setActionError(t(errorKey(error)));
          const next = new URLSearchParams(params);
          next.delete('unit');
          setParams(next, { replace: true });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitParam, userId]);

  const startForProperty = useCallback(async (property: LauncherProperty) => {
    if (!userId) return;
    setBusy(true);
    setActionError(null);
    try {
      const project = await createProject({
        userId,
        propertyId: property.id,
        name: property.title?.trim() || t('ds_default_project_property', { id: String(property.homatch_id ?? '') }),
      });
      navigate(`/design-studio/${project.id}`);
    } catch (error) {
      setActionError(t(errorKey(error)));
      setBusy(false);
    }
  }, [navigate, t, userId]);

  const changeStatus = useCallback(async (projectId: string, status: 'ACTIVE' | 'ARCHIVED') => {
    try {
      await setProjectStatus(projectId, status);
      await load();
    } catch (error) {
      setActionError(t(errorKey(error)));
    }
  }, [load, t]);

  const projectsByProperty = useMemo(() => {
    const map = new Map<string, ProjectListItem>();
    for (const p of projects ?? []) {
      if (p.property_id && !map.has(p.property_id)) map.set(p.property_id, p);
    }
    return map;
  }, [projects]);

  return (
    <div className="min-h-[calc(100dvh-4rem)]">
      {/* ── The structural band ─────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0C1119] text-white">
        <div className="mx-auto grid w-full max-w-[86rem] gap-8 px-4 py-10 sm:px-6 md:py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-8">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">
              {t('ds_brand')}
            </p>
            <h1 className="mt-3 max-w-[40rem] font-display text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-[2.25rem]">
              {t('ds_launcher_title')}
            </h1>
            <p className="mt-3 max-w-[38rem] text-[15px] leading-relaxed text-white/70 sm:text-base">
              {t('ds_launcher_subtitle')}
            </p>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <button type="button" className={GOLD_BUTTON} onClick={() => setPickerOpen(true)} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {t('ds_action_choose_property')}
                <ArrowRight className={cn('h-4 w-4', 'rtl:rotate-180')} aria-hidden="true" />
              </button>
              {/* Honest until the ingestion pipelines exist: visible, labelled, not clickable. */}
              <button type="button" className={QUIET_BUTTON} disabled aria-describedby="ds-soon">
                <Box className="h-4 w-4" aria-hidden="true" />
                {t('ds_action_upload_model')}
              </button>
              <button type="button" className={QUIET_BUTTON} disabled aria-describedby="ds-soon">
                <FileImage className="h-4 w-4" aria-hidden="true" />
                {t('ds_action_use_floorplan')}
              </button>
            </div>
            <p id="ds-soon" className="mt-2.5 text-[13px] text-white/55">{t('ds_ingest_not_yet')}</p>

            {actionError ? (
              <p role="alert" className="mt-4 rounded-lg border border-[hsl(0_66%_60%)]/40 bg-[hsl(0_66%_44%)]/15 px-3 py-2 text-sm text-white">
                {actionError}
              </p>
            ) : null}
          </div>
          <RoomSketch className="hidden h-auto w-full text-white/80 lg:block" />
        </div>
      </section>

      {/* ── The working surface: your design projects ───────────────── */}
      <section className="mx-auto w-full max-w-[86rem] px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-lg font-semibold text-foreground">{t('ds_projects_title')}</h2>
          <div role="tablist" aria-label={t('ds_projects_title')} className="flex gap-1">
            {(['ACTIVE', 'ARCHIVED'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  view === v ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {t(v === 'ACTIVE' ? 'ds_projects_active' : 'ds_projects_archived')}
              </button>
            ))}
          </div>
        </div>

        {projects === null ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('general_loading')}
          </div>
        ) : loadError ? (
          <p role="alert" className="py-10 text-sm text-destructive">{t('ds_error_load')}</p>
        ) : projects.length === 0 ? (
          <p className="py-10 text-[15px] text-muted-foreground">
            {t(view === 'ACTIVE' ? 'ds_projects_empty' : 'ds_projects_archived_empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                thumbUrl={project.thumbnail_key ? thumbs.get(project.thumbnail_key) ?? null : null}
                locale={lang}
                onArchive={() => changeStatus(project.id, project.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}
              />
            ))}
          </ul>
        )}
      </section>

      <PropertyPicker
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open && preselectedProperty) {
            const next = new URLSearchParams(params);
            next.delete('property');
            setParams(next, { replace: true });
          }
        }}
        userId={userId}
        preselectedId={preselectedProperty}
        existing={projectsByProperty}
        busy={busy}
        onStart={startForProperty}
        onOpen={(projectId) => navigate(`/design-studio/${projectId}`)}
      />
    </div>
  );
}

function ProjectRow({
  project, thumbUrl, locale, onArchive,
}: { project: ProjectListItem; thumbUrl: string | null; locale: string; onArchive: () => void }) {
  const { t } = useLanguage();
  /* The project is usually named after its property; repeating the title
     under itself would say the same thing twice. */
  const propertyTitle = project.property?.title?.trim();
  const propertyLine = project.property
    ? [propertyTitle && propertyTitle !== project.name.trim() ? propertyTitle : null,
      project.property.homatch_id ? t('ds_property_ref', { id: String(project.property.homatch_id) }) : null]
      .filter(Boolean).join(' · ')
    : null;
  const unitLine = !project.property && project.dev_unit_id ? t('ds_project_from_developer') : null;

  return (
    <li className="flex items-center gap-4 py-4">
      <Link
        to={`/design-studio/${project.id}`}
        className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-[#0C1119] text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-16 sm:w-24"
        aria-hidden="true"
        tabIndex={-1}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : project.property?.cover_photo_url ? (
          <img src={project.property.cover_photo_url} alt="" className="h-full w-full object-cover opacity-90" loading="lazy" />
        ) : (
          <RoomSketch className="h-full w-full p-1.5" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={`/design-studio/${project.id}`}
          className="line-clamp-2 break-words font-display text-[15px] font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base"
        >
          {project.name}
        </Link>
        {propertyLine || unitLine ? (
          <p className="line-clamp-2 break-words text-[13px] text-muted-foreground">{propertyLine || unitLine}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SpaceStatus sources={project.sources} activeSourceId={project.active_source_id} />
          {project.headVersion ? (
            <span className="text-[13px] text-muted-foreground">
              {t('ds_project_latest_version', { name: project.headVersion.name })}
            </span>
          ) : null}
          <span className="text-[13px] text-muted-foreground">{relativeTimeFrom(project.updated_at, locale)}</span>
        </div>
      </div>
      <Link
        to={`/design-studio/${project.id}`}
        className="hidden h-9 items-center rounded-lg bg-[#0C1119] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
      >
        {t('ds_action_open')}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('ds_project_actions', { name: project.name })}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild className="sm:hidden">
            <Link to={`/design-studio/${project.id}`}>{t('ds_action_open')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            {project.status === 'ACTIVE'
              ? <><Archive className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_archive')}</>
              : <><ArchiveRestore className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_restore')}</>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PropertyPicker({
  open, onOpenChange, userId, preselectedId, existing, busy, onStart, onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  preselectedId: string | null;
  existing: Map<string, ProjectListItem>;
  busy: boolean;
  onStart: (property: LauncherProperty) => void;
  onOpen: (projectId: string) => void;
}) {
  const { t } = useLanguage();
  const [properties, setProperties] = useState<LauncherProperty[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !userId || properties) return;
    listLauncherProperties(userId)
      .then(setProperties)
      .catch(() => { setFailed(true); setProperties([]); });
  }, [open, userId, properties]);

  const visible = useMemo(() => {
    const list = properties ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((p) => [p.title, p.city, p.district, p.homatch_id ? String(p.homatch_id) : null]
        .some((v) => v?.toLowerCase().includes(q)))
      : list;
    if (!preselectedId) return filtered;
    return [...filtered].sort((a, b) => (a.id === preselectedId ? -1 : b.id === preselectedId ? 1 : 0));
  }, [properties, query, preselectedId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="hm-product flex max-h-[min(44rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5 text-start">
          <DialogTitle className="font-display text-lg">{t('ds_picker_title')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('ds_picker_subtitle')}</DialogDescription>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ds_picker_search')}
              aria-label={t('ds_picker_search')}
              className="h-10 w-full rounded-lg border border-border bg-white ps-9 pe-9 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('ds_picker_clear')}
                className="absolute end-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {properties === null ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('general_loading')}
            </div>
          ) : failed ? (
            <p role="alert" className="px-5 py-8 text-sm text-destructive">{t('ds_error_load')}</p>
          ) : visible.length === 0 ? (
            <div className="px-5 py-8 text-[15px] text-muted-foreground">
              {properties.length === 0 ? (
                <>
                  <p>{t('ds_picker_no_properties')}</p>
                  <Link to="/property/add" className="mt-2 inline-block font-medium text-foreground underline underline-offset-4">
                    {t('ds_picker_add_property')}
                  </Link>
                </>
              ) : t('ds_picker_no_results')}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((property) => {
                const project = existing.get(property.id) ?? null;
                const hasSpace = project
                  ? !!resolveSpatialSource({
                    sources: project.sources,
                    preferredSourceId: project.active_source_id,
                    supportedGenerators: SUPPORTED_GENERATORS,
                  }).source
                  : false;
                const facts = [
                  [property.district, property.city].filter(Boolean).join(', ') || null,
                  property.area ? t('ds_area_m2', { value: String(property.area) }) : null,
                  property.homatch_id ? `#${property.homatch_id}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <li
                    key={property.id}
                    className={cn('flex items-center gap-3 px-5 py-3.5', property.id === preselectedId && 'bg-[hsl(41_88%_91%)]/50')}
                  >
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-secondary">
                      {property.cover_photo_url
                        ? <img src={property.cover_photo_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words text-[15px] font-semibold text-foreground">
                        {property.title || t('ds_property_untitled')}
                      </p>
                      {facts ? <p className="truncate text-[13px] text-muted-foreground">{facts}</p> : null}
                      <p className={cn('mt-0.5 text-[13px]', hasSpace ? 'font-medium text-[hsl(152_54%_28%)]' : 'text-muted-foreground')}>
                        {t(hasSpace ? 'ds_space_available' : 'ds_space_none')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row">
                      {project ? (
                        <button
                          type="button"
                          onClick={() => onOpen(project.id)}
                          className="h-9 rounded-lg bg-[#0C1119] px-3.5 text-sm font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t('ds_action_open_design')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onStart(property)}
                        className={cn(
                          'h-9 rounded-lg px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                          project
                            ? 'border border-border text-foreground hover:bg-secondary'
                            : 'bg-[#0C1119] text-white hover:bg-[#1a2230]',
                        )}
                      >
                        {t(project ? 'ds_action_new_design' : 'ds_action_start_design')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
