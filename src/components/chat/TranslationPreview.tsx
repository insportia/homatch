import { Languages, Loader2, Pencil, Send, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export interface DraftTranslationState {
  original: string;
  translation: string;
  sourceLang: string | null;
  targetLang: string;
}

const GOLD_BUTTON = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-6 text-[15px] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2';
const FRAMED = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[hsl(40_80%_60%)] bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2';

/**
 * "Review your translated message before sending." Original and translation side by
 * side (stacked on a phone). Nothing is sent until the person presses Send Translation;
 * Edit returns the ORIGINAL to the composer, untouched.
 */
export function TranslationPreview({ state, sending, onSend, onEdit, onClose }: {
  state: DraftTranslationState; sending: boolean; onSend: () => void; onEdit: () => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const name = (code: string | null) => (code ? t(`pc_lang_${code}`) : '');
  return (
    <section aria-labelledby="pc-tr-preview" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(42_100%_98%)] p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="pc-tr-preview" className="flex items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)]">
            <Languages className="h-4 w-4 text-gold-ink" aria-hidden="true" />{t('pc_preview_translation')}
          </h3>
          <p className="mt-0.5 text-xs text-[hsl(218_28%_38%)]">{t('pc_tr_preview_hint')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('pc_close')} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[hsl(218_28%_38%)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-[hsl(var(--border))] bg-white p-3">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(218_28%_38%)]">
            {t('pc_original_label')}{state.sourceLang ? ` · ${name(state.sourceLang)}` : ''}
          </p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm" dir="auto">{state.original}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-[hsl(40_80%_60%/0.7)] bg-white p-3">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">
            {t('pc_translation_label')} · {name(state.targetLang)}
          </p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm" dir="auto">{state.translation}</p>
        </div>
      </div>
      <p className="mt-2 text-2xs text-[hsl(218_28%_38%)]">{t('pc_ai_disclaimer')}</p>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onEdit} className={FRAMED}><Pencil className="h-4 w-4" aria-hidden="true" />{t('pc_edit')}</button>
        <button type="button" onClick={onSend} disabled={sending} className={cn(GOLD_BUTTON)}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
          {t('pc_send_translation')}
        </button>
      </div>
    </section>
  );
}

export { GOLD_BUTTON, FRAMED };
