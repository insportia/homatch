import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Box, FileImage, Loader2, RefreshCw, ImagePlus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Rejection } from '@/lib/designStudio/spatialSource';
import type { DesignProjectRecord } from '@/lib/designStudio/types';
import { attachDeveloperUnit, setActiveSource } from '@/services/designStudio/projects';

const REASON_KEY: Record<Rejection['reason'], string> = {
  STALE_UPSTREAM: 'ds_reject_stale_upstream',
  UPSTREAM_WITHDRAWN: 'ds_reject_withdrawn',
  INCOMPATIBLE_GENERATOR: 'ds_reject_incompatible',
  FAILED: 'ds_reject_failed',
  NOT_READY: 'ds_reject_not_ready',
  SUPERSEDED: 'ds_reject_superseded',
  MISSING_PAYLOAD: 'ds_reject_missing',
};

/**
 * A project without a usable space. Says why, in the customer's terms, and
 * offers only the ways forward that exist. It never shows a canvas: an empty
 * 3D room here would be a claim about the property that nothing supports.
 */
export function NoSpacePanel({
  project, rejected, onChanged, onFloorPlan, onModel, onImage,
}: { project: DesignProjectRecord; rejected: Rejection[]; onChanged: () => void; onFloorPlan: () => void; onModel: () => void; onImage?: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const reasons = [...new Set(rejected.map((r) => r.reason).filter((r) => r !== 'SUPERSEDED'))];
  const developerUpdated = reasons.includes('STALE_UPSTREAM') && !!project.dev_unit_id;

  const useUpdated = async () => {
    if (!project.dev_unit_id) return;
    setBusy(true);
    setError(false);
    try {
      const sourceId = await attachDeveloperUnit(project.id, project.dev_unit_id);
      await setActiveSource(project.id, sourceId);
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hm-product h-full overflow-y-auto">
      <div className="bg-[#0C1119] text-white">
        <div className="mx-auto flex w-full max-w-[64rem] items-center gap-3 px-4 py-4 sm:px-6">
          <Link
            to="/design-studio"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label={t('ds_back_to_projects')}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">{t('ds_brand')}</p>
            <h1 className="truncate font-display text-lg font-semibold">{project.name}</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[64rem] px-4 py-10 sm:px-6">
        <h2 className="font-display text-xl font-semibold text-foreground">{t('ds_nospace_title')}</h2>
        <p className="mt-2 max-w-[40rem] text-[15px] leading-relaxed text-muted-foreground">{t('ds_nospace_body')}</p>

        {reasons.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {reasons.map((reason) => (
              <li key={reason} className="rounded-lg border border-[hsl(32_78%_36%)]/30 bg-[hsl(41_88%_91%)]/60 px-4 py-3 text-[15px] text-foreground">
                {t(REASON_KEY[reason])}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-8 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          {developerUpdated ? (
            <button
              type="button"
              onClick={useUpdated}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0C1119] px-5 text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {t('ds_action_use_updated_apartment')}
            </button>
          ) : null}
          {onImage ? (
            <button type="button" onClick={onImage} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-[15px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              {t('ds_action_start_image')}
            </button>
          ) : null}
          <button type="button" onClick={onModel} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-[15px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Box className="h-4 w-4" aria-hidden="true" />
            {t('ds_action_upload_model')}
          </button>
          <button type="button" onClick={onFloorPlan} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0C1119] px-5 text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <FileImage className="h-4 w-4" aria-hidden="true" />
            {t('ds_action_use_floorplan')}
          </button>
        </div>
        <p className="mt-2.5 text-[13px] text-muted-foreground">{t('ds_mi_formats_note')}</p>
        {error ? <p role="alert" className="mt-4 text-sm text-destructive">{t('ds_error_generic')}</p> : null}
      </div>
    </div>
  );
}
