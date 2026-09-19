// HOMATCH — AI TALK, the hero demonstration.
//
// §26 is emphatic about what this is NOT. It is not a replacement for AI Chat,
// which remains its own product on its own route. It is not a redesign of the
// homepage. It replaces exactly one thing: the static photograph that sat in
// the hero's right-hand plate, and nothing else on the page moves.
//
// §133 is the test it has to pass: the left column stays where it was, the
// hero does not grow taller, the next section does not move, and nothing
// shifts after load. So this component reserves its own space before the
// voice runtime is anywhere near loaded.
//
// WHAT THIS SURFACE IS FOR, AND WHAT IT IS NOT
//
// It is the first thing a visitor meets, and for a while it read like an
// instrument panel: the state named in three places, byte counters, a
// diagnostics table. All of that was real and all of it was necessary to find
// a specific defect — and none of it is the product. Somebody arriving here
// should see something that is listening to them, the words they said, and
// the answer. Nothing else.
//
// The diagnostics still exist, in full, behind ?debugAiTalk=1. Deleting them
// would mean the next fault is found the same expensive way as the last one.
//
// WHY THE RUNTIME IS LAZY
//
// §85: "Do not load heavy realtime voice code on every route." voiceClient.ts
// pulls in audio plumbing that a visitor who never presses the button should
// not download. It is imported on the first press, not at module scope.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, ArrowRight, RotateCcw } from 'lucide-react';
import { useSectionField, useFieldProps, useNotEditable } from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import type { VoiceSession, VoiceState, VoiceDiagnostics } from '@/lib/comm/voiceClient';
import { AiTalkDiagnostics } from './AiTalkDiagnostics';
import { AiTalkOrb, type OrbMode } from './AiTalkOrb';
import { converseStream } from '@/lib/comm/converse';
import type { TranscriptTurn } from '@/lib/comm/transcript';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/**
 * One word for what is happening, in six languages.
 *
 * Shown once, quietly, at the top — not three times in three sizes. The orb
 * carries the state; this is for anybody who cannot see it, and for anybody
 * who wants it named.
 */
/*
 * STATES THE PANEL REACHES THAT A VOICE SESSION NEVER DOES.
 *
 * A refusal happens BEFORE any session exists, so VoiceState has no word for
 * one, and every refusal was therefore rendered as PROVIDER_ERROR -- whose
 * status line is the single word "Unavailable". That is how an exhausted
 * free allowance, a second tab, and a provider outage all reached the
 * visitor as the same sentence about the product being broken.
 *
 * Giving the refusals their own states is what lets a known reason beat the
 * generic one everywhere the state is read: the status word, the colour of
 * the dot, the orb, the sentence, and which button is offered.
 */
export type PanelState =
  | VoiceState
  | 'DAILY_LIMIT_REACHED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'BROWSER_UNSUPPORTED'
  | 'NETWORK_ERROR';

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
  /*
   * None of these four is an outage, and none of them says "Unavailable".
   * A spent allowance renews, a live session is the visitor's own, a browser
   * that cannot reach a microphone is a browser, and a dropped connection is
   * a connection.
   */
  DAILY_LIMIT_REACHED: 'talk_state_daily_limit',
  SESSION_ALREADY_ACTIVE: 'talk_state_session_active',
  BROWSER_UNSUPPORTED: 'talk_state_browser_unsupported',
  NETWORK_ERROR: 'talk_state_network_error',
} satisfies Record<PanelState, string>;

/**
 * The indicator colour, per state family.
 *
 * Listening, thinking, answering, connecting, failed and finished must not
 * share one: the dot is what tells somebody at a glance WHICH thing is
 * happening, and a shared colour reduces it to "something is".
 */
function toneOf(state: PanelState): { dot: string; beat: boolean } {
  switch (state) {
    case 'LISTENING':
    case 'INTERRUPTED':
      return { dot: 'bg-emerald-300', beat: true };
    case 'UNDERSTANDING':
      return { dot: 'bg-white', beat: true };
    case 'RESPONDING':
      return { dot: 'bg-gold', beat: true };
    case 'CONNECTING':
    case 'RECONNECTING':
      return { dot: 'bg-amber-300', beat: true };
    case 'MIC_DENIED':
    case 'MIC_UNAVAILABLE':
    case 'BROWSER_UNSUPPORTED':
    case 'PROVIDER_ERROR':
      return { dot: 'bg-rose-300', beat: false };
    /*
     * Its own colour, and not amber.
     *
     * Amber is CONNECTING, and a dropped connection resting is the one thing
     * that must not look like a connection still being attempted -- somebody
     * would sit and wait for it. The dot is the at-a-glance signal, so no two
     * families may share one.
     */
    case 'NETWORK_ERROR':
      return { dot: 'bg-sky-300', beat: false };
    /*
     * Deliberately NOT red. Red says something is broken, and nothing is:
     * the allowance is spent and renews, or the visitor is already talking
     * somewhere. These rest the same way a finished call rests.
     */
    case 'ENDED':
    case 'LIMIT_REACHED':
    case 'DAILY_LIMIT_REACHED':
    case 'SESSION_ALREADY_ACTIVE':
      return { dot: 'bg-white/40', beat: false };
    default:
      return { dot: 'bg-white/25', beat: false };
  }
}

const ORB_MODE: Record<PanelState, OrbMode> = {
  IDLE: 'IDLE',
  CONNECTING: 'THINKING',
  RECONNECTING: 'THINKING',
  LISTENING: 'LISTENING',
  INTERRUPTED: 'LISTENING',
  UNDERSTANDING: 'THINKING',
  RESPONDING: 'SPEAKING',
  ENDED: 'IDLE',
  LIMIT_REACHED: 'IDLE',
  MIC_DENIED: 'ERROR',
  MIC_UNAVAILABLE: 'ERROR',
  PROVIDER_ERROR: 'ERROR',
  // At rest, not in error: an allowance renews and a live session is theirs.
  DAILY_LIMIT_REACHED: 'IDLE',
  SESSION_ALREADY_ACTIVE: 'IDLE',
  BROWSER_UNSUPPORTED: 'ERROR',
  NETWORK_ERROR: 'ERROR',
};

/**
 * A mid-conversation failure, as a sentence a person can act on.
 *
 * Every one of these leaves the session listening, so none of them is a
 * state — they are things that went wrong on one turn and are worth saying
 * without ending anything. None of them names a provider, a socket, a status
 * code or a model.
 */
