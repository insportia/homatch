// HOMATCH — AI TALK, the hero demonstration.
//
// §26 is emphatic about what this is NOT. It is not a replacement for AI Chat,
// which remains its own product on its own route. It is not a redesign of the
// homepage. It replaces exactly one thing: the static photograph that sat in
// the hero's right-hand plate, and nothing else on the page moves.
//
// §133 is the test it has to pass: the left column stays where it was, the
// hero does not grow taller, the next section does not move, and nothing shifts
// after load. So this component renders at a FIXED aspect on every breakpoint
// and reserves its own space before the voice runtime is anywhere near loaded.
//
// WHY THE RUNTIME IS LAZY
//
// §85: "Do not load heavy realtime voice code on every route." voiceClient.ts
// pulls in audio plumbing that a visitor who never presses the button should
// not download. It is imported on the first press, not at module scope.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, PhoneOff, ArrowRight, AudioLines } from 'lucide-react';
import { useMotion } from '@/hooks/useMotion';
import { useSectionField, useFieldProps } from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import type { VoiceSession, VoiceState } from '@/lib/comm/voiceClient';
import type { TranscriptTurn } from '@/lib/comm/transcript';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/*
 * EVERY STATE HAS A NAME AND A LOOK.
 *
 * The panel used to say almost nothing about itself: a badge, a language list,
 * and an orb with two appearances across eleven possible states. A visitor
 * could not tell "ready" from "ended", or "thinking" from "answering", which
 * is the entire point of showing a live voice agent at all.
 *
 * Each state now maps to a word (already reviewed in six languages) and a
 * tone, and both are rendered in the same place every time, so the panel reads
 * as a machine reporting on itself rather than as a decoration.
 */
const STATE_KEY = {
  IDLE: 'talk_state_idle',
  CONNECTING: 'talk_state_connecting',
  LISTENING: 'talk_state_listening',
  UNDERSTANDING: 'talk_state_understanding',
  RESPONDING: 'talk_state_responding',
  INTERRUPTED: 'talk_state_interrupted',
  RECONNECTING: 'talk_state_reconnecting',
  ENDED: 'talk_state_ended',
  LIMIT_REACHED: 'talk_state_limit_reached',
  MIC_DENIED: 'talk_state_mic_denied',
  MIC_UNAVAILABLE: 'talk_state_mic_unavailable',
  PROVIDER_ERROR: 'talk_state_provider_error',
} satisfies Record<VoiceState, string>;

/** dot = the indicator colour, beat = whether it should throb. */
function toneOf(state: VoiceState): { dot: string; chip: string; beat: boolean } {
  switch (state) {
    case 'LISTENING':
    case 'INTERRUPTED':
      return { dot: 'bg-emerald-400', chip: 'bg-emerald-400/10 text-emerald-200', beat: true };
    case 'UNDERSTANDING':
      return { dot: 'bg-white', chip: 'bg-white/10 text-white', beat: true };
    case 'RESPONDING':
      return { dot: 'bg-gold', chip: 'bg-gold/15 text-gold', beat: true };
    case 'CONNECTING':
    case 'RECONNECTING':
      return { dot: 'bg-amber-300', chip: 'bg-amber-300/10 text-amber-200', beat: true };
    case 'MIC_DENIED':
    case 'MIC_UNAVAILABLE':
    case 'PROVIDER_ERROR':
      return { dot: 'bg-rose-400', chip: 'bg-rose-400/10 text-rose-200', beat: false };
    case 'ENDED':
    case 'LIMIT_REACHED':
      return { dot: 'bg-white/50', chip: 'bg-white/5 text-white/70', beat: false };
    default:
      return { dot: 'bg-gold/80', chip: 'bg-white/5 text-white/70', beat: false };
  }
}

interface Intelligence {
  transactionType?: string | null;
  locations?: string[] | null;
  budgetMax?: number | null;
  currency?: string | null;
  bedrooms?: number | null;
  intentScore?: number | null;
}

