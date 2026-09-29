// HOMATCH DESIGN STUDIO — THE WORKSPACE.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ toolbar: back · project · version · truth · undo/redo · save │
//   ├───────┬───────────────┬──────────────────────┬───────────────┤
//   │ modes │ library panel │     3D CANVAS        │   inspector   │
//   │ rail  │ (changes with │  plan navigator ↙    │ (what am I    │
//   │       │  the mode)    │                      │   editing?)   │
//   └───────┴───────────────┴──────────────────────┴───────────────┘
//
// The canvas is the product; everything else supports it. Below lg the
// panels leave the page and become sheets over a full-screen canvas.
//
// Every edit goes through useDesignSession → the one operation validator →
// deterministic application → undo stack → debounced, conflict-checked save.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, Armchair, ArrowLeft, Camera, Check, ChevronDown, CloudOff, Columns2, Download, Footprints, Info, Layers, LayoutGrid, Loader2, Maximize, Palette as PaletteIcon,
  PanelLeftClose, PanelLeftOpen, Redo2, Scan, Share2, Sparkles, SquareDashed, Sun, Undo2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial, Palette } from '@/lib/designStudio/catalog';
import type { DesignState, LockSet, ObjectInstance } from '@/lib/designStudio/designState';
import { planToOperations } from '@/lib/designStudio/aiPlan';
import { critique } from '@/lib/designStudio/grammar';
import { buildWalkModel } from '@/lib/designStudio/navigation';
import { entryShot, roomGraph, roomShot, tourOrder } from '@/lib/designStudio/cameraDirector';
import { requestDesign, type DesignBrief } from '@/services/designStudio/ai';
import type { Operation, OperationContext, Rejection } from '@/lib/designStudio/operations';
import {
  alignToNeighbours, autoPlace, blocks, evaluatePlacement, quantise, roomOf, snapToWall, type PlacementIssue,
} from '@/lib/designStudio/placement';
import {
  buildSpaceModel, ceilingSurfaceId, floorSurfaceId, roomContaining, surfacesOfRoom, type SpaceModel,
} from '@/lib/designStudio/space';
import { provenanceLabel, type Rejection as SourceRejection } from '@/lib/designStudio/spatialSource';
import type { CanonicalSpace, DesignVersionRecord, SpatialSourceRecord } from '@/lib/designStudio/types';
import { NavGlyphIcon } from '@/components/layouts/NavGlyph';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { assetsByCode, listAssets, listMaterials, listPalettes } from '@/services/designStudio/catalog';
import {
  createSavedView, createVersion, deleteSavedView, DesignStudioError, getVersion, listSavedViews, renameVersion, setHeadVersion,
  setVersionArchived, type ProjectBundle, type SavedView,
} from '@/services/designStudio/projects';
import { saveVersionThumbnail, signedUrls } from '@/services/designStudio/files';
import { copyState, uniqueVersionName } from '@/lib/designStudio/versioning';
import { normalizeDesignState } from '@/lib/designStudio/designState';
import { cn } from '@/lib/utils';
import { DesignCanvas } from '../canvas/DesignCanvas';
import type { CameraSnapshot, PickTarget, SceneController } from '../canvas/SceneController';
import { CompareView } from './CompareView';
import { VersionsTray } from './VersionsTray';
import { developerUnitModelUrl, loadGltf, loadGltfWithNodes } from '../canvas/modelLoader';
import { isModelAnalysis, modelParts, partRoles, type ModelPart } from '@/lib/designStudio/modelParts';
import { FurniturePanel } from './FurniturePanel';
import { AiDesignPanel, type AiProposalItem } from './AiDesignPanel';
import { WalkthroughOverlay } from './WalkthroughOverlay';
import { ShareDialog } from './ShareDialog';
import { DownloadDialog } from './DownloadDialog';
import { download } from './exportRender';
import { fileSlug } from '@/lib/designStudio/exportFiles';

import { Inspector } from './Inspector';
import { ObjectControls, PartControls, SurfaceControls } from './EditControls';
import { PlanNavigator } from './PlanNavigator';
import { RoomsPanel } from './RoomsPanel';
import { LightingPanel, MaterialList, Swatch } from './SurfacePanels';
import { roomNames } from './labels';
import { useDesignSession, type SaveStatus } from './useDesignSession';

export interface DesignWorkspaceProps {
  bundle: ProjectBundle;
  source: SpatialSourceRecord;
  rejected: SourceRejection[];
  freshnessUnchecked: boolean;
  initialVersionId: string | null;
  onReload: () => Promise<void> | void;
  /** Floor-plan spaces: change the measurements the geometry was built from. */
  onRecalibrate?: () => void;
  /** Open straight into the walkthrough (the /walkthrough route). */
  startWalkthrough?: boolean;
  onWalkthroughExit?: () => void;
}

/** The camera, remembered per project across version switches, so A and B are seen from the same place. */
const cameraMemory = new Map<string, CameraSnapshot>();

type LeftMode = 'ROOMS' | 'FURNITURE' | 'MATERIALS' | 'COLORS' | 'LIGHTING' | 'AI';

const MODES: Array<{ id: LeftMode; labelKey: string; icon: React.ComponentType<{ className?: string }>; needsSpace?: boolean }> = [
  { id: 'ROOMS', labelKey: 'ds_panel_rooms', icon: LayoutGrid },
  { id: 'FURNITURE', labelKey: 'ds_panel_furniture', icon: Armchair, needsSpace: true },
  { id: 'MATERIALS', labelKey: 'ds_panel_materials', icon: Layers, needsSpace: true },
  { id: 'COLORS', labelKey: 'ds_panel_colors', icon: PaletteIcon },
  { id: 'LIGHTING', labelKey: 'ds_panel_lighting', icon: Sun },
  { id: 'AI', labelKey: 'ds_panel_ai', icon: Sparkles, needsSpace: true },
];

const AI_ERROR_KEY: Record<string, string> = {
  DS_AI_DESIGN_UNAVAILABLE: 'ds_ai_error_unavailable',
  DS_AI_RATE_LIMITED: 'ds_ai_error_rate',
  DS_AI_BILLING_CONFIRMATION_REQUIRED: 'ds_ai_error_billing',
  DS_AI_NO_SPACE_MODEL: 'ds_ai_error_space',
  DS_AI_DESIGN_EMPTY: 'ds_ai_error_empty',
};

const TOOL_BUTTON =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[14px] font-medium text-white/85 transition-colors '
  + 'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] '
  + 'disabled:pointer-events-none disabled:opacity-40';

/** Below lg the panels are sheets; above it they are columns and a sheet must never open. */
const isPhoneLayout = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px)').matches;

const REJECTION_KEY: Record<string, string> = {
  PLACEMENT_BLOCKED: 'ds_reject_op_placement',
  OBJECT_LOCKED: 'ds_reject_op_kept',
  CATEGORY_LOCKED: 'ds_reject_op_category_locked',
  UNKNOWN_ASSET: 'ds_reject_op_asset',
  INACTIVE_ASSET: 'ds_reject_op_asset',
  MATERIAL_NOT_FOR_SURFACE: 'ds_reject_op_material',
  TOO_MANY_OBJECTS: 'ds_reject_op_too_many',
  NOT_ALLOWED_FOR_ASSET: 'ds_reject_op_not_allowed',
};

