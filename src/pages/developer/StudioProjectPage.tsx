import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Box, ChevronLeft, Upload, ShieldAlert, Globe, Layers, Home,
  CheckCircle2, ExternalLink, HardDrive, Sparkles, FileImage,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  Panel, PanelHeader, LoadingRows, ErrorState, EmptyState,
  TableScroll, Th, Td, StatTile, formatNumber, formatArea,
} from '@/components/developer/primitives';
import {
  getStudioProject, upsertScene, saveSceneVersion, publishScene, unpublishScene,
  listSceneVersions, uploadStudioAsset, attachAsset, listProjectAssets,
  listTemplates, setUnitTypeTemplate, upsertExperience, loadStudioCosts,
  formatBytes,
  type StudioProject, type StudioUnitType, type StudioScene,
  type SceneVersion, type StudioCosts,
} from '@/services/developer/studio';
import { experienceUrl, embedUrl, embedSnippet, qrDataUrl } from '@/services/developer/twin';
import { devErrorText } from '@/services/developer/client';
import type { TwinAsset, TwinTemplate, TwinStatus } from '@/services/developer/twin';

/**
 * THE STUDIO WORKBENCH — one development, all of its geometry.
 *
 * THE ORDER OF THIS PAGE IS THE ORDER OF THE WORK.
 *
 *   1. UNIT TYPES. Geometry is authored per LAYOUT, not per apartment. A
 *      500-unit tower with 18 layouts is 18 interiors, and this table is
 *      where that is visible — each row says how many apartments it covers,
 *      so the reuse is a number on the screen rather than an intention.
 *   2. ASSETS, deduplicated by content hash before upload. Identical bytes
 *      are stored once and referenced many times.
 *   3. SCENES, versioned. Saving makes a new version; publishing points the
 *      scene at one. A published page never moves under a visitor's feet.
 *   4. THE EXPERIENCE — what the public sees, its white label, and its embed
 *      permissions.
 *   5. WHAT IT COSTS US, which is studio-only and stays that way.
 *
 * THE 2D→3D PIPELINE IS A WORKFLOW, NOT A PROMISE. A floor plan attaches to a
 * layout and the layout's scene moves DRAFT → REVIEW → PUBLISHED as a person
 * does the work. Nothing here claims that an arbitrary 2D drawing becomes
 * architecturally accurate 3D on its own, because it does not, and a button
 * that implied otherwise would be the most expensive lie in the product.
 */
