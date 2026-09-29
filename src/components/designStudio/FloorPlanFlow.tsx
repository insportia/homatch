// FROM A FLOOR PLAN TO A 3D SPACE — the customer's path.
//
//   1. Upload     PNG / JPEG / WebP, or a PDF (page 1 is rendered here)
//   2. Reading    HOMATCH checks the file and reads the drawing
//   3. Review     keep what was read correctly, remove what was misread,
//                 correct room types — the reading is a proposal
//   4. Size       estimated from the drawing, or calibrated from a real
//                 measurement: total area, one wall, one room
//   5. Build      HOMATCH's deterministic generator builds the space
//
// It never shows a space the evidence does not support: no scale signal and
// no measurement means a question, not a guess.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileImage, Loader2, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FloorPlanOverlay, DEFAULT_CATEGORIES, type Selection } from '@/components/developer/FloorPlanOverlay';
import type { FloorPlanDocument, RoomKind } from '@/services/developer/floorplan';
import {
  buildCanonical, calibrate, DEFAULT_CEILING_M, estimateScale, type Anchor, type ReviewDecisions,
} from '@/lib/designStudio/scale';
import { DesignStudioError } from '@/services/designStudio/projects';
import {
  createFloorPlanSource, interpretFloorPlan, recordReview, uploadFloorPlan, getFloorPlan, type FloorPlanRecord,
} from '@/services/designStudio/floorplans';
import { signedUrls } from '@/services/designStudio/files';
import { cn } from '@/lib/utils';

type Step = 'UPLOAD' | 'READING' | 'REVIEW' | 'SIZE';

/**
 * The drawing, scaled down to the width available (never up). The overlay
 * draws at the drawing's own pixel size; CSS zoom keeps its hit targets and
 * its geometry aligned while the whole plan fits a phone.
 */
