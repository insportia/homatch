import { useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Languages, Loader2, Mic, Send, Sparkles, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { DM_IMAGE_MIME } from '@/chat/conversation';
import { photoProblem, type ChatMessage } from '@/services/propertyChat';
import { toast } from 'sonner';
import { useVoiceRecorder, VoiceRecorderBar, type VoiceDraft } from './VoiceRecorder';

const TOOL = 'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-[hsl(218_45%_14%)] transition-colors hover:bg-[hsl(42_100%_96%)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-1';

export interface ComposerProps {
  text: string;
  setText: (v: string) => void;
  canSend: boolean;
  sending: boolean;
  translating: boolean;
  replyTo: ChatMessage | null;
  replyName: string;
  onCancelReply: () => void;
  onSendText: () => void;
  onTranslate: () => void;
  onSendPhoto: (file: File, caption: string) => void;
  onSendVoice: (draft: VoiceDraft) => void;
  onAttachProperty: () => void;
  onOpenAi: () => void;
  onTyping: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Write naturally; HOMATCH can translate before anything is sent. Every tool here is a
 * 44px target, works from the keyboard, and only PREPARES — the one action that sends
 * is the button that says so.
 */
export function Composer(p: ComposerProps) {
  const { t } = useLanguage();
  const recorder = useVoiceRecorder();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [caption, setCaption] = useState('');
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  /* Grow with the text, up to a few lines, so the box never hides what is being written. */
  useEffect(() => {
    const el = p.textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [p.text, p.textareaRef]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) { toast.error(t(problem)); return; }
    setPhoto({ file, url: URL.createObjectURL(file) });
    setCaption('');
  };

  const busy = p.sending || p.translating;
  const locked = !p.canSend;

  if (photo) {
    return (
      <div className="space-y-2 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(42_100%_98%)] p-2">
        <div className="flex items-start gap-3">
          <img src={photo.url} alt={t('pc_photo')} className="h-24 w-24 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <label htmlFor="pc-caption" className="sr-only">{t('pc_photo_caption_ph')}</label>
            <textarea id="pc-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} maxLength={4000}
              placeholder={t('pc_photo_caption_ph')} dir="auto"
              className="w-full resize-none rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] sm:text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={cn(TOOL, 'border border-[hsl(var(--border))] bg-white')} onClick={() => setPhoto(null)}>
            <X className="h-4 w-4" aria-hidden="true" />{t('pc_cancel')}
          </button>
          <button type="button" disabled={busy || locked} onClick={() => { p.onSendPhoto(photo.file, caption.trim()); setPhoto(null); }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-4 text-sm font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-1">
            <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('pc_send_photo')}
          </button>
        </div>
      </div>
    );
  }

  if (recorder.recording || recorder.draft) {
    return (
      <VoiceRecorderBar recorder={recorder} sending={p.sending}
        onSend={() => { const d = recorder.take(); if (d) p.onSendVoice(d); }} />
    );
  }

  return (
    <div className="space-y-1.5">
      {p.replyTo && (
        <div className="flex items-center gap-2 rounded-xl border-s-2 border-[hsl(38_92%_54%)] bg-[hsl(42_100%_97%)] px-3 py-1.5 text-xs text-[hsl(218_28%_38%)]">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-[hsl(218_45%_14%)]">{t('pc_replying_to', { name: p.replyName })}</span>
            {p.replyTo.body ? ` · ${p.replyTo.body}` : ''}
          </span>
          <button type="button" onClick={p.onCancelReply} aria-label={t('pc_cancel_reply')} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white shadow-[0_1px_2px_hsl(218_40%_10%/0.05)] focus-within:border-[hsl(40_80%_60%)] focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%/0.35)]">
        <label htmlFor="pc-composer" className="sr-only">{t('pc_composer_placeholder')}</label>
        <textarea
          id="pc-composer" ref={p.textareaRef} value={p.text} rows={1} maxLength={4000} dir="auto" disabled={locked}
          placeholder={t('pc_composer_placeholder')}
          onChange={(e) => { p.setText(e.target.value); p.onTyping(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (p.text.trim() && !busy) p.onSendText(); } }}
          className="block max-h-40 min-h-12 w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 text-base text-[hsl(218_45%_14%)] placeholder:text-[hsl(218_15%_55%)] focus:outline-none disabled:cursor-not-allowed sm:text-[15px]"
        />
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1.5">
          <input ref={fileRef} type="file" accept={DM_IMAGE_MIME.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className={TOOL} disabled={locked || busy} onClick={() => fileRef.current?.click()} aria-label={t('pc_add_photos')}>
            <ImagePlus className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">{t('pc_add_photos')}</span>
          </button>
          <button type="button" className={TOOL} disabled={locked || busy} onClick={() => void recorder.start()} aria-label={t('pc_record_voice')}>
            <Mic className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">{t('pc_record_voice')}</span>
          </button>
          <button type="button" className={TOOL} disabled={locked || busy} onClick={p.onAttachProperty} aria-label={t('pc_attach_property')}>
            <Building2 className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">{t('pc_attach_property')}</span>
          </button>
          <button type="button" className={cn(TOOL, 'text-gold-ink')} disabled={locked || busy} onClick={p.onOpenAi} aria-label={t('pc_improve_ai')}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('pc_improve_ai')}</span>
          </button>
          <button type="button" className={TOOL} disabled={locked || busy || !p.text.trim()} onClick={p.onTranslate} aria-label={t('pc_translate')}>
            {p.translating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Languages className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{t('pc_translate')}</span>
          </button>
          <button type="button" onClick={p.onSendText} disabled={locked || busy || !p.text.trim()}
            className="ms-auto inline-flex h-11 items-center gap-2 rounded-xl bg-[hsl(38_92%_54%)] px-4 text-sm font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-1">
            {p.sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
            <span className="hidden min-[380px]:inline">{t('pc_send')}</span>
            <span className="sr-only min-[380px]:hidden">{t('pc_send')}</span>
          </button>
        </div>
      </div>
      <p className="px-1 text-2xs text-[hsl(218_28%_38%)]">{t('pc_tr_outgoing_hint')}</p>
    </div>
  );
}
