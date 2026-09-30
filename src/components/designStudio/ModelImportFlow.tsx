// HOMATCH DESIGN STUDIO — A CUSTOMER'S OWN 3D MODEL.
//
//   1. Upload     a self-contained .glb or .gltf
//   2. Checking   the server reads the bytes back and inspects them
//   3. Result     what HOMATCH found, stated plainly: what the model is,
//                 what can be edited in it and what cannot, and any
//                 correction it made (units, orientation)
//
// Nothing is promised that the workspace does not do. A baked model is
// called a baked model.

import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, Box, Check, Loader2, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isModelAnalysis, type ModelAnalysisSummary } from '@/lib/designStudio/modelParts';
import { DesignStudioError, getSourceFull } from '@/services/designStudio/projects';
import { importModel } from '@/services/designStudio/models';
import { cn } from '@/lib/utils';

type Step = 'UPLOAD' | 'CHECKING' | 'RESULT';

const ERROR_KEY: Record<string, string> = {
  DS_MODEL_OTHER_FORMAT: 'ds_mi_error_other_format',
  DS_MODEL_NOT_GLTF: 'ds_mi_error_not_gltf',
  DS_MODEL_TOO_LARGE: 'ds_mi_error_too_large',
  DS_MODEL_EXTERNAL_RESOURCE: 'ds_mi_error_external',
  DS_MODEL_UNSUPPORTED_EXTENSION: 'ds_mi_error_extension',
  DS_MODEL_TOO_COMPLEX: 'ds_mi_error_too_complex',
  DS_MODEL_TEXTURE_TOO_LARGE: 'ds_mi_error_texture',
  DS_MODEL_BAD_TEXTURE: 'ds_mi_error_damaged',
  DS_MODEL_MALFORMED: 'ds_mi_error_damaged',
  DS_MODEL_UNSUPPORTED_VERSION: 'ds_mi_error_damaged',
  DS_MODEL_EMPTY_MODEL: 'ds_mi_error_empty',
};

const WARNING_KEY: Record<string, string> = {
  UNITS_CENTIMETRES: 'ds_mi_warn_cm',
  UNITS_MILLIMETRES: 'ds_mi_warn_mm',
  UP_AXIS_CORRECTED: 'ds_mi_warn_up',
  HEAVY_ON_PHONES: 'ds_mi_warn_heavy',
  SMALLER_THAN_A_ROOM: 'ds_mi_warn_small',
  LARGER_THAN_A_HOME: 'ds_mi_warn_large',
  BOUNDS_INCOMPLETE: 'ds_mi_warn_bounds',
};

const CLASS_KEYS: Record<ModelAnalysisSummary['editability'], { title: string; body: string }> = {
  FULLY_STRUCTURED: { title: 'ds_editability_full', body: 'ds_mi_class_full_body' },
  PARTIALLY_STRUCTURED: { title: 'ds_editability_partial', body: 'ds_mi_class_partial_body' },
  VISUAL_MODEL: { title: 'ds_editability_visual', body: 'ds_editability_visual_body' },
};

const PRIMARY = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0C1119] px-5 text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-60';

