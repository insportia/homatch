// FROM THE CUSTOMER'S PHOTOS TO THEIR NEW DESIGN — OpenAI-first, server-owned.
//
//   1. Upload     up to six photos, looked over before anything is sent
//   2. Analysis   ONE OpenAI reading of every photo (photos.ts): same room from
//                 several angles vs different rooms, the fixed architecture,
//                 only the questions that matter. The server owns it.
//   3. (Detail)   one question at a time, only when the reading asked one
//   4. Style      the look
//   5. Quality    the tier and its price (quoted by the server)
//   6. Generate   designRun.ts: the specification, the design version and the
//                 master picture drawn over the customer's own photo, all owned
//                 by the server; Snake if the customer wants it
//   7. Result     the design opens (DesignStudioHomePage)
//
// No reconstruction, no catalogue, no Blender, no RunPod and no 3D editor on
// this path. Where the customer is lives on the reconstruction row
// (corrections.flow), so a reload, a closed tab or another device opens the
// right screen, and finished work is never asked for again.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { lookPreferences, readLook, type LookQuality, type LookStyle } from '@/lib/designStudio/lookPresets';
import { stableJson } from '@/lib/designStudio/stableJson';
import { openQuestions, resumeStep, type PhotoAnswer, type PhotoFlowRecord } from '@/lib/designStudio/photoProject';
import type { RenderQuote } from '@/lib/designStudio/renders/contract';
import { DesignStudioError } from '@/services/designStudio/errors';
import { DesignStudioFailure } from '@/services/designStudio/durable';
import { runDesign, type RunStage } from '@/services/designStudio/designRun';
import { quoteRender } from '@/services/designStudio/renders';
import { signedUrls } from '@/services/designStudio/files';
import { referencesById, type ReconstructionRecord } from '@/services/designStudio/reconstructions';
import { flowOf, planFromPhotos, savePhotoFlow, startPhotoProject, understandingOf, understandPhotos, uploadPhotos } from '@/services/designStudio/photos';
import type { FloorPlanRecord } from '@/services/designStudio/floorplans';
import { QualityStep, RING, StyleStep, SURFACE } from '../planToHome/SimpleSteps';
import { AnalysisStep, DetailQuestionStep, FailureStep, GeneratingStep, PhotoUploadStep, READING_RECOVERY, type Recovery, useReadyResult } from './Screens';

type Step = 'UPLOAD' | 'READING' | 'FAILED' | 'QUESTION' | 'STYLE' | 'QUALITY' | 'GENERATING';

const ERROR_KEY: Record<string, string> = {
  DS_PRICE_CHANGED: 'dsx_price_changed',
  DS_INSUFFICIENT_CREDITS: 'dsx_no_credits',
  DS_RATE_LIMITED: 'sf_error_busy',
  DS_TOO_MANY_REFERENCES: 'dsx_pu_too_many',
};

const sha16 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);

function initialStep(r: ReconstructionRecord | null): Step {
  if (!r) return 'UPLOAD';
  const u = understandingOf(r);
  const flow = flowOf(r);
  const step = resumeStep({ status: r.status, understood: !!u && !!r.built_version_id, flow, questionsLeft: openQuestions(u, flow?.answers ?? []).length });
  return step === 'DONE' ? 'GENERATING' : step;
}

