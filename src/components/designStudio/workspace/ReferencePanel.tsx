// THE CUSTOMER'S OWN PICTURES, BESIDE THE DESIGN BUILT FROM THEM.
//
// A small card over the canvas (never covering the whole viewport): the
// reference pictures, "Match reference view" — the camera moves to about
// where the picture was taken, estimated, and said to be — and an overlay
// of the picture over the model, with its strength under the customer's
// control. The picture is a reference; the design is the model.

import React, { useEffect, useState } from 'react';
import { Camera, Layers, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { SceneController } from '@/components/designStudio/canvas/SceneController';
import { PX_PER_M } from '@/lib/designStudio/reconstructRead';
import { referenceCamera } from '@/lib/designStudio/reconstruction';
import type { CanonicalSpace, SpatialSourceRecord } from '@/lib/designStudio/types';
import { signedUrls } from '@/services/designStudio/files';
import type { FloorPlanRecord } from '@/services/designStudio/floorplans';
import { listReconstructions, referencesById, type ReconstructionRecord } from '@/services/designStudio/reconstructions';

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';

/** The reconstruction behind this space, if the space (or its design) came from pictures. */
export function useReconstructionFor(projectId: string, source: SpatialSourceRecord): { recon: ReconstructionRecord; refs: FloorPlanRecord[] } | null {
  const [found, setFound] = useState<{ recon: ReconstructionRecord; refs: FloorPlanRecord[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listReconstructions(projectId).then(async (list) => {
      const recon = list.find((r) => r.analysis && (r.built_source_id === source.id || r.plan_source_id === source.id));
      if (!recon) { if (!cancelled) setFound(null); return; }
      const refs = await referencesById(recon.reference_ids);
      if (!cancelled) setFound({ recon, refs });
    }).catch(() => { if (!cancelled) setFound(null); });
    return () => { cancelled = true; };
  }, [projectId, source.id]);
  return found;
}

export function ReferencePanel({ data, source, controller, onClose }: {
  data: { recon: ReconstructionRecord; refs: FloorPlanRecord[] };
  source: SpatialSourceRecord;
  controller: SceneController | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [index, setIndex] = useState(0);
  const [overlay, setOverlay] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  useEffect(() => {
    signedUrls(data.refs.map((r) => r.object_key), 1800).then(setUrls).catch(() => {});
  }, [data.refs]);

  const ref = data.refs[index];
  const url = ref ? urls.get(ref.object_key) : undefined;
  // The plan was read at PX_PER_M; a calibrated space scales its positions.
  const scale = (() => {
    const mpp = (source.canonical as CanonicalSpace | null)?.metresPerPx;
    return data.recon.plan_source_id === source.id || !mpp ? 1 : mpp * PX_PER_M;
  })();
  const camera = data.recon.analysis ? referenceCamera(data.recon.analysis, index, scale) : null;

  return (
    <>
      {overlay && url ? (
        <img src={url} alt="" aria-hidden="true" data-testid="reference-overlay"
          className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-contain" style={{ opacity }} />
      ) : null}
      <aside className="absolute bottom-3 start-3 z-10 w-64 max-w-[calc(100%-1.5rem)] rounded-xl bg-white p-3 text-[#0C1119] shadow-lg ring-1 ring-black/10" aria-label={t('ds_recon_reference')} data-testid="reference-panel">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">{t('ds_recon_reference')}</p>
          <button type="button" onClick={onClose} className={cn('grid h-7 w-7 place-items-center rounded-md hover:bg-[#F0F2F5]', ring)} aria-label={t('general_close')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {url ? <img src={url} alt={t('ds_recon_picture', { n: index + 1 })} className="mt-2 max-h-40 w-full rounded-md object-contain ring-1 ring-black/5" /> : <div className="mt-2 h-28 rounded-md bg-[#F0F2F5]" />}
        {data.refs.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.refs.map((r, i) => (
              <button key={r.id} type="button" aria-pressed={index === i} onClick={() => setIndex(i)}
                className={cn('h-7 rounded-md px-2 text-2xs font-medium ring-1', ring, index === i ? 'bg-[#0C1119] text-white ring-[#0C1119]' : 'ring-[#D5D9E0]')}>
                {i + 1}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 grid gap-1.5">
          <button type="button" disabled={!camera || !controller} data-testid="reference-match"
            onClick={() => { if (camera) controller?.restore(camera); }}
            className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0C1119] text-[13px] font-semibold text-white hover:bg-[#1a2230] disabled:opacity-50', ring)}>
            <Camera className="h-4 w-4" aria-hidden="true" />{t('ds_recon_match_view')}
          </button>
          <button type="button" aria-pressed={overlay} onClick={() => setOverlay((v) => !v)} data-testid="reference-overlay-toggle"
            className={cn('inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium ring-1', ring, overlay ? 'bg-[hsl(38_92%_94%)] ring-[hsl(38_92%_56%)]' : 'ring-[#D5D9E0] hover:bg-[#F4F5F7]')}>
            <Layers className="h-4 w-4" aria-hidden="true" />{t('ds_recon_overlay')}
          </button>
          {overlay ? (
            <label className="grid gap-1 text-2xs text-[#4A5263]">
              {t('ds_recon_opacity')}
              <input type="range" min={0.15} max={0.9} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="accent-[hsl(38_92%_56%)]" />
            </label>
          ) : null}
          <p className="text-2xs leading-snug text-[#5B6472]">{t('ds_recon_estimated_view')}</p>
        </div>
      </aside>
    </>
  );
}
