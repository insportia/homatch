import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { provenanceLabel, type Rejection } from '@/lib/designStudio/spatialSource';
import type { SpatialSourceRecord } from '@/lib/designStudio/types';
import type { ProjectBundle } from '@/services/designStudio/projects';

export interface DesignWorkspaceProps {
  bundle: ProjectBundle;
  source: SpatialSourceRecord;
  rejected: Rejection[];
  freshnessUnchecked: boolean;
  initialVersionId: string | null;
  onReload: () => void;
}

/**
 * CHECKPOINT 1 FRAME. The project, its resolved space and its versions are
 * real and persisted; the interactive canvas, library and inspector arrive
 * in Checkpoint 2 and replace this body.
 */
export function DesignWorkspace({ bundle, source }: DesignWorkspaceProps) {
  const { t } = useLanguage();
  const label = provenanceLabel(source);
  const versions = bundle.versions.filter((v) => v.source_id === source.id);
  return (
    <div className="flex h-full flex-col bg-[#0C1119] text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <Link to="/design-studio" aria-label={t('ds_back_to_projects')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <p className="truncate font-display font-semibold">{bundle.project.name}</p>
        <span className="text-[13px] text-white/60">{t(label.originKey)} · {t(label.geometryKey)}</span>
      </header>
      <div className="grid flex-1 place-items-center text-sm text-white/60">
        {versions.map((v) => v.name).join(' · ')}
      </div>
    </div>
  );
}
