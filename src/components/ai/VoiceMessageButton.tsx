/*
 * HOMI VOICE MESSAGES: the microphone in the composer.
 *
 * Hold to talk and let go to send, or tap once to start and send when ready.
 * While recording, a panel covers the composer row: cancel, a live timer, the
 * waveform of the voice as it comes in, and send.
 * The panel is absolutely positioned, so the composer row it sits in must be
 * `relative` (the only change this needs from its host page).
 *
 * Free and unlimited in every plan (owner, 2026-10-29): no price, no
 * consent popup, no balance popup. Before the microphone opens this only asks
 * the server whether voice is on. LONG DICTATION JUST WORKS: the server's two
 * minute cap is per request, so shortly before it the finished part is handed
 * over and transcribed in the background while recording carries on into the
 * next part (voiceParts.ts); send joins every part into ONE message. The only
 * sign of it is a quiet "keep talking" line. A burst rate a person speaking
 * never reaches shows a gentle "slow down", never a count.
 */

import { Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { getVoiceStatus, transcribeVoiceMessage, VoiceError, type VoiceTranscript } from '@/services/homiVoice';
import { type Recording, recorderSupport, type StartError, shapeOf, useVoiceRecorder } from './useVoiceRecorder';
import { formatClock, type VoiceNote } from './VoiceMessageBubble';
import { joinTranscripts, partDue, totalSeconds } from './voiceParts';

/** Hold shorter than this and the press counts as a tap. */
const HOLD_MS = 600;
/** Shorter than this holds no words; nothing is sent. */
const MIN_RECORDING_MS = 700;

/** One finished part of a message, transcribed in the background. */
interface Part { recording: Recording; key: string; result: VoiceTranscript | null; inflight: Promise<VoiceTranscript> | null }

type Phase = 'idle' | 'checking' | 'recording' | 'sending' | 'error';
type Notice = StartError | 'unavailable' | null;

export interface VoiceMessageButtonProps {
  /** The interface language; the recogniser listens for it. */
  locale: string;
  disabled?: boolean;
  /** The text HOMI understood, and the recording to show above it. */
  onTranscript: (text: string, note: VoiceNote) => void;
}

export function VoiceMessageButton({ locale, disabled, onTranscript }: VoiceMessageButtonProps) {
  const { t } = useLanguage();
  const rec = useVoiceRecorder();

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'hold' | 'tap'>('tap');
  const [partCount, setPartCount] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const pressing = useRef(false);
  const pressedAt = useRef(0);
  /* The parts of the message being recorded or sent, in order. */
  const parts = useRef<Part[]>([]);
  const partStartedAt = useRef(0);
  const cuttingRef = useRef(false);
  const sendingRef = useRef(false);

  const clearParts = useCallback(() => { parts.current = []; partStartedAt.current = 0; setPartCount(0); }, []);
  const reset = useCallback(() => { setPhase('idle'); setErrorKey(null); clearParts(); }, [clearParts]);

  /* One part to the server; a part already transcribed or in flight is not sent twice. */
  const sendPart = useCallback((part: Part): Promise<VoiceTranscript> => {
    if (part.result) return Promise.resolve(part.result);
    if (!part.inflight) {
      part.inflight = transcribeVoiceMessage({
        segments: part.recording.segments, durationMs: part.recording.durationMs, locale, idempotencyKey: part.key,
      }).then((r) => { part.result = r; return r; }).finally(() => { part.inflight = null; });
      part.inflight.catch(() => { /* surfaced when the message is sent */ });
    }
    return part.inflight;
  }, [locale]);

  /* ── send: every part, in order, as one message ─────────────────── */
  const deliver = useCallback(async () => {
    const list = parts.current;
    if (!list.length || sendingRef.current) return;
    sendingRef.current = true;
    setPhase('sending');
    setErrorKey(null);
    try {
      const results: VoiceTranscript[] = [];
      for (const part of list) results.push(await sendPart(part));
      const text = joinTranscripts(results);
      if (!text) { setPhase('error'); setErrorKey('voice_no_speech'); clearParts(); return; }
      const note: VoiceNote = {
        audioUrls: list.flatMap((p) => p.recording.segments.map((b) => URL.createObjectURL(b))),
        durationSeconds: totalSeconds(list.map((p) => ({ durationMs: p.recording.durationMs, result: p.result }))),
        shape: shapeOf(list.flatMap((p) => p.recording.levels), 28),
      };
      clearParts();
      setPhase('idle');
      onTranscript(text, note);
    } catch (e) {
      const code = e instanceof VoiceError ? e.code : 'TRANSCRIBE_FAILED';
      if (code === 'SERVICE_DISABLED' || code === 'UNAVAILABLE') { clearParts(); setPhase('idle'); setNotice('unavailable'); return; }
      setPhase('error');
      setErrorKey(code === 'TOO_LONG' || code === 'TOO_LARGE' ? 'voice_too_long' : code === 'RATE_LIMITED' ? 'voice_slow_down' : 'voice_failed');
      if (code === 'TOO_LONG' || code === 'TOO_LARGE' || code === 'EMPTY') clearParts();
    } finally {
      sendingRef.current = false;
    }
  }, [sendPart, onTranscript, clearParts]);

  /* A part boundary: hand the finished part over and keep recording. Nothing
     changes for the person except a quiet "keep talking" line. */
  const cutPart = useCallback(async () => {
    if (cuttingRef.current) return;
    cuttingRef.current = true;
    partStartedAt.current = rec.elapsedMs;
    try {
      const recording = await rec.takePart();
      if (recording && recording.segments.length > 0) {
        const part: Part = { recording, key: crypto.randomUUID(), result: null, inflight: null };
        parts.current.push(part);
        setPartCount(parts.current.length);
        void sendPart(part).catch(() => { /* retried on send */ });
      }
    } finally {
      cuttingRef.current = false;
    }
  }, [rec, sendPart]);

  const finish = useCallback(async () => {
    if (!rec.recording) return;
    const recording = await rec.stop();
    if (recording && recording.segments.length > 0 && (recording.durationMs >= MIN_RECORDING_MS || parts.current.length > 0)) {
      parts.current.push({ recording, key: crypto.randomUUID(), result: null, inflight: null });
    }
    if (!parts.current.length) { setPhase('error'); setErrorKey('voice_too_short'); return; }
    void deliver();
  }, [rec, deliver]);

  const cancel = useCallback(() => { rec.cancel(); reset(); }, [rec, reset]);

  /* ── start ────────────────────────────────────────────────────────── */
  const beginRecording = useCallback(async () => {
    const failed = await rec.start();
    if (failed) { setPhase('idle'); setNotice(failed); return; }
    clearParts();
    // Still holding once the microphone is open: hold to talk. Otherwise
    // (a tap, or a permission prompt in between) it records until sent.
    setMode(pressing.current ? 'hold' : 'tap');
    setPhase('recording');
  }, [rec, clearParts]);

  const open = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setErrorKey(null);
    const support = recorderSupport();
    if (support !== 'ok') { setNotice(support); return; }
    setPhase('checking');
    try {
      const s = await getVoiceStatus();
      if (!s.available) { setPhase('idle'); setNotice('unavailable'); return; }
    } catch (e) {
      const code = e instanceof VoiceError ? e.code : 'NETWORK';
      if (code === 'SERVICE_DISABLED') { setPhase('idle'); setNotice('unavailable'); return; }
      /* The server could not be asked: record anyway. It checks everything
         again when the message arrives. */
    }
    await beginRecording();
  }, [phase, beginRecording]);

  /* ── pointer: hold to talk, or tap ───────────────────────────────── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    pressing.current = true;
    pressedAt.current = Date.now();
    void open();
  };

  useEffect(() => {
    const up = () => {
      if (!pressing.current) return;
      pressing.current = false;
      if (phase === 'recording' && mode === 'hold') {
        if (Date.now() - pressedAt.current < HOLD_MS) setMode('tap');
        else void finish();
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [phase, mode, finish]);

  /* Escape throws a recording away. */
  useEffect(() => {
    if (phase !== 'recording') return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [phase, cancel]);

  /* The per-request cap never ends a message: the finished part goes, recording goes on. */
  const elapsedSeconds = rec.elapsedMs / 1000;
  useEffect(() => {
    if (phase === 'recording' && rec.recording && partDue(rec.elapsedMs, partStartedAt.current)) void cutPart();
  }, [phase, rec.recording, rec.elapsedMs, cutPart]);

  const bars = Array.from({ length: 32 }, (_, i) => rec.live[rec.live.length - 32 + i] ?? 0);
  const panelOpen = phase === 'recording' || phase === 'sending' || phase === 'error';

  const noticeKey: Record<Exclude<Notice, null>, [string, string]> = {
    denied: ['voice_denied_title', 'voice_denied_body'],
    'no-device': ['voice_no_device_title', 'voice_no_device_body'],
    unsupported: ['voice_unsupported_title', 'voice_unsupported_body'],
    insecure: ['voice_unsupported_title', 'voice_unsupported_body'],
    failed: ['voice_unsupported_title', 'voice_failed'],
    unavailable: ['voice_unavailable_title', 'voice_unavailable_body'],
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); pressing.current = false; void open(); } }}
        disabled={disabled}
        aria-label={t('voice_record')}
        title={t('voice_record')}
        data-voice-button
        className="relative grid h-11 w-11 shrink-0 touch-none select-none place-items-center rounded-full border border-[hsl(38_92%_56%)]/45 bg-white/[0.06] text-[hsl(38_92%_62%)] transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50 motion-reduce:transition-none"
      >
        {phase === 'checking'
          ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
          : <Mic className="h-5 w-5" aria-hidden="true" />}
      </button>

      {panelOpen && (
        <div
          role="group"
          aria-label={t('voice_message_label')}
          className="absolute inset-0 z-10 flex items-center gap-2 rounded-[1.25rem] bg-[#0C1119] px-1 ring-1 ring-inset ring-[hsl(38_92%_56%)]/35 sm:gap-3"
        >
          <button
            type="button"
            onClick={cancel}
            aria-label={t('voice_cancel')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-2" aria-live="polite">
            {phase === 'recording' && (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-white">
                    {formatClock(elapsedSeconds)}
                  </span>
                  <div className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden="true">
                    {bars.map((v, i) => (
                      <span
                        key={i}
                        className="w-[3px] shrink-0 rounded-full bg-[hsl(38_92%_60%)] motion-safe:transition-[height] motion-safe:duration-100"
                        style={{ height: `${Math.round(14 + Math.min(1, v) * 86)}%`, opacity: 0.45 + Math.min(1, v) * 0.55 }}
                      />
                    ))}
                  </div>
                </div>
                {/* A long dictation only ever shows this quiet line, never a limit or a countdown. */}
                <p className="truncate text-[13px] text-white/60" data-voice-parts={partCount}>
                  {partCount > 0 ? t('voice_keep_talking') : mode === 'hold' ? t('voice_hold_hint') : t('voice_tap_hint')}
                </p>
              </>
            )}
            {phase === 'sending' && (
              <div className="flex items-center gap-2.5 text-sm text-white" role="status">
                <Loader2 className="h-4 w-4 shrink-0 text-[hsl(38_92%_60%)] motion-safe:animate-spin" aria-hidden="true" />
                <span className="truncate">{t('voice_transcribing')}</span>
              </div>
            )}
            {phase === 'error' && errorKey && (
              <p className="line-clamp-2 text-[13px] leading-snug text-white/85" role="alert">{t(errorKey)}</p>
            )}
          </div>

          {phase === 'recording' && (
            <button
              type="button"
              onClick={() => void finish()}
              aria-label={t('voice_send')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(38_92%_54%)] text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Send className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          )}
          {phase === 'error' && parts.current.length > 0 && (
            <button
              type="button"
              onClick={() => void deliver()}
              className="h-11 shrink-0 rounded-full bg-[hsl(38_92%_54%)] px-4 text-sm font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t('voice_retry')}
            </button>
          )}
          {phase === 'error' && parts.current.length === 0 && (
            <button
              type="button"
              onClick={() => { reset(); void open(); }}
              aria-label={t('voice_record')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(38_92%_54%)] text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Mic className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Microphone blocked, missing, unsupported, or voice paused. */}
      <Dialog open={notice !== null} onOpenChange={(o) => { if (!o) setNotice(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl border-[hsl(var(--gold-border))] p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary ring-1 ring-inset ring-border">
              <MicOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold leading-snug">{notice ? t(noticeKey[notice][0]) : ''}</DialogTitle>
            <DialogDescription className="text-[15px] leading-relaxed text-foreground/85">
              {notice ? t(noticeKey[notice][1]) : ''}
            </DialogDescription>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="mt-2 h-11 w-full rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground"
            >
              {t('voice_ok')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