const FAILURE_KEY: Record<string, string> = {
  ASSISTANT_FAILED: 'talk_err_assistant',
  VOICE_UNAVAILABLE: 'talk_err_voice',
  /*
   * Deliberately not the same sentence. "Could not be generated this time"
   * invites a retry that will fail identically, because no voice has been
   * approved for this language and none will be until a person approves one.
   */
  VOICE_NOT_APPROVED_FOR_LANGUAGE: 'talk_err_voice_not_approved',
  PLAYBACK_FAILED: 'talk_err_playback',
  PLAYBACK_BLOCKED: 'talk_err_playback',
  /*
   * WHY A QUOTA IS NOT AN OUTAGE.
   *
   * Measured: an iPhone showed the demo as unusable while an Android on
   * another network worked. Neither was a browser problem. The phone's
   * network had spent 2,386 of its 2,400 daily seconds across 50 sessions,
   * and decideGrant refuses a grant shorter than fifteen seconds because a
   * demo that stops mid-sentence reads as broken. Fourteen were left.
   *
   * The visitor was told the demo was over, which is what a FINISHED session
   * is told, so there was nothing to distinguish "you have used today's time"
   * from "this is broken" or from "come back never". Each refusal reason now
   * says which one it is, and all of them say it is temporary.
   */
  DAILY_LIMIT_REACHED: 'talk_quota_daily_body',
  TOO_MANY_SESSIONS_TODAY: 'talk_quota_sessions_body',
  ALREADY_IN_SESSION: 'talk_busy_body',
  PLATFORM_AT_CAPACITY: 'talk_busy_body',
  DISABLED: 'talk_unavailable_body',
  // The browser cannot capture audio at all: not a refusal, not a device.
  BROWSER_UNSUPPORTED: 'talk_browser_unsupported_body',
  // Every microphone outcome has its own sentence; they used to share one.
  MIC_MISSING: 'talk_mic_unavailable_body',
  MIC_BUSY: 'talk_mic_busy_body',
  MIC_TIMEOUT: 'talk_mic_timeout_body',
  AUDIO_UNAVAILABLE: 'talk_audio_unavailable_body',
  /*
   * The reply was produced and nothing was heard: a suspended context, a
   * graph that was never connected, or a provider that answered with
   * silence. Same sentence as a playback failure, because from the visitor's
   * side it is one, and the retry is safe.
   */
  VOICE_SILENT: 'talk_err_playback',
  /*
   * The model answered in the wrong language twice. Not a voice problem and
   * not the visitor's fault; the generic sentence and a retry are right.
   */
  LANGUAGE_UNAVAILABLE: 'talk_err_assistant',
  STT_UNAVAILABLE: 'talk_err_stt',
  TRANSCRIBE_FAILED: 'talk_err_stt',
  NETWORK: 'talk_err_assistant',
  SESSION_NOT_ACTIVE: 'talk_ended_body',
  /*
   * "Temporarily unavailable" for a conversation you already have open.
   *
   * The server refuses a second session while one is still live — two tabs,
   * or a tab closed without ending the session, which expires on its own a
   * minute later. That is a completely different sentence from a provider
   * being down, and it was being told as the same one.
   */
  BUSY: 'talk_busy_body',
};

/*
 * WHICH REFUSAL BECAME WHICH STATE. THE RULE IS: KNOWN BEATS GENERIC.
 *
 * decideGrant names exactly why it said no, and that name has always been in
 * the response. It is mapped here rather than being collapsed into one
 * failure state, because the state decides more than a sentence -- it decides
 * the status word, the colour, and, below, whether "Try again" is offered at
 * all. A reason that is not in this map keeps the generic state, which is
 * what a genuinely unknown refusal deserves.
 */
const REFUSAL_STATE: Record<string, PanelState> = {
  DAILY_LIMIT_REACHED: 'DAILY_LIMIT_REACHED',
  // Same thing to a visitor: today's free allowance is spent. The SENTENCE
  // still differs, because one ran out of minutes and one ran out of calls.
  TOO_MANY_SESSIONS_TODAY: 'DAILY_LIMIT_REACHED',
  ALREADY_IN_SESSION: 'SESSION_ALREADY_ACTIVE',
  // The platform, not this visitor, is at its limit -- but from where they
  // are standing it is the same instruction: wait a moment, then start again.
  PLATFORM_AT_CAPACITY: 'SESSION_ALREADY_ACTIVE',
  BROWSER_UNSUPPORTED: 'BROWSER_UNSUPPORTED',
  // An operator switched the demo off. That IS unavailable, truthfully.
  DISABLED: 'PROVIDER_ERROR',
};

/** What `start` answers with, refused or granted. */
type StartResponse = {
  ok?: boolean;
  sessionId?: string;
  grantedSeconds?: number;
  userMessage?: string;
  /** Which rule refused this, when one did. */
  reason?: string;
  usageTier?: string;
  configuredSessionSeconds?: number;
  /** Over what period a spent allowance is measured, so the copy can be true. */
  window?: string;
};

/*
 * READING A REFUSAL THAT ARRIVED AS AN ERROR.
 *
 * supabase-js does not read the body of a non-2xx response: it throws a
 * FunctionsHttpError with a fixed message and leaves the Response unconsumed
 * on `error.context`. The edge function now answers a refusal with 200 for
 * exactly that reason, so `data` is normally the whole story -- but a build
 * of this page can outlive a deployment of that function, and older runtimes
 * still answer 429. Both are read, so a visitor on a stale tab is told the
 * truth rather than "temporarily unavailable".
 *
 * Same convention as readFunctionErrorBody in VerifyPage.tsx.
 */
async function readStartResponse(data: unknown, error: unknown): Promise<StartResponse | null> {
  const direct = data as StartResponse | null;
  if (direct && typeof direct === 'object' && ('ok' in direct || 'reason' in direct)) return direct;
  const context = (error as { context?: unknown } | null)?.context as Response | undefined;
  if (context && typeof context.json === 'function') {
    try { return await context.json() as StartResponse; } catch { /* not JSON, not a refusal */ }
  }
  return null;
}

interface Intelligence {
  transactionType?: string | null;
  locations?: string[] | null;
  budgetMax?: number | null;
  currency?: string | null;
  bedrooms?: number | null;
  intentScore?: number | null;
}

/**
 * Diagnostics are opt-in, per visit, and never on by accident.
 *
 * ?debugAiTalk=1 turns them on and sessionStorage keeps them on for that tab
 * only, so a developer can navigate around without re-adding the parameter
 * and a visitor cannot inherit it.
 */
function debugRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    /*
     * THE URL, AND ONLY THE URL, ON THIS LOAD.
     *
     * This used to remember the flag in sessionStorage "for that tab" -- and
     * a tab that had once opened ?debugAiTalk=1 then showed the engineering
     * panel on the plain production address for as long as it lived. A
     * normal visitor must never see socket states, sample rates or latency
     * numbers; whoever wants them types the flag. Anything an older build
     * left behind is cleared.
     */
    try { window.sessionStorage?.removeItem('homatch_debug_ai_talk'); } catch { /* fine */ }
    const flag = new URLSearchParams(window.location.search).get('debugAiTalk');
    return flag === '1' || flag === 'true';
  } catch {
    return false;
  }
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-talk-session`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function AiTalkPanel({ className }: { className?: string }) {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [state, setState] = useState<PanelState>('IDLE');
  /*
   * Which allowance was spent, so the sentence can say whose it was.
   *
   * An anonymous visitor's allowance belongs to the NETWORK they are on and
   * is shared with everyone behind it; a signed-in person's belongs to their
   * account and follows them between devices. Telling a signed-in person
   * that "this network" ran out would be a lie, and would send them to
   * change Wi-Fi for no reason. Null until a refusal says otherwise.
   */
  const [refusedTier, setRefusedTier] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  /**
   * The last thing that went wrong mid-conversation.
   *
   * Separate from `state`, because most of these are RECOVERABLE: one turn
   * failed and the session is still listening. Folding them into the state
   * machine would end a conversation that is still alive.
   */
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Seconds left, in a ref rather than in state.
   *
   * It used to be state, which meant a value that changes once a second
   * re-rendered the entire AI TALK card once a second — the orb wrapper, the
   * controls, the status row and the transcript — for the sake of two digits.
   * On a phone that competes with the audio callbacks for the same thread,
   * while the voice is playing.
   *
   * The clock now reads this ref inside its own component, so a tick repaints
   * two digits and nothing else.
   */
  const remainingRef = useRef<number | null>(null);
  const setRemaining = useCallback((value: number | null) => { remainingRef.current = value; }, []);
  /**
   * Where the assistant has offered to take them.
   *
   * One at a time: a voice conversation that accumulates buttons is a menu,
   * and the whole point is that the assistant already decided which one
   * matters. The path is resolved server-side from this app's own route
   * table, so it is never a string the model wrote.
   */
  const [destination, setDestination] = useState<{ key: string; path: string } | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [muted, setMuted] = useState(false);
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics | null>(null);
  const debug = useMemo(debugRequested, []);

  const sessionRef = useRef<VoiceSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const grantedRef = useRef<number>(0);
  const grantInfoRef = useRef<{ usageTier: string | null; configuredSessionSeconds: number | null }>({
    usageTier: null, configuredSessionSeconds: null,
  });
  const detectedRef = useRef<string | null>(null);
  /*
   * The language the session has SETTLED on, and whether it is settled.
   *
   * Separate from detectedRef because a grant is asked for mid-conversation
   * and the answer to "which language" changes as somebody talks. A hint sent
   * before the session is sure is worse than no hint: it pins the transcriber
   * to a guess.
   */
  const languageRef = useRef<string | null>(null);
  /** What the conversation already knows. Carried between turns, not re-derived. */
  const knownRef = useRef<unknown>(null);
  /** Sent with each turn so the reply is in context. Bounded to recent turns. */
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const heartbeatRef = useRef<number | null>(null);
  const turnsRef = useRef<TranscriptTurn[]>([]);
  /*
   * The live level, as a ref rather than as state.
   *
   * The orb reads this fifty times a second inside its own animation frame.
   * Routing it through React state instead re-rendered the whole panel — and
   * the transcript inside it — on every audio block.
   */
  const inputLevel = useRef(0);

  /*
   * THE TRANSCRIPT IS PAINTED ONCE A FRAME, NOT ONCE A TOKEN.
   *
   * onTranscript fires for every delta the model produces — dozens a second —
   * and each one replaced the array, re-rendered every turn in the list and
   * ran a scrollTo. On a desktop that is invisible. On a mid-range phone it
   * is the stutter: React reconciliation and layout competing with the audio
   * callbacks for the same main thread, exactly while the voice is playing.
   *
   * Tokens now land in a ref and the newest value is published on the next
   * frame. Nothing is dropped — the last write before the frame wins, and the
   * last write always carries the whole transcript — and the work per frame
   * is one render instead of thirty.
   */
  /**
   * The signed-in visitor's access token, resolved once when a call starts.
   *
   * Null for the anonymous hero, which is the common case and unchanged. When
   * a Homatch user is signed in — an administrator, for the testing
   * entitlement — their whole AI TALK exchange carries their identity, so the
   * server resolves their usage tier from a verified token rather than seeing
   * an anonymous request.
   */
  const accessTokenRef = useRef<string | null>(null);
  const pendingTurns = useRef<TranscriptTurn[] | null>(null);
  const transcriptFrame = useRef<number | null>(null);

  const publishTurns = useCallback((next: TranscriptTurn[]) => {
    // Copied per turn, not just per array: the session mutates these objects
    // in place as text grows, so sharing them would defeat the row memo below
    // and re-render every line for a change to the last one.
    pendingTurns.current = next.map((turn) => ({ ...turn }));
    if (transcriptFrame.current !== null) return;

    const flush = () => {
      transcriptFrame.current = null;
      const value = pendingTurns.current;
      pendingTurns.current = null;
      if (value) setTurns(value);
    };

    /*
     * A HIDDEN TAB HAS NO ANIMATION FRAMES.
     *
     * requestAnimationFrame is the right way to coalesce paints and the wrong
     * way to coalesce DATA: a backgrounded tab never fires one, so the
     * transcript stopped updating entirely. Caught on the deployed build,
     * where a whole turn completed — audio played, the destination button
     * appeared — and the transcript stayed empty behind them.
     *
     * Visible: one commit per frame, which is the point. Hidden: a timer, so
     * the conversation is still there when somebody comes back to it.
     */
    transcriptFrame.current = document.visibilityState === 'visible'
      ? window.requestAnimationFrame(flush)
      : window.setTimeout(flush, 100);
  }, []);

  useEffect(() => () => {
    if (transcriptFrame.current === null) return;
    // Either kind of handle; cancelling the wrong one is harmless and
    // cancelling neither leaks a pending commit into an unmounted component.
    window.cancelAnimationFrame(transcriptFrame.current);
    window.clearTimeout(transcriptFrame.current);
  }, []);
  const liveState = useRef<PanelState>('IDLE');
  liveState.current = state;

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

  /**
   * Take the assistant up on where it offered to send them.
   *
   * ORDER MATTERS. The session is stopped and awaited BEFORE navigating: a
   * React route change unmounts this panel, and an unmount that races a live
   * microphone, a websocket and a scheduled audio queue is how a voice
   * carries on talking over the next page. Everything is torn down first,
   * then we move.
   */
  const followDestination = useCallback(async (path: string) => {
    await endSession('navigated');
    navigate(path);
  }, [endSession, navigate]);

  const start = useCallback(async () => {
    /*
     * EVERYTHING THAT NEEDS THE GESTURE HAPPENS BEFORE THE FIRST await.
     *
     * WebKit lets a page make sound only when it can attribute the
     * AudioContext to a user gesture, and the gesture does not survive what
     * comes next: a token read, an edge round trip and a 174 KB dynamic
     * import. A context built after those starts suspended and its resume()
     * is refused -- silently, because the session still reaches LISTENING and
     * simply never makes a sound.
     *
     * So it is constructed here, synchronously, in the handler the visitor's
     * tap is still on, and handed to the session below. The module import is
     * started here too and awaited later, which takes the largest single wait
     * off the path between the tap and the microphone.
     */
    const AudioCtx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let primed: AudioContext | null = null;
    if (typeof AudioCtx === 'function') {
      try {
        primed = new AudioCtx();
        // Resuming inside the gesture is the whole point; a rejection here is
        // not fatal, and the session reports the context state either way.
        if (primed.state === 'suspended') void primed.resume().catch(() => {});
      } catch { primed = null; }
    }
    const modulePromise = import('@/lib/comm/voiceClient');

    /*
     * A browser that cannot capture audio is not a broken microphone and not
     * a backend outage. Answered before anything is asked of the network, so
     * nobody is told to check a microphone they were never going to be able
     * to use.
     */
    const { microphoneCapability } = await modulePromise;
    if (microphoneCapability() !== 'OK') {
      try { await primed?.close(); } catch { /* nothing to release */ }
      setFailure('BROWSER_UNSUPPORTED');
      // Not MIC_UNAVAILABLE: the microphone is fine and probably untouched.
      setState('BROWSER_UNSUPPORTED');
      return;
    }

    setState('CONNECTING');
    /*
     * Whose session this is, if anyone's. getSession() reads the token the
     * app already holds; it does not hit the network. Anonymous visitors get
     * null and the anon key, exactly as before.
     */
    try {
      const { data } = await supabase.auth.getSession();
      accessTokenRef.current = data.session?.access_token ?? null;
    } catch { accessTokenRef.current = null; }
    setTurns([]);
    setIntelligence(null);
    setFailure(null);
    setRefusedTier(null);
    setDiagnostics(null);
    setMuted(false);
    setDestination(null);
    detectedRef.current = null;
    /*
     * A NEW SESSION STARTS FROM THE PAGE, NOT FROM THE LAST CONVERSATION.
     *
     * languageRef is what every grant's languageCode is built from, and it
     * was the one ref this reset forgot. A real Windows session ended in
     * Russian; the next Start, minutes later, opened every socket as ru-RU
     * for a speaker who was no longer speaking Russian. Four sockets, 85-96
     * frames each, not one usable final -- so each turn sat on "Thinking"
     * for the no-final window, recovered, and did it again.
     */
    languageRef.current = null;
    knownRef.current = null;
    historyRef.current = [];

    const { data, error } = await supabase.functions.invoke('ai-talk-session', {
      body: { action: 'start', locale: language },
    });

    const grant = await readStartResponse(data, error);

    // The browser is handed no provider capability at all any more: a session
    // id is the whole of what it needs.
    if (error || !grant?.ok || !grant.sessionId) {
      /*
       * THE REASON, NOT THE CATEGORY -- ALL THE WAY TO THE SCREEN.
       *
       * A quota that renews within the day, a conversation already open, and
       * a provider that is down are three different things to be told, and
       * only the last is an outage. `reason` comes straight from decideGrant
       * and now decides the STATE, not just the sentence, so the status line
       * can stop saying "Unavailable" over a demo that is working perfectly.
       *
       * A refusal with no reason at all, and a request that never arrived,
       * are the only two things left that can reach the generic states.
       */
      const reason = grant?.reason ?? null;
      setRefusedTier(grant?.usageTier ?? null);
      const mapped = reason ? REFUSAL_STATE[reason] : undefined;
      setState(
        mapped
          ?? (grant?.userMessage === 'LIMIT_REACHED' ? 'LIMIT_REACHED'
            // Nothing came back at all: this is the network between the
            // phone and Homatch, and it is worth trying again immediately.
            : (error && !grant) ? 'NETWORK_ERROR'
              : 'PROVIDER_ERROR'),
      );
      if (reason) setFailure(reason);
      else if (grant?.userMessage === 'BUSY') setFailure('BUSY');
      // Nothing will use it now, and an abandoned context holds hardware open.
      try { await primed?.close(); } catch { /* already gone */ }
      return;
    }

    sessionIdRef.current = grant.sessionId;
    grantedRef.current = grant.grantedSeconds ?? 60;
    grantInfoRef.current = {
      usageTier: grant.usageTier ?? null,
      configuredSessionSeconds: grant.configuredSessionSeconds ?? null,
    };
    setRemaining(grantedRef.current);

    // Started inside the gesture above, awaited here: on press, never on page
    // load, and no longer between the tap and the microphone.
    const { VoiceSession: Session } = await modulePromise;

    const session = new Session(
      {
        primaryLanguage: language,
        maxDurationSec: grantedRef.current,
      },
      {
        onState: (s) => setState(s),
        onTranscript: publishTurns,
        // `locked` is deliberately not kept: the session language is a prior
        // that every grant now carries, so nothing is waiting on it to settle.
        onLanguage: (lang) => {
          detectedRef.current = lang;
          languageRef.current = lang;
        },
        onLevel: (l) => { inputLevel.current = l; },
        onSecondsConsumed: (consumed) => setRemaining(Math.max(0, grantedRef.current - consumed)),
        onError: (code) => setFailure(code),
        onDiagnostics: (d) => { if (debug) setDiagnostics(d); },
        onConversationState: (next) => { knownRef.current = next; },

        /*
         * One utterance out, the words back.
         *
         * Server-side, because the transcription provider that can write
         * Georgian is reached with a key that must never be in a browser.
         */
        onTranscribe: async (audioBase64, languageHint) => {
          if (!sessionIdRef.current) return null;
          const { data: heard, error: heardError } = await supabase.functions.invoke('ai-talk-session', {
            body: {
              action: 'transcribe',
              sessionId: sessionIdRef.current,
              audioBase64,
              ...(languageHint ? { languageHint } : {}),
            },
          });
          const result = heard as {
            ok?: boolean; text?: string | null; language?: string | null; ms?: number;
          } | null;
          if (heardError || !result?.ok) return null;
          return { text: result.text ?? null, language: result.language ?? null, ms: result.ms ?? null };
        },

        /*
         * A credential that can transcribe while they are still speaking.
         *
         * Allowed to refuse: when it does, the batch path above carries the
         * session instead. The difference is about a second, not a broken
         * conversation, so the visitor is never told about it.
         */
        onListenGrant: async () => {
          if (!sessionIdRef.current) return null;
          const { data: ear, error: earError } = await supabase.functions.invoke('ai-talk-session', {
            body: {
              action: 'listen',
              sessionId: sessionIdRef.current,
              /*
               * THE PRIOR, ALWAYS -- not only once the session has settled.
               *
               * This used to send null until the language locked, on the
               * reasoning that a Russian speaker reading a Georgian page
               * would otherwise get Georgian letters back. What it actually
               * did was leave the recogniser with no language for the first
               * turn, so the first turn was decided by `auto` -- and on a
               * real Android microphone `auto` turned a Georgian word into
               * "Abba" and took the session to English.
               *
               * The page somebody is reading is the best guess available
               * before they have said anything, which is what a prior is. It
               * is not a lock: the session can still leave it on evidence,
               * and voiceClient earns a detection probe when sustained
               * speech repeatedly fails to resolve against it.
               */
              languageHint: languageRef.current || language,
            },
          });
          const grant = ear as {
            ok?: boolean; token?: string; grant?: string; model?: string; sampleRate?: number;
            provider?: 'GOOGLE' | 'ELEVENLABS' | 'OPENAI'; keyterms?: string[];
            wsUrl?: string; languages?: string[];
          } | null;
          // Google's answer carries its proof under `grant` rather than
          // `token`: it is a signature over the session, not a provider
          // credential, and calling it a token would invite treating it as
          // one.
          const credential = grant?.token ?? grant?.grant ?? null;
          if (earError || !grant?.ok || !credential) return null;
          return {
            token: credential,
            model: grant.model,
            sampleRate: grant.sampleRate,
            wsUrl: grant.wsUrl,
            // Which protocol the socket speaks, decided by which provider
            // actually answered rather than by anything the browser assumes.
            provider: grant.provider,
            keyterms: grant.keyterms,
            /*
             * The prior reaches the socket, or the socket has no language.
             *
             * This is the line the recogniser's configuration comes from:
             * googleTranscribe only sets `?language=` when languageCode is
             * present, and the gateway falls back to a server-wide default
             * when it is not. Nulling it until the session locked meant the
             * first turn of every conversation was recognised against an
             * environment variable instead of against the page the visitor
             * had chosen -- and, with detection on, against `auto`.
             */
            languageCode: languageRef.current || language,
            /*
             * Every language the socket should be prepared to hear.
             *
             * The recogniser is configured with one -- chirp_3 takes one code
             * or `auto` and nothing between -- so this is what the SESSION
             * will act on, not what the provider is set to. `languageCode`
             * above stays the primary candidate so a settled call is not
             * re-decided at every pause.
             */
            languages: grant.languages,
          };
        },

        /*
         * The turn, as it is produced.
         *
         * Words arrive while the model is still writing, and audio arrives
         * phrase by phrase while it is still being spoken, so nothing waits
         * for a stage that has already produced something usable.
         */
        onConverse: (text, signal, turnId) => {
          const stream = converseStream({
          url: FUNCTIONS_URL,
          anonKey: ANON_KEY,
          accessToken: accessTokenRef.current,
          body: {
            action: 'converse',
            sessionId: sessionIdRef.current,
            // Names this turn in the server's trace and in ours.
            turnId,
            text,
            locale: language,
            ...(detectedRef.current ? { languageHint: detectedRef.current } : {}),
            state: knownRef.current,
            /*
             * EIGHT TURNS, NOT THREE. Each turn is two entries, so the old
             * slice(-6) gave the model three exchanges: in a nine-turn
             * conversation the name somebody gave at the start was gone by
             * the middle, and it answered "you did not tell me your name" to
             * somebody who had. The server already accepts twelve.
             */
            history: historyRef.current.slice(-16),
            /*
             * The rate this device's audio hardware actually runs at, so the
             * provider synthesises at it and nothing has to be resampled.
             * Resampling each arriving piece on its own is what put a whine
             * on the joins; the fastest resampler is the absent one.
             */
            ...(sessionRef.current?.outputSampleRate
              ? { outputSampleRate: sessionRef.current.outputSampleRate }
              : {}),
            /*
             * The recogniser's own label for this utterance. Evidence for the
             * server's resolver, never an answer: it has returned Korean and
             * Hausa for Georgian speech, and the server discards anything
             * that is not one of the six languages AI TALK speaks.
             */
            ...(sessionRef.current?.languageTrace.providerLanguage
              ? {
                providerLanguage: sessionRef.current.languageTrace.providerLanguage,
                // Whether that label was detected or merely configured; the
                // server re-resolves and must weigh it the same way.
                providerDetected: sessionRef.current.languageTrace.providerDetected,
              }
              : {}),
            ...(sessionRef.current?.languageTrace.firstTurn ? { firstTurn: true } : {}),
            // What the device spent before this request existed, so the whole
            // chain is measurable from the server's own trace.
            ...(sessionRef.current ? { clientStages: sessionRef.current.stageStamps } : {}),
            /*
             * Seconds of audio each recogniser was sent, for COGS.
             *
             * Only the browser can know this: microphone audio goes straight
             * from here to the speech worker and never reaches the server that
             * does the accounting, which is why speech recognition has never
             * appeared on this product's cost ledger at all. Two figures
             * because two streams are opened and Google bills both.
             */
            ...(sessionRef.current
              ? {
                sttAudioSeconds: sessionRef.current.sttSeconds.primary,
                sttShadowAudioSeconds: sessionRef.current.sttSeconds.shadow,
              }
              : {}),
            /*
             * The shape of this turn, and of the ones that never became turns.
             *
             * Reconstructing the Telugu session needed both and neither was
             * recorded: a refused turn produces no server event at all,
             * because it never reaches the server. Lengths, scripts and
             * counts only -- no transcript text leaves the browser that was
             * not already leaving it.
             */
            ...(sessionRef.current ? { turnShape: sessionRef.current.turnShape } : {}),
            // Conversation language BEFORE this turn, and how sure this turn's
            // language is: the server states both to the model as facts.
            ...(sessionRef.current?.languageTrace.previousLanguage
              ? { previousLanguage: sessionRef.current.languageTrace.previousLanguage }
              : {}),
            ...(sessionRef.current?.languageTrace.resolution
              ? {
                turnLanguageReason: sessionRef.current.languageTrace.resolution.weakEvidence
                  ? `${sessionRef.current.languageTrace.resolution.resolutionReason}_WEAK`
                  : sessionRef.current.languageTrace.resolution.resolutionReason,
                turnLanguageConfidence: sessionRef.current.languageTrace.resolution.weakEvidence
                  ? Math.min(0.4, sessionRef.current.languageTrace.resolution.confidence)
                  : sessionRef.current.languageTrace.resolution.confidence,
              }
              : {}),
          },
            signal,
          });
          /*
           * The seconds just reported belong to THIS turn. Clearing the
           * counters here, after the body is built and before the next
           * utterance can add to them, is what stops one turn's audio being
           * billed again by the next.
           */
          sessionRef.current?.clearSttSeconds();
          return stream;
        },

        /*
         * A destination the assistant chose. Offered, never taken: being
         * navigated away from a page by a voice, without touching anything,
         * is not something to do to somebody.
         */
        onAction: (action) => setDestination({ key: action.key, path: action.path }),

        /*
         * The assistant decided the call is finished. It has already spoken
         * its last sentence by the time this runs.
         */
        onEnded: (reason) => { void endSession(`assistant:${reason}`); },

        // The older request-and-reply path is not used on this surface.
        onUserTurn: async () => null,
      },
    );

    sessionRef.current = session;
    // Built inside the tap, above. The session adopts it instead of
    // constructing its own three awaits too late to be allowed to sound.
    session.adoptAudioContext(primed);
    session.noteGrant(grantInfoRef.current);
    /*
     * Only in a debug session, and only because the alternative is guessing.
     * A person reporting "it did not understand my Georgian" cannot tell us
     * whether the audio that left their phone was already wrong; this lets
     * them hand over exactly what the recogniser was sent. In memory, last
     * thirty seconds, never uploaded.
     */
    if (debug) session.enableAudioTap();
    await session.start();

    /*
     * A SESSION THAT NEVER OPENED MUST BE GIVEN BACK.
     *
     * start() returns having set MIC_DENIED, MIC_UNAVAILABLE or
     * PROVIDER_ERROR when it could not get a microphone. The row on the
     * server is still ACTIVE at that point, and the server refuses a second
     * session while one is active — so somebody who allowed the microphone
     * and pressed Try again would have been refused by the leftover row from
     * their own failed attempt.
     */
    const settled = session.currentState;
    if (settled !== 'LISTENING') {
      await endSession(`failed_${settled.toLowerCase()}`);
      return;
    }

    // The heartbeat is what makes the allowance real: the server clamps the
    // reported figure against its own clock and ends the session when the
    // grant is spent, whatever this page believes.
    heartbeatRef.current = window.setInterval(async () => {
      if (!sessionIdRef.current || !sessionRef.current) return;
      /*
       * ONLY WHAT THE VISITOR SAID.
       *
       * This transcript is what the server extracts facts from, and it was
       * the whole conversation — so the assistant offering "buy, rent, sell
       * or invest?" put the word RENT into the extraction and the chip came
       * back saying they intend to rent. Their own words are the only
       * evidence of what they want.
       */
      const transcript = turnsRef.current
        .filter((turn) => turn.speaker === 'USER' && turn.final)
        .map((turn) => turn.text)
        .join(' ')
        .slice(-2000);
      const { data: beat } = await supabase.functions.invoke('ai-talk-session', {
        body: {
          action: 'heartbeat',
          sessionId: sessionIdRef.current,
          consumedSeconds: sessionRef.current.consumedSeconds,
          transcript,
        },
      });
      const result = beat as {
        ended?: boolean; remainingSeconds?: number; intelligence?: Intelligence | null;
      } | null;
      if (result?.intelligence) setIntelligence(result.intelligence);
      if (typeof result?.remainingSeconds === 'number') setRemaining(result.remainingSeconds);
      if (result?.ended) {
        /*
         * The SERVER says the allowance is gone. Ended the same way the
         * client's own clock ends it -- new turns refused, whatever is being
         * spoken allowed to land, then a state the visitor can read. Calling
         * endSession() straight from here was the other way to cut somebody
         * off in the middle of an answer.
         */
        const live = sessionRef.current;
        if (live) live.reachSessionLimit();
        else { await endSession('allowance'); setState('LIMIT_REACHED'); }
      }
    }, 5000);
  }, [language, endSession, debug]);

  // The history a turn carries is what was actually said, taken from what is
  // on screen, so it cannot drift from the transcript the visitor can read.
  useEffect(() => {
    historyRef.current = turns
      .filter((turn) => turn.final)
      .map((turn) => ({
        role: turn.speaker === 'USER' ? ('user' as const) : ('assistant' as const),
        content: turn.text,
      }))
      .slice(-8);
  }, [turns]);

  const live = ['LISTENING', 'UNDERSTANDING', 'RESPONDING', 'INTERRUPTED'].includes(state);
  const connecting = state === 'CONNECTING' || state === 'RECONNECTING';
  const tone = toneOf(state);
  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();

  const toggleMute = useCallback(() => {
    setMuted((was) => {
      const next = !was;
      sessionRef.current?.setMuted(next);
      return next;
    });
  }, []);

  /** The level the orb shows: theirs while listening, ours while speaking. */
  const orbLevel = useCallback(() => {
    if (liveState.current === 'RESPONDING') return sessionRef.current?.outputLevel ?? 0;
    return muted ? 0 : inputLevel.current;
  }, [muted]);

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <section
        className={cn(
          // A fixed height reserves the space §133 asks for and is not hostage
          // to how narrow the phone is. dvh so a mobile browser's collapsing
          // toolbar cannot crop the controls off the bottom.
          'relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10',
          'bg-[radial-gradient(120%_90%_at_50%_0%,rgba(212,168,83,0.10),rgba(0,0,0,0)_60%),linear-gradient(180deg,rgba(18,18,20,0.96),rgba(8,8,10,0.98))]',
          'h-[min(34rem,72dvh)] sm:h-[min(36rem,74dvh)] lg:h-auto lg:aspect-[4/5] lg:max-h-[40rem]',
          'shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_24px_60px_-24px_rgba(0,0,0,0.9)]',
        )}
        aria-live="polite"
      >
        {/*
          A plain div, not <header>.

          A landmark element inside the hero makes this panel's status line
          the page's first banner and its control row the page's first
          FOOTER — which is how "the footer" came to mean "the Start talking
          button" to everything that looks for one, including a screen
          reader. The panel is a region, and the region is the <section>.
        */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-3.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                tone.dot,
                tone.beat ? 'animate-pulse' : '',
              )}
              aria-hidden="true"
            />
            {/* "Listening", "Reconnecting", "Microphone blocked": the
                product reporting a fact about itself. Rewriting one would
                let the panel claim a state it is not in. */}
            <span
              className="truncate text-[13px] font-medium tracking-wide text-white/55"
              {...notEditable('SYSTEM_GENERATED')}
            >
              {t(STATE_KEY[state] as TKey)}
            </span>
          </span>
          {live ? <TimeLeft secondsRef={remainingRef} /> : null}
        </div>

        {/* The voice itself. */}
        <div className={cn(
          'relative flex shrink-0 items-center justify-center transition-all duration-500',
          turns.length ? 'h-[32%] pt-1' : 'h-[44%] pt-3',
        )}
        >
          <AiTalkOrb
            mode={ORB_MODE[state]}
            level={orbLevel}
            className="h-full w-full max-w-[15rem]"
          />
          {muted && live ? (
            <span className="absolute bottom-0 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[13px] text-white/70">
              <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
              {t('talk_muted')}
            </span>
          ) : null}
        </div>

        {/* Either the invitation, or the conversation. */}
        <div className="flex min-h-0 flex-1 flex-col px-4">
          {turns.length
            ? <Transcript turns={turns} />
            : <Invitation state={state} failure={failure} tier={refusedTier} />}
        </div>

        {intelligence && live ? <IntelligenceStrip data={intelligence} /> : null}

        {/*
          * Where the assistant offered to take them.
          *
          * A real route, resolved on the server from this app's own route
          * table, rendered as something to tap rather than as a URL read
          * aloud. Shown only while the call is live: an offer that outlives
          * the conversation it came from is just a stray button.
          */}
        {destination && live ? (
          <div className="shrink-0 px-4 pb-1">
            <button
              type="button"
              onClick={() => void followDestination(destination.path)}
              className="inline-flex w-full items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-left text-[13px] font-medium text-white transition-transform will-change-transform active:scale-[0.99]"
            >
              <span>{t(`talk_go_${destination.key}`)}</span>
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {/* Controls. Three at most, ever. */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3">
          {live ? (
            <>
              <button
                type="button"
                onClick={toggleMute}
                aria-pressed={muted}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                {muted
                  ? <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />}
                {t(muted ? 'talk_unmute' : 'talk_mute')}
              </button>
              <button
                type="button"
                onClick={() => void endSession('user_ended')}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-rose-400/10 hover:text-rose-200"
              >
                <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
                {t('talk_end')}
              </button>
            </>
          ) : connecting ? (
            <span className="text-[13px] text-white/40">{t('talk_state_connecting')}</span>
          ) : state === 'DAILY_LIMIT_REACHED' ? (
            /*
             * A SPENT ALLOWANCE CANNOT BE RETRIED, SO IT IS NOT OFFERED.
             *
             * "Try again" here is a button that is guaranteed to fail: the
             * allowance is measured over a rolling day and pressing it a
             * second later re-runs the same arithmetic. Offering it makes
             * the product look broken and teaches people to distrust it.
             *
             * This is not a dead end -- it is the only resting state whose
             * way back is forward. An anonymous visitor is offered the thing
             * that actually gives them more time, which is an account of
             * their own; somebody already signed in is offered the full
             * assistant, which is not on the demo allowance at all.
             */
            <button
              type="button"
              onClick={() => navigate(refusedTier === 'STANDARD' ? '/ai' : '/auth/login')}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-black transition-transform hover:scale-[1.02] active:scale-[0.99]"
              {...notEditable('SYSTEM_GENERATED')}
            >
              {t(refusedTier === 'STANDARD' ? 'talk_continue' : 'talk_quota_signin')}
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void start()}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-black transition-transform hover:scale-[1.02] active:scale-[0.99]"
              >
                {state === 'IDLE'
                  ? <Mic className="h-4 w-4" aria-hidden="true" />
                  : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                {/* The invitation to start is copy; "Try again", offered
                    after a call has ended, is the panel offering a retry. */}
                {state === 'IDLE'
                  ? <span {...fp('talk_start')}>{sf('talk_start', 'talk_start')}</span>
                  : <span {...notEditable('SYSTEM_GENERATED')}>{t('talk_again')}</span>}
              </button>
              {state !== 'IDLE' ? (
                <button
                  type="button"
                  onClick={() => navigate('/ai')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/5"
                >
                  {t('talk_continue')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </button>
              ) : null}
            </>
          )}
        </div>

        {/* The panel names itself for anybody reading it with a screen reader,
            and for the Site Studio field map. It is not a badge a visitor
            needs to see next to a title that says the same thing. */}
        <span className="sr-only" {...fp('talk_badge')}>{sf('talk_badge', 'talk_badge')}</span>
      </section>

      {debug ? (
        <AiTalkDiagnostics
          d={diagnostics}
          onDownloadSentAudio={() => {
            const wav = sessionRef.current?.exportSentAudio();
            if (!wav) return;
            const url = URL.createObjectURL(wav);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai-talk-sent-${Date.now()}.wav`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The conversation.
 *
 * The newest turn is the one being read, so it is the one with weight: full
 * contrast, full size. Everything above it fades, which is what makes the
 * latest exchange findable on a phone without any scrolling at all.
 */