export function AiTalkPanel({ className }: { className?: string }) {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [state, setState] = useState<VoiceState>('IDLE');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  /**
   * The last thing that went wrong mid-conversation.
   *
   * Separate from `state`, because most of these are RECOVERABLE: one turn
   * failed and the session is still listening. Folding them into the state
   * machine would end a conversation that is still alive.
   */
  const [failure, setFailure] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const sessionRef = useRef<VoiceSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const grantedRef = useRef<number>(0);
  /** Sent with each turn so the reply is in context. Bounded to recent turns. */
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const heartbeatRef = useRef<number | null>(null);
  const turnsRef = useRef<TranscriptTurn[]>([]);

  useEffect(() => { turnsRef.current = turns; }, [turns]);

  const cleanup = useCallback(() => {
    if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    void sessionRef.current?.stop('unmount');
    sessionRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const endSession = useCallback(async (reason: string) => {
    if (heartbeatRef.current !== null) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    const consumed = sessionRef.current?.consumedSeconds ?? 0;
    await sessionRef.current?.stop(reason);
    sessionRef.current = null;
    if (sessionIdRef.current) {
      // Best effort. The server's own expiry ends the session whether or not
      // this lands, which is exactly why the expiry exists (§28).
      void supabase.functions.invoke('ai-talk-session', {
        body: { action: 'end', sessionId: sessionIdRef.current, consumedSeconds: consumed, endedReason: reason },
      });
      sessionIdRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setState('CONNECTING');
    setTurns([]);
    setIntelligence(null);
    setFailure(null);
    historyRef.current = [];

    const { data, error } = await supabase.functions.invoke('ai-talk-session', {
      body: { action: 'start', locale: language },
    });

    const grant = data as {
      ok?: boolean; sessionId?: string; grantedSeconds?: number; token?: string;
      voiceId?: string; userMessage?: string;
    } | null;

    // No agentId to check any more: there is no provider-side agent in this
    // path. The token is the only thing the browser needs, and it is scoped to
    // transcription alone.
    if (error || !grant?.ok || !grant.token) {
      // §92/§134: a friendly outcome, never a raw API exception, and the hero
      // does not break.
      setState(grant?.userMessage === 'LIMIT_REACHED' ? 'LIMIT_REACHED' : 'PROVIDER_ERROR');
      return;
    }

    sessionIdRef.current = grant.sessionId ?? null;
    grantedRef.current = grant.grantedSeconds ?? 60;
    setRemaining(grantedRef.current);

    // Loaded on press, not on page load (§85).
    const { VoiceSession: Session } = await import('@/lib/comm/voiceClient');

    const session = new Session(
      {
        token: grant.token,
        primaryLanguage: language,
        maxDurationSec: grantedRef.current,
      },
      {
        onState: (s) => setState(s),
        onTranscript: (next) => setTurns([...next]),
        onLanguage: (lang) => setDetectedLanguage(lang),
        onLevel: (l) => setLevel(l),
        onSecondsConsumed: (consumed) => setRemaining(Math.max(0, grantedRef.current - consumed)),
        onError: (code) => setFailure(code),
        /*
         * One turn: their sentence out, our sentence and our voice back.
         *
         * The reply and the audio arrive together, from the server, which is
         * what makes the assistant transcript possible at all — and what makes
         * the voice ours rather than a provider default.
         */
        onUserTurn: async (text) => {
          if (!sessionIdRef.current) return null;
          const { data: turn, error: turnError } = await supabase.functions.invoke('ai-talk-session', {
            body: {
              action: 'turn',
              sessionId: sessionIdRef.current,
              text,
              locale: language,
              history: historyRef.current.slice(-8),
            },
          });
          const reply = turn as {
            ok?: boolean; text?: string; audioBase64?: string | null; mime?: string; voiceId?: string;
          } | null;
          if (turnError || !reply?.ok || !reply.text) return null;

          historyRef.current = [
            ...historyRef.current,
            { role: 'user' as const, content: text },
            { role: 'assistant' as const, content: reply.text },
          ].slice(-12);

          return {
            text: reply.text,
            audioBase64: reply.audioBase64 ?? null,
            mime: reply.mime,
            voiceId: reply.voiceId,
          };
        },
      },
    );

    sessionRef.current = session;
    await session.start();

    // The heartbeat is what makes the allowance real: the server clamps the
    // reported figure against its own clock and ends the session when the
    // grant is spent, whatever this page believes.
    heartbeatRef.current = window.setInterval(async () => {
      if (!sessionIdRef.current || !sessionRef.current) return;
      const transcript = turnsRef.current.map((turn) => turn.text).join(' ').slice(-2000);
      const { data: beat } = await supabase.functions.invoke('ai-talk-session', {
        body: {
          action: 'heartbeat',
          sessionId: sessionIdRef.current,
          consumedSeconds: sessionRef.current.consumedSeconds,
          transcript,
        },
      });
      const result = beat as { ended?: boolean; remainingSeconds?: number; intelligence?: Intelligence | null } | null;
      if (result?.intelligence) setIntelligence(result.intelligence);
      if (typeof result?.remainingSeconds === 'number') setRemaining(result.remainingSeconds);
      if (result?.ended) {
        await endSession('allowance');
        setState('LIMIT_REACHED');
      }
    }, 5000);
  }, [language, endSession]);

  const live = ['LISTENING', 'UNDERSTANDING', 'RESPONDING', 'INTERRUPTED'].includes(state);
  const busy = state === 'CONNECTING';
  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <div
      className={cn(
        // §133 still holds: the panel reserves its own space before the voice
        // runtime exists, so nothing shifts after load. But a 4:3 BOX was the
        // wrong way to reserve it. At 320px the panel is 288px wide, so 4:3
        // gave it 216px of height to hold a 64px disc, a title, three lines of
        // body and two buttons -- and `overflow-hidden` quietly ate the
        // difference. A fixed HEIGHT reserves space just as deterministically
        // and is not hostage to how narrow the phone is.
        'relative flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm',
        'h-[23rem] sm:h-[25rem] lg:h-auto lg:aspect-[4/3]',
        className,
      )}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-gold">
          <AudioLines className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {/* Below sm the state pill gets the room instead. The same words are
              the panel's headline two lines further down, so nothing is lost,
              and a long Georgian badge no longer has to fight a long Georgian
              status label over 288px. */}
          <span className="hidden min-w-0 truncate sm:inline" {...fp('talk_badge')}>
            {sf('talk_badge', 'talk_badge')}
          </span>
        </span>
        <StatusPill state={state} remaining={live ? remaining : null} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-3 sm:px-4">
        {state === 'IDLE' || state === 'ENDED' || state === 'LIMIT_REACHED' || state === 'MIC_DENIED' || state === 'MIC_UNAVAILABLE' || state === 'PROVIDER_ERROR' ? (
          <RestingFace
            state={state}
            onStart={() => void start()}
            onContinue={() => navigate('/ai')}
          />
        ) : (
          <LiveFace
            state={state}
            level={level}
            turns={turns}
            detectedLanguage={detectedLanguage}
            failure={failure}
          />
        )}
      </div>

      {intelligence && live ? <IntelligenceStrip data={intelligence} /> : null}

      {live ? (
        <div className="flex items-center justify-center border-t border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => void endSession('user_ended')}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <PhoneOff className="h-3 w-3" aria-hidden="true" />
            {t('talk_end')}
          </button>
        </div>
      ) : null}

      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="h-5 w-5 animate-spin text-gold" aria-hidden="true" />
          <span className="sr-only">{t('talk_state_connecting')}</span>
        </div>
      ) : null}
    </div>
  );
}