function FitWidth({ width, children }: { width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || !width) return;
    const observer = new ResizeObserver(([entry]) => setZoom(Math.min(1, entry.contentRect.width / (width + 4))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return <div ref={ref} className="w-full"><div style={{ zoom }}>{children}</div></div>;
}

const ROOM_KINDS: RoomKind[] = ['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'WC', 'HALL', 'CORRIDOR', 'STORAGE', 'BALCONY', 'TERRACE', 'UNKNOWN'];

const ERROR_KEY: Record<string, string> = {
  DS_PLAN_TYPE: 'ds_fp_error_type',
  DS_PLAN_TOO_LARGE: 'ds_fp_error_large',
  DS_PLAN_TOO_SMALL: 'ds_fp_error_small',
  DS_PLAN_UNREADABLE: 'ds_fp_error_unreadable',
  DS_NOT_A_SUPPORTED_IMAGE: 'ds_fp_error_unreadable',
  DS_IMAGE_SIZE_UNREADABLE: 'ds_fp_error_unreadable',
  DS_READING_UNAVAILABLE: 'ds_fp_error_reading_unavailable',
  DS_BILLING_CONFIRMATION_REQUIRED: 'ds_fp_error_reading_unavailable',
};

const INPUT = 'h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-3 text-[15px] text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const PRIMARY = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0C1119] px-5 text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50';

export function FloorPlanFlow({
  userId, projectId, projectName, existing, onBuilt, onCancel,
}: {
  userId: string;
  projectId: string;
  projectName: string;
  /** Recalibrating: start from this plan's review and measurements. */
  existing?: FloorPlanRecord | null;
  onBuilt: (sourceId: string, metresPerPx: number) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>(existing?.interpretation ? 'SIZE' : 'UPLOAD');
  const [plan, setPlan] = useState<FloorPlanRecord | null>(existing ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'UPLOADING' | 'READING'>('UPLOADING');
  const last = existing?.corrections?.[existing.corrections.length - 1];
  const [decisions, setDecisions] = useState<ReviewDecisions>(last?.decisions ?? { rejected: [], roomKinds: {} });
  const [anchors, setAnchors] = useState<Anchor[]>(last?.anchors ?? []);
  const [ceiling, setCeiling] = useState<string>(last?.ceilingM ? String(last.ceilingM) : '');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [building, setBuilding] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const doc = plan?.interpretation?.doc ?? null;
  const dims = plan?.interpretation?.dimensionStrings ?? [];

  useEffect(() => {
    if (!plan?.object_key) return;
    signedUrls([plan.object_key], 1800).then((m) => setImageUrl(m.get(plan.object_key) ?? null)).catch(() => {});
  }, [plan?.object_key]);

  const fail = (e: unknown) => {
    const code = e instanceof DesignStudioError ? e.code : '';
    setError(t(ERROR_KEY[code] ?? 'ds_fp_error_generic'));
  };

  const onFile = async (file: File) => {
    setError(null);
    setStep('READING');
    try {
      setStage('UPLOADING');
      const created = await uploadFloorPlan({ userId, projectId, file });
      setStage('READING');
      await interpretFloorPlan(created.id);
      const read = await getFloorPlan(created.id);
      if (!read?.interpretation) throw new DesignStudioError('DS_READING_FAILED');
      setPlan(read);
      setStep('REVIEW');
    } catch (e) {
      fail(e);
      setStep('UPLOAD');
    }
  };

  // What the overlay shows: removed elements faded, kept ones solid.
  const shown: FloorPlanDocument | null = useMemo(() => {
    if (!doc) return null;
    const mark = <T extends { id: string; state: string }>(e: T) => ({ ...e, state: decisions.rejected.includes(e.id) ? 'REJECTED' : 'CORRECTED' });
    return {
      ...doc,
      walls: doc.walls.map(mark), doors: doc.doors.map(mark), windows: doc.windows.map(mark),
      rooms: doc.rooms.map(mark), balconies: doc.balconies.map(mark),
    } as FloorPlanDocument;
  }, [doc, decisions]);

  const estimate = useMemo(() => (doc ? estimateScale(doc, dims) : null), [doc, dims]);
  const calibration = useMemo(() => (doc ? calibrate(doc, decisions, anchors, estimate) : null), [doc, decisions, anchors, estimate]);
  const ceilingM = Number(ceiling) > 1.8 && Number(ceiling) < 8 ? Number(ceiling) : null;

  const toggleElement = (id: string) => setDecisions((d) => ({
    ...d, rejected: d.rejected.includes(id) ? d.rejected.filter((x) => x !== id) : [...d.rejected, id],
  }));

  const setAnchor = (next: Anchor | null, kind: Anchor['kind']) => {
    setAnchors((list) => {
      const rest = list.filter((a) => a.kind !== kind);
      return next ? [...rest, next] : rest;
    });
  };
  const anchorValue = (kind: Anchor['kind']) => {
    const a = anchors.find((x) => x.kind === kind);
    if (!a) return '';
    return String(a.kind === 'WALL_LENGTH' ? a.valueM : a.valueM2);
  };
  const selectedWall = selection?.kind === 'wall' ? selection.id : (anchors.find((a) => a.kind === 'WALL_LENGTH') as { wallId?: string } | undefined)?.wallId ?? null;
  const selectedRoom = selection?.kind === 'room' ? selection.id : (anchors.find((a) => a.kind === 'ROOM_AREA') as { roomId?: string } | undefined)?.roomId ?? null;

  const build = async () => {
    if (!plan || !doc || !calibration) return;
    setBuilding(true);
    setProblems([]);
    setError(null);
    try {
      const result = buildCanonical(doc, decisions, calibration, ceilingM ?? doc.ceilingHeight ?? DEFAULT_CEILING_M,
        ceilingM ? 'CUSTOMER' : doc.ceilingHeight ? 'DRAWING' : 'TYPICAL');
      if (!result.ok) { setProblems(result.problems); return; }
      await recordReview(plan, { decisions, anchors, ceilingM });
      const sourceId = await createFloorPlanSource({ floorplanId: plan.id, canonical: result.canonical, geometryState: calibration.geometryState, anchors });
      onBuilt(sourceId, calibration.metresPerPx);
    } catch (e) {
      fail(e);
    } finally {
      setBuilding(false);
    }
  };

  const stepIndex = ['UPLOAD', 'READING', 'REVIEW', 'SIZE'].indexOf(step);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F4F5F7] text-[#0C1119]">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-[#0C1119] px-3 text-white">
        <button type="button" onClick={onCancel} aria-label={t('ds_action_cancel')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">{t('ds_fp_title')}</p>
          <p className="truncate font-display text-[15px] font-semibold">{projectName}</p>
        </div>
        <ol className="ms-auto hidden items-center gap-4 text-[13px] md:flex" aria-label={t('ds_fp_steps')}>
          {['ds_fp_step_upload', 'ds_fp_step_reading', 'ds_fp_step_review', 'ds_fp_step_size'].map((key, i) => (
            <li key={key} aria-current={i === stepIndex ? 'step' : undefined} className={cn(i === stepIndex ? 'font-semibold text-white' : i < stepIndex ? 'text-white/60' : 'text-white/35')}>
              {i + 1}. {t(key)}
            </li>
          ))}
        </ol>
      </header>

      {step === 'UPLOAD' || step === 'READING' ? (
        <div className="grid flex-1 place-items-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-xl">
            <h1 className="font-display text-2xl font-semibold">{t('ds_fp_upload_title')}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[#4A5263]">{t('ds_fp_upload_body')}</p>
            {step === 'UPLOAD' ? (
              <label
                className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#B8BFCA] bg-white px-6 py-12 text-center hover:border-[#0C1119] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
              >
                <Upload className="h-8 w-8 text-[#4A5263]" aria-hidden="true" />
                <span className="text-[15px] font-semibold">{t('ds_fp_choose_file')}</span>
                <span className="text-[13px] text-[#4A5263]">{t('ds_fp_file_types')}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
              </label>
            ) : (
              <ol className="mt-6 space-y-2 rounded-xl bg-white p-5 text-[15px]" aria-live="polite">
                {([['UPLOADING', 'ds_fp_stage_uploading'], ['READING', 'ds_fp_stage_reading']] as const).map(([s, key]) => {
                  const order = ['UPLOADING', 'READING'];
                  const at = order.indexOf(stage);
                  const i = order.indexOf(s);
                  return (
                    <li key={s} className={cn('flex items-center gap-2', i < at ? 'text-[#4A5263]' : i === at ? 'font-medium' : 'text-[#9AA1AD]')}>
                      {i === at ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="inline-block h-4 w-4" />}
                      {t(key)}
                    </li>
                  );
                })}
              </ol>
            )}
            {error ? <p role="alert" className="mt-4 rounded-lg bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
            <p className="mt-4 text-[13px] text-[#4A5263]">{t('ds_fp_privacy')}</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-[40dvh] flex-1 overflow-auto bg-[#E4E7EB] p-3">
            {shown && imageUrl ? (
              <FitWidth width={shown.imageWidth}>
                <FloorPlanOverlay doc={shown} imageUrl={imageUrl} categories={DEFAULT_CATEGORIES} selection={selection} onSelect={setSelection} className="mx-auto" />
              </FitWidth>
            ) : (
              <div className="grid h-full place-items-center text-[#4A5263]"><FileImage className="h-8 w-8" aria-hidden="true" /></div>
            )}
          </div>

          <aside className="w-full shrink-0 overflow-y-auto border-s border-[#D5D9E0] bg-white lg:w-[24rem]">
            {step === 'REVIEW' && doc ? (
              <div className="space-y-5 p-5">
                <div>
                  <h2 className="font-display text-lg font-semibold">{t('ds_fp_review_title')}</h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-[#4A5263]">{t('ds_fp_review_body')}</p>
                </div>
                <p className="text-[14px] text-[#0C1119]">
                  {t('ds_fp_read_counts', { walls: String(doc.walls.length), doors: String(doc.doors.length), windows: String(doc.windows.length), rooms: String(doc.rooms.length) })}
                </p>
                {selection && selection.kind !== 'room' ? (
                  <div className="rounded-lg border border-[#E4E6EA] p-3">
                    <p className="text-[14px] font-medium">{t(`ds_fp_element_${selection.kind}`)}</p>
                    <button type="button" onClick={() => toggleElement(selection.id)} className="mt-2 h-9 rounded-md border border-[#D5D9E0] px-3 text-[14px] font-medium hover:bg-[#F4F5F7]">
                      {t(decisions.rejected.includes(selection.id) ? 'ds_fp_keep' : 'ds_fp_misread')}
                    </button>
                  </div>
                ) : null}
                <div>
                  <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_panel_rooms')}</h3>
                  <ul className="space-y-2">
                    {doc.rooms.map((room) => {
                      const removed = decisions.rejected.includes(room.id);
                      return (
                        <li key={room.id} className={cn('rounded-lg border p-2.5', selection?.id === room.id ? 'border-[#0C1119]' : 'border-[#E4E6EA]', removed && 'opacity-60')}>
                          <div className="flex items-center gap-2">
                            <select
                              value={decisions.roomKinds[room.id] ?? room.kind}
                              onChange={(e) => setDecisions((d) => ({ ...d, roomKinds: { ...d.roomKinds, [room.id]: e.target.value } }))}
                              disabled={removed}
                              aria-label={t('ds_fp_room_type')}
                              className="h-9 min-w-0 flex-1 rounded-md border border-[#D5D9E0] bg-white px-2 text-[14px]"
                            >
                              {ROOM_KINDS.map((k) => <option key={k} value={k}>{t(`ds_room_${k.toLowerCase()}`)}</option>)}
                            </select>
                            <button type="button" onClick={() => toggleElement(room.id)} className="h-9 shrink-0 rounded-md border border-[#D5D9E0] px-2.5 text-[13px] font-medium hover:bg-[#F4F5F7]">
                              {t(removed ? 'ds_fp_keep' : 'ds_fp_misread')}
                            </button>
                          </div>
                          {room.label ? <p className="mt-1 text-[13px] text-[#4A5263]">{t('ds_fp_label_on_drawing', { label: room.label })}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <button type="button" className={PRIMARY} onClick={() => setStep('SIZE')}>{t('ds_fp_continue')}</button>
              </div>
            ) : null}

            {step === 'SIZE' && doc ? (
              <div className="space-y-5 p-5">
                <div>
                  <h2 className="font-display text-lg font-semibold">{t('ds_fp_size_title')}</h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-[#4A5263]">
                    {estimate ? t('ds_fp_size_estimated', { pct: String(Math.round(estimate.uncertainty * 100)) }) : t('ds_fp_size_needed')}
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-[14px] font-medium">
                    {t('ds_fp_anchor_total')}
                    <input type="number" inputMode="decimal" min={5} max={2000} step="0.1" className={cn(INPUT, 'mt-1')} placeholder="82"
                      value={anchorValue('TOTAL_AREA')}
                      onChange={(e) => { const v = Number(e.target.value); setAnchor(v > 0 ? { kind: 'TOTAL_AREA', valueM2: v } : null, 'TOTAL_AREA'); }} />
                  </label>
                  <label className="block text-[14px] font-medium">
                    {t('ds_fp_anchor_wall')}
                    <span className="block text-[13px] font-normal text-[#4A5263]">{selectedWall ? t('ds_fp_wall_selected') : t('ds_fp_pick_wall')}</span>
                    <input type="number" inputMode="decimal" min={0.3} max={100} step="0.01" className={cn(INPUT, 'mt-1')} placeholder="4.10"
                      disabled={!selectedWall} value={anchorValue('WALL_LENGTH')}
                      onChange={(e) => { const v = Number(e.target.value); setAnchor(v > 0 && selectedWall ? { kind: 'WALL_LENGTH', wallId: selectedWall, valueM: v } : null, 'WALL_LENGTH'); }} />
                  </label>
                  <label className="block text-[14px] font-medium">
                    {t('ds_fp_anchor_room')}
                    <span className="block text-[13px] font-normal text-[#4A5263]">{selectedRoom ? t('ds_fp_room_selected') : t('ds_fp_pick_room')}</span>
                    <input type="number" inputMode="decimal" min={1} max={500} step="0.1" className={cn(INPUT, 'mt-1')} placeholder="18.5"
                      disabled={!selectedRoom} value={anchorValue('ROOM_AREA')}
                      onChange={(e) => { const v = Number(e.target.value); setAnchor(v > 0 && selectedRoom ? { kind: 'ROOM_AREA', roomId: selectedRoom, valueM2: v } : null, 'ROOM_AREA'); }} />
                  </label>
                  <label className="block text-[14px] font-medium">
                    {t('ds_fp_ceiling')}
                    <input type="number" inputMode="decimal" min={2} max={6} step="0.01" className={cn(INPUT, 'mt-1')}
                      placeholder={String(doc.ceilingHeight ?? DEFAULT_CEILING_M)} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
                    {!ceilingM && !doc.ceilingHeight ? <span className="mt-1 block text-[13px] font-normal text-[#4A5263]">{t('ds_fp_ceiling_default')}</span> : null}
                  </label>
                </div>

                <div className="rounded-lg bg-[#F4F5F7] p-3 text-[14px]" aria-live="polite">
                  {calibration ? (
                    <>
                      <p className="font-semibold">{t(calibration.geometryState === 'VERIFIED' ? 'ds_geometry_verified' : calibration.geometryState === 'CALIBRATED' ? 'ds_geometry_calibrated' : 'ds_geometry_estimated')}</p>
                      <p className="mt-0.5 text-[#4A5263]">{t(`ds_fp_state_${calibration.geometryState.toLowerCase()}`)}</p>
                      {calibration.conflict ? <p className="mt-1 font-medium text-[hsl(32_78%_34%)]">{t('ds_fp_conflict')}</p> : null}
                    </>
                  ) : <p className="font-medium text-[hsl(32_78%_34%)]">{t('ds_fp_size_needed')}</p>}
                </div>

                {problems.length ? (
                  <p role="alert" className="rounded-lg bg-[hsl(0_66%_44%)]/10 px-3 py-2 text-[14px] text-[hsl(0_66%_34%)]">
                    {t('ds_fp_build_problems')} {problems.map((p) => t(`ds_fp_problem_${p.toLowerCase()}`)).join(' · ')}
                  </p>
                ) : null}
                {error ? <p role="alert" className="text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}

                <div className="flex flex-wrap gap-2">
                  {!existing ? <button type="button" onClick={() => setStep('REVIEW')} className="h-11 rounded-lg border border-[#D5D9E0] px-4 text-[15px] font-medium hover:bg-[#F4F5F7]">{t('ds_fp_back_review')}</button> : null}
                  <button type="button" className={PRIMARY} disabled={!calibration || building} onClick={() => { void build(); }}>
                    {building ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {t(existing ? 'ds_fp_rebuild' : 'ds_fp_build')}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
