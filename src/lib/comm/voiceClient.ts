// HOMATCH — the browser voice runtime.
//
// Used by two surfaces and nothing else: the homepage AI Talk demo, and Voice
// Studio's live agent test. Neither places a telephone call (§28), so there is
// no telephony leg and no per-minute carrier cost.
//
// WHY THE MICROPHONE NO LONGER STREAMS TO A TRANSCRIPTION SOCKET
//
// It used to open a WebSocket to Cartesia STT and stream PCM at it. That is a
// better design in the abstract — words arrive while the sentence is still
// being spoken — and it cannot work for this product, for two measured
// reasons.
//
// Georgian. Asked for language=ka, ink-whisper accepted the socket and then
// dropped it at about five seconds with close code 1006 and no error frame;
// ink-2 answered language_not_supported. Left without a language it heard the
// Georgian correctly and wrote it in Latin letters. Homatch is a Georgia-first
// product, so that is not a limitation to work around, it is the product.
//
// And the language had to be chosen before anybody spoke, because it lives in
// the socket URL. A visitor who switches from Georgian to Russian mid-sentence
// cannot be served by a connection that was told what they were going to say.
//
// So the microphone is captured here, one utterance at a time, and the words
// come back from the server, which has a provider that can write Georgian and
// works the language out for itself.
//
// WHAT THIS FILE NEVER DOES
//
// It never holds an API key. It never keeps audio: an utterance is captured,
// sent, and the buffer dropped. It never decides its own allowance — the
// server grants seconds, this reports consumption, and the server ends the
// session.

import {
  reduceTranscript, stabiliseLanguage, decideBargeIn,
  latencyBreakdown, DEFAULT_BARGE_IN,
  type TranscriptTurn, type LanguageState, type EndpointConfig, type LatencyMarks,
} from './transcript.ts';
import {
  Resampler, floatToPcm16, rms, encodeWav, joinBlocks, bytesToBase64,
  TARGET_SAMPLE_RATE,
} from './audio.ts';
import { PcmStreamPlayer } from './pcmPlayer.ts';
import {
  resolveTurnLanguage, normaliseLanguage, type TalkLanguage, type LanguageResolution,
} from './talkLanguage.ts';
import { createTranscriber, LIVE_SAMPLE_RATE, type LiveGrant, type LiveSocket } from './liveTranscribe.ts';
import { LiveAudioRouter, type LivePhase } from './liveAudioRouter.ts';
import { FinalWatch, type FinalDecision } from './finalWatch.ts';


/**
 * Why the microphone could not be opened, in terms a person can act on.
 *
 * The DOM names are precise and the advice differs completely between them:
 * NotAllowed means "say yes", NotFound means "there is no microphone",
 * NotReadable means "something else is holding it, close it".
 */
export type MicFailure = 'MIC_DENIED' | 'MIC_MISSING' | 'MIC_BUSY' | 'MIC_TIMEOUT' | 'AUDIO_UNAVAILABLE';

function classifyMicError(e: unknown): MicFailure {
  const err = e as { name?: string; message?: string } | null;
  if (err?.message === 'MIC_TIMEOUT') return 'MIC_TIMEOUT';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'MIC_DENIED';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'MIC_MISSING';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'MIC_BUSY';
    default:
      return 'AUDIO_UNAVAILABLE';
  }
}

/** Reject with `label` if the promise has not settled in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (err) => { window.clearTimeout(timer); reject(err); },
    );
  });
}

export type VoiceState =
  | 'IDLE' | 'CONNECTING' | 'LISTENING' | 'UNDERSTANDING' | 'RESPONDING'
  | 'INTERRUPTED' | 'RECONNECTING' | 'ENDED' | 'LIMIT_REACHED'
  | 'MIC_DENIED' | 'MIC_UNAVAILABLE' | 'PROVIDER_ERROR';

export interface VoiceGrant {
  /**
   * The language to START in, from the page the visitor is reading.
   *
   * A preference, not a decision. What they actually speak decides, from the
   * first transcript onwards, and they may change their mind mid-conversation.
   */
  primaryLanguage: string;
  maxDurationSec: number;
  endpointing?: Partial<EndpointConfig>;
}

/**
 * One event from a streamed turn.
 *
 * The server writes and speaks at the same time, so a turn is not a reply, it
 * is a sequence: words as they are written, then audio for each phrase as it
 * is made. Consuming it as an async iterable keeps the ordering guarantees
 * the server already provides instead of rebuilding them out of callbacks.
 */
export type ConverseEvent =
  | { type: 'open'; ms?: number; language?: string }
  | { type: 'text'; delta: string }
  | { type: 'reply'; text: string; language?: string }
  | { type: 'audio'; pcmBase64: string; sampleRate: number; index?: number }
  /**
   * Somewhere in Homatch that actually does what they asked for.
   *
   * `path` is resolved server-side from this application's own route list, so
   * it is a route that exists. The model chooses a key and never a URL, which
   * is what stops a plausible-looking invented path reaching a customer as a
   * button.
   */
  | { type: 'action'; kind: 'NAVIGATE'; key: string; path: string }
  /** The assistant has decided the call is over once this reply is spoken. */
  | { type: 'end'; reason: string }
  | { type: 'voiceless'; reason?: string; providerCode?: string; providerStatus?: number; language?: string }
  | { type: 'state'; state: unknown }
  | {
      type: 'done'; firstTextMs?: number; firstAudioMs?: number | null;
      totalMs?: number; ttsMs?: number;
      /* Whether the answer finished, and how much of it there was. */
      llmTextChars?: number; ttsTextChars?: number; ttsRequests?: number;
      assistantResponseCompleted?: boolean | null;
      responseInterruptReason?: string | null;
      finalTextTail?: string | null;
      /**
       * The server's own stages, as offsets from the moment it began work.
       * Offsets rather than timestamps because the two machines do not share
       * a clock -- see LatencyMarks for why that matters.
       */
      timing?: {
        llmFirstTokenMs?: number | null;
        ttsRequestMs?: number | null;
        ttsFirstByteMs?: number | null;
        firstAudioSentMs?: number | null;
        streamed?: boolean | null;
      };
    }
  | { type: 'failed'; reason?: string };

/** What came back from one utterance sent for transcription. */
export interface TranscriptionReply {
  text: string | null;
  /** ISO-639-1 as the server settled it, or null when it could not tell. */
  language?: string | null;
  /** Round trip, for the latency breakdown. */
  ms?: number | null;
}

/**
 * Every number this session can honestly report about itself.
 *
 * Written because "the microphone is clearly listening and nothing appears"
 * described four completely different faults and there was no way to tell
 * them apart from outside: no samples, samples but no capture, capture but no
 * request, request but no words. Each of those has its own counter here, and
 * none of them is inferred — every field is a count of something that
 * actually happened.
 */
export interface VoiceDiagnostics {
  micReady: boolean;
  /** MediaStreamTrack.readyState: 'live' or 'ended'. */
  trackState: string | null;
  trackMuted: boolean | null;
  trackEnabled: boolean | null;
  /** What the browser ACTUALLY gave us, which is not always what was asked. */
  contextSampleRate: number | null;
  contextState: string | null;
  /** The rate the audio is converted to before it is sent. */
  sendSampleRate: number;
  resampling: boolean;
  /** Live input level, 0 to 1, and the loudest block seen so far. */
  rms: number;
  peakRms: number;
  /** Blocks the audio callback has delivered, and samples kept for sending. */
  blocks: number;
  samplesCaptured: number;
  bytesSent: number;
  capturing: boolean;
  /** Silence since the last block that was loud enough to be speech. */
  silenceMs: number | null;
  utterances: number;
  lastUtteranceMs: number | null;
  lastUtteranceBytes: number | null;
  /** Transcription requests, and how they went. */
  sttRequests: number;
  sttOk: number;
  sttEmpty: number;
  sttFailed: number;
  /**
   * Finals that arrived mid-turn and were answered late rather than lost.
   *
   * Worth a counter of its own: while this was a silent `return` the only
   * symptom was a visitor saying something and nothing happening, which is
   * indistinguishable from the microphone not working.
   */
  finalsDeferred: number;
  /** Times the conversation changed language because the visitor asked. */
  languageSwitches: number;
  /** How many sockets asked the provider what language it heard. Should be 0. */
  languageProbes: number;
  /*
   * THE SOCKET'S LIFECYCLE, AND THE BYTES, IN ONE UNIT.
   *
   * Every byte count below is canonical outgoing PCM -- 16 kHz mono signed
   * Int16 -- never 48 kHz Float32 input. `bufferFormat` says so in the trace
   * itself so the next reader does not have to take it on trust.
   */
  livePhase: LivePhase;
  socketReadyMs: number | null;
  socketFailures: number;
  socketReconnects: number;
  postResampleBytes: number;
  sentLiveBytes: number;
  flushedBufferedBytes: number;
  bufferedPcmBytes: number;
  /** Bytes the batch path took because no socket was coming. */
  batchedPcmBytes: number;
  maxPreReadyBufferBytes: number;
  bufferDurationMs: number;
  bufferFormat: string;
  /*
   * WHY NOTHING IS CONSUMING THE MICROPHONE.
   *
   * "Listening" with a ready socket and a frozen byte count has exactly three
   * causes, and from outside they look identical. Naming them is the
   * difference between reading a trace and guessing at one.
   */
  micGated: boolean;
  transcribing: boolean;
  /** How often the gate had to be forced open. Should be 0. */
  gateReleases: number;
  /*
   * THE FINAL THAT NEVER CAME.
   *
   * The difference between "the visitor said nothing" and "the recogniser
   * answered nothing" is invisible from the transcript, and the second one
   * killed a real session. Counted, dated, and named.
   */
  noFinalCount: number;
  consecutiveNoFinals: number;
  noFinalRecoveries: number;
  lastNoFinalReason: string | null;
  lastNoFinalAt: number | null;
  socketCloseReason: string | null;
  socketCloseHadFinal: boolean | null;
  /*
   * WHY THE SESSION IS NOT ANSWERING.
   *
   * A session that stops responding and cannot say why is indistinguishable
   * from a crash, and that is exactly how a 90-second limit reached in the
   * middle of a conversation presented itself: no answer, panel still
   * reading LISTENING, nothing anywhere naming the clock.
   */
  sessionElapsedMs: number;
  sessionRemainingMs: number;
  sessionMaxMs: number;
  turnCount: number;
  newTurnsBlocked: boolean;
  sessionEndReason: string | null;
  /* Response completeness, end to end. */
  llmTextChars: number | null;
  ttsTextChars: number | null;
  ttsRequests: number | null;
  assistantResponseCompleted: boolean | null;
  responseInterruptReason: string | null;
  finalTextTail: string | null;
  playbackQueuedChunks: number;
  playbackCompletedChunks: number;
  /** postResample === sent + flushed + buffered + dropped. False is a bug. */
  bytesAccountedFor: boolean;
  /** The language the recogniser was last reopened for, if ever. */
  lastRelisten: string | null;
  /** Milliseconds the assistant kept speaking after being interrupted. */
  lastBargeStopMs: number | null;
  /** Voiced audio that arrived with no socket ready to take it. */
  voicedBeforeReadyMs: number;
  /** Speech held across a socket rotation and replayed into the new one. */
  preReadyFlushBytes: number;
  preReadyFlushMs: number;
  /** Held audio that was let go because no socket came. Should stay at zero. */
  droppedPreReadyBytes: number;
  /** One row per completed turn, for a real-device session. */
  turnTrace: Array<Record<string, unknown>>;
  /** Turns this session ended itself rather than waiting for the endpointer. */
  turnsEndedLocally: number;
  lastEndTurnSilenceMs: number | null;
  lastEndTurnSpeechMs: number | null;
  lastSttMs: number | null;
  lastSttChars: number | null;
  lastSttLanguage: string | null;
  /** The most recent words, so a person can see them appear. */
  lastTranscript: string | null;
  turnsSent: number;
  /** The whole turn round trip, and the server's own split of it. */
  lastTurnMs: number | null;
  lastLlmMs: number | null;
  lastTtsMs: number | null;
  /** Their last word to the first sound back: the only number they feel. */
  lastPlaybackMs: number | null;
  lastReplyChars: number | null;
  lastAudioBytes: number | null;
  playbacks: number;
  /** The last thing that went wrong, as a code. Never a stack, never a key. */
  lastError: string | null;
  /** Which transcription path is carrying this session. */
  liveMode: 'live' | 'batch';
  liveModel: string | null;
  /** Which provider granted the socket, and how many terms it was primed with. */
  liveProvider: string | null;
  liveKeyterms: number | null;
  /** Whether the reply arrived in pieces or as one finished clip. */
  streamedTts: boolean | null;
  /*
   * The whole turn, stage by stage, in milliseconds.
   *
   * It existed and went nowhere: the breakdown was computed and handed to an
   * optional callback the homepage never passed, so the one screen anybody
   * actually reads on a real phone showed two of the seven stages. A latency
   * problem you cannot attribute is a latency problem you argue about.
   */
  stages: {
    endpointingMs: number | null;
    transcriptionMs: number | null;
    dispatchMs: number | null;
    llmTtftMs: number | null;
    handoffMs: number | null;
    ttsFirstAudioMs: number | null;
    playbackMs: number | null;
    perceivedMs: number | null;
  } | null;
  /** Why the live path was given up on, when it was. */
  liveFellBack: string | null;
  /** What the speech provider said when it refused. A code and a status. */
  voiceFailure: string | null;
  /**
   * Whether the last reply was actually heard: AUDIBLE, or why not.
   *
   * Separate from `playbacks`, which counts buffers handed over. Those two
   * disagreed for the whole of the Cartesia migration — a player that was
   * never constructed accepted every chunk and made no sound.
   */
  playback: string | null;
  state: VoiceState;
}

/** What the server returns for one turn: the sentence, and the voice saying it. */
export interface AssistantTurn {
  text: string;
  /** base64 audio, or null when synthesis failed but the text is still good. */
  audioBase64: string | null;
  mime?: string;
  voiceId?: string;
  /** Server-measured halves of the turn, so a slow one can be attributed. */
  llmMs?: number | null;
  ttsMs?: number | null;
}