export function PhotoFlow({ userId, projectId, projectName, resume, onDone, onCancel, onFloorPlan }: {
  userId: string;
  projectId: string;
  projectName: string;
  /** The project's photo work, when the page was opened on a project already under way. */
  resume: ReconstructionRecord | null;
  onDone: (versionId: string) => void;
  /** What was uploaded is a floor plan: continue in the floor-plan flow with the same file (nothing uploaded again). */
  onFloorPlan: (plan: FloorPlanRecord) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useLanguage();
  const [recon, setRecon] = useState<ReconstructionRecord | null>(resume);
  const [step, setStep] = useState<Step>(() => initialStep(resume));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [localUrls, setLocalUrls] = useState<string[]>([]);
  const [readFail, setReadFail] = useState<{ retryable: boolean } | null>(() => (resume?.status === 'FAILED' ? { retryable: !/^TERMINAL:/.test(resume.error ?? '') } : null));
  const savedLook = readLook(flowOf(resume)?.look);
  const [style, setStyle] = useState<LookStyle | null>(savedLook?.style ?? null);
  const [quality, setQuality] = useState<LookQuality | null>(savedLook?.quality ?? 'HIGH_QUALITY');
  const [answers, setAnswers] = useState<PhotoAnswer[]>(flowOf(resume)?.answers ?? []);
  const [quote, setQuote] = useState<RenderQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [stage, setStage] = useState<RunStage>('DESIGN');
  const [doneVersion, setDoneVersion] = useState<string | null>(null);
  const [genFailure, setGenFailure] = useState<{ retryable: boolean; message: string | null } | null>(null);
  const running = useRef(false);
  const watching = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => () => { if (watching.current) watching.current.cancelled = true; }, []);
  useEffect(() => () => { localUrls.forEach((u) => URL.revokeObjectURL(u)); }, [localUrls]);

  const u = understandingOf(recon);
  const flow = flowOf(recon);
  const open = useMemo(() => openQuestions(u, answers), [u, answers]);
  const originalId = recon?.built_version_id ?? null;

  // The customer's photos (short-lived URLs), in upload order.
  useEffect(() => {
    if (!recon) return;
    let stop = false;
    void referencesById(recon.reference_ids).then(async (refs) => {
      const keys = refs.map((r) => r.object_key);
      const m = await signedUrls(keys, 1800);
      if (!stop) setUrls(keys.map((k) => m.get(k) ?? '').filter(Boolean));
    }).catch(() => {});
    return () => { stop = true; };
  }, [recon?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const images = urls.length ? urls : localUrls;

  const save = useCallback(async (patch: Partial<PhotoFlowRecord>) => {
    if (!recon) return;
    try { setRecon(await savePhotoFlow(recon, patch)); } catch { /* the flow record is a convenience; the server's state is the truth */ }
  }, [recon]);

  // ── 1. Upload ────────────────────────────────────────────────────────
  const onPhotos = async (files: File[]) => {
    if (running.current || !files.length) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setLocalUrls(files.map((f) => URL.createObjectURL(f)));
    try {
      const refs = await uploadPhotos({ userId, projectId, files, onEach: (n, total) => setProgress({ n, total }) });
      const created = await startPhotoProject({ userId, projectId, referenceIds: refs.map((r) => r.id) });
      setRecon(created);
      setAnswers([]);
      setStep('READING');
    } catch (e) {
      const code = e instanceof DesignStudioError ? e.code : '';
      setError(t(ERROR_KEY[code] ?? 'ds_fp_error_generic'));
    } finally {
      running.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  // ── 2. Analysis: the server owns it; this page only watches ───────────
  const retryNext = useRef(false);
  const [readTick, setReadTick] = useState(0);
  useEffect(() => {
    if (step !== 'READING' || !recon) return;
    const signal = { cancelled: false };
    watching.current = signal;
    const retry = retryNext.current;
    retryNext.current = false;
    const watch = async () => {
      try {
        const read = await understandPhotos(recon.id, { language: lang, originalName: t('ds_version_original'), retry, signal });
        if (signal.cancelled) return;
        setRecon(read);
        const left = openQuestions(understandingOf(read), flowOf(read)?.answers ?? []);
        const next: Step = left.length ? 'QUESTION' : 'STYLE';
        setStep(next);
        void savePhotoFlow(read, { step: next === 'QUESTION' ? 'QUESTION' : 'STYLE' }).then(setRecon).catch(() => {});
      } catch (e) {
        if (signal.cancelled) return;
        if (e instanceof DesignStudioFailure && e.code === 'DS_IS_FLOOR_PLAN') { void toPlan(); return; }
        if (e instanceof DesignStudioFailure) { setReadFail({ retryable: e.retryable }); setStep('FAILED'); return; }
        // Still working after a long wait: keep watching (the work carries on regardless).
        window.setTimeout(() => { if (!signal.cancelled) setReadTick((n) => n + 1); }, 3000);
      }
    };
    void watch();
    return () => { signal.cancelled = true; };
  }, [step, recon?.id, readTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The upload is a floor plan: the same file goes on as the project's plan. */
  const toPlan = async () => {
    if (!recon) return;
    try { onFloorPlan(await planFromPhotos(recon)); } catch { setReadFail({ retryable: true }); setStep('FAILED'); }
  };
  // A project left on that answer (reload, another device) continues the same way.
  useEffect(() => { if (step === 'FAILED' && /^TERMINAL:IS_FLOOR_PLAN/.test(recon?.error ?? '')) void toPlan(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryReading = () => {
    setReadFail(null);
    retryNext.current = true; // the photos are already the server's: nothing is uploaded again
    setStep('READING');
  };

  // ── 3. One detail at a time ───────────────────────────────────────────
  const answer = (value: string) => {
    const q = open[0];
    if (!q) return;
    const next = [...answers.filter((a) => a.questionId !== q.id), { questionId: q.id, value }];
    setAnswers(next);
    const more = openQuestions(u, next).length > 0;
    setStep(more ? 'QUESTION' : 'STYLE');
    void save({ answers: next, step: more ? 'QUESTION' : 'STYLE' });
  };
  useEffect(() => { if (step === 'QUESTION' && u && !open.length) setStep('STYLE'); }, [step, u, open.length]);

  // ── 4–5. Style → Quality (and its price) ──────────────────────────────
  const requestQuote = useCallback(async () => {
    if (!originalId) return;
    setQuoteFailed(false);
    const q = await quoteRender({ projectId, versionId: originalId, product: 'DS_MASTER_RENDER', views: 1 });
    setQuote(q.quote);
    setQuoteFailed(!q.quote);
  }, [projectId, originalId]);
  useEffect(() => { if ((step === 'STYLE' || step === 'QUALITY') && !quote && !quoteFailed) void requestQuote(); }, [step, quote, quoteFailed, requestQuote]);

  const goQuality = () => {
    if (!style) return;
    const q = quality ?? 'HIGH_QUALITY';
    setQuality(q);
    setStep('QUALITY');
    void save({ step: 'QUALITY', look: { style, quality: q } });
  };

  // ── 6. Generate: the server owns it; resumable from anywhere ──────────
  const genSince = useRef<number>(flow?.startedAt ? Date.parse(flow.startedAt) : Date.now());
  const generate = useCallback(async (retry = false) => {
    if (!recon || !originalId || running.current) return;
    const look = style && quality ? { style, quality } : readLook(flowOf(recon)?.look);
    if (!look) { setStep('STYLE'); return; }
    running.current = true;
    setBusy(true);
    setGenFailure(null);
    setStep('GENERATING');
    let rec: ReconstructionRecord = recon;
    try {
      const current = flowOf(recon);
      const runKey = current?.runKey ?? `ph-run-${originalId}-${await sha16(stableJson({ look, answers }))}`;
      const startedAt = current?.startedAt && current.step === 'GENERATING' ? current.startedAt : new Date().toISOString();
      genSince.current = Date.parse(startedAt);
      rec = await savePhotoFlow(recon, { step: 'GENERATING', look, answers, runKey, startedAt, ...(quote ? { confirmedCredits: quote.credits } : {}) });
      setRecon(rec);
      const f = flowOf(rec);
      const result = await runDesign({
        projectId, versionId: originalId, mode: 'MASTER', key: runKey, look, preferences: lookPreferences(look.style as LookStyle, look.quality as LookQuality),
        confirmedCredits: quote?.credits ?? f?.confirmedCredits ?? null, versionName: t('p2h_version_design'), retry,
        progress: { specJobId: f?.specJobId ?? null, designVersionId: f?.designVersionId ?? null, renderId: f?.masterRenderId ?? null, renderAttempt: f?.masterAttempt ?? 0 },
        onStage: setStage,
        onProgress: async (p) => {
          rec = await savePhotoFlow(rec, { specJobId: p.specJobId ?? null, designVersionId: p.designVersionId ?? null, masterRenderId: p.renderId ?? null, masterAttempt: p.renderAttempt ?? 0 }).catch(() => rec);
        },
      });
      rec = await savePhotoFlow(rec, { step: 'DONE', designVersionId: result.versionId, masterRenderId: result.render.id }).catch(() => rec);
      setRecon(rec);
      setDoneVersion(result.versionId);
    } catch (e) {
      if (e instanceof DesignStudioError && (e.code === 'DS_STILL_WORKING' || e.code === 'DS_WATCH_STOPPED')) return;
      const code = e instanceof DesignStudioError ? e.code : '';
      // What the server confirmed on the way (the specification, the design) is in the record: the recovery shows it.
      setRecon(rec);
      setGenFailure({ retryable: true, message: ERROR_KEY[code] ? t(ERROR_KEY[code]) : null });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [recon, originalId, style, quality, answers, quote, projectId, t]);

  // A generation that was running when the page was left (or opened elsewhere): follow it.
  const resumed = useRef(false);
  useEffect(() => {
    if (step === 'GENERATING' && !resumed.current && !running.current && recon && originalId) {
      resumed.current = true;
      if (flowOf(recon)?.step === 'DONE' && flowOf(recon)?.designVersionId) { setDoneVersion(flowOf(recon)!.designVersionId!); return; }
      void generate(false);
    }
  }, [step, recon, originalId, generate]);

  const onViewResult = useCallback(() => { if (doneVersion) onDone(doneVersion); }, [doneVersion, onDone]);
  // A failure keeps every finished step on the server: the recovery says which (the specification is recorded once it succeeded).
  const failed = step === 'FAILED' || !!genFailure;
  const readyVersion = useReadyResult(projectId, failed);
  const genRecovery: Recovery = flow?.specJobId
    ? { done: ['UPLOAD', 'ANALYSIS', 'DESIGN'], resumeAt: 'IMAGE' }
    : { done: ['UPLOAD', 'ANALYSIS'], resumeAt: 'DESIGN' };
  const openProject = readyVersion ? () => onDone(readyVersion) : undefined;
  const chooseAnother = () => { setRecon(null); setUrls([]); setLocalUrls([]); setReadFail(null); setGenFailure(null); setAnswers([]); setStep('UPLOAD'); };
  const q = open[0] ?? null;
  const qImages = q ? (q.photos.length ? q.photos : (u?.rooms.find((r) => r.id === q.roomId)?.photos ?? [])).map((i) => images[i]).filter(Boolean) : [];

  return (
    <div className={cn('flex h-[100dvh] flex-col', SURFACE)} data-testid="photo-flow" data-step={step}>
      <header className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-6">
        <button type="button" onClick={onCancel} aria-label={t('ds_action_cancel')}
          className={cn('grid h-11 w-11 place-items-center rounded-full text-[#0C1119] hover:bg-black/5', RING)} data-testid="plan-cancel">
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
        <p className="min-w-0 truncate font-display text-[15px] font-semibold">{projectName}</p>
      </header>

      {step === 'UPLOAD' ? <PhotoUploadStep onContinue={(f) => { void onPhotos(f); }} error={error} busy={busy} progress={progress} /> : null}
      {step === 'READING' ? <AnalysisStep source="PHOTOS" images={images} /> : null}
      {step === 'FAILED' ? (
        <FailureStep source="PHOTOS" retryable={readFail?.retryable !== false} message={null} busy={busy} recovery={READING_RECOVERY} onOpenProject={openProject}
          onRetry={retryReading} onLater={onCancel} onChooseFile={chooseAnother} />
      ) : null}
      {step === 'QUESTION' && q ? (
        <DetailQuestionStep question={q.question} options={q.options} suggested={q.suggested} images={qImages} onAnswer={answer} busy={busy} />
      ) : null}
      {step === 'STYLE' ? (
        <StyleStep value={style} onChange={(s) => setStyle(s)} onNext={goQuality} />
      ) : null}
      {step === 'QUALITY' ? (
        <QualityStep value={quality} onChange={setQuality} onBack={() => { setStep('STYLE'); void save({ step: 'STYLE' }); }}
          onGenerate={() => { void generate(false); }} busy={busy}
          price={quote ? { credits: quote.credits, est: quote.est, charged: quote.charged } : null} priceUnavailable={quoteFailed} onRetryPrice={() => { void requestQuote(); }} />
      ) : null}
      {step === 'GENERATING' ? (
        <GeneratingStep source="PHOTOS" stage={stage} since={genSince.current} done={!!doneVersion} failure={genFailure} busy={busy} recovery={genRecovery} onOpenProject={openProject}
          onView={onViewResult} onRetry={() => { void generate(true); }} onLater={onCancel} onChooseFile={chooseAnother} />
      ) : null}
    </div>
  );
}
