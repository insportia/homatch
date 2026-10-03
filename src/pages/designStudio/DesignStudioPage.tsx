// HOMATCH DESIGN STUDIO — the launcher.
//
// One structural band that says what the product is and offers its two ways
// in, side by side and equal: PHOTOS of the space as it is, or the FLOOR PLAN.
// Both go into the same OpenAI-first flow (upload → analysis → style →
// quality → the design). The other ways in (your property, your 3D model)
// stay one quiet line below. Under it, the projects you already have, each
// with where it is (in progress, one detail needed, design ready, did not
// finish) read from the server — work continues there while you are away.
//
// Entry with context:
//   /design-studio?property=<uuid>  from Property Details — the picker opens
//                                   on that property; nobody searches again
//   /design-studio?unit=<uuid>      a published developer apartment — a
//                                   project is created on that unit's
//                                   published geometry (never a copy of it)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowRight, Box, FileImage, Home as HomeIcon, Loader2, MoreHorizontal, Pencil, Search, Trash2, X, ImagePlus } from 'lucide-react';
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  attachDeveloperUnit, createOriginalVersion, createProject, deleteProjectPermanently, DesignStudioError, getSource, listLauncherProperties,
  listProjects, renameProject, resumePendingDeletions, setActiveSource, setProjectStatus,
  type LauncherProperty, type ProjectListItem,
} from '@/services/designStudio/projects';
import { resolveSpatialSource } from '@/lib/designStudio/spatialSource';
import { signedUrls } from '@/services/designStudio/files';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import { cn } from '@/lib/utils';
import { projectStatuses, type ProjectStatus } from '@/services/designStudio/status';

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
  const [renaming, setRenaming] = useState<ProjectListItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectListItem | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ProjectStatus>>(new Map());

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

  // A deletion that was interrupted is finished quietly on the next visit.
  useEffect(() => { void resumePendingDeletions(userId); }, [userId]);

  // Where each project is, from the server (work continues there while the customer is away).
  useEffect(() => {
    const ids = (projects ?? []).map((p) => p.id);
    if (!ids.length) return;
    let stop = false;
    let working = false;
    const read = () => projectStatuses(ids).then((m) => { if (!stop) { working = [...m.values()].includes('WORKING'); setStatuses(m); } }).catch(() => {});
    void read();
    // Followed only while something is under way.
    const id = window.setInterval(() => { if (working) void read(); }, 15_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const workingProject = useMemo(() => (projects ?? []).find((p) => statuses.get(p.id) === 'WORKING') ?? null, [projects, statuses]);

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

  /* A project for a drawing or a model the customer has: its flow opens at once. */
  const startFrom = useCallback(async (kind: 'floorplan' | 'model' | 'photos') => {
    if (!userId) return;
    setBusy(true);
    setActionError(null);
    try {
      const project = await createProject({
        userId,
        name: t(kind === 'model' ? 'ds_default_project_model' : kind === 'photos' ? 'ds_default_project_image' : 'ds_default_project_floorplan'),
      });
      navigate(`/design-studio/${project.id}?start=${kind}`);
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
      {/* ── The structural band: what it is, and its two ways in ────── */}
      <section className="relative overflow-hidden bg-[#0C1119] text-white" data-testid="ds-landing">
        <div className="pointer-events-none absolute -end-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-[hsl(38_92%_56%)]/10 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[86rem] px-4 py-10 sm:px-6 md:py-16 lg:px-8">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_62%)]">{t('dsx_eyebrow')}</p>
          <h1 className="mt-3 max-w-[44rem] text-balance font-display text-[1.9rem] font-semibold leading-[1.12] tracking-tight sm:text-[2.75rem]">
            {t('dsx_landing_title')}
          </h1>
          <p className="mt-4 max-w-[40rem] text-[15px] leading-relaxed text-white/70 sm:text-[17px]">{t('dsx_landing_body')}</p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-5">
            <EntryCard icon={<ImagePlus className="h-6 w-6" aria-hidden="true" />} title={t('dsx_photos_title')} body={t('dsx_photos_body')} cta={t('dsx_photos_cta')}
              disabled={busy} onClick={() => { void startFrom('photos'); }} testId="ds-start-photos" art="PHOTOS" />
            <EntryCard icon={<FileImage className="h-6 w-6" aria-hidden="true" />} title={t('dsx_plan_title')} body={t('dsx_plan_body')} cta={t('dsx_plan_cta')}
              disabled={busy} onClick={() => { void startFrom('floorplan'); }} testId="ds-start-floorplan" art="PLAN" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="me-1 text-[13px] text-white/55">{t('dsx_more_ways')}</span>
            <button type="button" className={QUIET_BUTTON} onClick={() => setPickerOpen(true)} disabled={busy} data-testid="ds-start-property">
              <HomeIcon className="h-4 w-4" aria-hidden="true" />{t('ds_action_choose_property')}
            </button>
            <button type="button" className={QUIET_BUTTON} disabled={busy} onClick={() => { void startFrom('model'); }} aria-describedby="ds-formats">
              <Box className="h-4 w-4" aria-hidden="true" />{t('ds_action_upload_model')}
            </button>
          </div>
          <p id="ds-formats" className="mt-2 text-2xs text-white/45">{t('ds_mi_formats_note')}</p>

          {workingProject ? (
            <Link to={`/design-studio/${workingProject.id}`} className="mt-6 flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-[14px] ring-1 ring-white/10 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" data-testid="ds-working-banner">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[hsl(38_92%_62%)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t('dsx_bg_working')} · {workingProject.name}</span>
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          ) : null}

          {actionError ? (
            <p role="alert" className="mt-4 rounded-lg border border-[hsl(0_66%_60%)]/40 bg-[hsl(0_66%_44%)]/15 px-3 py-2 text-sm text-white">
              {actionError}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── The working surface: your design projects ───────────────── */}
      <section className="mx-auto w-full max-w-[86rem] px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-lg font-semibold text-foreground">{t('dsx_my_projects')}</h2>
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
                status={statuses.get(project.id) ?? null}
                locale={lang}
                onArchive={() => changeStatus(project.id, project.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}
                onRename={() => setRenaming(project)}
                onDelete={() => setDeleting(project)}
              />
            ))}
          </ul>
        )}
      </section>

      <RenameProjectDialog
        project={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => { setRenaming(null); void load(); }}
      />
      <DeleteProjectDialog
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => { setDeleting(null); void load(); }}
      />

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