export interface VoiceCallbacks {
  onState: (state: VoiceState, detail?: string) => void;
  onTranscript: (turns: TranscriptTurn[]) => void;
  onLanguage: (language: string, locked: boolean) => void;
  onLevel: (level: number) => void;
  onSecondsConsumed: (seconds: number) => void;
  onLatency?: (breakdown: ReturnType<typeof latencyBreakdown>) => void;
  onError?: (code: string) => void;
  /**
   * One line per lifecycle milestone, for diagnostics.
   *
   * A failed session used to be a single red state with no way to tell WHERE
   * it stopped: no microphone, no socket, socket open but no audio in, audio
   * in but no response out. Those need completely different fixes.
   *
   * Milestones carry timings and counts only. No transcript text, no audio,
   * no token — what was said is the customer's, and a diagnostic trail is not
   * a place to keep it.
   */
  onMilestone?: (milestone: VoiceMilestone) => void;
  /**
   * Send a finished utterance and get the reply back.
   *
   * Injected rather than called directly so this class stays about audio and
   * turn-taking: the caller owns the endpoint, the session id and the
   * history. It also means the loop can be driven in a test without a
   * network.
   */
  onUserTurn: (text: string) => Promise<AssistantTurn | null>;
  /**
   * Fetch the audio for a sentence that has already been shown.
   *
   * Optional. When it is supplied, onUserTurn is expected to return text with
   * no audio and this is called straight after — which puts the sentence on
   * screen while the voice is still being synthesised, instead of after.
   */
  onSpeak?: (text: string) => Promise<{ audioBase64: string | null; mime?: string; ttsMs?: number | null } | null>;
  /**
   * Send one finished utterance and get the words back.
   *
   * Injected for the same reason as onUserTurn: this class owns audio and
   * turn-taking, the caller owns the endpoint and the session id. It is also
   * what lets the whole loop be driven in a test with no network and no
   * microphone.
   */
  onTranscribe: (audioBase64: string, languageHint: string | null) => Promise<TranscriptionReply | null>;
  /**
   * Ask for a credential that can transcribe while somebody is still talking.
   *
   * Optional, and allowed to refuse. When it returns null — or the socket
   * will not hold — the batch path above carries the session instead, a
   * little slower. An optimisation with a fallback, not a dependency.
   */
  onListenGrant?: () => Promise<LiveGrant | null>;
  /**
   * One streamed turn: their sentence in, our words and our voice out, as
   * they are produced.
   *
   * When present this replaces onUserTurn entirely. Voice Studio still uses
   * the older request-and-reply path, which is why both exist.
   */
onConverse?: (text: string, signal: AbortSignal, turnId: string) => AsyncIterable<ConverseEvent>;
  /** The conversation state the server sent back, to carry into the next turn. */
  /**
   * The assistant is offering a real Homatch destination.
   *
   * The session does not navigate: it hands this to the UI, which renders a
   * button. Being sent somewhere mid-sentence by a voice is not a thing
   * anybody wants done to them without a tap.
   */
  onAction?: (action: { kind: 'NAVIGATE'; key: string; path: string }) => void;
  /** The assistant has decided the call is over, once this reply is spoken. */
  onEnded?: (reason: string) => void;
  onConversationState?: (state: unknown) => void;
  /** Live counters, about once a second. Counts and codes, never a key. */
  onDiagnostics?: (d: VoiceDiagnostics) => void;
}

export interface VoiceMilestone {
  event:
    | 'session_granted' | 'mic_open' | 'audio_context_running'
    | 'first_input_audio' | 'first_speech' | 'first_utterance_sent'
    | 'first_transcript' | 'user_turn_sent'
    | 'assistant_text' | 'tts_audio_received' | 'playback_started'
    | 'playback_ended' | 'listening_resumed' | 'session_ended' | 'silent_turn' | 'illegal_transition'
  | 'no_final_recovered' | 'failed';
  /** Milliseconds since start() was called. */
  atMs: number;
  /** A code or a count. Never content. */
  detail?: string | number | null;
}

/**
 * What counts as somebody speaking.
 *
 * Deliberately low. A quiet phone held at arm's length in a room with a fan
 * in it produces less level than a laptop headset, and a threshold tuned on a
 * headset is a microphone that never hears anybody.
 */
const SPEECH_RMS = 0.012;

/**
 * Silence that ends an utterance.
 *
 * Long enough to pause mid-sentence, short enough that it is not most of the
 * wait. It is the one part of the round trip that costs nothing to shorten,
 * so it is kept as tight as a natural pause allows.
 */
const END_SILENCE_MS = 700;

/** Audio kept from before speech was detected, so no first syllable is lost. */
const PREROLL_MS = 400;

/** Below this there is nothing worth a provider call — a cough, a door. */
const MIN_SPEECH_MS = 320;

/**
 * VOICED audio required before an utterance is sent, as opposed to total
 * length.
 *
 * A clip that is mostly silence with one thump in it is not speech, and
 * sending it is worse than dropping it: asked to transcribe near-silence with
 * a vocabulary hint, the model hands the hint back as though somebody had
 * said it. Observed in production — a 1.2-second clip came back as the
 * Georgian real-estate glossary, word for word, and went to the assistant as
 * a sentence the visitor had supposedly spoken.
 *
 * The server refuses those too. This stops them being paid for.
 */
const MIN_VOICED_MS = 260;

/**
 * How much speech is held while a recogniser socket is being replaced.
 *
 * Three seconds is longer than any rotation measured (a grant round trip and
 * a handshake, about half a second to a second) and short enough that a
 * socket which never returns cannot grow a buffer worth worrying about.
 */
/*
 * How sustained speech has to be before a failure to resolve it counts as
 * evidence about the LANGUAGE rather than evidence that somebody said "ok".
 * Above the longest of the end-of-turn windows, so a one-word answer can
 * never earn a probe no matter how often it is given.
 */
const SWITCH_PROBE_SPEECH_MS = 900;
/** Consecutive sustained-but-unresolved turns before asking the provider. */
const SWITCH_PROBE_AFTER_TURNS = 2;

/*
 * HOW LONG A SOCKET IS ALLOWED TO BE "COMING".
 *
 * Holding audio is only correct while a recogniser is moments away. Past
 * that, a session that keeps holding is a session that has stopped taking
 * turns -- which is exactly what shipped: three paths set `liveExpected` and
 * returned without clearing it, and the hold branch then returned before the
 * batch path could ever run. Twenty-one seconds of a real conversation went
 * into a three-second ring and out the other side, and no turn completed.
 *
 * So patience is bounded in milliseconds, not only in bytes, and running out
 * of it drops to the batch path rather than holding forever.
 */
/**
 * The longest the assistant may hold the floor before the gate is forced.
 * Longer than any reply this product produces; short enough that a stuck
 * session recovers inside one conversation rather than never.
 */
const MIC_GATE_MAX_MS = 15_000;

/**
 * How long an already-started answer may keep speaking after the session's
 * time is up. Long enough for a normal reply to land, short enough that a
 * reply which never finishes cannot hold the session open.
 */
const SESSION_LIMIT_GRACE_MS = 12_000;

/*
 * HOW LONG A REQUESTED FINAL MAY TAKE BEFORE ITS ABSENCE IS A FACT.
 *
 * The worker half-closes and waits FINAL_GRACE for Google to flush; measured,
 * a final lands about 600ms after the close on a normal turn and never more
 * than a couple of seconds. Six seconds is comfortably past that and still
 * short enough that a visitor whose word was lost is listening again before
 * they have finished wondering.
 */
const NO_FINAL_TIMEOUT_MS = 6_000;
/** Consecutive misses before the session stops reconnecting and says so. */
const MAX_CONSECUTIVE_NO_FINALS = 3;

const PRE_READY_MAX_MS = 2500;
/** Capacity of the hold buffer, in canonical 16 kHz PCM. */
const PRE_READY_MAX_SECONDS = 3;

/** How much of the sent audio a debug session keeps, in memory, at most. */
const TAP_MAX_SECONDS = 30;

/*
 * WHEN TO DECIDE A LIVE TURN IS OVER, RATHER THAN WAIT TO BE TOLD.
 *
 * Chirp 3's endpointer measures 1.6-2.8 seconds after somebody stops talking,
 * and a short "კი." never endpoints at all. Half-closing the stream flushes
 * the final in about 310ms instead, so the wait becomes a decision this
 * session makes from its own voice activity.
 *
 * The window is ADAPTIVE because one number cannot serve both cases. A person
 * answering "კი" has finished the moment the word ends; a person composing
 * "ვაკეში მინდა ბინა... ორ ოთახიანი" pauses mid-thought, and cutting them
 * there turns one sentence into two turns and two wrong answers. So a short
 * utterance is committed briskly, and a longer one is given the benefit of
 * the doubt.
 *
 * Nothing here is allowed to fire before there has been real speech, which is
 * what stops a room's background noise from committing empty turns.
 */
/*
 * THREE TIERS, CHOSEN FROM HOW MUCH VOICE THERE HAS BEEN.
 *
 * MEASURED, voiced audio in real Cartesia Georgian:
 *
 *   კი 260ms   არა 300ms   ჰო 380ms          one-word answers
 *   კარგი 580ms   დიახ 820ms                  also complete answers
 *   "მინდა ბინა" 840ms                        NOT complete: a fragment
 *   "მინდა ოროთახიანი ბინა კრიწანისში." 1940ms  a finished sentence
 *
 * The middle of that list is the problem and it is why there are three tiers
 * rather than two. A complete "კარგი" and an unfinished "მინდა ბინა" are the
 * same length, carry the same energy, and cannot be told apart acoustically.
 * Since one of them is still being composed, the tier they share has to be
 * PATIENT -- measured, a 650ms mid-sentence pause was being cut in half by
 * the old single 520ms window, turning one request into two wrong answers.
 *
 * Below 450ms there is no such ambiguity: nothing in this language is a
 * quarter-second fragment of a longer thought. Those finalise briskly.
 */
const END_TURN_ACK_MS = 300;
/*
 * 600ms, and the number is a measured trade rather than a preference.
 *
 * A/B through one corrected harness, same corpus, back to back:
 *
 *   mid window 520ms   speech_end -> final  p50 1251ms
 *   mid window 700ms   speech_end -> final  p50 1447ms
 *
 * Most real utterances land in this tier, so every millisecond here is paid
 * on the common case. Against that, the pause sweep: a 700ms window keeps a
 * mid-sentence pause of up to 600ms, a 520ms window only about 400ms, and a
 * person composing a requirement pauses for longer than 400ms often.
 *
 * 600ms keeps pauses to roughly half a second for about eighty milliseconds
 * over the old behaviour. Faster than protecting everything, safer than
 * chasing the benchmark.
 */
const END_TURN_SHORT_MS = 600;
const END_TURN_LONG_MS = 900;
/*
 * Speech shorter than this is not an utterance, it is a noise.
 *
 * It was 240ms, which is within the measurement noise of "კი" at 260ms -- so
 * whether the fastest path in the system applied to the shortest word in the
 * language depended on how that particular take was synthesised. A gate that
 * close to the thing it is gating is a coin toss.
 */
const END_TURN_MIN_SPEECH_MS = 140;
/** Under this, an utterance is a one-word answer with nothing to continue. */
const END_TURN_ACK_SPEECH_MS = 450;
/** Above this, a composed sentence: patient, because it may pause to think. */
const END_TURN_LONG_SPEECH_MS = 1600;

/** A single utterance ceiling, so one long monologue cannot grow unbounded. */
const MAX_UTTERANCE_MS = 30_000;

/**
 * Where each state may go. Terminal states go nowhere; a new session is a new
 * object. Any state may reach the error and end states, which is what an
 * error IS: something that can happen from anywhere.
 */
const ALWAYS: VoiceState[] = ['ENDED', 'PROVIDER_ERROR', 'LIMIT_REACHED', 'MIC_UNAVAILABLE', 'MIC_DENIED', 'RECONNECTING'];
const ALLOWED_TRANSITIONS: Partial<Record<VoiceState, VoiceState[]>> = {
  IDLE: ['CONNECTING', ...ALWAYS],
  CONNECTING: ['LISTENING', ...ALWAYS],
  LISTENING: ['UNDERSTANDING', 'RESPONDING', ...ALWAYS],
  UNDERSTANDING: ['RESPONDING', 'LISTENING', ...ALWAYS],
  RESPONDING: ['INTERRUPTED', 'LISTENING', 'UNDERSTANDING', ...ALWAYS],
  INTERRUPTED: ['LISTENING', 'UNDERSTANDING', ...ALWAYS],
  RECONNECTING: ['LISTENING', ...ALWAYS],
};

