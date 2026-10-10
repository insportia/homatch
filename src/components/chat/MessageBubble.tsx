import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, Languages, Loader2, Pause, Play, Reply, RotateCcw, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { cn } from '@/lib/utils';
import { deliveryLabelKey, formatClock } from '@/chat/conversation';
import {
  getDmMediaUrl, transcribeVoice, translateMessage, type CachedTranslation, type ChatMessage, type TranscriptResult,
} from '@/services/propertyChat';
import { PropertyCardBubble } from './PropertyCardBubble';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-1';

function useSignedUrl(path: string | null | undefined, local?: string | null) {
  const [url, setUrl] = useState<string | null>(local ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (local || !path) return;
    let alive = true;
    getDmMediaUrl(path).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path, local]);
  return { url, failed };
}

function PhotoContent({ message }: { message: ChatMessage }) {
  const { t } = useLanguage();
  const { url, failed } = useSignedUrl(message.media_path, message._localUrl);
  const [open, setOpen] = useState(false);
  if (failed) return <p className="text-xs italic opacity-80">{t('pc_media_unavailable')}</p>;
  return (
    <>
      {url ? (
        <button type="button" onClick={() => setOpen(true)} className={cn('block overflow-hidden rounded-xl', FOCUS)} aria-label={t('pc_photo')}>
          <img src={url} alt={message.body || t('pc_photo')} className="max-h-72 w-auto max-w-full object-cover" loading="lazy" />
        </button>
      ) : <Skeleton className="h-44 w-56 max-w-full rounded-xl" />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,64rem)] p-2">
          <DialogHeader className="sr-only"><DialogTitle>{t('pc_photo')}</DialogTitle></DialogHeader>
          {url && <img src={url} alt={message.body || t('pc_photo')} className="max-h-[82vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VoiceContent({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t } = useLanguage();
  const { url, failed } = useSignedUrl(message.media_path, message._localUrl);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const duration = Number(message.media_meta?.duration_seconds ?? 0);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  const toggle = () => {
    if (!url) return;
    if (!audioRef.current) {
      const a = new Audio(url);
      audioRef.current = a;
      a.addEventListener('timeupdate', () => setPosition(a.currentTime));
      a.addEventListener('ended', () => { setPlaying(false); setPosition(0); });
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); } else { void audioRef.current.play(); setPlaying(true); }
  };
  if (failed) return <p className="text-xs italic opacity-80">{t('pc_media_unavailable')}</p>;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div className="flex min-w-[12rem] items-center gap-3" dir="ltr">
      <button
        type="button" onClick={toggle} disabled={!url}
        aria-label={playing ? t('pc_voice_pause') : t('pc_voice_play')}
        className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors', FOCUS,
          mine ? 'bg-[hsl(38_92%_54%)] text-[#161309] hover:bg-[hsl(38_92%_60%)]' : 'bg-[#0C1119] text-[hsl(40_94%_64%)] hover:bg-[#1a2231]')}
      >
        {!url ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('h-1.5 w-full overflow-hidden rounded-full', mine ? 'bg-white/25' : 'bg-[hsl(var(--border))]')}>
          <div className={cn('h-full rounded-full', mine ? 'bg-white' : 'bg-[#0C1119]')} style={{ width: `${pct}%` }} />
        </div>
        <p className={cn('mt-1 text-2xs tabular-nums', mine ? 'text-white/80' : 'text-[hsl(218_28%_38%)]')}>
          {playing || position > 0 ? formatClock(position) : formatClock(duration)}
        </p>
      </div>
    </div>
  );
}

function DeliveryMark({ status }: { status: string }) {
  const { t } = useLanguage();
  const Icon = status === 'SEEN' || status === 'DELIVERED' ? CheckCheck : status === 'SENT' ? Check : status === 'FAILED' ? AlertCircle : Clock;
  return (
    <span className={cn('inline-flex items-center gap-1', status === 'FAILED' ? 'text-[hsl(0_70%_45%)]' : status === 'SEEN' ? 'text-gold-ink' : 'text-[hsl(218_28%_38%)]')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t(deliveryLabelKey(status))}</span>
    </span>
  );
}

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  myLang: string;
  counterpartName: string;
  quoted: ChatMessage | null;
  cached: CachedTranslation[];
  onReply: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
}