const metres = (n: number) => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function ModelImportFlow({
  userId, projectId, projectName, onDone, onCancel,
}: {
  userId: string;
  projectId: string;
  projectName: string;
  onDone: (sourceId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('UPLOAD');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sourceId: string; analysis: ModelAnalysisSummary } | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setStep('CHECKING');
    try {
      const imported = await importModel({ userId, projectId, file });
      const source = await getSourceFull(imported.sourceId);
      if (!source || !isModelAnalysis(source.canonical)) throw new DesignStudioError('DS_MODEL_FAILED');
      setResult({ sourceId: imported.sourceId, analysis: source.canonical });
      setStep('RESULT');
    } catch (e) {
      const code = e instanceof DesignStudioError ? e.code : '';
      setError(t(ERROR_KEY[code] ?? 'ds_mi_error_generic'));
      setStep('UPLOAD');
    }
  };

  const a = result?.analysis ?? null;
  const counts = a?.semantics.counts;
  const paintable = counts ? counts.WALL + counts.FLOOR + counts.CEILING : 0;
  const stepIndex = ['UPLOAD', 'CHECKING', 'RESULT'].indexOf(step);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F4F5F7] text-[#0C1119]">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-[#0C1119] px-3 text-white">
        <button type="button" onClick={onCancel} aria-label={t('ds_action_cancel')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(38_92%_62%)]">{t('ds_mi_title')}</p>
          <p className="truncate font-display text-[15px] font-semibold">{projectName}</p>
        </div>
        <ol className="ms-auto hidden items-center gap-4 text-[13px] md:flex" aria-label={t('ds_fp_steps')}>
          {['ds_fp_step_upload', 'ds_mi_step_checking', 'ds_mi_step_result'].map((key, i) => (
            <li key={key} aria-current={i === stepIndex ? 'step' : undefined} className={cn(i === stepIndex ? 'font-semibold text-white' : i < stepIndex ? 'text-white/60' : 'text-white/35')}>
              {i + 1}. {t(key)}
            </li>
          ))}
        </ol>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto w-full max-w-xl">
          {step !== 'RESULT' ? (
            <>
              <h1 className="font-display text-2xl font-semibold">{t('ds_mi_upload_title')}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#4A5263]">{t('ds_mi_upload_body')}</p>
              {step === 'UPLOAD' ? (
                <label
                  className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#B8BFCA] bg-white px-6 py-12 text-center hover:border-[#0C1119] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
                >
                  <Upload className="h-8 w-8 text-[#4A5263]" aria-hidden="true" />
                  <span className="text-[15px] font-semibold">{t('ds_fp_choose_file')}</span>
                  <span className="text-[13px] text-[#4A5263]">{t('ds_mi_file_types')}</span>
                  <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
                </label>
              ) : (
                <p className="mt-6 flex items-center gap-3 rounded-xl bg-white p-5 text-[15px]" aria-live="polite">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  {t('ds_mi_checking')}
                </p>
              )}
              {error ? <p role="alert" className="mt-4 rounded-lg bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
              <p className="mt-4 text-[13px] text-[#4A5263]">{t('ds_mi_privacy')}</p>
            </>
          ) : a && result ? (
            <>
              <h1 className="font-display text-2xl font-semibold">{t('ds_mi_result_title')}</h1>
              <section className="mt-5 rounded-xl bg-white p-5">
                <p className="flex items-center gap-2 text-[16px] font-semibold">
                  <Box className="h-5 w-5 text-[hsl(34_90%_31%)]" aria-hidden="true" />
                  {t(CLASS_KEYS[a.editability].title)}
                </p>
                <p className="mt-2 text-[14px] leading-relaxed text-[#4A5263]">{t(CLASS_KEYS[a.editability].body)}</p>
                <h2 className="mt-5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_mi_you_can')}</h2>
                <ul className="mt-2 space-y-1.5 text-[14px]">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_32%)]" aria-hidden="true" />{t('ds_mi_can_view')}</li>
                  {a.editability !== 'VISUAL_MODEL' && paintable > 0 ? (
                    <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_32%)]" aria-hidden="true" />
                      {t('ds_mi_can_paint', { walls: String(counts!.WALL), floors: String(counts!.FLOOR), ceilings: String(counts!.CEILING) })}</li>
                  ) : null}
                  {a.editability !== 'VISUAL_MODEL' && counts!.FURNITURE > 0 ? (
                    <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_32%)]" aria-hidden="true" />
                      {t('ds_mi_can_hide', { n: String(counts!.FURNITURE) })}</li>
                  ) : null}
                </ul>
                <p className="mt-3 text-[13px] leading-relaxed text-[#4A5263]">{t('ds_mi_cannot_add')}</p>
              </section>

              <section className="mt-4 rounded-xl bg-white p-5">
                <dl className="divide-y divide-[#EEF0F3] text-[14px]">
                  <div className="flex justify-between gap-3 py-1.5">
                    <dt className="text-[#4A5263]">{t('ds_mi_size')}</dt>
                    <dd className="font-medium">≈ {metres(a.normalization.sizeM[0])} × {metres(a.normalization.sizeM[2])} m · {metres(a.normalization.sizeM[1])} m</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1.5">
                    <dt className="text-[#4A5263]">{t('ds_mi_detail')}</dt>
                    <dd className="font-medium">{t('ds_mi_triangles', { n: a.stats.triangles.toLocaleString() })}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1.5">
                    <dt className="text-[#4A5263]">{t('ds_mi_parts')}</dt>
                    <dd className="font-medium">{t('ds_mi_parts_value', { n: String(a.stats.meshNodes), known: String(a.stats.meshNodes - a.semantics.unidentified) })}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[13px] text-[#4A5263]">{t('ds_mi_size_note')}</p>
              </section>

              {a.warnings.filter((w) => WARNING_KEY[w]).length ? (
                <ul className="mt-4 space-y-2">
                  {a.warnings.filter((w) => WARNING_KEY[w]).map((w) => (
                    <li key={w} className="flex gap-2 rounded-lg bg-[hsl(38_92%_54%)]/12 px-3 py-2.5 text-[14px] text-[hsl(32_78%_26%)]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {t(WARNING_KEY[w])}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} onClick={() => onDone(result.sourceId)}>{t('ds_mi_open')}</button>
                <button type="button" onClick={() => { setResult(null); setStep('UPLOAD'); }} className="h-11 rounded-lg border border-[#D5D9E0] bg-white px-4 text-[15px] font-medium hover:bg-[#F4F5F7]">{t('ds_mi_another')}</button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