/** Loads the version's design state and the catalogue, then hands over to the editor. */
export function DesignWorkspace(props: DesignWorkspaceProps) {
  const { t } = useLanguage();
  const versions = props.bundle.versions.filter((v) => v.source_id === props.source.id);
  const summary = versions.find((v) => v.id === props.initialVersionId) ?? versions[versions.length - 1] ?? null;
  const [version, setVersion] = useState<DesignVersionRecord | null>(null);
  const [catalog, setCatalog] = useState<{ assets: CatalogAsset[]; materials: CatalogMaterial[]; palettes: Palette[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const summaryId = summary?.id ?? null;

  useEffect(() => {
    if (!summaryId) return;
    let cancelled = false;
    (async () => {
      try {
        const full = await getVersion(summaryId);
        if (!full) throw new Error('missing');
        const objects = (full.state as { objects?: Array<{ assetId: string }> }).objects;
        const codes = Array.isArray(objects) ? objects.map((o) => o.assetId) : [];
        const [browse, referenced, materials, palettes] = await Promise.all([
          listAssets({ limit: 500 }), assetsByCode(codes), listMaterials(), listPalettes(),
        ]);
        const byCode = new Map<string, CatalogAsset>();
        for (const a of [...browse, ...referenced]) byCode.set(a.code, a);
        if (!cancelled) {
          setVersion(full);
          setCatalog({ assets: [...byCode.values()], materials, palettes });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [summaryId]);

  if (failed || !summary) {
    return <div role="alert" className="grid h-[100dvh] place-items-center bg-[#0C1119] px-6 text-center text-white/85">{t('ds_error_load')}</div>;
  }
  if (!version || !catalog) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-[#0C1119] text-white">
        <span className="inline-flex items-center gap-2 text-[15px]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('ds_loading_materials')}</span>
      </div>
    );
  }
  return <Editor key={version.id} {...props} version={version} catalog={catalog} />;
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const { t } = useLanguage();
  const map: Record<SaveStatus, { key: string; icon: React.ReactNode; tone: string }> = {
    SAVED: { key: 'ds_save_saved', icon: <Check className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-white/60' },
    UNSAVED: { key: 'ds_save_unsaved', icon: <span className="h-1.5 w-1.5 rounded-full bg-[hsl(38_92%_62%)]" aria-hidden="true" />, tone: 'text-white/75' },
    SAVING: { key: 'ds_save_saving', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />, tone: 'text-white/75' },
    OFFLINE: { key: 'ds_save_offline', icon: <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-[hsl(38_92%_70%)]' },
    FAILED: { key: 'ds_save_failed', icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-[hsl(0_80%_75%)]' },
    CONFLICT: { key: 'ds_save_conflict', icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />, tone: 'text-[hsl(0_80%_75%)]' },
  };
  const s = map[status];
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 whitespace-nowrap px-1 text-[13px]', s.tone)}>
      {s.icon}
      <span className="hidden sm:inline">{t(s.key)}</span>
      {status === 'FAILED' || status === 'OFFLINE' ? (
        <button type="button" onClick={onRetry} className="ms-1 underline underline-offset-2 hover:text-white">{t('ds_action_retry')}</button>
      ) : null}
    </span>
  );
}

function Editor({
  bundle, source, version, catalog, onReload, onRecalibrate, startWalkthrough, onWalkthroughExit,
}: DesignWorkspaceProps & {
  version: DesignVersionRecord;
  catalog: { assets: CatalogAsset[]; materials: CatalogMaterial[]; palettes: Palette[] };
}) {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const controllerRef = useRef<SceneController | null>(null);

  const space: SpaceModel | null = useMemo(() => {
    const canonical = source.canonical as CanonicalSpace | null;
    return canonical?.scene ? buildSpaceModel(canonical.scene) : null;
  }, [source]);
  const names = useMemo(() => (space ? roomNames(space, t) : new Map<string, string>()), [space, t]);
  // Pieces an AI proposal names that the first catalogue page did not include.
  const [extraAssets, setExtraAssets] = useState<CatalogAsset[]>([]);
  const assets = useMemo(() => new Map([...catalog.assets, ...extraAssets].map((a) => [a.code, a])), [catalog.assets, extraAssets]);
  const materials = useMemo(() => new Map(catalog.materials.map((m) => [m.id, m])), [catalog.materials]);
  // An uploaded model: the server's analysis, and the parts it identified.
  const modelAnalysis = useMemo(
    () => (source.kind === 'UPLOADED_MODEL' && isModelAnalysis(source.canonical) ? source.canonical : null), [source]);
  const parts = useMemo(() => modelParts(modelAnalysis), [modelAnalysis]);
  const ctx: OperationContext = useMemo(() => ({ space, assets, materials, parts: partRoles(parts) }), [space, assets, materials, parts]);
  const estimated = source.geometry_state === 'ESTIMATED';

  const session = useDesignSession({
    versionId: version.id,
    userId: homatchUser?.id ?? version.user_id,
    initialState: version.state,
    initialRevision: version.revision,
    ctx,
  });
  const state = session.state;
  // The latest state, for work that finishes asynchronously (a model loading).
  const stateRef = useRef(state);
  stateRef.current = state;

  const [selection, setSelection] = useState<PickTarget | null>(null);
  const [mode, setMode] = useState<LeftMode>('ROOMS');
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheet, setSheet] = useState<LeftMode | 'INSPECTOR' | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [modelFailed, setModelFailed] = useState(false);
  const navigate = useNavigate();
  const [trayOpen, setTrayOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const projectId = bundle.project.id;
  const versions = useMemo(() => bundle.versions.filter((v) => v.source_id === source.id), [bundle.versions, source.id]);
  const initialCamera = useMemo(() => cameraMemory.get(projectId) ?? null, [projectId]);

  // Remember the view on the way out (version switch, compare, leaving).
  useEffect(() => () => {
    const c = controllerRef.current;
    if (c) cameraMemory.set(projectId, c.snapshot());
  }, [projectId]);

  useEffect(() => {
    listSavedViews(projectId).then(setViews).catch(() => { /* views are an aid, not the design */ });
  }, [projectId]);

  useEffect(() => {
    const keys = versions.map((v) => v.thumbnail_key).filter((k): k is string => !!k);
    if (keys.length) signedUrls(keys).then(setThumbs).catch(() => {});
  }, [versions]);

  /* A thumbnail of this version after it saves: at most once a minute, best effort. */
  const lastThumb = useRef(0);
  useEffect(() => {
    if (session.status !== 'SAVED' || !homatchUser) return undefined;
    if (Date.now() - lastThumb.current < 60_000) return undefined;
    const timer = setTimeout(async () => {
      const c = controllerRef.current;
      if (!c) return;
      lastThumb.current = Date.now();
      const image = await c.captureThumbnail();
      if (image) await saveVersionThumbnail({ accountId: homatchUser.id, projectId, versionId: version.id, image });
    }, 1500);
    return () => clearTimeout(timer);
  }, [session.status, homatchUser, projectId, version.id]);

  // ── AI designer: proposals, preview, accept ────────────────────────
  const [ai, setAi] = useState<{ jobId: string; basis: DesignState; items: AiProposalItem[]; dropped: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);

  // Draw every state the session produces — or, while previewing, the
  // proposal, which is never written into the design until accepted.
  useEffect(() => {
    const proposed = previewing != null ? ai?.items[previewing]?.proposal.state : undefined;
    controllerRef.current?.applyDesign(proposed ?? state, assets, materials);
  }, [state, assets, materials, previewing, ai]);
  // Any real change ends a preview: the customer is editing again.
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current !== state) setPreviewing(null);
    lastState.current = state;
  }, [state]);

  const label = provenanceLabel(source);
  const selectedObject = selection?.kind === 'object' ? state.objects.find((o) => o.instanceId === selection.id) ?? null : null;
  const activeRoomId = selection?.kind === 'room' ? selection.id
    : selectedObject ? selectedObject.roomId
      : selection && 'roomId' in selection ? selection.roomId : null;
  const activeRoom = space && activeRoomId ? roomOf(space, activeRoomId) : null;

  const recentColors = useMemo(() => {
    const seen: string[] = [];
    for (const o of [...state.objects].reverse()) if (o.colorOverride && !seen.includes(o.colorOverride)) seen.push(o.colorOverride);
    for (const s of Object.values(state.surfaces).reverse()) if (s.color && !seen.includes(s.color)) seen.push(s.color);
    return [...state.palette.filter((c) => !seen.includes(c)), ...seen].slice(0, 10);
  }, [state]);

  const rejectionMessage = useCallback((r: Rejection) => {
    if (r.code === 'PLACEMENT_BLOCKED' && r.placement?.some((i) => i.code === 'THROUGH_WALL')) return t('ds_issue_through_wall');
    if (r.code === 'PLACEMENT_BLOCKED' && r.placement?.some((i) => i.code === 'OUTSIDE_ROOM')) return t('ds_issue_outside');
    return t(REJECTION_KEY[r.code] ?? 'ds_reject_op_generic');
  }, [t]);

  const run = useCallback((ops: Operation[], labelKey: string): boolean => {
    const result = session.apply(ops, t(labelKey));
    if (!result.ok) {
      toast.error(rejectionMessage(result.rejection));
      controllerRef.current?.applyDesign(session.state, assets, materials);
      return false;
    }
    return true;
  }, [session, t, rejectionMessage, assets, materials]);

  const generate = useCallback(async (brief: DesignBrief) => {
    if (!space) return;
    setAiBusy(true);
    setAiError(null);
    try {
      await session.saveNow();
      const { jobId, plan } = await requestDesign(version.id, brief);
      const wanted = [...new Set(plan.alternatives.flatMap((a) => a.rooms.flatMap((r) => r.furniture)))].filter((c) => !assets.has(c));
      let all = assets;
      if (wanted.length) {
        const more = await assetsByCode(wanted);
        setExtraAssets((x) => [...x, ...more]);
        all = new Map([...assets, ...more.map((a) => [a.code, a] as const)]);
      }
      const basis = session.state;
      const items = plan.alternatives.map((alt, i) => {
        const proposal = planToOperations(alt, {
          state: basis, space, ctx: { ...ctx, assets: all }, assets: all, materials: catalog.materials, idPrefix: `ai-${jobId.slice(0, 8)}-${i + 1}`,
        });
        return { alt, proposal, notes: critique(proposal.state, space, all, alt.rooms.map((r) => r.roomId)) };
      });
      setAi({ jobId, basis, items, dropped: Object.values(plan.dropped ?? {}).reduce((a, b) => a + b, 0) });
    } catch (e) {
      setAiError(t(AI_ERROR_KEY[e instanceof DesignStudioError ? e.code : ''] ?? 'ds_ai_error_generic'));
    } finally {
      setAiBusy(false);
    }
  }, [space, session, version.id, assets, ctx, catalog.materials, t]);

  /** A proposal as it applies to the design NOW (the customer may have edited since it was made). */
  const freshProposal = useCallback((i: number) => {
    if (!ai || !space) return null;
    const item = ai.items[i];
    if (!item) return null;
    return session.state === ai.basis ? item.proposal : planToOperations(item.alt, {
      state: session.state, space, ctx, assets, materials: catalog.materials, idPrefix: `ai-${ai.jobId.slice(0, 8)}-${i + 1}`,
    });
  }, [ai, space, session.state, ctx, assets, catalog.materials]);

  const applyAi = useCallback((i: number) => {
    const proposal = freshProposal(i);
    if (!ai || !proposal) return;
    if (!proposal.ops.length) { toast.error(t('ds_ai_nothing_left')); return; }
    const r = session.apply(proposal.ops, t('ds_label_ai'), 'AI', ai.jobId);
    if (!r.ok) { toast.error(rejectionMessage(r.rejection)); return; }
    setPreviewing(null);
    setAi(null);
    toast.success(t('ds_ai_applied'));
  }, [freshProposal, ai, session, t, rejectionMessage]);

  const saveAiVersion = useCallback(async (i: number) => {
    const proposal = freshProposal(i);
    if (!ai || !proposal || !homatchUser) return;
    const item = ai.items[i];
    setBusy(true);
    try {
      await session.saveNow();
      const created = await createVersion({
        userId: homatchUser.id, projectId, sourceId: source.id, parentId: version.id, origin: 'AI', jobId: ai.jobId,
        name: uniqueVersionName(item.alt.title, versions.map((v) => v.name)),
        state: copyState(proposal.state) as unknown as Record<string, unknown>,
        styleTags: item.alt.styleCode ? [item.alt.styleCode] : [],
        changeSummary: [{ kind: 'AI_PROPOSAL', jobId: ai.jobId, ...proposal.summary }],
      });
      const c = controllerRef.current;
      if (c) cameraMemory.set(projectId, c.snapshot());
      await onReload();
      navigate(`/design-studio/${projectId}/design/${created.id}`);
    } catch {
      toast.error(t('ds_error_generic'));
    } finally {
      setBusy(false);
    }
  }, [freshProposal, ai, homatchUser, session, projectId, source.id, version.id, versions, onReload, navigate, t]);

  const setKeep = useCallback((key: keyof LockSet, value: boolean) => {
    run([{ type: 'SET_LOCKS', locks: { [key]: value } }], value ? 'ds_label_keep' : 'ds_label_unkeep');
  }, [run]);

  // ── Placement helpers ──────────────────────────────────────────────

  // ── Versions ───────────────────────────────────────────────────────

  const openVersion = useCallback(async (id: string) => {
    if (id === version.id) return;
    await session.saveNow();
    const c = controllerRef.current;
    if (c) cameraMemory.set(projectId, c.snapshot());
    await setHeadVersion(projectId, id).catch(() => {});
    navigate(`/design-studio/${projectId}/design/${id}`);
  }, [version.id, session, projectId, navigate]);

  const forkVersion = useCallback(async (fromId: string, origin: 'DUPLICATE' | 'BRANCH') => {
    if (!homatchUser) return;
    setBusy(true);
    try {
      await session.saveNow();
      const from = fromId === version.id ? session.state : normalizeDesignState((await getVersion(fromId))?.state);
      const fromName = versions.find((v) => v.id === fromId)?.name ?? version.name;
      const base = origin === 'DUPLICATE' ? t('ds_version_copy_of', { name: fromName }) : t('ds_version_new_direction');
      const created = await createVersion({
        userId: homatchUser.id, projectId, sourceId: source.id, parentId: fromId, origin,
        name: uniqueVersionName(base, versions.map((v) => v.name)),
        state: copyState(from) as unknown as Record<string, unknown>,
      });
      const c = controllerRef.current;
      if (c) cameraMemory.set(projectId, c.snapshot());
      await onReload();
      navigate(`/design-studio/${projectId}/design/${created.id}`);
    } catch {
      toast.error(t('ds_error_generic'));
    } finally {
      setBusy(false);
    }
  }, [homatchUser, session, version, versions, t, projectId, source.id, onReload, navigate]);

  const renameOne = useCallback(async (id: string, name: string) => {
    try { await renameVersion(id, name); await onReload(); } catch { toast.error(t('ds_error_generic')); }
  }, [onReload, t]);

  const archiveOne = useCallback(async (id: string) => {
    try { await setVersionArchived(id, true); await onReload(); } catch { toast.error(t('ds_error_generic')); }
  }, [onReload, t]);

  const saveView = useCallback(async (name: string) => {
    const c = controllerRef.current;
    if (!c || !homatchUser) return;
    try {
      const created = await createSavedView({
        userId: homatchUser.id, projectId, name, camera: c.snapshot(), roomId: activeRoomId, sort: views.length,
      });
      setViews((v) => [...v, created]);
    } catch { toast.error(t('ds_error_generic')); }
  }, [homatchUser, projectId, activeRoomId, views.length, t]);

  const removeView = useCallback(async (id: string) => {
    try { await deleteSavedView(id); setViews((v) => v.filter((x) => x.id !== id)); } catch { toast.error(t('ds_error_generic')); }
  }, [t]);

  const openCompare = () => {
    const c = controllerRef.current;
    if (c) cameraMemory.set(projectId, c.snapshot());
    setCompareOpen(true);
  };

  const newId = (asset: CatalogAsset) => `${asset.code.split('/').pop()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  const targetRoomFor = useCallback((asset: CatalogAsset) => {
    if (!space) return null;
    if (activeRoom) return activeRoom;
    const fitting = space.rooms.filter((r) => asset.roomKinds.includes(r.kind)).sort((a, b) => b.areaM2 - a.areaM2);
    return fitting[0] ?? [...space.rooms].sort((a, b) => b.areaM2 - a.areaM2)[0] ?? null;
  }, [space, activeRoom]);

  const addAsset = useCallback((asset: CatalogAsset, point?: { x: number; y: number } | null) => {
    if (!space) return;
    const pctx = { space, assets, objects: state.objects };
    const room = point ? roomOf(space, roomContaining(space, point)) : targetRoomFor(asset);
    if (!room) {
      toast.error(t('ds_add_no_room'));
      return;
    }
    let placed: { at: { x: number; y: number }; rotation: number } | null = null;
    if (point) {
      const snapped = snapToWall(pctx, asset, point, 0, room.id);
      const candidate = snapped.snapped ? snapped : quantise(point, 0);
      placed = blocks(evaluatePlacement(pctx, asset, candidate.at, candidate.rotation, room.id))
        ? autoPlace(pctx, asset, room)
        : candidate;
    } else {
      placed = autoPlace(pctx, asset, room);
    }
    if (!placed) {
      // The chosen room cannot take it; say so rather than dropping it somewhere else.
      toast.error(t('ds_add_no_space', { room: names.get(room.id) ?? '' }));
      return;
    }
    const object: ObjectInstance = {
      instanceId: newId(asset), assetId: asset.code, roomId: room.id,
      position: { x: placed.at.x, y: 0, z: placed.at.y }, rotationY: placed.rotation,
      materialVariant: null, colorOverride: null, locked: false,
    };
    if (run([{ type: 'ADD_OBJECT', object }], 'ds_label_add')) {
      setSelection({ kind: 'object', id: object.instanceId, roomId: room.id });
      setSheet(null);
    }
  }, [space, assets, state.objects, targetRoomFor, names, run, t]);

  const findingsFor = useCallback((obj: ObjectInstance): PlacementIssue[] => {
    const asset = assets.get(obj.assetId);
    if (!space || !asset) return [];
    return evaluatePlacement({ space, assets, objects: state.objects }, asset, { x: obj.position.x, y: obj.position.z }, obj.rotationY, obj.roomId, obj.instanceId);
  }, [space, assets, state.objects]);

  // ── Direct manipulation on the canvas ──────────────────────────────

  const dragPreview = useRef<{ at: { x: number; y: number }; rotation: number; roomId: string | null; valid: boolean } | null>(null);
  const objectDrag = useMemo(() => (space ? {
    canDrag: (id: string) => {
      const o = state.objects.find((x) => x.instanceId === id);
      return !!o && !o.locked && !state.locks.layout && assets.get(o.assetId)?.placement === 'FLOOR';
    },
    onMove: (id: string, p: { x: number; y: number }, free: boolean) => {
      const o = state.objects.find((x) => x.instanceId === id);
      const asset = o ? assets.get(o.assetId) : undefined;
      if (!o || !asset) return null;
      const roomId = roomContaining(space, p);
      const pctx = { space, assets, objects: state.objects };
      // Snapping helps without trapping: the wall, then a neighbour's line,
      // then a 5 cm grid — and the override key (Alt) places freely. Either
      // way an invalid spot (through a wall, outside the room) is refused.
      let q: { at: { x: number; y: number }; rotation: number };
      if (free) q = { at: p, rotation: o.rotationY };
      else {
        const s = roomId ? snapToWall(pctx, asset, p, o.rotationY, roomId) : { at: p, rotation: o.rotationY, snapped: false };
        if (s.snapped) q = s;
        else {
          const aligned = alignToNeighbours(pctx, s.at, roomId, id);
          const g = quantise(aligned.at, s.rotation);
          q = { at: { x: aligned.alignedX ? aligned.at.x : g.at.x, y: aligned.alignedY ? aligned.at.y : g.at.y }, rotation: g.rotation };
        }
      }
      const valid = !!roomId && !blocks(evaluatePlacement(pctx, asset, q.at, q.rotation, roomId, id));
      dragPreview.current = { at: q.at, rotation: q.rotation, roomId, valid };
      return { at: q.at, rotation: q.rotation, valid };
    },
    onDrop: (id: string) => {
      const o = state.objects.find((x) => x.instanceId === id);
      const p = dragPreview.current;
      dragPreview.current = null;
      if (!o || !p) return;
      if (!p.valid) {
        toast.error(t('ds_issue_through_wall'));
        controllerRef.current?.applyDesign(state, assets, materials);
        return;
      }
      const ops: Operation[] = [];
      if (Math.abs(p.rotation - o.rotationY) > 1e-6) ops.push({ type: 'ROTATE_OBJECT', instanceId: id, rotationY: p.rotation });
      ops.push({ type: 'MOVE_OBJECT', instanceId: id, position: { x: p.at.x, y: 0, z: p.at.y }, roomId: p.roomId });
      run(ops, 'ds_label_move');
    },
    onCancel: () => {
      dragPreview.current = null;
      controllerRef.current?.applyDesign(state, assets, materials);
    },
  } : undefined), [space, state, assets, materials, run, t]);

  // Turning a piece by its handle: previewed live, committed once on release.
  const objectRotate = useMemo(() => (space ? {
    canRotate: (id: string) => {
      const o = state.objects.find((x) => x.instanceId === id);
      const a = o ? assets.get(o.assetId) : undefined;
      return !!o && !!a && !o.locked && !state.locks.layout && a.placement === 'FLOOR' && (a.capabilities ?? ['ROTATABLE']).includes('ROTATABLE');
    },
    pose: (id: string) => {
      const o = state.objects.find((x) => x.instanceId === id);
      return o ? { at: { x: o.position.x, y: o.position.z }, rotation: o.rotationY } : null;
    },
    onRotate: (id: string, rotation: number, free: boolean) => {
      const o = state.objects.find((x) => x.instanceId === id);
      const a = o ? assets.get(o.assetId) : undefined;
      const r = free ? rotation : quantise({ x: 0, y: 0 }, rotation).rotation;
      const valid = !!o && !!a && !blocks(evaluatePlacement({ space, assets, objects: state.objects }, a, { x: o.position.x, y: o.position.z }, r, o.roomId, id));
      return { rotation: r, valid };
    },
    onRotateEnd: (id: string, rotation: number, valid: boolean) => {
      const o = state.objects.find((x) => x.instanceId === id);
      if (!o || Math.abs(rotation - o.rotationY) < 1e-6) { controllerRef.current?.applyDesign(state, assets, materials); return; }
      if (!valid) { toast.error(t('ds_issue_through_wall')); controllerRef.current?.applyDesign(state, assets, materials); return; }
      run([{ type: 'ROTATE_OBJECT', instanceId: id, rotationY: rotation }], 'ds_label_rotate');
    },
    onCancel: () => { controllerRef.current?.applyDesign(state, assets, materials); },
  } : undefined), [space, state, assets, materials, run, t]);

  /** Arrow keys nudge the selected piece 5 cm (1 cm with Shift) — the accessible alternative to dragging. */
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    if (!selectedObject) return;
    const p = { x: selectedObject.position.x + dx, y: selectedObject.position.z + dy };
    const roomId = space ? roomContaining(space, p) ?? selectedObject.roomId : selectedObject.roomId;
    run([{ type: 'MOVE_OBJECT', instanceId: selectedObject.instanceId, position: { x: p.x, y: selectedObject.position.y, z: p.y }, roomId }], 'ds_label_move');
  }, [selectedObject, space, run]);

  // ── Object actions ─────────────────────────────────────────────────

  const rotateSelected = useCallback((delta: number) => {
    if (!selectedObject) return;
    run([{ type: 'ROTATE_OBJECT', instanceId: selectedObject.instanceId, rotationY: quantise({ x: 0, y: 0 }, selectedObject.rotationY + delta).rotation }], 'ds_label_rotate');
  }, [selectedObject, run]);

  const duplicateSelected = useCallback(() => {
    if (!selectedObject || !space) return;
    const asset = assets.get(selectedObject.assetId);
    const room = roomOf(space, selectedObject.roomId);
    if (!asset || !room) return;
    const placed = autoPlace({ space, assets, objects: state.objects }, asset, room);
    if (!placed) { toast.error(t('ds_add_no_space', { room: names.get(room.id) ?? '' })); return; }
    const object: ObjectInstance = {
      ...selectedObject, instanceId: newId(asset), locked: false,
      position: { x: placed.at.x, y: 0, z: placed.at.y }, rotationY: placed.rotation,
    };
    if (run([{ type: 'ADD_OBJECT', object }], 'ds_label_duplicate')) setSelection({ kind: 'object', id: object.instanceId, roomId: room.id });
  }, [selectedObject, space, assets, state.objects, run, names, t]);

  const removeSelected = useCallback(() => {
    if (!selectedObject) return;
    if (run([{ type: 'REMOVE_OBJECT', instanceId: selectedObject.instanceId }], 'ds_label_remove')) setSelection(null);
  }, [selectedObject, run]);

  const replaceWith = useCallback((asset: CatalogAsset) => {
    if (!replacing) return;
    if (run([{ type: 'REPLACE_OBJECT', instanceId: replacing, assetId: asset.code }], 'ds_label_replace')) {
      setSelection({ kind: 'object', id: replacing, roomId: activeRoomId });
      setReplacing(null);
      setSheet(null);
    }
  }, [replacing, run, activeRoomId]);

  const replacingObject = replacing ? state.objects.find((o) => o.instanceId === replacing) ?? null : null;
  const fitAt = useCallback((asset: CatalogAsset): 'FITS' | 'WARN' | 'NO' => {
    if (!space || !replacingObject) return 'NO';
    const issues = evaluatePlacement({ space, assets, objects: state.objects }, asset,
      { x: replacingObject.position.x, y: replacingObject.position.z }, replacingObject.rotationY, replacingObject.roomId, replacingObject.instanceId);
    return blocks(issues) ? 'NO' : issues.length ? 'WARN' : 'FITS';
  }, [space, replacingObject, assets, state.objects]);

  // ── Selection, camera, keyboard ────────────────────────────────────

  const focusRoom = useCallback((roomId: string) => {
    const room = space?.rooms.find((r) => r.id === roomId);
    if (room) controllerRef.current?.focusRoom(room);
  }, [space]);

  const selectRoom = useCallback((roomId: string) => {
    setSelection({ kind: 'room', id: roomId });
    focusRoom(roomId);
  }, [focusRoom]);

  // ── Walkthrough: the current design, at eye level, inside real walls ──
  const [walking, setWalking] = useState(false);
  const versionNameRef = useRef(version.name);
  const [shareOpen, setShareOpen] = useState<false | 'WALKTHROUGH' | 'DESIGN'>(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [walkRoom, setWalkRoom] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const walkModel = useRef<ReturnType<typeof buildWalkModel> | null>(null);
  const tour = useMemo(() => (space ? tourOrder(space, roomGraph(space)) : []), [space]);
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  const aspect = () => controllerRef.current?.camera.aspect ?? 16 / 9;
  const enterWalk = useCallback((roomId?: string | null) => {
    const c = controllerRef.current;
    if (!c || !space) return;
    setPreviewing(null);
    const model = buildWalkModel(space, state.objects, assets);
    walkModel.current = model;
    const pose = roomId ? roomShot(space, model, roomId, aspect()) : entryShot(space, model, aspect());
    if (!pose) { toast.error(t('ds_walk_unavailable')); return; }
    setSelection(null);
    setSheet(null);
    c.enterWalkthrough(model, pose);
    setWalking(true);
  }, [space, state.objects, assets, t]);

  /** A still of exactly what is on screen (walkthrough or design view), downloaded as a JPEG. */
  const takePhoto = useCallback(async () => {
    const c = controllerRef.current;
    if (!c) return;
    const blob = await c.renderStill({ kind: 'CURRENT' }, 2560, 1440);
    if (!blob) { toast.error(t('ds_export_error')); return; }
    const name = `homatch-${fileSlug(bundle.project.name)}-${fileSlug(versionNameRef.current, 'version')}-${Date.now().toString(36)}.jpg`;
    download(new Uint8Array(await blob.arrayBuffer()), name, 'image/jpeg');
  }, [bundle.project.name, t]);

  const exitWalk = useCallback(() => {
    controllerRef.current?.exitWalkthrough();
    setWalking(false);
    setWalkRoom(null);
    onWalkthroughExit?.();
  }, [onWalkthroughExit]);

  const walkToRoom = useCallback((roomId: string) => {
    const c = controllerRef.current;
    if (!c || !space || !walkModel.current) return;
    const pose = roomShot(space, walkModel.current, roomId, aspect());
    if (pose) void c.routeTo(pose);
  }, [space]);

  const resetWalk = useCallback(() => {
    const c = controllerRef.current;
    if (!c || !space || !walkModel.current) return;
    const pose = entryShot(space, walkModel.current, aspect());
    if (pose) c.walkTo(pose);
  }, [space]);

  // The /walkthrough route: in as soon as the canvas can take it.
  const autoWalked = useRef(false);
  useEffect(() => {
    if (!startWalkthrough || autoWalked.current || !canvasReady || !space) return;
    autoWalked.current = true;
    enterWalk(null);
  }, [startWalkthrough, canvasReady, space, enterWalk]);

  const onPick = useCallback((target: PickTarget | null) => {
    if (controllerRef.current?.walking) return;
    setSelection(target);
    if (target && isPhoneLayout()) setSheet('INSPECTOR');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // Walking: the keys belong to the visitor (Esc opens the walkthrough menu).
      if (controllerRef.current?.walking) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); session.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod) return;
      if (e.key === 'Escape') { setSelection(null); setReplacing(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject) { e.preventDefault(); removeSelected(); }
      else if (key === 'r' && selectedObject) rotateSelected(e.shiftKey ? -Math.PI / 12 : Math.PI / 12);
      else if (selectedObject && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.05;
        // Plan +y is "up the drawing"; on screen the camera decides, so arrows
        // move in plan axes: up/down along y, left/right along x.
        if (e.key === 'ArrowUp') nudgeSelected(0, step);
        else if (e.key === 'ArrowDown') nudgeSelected(0, -step);
        else if (e.key === 'ArrowLeft') nudgeSelected(-step, 0);
        else if (e.key === 'ArrowRight') nudgeSelected(step, 0);
      }
      else if (key === 'f') controllerRef.current?.frameAll();
      else if (key === 't') controllerRef.current?.topView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, selectedObject, removeSelected, rotateSelected, duplicateSelected, exitWalk, nudgeSelected]);

  const loadModel = useMemo(() => {
    if (space) return undefined;
    return async (controller: SceneController) => {
      if (source.kind === 'DEVELOPER_UNIT' && source.dev_unit_id) {
        const current = await developerUnitModelUrl(source.dev_unit_id);
        // The pin is what this design was made against; a different
        // publication is never loaded in its place.
        if (!current || current.sceneId !== source.upstream?.scene_id || current.version !== String(source.upstream?.version)) {
          throw new Error('stale');
        }
        controller.setModel(await loadGltf(current.url, controller.renderer));
        return;
      }
      if (source.kind === 'UPLOADED_MODEL' && source.model_object_key) {
        const url = (await signedUrls([source.model_object_key], 1800)).get(source.model_object_key);
        if (!url) throw new Error('unsigned');
        const { scene, nodes } = await loadGltfWithNodes(url, controller.renderer, parts.map((p) => p.node));
        const bindings = parts.flatMap((p) => {
          const object = nodes.get(p.node);
          return object ? [{ id: p.id, role: p.role, object }] : [];
        });
        controller.setModel(scene, {
          transform: modelAnalysis ? { scale: modelAnalysis.normalization.scale, upAxis: modelAnalysis.normalization.upAxis } : undefined,
          parts: bindings,
        });
        controller.applyDesign(stateRef.current, assets, materials);
        return;
      }
      throw new Error('unsupported');
    };
  }, [space, source, parts, modelAnalysis, assets, materials]);

  // ── Panels ─────────────────────────────────────────────────────────

  /** A model has parts, not rooms; the first panel is named for what it lists. */
  const modeLabel = (id: LeftMode) => (id === 'ROOMS' && !space && modelAnalysis
    ? 'ds_panel_parts' : MODES.find((m) => m.id === id)?.labelKey ?? 'ds_panel_rooms');

  const roomLabelFor = activeRoom ? names.get(activeRoom.id) ?? null : null;
  const roomLabel = useCallback((id: string) => names.get(id) ?? '', [names]);

  const panel = (m: LeftMode) => {
    switch (m) {
      case 'ROOMS':
        if (!space && modelAnalysis) {
          return (
            <ModelPartsPanel
              parts={parts}
              editability={modelAnalysis.editability}
              hidden={state.hiddenParts}
              selectedId={selection && (selection.kind === 'surface' || selection.kind === 'part') ? selection.id : null}
              onSelect={(p) => { setSelection(p.role === 'FURNITURE' ? { kind: 'part', id: p.id } : { kind: 'surface', id: p.id, roomId: null }); setSheet(isPhoneLayout() ? 'INSPECTOR' : null); }}
              onToggleHidden={(p, hide) => run([{ type: 'SET_PART_HIDDEN', partId: p.id, hidden: hide }], hide ? 'ds_label_hide' : 'ds_label_show')}
            />
          );
        }
        return (
          <RoomsPanel space={space} names={names} state={source.geometry_state} activeRoomId={activeRoomId}
            onRoom={(id) => { selectRoom(id); setSheet(null); }} />
        );
      case 'FURNITURE':
        return (
          <FurniturePanel
            assets={catalog.assets.filter((a) => a.active)}
            roomKind={activeRoom?.kind ?? null}
            roomName={roomLabelFor}
            replacing={replacingObject ? { name: assets.get(replacingObject.assetId)?.name ?? '', category: assets.get(replacingObject.assetId)?.category ?? '' } : null}
            fit={fitAt}
            onAdd={(a) => addAsset(a)}
            onReplace={replaceWith}
            onCancelReplace={() => setReplacing(null)}
          />
        );
      case 'MATERIALS':
        return (
          <RoomMaterials
            space={space} room={activeRoom} roomName={roomLabelFor} state={state} materials={catalog.materials} names={names}
            onPickRoom={selectRoom}
            onApply={(ids, materialId) => run([{ type: 'ASSIGN_MATERIAL', surfaceIds: ids, materialId }], 'ds_label_material')}
          />
        );
      case 'COLORS':
        return (
          <div className="space-y-4 px-4 py-4">
            <div>
              <p className="mb-2 text-[14px] font-medium text-[#0C1119]">{t('ds_colors_project')}</p>
              {state.palette.length ? (
                <div className="flex flex-wrap gap-2">{state.palette.map((c) => <Swatch key={c} color={c} label={c} onClick={() => {}} size="sm" />)}</div>
              ) : <p className="text-[13px] text-[#4A5263]">{t('ds_colors_project_empty')}</p>}
            </div>
            <ul className="space-y-2">
              {catalog.palettes.map((p) => (
                <li key={p.code} className="rounded-lg border border-[#E4E6EA] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[14px] font-medium text-[#0C1119]">{p.name}</p>
                    <button type="button" onClick={() => run([{ type: 'APPLY_PALETTE', palette: p.colors }], 'ds_label_palette')}
                      className="h-8 rounded-md border border-[#D5D9E0] px-2.5 text-[13px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                      {t('ds_action_use_palette')}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-1.5">{p.colors.map((c) => <span key={c} className="h-6 flex-1 rounded ring-1 ring-black/10" style={{ backgroundColor: c }} aria-hidden="true" />)}</div>
                </li>
              ))}
            </ul>
            <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_colors_hint')}</p>
          </div>
        );
      case 'AI':
        return (
          <AiDesignPanel
            locks={state.locks}
            activeRoom={activeRoom ? { id: activeRoom.id, name: names.get(activeRoom.id) ?? '' } : null}
            names={names}
            assets={assets}
            busy={aiBusy}
            error={aiError}
            items={ai?.items ?? null}
            dropped={ai?.dropped ?? 0}
            previewing={previewing}
            onKeep={setKeep}
            onGenerate={(brief) => { void generate(brief); }}
            onPreview={(i) => { setPreviewing(i); if (i != null) setSheet(null); }}
            onApply={applyAi}
            onSaveVersion={(i) => { void saveAiVersion(i); }}
            onDiscard={() => { setPreviewing(null); setAi(null); }}
          />
        );
      case 'LIGHTING':
        return (
          <LightingPanel
            key={`${state.lighting.timeOfDay}-${state.lighting.temperature}-${state.lighting.interiorIntensity}`}
            lighting={state.lighting}
            locked={state.locks.lighting || state.lighting.locked}
            onChange={(l) => run([{ type: 'SET_LIGHTING', lighting: l }], 'ds_label_lighting')}
          />
        );
    }
  };

  const objectAsset = selectedObject ? assets.get(selectedObject.assetId) : undefined;
  const inspector = (
    <Inspector
      source={source}
      space={space}
      names={names}
      selection={selection}
      onSelect={setSelection}
      onFocusRoom={focusRoom}
      onRecalibrate={onRecalibrate}
      model={modelAnalysis}
      parts={parts}
      objectHeading={selectedObject ? {
        eyebrow: selectedObject.roomId ? names.get(selectedObject.roomId) ?? '' : t('ds_inspector_object'),
        title: objectAsset?.name ?? t('ds_asset_missing'),
      } : undefined}
    >
      {selectedObject ? (
        <>
        {objectRotate?.canRotate(selectedObject.instanceId) ? <p className="mb-3 hidden rounded-md bg-[#F4F5F7] px-2.5 py-2 text-[13px] leading-relaxed text-[#4A5263] lg:block">{t('ds_hint_manipulate')}</p> : null}
        <ObjectControls
          object={selectedObject}
          asset={objectAsset}
          issues={findingsFor(selectedObject)}
          estimated={estimated}
          palettes={catalog.palettes}
          recentColors={recentColors}
          locked={state.locks.layout && state.locks.furniture}
          onRotate={rotateSelected}
          onReplace={() => { setReplacing(selectedObject.instanceId); setMode('FURNITURE'); setPanelOpen(true); if (isPhoneLayout()) setSheet('FURNITURE'); }}
          onDuplicate={duplicateSelected}
          onRemove={removeSelected}
          onToggleLock={() => run([{ type: selectedObject.locked ? 'UNLOCK_OBJECT' : 'LOCK_OBJECT', instanceId: selectedObject.instanceId }], selectedObject.locked ? 'ds_label_unkeep' : 'ds_label_keep')}
          onVariant={(v) => run([{ type: 'SET_OBJECT_VARIANT', instanceId: selectedObject.instanceId, variant: v }], 'ds_label_finish')}
          onColor={(c) => run([{ type: 'SET_OBJECT_COLOR', instanceId: selectedObject.instanceId, color: c }], 'ds_label_color')}
        />
        </>
      ) : selection?.kind === 'part' ? (
        <PartControls
          hidden={state.hiddenParts.includes(selection.id)}
          locked={state.locks.layout || state.locks.furniture}
          onToggle={() => {
            const hide = !state.hiddenParts.includes(selection.id);
            run([{ type: 'SET_PART_HIDDEN', partId: selection.id, hidden: hide }], hide ? 'ds_label_hide' : 'ds_label_show');
          }}
        />
      ) : selection?.kind === 'surface' && (space || selection.id.startsWith('part:')) ? (
        <SurfaceControls
          key={selection.id}
          surfaceId={selection.id}
          space={space}
          parts={parts}
          state={state}
          materials={catalog.materials}
          palettes={catalog.palettes}
          recentColors={recentColors}
          roomName={selection.roomId ? names.get(selection.roomId) ?? '' : ''}
          onMaterial={(ids, id) => run([{ type: 'ASSIGN_MATERIAL', surfaceIds: ids, materialId: id }], 'ds_label_material')}
          onColor={(ids, c) => run([{ type: 'SET_SURFACE_COLOR', surfaceIds: ids, color: c }], 'ds_label_color')}
        />
      ) : null}
    </Inspector>
  );

  // From the refreshed project list, so a rename shows at once.
  const versionName = versions.find((v) => v.id === version.id)?.name ?? version.name;
  versionNameRef.current = versionName;

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0C1119] text-white">
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-white/10 px-2 sm:gap-2 sm:px-3">
        <Link to="/design-studio" aria-label={t('ds_back_to_projects')} className={TOOL_BUTTON}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <span className="hidden h-7 w-7 shrink-0 place-items-center rounded-md bg-[#101623] text-white/85 ring-1 ring-white/10 sm:grid" aria-hidden="true">
          <NavGlyphIcon name="design_studio" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 sm:flex-none">
          <p className="truncate font-display text-[15px] font-semibold leading-tight">{bundle.project.name}</p>
          <button type="button" onClick={() => setTrayOpen((o) => !o)} aria-expanded={trayOpen} className="block max-w-full truncate text-2xs leading-tight text-white/60 underline decoration-white/30 underline-offset-2 sm:hidden">{versionName}</button>
        </div>
        <button
          type="button"
          onClick={() => setTrayOpen((o) => !o)}
          aria-expanded={trayOpen}
          aria-label={t('ds_versions_open', { name: versionName })}
          className="hidden shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[13px] text-white/85 hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] sm:inline-flex"
        >
          {versionName}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', trayOpen && 'rotate-180')} aria-hidden="true" />
        </button>
        <span
          className={cn('hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] xl:inline-flex',
            estimated ? 'bg-[hsl(38_92%_54%)]/15 text-[hsl(38_92%_70%)]' : 'bg-white/5 text-white/70')}
          title={t(estimated ? 'ds_truth_estimated' : 'ds_truth_known')}
        >
          {t(label.originKey)} · {t(label.geometryKey)}
        </span>
        <div className="ms-auto flex items-center gap-0.5 sm:gap-1">
          <button type="button" className={TOOL_BUTTON} onClick={session.undo} disabled={!session.canUndo} aria-label={t('ds_action_undo')} title={`${t('ds_action_undo')} (Ctrl+Z)`}>
            <Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <button type="button" className={TOOL_BUTTON} onClick={session.redo} disabled={!session.canRedo} aria-label={t('ds_action_redo')} title={`${t('ds_action_redo')} (Ctrl+Shift+Z)`}>
            <Redo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <SaveIndicator status={session.status} onRetry={() => { void session.saveNow(); }} />
          {session.status === 'CONFLICT' ? (
            <button type="button" onClick={onReload} className="rounded-md bg-white/10 px-2 py-1 text-[13px] font-medium hover:bg-white/15">{t('ds_action_load_latest')}</button>
          ) : null}
          <span className="mx-1 hidden h-6 w-px bg-white/10 md:block" aria-hidden="true" />
          <button type="button" className={cn(TOOL_BUTTON, 'hidden md:inline-flex')} disabled={versions.filter((v) => !v.archived_at).length < 2}
            onClick={openCompare} aria-label={t('ds_action_compare')}>
            <Columns2 className="h-4 w-4" aria-hidden="true" /><span className="hidden 2xl:inline">{t('ds_action_compare')}</span>
          </button>
          <button type="button" className={cn(TOOL_BUTTON, 'hidden md:inline-flex')} onClick={() => controllerRef.current?.frameAll()} aria-label={t('ds_view_overview')}>
            <Maximize className="h-4 w-4" aria-hidden="true" /><span className="hidden 2xl:inline">{t('ds_view_overview')}</span>
          </button>
          <button type="button" className={cn(TOOL_BUTTON, 'hidden md:inline-flex')} onClick={() => controllerRef.current?.topView()} aria-label={t('ds_view_top')}>
            <SquareDashed className="h-4 w-4" aria-hidden="true" /><span className="hidden 2xl:inline">{t('ds_view_top')}</span>
          </button>
          <button type="button" className={cn(TOOL_BUTTON, 'hidden md:inline-flex')} disabled={!activeRoomId} onClick={() => activeRoomId && focusRoom(activeRoomId)} aria-label={t('ds_view_room')}>
            <Scan className="h-4 w-4" aria-hidden="true" /><span className="hidden 2xl:inline">{t('ds_view_room')}</span>
          </button>
          <button type="button" className={cn(TOOL_BUTTON, 'hidden sm:inline-flex')} disabled={!space || walking} onClick={() => { setSelection(null); setDownloadOpen(true); }} aria-label={t('ds_export_title')} title={t('ds_export_title')}>
            <Download className="h-4 w-4" aria-hidden="true" /><span className="hidden 2xl:inline">{t('ds_export_short')}</span>
          </button>
          <button type="button" className={TOOL_BUTTON} disabled={!space} onClick={() => setShareOpen('DESIGN')} aria-label={t('ds_share_title')} title={space ? t('ds_share_title') : t('ds_share_error_source')}>
            <Share2 className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">{t('ds_share_short')}</span>
          </button>
          <button
            type="button"
            className={cn(TOOL_BUTTON, walking && 'bg-white/10 text-white')}
            disabled={!space}
            aria-pressed={walking}
            onClick={() => (walking ? exitWalk() : enterWalk(activeRoomId))}
            aria-label={t(walking ? 'ds_walk_exit' : 'ds_walk_enter')}
            title={space ? t('ds_walk_enter') : t('ds_walk_needs_rooms')}
          >
            <Footprints className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">{t(walking ? 'ds_walk_exit' : 'ds_walk_enter')}</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Left: mode rail + library panel ─────────────────────── */}
        <nav aria-label={t('ds_panel_modes')} className={cn('hidden w-14 shrink-0 flex-col items-center gap-1 border-e border-white/10 py-2', !walking && 'lg:flex')}>
          {MODES.filter((m) => !m.needsSpace || space).map((m) => ({ ...m, labelKey: modeLabel(m.id) })).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id && panelOpen}
              onClick={() => { if (mode === m.id) setPanelOpen((o) => !o); else { setMode(m.id); setPanelOpen(true); } }}
              className={cn(
                'grid h-11 w-11 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                mode === m.id && panelOpen ? 'bg-white/10 text-[hsl(38_92%_62%)]' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
              title={t(m.labelKey)}
            >
              <m.icon className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t(m.labelKey)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            className="mt-auto grid h-10 w-10 place-items-center rounded-lg text-white/60 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            aria-label={t(panelOpen ? 'ds_panel_collapse' : 'ds_panel_expand')}
          >
            {panelOpen ? <PanelLeftClose className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> : <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
          </button>
        </nav>
        {panelOpen && !walking ? (
          <aside aria-label={t(modeLabel(mode))} className="hidden w-[18rem] shrink-0 flex-col bg-white text-[#0C1119] lg:flex">
            <h2 className="shrink-0 border-b border-[#E4E6EA] px-4 py-3 font-display text-[15px] font-semibold">
              {t(modeLabel(mode))}
            </h2>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{panel(mode)}</div>
          </aside>
        ) : null}

        {/* ── Center: the canvas ──────────────────────────────────── */}
        <main className="relative min-w-0 flex-1 bg-[#DFE3E8]">
          <DesignCanvas
            space={space}
            loadModel={loadModel}
            selection={selection}
            onPick={onPick}
            onReady={(c) => { controllerRef.current = c; c.applyDesign(state, assets, materials); setCanvasReady(true); }}
            onModelError={() => setModelFailed(true)}
            roomLabel={walking ? undefined : roomLabel}
            onDropAsset={(code, point) => { const a = assets.get(code); if (a) addAsset(a, point); }}
            objectDrag={walking ? undefined : objectDrag}
            objectRotate={walking ? undefined : objectRotate}
            initialCamera={initialCamera}
          />
          {walking && space ? (
            <WalkthroughOverlay
              controller={controllerRef.current}
              tr={t}
              exitLabel={t('ds_walk_exit')}
              onRoomChange={setWalkRoom}
              actions={space ? (
                <>
                <button type="button" onClick={() => { void takePhoto(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t('ds_walk_photo')}</span>
                  <span className="sr-only lg:hidden">{t('ds_walk_photo')}</span>
                </button>
                <button type="button" onClick={() => setShareOpen('WALKTHROUGH')} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t('ds_share_walkthrough')}</span>
                  <span className="sr-only lg:hidden">{t('ds_share_walkthrough')}</span>
                </button>
                </>
              ) : null}
              rooms={tour.map((id) => ({ id, name: names.get(id) ?? '' }))}
              touch={touch || isPhoneLayout()}
              onRoom={walkToRoom}
              onReset={resetWalk}
              onExit={exitWalk}
            />
          ) : null}
          {previewing != null && ai?.items[previewing] ? (
            <div role="status" className="absolute inset-x-3 top-14 z-10 mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-lg bg-[#0C1119] px-3 py-2 text-[14px] text-white shadow-lg ring-1 ring-white/10">
              <Sparkles className="h-4 w-4 shrink-0 text-[hsl(38_92%_62%)]" aria-hidden="true" />
              <span className="min-w-0 flex-1">{t('ds_ai_previewing', { title: ai.items[previewing].alt.title })}</span>
              <button type="button" onClick={() => applyAi(previewing)} className="h-8 rounded-md bg-white px-2.5 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90">{t('ds_ai_apply')}</button>
              <button type="button" onClick={() => setPreviewing(null)} className="h-8 rounded-md px-2.5 text-[13px] font-medium text-white/85 ring-1 ring-white/25 hover:bg-white/10">{t('ds_ai_stop_preview')}</button>
            </div>
          ) : null}
          {modelFailed ? (
            <div role="alert" className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-lg bg-white px-4 py-3 text-[14px] text-[#0C1119] shadow-md ring-1 ring-black/10">
              {t('ds_model_failed')}
            </div>
          ) : null}
          {space && !walking ? (
            <PlanNavigator
              space={space}
              activeRoomId={activeRoomId}
              names={names}
              onRoom={selectRoom}
              label={t('ds_plan_navigator')}
              className="absolute bottom-3 start-3 w-32 sm:w-44 lg:bottom-4"
            />
          ) : null}
          {walking ? null : <p className="pointer-events-none absolute end-3 top-3 hidden max-w-[22rem] rounded-md bg-white/80 px-2.5 py-1 text-end text-2xs leading-snug text-[#4A5263] ring-1 ring-black/5 backdrop-blur lg:block">
            {t('ds_preview_note')}
          </p>}
        </main>

        {/* ── Right: the inspector ─────────────────────────────────── */}
        <aside aria-label={t('ds_inspector')} className={cn('hidden w-[19rem] shrink-0 overflow-y-auto border-s border-white/10 bg-white text-[#0C1119]', !walking && 'lg:block')}>
          {inspector}
        </aside>
      </div>

      {trayOpen ? (
        <VersionsTray
          versions={versions}
          currentId={version.id}
          thumbnails={thumbs}
          views={views}
          busy={busy}
          onOpen={(id) => { void openVersion(id); }}
          onDuplicate={(id) => { void forkVersion(id, 'DUPLICATE'); }}
          onBranch={(id) => { void forkVersion(id, 'BRANCH'); }}
          onRename={(id, name) => { void renameOne(id, name); }}
          onArchive={(id) => { void archiveOne(id); }}
          onCompare={openCompare}
          onSaveView={(name) => { void saveView(name); }}
          onView={(view) => controllerRef.current?.restore(view.camera)}
          onDeleteView={(id) => { void removeView(id); }}
          onClose={() => setTrayOpen(false)}
        />
      ) : null}
      {downloadOpen && space ? (
        <DownloadDialog
          controller={controllerRef.current}
          space={space}
          state={state}
          assets={assets}
          materials={materials}
          names={names}
          projectName={bundle.project.name}
          versionName={versionName}
          estimated={estimated}
          onClose={() => setDownloadOpen(false)}
        />
      ) : null}
      {shareOpen ? (
        <ShareDialog
          projectId={projectId}
          versionId={version.id}
          versionName={versionName}
          versionNames={new Map(versions.map((v) => [v.id, v.name]))}
          beforeCreate={() => session.saveNow()}
          initialType={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {compareOpen ? (
        <CompareView
          space={space}
          versions={versions.filter((v) => !v.archived_at)}
          leftId={version.id}
          assets={assets}
          materials={materials}
          camera={cameraMemory.get(projectId) ?? null}
          loadModel={loadModel}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {/* ── Phone: the canvas is the screen; panels are sheets ─────── */}
      <nav aria-label={t('ds_panel_modes')} className={cn('grid shrink-0 auto-cols-fr grid-flow-col border-t border-white/10 bg-[#0C1119] pb-[env(safe-area-inset-bottom)] lg:hidden', walking && 'hidden')}>
        {[...MODES.filter((m) => (m.id === 'ROOMS' || m.id === 'FURNITURE' || m.id === 'MATERIALS' || m.id === 'LIGHTING' || m.id === 'AI') && (!m.needsSpace || space)).map((m) => ({ ...m, labelKey: modeLabel(m.id) })),
          { id: 'INSPECTOR' as const, labelKey: 'ds_inspector_short', icon: Info }].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSheet(m.id)}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[13px] leading-tight text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]"
          >
            <m.icon className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">{t(m.labelKey)}</span>
          </button>
        ))}
      </nav>
      <Drawer open={sheet !== null && isPhoneLayout()} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <DrawerContent className="max-h-[72dvh] bg-white text-[#0C1119] lg:hidden">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t(sheet === 'INSPECTOR' || !sheet ? 'ds_inspector' : modeLabel(sheet))}</DrawerTitle>
            <DrawerDescription>{t('ds_brand')}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {sheet === 'INSPECTOR' ? inspector : sheet ? panel(sheet) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/** Floor, walls and ceiling of one room, dressed from the materials library. */
function RoomMaterials({
  space, room, roomName, state, materials, names, onPickRoom, onApply,
}: {
  space: SpaceModel | null;
  room: ReturnType<typeof roomOf>;
  roomName: string | null;
  state: DesignState;
  materials: CatalogMaterial[];
  names: Map<string, string>;
  onPickRoom: (roomId: string) => void;
  onApply: (surfaceIds: string[], materialId: string | null) => void;
}) {
  const { t } = useLanguage();
  if (!space) return null;
  if (!room) {
    return (
      <div className="px-4 py-4">
        <p className="text-[14px] text-[#4A5263]">{t('ds_materials_pick_room')}</p>
        <ul className="mt-3 space-y-1">
          {space.rooms.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPickRoom(r.id)} className="w-full rounded-md px-2.5 py-2 text-start text-[14px] text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                {names.get(r.id)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const walls = surfacesOfRoom(space, room.id).filter((s) => s.kind === 'WALL').map((s) => s.id);
  const floorId = floorSurfaceId(room.id);
  const ceilingId = ceilingSurfaceId(room.id);
  const hasCeiling = space.surfaces.some((s) => s.id === ceilingId);
  const wallMaterial = walls.length && walls.every((id) => state.surfaces[id]?.materialId === state.surfaces[walls[0]]?.materialId)
    ? state.surfaces[walls[0]]?.materialId ?? null : null;
  return (
    <div className="space-y-5 px-4 py-4">
      <p className="text-[14px] text-[#4A5263]">{t('ds_materials_for_room', { room: roomName ?? '' })}</p>
      <section>
        <h3 className="mb-2 text-[14px] font-medium text-[#0C1119]">{t('ds_surface_floor')}</h3>
        <MaterialList materials={materials.filter((m) => m.appliesTo.includes('FLOOR'))} current={state.surfaces[floorId]?.materialId ?? null}
          onPick={(m) => onApply([floorId], m.id)} onReset={state.surfaces[floorId]?.materialId ? () => onApply([floorId], null) : undefined} />
      </section>
      <section>
        <h3 className="mb-2 text-[14px] font-medium text-[#0C1119]">{t('ds_materials_walls_n', { n: String(walls.length) })}</h3>
        <MaterialList materials={materials.filter((m) => m.appliesTo.includes('WALL'))} current={wallMaterial}
          onPick={(m) => onApply(walls, m.id)} onReset={wallMaterial ? () => onApply(walls, null) : undefined} />
      </section>
      {hasCeiling ? (
        <section>
          <h3 className="mb-2 text-[14px] font-medium text-[#0C1119]">{t('ds_surface_ceiling')}</h3>
          <MaterialList materials={materials.filter((m) => m.appliesTo.includes('CEILING'))} current={state.surfaces[ceilingId]?.materialId ?? null}
            onPick={(m) => onApply([ceilingId], m.id)} />
        </section>
      ) : null}
      <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_materials_note')}</p>
    </div>
  );
}

const PART_ROLE_KEY: Record<ModelPart['role'], string> = {
  FLOOR: 'ds_surface_floor', WALL: 'ds_surface_wall', CEILING: 'ds_surface_ceiling',
  DOOR: 'ds_part_door', WINDOW: 'ds_part_window', FURNITURE: 'ds_part_furniture',
};

/** The parts HOMATCH identified in an uploaded model, grouped by what they are. */
function ModelPartsPanel({
  parts, editability, hidden, selectedId, onSelect, onToggleHidden,
}: {
  parts: ModelPart[];
  editability: 'FULLY_STRUCTURED' | 'PARTIALLY_STRUCTURED' | 'VISUAL_MODEL';
  hidden: string[];
  selectedId: string | null;
  onSelect: (part: ModelPart) => void;
  onToggleHidden: (part: ModelPart, hidden: boolean) => void;
}) {
  const { t } = useLanguage();
  if (editability === 'VISUAL_MODEL' || parts.length === 0) {
    return <p className="px-4 py-4 text-[14px] leading-relaxed text-[#4A5263]">{t('ds_editability_visual_body')}</p>;
  }
  const groups: Array<ModelPart['role']> = ['WALL', 'FLOOR', 'CEILING', 'FURNITURE', 'DOOR', 'WINDOW'];
  return (
    <div className="space-y-4 px-4 py-4">
      <p className="text-[14px] leading-relaxed text-[#4A5263]">{t('ds_parts_intro')}</p>
      {groups.map((role) => {
        const list = parts.filter((p) => p.role === role);
        if (!list.length) return null;
        const editable = role === 'WALL' || role === 'FLOOR' || role === 'CEILING' || role === 'FURNITURE';
        return (
          <section key={role}>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t(PART_ROLE_KEY[role])} · {list.length}</h3>
            <ul className="space-y-1">
              {list.map((p, i) => {
                const isHidden = hidden.includes(p.id);
                return (
                  <li key={p.id} className={cn('flex items-center gap-1 rounded-md', selectedId === p.id && 'bg-[#F4F5F7]')}>
                    <button
                      type="button"
                      disabled={!editable || isHidden}
                      onClick={() => onSelect(p)}
                      className="min-w-0 flex-1 truncate rounded-md px-2.5 py-2 text-start text-[14px] text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:cursor-default disabled:text-[#4A5263] disabled:hover:bg-transparent"
                    >
                      {t(PART_ROLE_KEY[role])} {i + 1}{isHidden ? ' · ' + t('ds_part_hidden') : ''}
                    </button>
                    {role === 'FURNITURE' ? (
                      <button
                        type="button"
                        onClick={() => onToggleHidden(p, !isHidden)}
                        className="h-8 shrink-0 rounded-md border border-[#D5D9E0] px-2 text-[13px] font-medium text-[#0C1119] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                      >
                        {t(isHidden ? 'ds_part_show' : 'ds_part_hide')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_mi_cannot_add')}</p>
    </div>
  );
}
