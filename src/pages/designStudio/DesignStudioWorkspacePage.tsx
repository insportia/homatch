// HOMATCH DESIGN STUDIO — one project, opened.
//
// Resolves which space this project designs on (see spatialSource.ts), makes
// sure there is a design version to work in, and hands both to the
// workspace. When the project has no usable space yet, it says so and says
// why — a stale developer publication, a failed import — instead of opening
// an empty canvas that pretends to be the property.
//
// FULL-VIEWPORT BY DESIGN. The workspace is a focused tool: the global rail
// and the shell's bottom bar would take a third of the width from the 3D
// canvas, which is the product. It stays inside the signed-in application
// (RouteGuard, DesignStudioGate) and its toolbar leads back to the launcher.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { DesignStudioGate } from '@/components/designStudio/DesignStudioGate';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { resolveSpatialSource } from '@/lib/designStudio/spatialSource';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import type { CanonicalSpace, SpatialSourceRecord, UpstreamPin } from '@/lib/designStudio/types';
import { normalizeDesignState } from '@/lib/designStudio/designState';
import { rebaseDesign } from '@/lib/designStudio/scale';
import { FloorPlanFlow } from '@/components/designStudio/FloorPlanFlow';
import { ModelImportFlow } from '@/components/designStudio/ModelImportFlow';
import { getFloorPlan, type FloorPlanRecord } from '@/services/designStudio/floorplans';
import {
  createOriginalVersion, createVersion, developerCurrentPins, getProject, getVersion, setActiveSource, setHeadVersion,
  type ProjectBundle,
} from '@/services/designStudio/projects';
import { NoSpacePanel } from '@/components/designStudio/NoSpacePanel';
import { DesignWorkspace } from '@/components/designStudio/workspace/DesignWorkspace';

export default function DesignStudioWorkspacePage() {
  return (
    <RouteGuard>
      <DesignStudioGate>
        <ProjectLoader />
      </DesignStudioGate>
    </RouteGuard>
  );
}

type Stage = 'PROJECT' | 'SOURCE' | 'VERSION' | 'READY';

