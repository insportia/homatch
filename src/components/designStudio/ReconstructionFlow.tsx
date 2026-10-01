// FROM PICTURES OF A HOME TO A DESIGN YOU CAN EDIT — the customer's path.
//
//   1. Pictures   one to six (a render, photos, an isometric view); with
//                 an existing floor plan, optionally "use my plan for the walls"
//   2. Reading    HOMATCH reads them all at once into structured scene data
//   3. Review     what HOMATCH understood, in plain words: rooms, pieces with
//                 the HOMATCH piece each becomes (and when it is only the
//                 closest), floors and walls, what could not be seen — each
//                 correctable; one optional real measurement
//   4. Build      the shared generator builds the space (ESTIMATED, or
//                 CALIBRATED from the measurement); the pieces become a design
//
// The pictures are never the design: the design is catalogue pieces over
// real geometry, which is why it can be edited and walked through.

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ImagePlus, Loader2, Minus, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import { buildCanonical, calibrate, DEFAULT_CEILING_M, estimateScale, type Anchor, type ReviewDecisions } from '@/lib/designStudio/scale';
import { buildSpaceModel } from '@/lib/designStudio/space';
import type { CanonicalSpace, SpatialSourceRecord } from '@/lib/designStudio/types';
import { OBJECT_TYPES, PX_PER_M, ROOM_KINDS, type ObjectType, type Reconstruction, type ReconRoomKind } from '@/lib/designStudio/reconstructRead';
import {
  alternativesFor, buildDesign, matchSummary, normalizeCorrections, type ReconCorrections,
} from '@/lib/designStudio/reconstruction';
import { DesignStudioError } from '@/services/designStudio/projects';
import { createFloorPlanSource, getFloorPlan, type FloorPlanRecord } from '@/services/designStudio/floorplans';
import { listAssets, listMaterials } from '@/services/designStudio/catalog';
import { signedUrls } from '@/services/designStudio/files';
import {
  MAX_REFERENCES, createReconstruction, createReconstructedVersion, getReconstruction, markBuilt, referencesById,
  runReconstruction, saveCorrections, uploadReference, type ReconstructionRecord,
} from '@/services/designStudio/reconstructions';
import type { CatalogAsset } from '@/lib/designStudio/catalog';
import { readFrame } from '@/lib/designStudio/pictureFrame';
import { scaleFit } from '@/lib/designStudio/sourceCamera';
import { ENGINE_VERSION, STAGES, STAGE_COPY, type Stage } from '@/lib/designStudio/hybrid/contract';
import { totals } from '@/lib/designStudio/hybrid/cost';
import { runEngine, unprojectWith, type EngineResult } from '@/lib/designStudio/hybrid/orchestrate';
import { generationStatus, startGeneration, visualQa } from '@/services/designStudio/generation';
import { offscreenSourceStill } from './canvas/offscreenStill';

type Step = 'PICK' | 'WORKING' | 'REVIEW' | 'BUILDING';
type StageStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'SKIPPED';
const freshStages = (): Record<Stage, StageStatus> => Object.fromEntries(STAGES.map((s) => [s, 'PENDING'])) as Record<Stage, StageStatus>;

/** What is kept of an engine run: routes, timings, cost lines, the visual check and the fidelity gates (never URLs). */
function engineReport(r: EngineResult, extra: { versionId: string; startedAt: number; endedAt: number }): Record<string, unknown> {
  return {
    engineVersion: ENGINE_VERSION,
    mode: 'RECONSTRUCT_FROM_IMAGE',
    versionId: extra.versionId,
    totalMs: Math.round(extra.endedAt - extra.startedAt),
    timings: r.timings,
    decisions: r.decisions.map((d) => ({ key: d.key, type: d.type, route: d.route, impact: Math.round(d.impact * 100) / 100, group: d.group, reason: d.reason })),
    generated: [...r.generated.entries()].map(([k, g]) => ({ key: k, assetId: g.assetId, sha256: g.sha256 })),
    gpu: { jobId: r.gpu.jobId, state: r.gpu.state, error: r.gpu.error, persistedBytes: r.gpu.persistedBytes, worker: r.gpu.worker },
    qa: r.qa ? { scores: r.qa.scores, errors: r.qa.errors.map((e) => ({ code: e.code, target: e.target, severity: e.severity, confidence: e.confidence, evidence: e.evidence.slice(0, 200) })) } : null,
    qaCalls: r.qaCalls,
    correctionPasses: r.correctionPasses,
    applied: r.applied.slice(0, 60),
    skipped: r.skipped.slice(0, 60),
    cost: r.cost,
    costTotals: totals(r.cost),
    fidelity: r.fidelity,
    build: { placed: r.build.placed.length, unmatched: r.build.unmatched, unplaced: r.build.unplaced },
  };
}