/**
 * Re-rendered only when the conversation actually looks different.
 *
 * The signature is what a reader can see: how many turns there are, and the
 * text and finality of the last two (the only ones whose styling depends on
 * being recent). A model writing the same word twice cannot cause a repaint.
 */
function sameTranscript(a: { turns: TranscriptTurn[] }, b: { turns: TranscriptTurn[] }): boolean {
  if (a.turns.length !== b.turns.length) return false;
  for (let i = Math.max(0, a.turns.length - 2); i < a.turns.length; i++) {
    if (a.turns[i].text !== b.turns[i].text) return false;
    if (a.turns[i].final !== b.turns[i].final) return false;
  }
  return true;
}

function TranscriptView({ turns }: { turns: TranscriptTurn[] }) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Only follow the conversation while the reader is already at the bottom.
  // Yanking somebody back down while they are reading an earlier answer is
  // worse than letting them fall behind.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !atBottom.current) return;
    /*
     * Text that is still arriving is followed INSTANTLY; a finished turn
     * glides.
     *
     * A smooth scroll takes about as long as the next few words take to
     * arrive, so during streaming it never catches up and the newest line
     * sits half off the bottom of the panel — which is what a sentence
     * appearing while you read it must never do.
     */
    const streaming = turns.length > 0 && !turns[turns.length - 1].final;
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [turns]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  const last = turns.length - 1;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex flex-col gap-3">
        {turns.map((turn, index) => {
          const mine = turn.speaker === 'USER';
          const recent = index >= last - 1;
          return (
            <div
              key={turn.id}
              className={cn('transition-opacity duration-500', recent ? 'opacity-100' : 'opacity-40')}
            >
              <p className={cn(
                'mb-0.5 text-[13px] font-medium uppercase tracking-[0.16em]',
                mine ? 'text-white/35' : 'text-gold/70',
              )}
              >
                {mine ? t('talk_speaker_you') : t('ai_title')}
              </p>
              <p className={cn(
                '[overflow-wrap:anywhere] text-pretty leading-relaxed',
                recent ? 'text-[15px] text-white' : 'text-[13px] text-white/70',
                // Text that is still being written is shown softly rather
                // than committed-looking, so a revision does not read as the
                // assistant changing its mind.
                turn.final ? '' : 'italic text-white/55',
              )}
              >
                {turn.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the panel says before anybody has spoken, and after something went
 * wrong.
 *
 * A named failure is more use than "temporarily unavailable": one says speech
 * recognition, the other says nothing at all. Neither ever names a provider.
 */
function Invitation(
  { state, failure, tier }: { state: PanelState; failure: string | null; tier: string | null },
) {
  const { t } = useLanguage();
  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();

  const messageKey: Record<string, string> = {
    IDLE: 'talk_idle_body',
    CONNECTING: 'talk_idle_body',
    RECONNECTING: 'talk_idle_body',
    LISTENING: 'talk_say_something',
    UNDERSTANDING: 'talk_say_something',
    RESPONDING: 'talk_say_something',
    INTERRUPTED: 'talk_say_something',
    ENDED: 'talk_ended_body',
    LIMIT_REACHED: 'talk_limit_body',
    MIC_DENIED: 'talk_mic_denied_body',
    MIC_UNAVAILABLE: 'talk_mic_unavailable_body',
    PROVIDER_ERROR: 'talk_unavailable_body',
    DAILY_LIMIT_REACHED: 'talk_quota_daily_body',
    SESSION_ALREADY_ACTIVE: 'talk_busy_body',
    BROWSER_UNSUPPORTED: 'talk_browser_unsupported_body',
    NETWORK_ERROR: 'talk_network_body',
  };

  const named = failure && FAILURE_KEY[failure] ? FAILURE_KEY[failure] : messageKey[state];

  /*
   * WHOSE ALLOWANCE RAN OUT.
   *
   * The free demo is counted against the NETWORK for an anonymous visitor --
   * it has to be, because there is nothing else to count it against, and it
   * is shared with everybody behind that address. A signed-in person is
   * counted against their own account instead, and telling them "this
   * network" would be false and would send them to change Wi-Fi for nothing.
   *
   * Neither sentence promises a clock. The window is a rolling day, so the
   * only honest thing to say is that it comes back within one.
   */
  const key = named === 'talk_quota_daily_body' && tier === 'STANDARD'
    ? 'talk_quota_account_body'
    : named;

  /*
   * ONE ELEMENT, TWO KINDS OF SENTENCE.
   *
   * At rest this line is the pitch — "say what you are looking for" — and it
   * is the panel's most-read sentence, so it is a field. Every other state
   * puts a REPORT in the same place: the microphone was refused, the minute
   * limit was reached, the provider is unreachable. Those are facts about a
   * session, and an admin who could edit them could make the panel apologise
   * for something that did not happen.
   */
  const invitationIsCopy = key === 'talk_idle_body';

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <p className="text-[17px] font-semibold text-white sm:text-lg" {...fp('talk_title')}>
        {sf('talk_title', 'talk_title')}
      </p>
      <p
        className="mt-2 max-w-[24rem] text-pretty text-[13px] leading-relaxed text-white/55"
        {...(invitationIsCopy ? fp('talk_idle_body') : notEditable('SYSTEM_GENERATED'))}
      >
        {invitationIsCopy ? sf('talk_idle_body', 'talk_idle_body') : t(key as TKey)}
      </p>
      <p className="mt-2 text-[13px] text-white/30" {...fp('talk_languages')}>
        {sf('talk_languages', 'talk_languages')}
      </p>
    </div>
  );
}

/**
 * What the conversation has understood, as it understands it.
 *
 * §27: live intelligence, visible. Facts only — no scores, no confidence, no
 * internal field names.
 */
/**
 * The remaining-seconds clock, and nothing else.
 *
 * Reads the ref on its own interval and holds the only state that changes
 * once a second. Isolating it is the difference between repainting two digits
 * and repainting the whole card — the card contains a canvas, a scrolling
 * transcript and a backdrop-blurred panel, none of which have any reason to
 * be touched because a second passed.
 */
function TimeLeft({ secondsRef }: { secondsRef: React.MutableRefObject<number | null> }) {
  const [shown, setShown] = useState<number | null>(secondsRef.current);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setShown((was) => (was === secondsRef.current ? was : secondsRef.current));
    }, 500);
    return () => window.clearInterval(tick);
  }, [secondsRef]);

  if (shown === null) return null;
  return (
    <span className="shrink-0 font-mono text-[13px] tabular-nums text-white/30">
      {String(Math.floor(shown / 60)).padStart(2, '0')}
      :
      {String(shown % 60).padStart(2, '0')}
    </span>
  );
}

const Transcript = memo(TranscriptView, sameTranscript);

function IntelligenceStrip({ data }: { data: Intelligence }) {
  const { t, lang: language } = useLanguage();

  const chips: string[] = [];
  if (data.transactionType) chips.push(t(`talk_intent_${String(data.transactionType).toLowerCase()}` as TKey));
  for (const loc of (data.locations ?? []).slice(0, 2)) chips.push(capitalise(loc));
  if (data.bedrooms != null) chips.push(t('talk_chip_bedrooms').replace('{n}', String(data.bedrooms)));
  if (data.budgetMax) {
    // A currency is never invented. Without one the figure is shown as a
    // plain number rather than silently becoming dollars.
    chips.push(data.currency
      ? new Intl.NumberFormat(language, {
        style: 'currency', currency: data.currency, maximumFractionDigits: 0,
      }).format(data.budgetMax)
      : new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(data.budgetMax));
  }
  if (!chips.length) return null;

  return (
    <div className="shrink-0 px-4 pt-2">
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-full border border-gold/25 bg-gold/5 px-2.5 py-1 text-[13px] text-gold/90"
          >
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}

function capitalise(value: string): string {
  const s = String(value ?? '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export default AiTalkPanel;
