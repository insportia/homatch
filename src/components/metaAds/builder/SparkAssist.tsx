// ✨ One field, one suggestion — inline. HOMATCH writes from what it knows about
// the campaign (the server reads the offer and the property's own facts; never
// a phone or an address), and only ever SUGGESTS: Use / Try another / Edit.
// Nothing replaces the owner's text until they press Use. Free to the owner,
// rate-limited and cached on the server (ai_copy); "Try another" is the only
// thing that asks again.
import React, { useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { aiCopy, type AiCopyField } from '@/services/metaAds';

export function SparkAssist({ campaignId, field, current, onUse, onEdit, language }: {
  campaignId: string | null | undefined; field: AiCopyField; current: string;
  onUse: (text: string) => void;
  /** Use, then put the cursor in the field to keep writing. */
  onEdit?: (text: string) => void;
  language?: string;
}) {
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!campaignId) return null;

  const ask = async (fresh: boolean) => {
    setBusy(true); setError(null);
    try {
      const op = current.trim() ? 'IMPROVE' : 'GENERATE';
      const cur = field === 'FORM_HEADLINE' ? { headline: current, primaryText: '' } : { primaryText: current, headline: '' };
      const r = await aiCopy(campaignId, op, language ?? lang, cur, '', field, fresh);
      const v = r.variants[0];
      const out = (field === 'FORM_HEADLINE' ? v?.headline || v?.primaryText : v?.primaryText || v?.headline) ?? '';
      if (!out.trim()) throw Object.assign(new Error('empty'), { code: 'AI_NO_RESULT' });
      setText(out.trim());
    } catch (e) {
      const code = String((e as { code?: string })?.code ?? '');
      setError(t(code === 'AI_UNAVAILABLE' ? 'madsb_ai_unavailable' : code === 'AI_RATE_LIMITED' ? 'madsb_ai_rate_limited' : 'madsb_ai_failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-1.5" data-mm-spark={field}>
      {text === null ? (
        <button type="button" onClick={() => void ask(false)} disabled={busy} data-mm-spark-ask=""
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
          {t(current.trim() ? 'mm_k_spark_improve' : 'mm_k_spark_write')}
        </button>
      ) : (
        <div role="region" aria-label={t('mm_k_spark_suggestion')} className="rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] p-2.5">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground" dir="auto" data-mm-spark-text="">{text}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SparkButton onClick={() => { onUse(text); setText(null); }} data="use"><Check className="h-3.5 w-3.5" aria-hidden />{t('mm_k_spark_use')}</SparkButton>
            <SparkButton onClick={() => void ask(true)} disabled={busy} data="again">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}{t('mm_k_spark_again')}
            </SparkButton>
            {onEdit && <SparkButton onClick={() => { onEdit(text); setText(null); }} data="edit"><Pencil className="h-3.5 w-3.5" aria-hidden />{t('mm_k_spark_edit')}</SparkButton>}
            <SparkButton onClick={() => setText(null)} data="dismiss"><X className="h-3.5 w-3.5" aria-hidden />{t('mm_k_spark_dismiss')}</SparkButton>
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">{t('mm_k_spark_note')}</p>
        </div>
      )}
      {error && <p className="mt-1 text-2xs text-muted-foreground" role="status">{error}</p>}
    </div>
  );
}

function SparkButton({ children, onClick, disabled, data }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; data: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-mm-spark-action={data}
      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-foreground hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:opacity-60">
      {children}
    </button>
  );
}
