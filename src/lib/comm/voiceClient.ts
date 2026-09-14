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
import { createTranscriber, LIVE_SAMPLE_RATE, type LiveGrant, type LiveSocket } from './liveTranscribe.ts';


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
onConverse?: (text: string, signal: AbortSignal) => AsyncIterable<ConverseEvent>;
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
    | 'playback_ended' | 'listening_resumed' | 'session_ended' | 'failed';
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

/** A single utterance ceiling, so one long monologue cannot grow unbounded. */
const MAX_UTTERANCE_MS = 30_000;

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
  /** True while the visitor has muted themselves. Their choice, not ours. */
  private muted = false;
  /** Guards against two turns in flight. */
  private turnInFlight = false;
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

  // ── Diagnostics. Every one of these is counted, never inferred. ─────────
  private diag = {
    blocks: 0, samplesCaptured: 0, bytesSent: 0, rms: 0, peakRms: 0,
    utterances: 0, lastUtteranceMs: null as number | null,
    lastUtteranceBytes: null as number | null,
    sttRequests: 0, sttOk: 0, sttEmpty: 0, sttFailed: 0,
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
    this.language = { current: grant.primaryLanguage || 'ka', locked: false, votes: [] };
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

    await this.openLiveTranscription();

    this.startedAt = Date.now();
    this.setState('LISTENING');

    this.tickHandle = window.setInterval(() => {
      this.cb.onSecondsConsumed(this.consumedSeconds);
      // A local ceiling as well as the server's. The server grant is the
      // control; this stops an obviously-overrunning session before the next
      // heartbeat would.
      if (this.consumedSeconds >= this.grant.maxDurationSec) {
        void this.stop('allowance');
        this.setState('LIMIT_REACHED');
      }
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
      sendSampleRate: TARGET_SAMPLE_RATE,
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
    if (this.outputGain) this.player = new PcmStreamPlayer(this.audioContext, this.outputGain);

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
    if (this.live?.isReady && this.liveResampler) {
      const live = this.liveResampler.process(input);
      if (live.length) {
        this.diag.samplesCaptured += live.length;
        this.diag.bytesSent += live.length * 2;
        this.live.append(floatToPcm16(live));
      }
      return;
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
   * Try the live socket. Fall back silently if it will not hold.
   *
   * Silently on purpose: a visitor has no use for the difference, and the
   * difference is a second of latency rather than a broken conversation. It
   * is recorded in the diagnostics, where somebody can act on it.
   */
  private async openLiveTranscription(): Promise<void> {
    if (!this.cb.onListenGrant || !this.audioContext) return;

    let grant: LiveGrant | null = null;
    try { grant = await this.cb.onListenGrant(); } catch { grant = null; }
    if (!grant?.token || this.closed) { this.diag.liveMode = 'batch'; return; }

    // The provider decides the rate, because ElevenLabs mints its token for
    // 16 kHz and OpenAI's socket runs at 24. Resampling to the wrong one is
    // silence with the right byte count.
    const rate = grant.sampleRate ?? LIVE_SAMPLE_RATE;
    const live = createTranscriber(grant, {
      onSpeechStart: () => {
        this.lastVoiceAt = Date.now();
        if (this.state === 'UNDERSTANDING' && !this.turnInFlight) this.setState('LISTENING');
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
      onUnavailable: (reason) => {
        // Back to the batch path for the rest of the session, rather than a
        // conversation that quietly stops hearing anybody.
        this.diag.lastError = this.diag.lastError ?? null;
        this.diag.liveMode = 'batch';
        this.diag.liveFellBack = reason;
        this.live?.close();
        this.live = null;
        this.publishDiagnostics();
      },
    });

    const opened = await live.open();
    if (!opened || this.closed) { this.diag.liveMode = 'batch'; return; }

    this.live = live;
    this.liveResampler = new Resampler(this.audioContext.sampleRate, rate);
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
    if (this.closed || this.turnInFlight) return;

    const said = text.trim();
    const id = this.livePartialId ?? `u${++this.utteranceSeq}`;
    this.livePartialId = null;

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

    const before = this.language.current;
    /*
     * The recogniser's own answer, which used to be discarded here.
     *
     * `detected: null` meant the state machine only ever had script evidence
     * to work with, so Georgian, Russian, Arabic and Hebrew were decided
     * correctly and English and Turkish -- identical alphabets -- were never
     * decided at all. They stayed on whatever the page locale was, which is
     * how a voice assistant answers an English speaker in Georgian.
     *
     * stabiliseLanguage still outranks it with script evidence where there is
     * any, and still refuses to move on one short low-confidence sample.
     */
    this.language = stabiliseLanguage(this.language, {
      text: said,
      detected: detected ? detected.toLowerCase().split('-')[0] : null,
      confidence: detected ? 0.8 : 0.5,
    });
    if (this.language.current !== before || this.language.locked) {
      this.cb.onLanguage(this.language.current, this.language.locked);
    }

    this.publishDiagnostics();
    await this.takeTurn(said);
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
    this.setState('UNDERSTANDING');
    this.milestone('user_turn_sent', said.length);

    try {
      if (this.cb.onConverse) await this.streamedTurn(said, askedAt);
      else await this.requestReplyTurn(said, askedAt);
    } finally {
      this.turnInFlight = false;
      this.publishDiagnostics();
    }
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
      for await (const event of this.cb.onConverse!(said, this.turnAbort.signal)) {
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

  /** Hand the floor back. Only from here, so the mic cannot open mid-reply. */
  private resumeListening(): void {
    if (this.closed) return;
    this.micGated = false;
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
          this.stopPlayback();
          this.setState('INTERRUPTED');
          window.setTimeout(() => {
            if (this.state === 'INTERRUPTED') this.setState('LISTENING');
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

  private setState(state: VoiceState, detail?: string): void {
    if (this.state === state) return;
    this.state = state;
    this.cb.onState(state, detail);
  }
}