const STATUS: Record<ProjectStatus, { key: string; cls: string }> = {
  WORKING: { key: 'dsx_status_working', cls: 'bg-[hsl(38_92%_56%)]/18 text-[hsl(36_70%_26%)]' },
  QUESTION: { key: 'dsx_status_question', cls: 'bg-[hsl(210_80%_50%)]/12 text-[hsl(210_70%_30%)]' },
  READY: { key: 'dsx_status_ready', cls: 'bg-[hsl(152_55%_38%)]/14 text-[hsl(152_60%_24%)]' },
  FAILED: { key: 'dsx_status_failed', cls: 'bg-[hsl(0_66%_44%)]/10 text-[hsl(0_66%_34%)]' },
};

/** One way in: a large, equal card (photos, or the floor plan). */
function EntryCard({ icon, title, body, cta, onClick, disabled, testId, art }: {
  icon: React.ReactNode; title: string; body: string; cta: string; onClick: () => void; disabled: boolean; testId: string; art: 'PHOTOS' | 'PLAN';
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}
      className="group relative flex flex-col overflow-hidden rounded-[26px] bg-white/[0.05] p-5 text-start ring-1 ring-white/10 transition-colors hover:bg-white/[0.08] hover:ring-[hsl(38_92%_56%)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-60 sm:p-7">
      <span className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[hsl(38_92%_56%)] text-[#161309]" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[20px] font-semibold sm:text-[24px]">{title}</span>
          <span className="mt-1.5 block text-[14px] leading-relaxed text-white/70 sm:text-[15px]">{body}</span>
        </span>
      </span>
      <span className="mt-5 hidden h-28 overflow-hidden rounded-2xl bg-[#121a26] ring-1 ring-white/5 sm:block" aria-hidden="true">
        {art === 'PHOTOS' ? (
          <span className="flex h-full items-center justify-center gap-2 px-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn('h-20 w-28 rounded-lg bg-gradient-to-br ring-1 ring-white/10', i === 0 ? '-rotate-6 from-[#3b4a5a] to-[#1d2733]' : i === 1 ? 'from-[#7a5a43] to-[#3d2b1f]' : 'rotate-6 from-[#b6bfa7]/70 to-[#2f4f3a]')} />
            ))}
          </span>
        ) : <RoomSketch className="h-full w-full p-3 text-white/60" />}
      </span>
      <span className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(38_92%_54%)] px-6 text-[15px] font-semibold text-[#161309] transition-colors group-hover:bg-[hsl(38_92%_60%)] sm:self-start">
        {cta}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </span>
    </button>
  );
}