export default function StudioProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { isStudio, loading: workspaceLoading } = useDeveloperWorkspace();
  useSurfaceTheme('light');

  const [data, setData] = useState<StudioProject | null>(null);
  const [templates, setTemplates] = useState<TwinTemplate[]>([]);
  const [assets, setAssets] = useState<TwinAsset[]>([]);
  const [costs, setCosts] = useState<StudioCosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !isStudio) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const project = await getStudioProject(projectId);
      setData(project);
      if (project) {
        const [tpl, ast, cost] = await Promise.all([
          listTemplates(),
          listProjectAssets(projectId, project.project.workspace_id),
          loadStudioCosts(projectId),
        ]);
        setTemplates(tpl);
        setAssets(ast);
        setCosts(cost);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [projectId, isStudio]);

  useEffect(() => { void load(); }, [load]);

  if (workspaceLoading) {
    return <div className="min-h-screen bg-background"><LoadingRows rows={6} className="mx-auto max-w-4xl pt-24" /></div>;
  }

  if (!isStudio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">{t('studio_internal_only')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('studio_internal_only_body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/studio')} aria-label={t('dev_back')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">
              {data?.project.name ?? t('studio_title')}
            </h1>
            <p className="truncate text-2xs text-muted-foreground">
              {[data?.project.workspace_name, data?.project.city].filter(Boolean).join(' · ')}
            </p>
          </div>
          {data && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a
                href={experienceUrl({
                  workspaceSlug: data.project.workspace_slug,
                  projectSlug: data.project.slug,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('studio_preview')}
              </a>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {loading && <LoadingRows rows={8} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && !data && (
          <Panel>
            <EmptyState
              icon={<Box className="h-7 w-7" />}
              title={t('studio_project_not_found')}
              description={t('studio_project_not_found_body')}
            />
          </Panel>
        )}

        {!loading && !error && data && (
          <>
            <Summary project={data} />
            <UnitTypes project={data} templates={templates} onChanged={load} />
            <Scenes project={data} assets={assets} onChanged={load} />
            <Assets project={data} assets={assets} onChanged={load} />
            <ExperiencePanel project={data} onChanged={load} />
            <Costs costs={costs} />
          </>
        )}
      </main>
    </div>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

function Summary({ project }: { project: StudioProject }) {
  const { t, lang: language } = useLanguage();
  const unitCount = project.units.length;
  const typeCount = project.unit_types.length;

  /*
   * The reuse multiplier, stated plainly. This is the whole economic argument
   * of the twin in one figure: how many apartments each authored interior
   * covers. When it is 1 somebody has not grouped the inventory yet.
   */
  const reuse = typeCount > 0 ? unitCount / typeCount : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label={t('studio_buildings')} value={formatNumber(project.buildings.length, language)} />
      <StatTile label={t('studio_units')} value={formatNumber(unitCount, language)} />
      <StatTile
        label={t('studio_unit_types')}
        value={formatNumber(typeCount, language)}
        tone={typeCount === 0 ? 'attention' : 'default'}
        hint={typeCount === 0 ? t('studio_no_types_hint') : undefined}
      />
      <StatTile
        label={t('studio_reuse')}
        value={typeCount > 0 ? `${formatNumber(reuse, language, 1)}×` : '—'}
        hint={t('studio_reuse_hint')}
        tone={reuse >= 5 ? 'good' : 'default'}
      />
    </div>
  );
}

// ── Unit types: where the work is actually scoped ───────────────────────────

function UnitTypes({
  project, templates, onChanged,
}: { project: StudioProject; templates: TwinTemplate[]; onChanged: () => Promise<void> }) {
  const { t, lang: language } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);

  const interiorTemplates = useMemo(
    () => templates.filter((x) => x.kind === 'INTERIOR'),
    [templates],
  );

  async function assign(type: StudioUnitType, templateId: string) {
    setBusy(type.id);
    try {
      await setUnitTypeTemplate(type.id, templateId === '__none' ? null : templateId);
      toast.success(t('studio_template_assigned'));
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function createTypeScene(type: StudioUnitType) {
    setBusy(type.id);
    try {
      await upsertScene({
        projectId: project.project.id,
        kind: 'UNIT_TYPE',
        name: type.name || type.code,
        unitTypeId: type.id,
      });
      toast.success(t('studio_scene_created'));
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title={t('studio_unit_types')}
        description={t('studio_unit_types_body')}
      />
      {project.unit_types.length === 0 ? (
        <EmptyState
          icon={<Home className="h-7 w-7" />}
          title={t('studio_no_types_title')}
          description={t('studio_no_types_body')}
        />
      ) : (
        <TableScroll>
          <table className="w-full text-sm" data-tabular>
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <Th>{t('studio_layout')}</Th>
                <Th className="text-right">{t('studio_covers')}</Th>
                <Th className="text-right">{t('dev_unit_area')}</Th>
                <Th>{t('studio_floor_plan')}</Th>
                <Th>{t('studio_template')}</Th>
                <Th>{t('studio_scene')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {project.unit_types.map((type) => (
                <tr key={type.id} className="hover:bg-muted/30">
                  <Td className="font-medium">
                    {type.code}
                    {type.name && (
                      <span className="ml-1.5 text-2xs text-muted-foreground">{type.name}</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <span className={cn('font-medium', type.units >= 10 && 'text-gold-ink')}>
                      {t('studio_n_apartments').replace('{n}', formatNumber(type.units, language))}
                    </span>
                  </Td>
                  <Td className="text-right text-muted-foreground">
                    {formatArea(type.area_total, language)}
                  </Td>
                  <Td>
                    {type.floor_plan_url ? (
                      <a
                        href={type.floor_plan_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-2xs text-gold-ink underline underline-offset-4"
                      >
                        <FileImage className="h-3 w-3" aria-hidden="true" />
                        {t('studio_view_plan')}
                      </a>
                    ) : (
                      <span className="text-2xs text-muted-foreground">{t('studio_no_plan')}</span>
                    )}
                  </Td>
                  <Td>
                    <Select
                      value={type.template_id ?? '__none'}
                      onValueChange={(v) => void assign(type, v)}
                      disabled={busy === type.id}
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder={t('studio_no_template')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('studio_no_template')}</SelectItem>
                        {interiorTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Td>
                  <Td>
                    {type.scene_id ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        {t('studio_has_scene')}
                      </span>
                    ) : (
                      <Button
                        type="button" variant="outline" size="sm"
                        disabled={busy === type.id}
                        onClick={() => void createTypeScene(type)}
                      >
                        {t('studio_create_scene')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

// ── Scenes ─────────────────────────────────────────────────────────────────

const SCENE_TONE: Record<TwinStatus, string> = {
  DRAFT: 'border-border text-muted-foreground bg-muted/60',
  REVIEW: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  PUBLISHED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  ARCHIVED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

function Scenes({
  project, assets, onChanged,
}: { project: StudioProject; assets: TwinAsset[]; onChanged: () => Promise<void> }) {
  const { t, lang: language } = useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const [versions, setVersions] = useState<SceneVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<'MASTERPLAN' | 'BUILDING'>('BUILDING');
  const [newBuilding, setNewBuilding] = useState(project.buildings[0]?.id ?? '');
  const [newName, setNewName] = useState('');

  const expand = async (scene: StudioScene) => {
    if (open === scene.id) { setOpen(null); return; }
    setOpen(scene.id);
    try {
      setVersions(await listSceneVersions(scene.id));
    } catch (e) {
      toast.error(devErrorText(e, t));
      setVersions([]);
    }
  };

  async function create() {
    setBusy(true);
    try {
      await upsertScene({
        projectId: project.project.id,
        kind: newKind,
        name: newName.trim() || (newKind === 'MASTERPLAN'
          ? project.project.name
          : project.buildings.find((b) => b.id === newBuilding)?.name || 'Building'),
        buildingId: newKind === 'BUILDING' ? newBuilding || null : null,
      });
      toast.success(t('studio_scene_created'));
      setCreating(false);
      setNewName('');
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title={t('studio_scenes')}
        description={t('studio_scenes_body')}
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
            {t(creating ? 'dev_cancel' : 'studio_new_scene')}
          </Button>
        }
      />

      {creating && (
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-4 sm:p-5">
          <div className="space-y-1.5">
            <Label htmlFor="scene-kind">{t('studio_scene_kind')}</Label>
            <Select value={newKind} onValueChange={(v) => setNewKind(v as 'MASTERPLAN' | 'BUILDING')}>
              <SelectTrigger id="scene-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MASTERPLAN">{t('studio_kind_masterplan')}</SelectItem>
                <SelectItem value="BUILDING">{t('studio_kind_building')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newKind === 'BUILDING' && (
            <div className="space-y-1.5">
              <Label htmlFor="scene-building">{t('studio_building')}</Label>
              <Select value={newBuilding} onValueChange={setNewBuilding}>
                <SelectTrigger id="scene-building"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {project.buildings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="scene-name">{t('studio_scene_name')}</Label>
            <Input id="scene-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={() => void create()} disabled={busy}>
              {busy ? t('dev_saving') : t('studio_create_scene')}
            </Button>
          </div>
        </div>
      )}

      {project.scenes.length === 0 && !creating ? (
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title={t('studio_no_scenes_title')}
          description={t('studio_no_scenes_body')}
        />
      ) : (
        <ul className="divide-y divide-border">
          {project.scenes.map((scene) => (
            <li key={scene.id}>
              <button
                type="button"
                onClick={() => void expand(scene)}
                aria-expanded={open === scene.id}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              >
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {t(`studio_kind_${scene.kind.toLowerCase()}`)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {scene.name || t('studio_unnamed_scene')}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t('studio_n_versions').replace('{n}', formatNumber(scene.versions, language))}
                </span>
                <span className={cn(
                  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                  SCENE_TONE[scene.status],
                )}>
                  {t(`studio_status_${scene.status.toLowerCase()}`)}
                </span>
              </button>

              {open === scene.id && (
                <SceneVersions
                  scene={scene}
                  versions={versions}
                  assets={assets}
                  onChanged={async () => {
                    setVersions(await listSceneVersions(scene.id));
                    await onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SceneVersions({
  scene, versions, assets, onChanged,
}: {
  scene: StudioScene;
  versions: SceneVersion[];
  assets: TwinAsset[];
  onChanged: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [notes, setNotes] = useState('');

  const geometry = useMemo(
    () => assets.filter((a) => a.kind === 'GEOMETRY' && a.is_deliverable),
    [assets],
  );

  /**
   * A new version made from one geometry asset.
   *
   * The budget stored alongside it is the asset's REAL byte count, not an
   * estimate — which is what makes the performance budget in
   * docs/digital-twin-budgets.md something the viewer can check rather than
   * something a document asserts.
   */
  async function save() {
    const asset = geometry.find((a) => a.id === assetId);
    if (!asset) return;
    setBusy(true);
    try {
      const versionId = await saveSceneVersion(scene.id, {
        graph: { root: asset.id, kind: scene.kind },
        budget: { bytes: Number(asset.bytes ?? 0) },
        notes: notes.trim() || null,
      });
      await attachAsset(asset.id, 'SCENE_VERSION', versionId);
      toast.success(t('studio_version_saved'));
      setNotes('');
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function publish(version: SceneVersion) {
    setBusy(true);
    try {
      await publishScene(scene.id, version.id);
      toast.success(t('studio_published'));
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    try {
      await unpublishScene(scene.id);
      toast.success(t('studio_unpublished'));
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`geo-${scene.id}`}>{t('studio_geometry')}</Label>
          <Select value={assetId} onValueChange={setAssetId}>
            <SelectTrigger id={`geo-${scene.id}`}>
              <SelectValue placeholder={t('studio_pick_geometry')} />
            </SelectTrigger>
            <SelectContent>
              {geometry.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {formatBytes(a.bytes, language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {geometry.length === 0 && (
            <p className="text-2xs text-muted-foreground">{t('studio_upload_geometry_first')}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`notes-${scene.id}`}>{t('studio_version_notes')}</Label>
          <Input
            id={`notes-${scene.id}`} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('studio_version_notes_placeholder')}
          />
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={() => void save()} disabled={busy || !assetId}>
            {t('studio_save_version')}
          </Button>
        </div>
      </div>

      {versions.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">{t('studio_no_versions')}</p>
      ) : (
        <TableScroll className="mt-4 rounded-md border border-border bg-card">
          <table className="w-full text-sm" data-tabular>
            <thead className="bg-muted/50">
              <tr>
                <Th>{t('studio_version')}</Th>
                <Th className="text-right">{t('studio_weight')}</Th>
                <Th>{t('studio_version_notes')}</Th>
                <Th>{t('dev_status')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {versions.map((v) => {
                const isLive = scene.published_version_id === v.id;
                return (
                  <tr key={v.id}>
                    <Td className="font-medium">v{formatNumber(v.version, language)}</Td>
                    <Td className="text-right text-muted-foreground">
                      {formatBytes(v.budget?.bytes ?? null, language)}
                    </Td>
                    <Td className="max-w-[16rem] truncate text-muted-foreground">
                      {v.notes ?? '—'}
                    </Td>
                    <Td>
                      {isLive ? (
                        <span className="inline-flex items-center gap-1 text-2xs font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          {t('studio_live')}
                        </span>
                      ) : (
                        <span className="text-2xs text-muted-foreground">
                          {t('studio_draft_version')}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        {!isLive && (
                          <Button
                            type="button" variant="outline" size="sm"
                            disabled={busy}
                            onClick={() => void publish(v)}
                          >
                            {t('studio_publish')}
                          </Button>
                        )}
                        {isLive && scene.status === 'PUBLISHED' && (
                          <Button
                            type="button" variant="ghost" size="sm"
                            disabled={busy}
                            onClick={() => void unpublish()}
                          >
                            {t('studio_unpublish')}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

// ── Assets ─────────────────────────────────────────────────────────────────

function Assets({
  project, assets, onChanged,
}: { project: StudioProject; assets: TwinAsset[]; onChanged: () => Promise<void> }) {
  const { t, lang: language } = useLanguage();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<TwinAsset['kind']>('GEOMETRY');
  const [shared, setShared] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let reused = 0;
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        const result = await uploadStudioAsset({
          file,
          kind,
          scope: shared ? 'GLOBAL' : 'PROJECT',
          workspaceId: project.project.workspace_id,
          projectId: shared ? null : project.project.id,
          // A .blend or a 300MB master is ours to keep and never something to
          // hand a phone; only deliverables reach the viewer.
          isDeliverable: kind !== 'SOURCE',
        });
        if (result.reused) reused += 1; else added += 1;
      }
      toast.success(
        t('studio_upload_done')
          .replace('{added}', formatNumber(added, language))
          .replace('{reused}', formatNumber(reused, language)),
      );
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const deliverable = assets.filter((a) => a.is_deliverable);
  const totalBytes = deliverable.reduce((n, a) => n + Number(a.bytes ?? 0), 0);

  return (
    <Panel>
      <PanelHeader
        title={t('studio_assets')}
        description={t('studio_assets_body')}
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4 sm:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="asset-kind">{t('studio_asset_kind')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as TwinAsset['kind'])}>
            <SelectTrigger id="asset-kind" className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['GEOMETRY', 'TEXTURE', 'PANORAMA', 'FLOOR_PLAN', 'MASTERPLAN', 'HDRI', 'IMAGE', 'SOURCE'] as const)
                .map((k) => (
                  <SelectItem key={k} value={k}>{t(`studio_asset_${k.toLowerCase()}`)}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 pb-2">
          <Switch id="asset-shared" checked={shared} onCheckedChange={setShared} />
          <Label htmlFor="asset-shared" className="text-sm font-normal">
            {t('studio_shared_library')}
          </Label>
        </div>

        <div className="ml-auto">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            id="asset-file"
            onChange={(e) => void upload(e.target.files)}
          />
          <Button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {uploading ? t('studio_uploading') : t('studio_upload')}
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-1.5 border-b border-border px-4 py-2.5 text-2xs text-muted-foreground sm:px-5">
        <Sparkles className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
        {t('studio_dedupe_note')}
      </p>

      {assets.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="h-7 w-7" />}
          title={t('studio_no_assets_title')}
          description={t('studio_no_assets_body')}
        />
      ) : (
        <>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('studio_asset')}</Th>
                  <Th>{t('studio_asset_kind')}</Th>
                  <Th>{t('studio_scope')}</Th>
                  <Th className="text-right">{t('studio_weight')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assets.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <Td className="max-w-[18rem] truncate font-medium">{a.name}</Td>
                    <Td className="text-muted-foreground">
                      {t(`studio_asset_${a.kind.toLowerCase()}`)}
                      {!a.is_deliverable && (
                        <span className="ml-1.5 text-2xs">({t('studio_internal_asset')})</span>
                      )}
                    </Td>
                    <Td>
                      <span className={cn(
                        'text-2xs',
                        a.scope === 'GLOBAL' ? 'text-gold-ink' : 'text-muted-foreground',
                      )}>
                        {t(a.scope === 'GLOBAL' ? 'studio_shared' : 'studio_project_scope')}
                      </span>
                    </Td>
                    <Td className="text-right text-muted-foreground">
                      {formatBytes(a.bytes, language)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <div className="border-t border-border px-4 py-2.5 text-2xs text-muted-foreground sm:px-5">
            {t('studio_deliverable_total')
              .replace('{n}', formatNumber(deliverable.length, language))
              .replace('{bytes}', formatBytes(totalBytes, language))}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── The published experience ───────────────────────────────────────────────

function ExperiencePanel({
  project, onChanged,
}: { project: StudioProject; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const experience = project.experience;

  const [slug, setSlug] = useState(experience?.slug ?? project.project.slug);
  const [status, setStatus] = useState<TwinStatus>(experience?.status ?? 'DRAFT');
  const [embedEnabled, setEmbedEnabled] = useState(experience?.embed_enabled ?? true);
  const [origins, setOrigins] = useState((experience?.embed_origins ?? []).join('\n'));
  const [attribution, setAttribution] = useState(experience?.show_homatch_attribution ?? true);
  const [domain, setDomain] = useState(experience?.custom_domain ?? '');
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const publicUrl = experienceUrl({
    workspaceSlug: project.project.workspace_slug,
    projectSlug: project.project.slug,
  });
  const iframeUrl = embedUrl({
    workspaceSlug: project.project.workspace_slug,
    projectSlug: project.project.slug,
  });

  async function save() {
    setSaving(true);
    try {
      await upsertExperience(project.project.id, {
        slug: slug.trim() || null,
        status,
        embedEnabled,
        embedOrigins: origins.split('\n').map((s) => s.trim()).filter(Boolean),
        showAttribution: attribution,
        customDomain: domain.trim() || null,
      });
      toast.success(t('studio_experience_saved'));
      await onChanged();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(embedSnippet(iframeUrl, project.project.name));
    toast.success(t('studio_snippet_copied'));
  }

  async function makeQr() {
    setQr(await qrDataUrl(publicUrl));
  }

  return (
    <Panel>
      <PanelHeader title={t('studio_experience')} description={t('studio_experience_body')} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-status">{t('dev_status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TwinStatus)}>
              <SelectTrigger id="exp-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'] as const).map((s) => (
                  <SelectItem key={s} value={s}>{t(`studio_status_${s.toLowerCase()}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status === 'PUBLISHED' && !project.project.is_published && (
              <p className="text-2xs text-amber-700 dark:text-amber-400">
                {t('studio_project_not_published_warning')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-slug">{t('studio_slug')}</Label>
            <Input id="exp-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="exp-embed" className="text-sm">{t('studio_embed_enabled')}</Label>
              <p className="mt-0.5 text-2xs text-muted-foreground">{t('studio_embed_body')}</p>
            </div>
            <Switch id="exp-embed" checked={embedEnabled} onCheckedChange={setEmbedEnabled} />
          </div>

          {embedEnabled && (
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="exp-origins">{t('studio_embed_origins')}</Label>
              <Textarea
                id="exp-origins" rows={3} value={origins}
                onChange={(e) => setOrigins(e.target.value)}
                placeholder="https://example.com"
                className="font-mono text-xs"
              />
              <p className="text-2xs text-muted-foreground">{t('studio_embed_origins_hint')}</p>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="exp-attribution" className="text-sm">
                {t('studio_attribution')}
              </Label>
              <p className="mt-0.5 text-2xs text-muted-foreground">{t('studio_attribution_body')}</p>
            </div>
            <Switch id="exp-attribution" checked={attribution} onCheckedChange={setAttribution} />
          </div>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="exp-domain">{t('studio_custom_domain')}</Label>
            <Input
              id="exp-domain" value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder="twin.developer.com"
            />
            {/* Honest about the boundary: the record is ours, the DNS is not. */}
            <p className="text-2xs text-muted-foreground">{t('studio_custom_domain_blocked')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void copySnippet()}>
            <Globe className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('studio_copy_embed')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void makeQr()}>
            {t('studio_make_qr')}
          </Button>
        </div>

        {qr && (
          <div className="flex items-center gap-4 rounded-md border border-border p-3">
            <img src={qr} alt={t('studio_qr_alt')} className="h-28 w-28" />
            <div className="min-w-0">
              <p className="text-xs font-medium">{t('studio_qr_title')}</p>
              <p className="mt-0.5 break-all text-2xs text-muted-foreground">{publicUrl}</p>
              <a
                href={qr}
                download={`${project.project.slug}-qr.png`}
                className="mt-1.5 inline-block text-2xs text-gold-ink underline underline-offset-4"
              >
                {t('studio_qr_download')}
              </a>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── What it costs us ───────────────────────────────────────────────────────

function Costs({ costs }: { costs: StudioCosts | null }) {
  const { t, lang: language } = useLanguage();
  if (!costs) return null;

  return (
    <Panel>
      <PanelHeader title={t('studio_costs')} description={t('studio_costs_body')} />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
        <StatTile
          label={t('studio_deliverable_bytes')}
          value={formatBytes(costs.live.deliverable_bytes, language)}
          hint={t('studio_deliverable_hint')}
        />
        <StatTile
          label={t('studio_source_bytes')}
          value={formatBytes(costs.live.source_bytes, language)}
          hint={t('studio_source_hint')}
        />
        <StatTile
          label={t('studio_asset_count')}
          value={formatNumber(costs.live.assets, language)}
        />
        <StatTile
          label={t('studio_shared_assets')}
          value={formatNumber(costs.live.shared_assets, language)}
          hint={t('studio_shared_hint')}
          tone={costs.live.shared_assets > 0 ? 'good' : 'default'}
        />
      </div>

      {costs.rollups.length > 0 && (
        <TableScroll className="border-t border-border">
          <table className="w-full text-sm" data-tabular>
            <thead className="bg-muted/40">
              <tr>
                <Th>{t('studio_period')}</Th>
                <Th className="text-right">{t('studio_opens')}</Th>
                <Th className="text-right">{t('studio_requests')}</Th>
                <Th className="text-right">{t('studio_bandwidth')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {costs.rollups.map((r) => (
                <tr key={`${r.project_id}-${r.period_start}`}>
                  <Td>{r.period_start}</Td>
                  <Td className="text-right">{formatNumber(r.viewer_opens, language)}</Td>
                  <Td className="text-right">{formatNumber(r.asset_requests, language)}</Td>
                  <Td className="text-right">{formatBytes(r.bandwidth_bytes, language)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
