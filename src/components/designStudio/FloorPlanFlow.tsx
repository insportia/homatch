// FROM A FLOOR PLAN TO A HOME YOU CAN WALK THROUGH — the customer's path.
//
//   1. Upload      PNG / JPEG / WebP, or a PDF (page 1 is rendered here)
//   2. Understand  HOMATCH reads the drawing and checks it against itself:
//                  printed sizes against each other, rooms against walls
//   3. Confirm     the plan as HOMATCH understood it; only the questions its
//                  evidence could not settle; anything can be tapped and fixed
//   4. Look        style, mood, floors, walls, accents, furnishing, own words
//   5. Generate    the AI designer's intent, placed by HOMATCH, built by the
//                  Blender factory — resumable, never paid for twice
//   6. Walk        the walkthrough opens on the result
//
// Every step is kept on the plan's review entry, so a reload lands where the
// customer was. Recalibrating an existing space uses the same review and
// rebuilds the space only (no new design).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileImage, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import {
  buildCanonical, calibrate, DEFAULT_CEILING_M, estimateScale, type Anchor, type Calibration, type ReviewDecisions,
} from '@/lib/designStudio/scale';
import { applyAnswers, solvePlan } from '@/lib/designStudio/planRead';
import {
  DEFAULT_PREFERENCES, normalizePreferences, type DesignPreferences, type FlowTimings, type PlanAnswer,
} from '@/lib/designStudio/planToHome';
import { freshStages, GenerationStages, type StageStatus } from '@/components/designStudio/GenerationStages';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import { DesignStudioError } from '@/services/designStudio/projects';
import {
  createFloorPlanSource, getFloorPlan, interpretFloorPlan, recordReview, uploadFloorPlan, type FloorPlanRecord,
} from '@/services/designStudio/floorplans';
import { generateHome, latestFlow, saveFlow } from '@/services/designStudio/planToHome';
import { signedUrls } from '@/services/designStudio/files';
import { cn } from '@/lib/utils';
import { PlanReview } from './planToHome/PlanReview';
import { DesignChooser } from './planToHome/DesignChooser';

type Step = 'UPLOAD' | 'READING' | 'REVIEW' | 'DESIGN' | 'GENERATING';

const ERROR_KEY: Record<string, string> = {
  DS_PLAN_TYPE: 'ds_fp_error_type',
  DS_PLAN_TOO_LARGE: 'ds_fp_error_large',
  DS_PLAN_TOO_SMALL: 'ds_fp_error_small',
  DS_PLAN_UNREADABLE: 'ds_fp_error_unreadable',
  DS_NOT_A_SUPPORTED_IMAGE: 'ds_fp_error_unreadable',
  DS_IMAGE_SIZE_UNREADABLE: 'ds_fp_error_unreadable',
  DS_READING_UNAVAILABLE: 'ds_fp_error_reading_unavailable',
  DS_BILLING_CONFIRMATION_REQUIRED: 'ds_fp_error_reading_unavailable',
  DS_PLAN_NOT_BUILDABLE: 'p2h_error_not_buildable',
  DS_AI_UNAVAILABLE: 'p2h_error_design',
  DS_AI_FAILED: 'p2h_error_design',
};

const INPUT = 'h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-3 text-[15px] text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const GEN_STAGES: readonly Stage[] = ['MEASURING', 'PLANNING', 'ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'CHECKING', 'PREPARING', 'FINALIZING'];