/**
 * One message. Text is shown as sent; a translation is an extra layer the reader asks
 * for and can switch off ("Show Original"), never a replacement of what was written.
 */
export function MessageBubble({ message, mine, myLang, counterpartName, quoted, cached, onReply, onRetry }: MessageBubbleProps) {
  const { t, lang } = useLanguage();
  const cachedTr = cached.find((c) => c.kind === 'TRANSLATION' && c.targetLang === myLang)?.text ?? null;
  const cachedTranscript = cached.find((c) => c.kind === 'TRANSCRIPT')?.text ?? null;
  const [translation, setTranslation] = useState<string | null>(cachedTr);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState<null | 'translate' | 'transcript' | 'voice'>(null);
  const [trError, setTrError] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(cachedTranscript ? { transcript: cachedTranscript, sourceLang: null } : null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  useEffect(() => { if (cachedTr && !translation) setTranslation(cachedTr); }, [cachedTr, translation]);

  const time = new Date(message.created_at).toLocaleTimeString(intlLocaleFor(lang), { hour: '2-digit', minute: '2-digit' });
  const hasText = message.kind === 'TEXT' || (message.body ?? '').trim().length > 0;
  const langName = (code: string | null | undefined) => (code ? t(`pc_lang_${code}`) : '');
  const serverRow = !message.id.startsWith('tmp-');

  /* The sender approved a translation: they wrote original_body, the recipient got body.
     If the reader wrote it (mine) or reads the original's language, the original is theirs. */
  const originalIsMine = !!message.original_body && (mine || message.original_lang === myLang);
  const displayed = (() => {
    if (originalIsMine && !showOriginal) return mine ? message.body : message.original_body!;
    if (originalIsMine && showOriginal) return mine ? message.original_body! : message.body;
    if (translation && !showOriginal) return translation;
    return message.body;
  })();

  const translate = async () => {
    setBusy('translate'); setTrError(false);
    try {
      const r = await translateMessage(message.id, myLang);
      setTranslation(r.translation); setShowOriginal(false);
    } catch { setTrError(true); } finally { setBusy(null); }
  };
  const loadTranscript = async (withTranslation: boolean) => {
    setBusy(withTranslation ? 'voice' : 'transcript'); setTrError(false);
    try {
      const r = await transcribeVoice(message.id, withTranslation ? myLang : undefined);
      setTranscript(r); setTranscriptOpen(true);
      if (withTranslation && r.translationError) setTrError(true);
    } catch { setTrError(true); } finally { setBusy(null); }
  };

  const chip = cn('inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-2xs font-semibold text-gold-ink hover:bg-[hsl(42_100%_96%)] disabled:opacity-60', FOCUS);

  return (
    <div className={cn('group flex w-full flex-col', mine ? 'items-end' : 'items-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed shadow-[0_1px_2px_hsl(218_40%_10%/0.06)] sm:max-w-[70%]',
        mine ? 'rounded-ee-md bg-[#0C1119] text-white' : 'rounded-es-md border border-[hsl(var(--border))] bg-white text-[hsl(218_45%_14%)]',
      )}>
        {quoted && (
          <div className={cn('mb-2 rounded-lg border-s-2 px-2.5 py-1.5 text-xs', mine ? 'border-[hsl(40_94%_64%)] bg-white/10 text-white/85' : 'border-[hsl(38_92%_54%)] bg-[hsl(42_100%_97%)] text-[hsl(218_28%_38%)]')}>
            <p className="font-semibold">{quoted.sender_id === message.sender_id ? (mine ? t('pc_you') : counterpartName) : (mine ? counterpartName : t('pc_you'))}</p>
            <p className="line-clamp-2 break-words">{quoted.body || (quoted.kind === 'PHOTO' ? t('pc_photo') : quoted.kind === 'VOICE' ? t('pc_voice') : t('pc_property_card'))}</p>
          </div>
        )}
        {message.kind === 'PHOTO' && <PhotoContent message={message} />}
        {message.kind === 'VOICE' && <VoiceContent message={message} mine={mine} />}
        {message.kind === 'PROPERTY' && message.property_card && <PropertyCardBubble card={message.property_card} mine={mine} />}
        {hasText && displayed && <p className={cn('whitespace-pre-wrap break-words', message.kind !== 'TEXT' && 'mt-2')} dir="auto">{displayed}</p>}
        {(translation && !showOriginal && !originalIsMine) && (
          <p className={cn('mt-1 text-2xs', mine ? 'text-white/70' : 'text-[hsl(218_28%_38%)]')}>{t('pc_translated_to', { lang: langName(myLang) })}</p>
        )}
        {originalIsMine && mine && !showOriginal && message.translated_to && (
          <p className="mt-1 text-2xs text-white/70">{t('pc_translated_to', { lang: langName(message.translated_to) })}</p>
        )}
      </div>

      <div className={cn('mt-0.5 flex flex-wrap items-center gap-x-1 text-2xs text-[hsl(218_28%_38%)]', mine ? 'justify-end' : 'justify-start')}>
        <span className="px-1 tabular-nums">{time}</span>
        {mine && <DeliveryMark status={message.status} />}
        {mine && message.status === 'FAILED' && (
          <button type="button" onClick={() => onRetry(message)} className={chip}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t('pc_retry')}</button>
        )}
        {serverRow && message.status !== 'FAILED' && (
          <button type="button" onClick={() => onReply(message)} className={chip} aria-label={t('pc_reply')}><Reply className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t('pc_reply')}</span></button>
        )}
        {serverRow && !mine && message.kind !== 'VOICE' && hasText && !originalIsMine && !translation && (
          <button type="button" onClick={translate} disabled={busy !== null} className={chip}>
            {busy === 'translate' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
            {t('pc_translate_to_mine')}
          </button>
        )}
        {(translation || originalIsMine) && hasText && (
          <button type="button" onClick={() => setShowOriginal((v) => !v)} className={chip} aria-pressed={showOriginal}>
            {showOriginal ? t('pc_show_translation') : t('pc_show_original')}
          </button>
        )}
        {serverRow && message.kind === 'VOICE' && (
          <>
            <button type="button" onClick={() => (transcript ? setTranscriptOpen(true) : loadTranscript(false))} disabled={busy !== null} className={chip}>
              {busy === 'transcript' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileText className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('pc_view_transcript')}
            </button>
            {!mine && (
              <button type="button" onClick={() => loadTranscript(true)} disabled={busy !== null} className={chip}>
                {busy === 'voice' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
                {t('pc_tr_voice')}
              </button>
            )}
          </>
        )}
      </div>
      {trError && <p role="status" className="mt-0.5 max-w-[85%] text-2xs text-[hsl(0_70%_42%)]">{t('pc_tr_error')}</p>}

      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader><DialogTitle>{t('pc_transcript_title')}</DialogTitle></DialogHeader>
          {transcript?.empty || !transcript?.transcript
            ? <p className="text-sm text-muted-foreground">{t('pc_transcript_empty')}</p>
            : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">{t('pc_original_label')}</p>
                  <p className="whitespace-pre-wrap text-sm" dir="auto">{transcript.transcript}</p>
                </div>
                {transcript.translation && (
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">{t('pc_translation_label')}</p>
                    <p className="whitespace-pre-wrap text-sm" dir="auto">{transcript.translation}</p>
                  </div>
                )}
                {transcript.translation && <p className="text-2xs text-muted-foreground">{t('pc_ai_disclaimer')}</p>}
              </div>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