const ERROR_KEY: Record<string, string> = {
  DS_REFERENCE_TYPE: 'ds_recon_error_type',
  DS_REFERENCE_TOO_LARGE: 'ds_recon_error_large',
  DS_REFERENCE_TOO_SMALL: 'ds_recon_error_small',
  DS_REFERENCE_UNREADABLE: 'ds_recon_error_type',
  DS_NOT_A_SUPPORTED_IMAGE: 'ds_recon_error_type',
  DS_NOTHING_READ: 'ds_recon_error_nothing',
  DS_READING_UNAVAILABLE: 'ds_recon_error_unavailable',
  DS_BILLING_CONFIRMATION_REQUIRED: 'ds_recon_error_unavailable',
};

const ROOM_KEY: Record<string, string> = {
  LIVING: 'ds_room_living', BEDROOM: 'ds_room_bedroom', KITCHEN: 'ds_room_kitchen', BATHROOM: 'ds_room_bathroom', WC: 'ds_room_wc',
  HALL: 'ds_room_hall', CORRIDOR: 'ds_room_corridor', STORAGE: 'ds_room_storage', BALCONY: 'ds_room_balcony', TERRACE: 'ds_room_terrace', UNKNOWN: 'ds_room_unknown',
};

const PRIMARY = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0C1119] px-5 text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50';
const SELECT = 'h-9 w-full rounded-md border border-[#D5D9E0] bg-white px-2 text-[14px] text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const TOGGLE = 'h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';