/** A drawing in feet and inches: sizes are shown in both. */
const isImperial = (doc: FloorPlanDocument | null) => !!doc && [
  ...(doc.texts ?? []).map((x) => x.text), ...doc.rooms.map((r) => r.dimensionText ?? ''), doc.scaleEvidence ?? '',
].some((s) => /\d\s*['′]|\bft\b|\bfeet\b/i.test(s));

export function FloorPlanFlow({
  userId, projectId, projectName, existing, resume, onBuilt, onDone, onCancel,
}: {
  userId: string;
  projectId: string;
  projectName: string;
  /** Recalibrating: start from this plan's review; rebuild the space only. */
  existing?: FloorPlanRecord | null;
  /** A plan whose path was left part-way (reload, closed tab): continue it. */
  resume?: FloorPlanRecord | null;
  onBuilt: (sourceId: string, metresPerPx: number) => void;
  /** The home is built: open its walkthrough on this version. */
  onDone: (versionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const recalibrating = !!existing;
  const start = existing ?? resume ?? null;
  const startFlow = latestFlow(start);
  const initialStep: Step = !start ? 'UPLOAD'
    : start.status === 'INTERPRETING' || start.status === 'UPLOADED' ? 'READING'
      : startFlow?.step === 'GENERATING' ? 'GENERATING'
        : startFlow?.step === 'DESIGN' ? 'DESIGN'
          : start.interpretation ? 'REVIEW' : 'UPLOAD';
  const [step, setStep] = useState<Step>(initialStep);
  const [plan, setPlan] = useState<FloorPlanRecord | null>(start);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'UPLOADING' | 'READING'>('READING');
  const [readingSince, setReadingSince] = useState<number>(() => Date.now());
  const last = start?.corrections?.[start.corrections.length - 1];
  const [decisions, setDecisions] = useState<ReviewDecisions>(last?.decisions ?? { rejected: [], roomKinds: {} });
  const [answers, setAnswers] = useState<PlanAnswer[]>(startFlow?.answers ?? []);
  const [anchors, setAnchors] = useState<Anchor[]>(last?.anchors ?? []);
  const [ceiling, setCeiling] = useState<string>(last?.ceilingM ? String(last.ceilingM) : '');
  const [prefs, setPrefs] = useState<DesignPreferences>(() => normalizePreferences(startFlow?.preferences ?? DEFAULT_PREFERENCES));
  const [stages, setStages] = useState<Record<Stage, StageStatus>>(freshStages);
  const [busy, setBusy] = useState(false);
  const [genFailed, setGenFailed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const timings = useRef<FlowTimings>({ ...(startFlow?.timings ?? {}) });
  const running = useRef(false);

  const reading = plan?.interpretation ?? null;
  const baseDoc = reading?.doc ?? null;
  const dims = reading?.dimensionStrings ?? [];
  const doc = useMemo(() => (baseDoc ? applyAnswers(baseDoc, answers) : null), [baseDoc, answers]);
  const constraints = useMemo(() => (doc ? solvePlan(doc, dims, answers) ?? reading?.understanding?.constraints ?? null : null), [doc, dims, answers, reading]);
  const questions = reading?.understanding?.questions ?? [];

  useEffect(() => {
    if (!plan?.object_key) return;
    signedUrls([plan.object_key], 1800).then((m) => setImageUrl(m.get(plan.object_key) ?? null)).catch(() => {});
  }, [plan?.object_key]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const fail = (e: unknown) => {
    const code = e instanceof DesignStudioError ? e.code : '';
    setError(t(ERROR_KEY[code] ?? 'ds_fp_error_generic'));
  };

  // ── Reading ────────────────────────────────────────────────────────────
  const onFile = async (file: File) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setStep('READING');
    setStage('UPLOADING');
    setReadingSince(Date.now());
    if (file.type.startsWith('image/')) setLocalPreview(URL.createObjectURL(file));
    try {
      const t0 = performance.now();
      const created = await uploadFloorPlan({ userId, projectId, file });
      timings.current.uploadMs = Math.round(performance.now() - t0);
      setPlan(created);
      setStage('READING');
      const t1 = performance.now();
      await interpretFloorPlan(created.id);
      const read = await getFloorPlan(created.id);
      if (!read?.interpretation) throw new DesignStudioError('DS_READING_FAILED');
      timings.current.analysisMs = Math.round(performance.now() - t1);
      timings.current.reviewReadyMs = Math.round(performance.now() - t0);
      setPlan(await saveFlow(read.id, { step: 'REVIEW', answers: [], timings: timings.current }));
      setStep('REVIEW');
    } catch (e) {
      fail(e);
      setStep('UPLOAD');
    } finally {
      running.current = false;
    }
  };

  // A reading still under way when the page was opened: wait for it.
  useEffect(() => {
    if (step !== 'READING' || running.current || !plan) return;
    let stop = false;
    const id = window.setInterval(async () => {
      const next = await getFloorPlan(plan.id).catch(() => null);
      if (stop || !next) return;
      if (next.status === 'INTERPRETED' && next.interpretation) { setPlan(next); setStep('REVIEW'); }
      else if (next.status === 'FAILED') { setError(t('ds_fp_error_generic')); setStep('UPLOAD'); }
    }, 3000);
    return () => { stop = true; window.clearInterval(id); };
  }, [step, plan, t]);

  // ── Review: every change kept, so a reload never loses it ───────────────
  const persist = useRef<number | null>(null);
  const keep = useCallback((patch: Parameters<typeof saveFlow>[1]) => {
    if (!plan) return;
    if (persist.current) window.clearTimeout(persist.current);
    persist.current = window.setTimeout(() => { void saveFlow(plan.id, patch).catch(() => {}); }, 700);
  }, [plan]);

  const estimate = useMemo(() => (doc ? estimateScale(doc, dims) : null), [doc, dims]);
  const calibration: Calibration | null = useMemo(() => {
    if (!doc) return null;
    if (anchors.length) return calibrate(doc, decisions, anchors, estimate);
    if (constraints) return { metresPerPx: constraints.metresPerPx, geometryState: 'ESTIMATED', uncertainty: constraints.uncertainty, conflict: false, implied: [] };
    return estimate ? calibrate(doc, decisions, [], estimate) : null;
  }, [doc, decisions, anchors, estimate, constraints]);
  const ceilingM = Number(ceiling) > 1.8 && Number(ceiling) < 8 ? Number(ceiling) : null;
  const ceilingFinal = ceilingM ?? doc?.ceilingHeight ?? DEFAULT_CEILING_M;
  const ceilingSource = ceilingM ? 'CUSTOMER' as const : doc?.ceilingHeight ? 'DRAWING' as const : 'TYPICAL' as const;

  const setAnchor = (next: Anchor | null, kind: Anchor['kind']) => {
    setAnchors((list) => {
      const rest = list.filter((a) => a.kind !== kind);
      const out = next ? [...rest, next] : rest;
      keep({ anchors: out });
      return out;
    });
  };
  const anchorValue = (kind: Anchor['kind']) => {
    const a = anchors.find((x) => x.kind === kind);
    if (!a) return '';
    return String(a.kind === 'WALL_LENGTH' ? a.valueM : a.valueM2);
  };

  const continueToDesign = async () => {
    if (!plan || !doc || busy) return;
    if (!calibration) { setProblems(['NO_SCALE']); return; }
    const check = buildCanonical(doc, decisions, calibration, ceilingFinal, ceilingSource);
    if (!check.ok) { setProblems(check.problems); return; }
    setProblems([]);
    setBusy(true);
    try {
      if (recalibrating) {
        await recordReview(plan, { decisions, anchors, ceilingM });
        const sourceId = await createFloorPlanSource({ floorplanId: plan.id, canonical: check.canonical, geometryState: calibration.geometryState, anchors });
        onBuilt(sourceId, calibration.metresPerPx);
        return;
      }
      setPlan(await saveFlow(plan.id, { step: 'DESIGN', answers, decisions, anchors, ceilingM }));
      setStep('DESIGN');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ── Generate: resumable; a double tap is one run ────────────────────────
  const generate = useCallback(async () => {
    if (!plan || !doc || !calibration || running.current) return;
    running.current = true;
    setBusy(true);
    setGenFailed(false);
    setError(null);
    setStep('GENERATING');
    setStages(() => {
      const s = freshStages();
      s.UNDERSTANDING = 'DONE';
      return s;
    });
    const mark = (s: Stage, st: 'RUNNING' | 'DONE' | 'SKIPPED') => setStages((cur) => ({ ...cur, [s]: st }));
    try {
      const fresh = await saveFlow(plan.id, { step: 'GENERATING', answers, preferences: prefs, decisions, anchors, ceilingM, timings: timings.current });
      setPlan(fresh);
      const result = await generateHome({
        userId, projectId, projectName, plan: fresh, doc, decisions, anchors, calibration,
        ceilingM: ceilingFinal, ceilingSource, preferences: prefs,
        versionName: (k) => t(k === 'original' ? 'ds_version_original' : k === 'design' ? 'p2h_version_design' : 'p2h_version_factory'),
        onStage: mark,
      });
      onDone(result.versionId);
    } catch (e) {
      setGenFailed(true);
      fail(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [plan, doc, calibration, answers, prefs, decisions, anchors, ceilingM, ceilingFinal, ceilingSource, userId, projectId, projectName, t, onDone]);

  // A generation that was running when the page was left: carry on.
  const resumed = useRef(false);
  useEffect(() => {
    if (step === 'GENERATING' && !resumed.current && !running.current && doc && calibration) {
      resumed.current = true;
      void generate();
    }
  }, [step, doc, calibration, generate]);

  const stepIndex = { UPLOAD: 0, READING: 0, REVIEW: 1, DESIGN: 2, GENERATING: 3 }[step];
  const stepKeys = recalibrating ? ['p2h_step_upload', 'p2h_step_confirm'] : ['p2h_step_upload', 'p2h_step_confirm', 'p2h_step_look', 'p2h_step_build'];

  const advanced = doc ? (
    <div className="space-y-3">
      <p className="text-[13px] text-[#4A5263]">{t('p2h_adjust_size_body')}</p>
      <label className="block text-[14px] font-medium">
        {t('ds_fp_anchor_total')}
        <input type="number" inputMode="decimal" min={5} max={2000} step="0.1" className={cn(INPUT, 'mt-1')} placeholder="82"
          value={anchorValue('TOTAL_AREA')}
          onChange={(e) => { const v = Number(e.target.value); setAnchor(v > 0 ? { kind: 'TOTAL_AREA', valueM2: v } : null, 'TOTAL_AREA'); }} />
      </label>
      <label className="block text-[14px] font-medium">
        {t('ds_fp_ceiling')}
        <input type="number" inputMode="decimal" min={2} max={6} step="0.01" className={cn(INPUT, 'mt-1')}
          placeholder={String(doc.ceilingHeight ?? DEFAULT_CEILING_M)} value={ceiling} onChange={(e) => { setCeiling(e.target.value); const v = Number(e.target.value); keep({ ceilingM: v > 1.8 && v < 8 ? v : null }); }} />
        {!ceilingM && !doc.ceilingHeight ? <span className="mt-1 block text-[13px] font-normal text-[#4A5263]">{t('ds_fp_ceiling_default')}</span> : null}
      </label>
      {calibration?.conflict ? <p className="text-[13px] font-medium text-[hsl(32_78%_34%)]">{t('ds_fp_conflict')}</p> : null}
    </div>
  ) : null;

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F4F5F7] text-[#0C1119]" data-testid="plan-to-home" data-step={step}>
      <header className="flex h-14 shrink-0 items-center gap-3 bg-[#0C1119] px-3 text-white">
        <button type="button" onClick={onCancel} aria-label={t('ds_action_cancel')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">{t('ds_fp_title')}</p>
          <p className="truncate font-display text-[15px] font-semibold">{projectName}</p>
        </div>
        <ol className="ms-auto flex items-center gap-1.5 text-[13px]" aria-label={t('ds_fp_steps')}>
          {stepKeys.map((key, i) => (
            <li key={key} aria-current={i === stepIndex ? 'step' : undefined} className="flex items-center gap-1.5">
              <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold', i < stepIndex ? 'bg-white/20 text-white' : i === stepIndex ? 'bg-[hsl(38_92%_56%)] text-[#0C1119]' : 'bg-white/10 text-white/50')}>{i + 1}</span>
              <span className={cn('hidden md:inline', i === stepIndex ? 'font-semibold text-white' : 'text-white/55')}>{t(key)}</span>
            </li>
          ))}
        </ol>
      </header>

      {step === 'UPLOAD' || step === 'READING' ? (
        <div className="grid flex-1 place-items-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-xl">
            {step === 'UPLOAD' ? (
              <>
                <h1 className="font-display text-2xl font-semibold">{t('p2h_upload_title')}</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-[#4A5263]">{t('p2h_upload_body')}</p>
                <label
                  className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#B8BFCA] bg-white px-6 py-14 text-center transition-colors hover:border-[#0C1119] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
                  data-testid="plan-drop"
                >
                  <Upload className="h-9 w-9 text-[#4A5263]" aria-hidden="true" />
                  <span className="text-[16px] font-semibold">{t('ds_fp_choose_file')}</span>
                  <span className="text-[13px] text-[#4A5263]">{t('ds_fp_file_types')}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} data-testid="plan-file" />
                </label>
              </>
            ) : (
              <ReadingView image={localPreview ?? imageUrl} stage={stage} since={readingSince} />
            )}
            {error ? <p role="alert" className="mt-4 rounded-lg bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
            <p className="mt-4 text-[13px] text-[#4A5263]">{t('ds_fp_privacy')}</p>
          </div>
        </div>
      ) : null}

      {step === 'REVIEW' && doc ? (
        <>
          <PlanReview
            doc={doc} imageUrl={imageUrl} constraints={constraints} questions={questions} answers={answers}
            rejected={decisions.rejected} imperial={isImperial(doc)} busy={busy} advanced={advanced}
            onChange={({ answers: a, rejected }) => {
              setAnswers(a);
              const d = { ...decisions, rejected };
              setDecisions(d);
              keep({ answers: a, decisions: d });
            }}
            onContinue={() => { void continueToDesign(); }}
          />
          {problems.length || error ? (
            <p role="alert" className="fixed inset-x-4 bottom-24 z-10 mx-auto max-w-md rounded-lg bg-[hsl(0_66%_44%)] px-4 py-3 text-[14px] text-white shadow-lg lg:bottom-6">
              {error ?? `${t('ds_fp_build_problems')} ${problems.map((p) => t(`ds_fp_problem_${p.toLowerCase()}`)).join(' · ')}`}
            </p>
          ) : null}
        </>
      ) : null}

      {step === 'DESIGN' ? (
        <DesignChooser
          value={prefs}
          onChange={(p) => { setPrefs(p); keep({ preferences: p }); }}
          onGenerate={() => { void generate(); }}
          busy={busy}
          onBack={() => { setStep('REVIEW'); keep({ step: 'REVIEW' }); }}
        />
      ) : null}

      {step === 'GENERATING' ? (
        <div className="grid flex-1 place-items-center overflow-y-auto px-4 py-8" data-testid="plan-generating">
          <div className="w-full max-w-md space-y-5">
            <GenerationStages stages={stages} title={t('p2h_generating_title')} only={GEN_STAGES}
              since={startFlow?.startedAt ? Date.parse(startFlow.startedAt) : undefined} />
            <p className="text-center text-[13px] text-[#4A5263]">{t('p2h_generating_leave')}</p>
            {genFailed ? (
              <div className="space-y-3 text-center">
                {error ? <p role="alert" className="rounded-lg bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
                <button type="button" onClick={() => { void generate(); }} disabled={busy}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0C1119] px-5 text-[15px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                  data-testid="plan-retry">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('p2h_retry')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {(step === 'REVIEW' || step === 'DESIGN' || step === 'GENERATING') && !doc ? (
        <div className="grid flex-1 place-items-center text-[#4A5263]"><FileImage className="h-8 w-8" aria-hidden="true" /></div>
      ) : null}
    </div>
  );
}

/** Reading: the customer's own drawing, being read — real stages, real time, no percentages. */
function ReadingView({ image, stage, since }: { image: string | null; stage: 'UPLOADING' | 'READING'; since: number }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div className="space-y-5" role="status" aria-live="polite" data-testid="plan-reading">
      <h1 className="font-display text-2xl font-semibold">{t('p2h_reading_title')}</h1>
      <div className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
        {image ? <img src={image} alt="" className="mx-auto max-h-[46dvh] w-auto object-contain opacity-90" /> : <div className="h-56" />}
        <div className="hm-plan-scan pointer-events-none absolute inset-x-0 h-24" aria-hidden="true" />
      </div>
      <ol className="space-y-2 text-[15px]">
        {([['UPLOADING', 'p2h_stage_upload'], ['READING', 'p2h_stage_read']] as const).map(([s, key]) => {
          const order = ['UPLOADING', 'READING'];
          const at = order.indexOf(stage); const i = order.indexOf(s);
          return (
            <li key={s} className={cn('flex items-center gap-2', i < at ? 'text-[#4A5263]' : i === at ? 'font-medium' : 'text-[#9AA1AD]')}>
              {i === at ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="inline-block h-4 w-4 text-center text-[hsl(152_55%_38%)]">{i < at ? '✓' : ''}</span>}
              {t(key)}
            </li>
          );
        })}
      </ol>
      <p className="text-[13px] text-[#4A5263]">{t('p2h_reading_hint', { s: String(secs) })}</p>
    </div>
  );
}
