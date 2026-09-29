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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { DesignStudioGate } from '@/components/designStudio/DesignStudioGate';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { resolveSpatialSource } from '@/lib/designStudio/spatialSource';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import type { UpstreamPin } from '@/lib/designStudio/types';
import {
  createOriginalVersion, developerCurrentPins, getProject, type ProjectBundle,
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

  const load = useCallback(async () => {
    setFailed(false);
    setStage('PROJECT');
    try {
      const next = await getProject(projectId);
      if (next) {
        setStage('SOURCE');
        const units = next.sources.filter((s) => s.kind === 'DEVELOPER_UNIT' && s.dev_unit_id).map((s) => s.dev_unit_id as string);
        setCurrent(await developerCurrentPins(units));
      }
      setBundle(next);
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

  if (failed) return <CenteredMessage title={t('ds_error_load')} />;
  if (bundle === null) return <CenteredMessage title={t('ds_error_project_missing')} />;

  if (bundle && resolution && !resolution.source) {
    return (
      <div className="h-[100dvh]">
        <NoSpacePanel project={bundle.project} rejected={resolution.rejected} onChanged={load} />
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