function RestingFace({
  state, onStart, onContinue,
}: { state: VoiceState; onStart: () => void; onContinue: () => void }) {
  const { t } = useLanguage();

  const messageKey: Record<string, string> = {
    IDLE: 'talk_idle_body',
    ENDED: 'talk_ended_body',
    LIMIT_REACHED: 'talk_limit_body',
    MIC_DENIED: 'talk_mic_denied_body',
    MIC_UNAVAILABLE: 'talk_mic_unavailable_body',
    PROVIDER_ERROR: 'talk_unavailable_body',
  };

  const unavailable = state === 'PROVIDER_ERROR' || state === 'MIC_DENIED' || state === 'MIC_UNAVAILABLE';
  const finished = state === 'ENDED' || state === 'LIMIT_REACHED';

  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className={cn(
        'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border sm:h-16 sm:w-16',
        unavailable ? 'border-white/15 bg-white/5' : 'border-gold/40 bg-gold/10',
      )}>
        {unavailable
          ? <MicOff className="h-6 w-6 text-white/50" aria-hidden="true" />
          : <Mic className="h-6 w-6 text-gold" aria-hidden="true" />}
      </div>

      <p className="mt-3 text-[15px] font-semibold text-white sm:text-base" {...fp('talk_title')}>
        {sf('talk_title', 'talk_title')}
      </p>
      <p className="mt-1 max-w-[22rem] text-pretty text-[13px] leading-relaxed text-white/60">
        {t(messageKey[state] as TKey)}
      </p>
      {/* The languages moved out of the header, where they shared a 288px row
          with the badge, into the body, where they have the width to be read
          in any of the languages they name. */}
      <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-white/40" {...fp('talk_languages')}>
        {sf('talk_languages', 'talk_languages')}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {!unavailable ? (
          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90"
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            {t(finished ? 'talk_again' : 'talk_start')}
          </button>
        ) : null}

        {/* §132: one relevant CTA at the end, not a paywall and not signup spam. */}
        {finished || unavailable ? (
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3.5 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/5"
          >
            {t('talk_continue')}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LiveFace({
  state, level, turns, detectedLanguage, failure,
}: {
  state: VoiceState; level: number; turns: TranscriptTurn[];
  detectedLanguage: string | null; failure: string | null;
}) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-center gap-3 pb-2">
        <Orb level={level} state={state} />
        <div className="min-w-0 text-start">
          <p className="truncate text-sm font-semibold text-white">{t(STATE_KEY[state] as TKey)}</p>
          {detectedLanguage ? (
            <p className="text-[13px] uppercase tracking-wide text-white/40">{detectedLanguage}</p>
          ) : null}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 text-start">
        {turns.length === 0 ? (
          <p className="pt-4 text-center text-[13px] text-white/40">{t('talk_say_something')}</p>
        ) : turns.map((turn) => (
          /* Named, because a conversation with two voices and one colour is a
             wall of text. The label is what makes it read as a dialogue. */
          <div key={turn.id} className="min-w-0">
            <p
              className={cn(
                'text-2xs font-semibold uppercase tracking-wide',
                turn.speaker === 'USER' ? 'text-white/40' : 'text-gold/60',
              )}
            >
              {turn.speaker === 'USER' ? t('talk_speaker_you') : t('ai_title')}
            </p>
            <p
              className={cn(
                'text-[13px] leading-relaxed [overflow-wrap:anywhere]',
                turn.speaker === 'USER' ? 'text-white/85' : 'text-gold/90',
                // A partial is visibly provisional, because it is about to be
                // replaced by a better version of itself (§24).
                !turn.final && 'text-white/45 italic',
              )}
            >
              {turn.text}
            </p>
          </div>
        ))}
      </div>

      {/* A turn that failed while the session is still alive. Shown under the
          transcript rather than as a state, because the conversation has not
          ended and telling somebody it has would be wrong. */}
      {failure ? (
        <p className="mt-1.5 px-1 text-start text-2xs leading-snug text-rose-300/90 [overflow-wrap:anywhere]">
          {t(FAILURE_KEY[failure] ?? 'talk_err_assistant')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A mid-conversation failure, as a sentence.
 *
 * Every one of these leaves the session listening, so none of them is a
 * state — they are things that went wrong on one turn and are worth saying
 * without ending anything.
 */
const FAILURE_KEY: Record<string, string> = {
  ASSISTANT_FAILED: 'talk_err_assistant',
  VOICE_UNAVAILABLE: 'talk_err_voice',
  PLAYBACK_FAILED: 'talk_err_playback',
  PLAYBACK_BLOCKED: 'talk_err_playback',
  STT_UNAVAILABLE: 'talk_err_stt',
};

/**
 * THE ORB, WITH FOUR FACES INSTEAD OF TWO.
 *
 * Listening is bars driven by the real microphone amplitude, so a visitor can
 * see that it is genuinely hearing them rather than watching a loop. Thinking
 * is three settling dots. Answering is gold bars on their own clock, because
 * the agent's own output level is not exposed to this side. Anything else is a
 * quiet disc tinted by the same tone the header pill uses.
 *
 * §84 still applies: the state is written in words twice over -- the pill in
 * the header and the label beside this -- so the animation is never the only
 * way to know what is happening.
 */
const LISTEN_BARS = [0.55, 0.85, 1, 0.8, 0.5];

function Orb({ level, state }: { level: number; state: VoiceState }) {
  const still = useMotion() === 'none';
  const listening = state === 'LISTENING' || state === 'INTERRUPTED';
  const thinking = state === 'UNDERSTANDING';
  const speaking = state === 'RESPONDING';
  const tone = toneOf(state);

  /** Real energy, clamped so a cough does not fill the panel. */
  const amp = listening ? Math.min(1, Math.max(0, level) * 2.6) : 0;

  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className={cn(
          'absolute inset-0 rounded-full transition-transform duration-150',
          speaking ? 'bg-gold/25' : listening ? 'bg-emerald-400/20' : 'bg-white/10',
        )}
        style={{ transform: `scale(${listening ? 1 + amp * 0.45 : speaking ? 1.2 : 1})` }}
      />
      {thinking ? (
        <span className="relative flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn('h-1.5 w-1.5 rounded-full bg-white/85', !still && 'animate-bounce')}
              style={still ? undefined : { animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      ) : listening || speaking ? (
        <span className="relative flex h-6 items-center gap-[3px]">
          {LISTEN_BARS.map((f, i) => (
            <span
              key={i}
              className={cn(
                'w-[3px] origin-center rounded-full',
                speaking ? 'bg-gold' : 'bg-white/85',
                speaking && !still && 'hm-talk-bar',
              )}
              style={{
                height: speaking ? '100%' : `${Math.round((0.3 + amp * f * 0.7) * 24)}px`,
                animationDelay: speaking ? `${i * 110}ms` : undefined,
                transition: still ? undefined : 'height 90ms linear',
              }}
            />
          ))}
        </span>
      ) : (
        <span className={cn('relative h-5 w-5 rounded-full', tone.dot)} />
      )}
    </span>
  );
}

/** The header's permanent answer to "what is it doing right now?". */
function StatusPill({ state, remaining }: { state: VoiceState; remaining: number | null }) {
  const { t } = useLanguage();
  const still = useMotion() === 'none';
  const tone = toneOf(state);
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-[62%] items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-medium sm:max-w-[55%]',
        tone.chip,
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {tone.beat && !still ? (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', tone.dot)} />
        ) : null}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', tone.dot)} />
      </span>
      <span className="truncate">{t(STATE_KEY[state] as TKey)}</span>
      {remaining !== null ? (
        <span className="shrink-0 font-mono tabular-nums opacity-70">
          {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
        </span>
      ) : null}
    </span>
  );
}

/**
 * §27's live intelligence.
 *
 * This is the part that distinguishes the demo from a voice toy: as the
 * conversation reveals intent, structured chips appear. Every value comes from
 * the server's deterministic extraction over what was actually said — nothing
 * here is invented to make the demo look clever, and an empty conversation
 * shows no chips at all.
 */
function IntelligenceStrip({ data }: { data: Intelligence }) {
  const { t, lang: language } = useLanguage();

  const chips: string[] = [];
  if (data.transactionType) chips.push(t(`talk_intent_${String(data.transactionType).toLowerCase()}` as TKey));
  for (const loc of (data.locations ?? []).slice(0, 2)) chips.push(capitalise(loc));
  if (data.bedrooms != null) chips.push(t('talk_chip_bedrooms').replace('{n}', String(data.bedrooms)));
  if (data.budgetMax) {
    chips.push(new Intl.NumberFormat(language, {
      style: 'currency', currency: data.currency ?? 'USD', maximumFractionDigits: 0,
    }).format(data.budgetMax));
  }
  if (!chips.length) return null;

  return (
    <div className="border-t border-white/10 px-3 py-2">
      <p className="mb-1.5 text-[13px] uppercase tracking-[0.16em] text-gold/70">{t('talk_understood')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[13px] text-gold"
          >
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}

function capitalise(s: string): string {
  return s.replace(/-/g, ' ').replace(/^\p{L}/u, (c) => c.toUpperCase());
}
