// FROM A FLOOR PLAN TO A PHOTOREALISTIC HOME — the customer's path.
//
//   1. Upload      PNG / JPEG / WebP, or a PDF (page 1 is rendered here); the
//                  plan is shown back ("ready") before anything is sent
//   2. Understand  HOMATCH reads the drawing and checks it against itself —
//                  SERVER-OWNED (floorplan.ts): leaving the page never stops it,
//                  a failure says whether trying again (no upload) can help
//   3. (Ask)       ONE quick question at a time, and only when HOMATCH's own
//                  evidence is genuinely weak (quickQuestions.ts) — otherwise
//                  the reading goes straight on. The full review of the plan
//                  is always one link away ("Review plan in detail").
//   4. Style       six looks, one tap
//   5. Quality     Smart budget / High quality / Premium, the price, Generate.
//                  "Customise details" opens the detailed look (DesignChooser).
//   6. Generate    OpenAI-first (planToHome.ts generateHome → designRun.ts): the
//                  architecture cached by its key, then the server owns the rest —
//                  OpenAI's Design Specification, the design version, ONE
//                  photorealistic master picture and its edit map. No Blender;
//                  resumable from anywhere; never paid for twice. Snake on request.
//   7. Result      the home opens on its photorealistic picture
//
// Every step is kept on the plan's review entry, so a reload lands where the
// customer was. Recalibrating an existing space uses the detailed review and
// rebuilds the space only (no new design).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileImage } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import {
  buildCanonical, calibrate, DEFAULT_CEILING_M, estimateScale, type Anchor, type Calibration, type ReviewDecisions,
} from '@/lib/designStudio/scale';
import { applyAnswers, solvePlan } from '@/lib/designStudio/planRead';
import {
  DEFAULT_PREFERENCES, normalizePreferences, type DesignPreferences, type FlowTimings, type PlanAnswer,
} from '@/lib/designStudio/planToHome';
import { lookPreferences, readLook, type LookQuality, type LookStyle } from '@/lib/designStudio/lookPresets';
import { necessaryQuestions } from '@/lib/designStudio/quickQuestions';
import { freshStages, type StageStatus } from '@/components/designStudio/GenerationStages';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import { DesignStudioError } from '@/services/designStudio/projects';
import { DesignStudioFailure } from '@/services/designStudio/durable';
import type { RunStage } from '@/services/designStudio/designRun';
import {
  createFloorPlanSource, getFloorPlan, interpretFloorPlan, recordReview, uploadFloorPlan, type FloorPlanRecord,
} from '@/services/designStudio/floorplans';
import { generateHome, latestFlow, prepareArchitecture, saveFlow, type FlowRecord } from '@/services/designStudio/planToHome';
import { quoteRender } from '@/services/designStudio/renders';
import type { RenderQuote } from '@/lib/designStudio/renders/contract';
import { signedUrls } from '@/services/designStudio/files';
import { cn } from '@/lib/utils';
import { PlanReview } from './planToHome/PlanReview';
import { DesignChooser } from './planToHome/DesignChooser';
import { QualityStep, QuickQuestionStep, RING, StyleStep, SURFACE } from './planToHome/SimpleSteps';
import { AnalysisStep, FailureStep, GeneratingStep, PlanUploadStep, READING_RECOVERY, type Recovery, useReadyResult } from './unified/Screens';

/**
 * PREPARING is the understanding screen while the confirmed reading becomes the
 * home's architecture (cached by its key, so a reload re-enters it for free).
 */
type Step = 'UPLOAD' | 'READING' | 'READ_FAILED' | 'QUICK' | 'REVIEW' | 'PREPARING' | 'STYLE' | 'QUALITY' | 'CUSTOM' | 'GENERATING';
type SavePatch = Parameters<typeof saveFlow>[1];

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
  DS_PRICE_CHANGED: 'dsx_price_changed',
  DS_INSUFFICIENT_CREDITS: 'dsx_no_credits',
  DS_SOURCE_MISSING: 'p2h_error_not_buildable',
  DS_RENDER_FAILED: 'sf_error_render',
  DS_RATE_LIMITED: 'sf_error_busy',
};

/** The customer's three stages, from the detailed ones the generation reports. */
function runStageOf(stages: Record<Stage, StageStatus>): RunStage {
  if (stages.CHECKING === 'RUNNING' || stages.CHECKING === 'DONE' || stages.PREPARING === 'RUNNING') return 'RESULT';
  if (stages.FURNISHING === 'RUNNING' || stages.FURNISHING === 'DONE') return 'IMAGE';
  return 'DESIGN';
}

