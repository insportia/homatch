// HOMATCH DESIGN STUDIO — the screens of the one flow (photos and floor plans).
//
//   Upload (photos, up to six; or a plan) → its preview ("ready", continue or
//   change) → Analysis → [one detail, one at a time] → Style → Quality →
//   Generating (Snake, if the customer wants it) → the Result.
//
// Every screen has one primary action. Work the server owns is only watched
// here: the copy says so ("you can go to another page"), and a failure says
// what it is — saved and worth trying again, or a file that cannot be used.

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, ImagePlus, Loader2, Plus, RefreshCw, RotateCcw, Upload, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { RunStage } from '@/services/designStudio/designRun';
import { listRenders } from '@/services/designStudio/renders';
import { PRIMARY, QUIET, RING, Screen } from '../planToHome/SimpleSteps';

const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTOS = 6;
const SECONDARY = cn('inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#0C1119] ring-1 ring-[#D9D1C4] hover:ring-[#0C1119] sm:w-auto', RING);
const ALERT = 'rounded-2xl bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]';
const NOTE = 'rounded-2xl bg-[hsl(38_92%_56%)]/15 px-4 py-3 text-[14px] text-[#3D3424]';

type Source = 'PHOTOS' | 'PLAN';

// ── Photos: choose, look over, continue ──────────────────────────────────