export function ReconstructionFlow({
  userId, projectId, planSource, existing, onBuilt, onCancel,
}: {
  userId: string;
  projectId: string;
  /** A built floor-plan space the pictures may furnish ("use my plan for the walls"). */
  planSource: SpatialSourceRecord | null;
  /** Resume a reading that was not built yet. */
  existing?: ReconstructionRecord | null;
  onBuilt: (sourceId: string) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useLanguage();
  const [step, setStep] = useState<Step>(existing?.status === 'READ' ? 'REVIEW' : 'PICK');
  const [files, setFiles] = useState<File[]>([]);
  const [usePlan, setUsePlan] = useState(!!planSource);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [record, setRecord] = useState<ReconstructionRecord | null>(existing ?? null);
  const [refs, setRefs] = useState<FloorPlanRecord[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [picture, setPicture] = useState(0);
  const [corrections, setCorrections] = useState<ReconCorrections>(normalizeCorrections(existing?.corrections));
  const [assets, setAssets] = useState<CatalogAsset[]>([]);
  const [area, setArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<Stage, StageStatus>>(freshStages);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (step !== 'BUILDING') return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  const recon = record?.analysis ?? null;
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  useEffect(() => {
    if (!record) return;
    referencesById(record.reference_ids).then(async (rows) => {
      setRefs(rows);
      setUrls(await signedUrls(rows.map((r) => r.object_key), 1800));
    }).catch(() => {});
  }, [record]);
  useEffect(() => { listAssets({ limit: 500 }).then(setAssets).catch(() => setAssets([])); }, []);

  const fail = (e: unknown, fallback = 'ds_recon_failed') => {
    const code = e instanceof DesignStudioError ? e.code : '';
    setError(t(ERROR_KEY[code] ?? fallback));
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // Copied now: the input is cleared right after (so the same picture can be chosen again).
    const picked = Array.from(list);
    setError(null);
    setFiles((cur) => [...cur, ...picked].slice(0, MAX_REFERENCES));
  };

  const read = async () => {
    if (!files.length) return;
    setError(null);
    setStep('WORKING');
    try {
      const ids: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        setProgress({ n: i + 1, total: files.length });
        ids.push((await uploadReference({ userId, projectId, file: files[i] })).id);
      }
      setProgress(null);
      const created = await createReconstruction({ userId, projectId, referenceIds: ids, planSourceId: usePlan && planSource ? planSource.id : null });
      await runReconstruction(created.id, lang);
      const done = await getReconstruction(created.id);
      if (!done?.analysis) throw new DesignStudioError('DS_READING_FAILED');
      setRecord(done);
      setCorrections(normalizeCorrections(done.corrections));
      setStep('REVIEW');
    } catch (e) {
      fail(e);
      setProgress(null);
      setStep('PICK');
    }
  };

  const summary = useMemo(() => (recon ? matchSummary(recon, corrections, assets) : []), [recon, corrections, assets]);
  const byCode = useMemo(() => new Map(assets.map((a) => [a.code, a])), [assets]);
  const change = (next: Partial<ReconCorrections>) => setCorrections((c) => ({ ...c, ...next }));
  const toggle = (key: string) => change({ rejected: corrections.rejected.includes(key) ? corrections.rejected.filter((k) => k !== key) : [...corrections.rejected, key] });

  const build = async () => {
    if (!record || !recon) return;
    setError(null);
    const startedAt = performance.now();
    const mark = (stage: Stage, status: StageStatus) => setStages((cur) => ({ ...cur, [stage]: status }));
    setStages({ ...freshStages(), UNDERSTANDING: 'DONE', MEASURING: 'RUNNING' });
    setStep('BUILDING');
    try {
      await saveCorrections(record.id, corrections);
      const materials = await listMaterials();
      let sourceId: string;
      let canonical: CanonicalSpace;
      let scale = 1;
      if (recon.usesPlan && record.plan_source_id && planSource && planSource.id === record.plan_source_id) {
        sourceId = planSource.id;
        canonical = planSource.canonical as CanonicalSpace;
      } else {
        const primary = await getFloorPlan(record.reference_ids[0]);
        const doc = (primary?.interpretation as { doc?: FloorPlanDocument } | null)?.doc;
        if (!primary || !doc) throw new DesignStudioError('DS_READING_FAILED');
        const decisions: ReviewDecisions = {
          rejected: corrections.rejected.flatMap((k) => [`r-${k}`, `d-${k}`, `win-${k}`]),
          roomKinds: Object.fromEntries(Object.entries(corrections.roomKinds).map(([k, v]) => [`r-${k}`, v])),
        };
        const areaM2 = Number(area.replace(',', '.'));
        const anchors: Anchor[] = areaM2 > 5 && areaM2 < 2000 ? [{ kind: 'TOTAL_AREA', valueM2: areaM2 }] : [];
        const calibration = calibrate(doc, decisions, anchors, estimateScale(doc, []));
        if (!calibration) throw new DesignStudioError('DS_BUILD_FAILED');
        const result = buildCanonical(doc, decisions, calibration, recon.ceilingHeightM ?? DEFAULT_CEILING_M, recon.ceilingHeightM ? 'DRAWING' : 'TYPICAL');
        if (!result.ok) throw new DesignStudioError('DS_BUILD_FAILED');
        canonical = result.canonical;
        sourceId = await createFloorPlanSource({ floorplanId: primary.id, canonical, geometryState: calibration.geometryState, anchors });
        // Positions follow the plan's calibrated scale; pieces keep their own size.
        scale = calibration.metresPerPx * PX_PER_M;
      }
      const space = buildSpaceModel(canonical.scene);
      mark('MEASURING', 'DONE');
      const assemble = (r: typeof recon) => buildDesign(r, corrections, space, assets, materials, {
        scale, referenceImageIds: record.reference_ids, roomIdOf: recon.usesPlan ? (k) => k : undefined,
      });
      // What the customer kept, as they corrected it: the engine routes and builds only that.
      const rejected = new Set(corrections.rejected);
      const kept = {
        ...recon,
        objects: recon.objects.filter((o) => !rejected.has(o.key) && !(o.room && rejected.has(o.room))).map((o) => ({ ...o, type: corrections.objectTypes[o.key] ?? o.type })),
      };
      // The picture's own camera, in the reading's metres (the check) and in the built space's (the still).
      const camera = recon.cameras.find((c) => c.fit) ?? null;
      const fit = camera?.fit ?? null;
      const pts = recon.rooms.flatMap((r) => r.polygon);
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const centre: [number, number] = pts.length ? [((Math.min(...xs) + Math.max(...xs)) / 2) * scale, ((Math.min(...ys) + Math.max(...ys)) / 2) * scale] : [0, 0];
      const fid = recon.fidelity && camera && recon.fidelity.image === camera.image ? recon.fidelity : null;
      const cut = fid?.wallM ? { exteriorM: fid.wallM * scale, interiorM: (fid.interiorWallM ?? fid.wallM) * scale } : null;
      const background = camera ? readFrame(refs[camera.image]?.picture_geometry)?.background ?? null : null;
      const result = await runEngine({
        recon: kept, assets, confirmed: new Set(corrections.confirmed), unproject: fit ? unprojectWith(fit) : null,
        roomsBuilt: space.rooms.length, quality: 'HIGH',
      }, {
        startGeneration: (keys) => startGeneration(record.id, keys),
        generationStatus,
        assemble,
        render: (state) => (fit ? offscreenSourceStill({ space, state, assets, materials, fit: scaleFit(fit, scale), centre, cut, background }) : Promise.resolve(null)),
        visualQa: async (render, r) => visualQa({
          reconstructionId: record.id, render,
          objects: r.objects.map((o) => ({ key: o.key, type: o.type, label: o.label })),
          rooms: r.rooms.map((x) => ({ key: x.key, kind: x.kind })),
        }),
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        now: () => Date.now(),
        onStage: mark,
      });
      mark('PREPARING', 'RUNNING');
      const version = await createReconstructedVersion({ userId, projectId, sourceId, name: t('ds_recon_version_name'), state: result.state, styleTags: recon.styleWords });
      const report = engineReport(result, { versionId: version.id, startedAt, endedAt: performance.now() });
      // The report is a record of the run; failing to keep it never loses the design.
      await markBuilt(record.id, sourceId, version.id, report).catch(() => markBuilt(record.id, sourceId, version.id));
      mark('PREPARING', 'DONE');
      onBuilt(sourceId);
    } catch (e) {
      fail(e, 'ds_recon_build_failed');
      setStep('REVIEW');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F6F7F9] text-[#0C1119]">
      <header className="flex items-center gap-3 border-b border-[#E3E6EB] bg-white px-4 py-3">
        <button type="button" onClick={onCancel} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-[#F0F2F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" aria-label={t('general_back')}>
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
        <h1 className="text-[17px] font-semibold">{t(step === 'REVIEW' || step === 'BUILDING' ? 'ds_recon_review_title' : 'ds_recon_title')}</h1>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {error ? <p role="alert" className="mb-4 rounded-lg border border-[hsl(0_66%_60%)]/40 bg-[hsl(0_66%_96%)] px-3 py-2 text-[14px]">{error}</p> : null}

        {step === 'PICK' ? (
          <section className="max-w-2xl" data-testid="recon-pick">
            <p className="text-[15px] leading-relaxed text-[#3D4450]">{t('ds_recon_intro')}</p>
            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#C9CED6] bg-white px-4 py-8 text-center hover:border-[#0C1119] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]">
              <ImagePlus className="h-7 w-7 text-[#5B6472]" aria-hidden="true" />
              <span className="text-[15px] font-semibold">{t('ds_recon_choose')}</span>
              <span className="text-[13px] text-[#5B6472]">{t('ds_recon_drop')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" data-testid="recon-input"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <p className="mt-2 text-[13px] text-[#5B6472]">{t('ds_recon_multi_note')}</p>
            {files.length ? (
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-lg bg-white ring-1 ring-[#E3E6EB]">
                    <img src={previews[i]} alt={t('ds_recon_picture', { n: i + 1 })} className="aspect-square w-full object-cover" />
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={t('ds_recon_remove_picture')}
                      className="absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {planSource ? (
              <label className="mt-4 flex items-start gap-3 rounded-lg bg-white p-3 ring-1 ring-[#E3E6EB]">
                <input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0C1119]" />
                <span><span className="block text-[15px] font-medium">{t('ds_recon_use_plan')}</span><span className="text-[13px] text-[#5B6472]">{t('ds_recon_use_plan_note')}</span></span>
              </label>
            ) : null}
            <button type="button" className={cn(PRIMARY, 'mt-5')} disabled={!files.length} onClick={() => { void read(); }} data-testid="recon-read">{t('ds_recon_start')}</button>
          </section>
        ) : null}

        {step === 'BUILDING' ? (
          <section className="mx-auto grid min-h-[40vh] max-w-md content-center gap-4" role="status" aria-live="polite" data-testid="recon-building">
            <div>
              <p className="text-[17px] font-semibold">{t('ds_recon_building')}</p>
              <p className="mt-1 text-[13px] text-[#5B6472]" data-testid="recon-elapsed">{t('ds_gen_elapsed', { m: Math.floor(elapsed / 60), s: String(elapsed % 60).padStart(2, '0') })}</p>
            </div>
            <ol className="grid gap-2">
              {STAGES.map((s) => {
                const st = stages[s];
                return (
                  <li key={s} data-stage={s} data-state={st}
                    className={cn('flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-[14px] ring-1', st === 'RUNNING' ? 'ring-[#0C1119]' : 'ring-[#E3E6EB]', st === 'PENDING' || st === 'SKIPPED' ? 'text-[#8A919C]' : '')}>
                    <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
                      {st === 'RUNNING' ? <Loader2 className="h-4 w-4 animate-spin" /> : st === 'DONE' ? <Check className="h-4 w-4 text-[hsl(152_55%_38%)]" /> : st === 'SKIPPED' ? <Minus className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#C9CED6]" />}
                    </span>
                    <span className="min-w-0 flex-1">{t(STAGE_COPY[s])}</span>
                    <span className="sr-only">{t(`ds_gen_state_${st.toLowerCase()}`)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {step === 'WORKING' ? (
          <div className="grid min-h-[40vh] place-items-center" role="status" aria-live="polite" data-testid="recon-working">
            <p className="inline-flex items-center gap-2 text-[15px]">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              {progress ? t('ds_recon_uploading', progress) : t('ds_recon_reading')}
            </p>
          </div>
        ) : null}

        {step === 'REVIEW' && recon ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="recon-review">
            <section className="min-w-0 space-y-3">
              <p className="text-[14px] leading-relaxed text-[#3D4450]">{t('ds_recon_review_note')}</p>
              {refs.length ? (
                <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-[#E3E6EB]">
                  {urls.get(refs[picture]?.object_key ?? '') ? (
                    <img src={urls.get(refs[picture].object_key)} alt={t('ds_recon_picture', { n: picture + 1 })} className="max-h-[50vh] w-full object-contain" data-testid="recon-reference" />
                  ) : <div className="grid h-48 place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>}
                  {refs.length > 1 ? (
                    <div className="flex gap-1 p-2">
                      {refs.map((r, i) => (
                        <button key={r.id} type="button" aria-pressed={picture === i} onClick={() => setPicture(i)}
                          className={cn(TOGGLE, picture === i ? 'bg-[#0C1119] text-white ring-[#0C1119]' : 'ring-[#D5D9E0]')}>{t('ds_recon_picture', { n: i + 1 })}</button>
                      ))}
                    </div>
                  ) : null}
                </figure>
              ) : null}
              {!recon.usesPlan ? (
                <figure className="rounded-xl bg-white p-3 ring-1 ring-[#E3E6EB]">
                  <figcaption className="mb-2 text-[13px] font-medium text-[#5B6472]">{t('ds_recon_plan_sketch')}</figcaption>
                  <PlanSketch recon={recon} corrections={corrections} selected={selected} onSelect={setSelected} t={t} />
                </figure>
              ) : null}
            </section>

            <section className="min-w-0 space-y-5">
              <p className="text-[13px] text-[#5B6472]" data-testid="recon-counts">
                {t('ds_recon_counts', { rooms: recon.rooms.filter((r) => !corrections.rejected.includes(r.key)).length, pieces: summary.filter((s) => !s.rejected && s.match).length })}
              </p>

              {!recon.usesPlan ? (
                <div>
                  <h2 className="text-[15px] font-semibold">{t('ds_recon_rooms')}</h2>
                  <ul className="mt-2 divide-y divide-[#E3E6EB] rounded-lg bg-white ring-1 ring-[#E3E6EB]">
                    {recon.rooms.map((r) => {
                      const out = corrections.rejected.includes(r.key);
                      return (
                        <li key={r.key} className={cn('flex items-center gap-2 px-3 py-2', out && 'opacity-50')} onMouseEnter={() => setSelected(r.key)}>
                          <select aria-label={t('ds_recon_room_kind')} className={cn(SELECT, 'max-w-[12rem]')} value={corrections.roomKinds[r.key] ?? r.kind}
                            onChange={(e) => change({ roomKinds: { ...corrections.roomKinds, [r.key]: e.target.value as ReconRoomKind } })}>
                            {ROOM_KINDS.map((k) => <option key={k} value={k}>{t(ROOM_KEY[k])}</option>)}
                          </select>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[#5B6472]">{r.label ?? ''} · {t(r.basis === 'OBSERVED' ? 'ds_recon_seen' : 'ds_recon_inferred')}</span>
                          <button type="button" className={cn(TOGGLE, 'ring-[#D5D9E0]')} onClick={() => toggle(r.key)}>{t(out ? 'ds_recon_keep' : 'ds_recon_leave_out')}</button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div>
                <h2 className="text-[15px] font-semibold">{t('ds_recon_pieces')}</h2>
                <ul className="mt-2 divide-y divide-[#E3E6EB] rounded-lg bg-white ring-1 ring-[#E3E6EB]" data-testid="recon-pieces">
                  {summary.map((s) => {
                    const asset = s.match ? byCode.get(s.match.assetId) : undefined;
                    const alternatives = alternativesFor(s.type, assets);
                    return (
                      <li key={s.key} className={cn('grid gap-1.5 px-3 py-2.5', s.rejected && 'opacity-50', selected === s.key && 'bg-[hsl(38_92%_96%)]')}
                        onMouseEnter={() => setSelected(s.key)} data-piece={s.key}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.label}</span>
                          <span className="shrink-0 rounded bg-[#F0F2F5] px-1.5 py-0.5 text-2xs text-[#3D4450]">{t(s.basis === 'OBSERVED' ? 'ds_recon_seen' : 'ds_recon_inferred')} · {Math.round(s.confidence * 100)}%</span>
                          <button type="button" className={cn(TOGGLE, 'ring-[#D5D9E0]')} onClick={() => toggle(s.key)}>{t(s.rejected ? 'ds_recon_keep' : 'ds_recon_leave_out')}</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select aria-label={t('ds_recon_type')} className={SELECT} value={s.type}
                            onChange={(e) => change({ objectTypes: { ...corrections.objectTypes, [s.key]: e.target.value as ObjectType }, assetChoices: Object.fromEntries(Object.entries(corrections.assetChoices).filter(([k]) => k !== s.key)) })}>
                            {OBJECT_TYPES.map((k) => <option key={k} value={k}>{t(`ds_otype_${k}`)}</option>)}
                          </select>
                          {alternatives.length ? (
                            <select aria-label={t('ds_recon_piece_choice')} className={SELECT} value={s.match?.assetId ?? ''}
                              onChange={(e) => change({ assetChoices: { ...corrections.assetChoices, [s.key]: e.target.value }, confirmed: [...new Set([...corrections.confirmed, s.key])] })}>
                              {alternatives.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
                            </select>
                          ) : <span />}
                        </div>
                        <p className="text-[13px] text-[#5B6472]">
                          {asset
                            ? t(s.match!.quality === 'GOOD' ? 'ds_recon_match_good' : 'ds_recon_match_approx', { name: asset.name })
                            : t('ds_recon_no_match')}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {recon.surfaces.length ? (
                <div>
                  <h2 className="text-[15px] font-semibold">{t('ds_recon_surfaces')}</h2>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {recon.surfaces.map((s) => (
                      <li key={`${s.room}-${s.part}`} className="flex items-center gap-2 rounded-full bg-white py-1 pe-3 ps-1 text-[13px] ring-1 ring-[#E3E6EB]">
                        <span className="h-6 w-6 rounded-full ring-1 ring-black/10" style={{ background: s.color ?? '#ddd' }} aria-hidden="true" />
                        {s.material ?? ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {recon.unknowns.length ? (
                <div>
                  <h2 className="text-[15px] font-semibold">{t('ds_recon_unknowns')}</h2>
                  <ul className="mt-1 list-disc ps-5 text-[14px] text-[#3D4450]">{recon.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
                </div>
              ) : null}

              {!recon.usesPlan ? (
                <label className="block rounded-lg bg-white p-3 ring-1 ring-[#E3E6EB]">
                  <span className="block text-[14px] font-medium">{t('ds_recon_area')}</span>
                  <input inputMode="decimal" className={cn(SELECT, 'mt-1.5 max-w-[10rem]')} value={area} onChange={(e) => setArea(e.target.value)} data-testid="recon-area" />
                  <span className="mt-1 block text-[13px] text-[#5B6472]">{t('ds_recon_area_note')}</span>
                </label>
              ) : null}

              <button type="button" className={PRIMARY} onClick={() => { void build(); }} disabled={!assets.length} data-testid="recon-build">{t('ds_recon_build')}</button>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/**
 * The home as HOMATCH read it, from above: rooms (by type), doors and
 * windows, and every piece where it was seen and which way it faces.
 * Removed things fade; the one pointed at in the list lights up.
 */
function PlanSketch({ recon, corrections, selected, onSelect, t }: {
  recon: Reconstruction; corrections: ReconCorrections; selected: string | null; onSelect: (k: string | null) => void; t: (k: string) => string;
}) {
  const pts = recon.rooms.flatMap((r) => r.polygon);
  if (!pts.length) return null;
  const maxX = Math.max(...pts.map((p) => p[0]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const pad = 0.4;
  const W = maxX + pad * 2;
  const H = maxY + pad * 2;
  const X = (x: number) => x + pad;
  const Y = (y: number) => H - (y + pad);
  const out = new Set(corrections.rejected);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-[46vh] w-full" role="img" aria-label={t('ds_recon_plan_sketch')} data-testid="recon-sketch">
      {recon.rooms.map((r) => (
        <g key={r.key} opacity={out.has(r.key) ? 0.25 : 1}>
          <polygon points={r.polygon.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}
            fill={r.outdoor ? '#E8EEF2' : selected === r.key ? '#FFF4DF' : '#FFFFFF'} stroke="#0C1119" strokeWidth={0.06} />
          <text x={X(r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length)} y={Y(r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length)}
            fontSize={0.32} textAnchor="middle" fill="#5B6472">{t(ROOM_KEY[corrections.roomKinds[r.key] ?? r.kind])}</text>
        </g>
      ))}
      {recon.openings.map((o) => (
        <circle key={o.key} cx={X(o.at[0])} cy={Y(o.at[1])} r={o.widthM / 2} fill="none" stroke={o.kind === 'WINDOW' ? '#6FA8C7' : 'hsl(38 92% 50%)'} strokeWidth={0.07} opacity={out.has(o.key) ? 0.25 : 0.9} />
      ))}
      {recon.objects.map((o) => {
        const a = -o.facingDeg; // clockwise-from-north → SVG rotation (y down)
        return (
          <g key={o.key} transform={`translate(${X(o.at[0])} ${Y(o.at[1])}) rotate(${-a})`} opacity={out.has(o.key) ? 0.2 : 1}
            onMouseEnter={() => onSelect(o.key)} onMouseLeave={() => onSelect(null)}>
            <rect x={-o.widthM / 2} y={-o.depthM / 2} width={o.widthM} height={o.depthM} rx={0.05}
              fill={o.color ?? '#B9BEC6'} stroke={selected === o.key ? 'hsl(38 92% 45%)' : '#0C1119'} strokeWidth={selected === o.key ? 0.08 : 0.025} />
            {/* The front, as a short line on the side the piece faces. */}
            <line x1={-o.widthM / 2.5} y1={-o.depthM / 2} x2={o.widthM / 2.5} y2={-o.depthM / 2} stroke="#0C1119" strokeWidth={0.05} />
          </g>
        );
      })}
    </svg>
  );
}
