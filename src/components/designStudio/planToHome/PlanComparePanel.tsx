// YOUR PLAN, BESIDE YOUR HOME — how HOMATCH read the upload, one tap from the 3D.
//
// The customer's own drawing, HOMATCH's plan of it, or the two laid over each
// other: the trust step, available in the editor and inside the walkthrough.
// A card on desktop, a sheet on a phone; it never covers the whole home.

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { applyAnswers } from '@/lib/designStudio/planRead';
import { getFloorPlan, type FloorPlanRecord } from '@/services/designStudio/floorplans';
import { signedUrls } from '@/services/designStudio/files';
import { latestFlow } from '@/services/designStudio/planToHome';
import { cn } from '@/lib/utils';
import { PlanDrawing } from './PlanDrawing';

export function usePlanFor(floorplanId: string | null | undefined): FloorPlanRecord | null {
  const [plan, setPlan] = useState<FloorPlanRecord | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!floorplanId) { setPlan(null); return; }
    getFloorPlan(floorplanId).then((p) => { if (!cancelled) setPlan(p); }).catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [floorplanId]);
  return plan;
}

export function PlanComparePanel({ plan, onClose, dark = false }: { plan: FloorPlanRecord; onClose: () => void; dark?: boolean }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'ORIGINAL' | 'CLEAN' | 'OVERLAY'>('CLEAN');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    signedUrls([plan.object_key], 1800).then((m) => setUrl(m.get(plan.object_key) ?? null)).catch(() => {});
  }, [plan.object_key]);
  const doc = useMemo(() => {
    const base = plan.interpretation?.doc;
    if (!base) return null;
    return applyAnswers(base, latestFlow(plan)?.answers ?? []);
  }, [plan]);
  const rejected = useMemo(() => new Set(plan.corrections?.[plan.corrections.length - 1]?.decisions?.rejected ?? []), [plan]);
  if (!doc) return null;
  const mpp = plan.interpretation?.understanding?.constraints?.metresPerPx ?? doc.detectedScale ?? null;

  return (
    <section
      className={cn('absolute z-20 flex max-h-[70dvh] flex-col overflow-hidden shadow-2xl ring-1',
        'inset-x-2 bottom-2 rounded-2xl sm:inset-x-auto sm:bottom-4 sm:start-4 sm:w-[min(26rem,calc(100%-2rem))]',
        dark ? 'bg-[#0C1119]/95 text-white ring-white/10 backdrop-blur' : 'bg-white text-[#0C1119] ring-black/10')}
      aria-label={t('p2h_compare_title')} data-testid="plan-compare"
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{t('p2h_compare_title')}</p>
        <button type="button" onClick={onClose} aria-label={t('general_close')} className={cn('grid h-8 w-8 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]', dark ? 'hover:bg-white/10' : 'hover:bg-[#F0F2F5]')}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex gap-1 px-3 py-2" role="tablist">
        {(['ORIGINAL', 'CLEAN', 'OVERLAY'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cn('h-8 flex-1 rounded-full text-2xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
              mode === m ? (dark ? 'bg-white text-[#0C1119]' : 'bg-[#0C1119] text-white') : (dark ? 'bg-white/10 text-white/80' : 'bg-[#F1F3F6] text-[#0C1119]'))}>
            {t(m === 'ORIGINAL' ? 'p2h_compare_original' : m === 'CLEAN' ? 'p2h_compare_homatch' : 'p2h_view_overlay')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
          <PlanDrawing doc={doc} imageUrl={url} mode={mode} rejected={rejected} metresPerPx={mpp}
            roomLabel={(r) => ({ name: t(`ds_room_${r.kind.toLowerCase()}`), size: null })} />
        </div>
        <p className={cn('mt-2 text-2xs', dark ? 'text-white/60' : 'text-[#5B6472]')}>{t('p2h_compare_note')}</p>
      </div>
    </section>
  );
}
