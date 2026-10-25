/*
 * HOMI, BESIDE THE CONTRACT.
 *
 * The owner's complaint: HOMI was not visible on Contracts at all. This is
 * HOMI as the rest of the site shows it, the live 3D model (HomiHomeStage:
 * the 2D render first, the 3D stage faded in when it is near the viewport;
 * no WebGL, Save-Data or a failed load keeps the 2D render), standing beside
 * the result and offering to explain it.
 *
 * The questions hand over to the existing HOMI chat (/ai) with the contract's
 * own context in navigation state, the same handoff the per-clause "Ask HOMI"
 * already uses: the chat receives what the analysis said, never the file.
 */
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomiHomeStage } from '@/components/homi/HomiHomeStage';
import type { HomiState } from '@/components/homi/homiStates';
import type { DocumentAnalysis } from '@/services/dealRoomDocuments';

/** What the chat is told about this contract. Short, quoted from the analysis, nothing invented. */
export function contractChatContext(analysis: DocumentAnalysis, title: string) {
  const flagged = (analysis.clauses ?? []).filter((c) => c.attention && c.attention !== 'NORMAL');
  return {
    type: 'workspace' as const,
    data: {
      surface: 'contract',
      title: title.slice(0, 120),
      documentType: analysis.documentType,
      summary: (analysis.summary ?? []).slice(0, 5),
      needsAttention: flagged.slice(0, 8).map((c) => ({ clause: c.label, why: c.plain.slice(0, 300), risk: c.review?.risk ?? null })),
      missingProtections: (analysis.missingProtections ?? []).slice(0, 6).map((m) => m.label),
      questions: (analysis.questions ?? []).slice(0, 6),
      note: 'This comes from HOMATCH\'s reading of the customer\'s own contract. Explain it plainly; no legal verdicts; do not invent terms.',
    },
  };
}

export function ContractHomiGuide({
  mode, analysis, title, flaggedCount,
}: {
  /** reading: HOMI is busy with the document; result: HOMI offers to explain. */
  mode: 'reading' | 'result';
  analysis?: DocumentAnalysis | null;
  title?: string;
  flaggedCount?: number;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const gesture: HomiState = mode === 'reading' ? 'searching' : 'explaining';

  const ask = (promptKey: string) => {
    if (!analysis) return;
    navigate('/ai', { state: { context: contractChatContext(analysis, title ?? ''), prompt: t(promptKey) } });
  };

  return (
    <section
      className="relative min-w-0 overflow-hidden rounded-2xl bg-[#0C1119] text-white shadow-hover ring-1 ring-[hsl(38_92%_56%)]/25"
      aria-label={t('ux_ct_homi_label')}
      data-testid="contract-homi"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(14rem_14rem_at_100%_0%,hsl(38_92%_56%/0.25),transparent_70%)]" aria-hidden="true" />
      <div className="relative flex min-w-0 items-end gap-3 p-4 sm:gap-5 sm:p-5">
        <HomiHomeStage gesture={gesture} framing="upper" className="h-28 w-24 shrink-0 sm:h-36 sm:w-32" />
        <div className="min-w-0 flex-1 pb-1">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(38_92%_56%)]/15 px-2.5 py-0.5 text-xs font-semibold text-[hsl(38_92%_70%)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />HOMI
          </p>
          <p className="mt-2 min-w-0 break-words font-display text-base font-semibold leading-snug sm:text-lg">
            {mode === 'reading'
              ? t('ux_ct_homi_reading')
              : flaggedCount
                ? t('ux_ct_homi_result_found', { n: flaggedCount })
                : t('ux_ct_homi_result_clean')}
          </p>
          <p className="mt-1 min-w-0 break-words text-sm leading-relaxed text-white/75">
            {mode === 'reading' ? t('ux_ct_homi_reading_hint') : t('ux_ct_homi_result_hint')}
          </p>
        </div>
      </div>
      {mode === 'result' && analysis ? (
        <div className="relative flex flex-wrap gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
          <button type="button" onClick={() => ask('ux_ct_homi_q_risks')}
            className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-[hsl(38_92%_56%)] px-4 text-sm font-semibold text-[#0C1119] transition-transform hover:brightness-105 active:scale-[0.98]">
            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words text-start">{t('ux_ct_homi_btn_risks')}</span>
          </button>
          <button type="button" onClick={() => ask('ux_ct_homi_q_ask')}
            className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-medium text-white transition-colors hover:border-[hsl(38_92%_56%)]">
            <span className="min-w-0 break-words text-start">{t('ux_ct_homi_btn_ask')}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