export function PhotoUploadStep({ onContinue, error, busy, progress }: {
  onContinue: (files: File[]) => void; error: string | null; busy: boolean; progress: { n: number; total: number } | null;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Array<{ file: File; url: string }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { items.forEach((i) => URL.revokeObjectURL(i.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const all = [...list];
    const ok = all.filter((f) => (PHOTO_TYPES as readonly string[]).includes(f.type.toLowerCase()));
    const room = MAX_PHOTOS - items.length;
    const kept = ok.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setNote(ok.length < all.length ? t('dsx_pu_wrong_type') : ok.length > room ? t('dsx_pu_too_many') : null);
    setItems([...items, ...kept]);
  };
  const remove = (k: number) => setItems((cur) => { URL.revokeObjectURL(cur[k].url); return cur.filter((_, i) => i !== k); });
  const picker = (
    <input ref={input} type="file" multiple accept={PHOTO_TYPES.join(',')} className="sr-only" tabIndex={-1}
      onChange={(e) => { add(e.target.files); e.target.value = ''; }} data-testid="photo-file" />
  );

  if (!items.length) {
    return (
      <Screen eyebrow={t('dsx_pu_eyebrow')} title={t('dsx_pu_title')} body={t('dsx_pu_body')} testId="photo-upload">
        <label
          className={cn('flex min-h-[40dvh] cursor-pointer flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed bg-white px-6 py-12 text-center transition-colors sm:min-h-[340px]',
            over ? 'border-[#0C1119] bg-[#FBFAF7]' : 'border-[#CFC6B8] hover:border-[#0C1119]', 'focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }} data-testid="photo-drop">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[hsl(38_92%_56%)] text-[#0C1119]" aria-hidden="true"><ImagePlus className="h-7 w-7" /></span>
          <span className="text-[18px] font-semibold">{t('dsx_pu_choose')}</span>
          <span className="text-[13px] text-[#5B6472]">{t('dsx_pu_limits')}</span>
          <input type="file" multiple accept={PHOTO_TYPES.join(',')} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} data-testid="photo-file-first" />
        </label>
        {note ? <p role="status" className={cn('mt-4', NOTE)}>{note}</p> : null}
        {error ? <p role="alert" className={cn('mt-4', ALERT)}>{error}</p> : null}
        <p className="mt-5 text-center text-[13px] text-[#5B6472] sm:text-start">{t('ds_fp_privacy')}</p>
      </Screen>
    );
  }

  return (
    <Screen wide eyebrow={t('dsx_pu_eyebrow')} title={t('dsx_pu_ready_title')} body={t('dsx_pu_ready_body')} testId="photo-ready"
      aside={<button type="button" onClick={() => { setItems((cur) => { cur.forEach((i) => URL.revokeObjectURL(i.url)); return []; }); setNote(null); }} disabled={busy} className={QUIET} data-testid="photo-change">{t('dsx_pu_change')}</button>}
      action={(
        <button type="button" onClick={() => onContinue(items.map((i) => i.file))} disabled={busy} className={PRIMARY} data-testid="photo-continue">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy && progress ? t('dsx_uploading', { n: String(progress.n), total: String(progress.total) }) : t('dsx_continue')}
        </button>
      )}>
      {picker}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" data-testid="photo-grid">
        {items.map((it, i) => (
          <li key={it.url} className="group relative overflow-hidden rounded-[20px] bg-white ring-1 ring-[#E7E1D8]">
            <img src={it.url} alt={t('dsx_pu_photo_alt', { n: String(i + 1) })} className="aspect-[4/3] w-full object-cover" />
            <span className="absolute start-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-[#0C1119]/80 px-2 text-2xs font-semibold text-white" aria-hidden="true">{i + 1}</span>
            {!busy ? (
              <button type="button" onClick={() => remove(i)} aria-label={t('dsx_pu_remove', { n: String(i + 1) })}
                className={cn('absolute end-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-[#0C1119] shadow', RING)} data-testid="photo-remove">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
        {items.length < MAX_PHOTOS && !busy ? (
          <li>
            <button type="button" onClick={() => input.current?.click()}
              className={cn('flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#CFC6B8] bg-white text-[14px] font-medium text-[#4A5263] hover:border-[#0C1119] hover:text-[#0C1119]', RING)} data-testid="photo-add">
              <Plus className="h-5 w-5" aria-hidden="true" />{t('dsx_pu_add')}
            </button>
          </li>
        ) : null}
      </ul>
      <p className="mt-3 text-[13px] text-[#5B6472]">{t('dsx_pu_limits')}</p>
      {note ? <p role="status" className={cn('mt-4', NOTE)}>{note}</p> : null}
      {error ? <p role="alert" className={cn('mt-4', ALERT)}>{error}</p> : null}
    </Screen>
  );
}

// ── A floor plan: choose, look over, continue ────────────────────────────

export function PlanUploadStep({ onContinue, error, busy }: { onContinue: (file: File) => void; error: string | null; busy: boolean }) {
  const { t } = useLanguage();
  const [picked, setPicked] = useState<{ file: File; url: string | null } | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked]);
  const pick = (f: File | undefined) => {
    if (!f) return;
    setPicked({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
  };
  if (!picked) {
    return (
      <Screen eyebrow={t('dsx_fu_eyebrow')} title={t('dsx_fu_title')} body={t('dsx_fu_body')} testId="simple-upload">
        <label
          className={cn('flex min-h-[40dvh] cursor-pointer flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed bg-white px-6 py-12 text-center transition-colors sm:min-h-[340px]',
            over ? 'border-[#0C1119] bg-[#FBFAF7]' : 'border-[#CFC6B8] hover:border-[#0C1119]', 'focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }} data-testid="plan-drop">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[hsl(38_92%_56%)] text-[#0C1119]" aria-hidden="true"><Upload className="h-7 w-7" /></span>
          <span className="text-[18px] font-semibold">{t('dsx_fu_choose')}</span>
          <span className="text-[13px] text-[#5B6472]">{t('ds_fp_file_types')}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} data-testid="plan-file" />
        </label>
        {error ? <p role="alert" className={cn('mt-4', ALERT)}>{error}</p> : null}
        <p className="mt-5 text-center text-[13px] text-[#5B6472] sm:text-start">{t('ds_fp_privacy')}</p>
      </Screen>
    );
  }
  return (
    <Screen eyebrow={t('dsx_fu_eyebrow')} title={t('dsx_fu_ready')} testId="plan-ready"
      aside={<button type="button" onClick={() => setPicked(null)} disabled={busy} className={QUIET} data-testid="plan-change">{t('dsx_fu_change')}</button>}
      action={(
        <button type="button" onClick={() => onContinue(picked.file)} disabled={busy} className={PRIMARY} data-testid="plan-upload-continue">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('dsx_continue')}
        </button>
      )}>
      <div className="overflow-hidden rounded-[28px] bg-white ring-1 ring-[#E7E1D8]">
        {picked.url ? <img src={picked.url} alt="" className="mx-auto max-h-[46dvh] w-auto object-contain" />
          : <p className="flex items-center gap-3 px-5 py-10 text-[15px] font-medium"><FileText className="h-6 w-6" aria-hidden="true" />{picked.file.name}</p>}
      </div>
      {error ? <p role="alert" className={cn('mt-4', ALERT)}>{error}</p> : null}
    </Screen>
  );
}

// ── Analysis (server-owned; the page may be left) ────────────────────────

export function AnalysisStep({ source, images }: { source: Source; images: string[] }) {
  const { t } = useLanguage();
  const shown = images.slice(0, 6);
  return (
    <Screen eyebrow={t('dsx_eyebrow')} title={t('dsx_an_title')} body={t(source === 'PHOTOS' ? 'dsx_an_body_photos' : 'dsx_an_body_plan')} testId="plan-reading">
      <div role="status" aria-live="polite" className="space-y-5">
        <div className={cn('grid gap-2', shown.length > 1 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1')}>
          {(shown.length ? shown : [null]).map((src, i) => (
            <div key={src ?? i} className="relative overflow-hidden rounded-[22px] bg-white">
              {src ? <img src={src} alt="" className={cn('w-full object-cover opacity-85', shown.length > 1 ? 'aspect-[4/3]' : 'max-h-[40dvh] object-contain')} /> : <div className="h-56" />}
              <div className="hm-plan-scan pointer-events-none absolute inset-x-0 h-24" aria-hidden="true" />
            </div>
          ))}
        </div>
        <p className="flex items-center gap-2 text-[15px] font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('dsx_an_title')}</p>
        <p className="text-[14px] text-[#5B6472]" data-testid="leave-ok">{t('dsx_leave_ok')}</p>
      </div>
    </Screen>
  );
}

// ── One detail (photos): one question, one at a time ─────────────────────

export function DetailQuestionStep({ question, options, suggested, images, onAnswer, busy }: {
  question: string; options: Array<{ id: string; label: string }>; suggested: string | null; images: string[];
  onAnswer: (value: string) => void; busy: boolean;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState<string | null>(suggested);
  useEffect(() => setValue(suggested), [question, suggested]);
  return (
    <Screen title={t('dsx_q_title')} body={t('dsx_q_body')} testId="quick-question"
      action={<button type="button" onClick={() => value && onAnswer(value)} disabled={!value || busy} className={PRIMARY} data-testid="question-continue">{t('dsx_continue')}</button>}>
      {images.length ? (
        <div className={cn('grid gap-2', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.slice(0, 2).map((src) => <img key={src} src={src} alt="" className="aspect-[4/3] w-full rounded-[22px] object-cover" />)}
        </div>
      ) : null}
      <fieldset className="mt-6">
        <legend className="text-[18px] font-semibold leading-snug">{question}</legend>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={question}>
          {options.map((o) => {
            const on = value === o.id;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setValue(o.id)}
                className={cn('flex min-h-[56px] items-center justify-between gap-3 rounded-[18px] bg-white px-5 text-start text-[16px] font-medium', RING, on ? 'ring-2 ring-[#0C1119]' : 'ring-1 ring-[#E7E1D8] hover:ring-[#B9AE9C]')}
                data-testid={`question-option-${o.id}`}>
                {o.label}
                {on ? <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0C1119] text-white" aria-hidden="true"><Check className="h-3.5 w-3.5" /></span> : null}
              </button>
            );
          })}
        </div>
      </fieldset>
    </Screen>
  );
}

// ── Generating (server-owned; Snake while it is made, if wanted) ─────────

const STAGES: RunStage[] = ['DESIGN', 'IMAGE', 'RESULT'];
export const STAGE_KEY: Record<RunStage, string> = { DESIGN: 'dsx_stage_design', IMAGE: 'dsx_stage_image', RESULT: 'dsx_stage_result' };

export function GeneratingStep({ source, stage, since, done, failure, recovery, onOpenProject, onView, onRetry, onLater, onChooseFile, busy }: {
  source: Source; stage: RunStage; since: number | null; done: boolean;
  /** The run failed: retryable (try again without uploading) or not (another file). */
  failure: { retryable: boolean; message: string | null } | null;
  /** What the server has kept of this run, and where trying again continues. */
  recovery?: Recovery;
  onOpenProject?: () => void;
  onView: () => void; onRetry: () => void; onLater: () => void; onChooseFile: () => void; busy: boolean;
}) {
  const { t } = useLanguage();
  const [now, setNow] = useState(Date.now());
  const [offer, setOffer] = useState<'HIDDEN' | 'OFFERED' | 'DECLINED'>('HIDDEN');
  const [playing, setPlaying] = useState(false);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const elapsed = Math.max(0, Math.floor((now - (since ?? now)) / 1000));
  // Snake is offered only for a genuinely long wait (a picture takes minutes), never for a quick step.
  useEffect(() => { if (offer === 'HIDDEN' && !done && !failure && elapsed >= 5) setOffer('OFFERED'); }, [offer, done, failure, elapsed]);
  // Ready and not playing: straight to the result. Playing: the game says so, the customer chooses.
  useEffect(() => { if (done && !playing) onView(); }, [done, playing, onView]);
  const at = STAGES.indexOf(stage);
  const status = failure ? 'FAILED' : done ? 'READY' : 'PROCESSING';

  if (failure && !playing) {
    return <FailureStep source={source} retryable={failure.retryable} message={failure.message} recovery={recovery} onOpenProject={onOpenProject} onRetry={onRetry} onLater={onLater} onChooseFile={onChooseFile} busy={busy} />;
  }
  return (
    <Screen eyebrow={t('dsx_gen_eyebrow')} title={t('dsx_gen_title')} body={t(source === 'PHOTOS' ? 'dsx_gen_body' : 'dsx_gen_body_plan')} testId="plan-generating">
      <section role="status" aria-live="polite" className="rounded-[28px] bg-white p-5 sm:p-7" data-testid="generation-stages" data-stage={stage}>
        <ol className="space-y-4">
          {STAGES.map((s, i) => {
            const st = i < at || done ? 'DONE' : i === at ? 'RUNNING' : 'PENDING';
            return (
              <li key={s} data-stage={s} data-state={st} className={cn('flex items-center gap-3 text-[16px]', st === 'PENDING' && 'text-[#646B78]')}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F7F4EF]" aria-hidden="true">
                  {st === 'RUNNING' ? <Loader2 className="h-4 w-4 animate-spin" /> : st === 'DONE' ? <Check className="h-4 w-4 text-[hsl(152_55%_38%)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#C9CED6]" />}
                </span>
                <span className={cn('min-w-0 flex-1', st === 'RUNNING' && 'font-semibold')}>{t(STAGE_KEY[s])}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 border-t border-[#EFEAE2] pt-4 text-[13px] text-[#5B6472]" data-testid="generation-elapsed">
          {t('ds_gen_elapsed', { m: Math.floor(elapsed / 60), s: String(elapsed % 60).padStart(2, '0') })} · {t('dsx_leave_ok')}
        </p>
      </section>
      {offer === 'OFFERED' ? (
        <section className="mt-5 rounded-[28px] bg-[#0C1119] p-5 text-white sm:p-7" data-testid="snake-offer" aria-labelledby="snake-offer-title">
          <h2 id="snake-offer-title" className="font-display text-[20px] font-semibold">{t('dsx_sn_title')}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-white/75">{t('dsx_sn_body')}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setPlaying(true)} className={cn('inline-flex h-12 items-center justify-center rounded-full bg-[hsl(38_92%_56%)] px-6 text-[15px] font-semibold text-[#0C1119]', RING)} data-testid="snake-play">{t('dsx_sn_play')}</button>
            <button type="button" onClick={() => setOffer('DECLINED')} className={cn('inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-medium text-white ring-1 ring-white/30', RING)} data-testid="snake-wait">{t('dsx_sn_wait')}</button>
          </div>
        </section>
      ) : null}
      {playing ? (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-[#0C1119]/95"><Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden="true" /></div>}>
          <SnakeGame status={status} stageLabel={t(STAGE_KEY[stage])} onView={() => { setPlaying(false); if (done) onView(); }} onClose={() => setPlaying(false)} />
        </Suspense>
      ) : null}
    </Screen>
  );
}

// ── It did not finish: what is kept, and try again from where it stopped ──

/** The steps of making a design, as the customer sees them. */
export type RecoveryStepId = 'UPLOAD' | 'ANALYSIS' | 'DESIGN' | 'IMAGE';
/** What the server has kept (each step here is stored there) and the step trying again starts with. */
export interface Recovery { done: RecoveryStepId[]; resumeAt: RecoveryStepId }
const RECOVERY_STEPS: RecoveryStepId[] = ['UPLOAD', 'ANALYSIS', 'DESIGN', 'IMAGE'];
const RECOVERY_LABEL: Record<RecoveryStepId, Record<Source, string>> = {
  UPLOAD: { PHOTOS: 'dsx_rec_step_upload_photos', PLAN: 'dsx_rec_step_upload_plan' },
  ANALYSIS: { PHOTOS: 'dsx_rec_step_analysis_photos', PLAN: 'dsx_rec_step_analysis_plan' },
  DESIGN: { PHOTOS: 'dsx_rec_step_design', PLAN: 'dsx_rec_step_design' },
  IMAGE: { PHOTOS: 'dsx_rec_step_image', PLAN: 'dsx_rec_step_image' },
};
/** Reading the upload did not finish: the upload is kept, the reading is asked again. */
export const READING_RECOVERY: Recovery = { done: ['UPLOAD'], resumeAt: 'ANALYSIS' };

/** The version of the project's latest finished picture (the project can be opened on it), or null. */
export function useReadyResult(projectId: string, active: boolean): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    void listRenders(projectId).then((rows) => {
      const ready = rows.find((r) => r.status === 'READY' && !!r.final_key);
      if (!stop) setVersion(ready?.version_id ?? null);
    }).catch(() => {});
    return () => { stop = true; };
  }, [projectId, active]);
  return version;
}

export function FailureStep({ source, retryable, message, recovery = READING_RECOVERY, onOpenProject, onRetry, onLater, onChooseFile, busy }: {
  source: Source; retryable: boolean; message: string | null;
  /** The real state of the work (never assumed): what is kept, and where trying again continues. */
  recovery?: Recovery;
  /** Shown only when the project already has a finished result it can be opened on. */
  onOpenProject?: () => void;
  onRetry: () => void; onLater: () => void; onChooseFile: () => void; busy: boolean;
}) {
  const { t } = useLanguage();
  if (!retryable) {
    return (
      <Screen title={t('dsx_unsup_title')} body={t('dsx_unsup_body')} testId="ds-unsupported"
        action={<button type="button" onClick={onChooseFile} className={PRIMARY} data-testid="choose-another">{t('dsx_unsup_cta')}</button>} />
    );
  }
  const shown = RECOVERY_STEPS.slice(0, Math.max(RECOVERY_STEPS.indexOf(recovery.resumeAt) + 1, 1));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="ds-retry" data-resume={recovery.resumeAt}>
      <div className="m-auto w-full max-w-[520px] px-4 py-6 sm:py-10">
        <section className="rounded-[28px] bg-white p-6 shadow-[0_1px_2px_rgba(12,17,25,0.04),0_12px_32px_-16px_rgba(12,17,25,0.18)] ring-1 ring-[#E7E1D8] sm:p-8" aria-labelledby="ds-retry-title">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[hsl(38_92%_56%)]/15 text-[hsl(36_60%_32%)]" aria-hidden="true">
            <RotateCcw className="h-5 w-5" />
          </span>
          <h1 id="ds-retry-title" className="mt-4 text-balance font-display text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">{t('dsx_rec_title')}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#4A5263]">{t('dsx_rec_body')}</p>
          <ol className="mt-5 space-y-2.5 rounded-2xl bg-[#F7F4EF] p-4" data-testid="recovery-steps">
            {shown.map((id) => {
              const kept = recovery.done.includes(id);
              const here = id === recovery.resumeAt;
              return (
                <li key={id} className="flex items-center gap-3 text-[15px]" data-step={id} data-state={kept ? 'KEPT' : here ? 'RESUME' : 'PENDING'}>
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', kept ? 'bg-[hsl(152_55%_38%)]/12 text-[hsl(152_55%_32%)]' : 'bg-[hsl(38_92%_56%)]/20')} aria-hidden="true">
                    {kept ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-[hsl(38_92%_46%)]" />}
                  </span>
                  <span className={cn('min-w-0 flex-1', here && 'font-semibold')}>{t(RECOVERY_LABEL[id][source])}</span>
                  <span className={cn('shrink-0 text-[13px]', kept ? 'text-[hsl(152_55%_30%)]' : 'font-medium text-[hsl(36_60%_32%)]')}>{t(kept ? 'dsx_rec_saved' : 'dsx_rec_resume')}</span>
                </li>
              );
            })}
          </ol>
          {recovery.done.length ? <p className="mt-3 text-[13px] text-[#5B6472]" data-testid="recovery-note">{t('dsx_rec_kept_note')}</p> : null}
          {message ? <p className={cn(ALERT, 'mt-4')}>{message}</p> : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
            <button type="button" onClick={onRetry} disabled={busy} className={PRIMARY} data-testid="plan-retry">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{t('dsx_retry')}
            </button>
            <button type="button" onClick={onLater} className={SECONDARY} data-testid="retry-later">{t('dsx_later')}</button>
          </div>
          {onOpenProject ? (
            <div className="mt-3 flex justify-center sm:justify-start">
              <button type="button" onClick={onOpenProject} className={QUIET} data-testid="retry-open-project">{t('dsx_rec_back')}</button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export const useStableImages = (urls: Array<string | null | undefined>) => useMemo(() => urls.filter((u): u is string => !!u), [urls.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