export class VoiceSession {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private resampler: Resampler | null = null;
  /** A second conversion, to the rate the live socket was opened at. */
  private liveResampler: Resampler | null = null;
  private live: LiveSocket | null = null;
  /** The id of the user turn currently being revised by partial text. */
  private livePartialId: string | null = null;
  private playbackTime = 0;
  /** True while the assistant is speaking: mic blocks are dropped, not kept. */
  private micGated = false;
  /*
   * WHEN THE GATE CLOSED, so it cannot stay closed forever.
   *
   * The gate is released by resumeListening(), which every reply path calls
   * in a `finally`. That is only as reliable as the promise it is waiting on:
   * measured in a real browser, a reply whose playback never settled left the
   * microphone gated for the rest of the session while the panel still read
   * LISTENING, and no further turn was possible. A session that cannot hear
   * anybody must not look like one that can.
   */
  private micGatedAt = 0;
  /** True once the session's time is up: no new turn may begin. */
  private newTurnsBlocked = false;
  private sessionEndReason: string | null = null;
  private gateReleases = 0;
  /** True while the visitor has muted themselves. Their choice, not ours. */
  private muted = false;
  /** Guards against two turns in flight. */
  private turnInFlight = false;
  /**
   * A finished sentence that arrived while the previous turn was still going.
   *
   * It used to be dropped on the floor. Google's endpointer takes one and a
   * half to three seconds to decide a short Georgian word is over -- `კი`
   * measured 2.1s, `არა` never endpointed at all and only came back on the
   * half-close -- so a final routinely lands AFTER the turn it belongs to has
   * started, and an acknowledgement the visitor definitely said simply never
   * happened. Held here instead and answered when the floor is free.
   *
   * One, not a queue: while a turn is in flight the microphone is gated and
   * nothing new is being transcribed, so at most one final can be in the air.
   * A second would mean a bug somewhere else, and the newer sentence is the
   * one the visitor would expect an answer to.
   */
  private pendingFinal: { text: string; detected: string | null } | null = null;
  /** A language the recogniser must be reopened for, once the floor is free. */
  private relistenLanguage: TalkLanguage | null = null;
  /*
   * WHAT A REAL MICROPHONE TEST HAS TO BE ABLE TO ANSWER.
   *
   * Every latency number so far comes from synthetic speech played into the
   * stack. The questions a real device raises are different and cannot be
   * answered from a laptop: was the first syllable captured, did the socket
   * exist yet when somebody started talking, and how fast does the assistant
   * actually stop when interrupted.
   *
   * These are counters and timestamps only. No audio is retained anywhere,
   * and the transcript shown is the person's own words on their own screen.
   */
  private turnTrace: Array<Record<string, unknown>> = [];
  /*
   * SPEECH THAT ARRIVES WHILE THERE IS NO SOCKET TO SEND IT TO.
   *
   * Ending a turn deliberately spends its recogniser stream, so every turn is
   * followed by a rotation: close, ask the server for a fresh grant, open a
   * new socket. That is a round trip and a handshake -- half a second to a
   * second -- and for that whole window the live path has nowhere to put
   * audio.
   *
   * On synthetic fixtures the rotation always landed in the eleven seconds of
   * silence between clips, so this measured zero and I believed it. The first
   * real Android trace measured 853ms and then 1877ms of voiced audio
   * arriving with no socket ready: a person answers straight away, and the
   * front of every reply after the first was being lost. That is why the
   * Georgian came back as fragments and why it got worse each turn.
   *
   * So it is held instead of dropped, in the rate the socket wants, and
   * flushed in order the moment one exists. Bounded, because a socket that
   * never comes back must not grow a buffer without limit -- and past the
   * bound the OLDEST audio goes, since the newest speech is the speech the
   * visitor is still in the middle of.
   */
  private preReadyVoicedMs = 0;
  private lastPreReadyFlush: { bytes: number; ms: number } | null = null;
  /** Where a block of audio goes, and every byte counter. See liveAudioRouter. */
  private router = new LiveAudioRouter({
    sampleRate: LIVE_SAMPLE_RATE,
    maxBufferMs: PRE_READY_MAX_SECONDS * 1000,
    maxWaitMs: PRE_READY_MAX_MS,
  });

  /*
   * THE SOCKET'S LIFECYCLE, NAMED.
   *
   * `liveExpected` was one boolean standing for "a socket exists or is being
   * opened", and three different paths could leave it true with nothing on
   * the way: onUnavailable nulled the socket and fell back to batch without
   * clearing it, and openLiveTranscription returned early -- on a failed
   * grant, or a closed session -- after rotateLive had just set it. A phone
   * whose grant request failed once then held every block for the rest of
   * the session and completed no turns at all.
   *
   * A named phase makes each of those a state that has to be written down,
   * and `liveExpectedSince` makes "coming" something that can expire.
   */

  /*
   * BYTE ACCOUNTING, ALL IN ONE UNIT: canonical 16 kHz mono signed Int16.
   *
   * Nothing here counts 48 kHz Float32 input. Every counter below is the
   * outgoing representation, so they can be added up and checked against
   * each other:
   *
   *   postResampleBytes = sentLiveBytes + flushedBufferedBytes
   *                     + currentBufferedBytes + droppedPcmBytes
   *
   * A byte belongs to exactly one of them, and none may disappear.
   */
  private socketConnectStartedAt = 0;
  /*
   * A COPY OF EXACTLY WHAT THE RECOGNISER WAS SENT, FOR A DEBUG SESSION ONLY.
   *
   * When a person says their Georgian was not understood there are two
   * completely different faults behind it, and no amount of reading the
   * transcript separates them: either the audio leaving this browser was
   * already wrong -- clipped, resampled badly, missing its beginning -- or it
   * was fine and the recogniser misheard it. The first is ours and the second
   * is not.
   *
   * So the post-resample PCM can be kept and played back, bounded to the last
   * thirty seconds, in memory, only while ?debugAiTalk=1 is on, and only
   * handed over when somebody presses a button. It is never uploaded, never
   * written to storage, and discarded with the session.
   */
  private tapEnabled = false;
  private tap: Int16Array[] = [];
  private tapSamples = 0;
  /** Voiced audio seen before the recogniser socket was ready to take it. */
  private voicedBeforeReadyMs = 0;
  /** When the visitor's speech interrupted the assistant, and when it stopped. */
  private bargeSpeechAt = 0;
  private lastBargeStopMs: number | null = null;
  /** Voiced milliseconds in the utterance currently being spoken to the socket. */
  private liveSpeechMs = 0;
  /** True once this turn has been ended deliberately; reset on a new socket. */
  private liveEnded = false;
  /** The final owed after every finalize(), and what to do if it never comes. */
  private finalWatch = new FinalWatch({
    timeoutMs: NO_FINAL_TIMEOUT_MS,
    maxConsecutive: MAX_CONSECUTIVE_NO_FINALS,
  });
  /** True while an utterance is being transcribed. */
  private transcribing = false;
  /** Sent to the server so each reply is in context. */
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private assistantSeq = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private playingSources: AudioBufferSourceNode[] = [];
  /**
   * The reply's voice, converted once and scheduled continuously.
   *
   * Replaces a scheduler that made one AudioBuffer per provider chunk at the
   * PROVIDER's sample rate, which made the browser resample every chunk
   * independently and put a step in the waveform at every join. That was the
   * whine.
   */
  private player: PcmStreamPlayer | null = null;
  /**
   * Which turn is currently allowed to make a sound.
   *
   * Every async result carries the generation it was started for. A late STT
   * final, a model token from an abandoned request, or an audio chunk that
   * crossed an interruption on the wire all arrive after the turn they belong
   * to is over, and all of them used to be acted on.
   */
  private turnGeneration = 0;
  /**
   * The id of the turn in flight, sent with its request so the server's
   * trace and this side's diagnostics name the same thing. Distinct from the
   * generation: the generation is what stale events are checked against, the
   * id is what a person greps for.
   */
  private turnId: string | null = null;
  /** How this turn's language was decided, for the trace and for the request. */
  private lastResolution: LanguageResolution | null = null;
  /** The recogniser's raw label for the last utterance. Evidence, never an answer. */
  private lastProviderLanguage: string | null = null;
  /** The interface language, which is where somebody arrived, not what they speak. */
  private readonly pageLocale: string;
  /** Cancels the in-flight turn's request when the visitor interrupts. */
  private turnAbort: AbortController | null = null;
  /** Where the next streamed phrase should start, on the audio clock. */
  private queueTime = 0;
  /** Reads the level of what the assistant is saying, for the visualiser. */
  private outputAnalyser: AnalyserNode | null = null;
  private outputGain: GainNode | null = null;
  private outputBins: Uint8Array<ArrayBuffer> | null = null;

  // ── Utterance capture ───────────────────────────────────────────────────
  /** Resampled blocks of the utterance being spoken right now. */
  private capture: Float32Array[] = [];
  private captureSamples = 0;
  private capturing = false;
  /** Milliseconds of this utterance that were actually above the speech floor. */
  private voicedMs = 0;
  /** A rolling window of what came before speech was detected. */
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;

  /*
   * EVIDENCE THAT THE PRIOR IS WRONG -- not evidence that one word was odd.
   *
   * A turn counts as weak only if the speaker was sustained about it: at
   * least SWITCH_PROBE_SPEECH_MS above the speech floor, and still nothing
   * the language decision could resolve against the prior. One short token
   * never counts, which is the whole point -- "Abba" was one short token.
   *
   * Two such turns in a row, and the NEXT socket is allowed to ask the
   * provider what it is hearing. One socket, then back to the prior.
   */
  private weakTurns = 0;
  private probeLanguageNext = false;

  // ── Diagnostics. Every one of these is counted, never inferred. ─────────
  private diag = {
    blocks: 0, samplesCaptured: 0, bytesSent: 0, rms: 0, peakRms: 0,
    utterances: 0, lastUtteranceMs: null as number | null,
    lastUtteranceBytes: null as number | null,
    sttRequests: 0, sttOk: 0, sttEmpty: 0, sttFailed: 0, finalsDeferred: 0, languageSwitches: 0, languageProbes: 0,
    livePhase: 'IDLE' as LivePhase, socketReadyMs: null as number | null,
    socketFailures: 0, socketReconnects: 0, gateReleases: 0,
    liveSendRate: null as number | null,
    sessionEndReason: null as string | null,
    llmTextChars: null as number | null, ttsTextChars: null as number | null,
    ttsRequests: null as number | null,
    assistantResponseCompleted: null as boolean | null,
    responseInterruptReason: null as string | null,
    finalTextTail: null as string | null,
    lastRelisten: null as string | null,
    lastBargeStopMs: null as number | null,
    preReadyFlushBytes: 0, preReadyFlushMs: 0,
    turnsEndedLocally: 0,
    lastEndTurnSilenceMs: null as number | null, lastEndTurnSpeechMs: null as number | null,
    lastSttMs: null as number | null, lastSttChars: null as number | null,
    lastSttLanguage: null as string | null, lastTranscript: null as string | null,
    turnsSent: 0, lastTurnMs: null as number | null,
    lastReplyChars: null as number | null, lastAudioBytes: null as number | null,
    lastLlmMs: null as number | null, lastTtsMs: null as number | null,
    lastPlaybackMs: null as number | null,
    playbacks: 0, lastError: null as string | null,
    liveMode: 'batch' as 'live' | 'batch',
    liveModel: null as string | null,
    liveProvider: null as string | null,
    liveKeyterms: null as number | null,
    streamedTts: null as boolean | null,
    stages: null as {
      endpointingMs: number | null; transcriptionMs: number | null;
      dispatchMs: number | null; llmTtftMs: number | null; handoffMs: number | null;
      ttsFirstAudioMs: number | null; playbackMs: number | null; perceivedMs: number | null;
    } | null,
    liveFellBack: null as string | null,
    voiceFailure: null as string | null,
    // AUDIBLE, or the reason the reply was not heard.
    playback: null as string | null,
  };
  private diagHandle: number | null = null;

  private turns: TranscriptTurn[] = [];
  private language: LanguageState;
  private state: VoiceState = 'IDLE';
  private startedAt = 0;
  /** When start() was called, so milestones are relative to the attempt and
   *  not to the moment the session finally succeeded. */
  private attemptAt = 0;
  private seenMilestones = new Set<string>();
  private lastVoiceAt = 0;
  private sustainedSpeechMs = 0;
  private agentAudioStartedAt = 0;
  private marks: LatencyMarks = {};
  private tickHandle: number | null = null;
  private utteranceSeq = 0;
  private currentUtteranceId: string | null = null;
  private closed = false;

  constructor(
    private grant: VoiceGrant,
    private cb: VoiceCallbacks,
  ) {
    /*
     * The interface language seeds the session and is remembered separately.
     * It is where somebody arrived, not what they are speaking, so the
     * resolver treats it as the weakest evidence there is — but it is the
     * right answer for turn one, before anybody has said anything.
     */
    this.pageLocale = grant.primaryLanguage || 'ka';
    this.language = { current: this.pageLocale, locked: false, votes: [] };
  }

  /** Record a milestone once. Repeats are noise: the FIRST is the fact. */
  private milestone(event: VoiceMilestone['event'], detail?: string | number | null): void {
    if (this.seenMilestones.has(event)) return;
    this.seenMilestones.add(event);
    this.cb.onMilestone?.({
      event,
      atMs: this.attemptAt ? Date.now() - this.attemptAt : 0,
      detail: detail ?? null,
    });
  }

  get currentState(): VoiceState { return this.state; }

