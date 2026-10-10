import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Square, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DM_VOICE_MAX_SECONDS, formatClock } from '@/chat/conversation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface VoiceDraft { blob: Blob; seconds: number; url: string }

/**
 * Record up to 60 seconds — the recorder stops itself at the ceiling, the server and the
 * database CHECK refuse anything longer. Microphone access is asked for only on press.
 */
export function useVoiceRecorder() {
  const { t } = useLanguage();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const start = useCallback(async () => {
    if (recording || draft) return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { toast.error(t('pc_mic_denied')); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast.error(t('pc_mic_denied')); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    discardRef.current = false;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      clearTimer();
      setRecording(false);
      setSeconds(0);
      if (discardRef.current) return;
      const length = Math.min(DM_VOICE_MAX_SECONDS, (Date.now() - startedAt) / 1000);
      if (length < 0.5 || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      setDraft({ blob, seconds: length, url: URL.createObjectURL(blob) });
    };
    recorderRef.current = rec;
    setRecording(true);
    setSeconds(0);
    rec.start(250);
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        if (next >= DM_VOICE_MAX_SECONDS && rec.state === 'recording') rec.stop();
        return next;
      });
    }, 1000);
  }, [recording, draft, t]);

  const stop = useCallback(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }, []);
  const discard = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setDraft((d) => { if (d) URL.revokeObjectURL(d.url); return null; });
  }, []);
  /** Hand the draft over without revoking its preview URL (the optimistic bubble uses it). */
  const take = useCallback(() => { const d = draft; setDraft(null); return d; }, [draft]);

  useEffect(() => () => { clearTimer(); if (recorderRef.current?.state === 'recording') { discardRef.current = true; recorderRef.current.stop(); } }, []);

  return { recording, seconds, draft, start, stop, discard, take };
}

export function VoiceRecorderBar({ recorder, sending, onSend }: {
  recorder: ReturnType<typeof useVoiceRecorder>; sending: boolean; onSend: () => void;
}) {
  const { t } = useLanguage();
  const { recording, seconds, draft, stop, discard } = recorder;
  if (!recording && !draft) return null;
  const btn = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-1';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(42_100%_98%)] p-2" role="group" aria-label={t('pc_record_voice')}>
      {recording ? (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm font-medium text-[hsl(218_45%_14%)]" aria-live="polite">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(0_75%_50%)] motion-safe:animate-pulse" aria-hidden="true" />
            <span className="tabular-nums" dir="ltr">{t('pc_recording', { time: `${formatClock(seconds)} / ${formatClock(DM_VOICE_MAX_SECONDS)}` })}</span>
          </span>
          <button type="button" onClick={discard} className={cn(btn, 'text-[hsl(218_28%_38%)] hover:bg-white')} aria-label={t('pc_discard')}><Trash2 className="h-4 w-4" /></button>
          <button type="button" onClick={stop} className={cn(btn, 'bg-[#0C1119] text-[hsl(40_94%_64%)] hover:bg-[#1a2231]')}><Square className="h-4 w-4" aria-hidden="true" />{t('pc_stop_recording')}</button>
        </>
      ) : draft ? (
        <>
          <audio src={draft.url} controls className="h-11 min-w-0 flex-1" aria-label={t('pc_voice')} />
          <button type="button" onClick={discard} className={cn(btn, 'border border-[hsl(var(--border))] bg-white text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_97%)]')}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('pc_discard')}</button>
          <button type="button" onClick={onSend} disabled={sending} className={cn(btn, 'bg-[hsl(38_92%_54%)] text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60')}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}{t('pc_send_voice')}
          </button>
        </>
      ) : null}
      <p className="w-full px-2 text-2xs text-[hsl(218_28%_38%)]">{t('pc_voice_limit')}</p>
    </div>
  );
}
