/*
 * HOMI VOICE MESSAGES: the microphone in the composer.
 *
 * Hold to talk and let go to send, or tap once to start and send when ready.
 * While recording, a panel covers the composer row: cancel, a live timer with
 * the two minute limit, the waveform of the voice as it comes in, and send.
 * The panel is absolutely positioned, so the composer row it sits in must be
 * `relative` (the only change this needs from its host page).
 *
 * Money is the server's business (homi-voice-transcribe). Before the
 * microphone opens this asks the server three things: is it on, has this
 * account accepted the price, and how long a message does the balance pay
 * for. The first time, the person sees the price once and agrees; with too
 * little balance they are offered a top up instead of a recording that would
 * be refused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, MicOff, Send, Wallet, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  acceptVoiceConsent, getVoiceStatus, rememberedConsent, transcribeVoiceMessage, VoiceError,
} from '@/services/homiVoice';
import { recorderSupport, shapeOf, useVoiceRecorder, type Recording, type StartError } from './useVoiceRecorder';
import { formatClock, type VoiceNote } from './VoiceMessageBubble';

/** Hold shorter than this and the press counts as a tap. */
const HOLD_MS = 600;
/** Shorter than this holds no words; nothing is sent or charged. */
const MIN_RECORDING_MS = 700;
/** Warn this many seconds before the limit stops the recording. */
const WARN_SECONDS = 10;
const DEFAULT_MAX_SECONDS = 120;

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
  const navigate = useNavigate();
  const rec = useVoiceRecorder();

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<'hold' | 'tap'>('tap');
  const [limitSeconds, setLimitSeconds] = useState(DEFAULT_MAX_SECONDS);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const pressing = useRef(false);
  const pressedAt = useRef(0);
  const pending = useRef<{ recording: Recording; key: string } | null>(null);
  const afterConsent = useRef<'record' | 'resend' | null>(null);
  const sendingRef = useRef(false);

  const reset = useCallback(() => { setPhase('idle'); setErrorKey(null); pending.current = null; }, []);

  /* ── send ─────────────────────────────────────────────────────────── */
  const deliver = useCallback(async () => {
    const p = pending.current;
    if (!p || sendingRef.current) return;
    sendingRef.current = true;
    setPhase('sending');
    setErrorKey(null);
    try {
      const out = await transcribeVoiceMessage({
        segments: p.recording.segments, durationMs: p.recording.durationMs, locale, idempotencyKey: p.key,
      });
      if (out.noSpeech) { setPhase('error'); setErrorKey('voice_no_speech'); pending.current = null; return; }
      const note: VoiceNote = {
        audioUrls: p.recording.segments.map((b) => URL.createObjectURL(b)),
        durationSeconds: out.durationSeconds || p.recording.durationMs / 1000,
        shape: shapeOf(p.recording.levels, 28),
      };
      pending.current = null;
      setPhase('idle');
      onTranscript(out.transcript, note);
    } catch (e) {
      const code = e instanceof VoiceError ? e.code : 'TRANSCRIBE_FAILED';
      if (code === 'INSUFFICIENT_CREDITS') { setPhase('idle'); setTopupOpen(true); return; }
      if (code === 'CONSENT_REQUIRED') { afterConsent.current = 'resend'; setPhase('idle'); setConsentOpen(true); return; }
      if (code === 'SERVICE_DISABLED' || code === 'UNAVAILABLE') { pending.current = null; setPhase('idle'); setNotice('unavailable'); return; }
      setPhase('error');
      setErrorKey(code === 'TOO_LONG' || code === 'TOO_LARGE' ? 'voice_too_long' : 'voice_failed');
      if (code === 'TOO_LONG' || code === 'TOO_LARGE' || code === 'EMPTY') pending.current = null;
    } finally {
      sendingRef.current = false;
    }
  }, [locale, onTranscript]);

  const finish = useCallback(async () => {
    if (!rec.recording) return;
    const recording = await rec.stop();
    if (!recording || recording.durationMs < MIN_RECORDING_MS || recording.segments.length === 0) {
      setPhase('error'); setErrorKey('voice_too_short'); return;
    }
    pending.current = { recording, key: crypto.randomUUID() };
    void deliver();
  }, [rec, deliver]);

  const cancel = useCallback(() => { rec.cancel(); reset(); }, [rec, reset]);

  /* ── start ────────────────────────────────────────────────────────── */
  const beginRecording = useCallback(async (limit: number) => {
    const failed = await rec.start();
    if (failed) { setPhase('idle'); setNotice(failed); return; }
    setLimitSeconds(limit);
    // Still holding once the microphone is open: hold to talk. Otherwise
    // (a tap, or a permission prompt in between) it records until sent.
    setMode(pressing.current ? 'hold' : 'tap');
    setPhase('recording');
  }, [rec]);

  const open = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    setErrorKey(null);
    const support = recorderSupport();
    if (support !== 'ok') { setNotice(support); return; }
    setPhase('checking');
    let limit = DEFAULT_MAX_SECONDS;
    try {
      const s = await getVoiceStatus();
      if (!s.available) { setPhase('idle'); setNotice('unavailable'); return; }
      limit = s.maxSeconds;
      if (s.affordableSeconds != null) {
        if (s.affordableSeconds < s.incrementSeconds) { setPhase('idle'); setTopupOpen(true); return; }
        limit = Math.min(limit, s.affordableSeconds);
      }
      if (!s.consented) { afterConsent.current = 'record'; setLimitSeconds(limit); setPhase('idle'); setConsentOpen(true); return; }
    } catch (e) {
      const code = e instanceof VoiceError ? e.code : 'NETWORK';
      if (code === 'SERVICE_DISABLED') { setPhase('idle'); setNotice('unavailable'); return; }
      /* The server could not be asked. With a remembered acceptance the
         recording may go ahead: the server still checks everything when it
         arrives. Without one, the price is shown first. */
      if (!rememberedConsent()) { afterConsent.current = 'record'; setPhase('idle'); setConsentOpen(true); return; }
    }
    await beginRecording(limit);
  }, [phase, beginRecording]);

  /* ── consent ──────────────────────────────────────────────────────── */
  const accept = async () => {
    setConsentBusy(true);
    try {
      await acceptVoiceConsent();
    } catch {
      setConsentBusy(false);
      setConsentOpen(false);
      setPhase('error');
      setErrorKey('voice_failed');
      return;
    }
    setConsentBusy(false);
    setConsentOpen(false);
    const next = afterConsent.current;
    afterConsent.current = null;
    if (next === 'resend') void deliver();
    else if (next === 'record') await beginRecording(limitSeconds);
  };

  const decline = () => {
    setConsentOpen(false);
    afterConsent.current = null;
    pending.current = null;
    setPhase('idle');
  };

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

  /* The limit stops the recording and sends what was said. */
  const elapsedSeconds = rec.elapsedMs / 1000;
  useEffect(() => {
    if (phase === 'recording' && elapsedSeconds >= limitSeconds) void finish();
  }, [phase, elapsedSeconds, limitSeconds, finish]);

  const remaining = Math.max(0, Math.ceil(limitSeconds - elapsedSeconds));
  const warn = phase === 'recording' && remaining <= WARN_SECONDS;
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
                    <span className="font-normal text-white/45"> / {formatClock(limitSeconds)}</span>
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
                <p className={`truncate text-[13px] ${warn ? 'font-medium text-amber-300' : 'text-white/60'}`}>
                  {warn
                    ? t('voice_time_left', { seconds: remaining })
                    : mode === 'hold' ? t('voice_hold_hint') : t('voice_tap_hint')}
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
          {phase === 'error' && pending.current && (
            <button
              type="button"
              onClick={() => void deliver()}
              className="h-11 shrink-0 rounded-full bg-[hsl(38_92%_54%)] px-4 text-sm font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t('voice_retry')}
            </button>
          )}
          {phase === 'error' && !pending.current && (
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

      {/* First tap: the price, once. */}
      <Dialog open={consentOpen} onOpenChange={(o) => { if (!o) decline(); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-0 overflow-hidden rounded-2xl border-[hsl(var(--gold-border))] p-0">
          <div className="flex flex-col items-center gap-3 bg-[#0C1119] px-6 pb-5 pt-7 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-[hsl(38_92%_54%)]/15 ring-1 ring-inset ring-[hsl(38_92%_56%)]/45">
              <Mic className="h-6 w-6 text-[hsl(38_92%_62%)]" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold leading-snug text-white">{t('voice_consent_title')}</DialogTitle>
          </div>
          <div className="px-6 pb-6 pt-5">
            <DialogDescription className="text-center text-[15px] leading-relaxed text-foreground">
              {t('voice_consent_body')}
            </DialogDescription>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => void accept()}
                disabled={consentBusy}
                className="flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(38_92%_54%)] px-5 text-[15px] font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-70"
              >
                {consentBusy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
                {t('voice_consent_accept')}
              </button>
              <button
                type="button"
                onClick={decline}
                className="h-12 rounded-full border border-border px-5 text-[15px] font-medium text-foreground hover:bg-secondary"
              >
                {t('voice_consent_decline')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Not enough balance: a top up, not a refusal. */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-0 overflow-hidden rounded-2xl border-[hsl(var(--gold-border))] p-0">
          <div className="flex flex-col items-center gap-3 bg-[#0C1119] px-6 pb-5 pt-7 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-[hsl(38_92%_54%)]/15 ring-1 ring-inset ring-[hsl(38_92%_56%)]/45">
              <Wallet className="h-6 w-6 text-[hsl(38_92%_62%)]" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold leading-snug text-white">{t('voice_topup_title')}</DialogTitle>
          </div>
          <div className="px-6 pb-6 pt-5">
            <DialogDescription className="text-center text-[15px] leading-relaxed text-foreground">
              {t('voice_topup_body')}
            </DialogDescription>
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="rounded-full border border-[hsl(var(--gold-border))] bg-gold/10 px-3 py-1 text-[13px] font-medium text-gold-ink">{t('voice_price_chip')}</span>
              <span className="rounded-full border border-border bg-secondary px-3 py-1 text-[13px] font-medium text-foreground">{t('voice_topup_min_chip')}</span>
            </div>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => { setTopupOpen(false); navigate('/credits'); }}
                className="h-12 rounded-full bg-[hsl(38_92%_54%)] px-5 text-[15px] font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)]"
              >
                {t('voice_topup_action')}
              </button>
              <button
                type="button"
                onClick={() => { setTopupOpen(false); pending.current = null; }}
                className="h-12 rounded-full border border-border px-5 text-[15px] font-medium text-foreground hover:bg-secondary"
              >
                {t('voice_topup_later')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