  /**
   * Stop listening without stopping the session.
   *
   * The track is left running rather than stopped: stopping it would hand the
   * device back and unmuting would need a second permission moment on some
   * browsers. Blocks are dropped instead, which is instant in both directions
   * and visibly true — the level meter and the orb go flat.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.dropCapture();
  }

  get isMuted(): boolean { return this.muted; }

  get consumedSeconds(): number {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  async start(): Promise<void> {
    this.attemptAt = Date.now();
    this.seenMilestones.clear();
    this.milestone('session_granted', this.grant.maxDurationSec);
    this.setState('CONNECTING');
    try {
      /*
       * getUserMedia CAN HANG FOREVER, AND DID.
       *
       * It resolves when the browser decides, and the browser may never
       * decide: a permission prompt left open, a device another application
       * is holding, a virtual device that never initialises. There was no
       * timeout here, so "Connecting" was a terminal state — the control span
       * and nothing ever contradicted it. Observed on a machine with no
       * microphone at all.
       *
       * Thirty seconds is deliberately generous: a person reading a
       * permission dialog is not stuck, and cutting them off at five would
       * turn a normal grant into a failure.
       */
      await withTimeout(this.openMicrophone(), 30_000, 'MIC_TIMEOUT');
    } catch (e) {
      // Each of these is a different thing to tell somebody, and they used to
      // collapse into two. "Allow the microphone" is useless advice to a
      // person who has no microphone.
      const reason = classifyMicError(e);
      this.milestone('failed', reason);
      this.setState(reason === 'MIC_DENIED' ? 'MIC_DENIED' : 'MIC_UNAVAILABLE', (e as Error)?.message);
      this.cb.onError?.(reason);
      return;
    }

    this.milestone('mic_open');

    // The microphone is open before the socket is, so the session's very
    // first syllable is held by the same mechanism that holds a rotation's.
    this.expectLive('CONNECTING');
    await this.openLiveTranscription();

    this.startedAt = Date.now();
    this.setState('LISTENING');

    this.tickHandle = window.setInterval(() => {
      this.cb.onSecondsConsumed(this.consumedSeconds);
      // A local ceiling as well as the server's. The server grant is the
      // control; this stops an obviously-overrunning session before the next
      // heartbeat would.
      if (this.consumedSeconds >= this.grant.maxDurationSec) this.reachSessionLimit();
      // A final owed for too long -- a socket that neither answers nor
      // closes -- is the same miss as a socket that closed empty.
      const owed = this.finalWatch.tick(Date.now());
      if (owed) this.recoverFromNoFinal(owed);
    }, 250);

    // Diagnostics are published on their own clock, not on the audio
    // callback's: the audio callback runs 50 times a second and a React state
    // update per block would cost more than the transcription does.
    this.diagHandle = window.setInterval(() => this.publishDiagnostics(), 700);
    this.publishDiagnostics();
  }

  /** Everything this session can honestly say about itself, right now. */
  diagnostics(): VoiceDiagnostics {
    const track = this.micStream?.getAudioTracks()[0] ?? null;
    return {
      micReady: Boolean(track && track.readyState === 'live'),
      trackState: track?.readyState ?? null,
      trackMuted: track ? track.muted : null,
      trackEnabled: track ? track.enabled : null,
      contextSampleRate: this.audioContext?.sampleRate ?? null,
      contextState: this.audioContext?.state ?? null,
      /*
       * The rate the LIVE socket is carrying, not the batch path's constant.
       *
       * This reported TARGET_SAMPLE_RATE unconditionally -- a different
       * pipeline's rate -- which happened to be 16,000 and so happened to be
       * right. A number that is only accidentally correct is not evidence.
       */
      sendSampleRate: this.diag.liveSendRate ?? TARGET_SAMPLE_RATE,
      resampling: this.resampler ? !this.resampler.passthrough : false,
      rms: this.diag.rms,
      peakRms: this.diag.peakRms,
      blocks: this.diag.blocks,
      samplesCaptured: this.diag.samplesCaptured,
      bytesSent: this.diag.bytesSent,
      capturing: this.capturing,
      silenceMs: this.lastVoiceAt ? Date.now() - this.lastVoiceAt : null,
      utterances: this.diag.utterances,
      lastUtteranceMs: this.diag.lastUtteranceMs,
      lastUtteranceBytes: this.diag.lastUtteranceBytes,
      sttRequests: this.diag.sttRequests,
      sttOk: this.diag.sttOk,
      sttEmpty: this.diag.sttEmpty,
      sttFailed: this.diag.sttFailed,
      finalsDeferred: this.diag.finalsDeferred ?? 0,
      languageSwitches: this.diag.languageSwitches ?? 0,
      languageProbes: this.diag.languageProbes ?? 0,
      livePhase: this.router.currentPhase,
      socketReadyMs: this.diag.socketReadyMs ?? null,
      socketFailures: this.router.socketFailures,
      socketReconnects: this.router.socketReconnects,
      postResampleBytes: this.router.postResampleBytes,
      sentLiveBytes: this.router.sentLiveBytes,
      flushedBufferedBytes: this.router.flushedBufferedBytes,
      bufferedPcmBytes: this.router.bufferedBytes,
      batchedPcmBytes: this.router.batchedPcmBytes,
      maxPreReadyBufferBytes: this.router.maxBufferedBytes,
      bufferDurationMs: Math.round(this.router.bufferedMs),
      bufferFormat: this.router.bufferFormat,
      micGated: this.micGated,
      transcribing: this.transcribing,
      gateReleases: this.gateReleases,
      noFinalCount: this.finalWatch.noFinalCount,
      consecutiveNoFinals: this.finalWatch.consecutiveNoFinals,
      noFinalRecoveries: this.finalWatch.noFinalRecoveries,
      lastNoFinalReason: this.finalWatch.lastNoFinalReason,
      lastNoFinalAt: this.finalWatch.lastNoFinalAt,
      socketCloseReason: this.finalWatch.socketCloseReason,
      socketCloseHadFinal: this.finalWatch.socketCloseHadFinal,
      sessionElapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      sessionMaxMs: this.grant.maxDurationSec * 1000,
      sessionRemainingMs: Math.max(
        0, this.grant.maxDurationSec * 1000 - (this.startedAt ? Date.now() - this.startedAt : 0),
      ),
      turnCount: this.diag.turnsSent,
      newTurnsBlocked: this.newTurnsBlocked,
      sessionEndReason: this.diag.sessionEndReason ?? null,
      llmTextChars: this.diag.llmTextChars ?? null,
      ttsTextChars: this.diag.ttsTextChars ?? null,
      ttsRequests: this.diag.ttsRequests ?? null,
      assistantResponseCompleted: this.diag.assistantResponseCompleted ?? null,
      responseInterruptReason: this.diag.responseInterruptReason ?? null,
      finalTextTail: this.diag.finalTextTail ?? null,
      playbackQueuedChunks: this.player?.queuedChunks ?? 0,
      playbackCompletedChunks: this.player?.completedChunks ?? 0,
      /*
       * EVERY BYTE IS IN EXACTLY ONE CATEGORY.
       *
       * If this ever reads false, a byte was counted twice or vanished, and
       * every other number here is suspect. It is computed rather than
       * asserted so a real device reports it instead of crashing on it.
       */
      bytesAccountedFor: this.router.accountsBalance(),
      lastRelisten: this.diag.lastRelisten ?? null,
      lastBargeStopMs: this.diag.lastBargeStopMs ?? null,
      voicedBeforeReadyMs: Math.round(this.voicedBeforeReadyMs),
      preReadyFlushBytes: this.diag.preReadyFlushBytes ?? 0,
      preReadyFlushMs: this.diag.preReadyFlushMs ?? 0,
      droppedPreReadyBytes: this.router.droppedPcmBytes,
      turnTrace: this.turnTrace,
      turnsEndedLocally: this.diag.turnsEndedLocally ?? 0,
      lastEndTurnSilenceMs: this.diag.lastEndTurnSilenceMs ?? null,
      lastEndTurnSpeechMs: this.diag.lastEndTurnSpeechMs ?? null,
      lastSttMs: this.diag.lastSttMs,
      lastSttChars: this.diag.lastSttChars,
      lastSttLanguage: this.diag.lastSttLanguage,
      lastTranscript: this.diag.lastTranscript,
      turnsSent: this.diag.turnsSent,
      lastTurnMs: this.diag.lastTurnMs,
      lastLlmMs: this.diag.lastLlmMs,
      lastTtsMs: this.diag.lastTtsMs,
      lastPlaybackMs: this.diag.lastPlaybackMs,
      lastReplyChars: this.diag.lastReplyChars,
      lastAudioBytes: this.diag.lastAudioBytes,
      playbacks: this.diag.playbacks,
      lastError: this.diag.lastError,
      liveMode: this.diag.liveMode,
      liveModel: this.diag.liveModel,
      liveProvider: this.diag.liveProvider,
      liveKeyterms: this.diag.liveKeyterms,
      streamedTts: this.diag.streamedTts,
      stages: this.diag.stages,
      liveFellBack: this.diag.liveFellBack,
      voiceFailure: this.diag.voiceFailure,
      playback: this.diag.playback,
      state: this.state,
    };
  }

  private publishDiagnostics(): void {
    this.cb.onDiagnostics?.(this.diagnostics());
  }

  async stop(reason = 'user_ended'): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.tickHandle !== null) { clearInterval(this.tickHandle); this.tickHandle = null; }
    if (this.diagHandle !== null) { clearInterval(this.diagHandle); this.diagHandle = null; }
    this.stopPlayback();

    this.dropCapture();
    this.live?.close();
    this.live = null;
    this.processor?.disconnect();
    this.processor = null;
    this.micStream?.getTracks().forEach((tr) => tr.stop());
    this.micStream = null;
    await this.audioContext?.close().catch(() => { /* already closed */ });
    this.audioContext = null;

    if (this.state !== 'LIMIT_REACHED' && this.state !== 'MIC_DENIED' && this.state !== 'MIC_UNAVAILABLE') {
      this.milestone('session_ended', reason);
      this.setState('ENDED', reason);
    }
  }

  // ── Microphone ────────────────────────────────────────────────────────────

  private async openMicrophone(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Echo cancellation is what makes barge-in work on a laptop speaker.
        // Without it the agent's own voice comes back in and reads as the user
        // interrupting on every single utterance.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        // A REQUEST, and a request the device is free to refuse. Nothing below
        // this line assumes it was granted.
        sampleRate: TARGET_SAMPLE_RATE,
      },
    });

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    /*
     * THE CONTEXT IS CONSTRUCTED WITHOUT A sampleRate OPTION, ON PURPOSE.
     *
     * Asking for 16 kHz and being handed 48 kHz is the normal outcome on a
     * phone, and on some browsers asking at all throws. The old code asked,
     * assumed, and then told the transcription service the audio was 16 kHz —
     * so on every device that refused, each second of speech was labelled as
     * a third of a second and came back as nothing. The level meter still
     * moved, which is why it read as "the microphone works and nothing else".
     *
     * Take whatever rate the device gives and convert it below, where the
     * conversion is deterministic and has tests.
     */
    this.audioContext = new Ctx();

    /*
     * A CONSTRUCTED AudioContext IS NOT A RUNNING ONE.
     *
     * Chrome creates it suspended unless it can attribute the construction to
     * a user gesture, and this one is built after an await on getUserMedia,
     * by which point the transient activation may already have lapsed. A
     * suspended context does not advance currentTime and does not emit a
     * sound.
     */
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => { /* shows in diagnostics */ });
    }
    if (this.audioContext.state === 'running') this.milestone('audio_context_running');

    this.resampler = new Resampler(this.audioContext.sampleRate, TARGET_SAMPLE_RATE);
    /*
     * Everything the assistant says goes through one gain node with an
     * analyser on it. That is what lets the visualiser react to the actual
     * voice rather than to a timer pretending to be one, and it gives
     * barge-in somewhere to duck.
     */
    this.outputGain = this.audioContext.createGain();
    this.outputAnalyser = this.audioContext.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputBins = new Uint8Array(new ArrayBuffer(this.outputAnalyser.frequencyBinCount));
    this.outputGain.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.audioContext.destination);

    /*
     * THE PLAYER IS BUILT AFTER THE NODE IT PLAYS INTO. THIS IS NOT A STYLE
     * POINT.
     *
     * It was built eight lines above this, guarded by `if (this.outputGain)`
     * -- which was null, because the gain node is created here. So the player
     * was never constructed, and `this.player?.push()` in enqueuePcm dropped
     * every chunk of every reply on the floor. Silently: optional chaining on
     * a null that is never supposed to be null is indistinguishable from
     * working code, and the only symptom was that AI TALK made no sound.
     *
     * Nothing caught it. The server counted the audio events it sent, the
     * client counted the ones it received, and both were right; nobody
     * checked that a buffer had been scheduled. That is why there is now a
     * hard assertion below and a `playbackStarted` signal that means what it
     * says.
     */
    this.player = new PcmStreamPlayer(this.audioContext, this.outputGain);

    const source = this.audioContext.createMediaStreamSource(this.micStream);

    // ScriptProcessor is deprecated and is used deliberately: an AudioWorklet
    // needs a separate module file served from the same origin, which the
    // published bundle does not guarantee, and this path works in every
    // browser Homatch supports today.
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      this.onAudioBlock(event.inputBuffer.getChannelData(0));
    };

    source.connect(this.processor);
    // Routed to a muted gain node rather than to the destination: connecting a
    // live microphone to the speakers is how a demo screams at its user.
    const sink = this.audioContext.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.audioContext.destination);
  }

  /**
   * One block from the microphone.
   *
   * Runs about ten times a second, so it does arithmetic and nothing else: no
   * promises, no React, no network. The only decisions it makes are which
   * samples belong to the utterance being spoken, and when that utterance
   * ended.
   */
  private onAudioBlock(input: Float32Array): void {
    const level = rms(input);
    this.diag.blocks += 1;
    this.diag.rms = level;
    if (level > this.diag.peakRms) this.diag.peakRms = level;

    // Proof that the microphone is producing samples, not just that it opened.
    // An open device that yields silence is its own failure and used to be
    // indistinguishable from a working one.
    this.milestone('first_input_audio');
    this.cb.onLevel(this.muted ? 0 : level);

    // How long this block represents, from the rate the device actually runs
    // at rather than the rate we wish it ran at.
    const blockMs = this.audioContext
      ? (input.length / this.audioContext.sampleRate) * 1000
      : 0;
    this.trackVoiceActivity(level, blockMs);

    // The silence clock. Set here, before the gate below, so that a voice
    // heard while the assistant is speaking still counts as a voice.
    if (level >= SPEECH_RMS) this.lastVoiceAt = Date.now();

    /*
     * THE MICROPHONE IS IGNORED WHILE THE ASSISTANT SPEAKS.
     *
     * Echo cancellation is not enough on a laptop speaker: the reply comes
     * back in and is transcribed as if the visitor had said it. Blocks are
     * dropped rather than the track being stopped, so resuming is instant and
     * there is no second permission moment.
     */
    // The live socket is told about the assistant rather than starved of
    // audio: it has to discard what it already buffered, or our own voice
    // comes back as their next sentence.
    /*
     * THE GATE IS NOT ALLOWED TO OUTLIVE THE REPLY.
     *
     * Generous on purpose -- longer than any reply this product produces --
     * so it never fires on a conversation that is merely slow, and always
     * fires on one that is stuck. Counted, so a trace can say it happened.
     */
    if (this.micGated && this.micGatedAt && Date.now() - this.micGatedAt > MIC_GATE_MAX_MS) {
      this.gateReleases += 1;
      this.diag.gateReleases = this.gateReleases;
      this.diag.lastError = this.diag.lastError ?? 'GATE_STUCK';
      this.stopPlayback();
      this.resumeListening();
    }

    this.live?.setGated(this.micGated || this.muted);

    if (this.muted || this.micGated || this.transcribing) { this.dropCapture(); return; }

    /*
     * WHEN THE LIVE SOCKET IS UP, IT IS THE ONLY CONSUMER.
     *
     * Running both would pay for every sentence twice and answer it twice.
     * The endpointing is the provider's as well — its voice detection hears a
     * pause inside a sentence differently from the end of one, which is the
     * thing an energy threshold here was never going to get right.
     */
    /*
     * SPEECH THAT ARRIVED BEFORE THERE WAS ANYWHERE TO SEND IT.
     *
     * The session only says LISTENING once the socket is open, so in theory
     * this is always zero. In practice a socket can drop and be replaced
     * mid-conversation, and a person who starts talking in that window loses
     * the front of their word. Counted rather than assumed, because "no
     * first-syllable clipping" is exactly the claim that needs evidence from
     * a real microphone.
     */
    if (level >= SPEECH_RMS && !this.live?.isReady && !this.micGated && !this.muted) {
      this.voicedBeforeReadyMs += blockMs;
      this.preReadyVoicedMs += blockMs;
    }

    /*
     * No socket yet, but one is coming: keep the audio rather than lose it.
     *
     * Only while a live socket is expected. When the session has genuinely
     * fallen back to the batch path there is nothing to flush into, and the
     * batch capture below is the right home for it.
     */
    /*
     * RESAMPLED ONCE, THEN ROUTED.
     *
     * The router owns where a block goes and every byte counter that goes
     * with it, and it is driven directly by rotationGap.test.mjs -- which is
     * the point. The version this replaces made its decision inline, so the
     * only tests that could see it were reading its source, and they passed
     * while the session was completing no turns at all.
     */
    const liveReady = Boolean(this.live?.isReady);
    const expecting = this.router.currentPhase === 'CONNECTING'
      || this.router.currentPhase === 'ROTATING';
    if ((liveReady || expecting) && this.liveResampler
        && !this.micGated && !this.muted && !this.transcribing) {
      const out = this.liveResampler.process(input);
      if (out.length) {
        // Canonical form, once: 16 kHz mono signed Int16, exactly the bytes
        // the recogniser would be sent. Never re-resampled afterwards.
        const pcm = floatToPcm16(out);
        const route = this.router.route(pcm, liveReady);
        if (route.kind === 'SEND') {
          this.diag.samplesCaptured += out.length;
          this.diag.bytesSent += pcm.byteLength;
          this.live!.append(pcm);
          // The same bytes, kept only for a debug session. See tapEnabled.
          if (this.tapEnabled) this.recordTap(pcm);
        } else if (route.kind === 'BATCH') {
          // Patience ran out inside the router. Say so, then let the batch
          // capture below take this block: the conversation keeps going.
          this.noteLiveAbandoned();
        }
        if (route.kind === 'HELD') return;
      }
      if (liveReady) {
        if (level >= SPEECH_RMS) this.liveSpeechMs += blockMs;
        this.maybeEndLiveTurn();
        return;
      }
    }


    const block = this.resampler ? this.resampler.process(input) : input.slice();
    if (!block.length) return;

    if (level >= SPEECH_RMS) {
      if (!this.capturing) {
        // Start from the pre-roll, or the first syllable is gone before
        // anything noticed a voice. A Georgian word can lose its whole first
        // consonant in the time it takes the level to cross a threshold.
        this.capturing = true;
        this.capture = this.preroll.slice();
        this.captureSamples = this.prerollSamples;
        this.voicedMs = 0;
        this.milestone('first_speech');
      }
      this.voicedMs += blockMs;
      this.capture.push(block);
      this.captureSamples += block.length;
      this.diag.samplesCaptured += block.length;
      return;
    }

    if (this.capturing) {
      // Trailing silence belongs to the utterance: a transcription model uses
      // it to hear that the sentence is over.
      this.capture.push(block);
      this.captureSamples += block.length;
      this.diag.samplesCaptured += block.length;

      const silenceMs = this.lastVoiceAt ? Date.now() - this.lastVoiceAt : 0;
      const lengthMs = (this.captureSamples / TARGET_SAMPLE_RATE) * 1000;
      if (silenceMs >= END_SILENCE_MS || lengthMs >= MAX_UTTERANCE_MS) {
        void this.finishUtterance();
      }
      return;
    }

    // Not speaking and not capturing: keep the last PREROLL_MS, so the next
    // utterance does not start mid-word.
    this.preroll.push(block);
    this.prerollSamples += block.length;
    const keep = (PREROLL_MS / 1000) * TARGET_SAMPLE_RATE;
    while (this.prerollSamples > keep && this.preroll.length > 1) {
      this.prerollSamples -= this.preroll[0].length;
      this.preroll.shift();
    }
  }


  /**
   * Has this person finished talking, and should the sentence be asked for?
   *
   * Every condition here is a way of being WRONG about that, and each one has
   * a cost: ending a turn nobody started sends an empty utterance; ending one
   * mid-sentence answers half a question; ending one while the assistant is
   * speaking transcribes the assistant. So the checks are all refusals, and
   * the decision is only taken when none of them applies.
   */
  private maybeEndLiveTurn(): void {
    const live = this.live;
    if (!live?.finalize || this.liveEnded || live.isFinalizing) return;
    // Not while the assistant holds the floor, and not while a turn it has
    // already been given is still being answered.
    if (this.micGated || this.muted || this.turnInFlight || this.closed) return;
    /*
     * The session's time is up: no NEW turn starts, but one already speaking
     * is allowed to finish. Cutting the assistant off in the middle of a
     * sentence to enforce a clock reads as a crash, not as an ending.
     */
    if (this.newTurnsBlocked) return;
    // Nothing was said. Background noise is not a turn.
    if (this.liveSpeechMs < END_TURN_MIN_SPEECH_MS) return;

    const silenceMs = this.lastVoiceAt ? Date.now() - this.lastVoiceAt : 0;
    /*
     * A composed sentence gets the longer window, a one-word answer the
     * shorter one. The measurement that matters is how much VOICE there has
     * been, not how long the microphone has been open: a long pause before
     * "კი" is still a one-word answer.
     */
    const window = this.liveSpeechMs < END_TURN_ACK_SPEECH_MS
      ? END_TURN_ACK_MS
      : this.liveSpeechMs >= END_TURN_LONG_SPEECH_MS
        ? END_TURN_LONG_MS
        : END_TURN_SHORT_MS;
    if (silenceMs < window) return;

    this.liveEnded = true;
    this.marks.speechEndedAtMs = Date.now() - silenceMs;
    this.marks.endpointConfirmedAtMs = Date.now();
    this.diag.turnsEndedLocally = (this.diag.turnsEndedLocally ?? 0) + 1;
    this.diag.lastEndTurnSilenceMs = silenceMs;
    this.diag.lastEndTurnSpeechMs = Math.round(this.liveSpeechMs);
    if (!live.finalize()) {
      // The socket would not take it; leave the provider's endpointer to it
      // rather than stranding the turn.
      this.liveEnded = false;
      return;
    }
    // From here a final is owed. If it never comes, the watch says so.
    this.finalWatch.requested(Date.now());
    if (this.state === 'LISTENING') this.setState('UNDERSTANDING');
  }

  /**
   * NO FINAL CAME. Recover, or stop and say so -- never sit dead.
   *
   * The old socket is spent either way. On RECOVER the session rotates to a
   * fresh one exactly as it does after a normal turn, clears the end-of-turn
   * latch that was holding the microphone, and goes back to LISTENING; the
   * visitor repeats one sentence instead of losing the conversation. Nothing
   * is sent to the model: an empty utterance is not a turn.
   */
  private recoverFromNoFinal(decision: FinalDecision): void {
    if (this.closed) return;
    this.liveSpeechMs = 0;
    this.liveEnded = false;
    this.livePartialId = null;

    if (decision.kind === 'GIVE_UP') {
      // Bounded: three misses in a row is a provider that is not answering,
      // and reconnecting to it for ever is the freeze wearing a new name.
      this.diag.lastError = `NO_FINAL_REPEATED:${decision.reason}`;
      this.abandonLive(`no final ${this.finalWatch.consecutiveNoFinals} times in a row`);
      if (this.state === 'UNDERSTANDING') this.setState('LISTENING');
      return;
    }
    this.milestone('no_final_recovered', decision.reason);
    void this.rotateLive();
    if (this.state === 'UNDERSTANDING') this.setState('LISTENING');
    this.publishDiagnostics();
  }

  /**
   * Replace the recogniser socket with a fresh one.
   *
   * Asking for a final ENDS that stream -- the worker closes it once Google
   * has flushed the sentence -- so every deliberate turn boundary costs one
   * socket. Opened while the assistant is still being written and spoken, so
   * the grant round trip happens in time nobody is waiting through.
   */
  private async rotateLive(): Promise<void> {
    if (this.closed) return;
    const old = this.live;
    this.live = null;
    /*
     * The resampler SURVIVES the rotation. It carries interpolation phase and
     * the last sample across calls, so replacing it mid-conversation puts a
     * discontinuity into the audio at exactly the moment the visitor is most
     * likely to be speaking. It is also what converts the held audio, so it
     * has to exist while there is no socket.
     */
    this.liveSpeechMs = 0;
    this.liveEnded = false;
    /*
     * A socket is coming, so audio arriving now is held rather than dropped
     * -- and `expectLive` starts the clock that stops it being held forever.
     *
     * The old socket is closed first and deliberately. It has already been
     * half-closed by finalize() and is draining Google's last transcript, so
     * it cannot accept another byte: overlapping the two would not keep the
     * microphone live, it would only keep a dead stream open. What the gap
     * costs is the grant and the handshake, which is what the hold buffer is
     * for and what socketReadyMs now measures.
     */
    this.expectLive('ROTATING');
    try { old?.close(); } catch { /* already gone */ }
    await this.openLiveTranscription();
  }

  /**
   * Try the live socket. Fall back silently if it will not hold.
   *
   * Silently on purpose: a visitor has no use for the difference, and the
   * difference is a second of latency rather than a broken conversation. It
   * is recorded in the diagnostics, where somebody can act on it.
   */
  private async openLiveTranscription(): Promise<void> {
    if (!this.cb.onListenGrant || !this.audioContext) { this.abandonLive('no grant source'); return; }

    /*
     * A GRANT THAT NEVER ARRIVES IS STILL AN ANSWER.
     *
     * rotateLive() arms the hold branch and then waits here. On a phone this
     * request is a network round trip that can simply fail, and when it did,
     * the shipped build returned from this function with the session still
     * holding -- for the rest of the conversation. That is the state the
     * Android trace was in: 688,128 bytes held and evicted, zero turns.
     */
    let grant: LiveGrant | null = null;
    try { grant = await this.cb.onListenGrant(); } catch { grant = null; }
    if (!grant?.token || this.closed) {
      this.abandonLive(this.closed ? 'session closed' : 'no grant');
      return;
    }

    // The provider decides the rate, because ElevenLabs mints its token for
    // 16 kHz and OpenAI's socket runs at 24. Resampling to the wrong one is
    // silence with the right byte count.
    const rate = grant.sampleRate ?? LIVE_SAMPLE_RATE;
    /*
     * THE PRIOR IS THE CONFIGURATION. `auto` IS A PROBE.
     *
     * This used to send `detect` on every socket the session had not yet
     * locked -- which is the FIRST turn of every conversation, the turn that
     * decides the language for all the ones after it. On a real Android
     * microphone that turn came back as the single token "Abba" from Georgian
     * speech, and the whole session went to English behind it.
     *
     * Unrestricted detection is not a mode this service runs in: the gateway
     * says so in its own comment, and the measurement behind it says `auto`
     * damages short Georgian badly. Handing it the deciding turn was the
     * regression against the known-good baseline, which configured one
     * language code and never asked.
     *
     * So the recogniser is configured with the PRIOR -- the language this
     * session is in, seeded from the page the visitor chose. Not a lock: a
     * prior. `auto` is still reachable, but only as a bounded probe, only
     * after sustained speech has repeatedly failed to resolve against that
     * prior, and never on the strength of one weak token. See weakTurns.
     */
    const probing = this.probeLanguageNext;
    this.probeLanguageNext = false;
    this.diag.languageProbes = (this.diag.languageProbes ?? 0) + (probing ? 1 : 0);
    const live = createTranscriber({ ...grant, detect: probing }, {
      onSpeechStart: () => {
        this.lastVoiceAt = Date.now();
        /*
         * Not while the microphone is gated. Saying LISTENING then is how a
         * session that could not hear a word still looked like it was
         * waiting for one -- the exact thing the panel is for.
         */
        if (this.state === 'UNDERSTANDING' && !this.turnInFlight && !this.micGated) {
          this.setState('LISTENING');
        }
      },
      onSpeechEnd: () => {
        // The provider's endpointer, not ours. This is the moment the wait
        // a person actually feels begins.
        this.marks.speechEndedAtMs = Date.now();
        this.marks.endpointConfirmedAtMs = Date.now();
        if (!this.turnInFlight) this.setState('UNDERSTANDING');
      },
      onPartial: (text) => this.showPartial(text),
      onFinal: (text, heard) => { void this.onLiveFinal(text, heard ?? null); },
      onNoFinal: (reason) => {
        const decision = this.finalWatch.missed(reason, Date.now());
        if (decision) this.recoverFromNoFinal(decision);
      },
      onUnavailable: (reason) => {
        /*
         * Back to the batch path for the rest of the session, rather than a
         * conversation that quietly stops hearing anybody.
         *
         * This used to null the socket and set the mode WITHOUT disarming the
         * hold branch, so "fall back to batch" left the session holding every
         * block and reaching no batch at all. abandonLive is the only way to
         * say a socket is not coming, precisely so that cannot happen again.
         */
        this.diag.lastError = this.diag.lastError ?? null;
        this.abandonLive(reason);
      },
    });

    const opened = await live.open();
    if (!opened || this.closed) {
      // Nothing is coming after all: the held audio has no home, and the
      // batch path is where the next utterance belongs.
      this.abandonLive('socket did not open');
      return;
    }

    /*
     * A resampler ONLY when there is not already one.
     *
     * It carries interpolation phase and the last sample across calls, so
     * replacing it mid-conversation puts a step into the waveform at the
     * join. Across a rotation the rate has not changed and the old one is
     * still correct -- and it is the thing that converted the audio now
     * waiting to be flushed.
     */
    if (!this.liveResampler) {
      this.liveResampler = new Resampler(this.audioContext.sampleRate, rate);
    }
    // The rate the grant actually negotiated, so every duration and label the
    // router reports is in the unit the socket is really carrying.
    this.router.configure(rate);
    this.diag.liveSendRate = rate;

    /*
     * THE HELD SPEECH GOES FIRST, IN ORDER, BEFORE ANYTHING NEW.
     *
     * Assigned and flushed in the same synchronous run: an audio block cannot
     * interleave here, so nothing the microphone produces during the flush
     * can overtake what was recorded before it. Chronological by
     * construction, and each buffer is sent exactly once.
     */
    this.live = live;
    this.diag.livePhase = 'READY';
    this.diag.socketReadyMs = this.socketConnectStartedAt
      ? Date.now() - this.socketConnectStartedAt : null;
    /*
     * THE HELD SPEECH GOES FIRST, IN ORDER, BEFORE ANYTHING NEW.
     *
     * `ready()` empties the buffer as it hands it over, so a chunk cannot be
     * sent to a second recogniser, and the assignment and the flush happen in
     * the same synchronous run -- an audio block cannot interleave here, so
     * nothing the microphone produces during the flush can overtake what was
     * recorded before it.
     */
    const startedAt = Date.now();
    const held = this.router.ready();
    this.diag.socketReconnects = this.router.socketReconnects;
    if (held.length) {
      let bytes = 0;
      for (const chunk of held) {
        live.append(chunk);
        bytes += chunk.byteLength;
      }
      this.lastPreReadyFlush = { bytes, ms: Date.now() - startedAt };
      this.diag.preReadyFlushBytes = bytes;
      this.diag.preReadyFlushMs = this.lastPreReadyFlush.ms;
    }

    this.diag.liveMode = 'live';
    this.diag.liveModel = grant.model ?? null;
    this.diag.liveProvider = grant.provider ?? null;
    this.diag.liveKeyterms = grant.keyterms?.length ?? null;
  }

  /**
   * One place that turns marks into stages, so the callback and the on-screen
   * readout can never disagree about what a turn cost.
   */
  private publishLatency(): void {
    const b = latencyBreakdown(this.marks);
    this.diag.stages = {
      endpointingMs: b.endpointingMs,
      transcriptionMs: b.transcriptionMs,
      dispatchMs: b.dispatchMs,
      llmTtftMs: b.llmTtftMs,
      handoffMs: b.handoffMs,
      ttsFirstAudioMs: b.ttsFirstAudioMs,
      playbackMs: b.playbackMs,
      perceivedMs: b.perceivedMs,
    };
    this.cb.onLatency?.(b);
    this.publishDiagnostics();
  }

  /** Words that are still arriving. Shown, never committed. */
  private showPartial(text: string): void {
    if (!text.trim() || this.closed) return;
    if (!this.livePartialId) {
      this.utteranceSeq += 1;
      this.livePartialId = `u${this.utteranceSeq}`;
    }
    this.turns = reduceTranscript(this.turns, {
      id: this.livePartialId,
      speaker: 'USER',
      text,
      final: false,
      language: this.language.current,
      atMs: Date.now(),
    });
    this.diag.lastTranscript = text.slice(0, 160);
    this.cb.onTranscript(this.turns);
  }

  /** The finished sentence, from the live socket. */
  private async onLiveFinal(text: string, detected: string | null = null): Promise<void> {
    if (this.closed) return;

    /*
     * A REAL TRANSCRIPT IS NEVER THROWN AWAY, ONLY DELAYED.
     *
     * This is a final from the recogniser -- a finished sentence it committed
     * to, not a partial and not a guess. Returning here used to lose it
     * completely, and lose it twice over: the early return also skipped the
     * livePartialId reset below, so the next utterance reused this one's
     * transcript id and overwrote it. The visitor saw their word appear and
     * then vanish.
     */
    if (this.turnInFlight) {
      this.pendingFinal = { text, detected };
      this.diag.finalsDeferred = (this.diag.finalsDeferred ?? 0) + 1;
      return;
    }

    const said = text.trim();
    const id = this.livePartialId ?? `u${++this.utteranceSeq}`;
    this.livePartialId = null;

    /*
     * A turn we ended ourselves has spent its socket: the worker closes the
     * stream once Google has flushed the sentence. Replace it NOW rather than
     * when the floor comes back, so the grant round trip overlaps the reply
     * being written and spoken instead of the silence before the next one.
     */
    if (said) this.finalWatch.arrived();
    if (this.live?.isFinalizing) void this.rotateLive();
    this.liveSpeechMs = 0;
    this.liveEnded = false;

    if (!said) { this.resumeListening(); return; }

    this.diag.sttOk += 1;
    this.diag.sttRequests += 1;
    this.diag.lastSttChars = said.length;
    this.diag.lastTranscript = said.slice(0, 160);
    if (this.marks.speechEndedAtMs) {
      this.diag.lastSttMs = Date.now() - this.marks.speechEndedAtMs;
    }
    this.marks.transcriptFinalAtMs = Date.now();

    this.turns = reduceTranscript(this.turns, {
      id, speaker: 'USER', text: said, final: true,
      language: this.language.current, atMs: Date.now(),
    });
    this.milestone('first_transcript', this.turns.length);
    this.cb.onTranscript(this.turns);

    /*
     * THE TURN'S LANGUAGE, DECIDED ONCE, BY ONE THING.
     *
     * This used to be a stabiliser fed the provider's label, which was
     * reasonable until the provider started returning languages this product
     * does not speak. Short Georgian came back as Korean, Luxembourgish and
     * Hausa -- transcript and all -- and each of those became a vote. The
     * resolver cannot do that: its answer is one of six by construction, an
     * unsupported label contributes nothing, and an established session only
     * moves on evidence strong enough to mean it.
     */
    const resolution = resolveTurnLanguage({
      transcript: said,
      providerLanguage: detected,
      previousSessionLanguage: this.language.current,
      pageLocale: this.pageLocale,
    });
    this.lastResolution = resolution;
    this.lastProviderLanguage = detected;

    /*
     * Did this turn resolve against the prior, or only survive it?
     *
     * STICKY_HELD means the decision kept the prior because the evidence for
     * leaving it was too thin -- the right call for one token, and a signal
     * worth counting when it keeps happening to somebody who is plainly
     * talking. Sustained speech that still cannot resolve is the only thing
     * that earns a probe.
     */
    const sustained = (this.diag.lastEndTurnSpeechMs ?? 0) >= SWITCH_PROBE_SPEECH_MS;
    const unresolved = resolution.resolutionReason === 'STICKY_HELD' || resolution.confidence < 0.5;
    this.weakTurns = sustained && unresolved ? this.weakTurns + 1 : 0;
    /*
     * THE FIRST TURN IS THE ONE A VISITOR JUDGES US ON.
     *
     * Somebody who opens a Georgian page and speaks Arabic gets Arabic
     * rendered in Georgian letters, and under the two-turn rule they have to
     * sit through that twice before the session will even ask what language
     * they are speaking. That was reported, accurately, as "Arabic does not
     * work".
     *
     * One turn is enough HERE because the sustained-speech guard is doing the
     * protective work, not the count: "Abba" was 4 letters of a clipped word
     * and never reached SWITCH_PROBE_SPEECH_MS, so the case that started all
     * of this still cannot earn a probe at any threshold. A whole sentence
     * that the prior could not make sense of is different evidence.
     *
     * After a turn has resolved once, the session is established and the
     * full two-turn rule applies again.
     */
    const firstTurn = this.diag.turnsSent <= 1;
    const needed = firstTurn ? 1 : SWITCH_PROBE_AFTER_TURNS;
    if (this.weakTurns >= needed) {
      this.probeLanguageNext = true;
      this.weakTurns = 0;
    }

    const before = this.language.current;
    this.language = {
      ...this.language,
      current: resolution.resolvedLanguage,
      locked: resolution.confidence >= 0.6,
    };
    if (this.language.current !== before || this.language.locked) {
      this.cb.onLanguage(this.language.current, this.language.locked);
    }

    this.publishDiagnostics();
    await this.takeTurn(said);
  }

  /** Keep the last TAP_MAX_SECONDS of what was actually sent. */
  private recordTap(pcm: Int16Array): void {
    this.tap.push(pcm);
    this.tapSamples += pcm.length;
    const cap = TAP_MAX_SECONDS * LIVE_SAMPLE_RATE;
    while (this.tapSamples > cap && this.tap.length > 1) {
      this.tapSamples -= this.tap.shift()!.length;
    }
  }

  /** Turn the tap on for this session. Debug surfaces only. */
  enableAudioTap(): void { this.tapEnabled = true; }

  /**
   * What the recogniser was sent, as a WAV somebody can actually listen to.
   *
   * The whole point is the ear: a number cannot tell you that the first
   * syllable is missing or that the voice sounds slowed down, and a person
   * playing this back can tell in one second which side of Google the fault
   * is on.
   */
  exportSentAudio(): Blob | null {
    if (!this.tap.length) return null;
    const total = this.tapSamples;
    const pcm = new Int16Array(total);
    let at = 0;
    for (const chunk of this.tap) { pcm.set(chunk, at); at += chunk.length; }
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const header = new DataView(new ArrayBuffer(44));
    const ascii = (off: number, text: string) => {
      for (let i = 0; i < text.length; i++) header.setUint8(off + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    header.setUint32(4, 36 + bytes.length, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);            // PCM
    header.setUint16(22, 1, true);            // mono
    header.setUint32(24, LIVE_SAMPLE_RATE, true);
    header.setUint32(28, LIVE_SAMPLE_RATE * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    ascii(36, 'data');
    header.setUint32(40, bytes.length, true);
    return new Blob([header.buffer, bytes], { type: 'audio/wav' });
  }

  /** Let go of held audio when no socket is coming for it. */
  /**
   * A socket is on its way. Audio arriving from here is held, but not forever.
   */
  private expectLive(phase: 'CONNECTING' | 'ROTATING'): void {
    this.router.expect(phase);
    this.socketConnectStartedAt = Date.now();
    this.diag.livePhase = phase;
  }

  /** The router gave up on its own. Record it where a person can see it. */
  private noteLiveAbandoned(): void {
    try { this.live?.close(); } catch { /* already gone */ }
    this.live = null;
    this.diag.livePhase = 'FAILED';
    this.diag.liveMode = 'batch';
    this.diag.liveFellBack = this.router.lastFellBack;
    this.diag.socketFailures = this.router.socketFailures;
    this.publishDiagnostics();
  }

  /**
   * NOTHING IS COMING. Stop holding audio and let the batch path take turns.
   *
   * Every early return that leaves a socket unopened has to come through
   * here. The regression this replaces was three of them that did not: the
   * hold branch stayed armed, it returned before the batch capture below it,
   * and the session stopped completing turns entirely while still showing
   * itself as listening.
   */
  private abandonLive(reason: string): void {
    this.router.abandon(reason);
    this.noteLiveAbandoned();
  }

  private dropCapture(): void {
    this.capture = [];
    this.captureSamples = 0;
    this.capturing = false;
    this.voicedMs = 0;
    this.preroll = [];
    this.prerollSamples = 0;
  }

  /**
   * Send what was just said, and show what comes back.
   *
   * The old design could not fail visibly here: transcription was a socket
   * that had already been declared healthy at connect time, so when the
   * provider dropped it the panel went on saying "Listening" to somebody
   * talking to nothing. Every branch below ends in either words on the screen
   * or a state that admits the problem.
   */
  private async finishUtterance(): Promise<void> {
    if (!this.capturing || this.transcribing || this.closed) return;

    const blocks = this.capture;
    const samples = this.captureSamples;
    this.capture = [];
    this.captureSamples = 0;
    this.capturing = false;
    this.preroll = [];
    this.prerollSamples = 0;

    const lengthMs = (samples / TARGET_SAMPLE_RATE) * 1000;
    const voicedMs = this.voicedMs;
    this.voicedMs = 0;
    // A cough, a chair, a door — or a room with a fan in it.
    if (lengthMs < MIN_SPEECH_MS || voicedMs < MIN_VOICED_MS) return;

    this.transcribing = true;
    this.marks.speechEndedAtMs = this.lastVoiceAt || Date.now();
    this.setState('UNDERSTANDING');

    const wav = encodeWav(floatToPcm16(joinBlocks(blocks)), TARGET_SAMPLE_RATE);
    this.diag.utterances += 1;
    this.diag.lastUtteranceMs = Math.round(lengthMs);
    this.diag.lastUtteranceBytes = wav.byteLength;
    this.diag.bytesSent += wav.byteLength;
    this.milestone('first_utterance_sent', wav.byteLength);
    this.publishDiagnostics();

    const sentAt = Date.now();
    this.diag.sttRequests += 1;
    let reply: TranscriptionReply | null = null;
    try {
      reply = await this.cb.onTranscribe(
        bytesToBase64(wav),
        // Only hint once the conversation has actually settled into a
        // language. Hinting from the page's locale is how a Russian speaker
        // reading a Georgian page gets Georgian letters back.
        this.language.locked ? this.language.current : null,
      );
    } catch {
      reply = null;
    }
    this.diag.lastSttMs = Date.now() - sentAt;

    if (this.closed) { this.transcribing = false; return; }

    if (!reply) {
      this.diag.sttFailed += 1;
      this.diag.lastError = 'TRANSCRIBE_FAILED';
      this.transcribing = false;
      this.milestone('failed', 'TRANSCRIBE');
      this.cb.onError?.('TRANSCRIBE_FAILED');
      // Transcription that failed is not a conversation that is listening.
      this.setState('PROVIDER_ERROR');
      this.publishDiagnostics();
      return;
    }

    const said = (reply.text ?? '').trim();
    if (!said) {
      // Silence, or noise. Explicitly NOT a model call: answering nothing
      // produces an assistant talking to itself.
      this.diag.sttEmpty += 1;
      this.diag.lastSttChars = 0;
      this.transcribing = false;
      this.resumeListening();
      this.publishDiagnostics();
      return;
    }

    this.diag.sttOk += 1;
    this.diag.lastSttChars = said.length;
    this.diag.lastSttLanguage = reply.language ?? null;
    this.diag.lastTranscript = said.slice(0, 160);
    this.marks.transcriptFinalAtMs = Date.now();
    this.marks.endpointConfirmedAtMs = Date.now();

    this.utteranceSeq += 1;
    this.turns = reduceTranscript(this.turns, {
      id: 'u' + this.utteranceSeq,
      speaker: 'USER',
      text: said,
      final: true,
      language: reply.language ?? null,
      atMs: Date.now(),
    });
    this.milestone('first_transcript', this.turns.length);
    this.cb.onTranscript(this.turns);

    const before = this.language.current;
    this.language = stabiliseLanguage(this.language, {
      text: said, detected: reply.language ?? null, confidence: 0.8,
    });
    if (this.language.current !== before || this.language.locked) {
      this.cb.onLanguage(this.language.current, this.language.locked);
    }

    this.transcribing = false;
    this.publishDiagnostics();
    await this.takeTurn(said);
  }

  /**
   * The conversational loop, one lap.
   *
   * Their finished sentence goes to the server, which writes the reply and
   * speaks it. The text is shown the moment it arrives — before the audio
   * starts, not after it finishes — because reading the answer while hearing
   * it is what makes this feel like a conversation rather than a wait.
   */
  private async takeTurn(said: string): Promise<void> {
    if (this.closed || this.turnInFlight || !said.trim()) return;

    this.turnInFlight = true;
    this.history.push({ role: 'user', content: said });
    const askedAt = Date.now();
    this.diag.turnsSent += 1;

    // Gate the microphone BEFORE anything can come back, so the first audio
    // of the reply cannot be transcribed as if the visitor said it.
    this.micGated = true;
    this.micGatedAt = Date.now();
    this.setState('UNDERSTANDING');
    this.milestone('user_turn_sent', said.length);

    try {
      if (this.cb.onConverse) await this.streamedTurn(said, askedAt);
      else await this.requestReplyTurn(said, askedAt);
    } finally {
      this.turnInFlight = false;
      this.publishDiagnostics();
    }

    /*
     * Anything said while that turn was running gets answered now.
     *
     * After turnInFlight is false, so the recursion is one level: the
     * deferred sentence takes an ordinary turn, and anything deferred during
     * THAT turn is drained by that turn's own finally.
     */
    /*
     * ONE ROW PER TURN, FOR A PERSON HOLDING A REAL PHONE.
     *
     * Everything here is a duration or a count. The transcript is included
     * because the question a real-device test asks is "what did it actually
     * hear", and it is the speaker's own words shown back to them on their
     * own screen; nothing is stored or sent anywhere by this.
     */
    this.turnTrace.push({
      at: new Date().toISOString(),
      heard: this.diag.lastTranscript,
      language: this.language.current,
      endTurnSilenceMs: this.diag.lastEndTurnSilenceMs,
      endTurnSpeechMs: this.diag.lastEndTurnSpeechMs,
      sttMs: this.diag.lastSttMs,
      llmMs: this.diag.lastLlmMs ?? null,
      firstAudioMs: this.diag.lastPlaybackMs ?? null,
      bargeStopMs: this.lastBargeStopMs,
      // Per turn, not cumulative: the first trace reported a running total
      // and had to be differenced by hand to see that ~1000ms was being lost
      // on every rotation.
      voicedBeforeReadyMs: Math.round(this.preReadyVoicedMs),
      preReadyFlushBytes: this.diag.preReadyFlushBytes ?? 0,
      droppedPreReadyBytes: this.router.droppedPcmBytes,
      deferredFinals: this.diag.finalsDeferred ?? 0,
    });
    this.preReadyVoicedMs = 0;
    this.diag.preReadyFlushBytes = 0;
    if (this.turnTrace.length > 40) this.turnTrace.shift();

    const deferred = this.pendingFinal;
    this.pendingFinal = null;
    if (deferred && !this.closed) await this.onLiveFinal(deferred.text, deferred.detected);
  }

  /**
   * A turn that arrives while it is still being produced.
   *
   * The sentence appears word by word and the voice starts on the first
   * phrase, not the last. Everything here is about not waiting for a stage
   * that has already produced something usable.
   */
  private async streamedTurn(said: string, askedAt: number): Promise<void> {
    this.assistantSeq += 1;
    const id = `a${this.assistantSeq}`;
    let text = '';
    let failure: string | null = null;
    let spoke = false;
    /** Set if the assistant decided this is the last turn. Acted on after it has spoken. */
    let endReason: string | null = null;

    this.queueTime = 0;

    /*
     * THIS TURN'S GENERATION.
     *
     * Claimed before anything is awaited. Everything that comes back —
     * tokens, audio chunks, the final transcript that was already in flight —
     * is checked against it, so an interrupted turn cannot speak over the one
     * that replaced it. stopPlayback() advances the generation, which is what
     * makes an interruption take effect immediately rather than after the
     * next chunk happens to arrive.
     */
    this.turnGeneration += 1;
    const generation = this.turnGeneration;
    this.turnId = `t${generation}-${Date.now().toString(36)}`;
    this.player?.startTurn(generation);

    /*
     * T3. Everything the SERVER reports is an offset from here, because the
     * two machines do not share a clock and subtracting one's now() from the
     * other's measures skew rather than latency.
     */
    this.marks.turnRequestedAtMs = Date.now();

    try {
      /*
       * The turn's own controller. Aborting it stops the request rather than
       * merely ignoring what comes back: a visitor who interrupted is not
       * waiting for the rest of that answer, and neither is the bill for
       * synthesising it.
       */
      this.turnAbort = new AbortController();
      for await (const event of this.cb.onConverse!(said, this.turnAbort.signal, this.turnId ?? `t${generation}`)) {
        if (this.closed) return;
        // The visitor interrupted, or a newer turn started. Whatever is still
        // arriving belongs to a conversation that has moved on.
        if (generation !== this.turnGeneration) return;

        switch (event.type) {
          case 'text': {
            text += event.delta;
            if (!this.marks.llmFirstTokenAtMs) {
              // When the first token reached the BROWSER. The server reports
              // its own figure at 'done'; this one includes transport, which
              // is exactly what the caller waited through.
              this.marks.llmFirstTokenAtMs = Date.now();
              this.milestone('assistant_text', 0);
            }
            // Shown as a non-final turn: it is still being written, and
            // reduceTranscript revises rather than appends for the same id.
            this.turns = reduceTranscript(this.turns, {
              id, speaker: 'AGENT', text, final: false,
              language: this.language.current, atMs: Date.now(),
            });
            this.cb.onTranscript(this.turns);
            break;
          }
          case 'reply': {
            text = event.text || text;
            /*
             * THE SERVER'S LANGUAGE WINS, BECAUSE IT SAW SOMETHING WE CANNOT.
             *
             * This browser resolves a turn's language from the transcript and
             * the recogniser's label, and for "ინგლისურად მელაპარაკე" both
             * say Georgian -- correctly, because it IS a Georgian sentence.
             * The server additionally reads it as a REQUEST and answers in
             * English. If that were not adopted here the next recogniser
             * would still be configured for Georgian and the visitor, now
             * speaking English, would get nonsense back.
             */
            this.adoptLanguage(event.language);
            this.turns = reduceTranscript(this.turns, {
              id, speaker: 'AGENT', text, final: true,
              language: event.language ?? this.language.current, atMs: Date.now(),
            });
            this.cb.onTranscript(this.turns);
            this.diag.lastReplyChars = text.length;
            break;
          }
          case 'audio': {
            this.enqueuePcm(event.pcmBase64, event.sampleRate);
            this.diag.lastAudioBytes = (this.diag.lastAudioBytes ?? 0)
              + Math.round(event.pcmBase64.length * 0.75);
            if (!spoke) {
              spoke = true;
              this.diag.playbacks += 1;
              this.marks.ttsFirstAudioAtMs = Date.now();
              if (this.marks.speechEndedAtMs) {
                this.diag.lastPlaybackMs = Date.now() - this.marks.speechEndedAtMs;
              }
              this.milestone('tts_audio_received', event.pcmBase64.length);
              this.milestone('playback_started');
              this.setState('RESPONDING');
              this.publishLatency();
            }
            break;
          }
          case 'action':
            // Handed straight to the UI. Nothing here navigates on its own.
            this.cb.onAction?.({ kind: event.kind, key: event.key, path: event.path });
            break;

          case 'end':
            /*
             * Remembered, not obeyed yet. The reply is still being spoken,
             * and cutting the voice off to close the panel would end the call
             * mid-sentence — which reads as a crash, not as a goodbye.
             */
            endReason = event.reason;
            break;

          case 'state':
            this.cb.onConversationState?.(event.state);
            break;
          case 'voiceless': {
            // Carried through rather than flattened: a language with no
            // approved voice is a configuration, not an outage, and the
            // visitor should not be invited to retry it.
            const code = event.reason === 'VOICE_NOT_APPROVED_FOR_LANGUAGE'
              ? 'VOICE_NOT_APPROVED_FOR_LANGUAGE'
              : 'VOICE_UNAVAILABLE';
            this.diag.lastError = code;
            this.diag.voiceFailure = [event.providerCode, event.providerStatus]
              .filter((v) => v !== undefined && v !== null).join(' ') || null;
            this.cb.onError?.(code);
            break;
          }
          case 'done': {
            this.diag.lastTurnMs = Date.now() - askedAt;
            this.diag.lastLlmMs = event.firstTextMs ?? null;
            this.diag.lastTtsMs = event.ttsMs ?? null;
            /*
             * The server's half of the turn, replacing the browser's
             * provisional estimate with what actually happened inside it.
             * These are offsets from T3 and are never subtracted from a
             * browser timestamp -- see LatencyMarks.
             */
            /*
             * A reply that ran out of room is not a short reply. Recorded
             * here so the panel can say so, because from the audio alone a
             * visitor can only tell that it stopped.
             */
            this.diag.llmTextChars = event.llmTextChars ?? null;
            this.diag.ttsTextChars = event.ttsTextChars ?? null;
            this.diag.ttsRequests = event.ttsRequests ?? null;
            this.diag.assistantResponseCompleted = event.assistantResponseCompleted ?? null;
            this.diag.responseInterruptReason = event.responseInterruptReason ?? null;
            this.diag.finalTextTail = event.finalTextTail ?? null;

            const timing = event.timing;
            if (timing) {
              if (typeof timing.llmFirstTokenMs === 'number') {
                this.marks.serverLlmFirstTokenMs = timing.llmFirstTokenMs;
              }
              if (typeof timing.ttsRequestMs === 'number') {
                this.marks.serverTtsRequestMs = timing.ttsRequestMs;
              }
              if (typeof timing.ttsFirstByteMs === 'number') {
                this.marks.serverTtsFirstByteMs = timing.ttsFirstByteMs;
              }
              this.marks.streamed = timing.streamed ?? null;
              this.diag.streamedTts = timing.streamed ?? null;
            }
            this.publishLatency();
            break;
          }
          case 'failed':
            failure = event.reason ?? 'ASSISTANT_FAILED';
            break;
          default:
            break;
        }
      }
    } catch {
      failure = failure ?? 'ASSISTANT_FAILED';
    }

    if (this.closed) return;

    if (failure || !text.trim()) {
      this.diag.lastError = failure ?? 'ASSISTANT_FAILED';
      this.milestone('failed', 'ASSISTANT');
      this.cb.onError?.(failure ?? 'ASSISTANT_FAILED');
      this.resumeListening();
      return;
    }

    this.history.push({ role: 'assistant', content: text });

    /*
     * The reply is complete, so whatever is still accumulating below the
     * batch threshold is the end of the sentence and has to be played. Without
     * this the last fraction of a second is held forever waiting for a chunk
     * that is never coming, and the assistant appears to be cut off.
     */
    this.player?.endOfTurn();

    // Wait for the audio that is already scheduled, then hand the floor back.
    await this.awaitPlayback();
    if (this.closed || generation !== this.turnGeneration) return;

    /*
     * DID THIS TURN ACTUALLY MAKE A SOUND?
     *
     * Asked because the answer was no, in production, for every turn, and
     * nothing noticed. The player was never constructed — it was built
     * guarded by a node that had not been created yet — so every chunk went
     * into `this.player?.push()` and vanished. The server counted the audio
     * it sent, this side counted what it received, both were correct, and
     * AI TALK was mute.
     *
     * "A buffer was queued" is not the question. The question is whether the
     * context was running, something was scheduled, it was not pure silence,
     * and the clock passed it.
     */
    const played = this.player?.audiblyPlayed() ?? { ok: false, reason: 'NO_PLAYER' };
    this.diag.playback = played.ok ? 'AUDIBLE' : (played.reason ?? 'SILENT');
    if (!played.ok) {
      this.milestone('silent_turn', played.reason ?? 'UNKNOWN');
      // A silent turn is a failure the visitor experienced, not a diagnostic.
      // It is surfaced so the panel can offer a retry rather than sit there.
      this.cb.onError?.('VOICE_SILENT');
    }
    this.publishDiagnostics();

    /*
     * THE ASSISTANT DECIDED THIS WAS THE LAST TURN.
     *
     * Acted on here and not when the event arrived, because the sentence was
     * still being spoken then. Ending a call mid-goodbye reads as a crash.
     */
    if (endReason) {
      this.cb.onEnded?.(endReason);
      return;
    }
    this.resumeListening();
  }

  /** The older path: one request, one complete reply. Voice Studio uses it. */
  private async requestReplyTurn(said: string, askedAt: number): Promise<void> {
    let reply: AssistantTurn | null = null;
    try {
      reply = await this.cb.onUserTurn(said);
    } catch {
      reply = null;
    }

    if (this.closed) return;
    this.diag.lastTurnMs = Date.now() - askedAt;

    if (!reply?.text) {
      this.diag.lastError = 'ASSISTANT_FAILED';
      this.milestone('failed', 'ASSISTANT');
      this.cb.onError?.('ASSISTANT_FAILED');
      this.resumeListening();
      return;
    }

    this.diag.lastReplyChars = reply.text.length;
    this.diag.lastLlmMs = reply.llmMs ?? null;
    this.diag.lastTtsMs = reply.ttsMs ?? null;

    this.marks.llmFirstTokenAtMs = Date.now();
    this.assistantSeq += 1;
    this.turns = reduceTranscript(this.turns, {
      id: `a${this.assistantSeq}`,
      speaker: 'AGENT',
      text: reply.text,
      final: true,
      language: this.language.current,
      atMs: Date.now(),
    });
    this.milestone('assistant_text', reply.text.length);
    this.cb.onTranscript(this.turns);
    this.history.push({ role: 'assistant', content: reply.text });

    let audioBase64 = reply.audioBase64;
    let mime = reply.mime;
    if (!audioBase64 && this.cb.onSpeak) {
      const voice = await this.cb.onSpeak(reply.text).catch(() => null);
      if (this.closed) return;
      if (voice?.audioBase64) {
        audioBase64 = voice.audioBase64;
        mime = voice.mime ?? mime;
        this.diag.lastTtsMs = voice.ttsMs ?? null;
        this.diag.lastAudioBytes = Math.round(audioBase64.length * 0.75);
      }
    }

    if (!audioBase64) {
      this.diag.lastError = 'VOICE_UNAVAILABLE';
      this.cb.onError?.('VOICE_UNAVAILABLE');
      this.resumeListening();
      return;
    }

    this.milestone('tts_audio_received', audioBase64.length);
    this.marks.ttsFirstAudioAtMs = Date.now();
    this.publishLatency();
    await this.speak(audioBase64, mime ?? 'audio/mpeg');
  }

  /**
   * Schedule one phrase of the reply so it abuts the phrase before it.
   *
   * Raw samples, and an explicit start time on the audio clock rather than
   * "play when it arrives". Chunks arrive faster than real time and out of
   * rhythm with each other; played on arrival they talk over themselves, and
   * played with any rounding between them they click.
   */
  /**
   * One piece of the reply's audio.
   *
   * All the scheduling now lives in PcmStreamPlayer, which converts the whole
   * reply at one continuous phase instead of resampling each piece on its own.
   * The generation is carried through so that audio belonging to an
   * interrupted turn is dropped here rather than played over its replacement.
   */
  private enqueuePcm(pcmBase64: string, sampleRate: number): void {
    this.player?.push(pcmBase64, sampleRate, this.turnGeneration);
  }


  /** Resolve once everything scheduled has finished sounding. */
  private async awaitPlayback(): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx) return;
    const deadline = Date.now() + 60_000;
    while (!this.closed && Date.now() < deadline) {
      const remaining = this.player ? this.player.pendingSeconds : (this.queueTime - ctx.currentTime);
      if (remaining <= 0.02 && !this.player?.playing && !this.playingSources.length) break;
      await new Promise((r) => setTimeout(r, Math.min(250, Math.max(40, remaining * 1000))));
    }
    if (!this.closed) this.milestone('playback_ended');
  }

  /**
   * The rate this browser's audio hardware actually runs at.
   *
   * Sent with every turn so the provider synthesises at it and the samples
   * are played rather than resampled. Null before the context exists, in
   * which case the server uses its own default and accepts one conversion.
   */
  /**
   * What the recogniser called the last utterance, and how it was resolved.
   *
   * Sent with the turn so the server can run the SAME resolver over the same
   * inputs rather than trusting an answer. The raw label is included because
   * it is evidence; the resolution is included because it is what this side
   * concluded, and a disagreement between the two sides is worth seeing in a
   * trace rather than discovering in a silent turn.
   */
  get languageTrace(): { providerLanguage: string | null; resolution: LanguageResolution | null } {
    return { providerLanguage: this.lastProviderLanguage, resolution: this.lastResolution };
  }

  get outputSampleRate(): number | null {
    return this.audioContext?.sampleRate ?? null;
  }

  /** How loud the assistant is right now, 0-1, for the visualiser. */
  get outputLevel(): number {
    if (!this.outputAnalyser || !this.outputBins) return 0;
    this.outputAnalyser.getByteTimeDomainData(this.outputBins);
    let sum = 0;
    for (let i = 0; i < this.outputBins.length; i++) {
      const v = (this.outputBins[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.outputBins.length);
  }

  /**
   * Play one reply and wait for it to finish.
   *
   * An <audio> element rather than the WebAudio graph: the server returns mp3,
   * and decodeAudioData on every reply is work the element already does. The
   * blob URL is revoked when playback settles, so a long conversation does not
   * accumulate them.
   */
  private async speak(audioBase64: string, mime: string): Promise<void> {
    let url: string | null = null;
    try {
      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: mime }));

      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.preload = 'auto';

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };

        audio.onended = () => { this.milestone('playback_ended'); done(); };
        audio.onerror = () => {
          this.milestone('failed', 'PLAYBACK');
          this.cb.onError?.('PLAYBACK_FAILED');
          done();
        };
        // A reply that never fires either event must not strand the loop. The
        // ceiling is generous because a slow network is not a failed one.
        window.setTimeout(done, 60_000);

        audio.play().then(
          () => {
            this.diag.playbacks += 1;
            // The number a person actually experiences: their last word to
            // the first sound coming back.
            if (this.marks.speechEndedAtMs) {
              this.diag.lastPlaybackMs = Date.now() - this.marks.speechEndedAtMs;
            }
            this.milestone('playback_started');
            this.setState('RESPONDING');
          },
          () => {
            // Autoplay refusal. The Start click is a gesture and this should
            // not happen, but if it does it is reported rather than hung on.
            this.milestone('failed', 'AUTOPLAY_BLOCKED');
            this.cb.onError?.('PLAYBACK_BLOCKED');
            done();
          },
        );
      });
    } catch {
      this.milestone('failed', 'PLAYBACK');
      this.cb.onError?.('PLAYBACK_FAILED');
    } finally {
      if (url) URL.revokeObjectURL(url);
      this.currentAudio = null;
      this.resumeListening();
    }
  }

  /**
   * Take the language the server answered in, and arrange to HEAR it.
   *
   * Adopting the label alone would be half a switch: the recogniser's
   * language is fixed when its socket is granted, so a session that starts
   * in Georgian keeps a Georgian recogniser until the socket is replaced.
   * The reopen is deferred to resumeListening rather than done here, because
   * here the assistant is still speaking and tearing down the socket
   * mid-reply would lose whatever it was about to hear.
   */
  private adoptLanguage(language: string | undefined): void {
    const next = normaliseLanguage(language);
    if (!next || next === this.language.current) return;
    this.language = { ...this.language, current: next, locked: true };
    this.relistenLanguage = next;
    this.diag.languageSwitches = (this.diag.languageSwitches ?? 0) + 1;
    this.cb.onLanguage(next, true);
  }

  /**
   * Replace the recogniser socket so it hears the language now being spoken.
   *
   * Opened before the old one is discarded would be two sockets on one
   * microphone; discarded first is a short deaf window, which is the safer of
   * the two because the visitor is not talking yet -- the assistant has only
   * just stopped.
   */
  private async relisten(): Promise<void> {
    const target = this.relistenLanguage;
    this.relistenLanguage = null;
    if (!target || this.closed || !this.live) return;
    await this.rotateLive();
    this.diag.lastRelisten = target;
  }

  /**
   * THE TWO MINUTES ARE UP.
   *
   * Not a guillotine. The previous behaviour called stop() from inside a
   * 250ms interval and set LIMIT_REACHED in the same breath -- so a session
   * that reached its limit while the assistant was speaking cut the voice off
   * mid-sentence, and a session that reached it at any other moment simply
   * stopped answering with the panel still reading LISTENING. A visitor has
   * no way to tell either of those from a crash.
   *
   * So: new turns stop being accepted, whatever is already being said is
   * allowed to finish inside a bounded grace, and the session then ends with
   * a reason somebody can read.
   */
  reachSessionLimit(): void {
    if (this.newTurnsBlocked || this.closed) return;
    this.newTurnsBlocked = true;
    this.sessionEndReason = 'SESSION_TIME_LIMIT';
    this.diag.sessionEndReason = this.sessionEndReason;
    this.publishDiagnostics();

    const speaking = this.turnInFlight || this.state === 'RESPONDING';
    if (!speaking) { void this.endForLimit(); return; }

    // Let the sentence land. Bounded, because a reply that never completes
    // must not hold the session open for ever either.
    this.setState('RESPONDING');
    const deadline = Date.now() + SESSION_LIMIT_GRACE_MS;
    const waitHandle = window.setInterval(() => {
      const done = !this.turnInFlight && this.state !== 'RESPONDING';
      if (done || Date.now() > deadline) {
        window.clearInterval(waitHandle);
        if (!done) this.diag.sessionEndReason = 'SESSION_TIME_LIMIT_GRACE_EXPIRED';
        void this.endForLimit();
      }
    }, 120);
  }

  private async endForLimit(): Promise<void> {
    if (this.closed) return;
    await this.stop('allowance');
    // After stop(), so nothing inside it can overwrite the state the visitor
    // is left looking at.
    this.setState('LIMIT_REACHED');
    this.publishDiagnostics();
  }

  /** Hand the floor back. Only from here, so the mic cannot open mid-reply. */
  private resumeListening(): void {
    if (this.closed) return;
    // A language switch replaces the recogniser before the floor is handed
    // back, so the first thing they say in the new language is heard in it.
    if (this.relistenLanguage) void this.relisten();
    this.micGated = false;
    this.micGatedAt = 0;
    this.lastVoiceAt = 0;
    this.sustainedSpeechMs = 0;
    this.setState('LISTENING');
    this.milestone('listening_resumed');
  }

  // ── Turn taking ───────────────────────────────────────────────────────────

  /**
   * Barge-in only.
   *
   * NOT end-of-utterance: that is decided in onAudioBlock against
   * SPEECH_RMS, and deliberately at a much lower level. Interrupting a
   * playing reply should take a raised voice; being heard at all should not.
   * These were the same threshold once, which meant the silence clock only
   * ticked for someone shouting, and an utterance could only end by reaching
   * the thirty-second ceiling.
   */
  private trackVoiceActivity(level: number, blockMs: number): void {
    const speaking = level >= DEFAULT_BARGE_IN.energyThreshold;
    if (speaking) {
      // The first loud block of an interruption is what the stop is measured
      // against; it is cleared when the assistant is no longer speaking.
      if (!this.bargeSpeechAt && this.state === 'RESPONDING') this.bargeSpeechAt = Date.now();
      this.sustainedSpeechMs += blockMs;

      if (this.state === 'RESPONDING') {
        // §24's barge-in. DUCK first, STOP only on sustained speech, and
        // nothing at all inside the echo guard — which the browser's own echo
        // cancellation makes shorter, not unnecessary.
        const action = decideBargeIn({
          agentSpeaking: true,
          inputEnergy: level,
          sustainedMs: this.sustainedSpeechMs,
          agentAudioElapsedMs: Date.now() - this.agentAudioStartedAt,
          echoCancelled: true,
        });
        if (action === 'DUCK') this.duckPlayback();
        if (action === 'STOP') {
          /*
           * How long the assistant kept talking after being interrupted.
           * Measured from when the visitor's voice was first sustained enough
           * to count as an interruption, not from this decision -- the wait a
           * person feels starts when they start speaking.
           */
          const spokeAt = this.bargeSpeechAt || Date.now();
          this.stopPlayback();
          this.lastBargeStopMs = Date.now() - spokeAt;
          this.diag.lastBargeStopMs = this.lastBargeStopMs;
          this.bargeSpeechAt = 0;
          this.setState('INTERRUPTED');
          /*
           * HAND THE FLOOR BACK, do not merely relabel the state.
           *
           * This used to setState('LISTENING') directly, and setState does
           * not lower the microphone gate -- resumeListening is the only
           * thing that does. So interrupting the assistant, which is the most
           * natural thing a person does in a conversation, left the session
           * gated for good: the panel read LISTENING, the socket stayed
           * READY, blocks kept arriving, and not one of them reached a
           * recogniser ever again.
           */
          window.setTimeout(() => {
            if (this.state === 'INTERRUPTED') this.resumeListening();
          }, 150);
        }
      }
    } else {
      this.sustainedSpeechMs = 0;
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  private duckPlayback(): void {
    // Cheapest correct duck: the sources are already connected through their
    // own gain nodes, so lowering output is done by stopping early rather than
    // by tracking every gain. Full stop happens on STOP a moment later.
    this.playbackTime = Math.min(this.playbackTime, (this.audioContext?.currentTime ?? 0) + 0.08);
  }

  /**
   * Silence, now, and nothing from this turn may make a sound again.
   *
   * The player advances its own generation when it stops, so chunks still on
   * the wire for the interrupted turn are counted and discarded instead of
   * arriving to an empty queue and starting to play. The request is aborted
   * too: a visitor who interrupted is not waiting for the rest of the answer,
   * and neither is the bill.
   */
  private stopPlayback(): void {
    for (const source of this.playingSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.playingSources = [];
    this.player?.stop();
    this.turnGeneration = this.player?.currentGeneration ?? this.turnGeneration + 1;
    this.queueTime = 0;
    this.playbackTime = this.audioContext?.currentTime ?? 0;
    try { this.turnAbort?.abort(); } catch { /* already done */ }
    this.turnAbort = null;
  }

  /**
   * One state variable, and a table of where it may go from each value.
   *
   * There are no booleans to combine here, so "listening and speaking at
   * once" is unrepresentable rather than merely discouraged. What the table
   * adds is a record of the transitions that were not expected: it LOGS them
   * rather than refusing, because refusing a transition in the middle of a
   * live call is worse than a diagnostic line. An entry in the log is a bug
   * to fix; a call that froze because a guard said no is a bug to explain.
   */
  private setState(state: VoiceState, detail?: string): void {
    if (this.state === state) return;
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (allowed && !allowed.includes(state)) {
      this.milestone('illegal_transition', `${this.state}->${state}`);
    }
    this.state = state;
    this.cb.onState(state, detail);
  }
}