function ProjectLoader() {
  useSurfaceTheme('light');
  const { projectId = '', versionId } = useParams();
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [bundle, setBundle] = useState<ProjectBundle | null | undefined>(undefined);
  const [current, setCurrent] = useState<Record<string, UpstreamPin | null> | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [stage, setStage] = useState<Stage>('PROJECT');
  const [params, setParams] = useSearchParams();
  /* The floor-plan flow: new (launcher or no-space panel) or recalibrating an existing plan. */
  const [flow, setFlow] = useState<null | { recalibrate: FloorPlanRecord | null; from: SpatialSourceRecord | null }>(
    () => (params.get('start') === 'floorplan' ? { recalibrate: null, from: null } : null),
  );
  /* A customer's own 3D model (launcher or no-space panel). */
  const [modelFlow, setModelFlow] = useState(() => params.get('start') === 'model');

  // A reload of an open project (rename, archive, new version) refreshes the
  // data behind the workspace without taking it down and putting it back.
  const loaded = useRef(false);
  const load = useCallback(async () => {
    setFailed(false);
    if (!loaded.current) setStage('PROJECT');
    try {
      const next = await getProject(projectId);
      if (next) {
        if (!loaded.current) setStage('SOURCE');
        const units = next.sources.filter((s) => s.kind === 'DEVELOPER_UNIT' && s.dev_unit_id).map((s) => s.dev_unit_id as string);
        setCurrent(await developerCurrentPins(units));
      }
      setBundle(next);
      loaded.current = true;
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const resolution = useMemo(() => bundle
    ? resolveSpatialSource({
      sources: bundle.sources,
      preferredSourceId: bundle.project.active_source_id,
      developerCurrent: current,
      supportedGenerators: SUPPORTED_GENERATORS,
    })
    : null, [bundle, current]);

  /* A space with no design yet gets its Original — once, never overwriting. */
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!bundle || !resolution?.source || !homatchUser || preparing) return;
    const onThisSource = bundle.versions.some((v) => v.source_id === resolution.source!.id);
    if (onThisSource) {
      setStage('READY');
      return;
    }
    setPreparing(true);
    setStage('VERSION');
    createOriginalVersion({
      userId: homatchUser.id,
      projectId: bundle.project.id,
      sourceId: resolution.source.id,
      name: t('ds_version_original'),
    })
      .then(() => load())
      .catch(() => setFailed(true))
      .finally(() => setPreparing(false));
  }, [bundle, resolution, homatchUser, preparing, load, t]);

  const clearStart = useCallback(() => {
    if (!params.get('start')) return;
    const next = new URLSearchParams(params);
    next.delete('start');
    setParams(next, { replace: true });
  }, [params, setParams]);

  /**
   * A new space from a floor plan. When it replaces an earlier floor-plan
   * space (recalibration), every active design is carried across as a new
   * version on the new geometry, positions scaled with the plan, and the
   * earlier versions stay, attached to the geometry they were made on.
   */
  const onBuilt = useCallback(async (sourceId: string, metresPerPx: number) => {
    if (!bundle || !homatchUser) return;
    const from = flow?.from ?? null;
    try {
      await setActiveSource(bundle.project.id, sourceId);
      const oldScale = (from?.canonical as CanonicalSpace | null)?.metresPerPx ?? null;
      if (from && oldScale) {
        const factor = metresPerPx / oldScale;
        const carried = bundle.versions.filter((v) => v.source_id === from.id && !v.archived_at);
        let newHead: string | null = null;
        for (const v of carried) {
          const full = await getVersion(v.id);
          if (!full) continue;
          const created = await createVersion({
            userId: homatchUser.id, projectId: bundle.project.id, sourceId, parentId: v.id, origin: 'RESTORE',
            name: v.name, state: rebaseDesign(normalizeDesignState(full.state), factor) as unknown as Record<string, unknown>,
            changeSummary: [{ kind: 'RECALIBRATED', factor }], makeHead: false,
          });
          if (v.id === bundle.project.head_version_id || !newHead) newHead = created.id;
        }
        if (newHead) await setHeadVersion(bundle.project.id, newHead);
      }
    } catch {
      setFailed(true);
      return;
    }
    setFlow(null);
    clearStart();
    loaded.current = false;
    await load();
  }, [bundle, homatchUser, flow, load, clearStart]);

  const onModelImported = useCallback(async (sourceId: string) => {
    if (!bundle) return;
    try {
      await setActiveSource(bundle.project.id, sourceId);
    } catch {
      setFailed(true);
      return;
    }
    setModelFlow(false);
    clearStart();
    loaded.current = false;
    await load();
  }, [bundle, load, clearStart]);

  const startRecalibration = useCallback(async (source: SpatialSourceRecord) => {
    if (!source.floorplan_id) return;
    const plan = await getFloorPlan(source.floorplan_id).catch(() => null);
    if (plan) setFlow({ recalibrate: plan, from: source });
  }, []);

  if (failed) return <CenteredMessage title={t('ds_error_load')} />;
  if (bundle === null) return <CenteredMessage title={t('ds_error_project_missing')} />;

  if (bundle && homatchUser && flow) {
    return (
      <FloorPlanFlow
        userId={homatchUser.id}
        projectId={bundle.project.id}
        projectName={bundle.project.name}
        existing={flow.recalibrate}
        onBuilt={(id, scale) => { void onBuilt(id, scale); }}
        onCancel={() => { setFlow(null); clearStart(); }}
      />
    );
  }

  if (bundle && homatchUser && modelFlow) {
    return (
      <ModelImportFlow
        userId={homatchUser.id}
        projectId={bundle.project.id}
        projectName={bundle.project.name}
        onDone={(id) => { void onModelImported(id); }}
        onCancel={() => { setModelFlow(false); clearStart(); }}
      />
    );
  }

  if (bundle && resolution && !resolution.source) {
    return (
      <div className="h-[100dvh]">
        <NoSpacePanel project={bundle.project} rejected={resolution.rejected} onChanged={load} onFloorPlan={() => setFlow({ recalibrate: null, from: null })} onModel={() => setModelFlow(true)} />
      </div>
    );
  }

  if (!bundle || !resolution?.source || stage !== 'READY') {
    const steps: Array<[Stage, string]> = [
      ['PROJECT', 'ds_loading_project'],
      ['SOURCE', 'ds_loading_preparing_space'],
      ['VERSION', 'ds_loading_opening'],
    ];
    const at = steps.findIndex(([s]) => s === stage);
    return (
      <div className="grid h-[100dvh] place-items-center bg-[#0C1119] text-white">
        <ol className="space-y-2 text-[15px]" aria-live="polite">
          {steps.map(([s, key], i) => (
            <li key={s} className={i < at ? 'text-white/50' : i === at ? 'text-white' : 'text-white/30'}>
              <span className="inline-flex items-center gap-2">
                {i === at ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="inline-block h-4 w-4" />}
                {t(key)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <DesignWorkspace
      bundle={bundle}
      source={resolution.source}
      rejected={resolution.rejected}
      freshnessUnchecked={resolution.freshnessUnchecked}
      initialVersionId={versionId ?? bundle.project.head_version_id}
      onReload={load}
      onRecalibrate={resolution.source.kind === 'FLOORPLAN_SCENE' ? () => { void startRecalibration(resolution.source!); } : undefined}
    />
  );
}

function CenteredMessage({ title }: { title: string }) {
  const { t } = useLanguage();
  return (
    <div className="hm-product grid h-[100dvh] place-items-center px-4">
      <div className="max-w-md text-center">
        <p role="alert" className="text-[15px] text-foreground">{title}</p>
        <Link to="/design-studio" className="mt-4 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t('ds_back_to_projects')}
        </Link>
      </div>
    </div>
  );
}
