import { useState } from 'react';
import { CalendarClock, Handshake, Loader2, MessageSquareText, Pencil, Sparkles, Wand2, Building2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { assistDraft, ChatActionError, type AssistMode } from '@/services/propertyChat';
import { FRAMED, GOLD_BUTTON } from './TranslationPreview';

/**
 * "Make Every Message Count." Templates are the approved copy filled from the listing's
 * verified data on the server; "Improve My Message" edits wording only and a rewrite that
 * adds a figure is refused there. Nothing here sends — the result goes back into the
 * composer, for the person to read, edit and send themselves.
 */
export function AiAssistPanel({ open, onOpenChange, conversationId, propertyId, canOffer, draft, onUse }: {
  open: boolean; onOpenChange: (v: boolean) => void; conversationId: string; propertyId: string | null;
  canOffer: boolean; draft: string; onUse: (text: string, focusEditor: boolean) => void;
}) {
  const { t, lang, isRTL } = useLanguage();
  const [busy, setBusy] = useState<AssistMode | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: AssistMode) => {
    setError(null); setResult(null);
    if (mode === 'improve' && !draft.trim()) { setError('pc_ai_needs_text'); return; }
    if (mode === 'offer' && !canOffer) { setError('pc_ai_needs_property'); return; }
    setBusy(mode);
    try {
      const r = await assistDraft({ mode, lang, conversationId, propertyId, draft: mode === 'improve' ? draft : undefined });
      setResult(r.draft);
    } catch (e) {
      const code = e instanceof ChatActionError ? e.code : '';
      setError(code === 'AI_REWRITE_REJECTED' ? 'pc_ai_rewrite_rejected'
        : code === 'PROPERTY_REQUIRED' || code === 'PROPERTY_NOT_YOURS' ? 'pc_ai_needs_property'
        : code === 'RATE_LIMITED' ? 'pc_err_rate' : 'pc_ai_unavailable');
    } finally { setBusy(null); }
  };

  const actions: Array<{ mode: AssistMode; key: string; Icon: typeof Sparkles }> = [
    { mode: 'introduction', key: 'pc_ai_intro', Icon: MessageSquareText },
    { mode: 'offer', key: 'pc_ai_offer', Icon: Building2 },
    { mode: 'follow_up', key: 'pc_ai_follow_up', Icon: Handshake },
    { mode: 'viewing', key: 'pc_ai_viewing', Icon: CalendarClock },
    { mode: 'improve', key: 'pc_ai_improve', Icon: Wand2 },
  ];

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setResult(null); setError(null); } }}>
      <SheetContent side={isRTL ? 'left' : 'right'} className="w-full overflow-y-auto bg-white sm:max-w-md">
        <SheetHeader className="text-start">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">{t('pc_ai_open')}</p>
          <SheetTitle className="font-display text-lg text-[hsl(218_45%_14%)]">{t('pc_ai_headline')}</SheetTitle>
          <SheetDescription className="text-sm text-[hsl(218_28%_38%)]">{t('pc_ai_description')}</SheetDescription>
        </SheetHeader>
        <div className="mt-5 grid gap-2">
          {actions.map(({ mode, key, Icon }) => (
            <button key={mode} type="button" onClick={() => run(mode)} disabled={busy !== null}
              className={cn(FRAMED, 'h-auto min-h-12 justify-start py-2 text-start disabled:opacity-60')}>
              {busy === mode ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold-ink motion-reduce:animate-none" aria-hidden="true" /> : <Icon className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />}
              <span>{t(key)}</span>
            </button>
          ))}
        </div>
        <div aria-live="polite">
          {error && <p className="mt-4 rounded-xl border border-[hsl(0_60%_85%)] bg-[hsl(0_80%_98%)] p-3 text-sm text-[hsl(0_60%_35%)]">{t(error, { seconds: 60 })}</p>}
          {result && (
            <div className="mt-5 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(42_100%_98%)] p-3">
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">{t('pc_ai_draft_label')}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-[hsl(218_45%_14%)]" dir="auto">{result}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" className={cn(GOLD_BUTTON, 'flex-1')} onClick={() => { onUse(result, false); onOpenChange(false); setResult(null); }}>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />{t('pc_ai_use')}
                </button>
                <button type="button" className={cn(FRAMED, 'flex-1')} onClick={() => { onUse(result, true); onOpenChange(false); setResult(null); }}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />{t('pc_ai_edit')}
                </button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
