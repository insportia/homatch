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
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import type { VoiceSession, VoiceState } from '@/lib/comm/voiceClient';
import type { TranscriptTurn } from '@/lib/comm/transcript';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

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
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const sessionRef = useRef<VoiceSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const grantedRef = useRef<number>(0);
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

    const { data, error } = await supabase.functions.invoke('ai-talk-session', {
      body: { action: 'start', locale: language },
    });

    const grant = data as {
      ok?: boolean; sessionId?: string; grantedSeconds?: number; token?: string;
      agentId?: string; instructions?: string; userMessage?: string;
    } | null;

    if (error || !grant?.ok || !grant.token || !grant.agentId) {
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
        agentId: grant.agentId,
        systemPrompt: grant.instructions ?? '',
        firstMessage: '',
        voiceId: null,
        primaryLanguage: language,
        maxDurationSec: grantedRef.current,
      },
      {
        onState: (s) => setState(s),
        onTranscript: (next) => setTurns([...next]),
        onLanguage: (lang) => setDetectedLanguage(lang),
        onLevel: (l) => setLevel(l),
        onSecondsConsumed: (consumed) => setRemaining(Math.max(0, grantedRef.current - consumed)),
        onError: () => { /* the state callback already carried it */ },
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

  return (
    <div
      className={cn(
        // Fixed aspect so the hero's height is identical before and after the
        // runtime loads. §133: no cumulative layout shift.
        'relative flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm',
        'aspect-[4/3] sm:aspect-[5/4] lg:aspect-[4/3]',
        className,
      )}
      aria-live="polite"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-gold">
          <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
          {t('talk_badge')}
        </span>
        {live && remaining !== null ? (
          <span className="font-mono text-[13px] tabular-nums text-white/60">
            {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
          </span>
        ) : (
          <span className="text-[13px] text-white/50">{t('talk_languages')}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-3">
        {state === 'IDLE' || state === 'ENDED' || state === 'LIMIT_REACHED' || state === 'MIC_DENIED' || state === 'PROVIDER_ERROR' ? (
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
    PROVIDER_ERROR: 'talk_unavailable_body',
  };

  const unavailable = state === 'PROVIDER_ERROR' || state === 'MIC_DENIED';
  const finished = state === 'ENDED' || state === 'LIMIT_REACHED';

  return (
    <div className="flex flex-col items-center text-center">
      <div className={cn(
        'flex h-16 w-16 items-center justify-center rounded-full border',
        unavailable ? 'border-white/15 bg-white/5' : 'border-gold/40 bg-gold/10',
      )}>
        {unavailable
          ? <MicOff className="h-6 w-6 text-white/50" aria-hidden="true" />
          : <Mic className="h-6 w-6 text-gold" aria-hidden="true" />}
      </div>

      <p className="mt-3 text-base font-semibold text-white">{t('talk_title')}</p>
      <p className="mt-1 max-w-[22rem] text-pretty text-[13px] leading-relaxed text-white/60">
        {t(messageKey[state] as TKey)}
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
  state, level, turns, detectedLanguage,
}: { state: VoiceState; level: number; turns: TranscriptTurn[]; detectedLanguage: string | null }) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const stateKey: Record<string, string> = {
    LISTENING: 'talk_state_listening',
    UNDERSTANDING: 'talk_state_understanding',
    RESPONDING: 'talk_state_responding',
    INTERRUPTED: 'talk_state_listening',
    RECONNECTING: 'talk_state_reconnecting',
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-center gap-3 pb-2">
        <Orb level={level} state={state} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-white">{t(stateKey[state] as TKey)}</p>
          {detectedLanguage ? (
            <p className="text-[13px] uppercase tracking-wide text-white/40">{detectedLanguage}</p>
          ) : null}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 text-start">
        {turns.length === 0 ? (
          <p className="pt-4 text-center text-[13px] text-white/40">{t('talk_say_something')}</p>
        ) : turns.map((turn) => (
          <p
            key={turn.id}
            className={cn(
              'text-[13px] leading-relaxed',
              turn.speaker === 'USER' ? 'text-white/85' : 'text-gold/90',
              // A partial is visibly provisional, because it is about to be
              // replaced by a better version of itself (§24).
              !turn.final && 'text-white/45 italic',
            )}
          >
            {turn.text}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * The orb.
 *
 * Reacts to real microphone energy rather than running a decorative animation,
 * so a visitor can see that it is actually hearing them. §84: the state is also
 * written in words beside it, so this is never the only signal.
 */
function Orb({ level, state }: { level: number; state: VoiceState }) {
  const scale = 1 + Math.min(0.45, level * 2.2);
  const responding = state === 'RESPONDING';
  return (
    <span className="relative flex h-11 w-11 items-center justify-center" aria-hidden="true">
      <span
        className={cn(
          'absolute inset-0 rounded-full transition-transform duration-100',
          responding ? 'bg-gold/25' : 'bg-white/15',
        )}
        style={{ transform: `scale(${responding ? 1.25 : scale})` }}
      />
      <span className={cn(
        'relative h-6 w-6 rounded-full',
        responding ? 'bg-gold' : 'bg-white/80',
      )} />
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