function ProjectRow({
  project, thumbUrl, status, locale, onArchive, onRename, onDelete,
}: {
  project: ProjectListItem; thumbUrl: string | null; status: ProjectStatus | null; locale: string;
  onArchive: () => void; onRename: () => void; onDelete: () => void;
}) {
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
          {status ? (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-semibold', STATUS[status].cls)} data-testid="project-status" data-status={status}>
              {status === 'WORKING' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}{t(STATUS[status].key)}
            </span>
          ) : <SpaceStatus sources={project.sources} activeSourceId={project.active_source_id} />}
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
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            {project.status === 'ACTIVE'
              ? <><Archive className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_archive')}</>
              : <><ArchiveRestore className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_restore')}</>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />{t('ds_action_delete_permanent')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RenameProjectDialog({
  project, onClose, onRenamed,
}: { project: ProjectListItem | null; onClose: () => void; onRenamed: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(project?.name ?? ''); setError(null); setSaving(false); }, [project]);
  const trimmed = name.trim();

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || !trimmed || trimmed === project.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await renameProject(project.id, trimmed);
      onRenamed();
    } catch (err) {
      setError(t(errorKey(err)));
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ds_rename_title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('ds_rename_title')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <label className="block text-sm font-medium text-foreground" htmlFor="ds-rename-input">{t('ds_rename_label')}</label>
          <Input id="ds-rename-input" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} data-testid="ds-rename-input" />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="h-10 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-secondary" onClick={onClose} disabled={saving}>
              {t('ds_action_cancel')}
            </button>
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0C1119] px-4 text-sm font-semibold text-white disabled:opacity-50"
              disabled={saving || !trimmed || trimmed === project?.name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('ds_action_save')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Permanent deletion: the owner types the project's name, and the server does the rest. */
function DeleteProjectDialog({
  project, onClose, onDeleted,
}: { project: ProjectListItem | null; onClose: () => void; onDeleted: () => void }) {
  const { t } = useLanguage();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); setWorking(false); }, [project]);

  // One clear question and one red button: the customer is not asked to type the name. The server still checks
  // the name it is sent (the page sends the project's own), so nothing is deleted by a stray call.
  const remove = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || working) return;
    setWorking(true);
    setError(null);
    try {
      await deleteProjectPermanently(project.id, project.name.trim());
      onDeleted();
    } catch {
      setError(t('ds_delete_error'));
      setWorking(false);
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(open) => { if (!open && !working) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="ds-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t('ds_delete_title')}</DialogTitle>
          <DialogDescription>{t('ds_delete_body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={remove} className="space-y-4">
          {project ? <p className="text-sm font-semibold text-foreground" data-testid="ds-delete-name">{project.name}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="h-10 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-secondary" onClick={onClose} disabled={working}>
              {t('ds_action_cancel')}
            </button>
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
              disabled={!project || working} data-testid="ds-delete-submit">
              {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {t('ds_action_delete_permanent')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
