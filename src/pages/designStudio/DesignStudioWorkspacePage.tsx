// HOMATCH DESIGN STUDIO — one project, opened.
//
// Resolves which space this project designs on (see spatialSource.ts), makes
// sure there is a design version to work in, and hands both to the
// workspace. When the project has no usable space yet, it says so and says
// why — a stale developer publication, a failed import — instead of opening
// an empty canvas that pretends to be the property.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { DesignStudioGate } from '@/components/designStudio/DesignStudioGate';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { resolveSpatialSource, type Rejection } from '@/lib/designStudio/spatialSource';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import { createOriginalVersion, getProject, type ProjectBundle } from '@/services/designStudio/projects';
import { NoSpacePanel } from '@/components/designStudio/NoSpacePanel';
import { DesignWorkspace } from '@/components/designStudio/workspace/DesignWorkspace';

export default function DesignStudioWorkspacePage() {
  return (
    <RouteGuard>
      <DesignStudioGate>
        <AppLayout hidePadding>
          <ProjectLoader />
        </AppLayout>
      </DesignStudioGate>
    </RouteGuard>
  );
}

function ProjectLoader() {
  const { projectId = '', versionId } = useParams();
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [bundle, setBundle] = useState<ProjectBundle | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setBundle(await getProject(projectId));
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const resolution = useMemo(() => bundle
    ? resolveSpatialSource({
      sources: bundle.sources,
      preferredSourceId: bundle.project.active_source_id,
      supportedGenerators: SUPPORTED_GENERATORS,
    })
    : null, [bundle]);

  /* A space with no design yet gets its Original — once, never overwriting. */
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!bundle || !resolution?.source || !homatchUser || preparing) return;
    const onThisSource = bundle.versions.some((v) => v.source_id === resolution.source!.id);
    if (onThisSource) return;
    setPreparing(true);
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

  if (failed) return <CenteredMessage title={t('ds_error_load')} back />;
  if (bundle === undefined || preparing) {
    return (
      <div className="grid h-full place-items-center bg-[#0C1119] text-white/80">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('ds_loading_preparing_space')}
        </div>
      </div>
    );
  }
  if (bundle === null) return <CenteredMessage title={t('ds_error_project_missing')} back />;

  if (!resolution?.source) {
    return (
      <NoSpacePanel
        project={bundle.project}
        rejected={resolution?.rejected ?? []}
        onChanged={load}
      />
    );
  }

  return (
    <DesignWorkspace
      bundle={bundle}
      source={resolution.source}
      rejected={resolution.rejected as Rejection[]}
      freshnessUnchecked={resolution.freshnessUnchecked}
      initialVersionId={versionId ?? bundle.project.head_version_id}
      onReload={load}
    />
  );
}

function CenteredMessage({ title, back }: { title: string; back?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="hm-product grid h-full place-items-center px-4">
      <div className="max-w-md text-center">
        <p role="alert" className="text-[15px] text-foreground">{title}</p>
        {back ? (
          <Link to="/design-studio" className="mt-4 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('ds_back_to_projects')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