const INPUT = 'h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-3 text-[15px] text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';

/** A drawing in feet and inches: sizes are shown in both. */
const isImperial = (doc: FloorPlanDocument | null) => !!doc && [
  ...(doc.texts ?? []).map((x) => x.text), ...doc.rooms.map((r) => r.dimensionText ?? ''), doc.scaleEvidence ?? '',
].some((s) => /\d\s*['′]|\bft\b|\bfeet\b/i.test(s));

/** Where a saved flow resumes. The reading's own questions decide QUICK vs straight on. */
function resumeStep(plan: FloorPlanRecord | null, flow: FlowRecord | null, recalibrating: boolean): Step {
  if (!plan) return 'UPLOAD';
  if (plan.status === 'INTERPRETING' || plan.status === 'UPLOADED') return 'READING';
  if (plan.status === 'FAILED') return 'READ_FAILED';
  if (!plan.interpretation) return 'UPLOAD';
  if (recalibrating) return 'REVIEW';
  if (flow?.step === 'GENERATING') return 'GENERATING';
  if (flow?.step === 'DESIGN') return flow.lookStep === 'QUALITY' ? 'QUALITY' : flow.lookStep === 'CUSTOM' ? 'CUSTOM' : 'STYLE';
  if (flow?.review === 'DETAIL') return 'REVIEW';
  const asked = necessaryQuestions(plan.interpretation.understanding?.questions ?? [], flow?.answers ?? []);
  return asked.length ? 'QUICK' : 'PREPARING';
}

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
  /** The home is built: open it on this version. */
  onDone: (versionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const recalibrating = !!existing;
  const start = existing ?? resume ?? null;
  const startFlow = latestFlow(start);
  const [step, setStep] = useState<Step>(() => resumeStep(start, startFlow, recalibrating));
  const [plan, setPlan] = useState<FloorPlanRecord | null>(start);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A reading that failed: worth trying again (the plan is kept), or another file. */
  const [readFail, setReadFail] = useState<{ retryable: boolean } | null>(() => (start?.status === 'FAILED' ? { retryable: !/^TERMINAL:/.test(start.interpretation_error ?? '') } : null));
  /** The finished design (generation): the result opens on it. */
  const [doneVersion, setDoneVersion] = useState<string | null>(null);
  const last = start?.corrections?.[start.corrections.length - 1];
  const [decisions, setDecisions] = useState<ReviewDecisions>(last?.decisions ?? { rejected: [], roomKinds: {} });
  const [answers, setAnswers] = useState<PlanAnswer[]>(startFlow?.answers ?? []);
  const [anchors, setAnchors] = useState<Anchor[]>(last?.anchors ?? []);
  const [ceiling, setCeiling] = useState<string>(last?.ceilingM ? String(last.ceilingM) : '');
  const savedLook = readLook(startFlow?.look);
  const [style, setStyle] = useState<LookStyle | null>(savedLook?.style ?? null);
  const [quality, setQuality] = useState<LookQuality | null>(savedLook?.quality ?? 'HIGH_QUALITY');
  /** The detailed look — only the customer's own when they opened "Customise details". */
  const [prefs, setPrefs] = useState<DesignPreferences>(() => normalizePreferences(startFlow?.preferences ?? DEFAULT_PREFERENCES));
  const [stages, setStages] = useState<Record<Stage, StageStatus>>(freshStages);
  const [busy, setBusy] = useState(false);
  const [genFailure, setGenFailure] = useState<{ retryable: boolean; message: string | null } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  /* The master design's price, quoted by the server for this home and shown before Generate. */
  const [quote, setQuote] = useState<RenderQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const timings = useRef<FlowTimings>({ ...(startFlow?.timings ?? {}) });
  const running = useRef(false);

  const reading = plan?.interpretation ?? null;
  const baseDoc = reading?.doc ?? null;
  const dims = reading?.dimensionStrings ?? [];
  const doc = useMemo(() => (baseDoc ? applyAnswers(baseDoc, answers) : null), [baseDoc, answers]);
  const constraints = useMemo(() => (doc ? solvePlan(doc, dims, answers) ?? reading?.understanding?.constraints ?? null : null), [doc, dims, answers, reading]);
  const questions = useMemo(() => reading?.understanding?.questions ?? [], [reading]);
  const quick = useMemo(() => necessaryQuestions(questions, answers), [questions, answers]);
  const quickTotal = useMemo(() => necessaryQuestions(questions, []).length, [questions]);

  useEffect(() => {
    if (!plan?.object_key) return;
    signedUrls([plan.object_key], 1800).then((m) => setImageUrl(m.get(plan.object_key) ?? null)).catch(() => {});
  }, [plan?.object_key]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const fail = (e: unknown) => {
    const code = e instanceof DesignStudioError ? e.code : '';
    setError(t(ERROR_KEY[code] ?? 'ds_fp_error_generic'));
  };

  // ── Saving: one write at a time, so two quick steps never overwrite each other ──
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const persistNow = useCallback((patch: SavePatch) => {
    if (!plan) return;
    const id = plan.id;
    queue.current = queue.current.then(() => saveFlow(id, patch)).catch(() => {});
  }, [plan]);
  const persist = useRef<number | null>(null);
  const keep = useCallback((patch: SavePatch) => {
    if (!plan) return;
    if (persist.current) window.clearTimeout(persist.current);
    persist.current = window.setTimeout(() => persistNow(patch), 700);
  }, [plan, persistNow]);

  /** After the reading: ask only what HOMATCH genuinely needs, else go straight on. */
  const afterReading = (read: FloorPlanRecord, given: PlanAnswer[]) => {
    if (recalibrating) { setStep('REVIEW'); return; }
    const asked = necessaryQuestions(read.interpretation?.understanding?.questions ?? [], given);
    setStep(asked.length ? 'QUICK' : 'PREPARING');
  };

  // ── Reading: the server owns it; this page only watches ──────────────────
  const watching = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => () => { if (watching.current) watching.current.cancelled = true; }, []);
  const watchReading = async (planId: string, retry: boolean) => {
    const signal = { cancelled: false };
    watching.current = signal;
    const t1 = performance.now();
    try {
      await interpretFloorPlan(planId, { retry, signal });
      const read = await getFloorPlan(planId);
      if (!read?.interpretation) throw new DesignStudioFailure('READING_FAILED', true);
      timings.current.analysisMs = Math.round(performance.now() - t1);
      const asked = necessaryQuestions(read.interpretation.understanding?.questions ?? [], []);
      const given = latestFlow(read)?.answers ?? [];
      const saved = latestFlow(read) ? read : await saveFlow(read.id, { step: 'REVIEW', answers: [], timings: timings.current, review: asked.length ? 'QUICK' : 'AUTO' });
      setAnswers(given);
      setPlan(saved);
      afterReading(saved, given);
    } catch (e) {
      if (signal.cancelled) return;
      if (e instanceof DesignStudioFailure) { setReadFail({ retryable: e.retryable }); setStep('READ_FAILED'); return; }
      // Still working after a long wait (or the connection is gone): keep watching quietly.
      if (e instanceof DesignStudioError && e.code === 'DS_STILL_WORKING') { window.setTimeout(() => { if (!signal.cancelled) void watchReading(planId, false); }, 5000); return; }
      fail(e);
      setStep('UPLOAD');
    }
  };

  const onFile = async (file: File) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setReadFail(null);
    setBusy(true);
    try {
      const t0 = performance.now();
      const created = await uploadFloorPlan({ userId, projectId, file });
      timings.current.uploadMs = Math.round(performance.now() - t0);
      if (file.type.startsWith('image/')) setLocalPreview(URL.createObjectURL(file));
      setPlan(created);
      setStep('READING');
    } catch (e) {
      fail(e);
      setStep('UPLOAD');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  // Reading (just started, after a reload, or on another device): watch it to its end.
  const retryNext = useRef(false);
  useEffect(() => {
    if (step !== 'READING' || !plan) return;
    const retry = retryNext.current;
    retryNext.current = false;
    void watchReading(plan.id, retry);
    return () => { if (watching.current) watching.current.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one watch per READING entry
  }, [step, plan?.id]);

  const retryReading = async () => {
    if (!plan || busy) return;
    setReadFail(null);
    // The plan is already the server's: asked again (the next watch carries the retry), nothing is uploaded.
    retryNext.current = true;
    setStep('READING');
  };

  // ── Scale and the detailed review's controls ────────────────────────────
  const estimate = useMemo(() => (doc ? estimateScale(doc, dims) : null), [doc, dims]);
  const calibration: Calibration | null = useMemo(() => {
    if (!doc) return null;
    if (anchors.length) return calibrate(doc, decisions, anchors, estimate);
    if (constraints) return { metresPerPx: constraints.metresPerPx, geometryState: 'ESTIMATED', uncertainty: constraints.uncertainty, conflict: false, implied: [] };
    return estimate ? calibrate(doc, decisions, [], estimate) : null;
  }, [doc, decisions, anchors, estimate, constraints]);
  const ceilingM = Number(ceiling) > 1.8 && Number(ceiling) < 8 ? Number(ceiling) : null;
  const ceilingFinal = ceilingM ?? doc?.ceilingHeight ?? DEFAULT_CEILING_M;
  // An unmeasured ceiling is recorded as typical, never as a fact.
  const ceilingSource: 'CUSTOMER' | 'DRAWING' | 'TYPICAL' = ceilingM ? 'CUSTOMER' : doc?.ceilingHeight ? 'DRAWING' : 'TYPICAL';

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

  const requestQuote = useCallback(async (versionId: string) => {
    setQuoteFailed(false);
    const q = await quoteRender({ projectId, versionId, product: 'DS_MASTER_RENDER', views: 1 });
    setQuote(q.quote);
    setQuoteFailed(!q.quote);
  }, [projectId]);

  /**
   * The confirmed reading becomes the home's architecture (cached by its key:
   * the same reading never builds it twice). `auto`: nobody pressed anything,
   * so a plan that cannot be built opens the detailed review instead of failing.
   */
  const continueToDesign = async (auto = false) => {
    if (!plan || !doc || busy) return;
    if (!calibration) { setProblems(['NO_SCALE']); if (auto) setStep('REVIEW'); return; }
    const check = buildCanonical(doc, decisions, calibration, ceilingFinal, ceilingSource);
    if (!check.ok) { setProblems(check.problems); if (auto) setStep('REVIEW'); return; }
    setProblems([]);
    setBusy(true);
    try {
      if (recalibrating) {
        await recordReview(plan, { decisions, anchors, ceilingM });
        const sourceId = await createFloorPlanSource({ floorplanId: plan.id, canonical: check.canonical, geometryState: calibration.geometryState, anchors });
        onBuilt(sourceId, calibration.metresPerPx);
        return;
      }
      await queue.current;
      await saveFlow(plan.id, { answers, decisions, anchors, ceilingM });
      const arch = await prepareArchitecture({
        userId, projectId, plan, doc, decisions, anchors, calibration, ceilingM: ceilingFinal, ceilingSource, answers,
        versionName: (k) => t(k === 'original' ? 'ds_version_original' : k === 'design' ? 'p2h_version_design' : 'p2h_version_factory'),
      });
      setPlan(await saveFlow(plan.id, { step: 'DESIGN', lookStep: 'STYLE' }));
      setStep('STYLE');
      void requestQuote(arch.originalId);
    } catch (e) {
      fail(e);
      if (auto) setStep('REVIEW');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to ask (or the last quick answer given): build the architecture on its own, once per entry.
  const preparing = useRef(false);
  useEffect(() => {
    if (step !== 'PREPARING') { preparing.current = false; return; }
    if (preparing.current || busy || !doc) return;
    preparing.current = true;
    void continueToDesign(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per PREPARING entry
  }, [step, doc, busy]);

  // A quick step with nothing left to ask goes straight on.
  useEffect(() => { if (step === 'QUICK' && reading && !quick.length) setStep('PREPARING'); }, [step, reading, quick.length]);

  // A reload on Style / Quality quotes again (a quote lives ten minutes).
  useEffect(() => {
    if (!(step === 'STYLE' || step === 'QUALITY' || step === 'CUSTOM') || quote || quoteFailed) return;
    const original = latestFlow(plan)?.originalVersionId;
    if (original) void requestQuote(original);
  }, [step, quote, quoteFailed, plan, requestQuote]);

  // ── The quick question ──────────────────────────────────────────────────
  const answerQuick = (a: PlanAnswer) => {
    if (busy) return;
    const next = [...answers.filter((x) => x.questionId !== a.questionId), a];
    setAnswers(next);
    persistNow({ answers: next, review: 'QUICK' });
    if (!necessaryQuestions(questions, next).length) setStep('PREPARING');
  };
  const openDetail = () => {
    setError(null);
    setStep('REVIEW');
    persistNow({ step: 'REVIEW', review: 'DETAIL' });
  };

  // ── Style → Quality → (Customise) ───────────────────────────────────────
  const goStyle = () => { setStep('STYLE'); persistNow({ lookStep: 'STYLE' }); };
  const goQuality = () => {
    if (!style) return;
    const q = quality ?? 'HIGH_QUALITY';
    setQuality(q);
    setStep('QUALITY');
    persistNow({ lookStep: 'QUALITY', look: { style, quality: q }, preferences: lookPreferences(style, q) });
  };
  const goCustom = () => {
    if (!style || !quality) return;
    // The detailed look starts from what the two choices produced.
    const p = lookPreferences(style, quality);
    setPrefs(p);
    setStep('CUSTOM');
    persistNow({ lookStep: 'CUSTOM', preferences: p });
  };
  /** What Generate sends from Quality: exactly what Style × Quality produced. */
  const chosen = (): DesignPreferences | null => (style && quality ? lookPreferences(style, quality) : null);

  // ── Generate: resumable; a double tap is one run ────────────────────────
  const generate = useCallback(async (preferences: DesignPreferences | null, retry = false) => {
    if (!plan || !doc || !calibration || running.current || !preferences) return;
    running.current = true;
    setBusy(true);
    setGenFailure(null);
    setError(null);
    setStep('GENERATING');
    setStages(() => {
      const s = freshStages();
      s.UNDERSTANDING = 'DONE';
      return s;
    });
    const mark = (s: Stage, st: 'RUNNING' | 'DONE' | 'SKIPPED') => setStages((cur) => ({ ...cur, [s]: st }));
    try {
      await queue.current;
      const fresh = await saveFlow(plan.id, {
        step: 'GENERATING', answers, preferences, decisions, anchors, ceilingM, timings: timings.current,
        ...(style && quality ? { look: { style, quality } } : {}), ...(quote ? { confirmedCredits: quote.credits } : {}),
      });
      setPlan(fresh);
      const result = await generateHome({
        userId, projectId, projectName, plan: fresh, doc, decisions, anchors, calibration,
        ceilingM: ceilingFinal, ceilingSource, preferences, look: style && quality ? { style, quality } : null, retry,
        confirmedCredits: quote?.credits ?? latestFlow(fresh)?.confirmedCredits ?? null,
        versionName: (k) => t(k === 'original' ? 'ds_version_original' : k === 'design' ? 'p2h_version_design' : 'p2h_version_factory'),
        onStage: mark,
      });
      setDoneVersion(result.versionId);
    } catch (e) {
      if (e instanceof DesignStudioError && (e.code === 'DS_STILL_WORKING' || e.code === 'DS_WATCH_STOPPED')) return;
      const code = e instanceof DesignStudioError ? e.code : '';
      // What the server confirmed on the way (the specification) is in the plan's record: the recovery shows it.
      const stored = await getFloorPlan(plan.id).catch(() => null);
      if (stored) setPlan(stored);
      // The plan was already read and accepted: a failed design is technical — always "try again", never "a clearer plan".
      setGenFailure({ retryable: true, message: ERROR_KEY[code] ? t(ERROR_KEY[code]) : null });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [plan, doc, calibration, answers, decisions, anchors, ceilingM, ceilingFinal, ceilingSource, userId, projectId, projectName, t, quote, style, quality]);

  /** A retry or a resumed run uses exactly what was saved when Generate was pressed. */
  const savedPrefs = (): DesignPreferences => {
    const saved = latestFlow(plan)?.preferences;
    return saved ? normalizePreferences(saved) : chosen() ?? prefs;
  };

  // A generation that was running when the page was left: carry on.
  const resumed = useRef(false);
  useEffect(() => {
    if (step === 'GENERATING' && !resumed.current && !running.current && doc && calibration) {
      resumed.current = true;
      void generate(savedPrefs());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedPrefs reads the plan of this render
  }, [step, doc, calibration, generate]);

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

  const genSince = useRef(Date.now());
  const onViewResult = useCallback(() => { if (doneVersion) onDone(doneVersion); }, [doneVersion, onDone]);
  // A failure keeps every finished step on the server: the recovery says which (the specification is recorded once it succeeded).
  const readyVersion = useReadyResult(projectId, step === 'READ_FAILED' || !!genFailure);
  const genRecovery: Recovery = latestFlow(plan)?.specJobId
    ? { done: ['UPLOAD', 'ANALYSIS', 'DESIGN'], resumeAt: 'IMAGE' }
    : { done: ['UPLOAD', 'ANALYSIS'], resumeAt: 'DESIGN' };
  const openProject = readyVersion ? () => onDone(readyVersion) : undefined;

  const needsDoc = step === 'QUICK' || step === 'REVIEW' || step === 'STYLE' || step === 'QUALITY' || step === 'CUSTOM' || step === 'GENERATING';
  const current = quick[0] ?? null;

  return (
    <div className={cn('flex h-[100dvh] flex-col', SURFACE)} data-testid="plan-to-home" data-step={step}>
      <header className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-6">
        <button type="button" onClick={onCancel} aria-label={t('ds_action_cancel')}
          className={cn('grid h-11 w-11 place-items-center rounded-full text-[#0C1119] hover:bg-black/5', RING)} data-testid="plan-cancel">
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
        <p className="min-w-0 truncate font-display text-[15px] font-semibold">{projectName}</p>
      </header>

      {step === 'UPLOAD' ? <PlanUploadStep onContinue={(f) => { void onFile(f); }} error={error} busy={busy} /> : null}

      {step === 'READING' || step === 'PREPARING' ? (
        <AnalysisStep source="PLAN" images={[localPreview ?? imageUrl].filter((u): u is string => !!u)} />
      ) : null}

      {step === 'READ_FAILED' ? (
        <FailureStep source="PLAN" retryable={readFail?.retryable !== false} message={null} busy={busy} recovery={READING_RECOVERY} onOpenProject={openProject}
          onRetry={() => { void retryReading(); }} onLater={onCancel} onChooseFile={() => { setPlan(null); setReadFail(null); setStep('UPLOAD'); }} />
      ) : null}

      {step === 'QUICK' && doc && current ? (
        <QuickQuestionStep question={current} index={Math.max(0, quickTotal - quick.length)} total={quickTotal}
          doc={doc} imageUrl={imageUrl} onAnswer={answerQuick} onDetail={openDetail} busy={busy} />
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

      {step === 'STYLE' ? (
        <StyleStep value={style} onChange={(s) => { setStyle(s); persistNow({ look: { style: s, quality: quality ?? 'HIGH_QUALITY' } }); }}
          onNext={goQuality} onDetail={openDetail} />
      ) : null}

      {step === 'QUALITY' ? (
        <QualityStep value={quality}
          onChange={(q) => { setQuality(q); if (style) persistNow({ look: { style, quality: q }, preferences: lookPreferences(style, q) }); }}
          onBack={goStyle} onGenerate={() => { void generate(chosen()); }} onCustomize={goCustom}
          busy={busy} price={quote ? { credits: quote.credits, charged: quote.charged } : null} priceUnavailable={quoteFailed}
          onRetryPrice={() => { const o = latestFlow(plan)?.originalVersionId; if (o) void requestQuote(o); }} />
      ) : null}

      {step === 'CUSTOM' ? (
        <DesignChooser
          value={prefs}
          onChange={(p) => { setPrefs(p); keep({ preferences: p }); }}
          onGenerate={() => { void generate(prefs); }}
          busy={busy}
          price={quote ? { credits: quote.credits, charged: quote.charged } : null}
          priceUnavailable={quoteFailed}
          onBack={() => { setStep('QUALITY'); persistNow({ lookStep: 'QUALITY' }); }}
        />
      ) : null}

      {step === 'GENERATING' ? (
        <GeneratingStep source="PLAN" stage={runStageOf(stages)} since={startFlow?.startedAt ? Date.parse(startFlow.startedAt) : genSince.current}
          done={!!doneVersion} failure={genFailure} busy={busy} recovery={genRecovery} onOpenProject={openProject}
          onView={onViewResult} onRetry={() => { void generate(savedPrefs(), true); }} onLater={onCancel}
          onChooseFile={() => { setPlan(null); setGenFailure(null); setStep('UPLOAD'); }} />
      ) : null}

      {needsDoc && !doc ? (
        <div className="grid flex-1 place-items-center text-[#4A5263]"><FileImage className="h-8 w-8" aria-hidden="true" /></div>
      ) : null}
    </div>
  );
}
