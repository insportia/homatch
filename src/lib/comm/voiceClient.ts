// HOMATCH — the browser voice runtime.
//
// Used by two surfaces and nothing else: the homepage AI Talk demo, and Voice
// Studio's live agent test. Neither places a telephone call (§28), so there is
// no telephony leg and no per-minute carrier cost.
//
// WHY THERE ARE TWO SOCKETS
//
// Cartesia's agents socket carries exactly four server events: ack,
// media_output, clear and transfer_call. It carries NO transcript. That was
// checked against the API reference rather than assumed, and it decides the
// architecture, because §24 makes visible partial transcription a release gate
// and §27 needs the words in order to show live intelligence.
//
// So the microphone feeds two places at once:
//
//   agents socket  the conversation. Audio up, audio down, `clear` for barge-in.
//   STT socket     the words, with is_final, which is what lets a partial be
//                  REVISED rather than appended (§24's named failure).
//
// That costs a second stream of speech-to-text, deliberately, because the
// alternative is a voice demo that cannot show what it heard.
//
// WHAT THIS FILE NEVER DOES
//
// It never holds an API key. The token arrives from ai-talk-session or
// comm-agent, is short-lived and scoped, and is minted server-side (§139). It
// never decides its own allowance: the server grants seconds, this reports
// consumption, and the server ends the session.

import {
  reduceTranscript, stabiliseLanguage, decideEndpoint, decideBargeIn,
  latencyBreakdown, DEFAULT_ENDPOINTING, DEFAULT_BARGE_IN,
  type TranscriptTurn, type LanguageState, type EndpointConfig, type LatencyMarks,
} from './transcript.ts';


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
  /** Scoped to `stt` only. Never carries the Cartesia API key. */
  token: string;
  primaryLanguage: string;
  maxDurationSec: number;
  endpointing?: Partial<EndpointConfig>;
}

/** What the server returns for one turn: the sentence, and the voice saying it. */
export interface AssistantTurn {
  text: string;
  /** base64 audio, or null when synthesis failed but the text is still good. */
  audioBase64: string | null;
  mime?: string;
  voiceId?: string;
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
}

export interface VoiceMilestone {
  event:
    | 'session_granted' | 'mic_open' | 'audio_context_running' | 'stt_socket_open'
    | 'first_input_audio' | 'first_transcript' | 'user_turn_sent'
    | 'assistant_text' | 'tts_audio_received' | 'playback_started'
    | 'playback_ended' | 'listening_resumed' | 'session_ended' | 'failed';
  /** Milliseconds since start() was called. */
  atMs: number;
  /** A code or a count. Never content. */
  detail?: string | number | null;
}

const STT_WS = 'wss://api.cartesia.ai/stt/websocket';
/** Pinned to the date-versioned STT contract. */
const CARTESIA_WS_VERSION = '2026-08-14';

/** 16 kHz mono PCM: what the STT models want. */
const SAMPLE_RATE = 16_000;
const FRAME_MS = 100;

export class VoiceSession {
  private sttSocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private playbackTime = 0;
  /** True while the assistant is speaking: mic frames are dropped, not sent. */
  private micGated = false;
  /** Guards against two turns in flight if STT finalises twice quickly. */
  private turnInFlight = false;
  /** Sent to the server so each reply is in context. */
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private assistantSeq = 0;
  /** How much of the final user transcript has already been answered. */
  private answeredChars = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private playingSources: AudioBufferSourceNode[] = [];

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

    /*
     * STT IS NO LONGER OPTIONAL, BECAUSE IT IS NOW THE CONVERSATION.
     *
     * It used to be a display convenience running beside an agents socket
     * that held the actual dialogue, so a failure here only cost the visible
     * words and was swallowed. Now it is the only thing that hears anybody:
     * without it there is no user text, so there is no turn to answer and no
     * reply to speak. A failure has to stop the session and say so.
     */
    try {
      await this.openSttSocket();
      this.milestone('stt_socket_open');
    } catch {
      this.milestone('failed', 'STT_SOCKET');
      this.setState('PROVIDER_ERROR');
      this.cb.onError?.('STT_UNAVAILABLE');
      await this.stop('stt_unavailable');
      return;
    }

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
      this.evaluateTurn();
    }, 250);
  }

  async stop(reason = 'user_ended'): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.tickHandle !== null) { clearInterval(this.tickHandle); this.tickHandle = null; }
    this.stopPlayback();

    try { this.sttSocket?.send('close'); } catch { /* already gone */ }
    this.sttSocket?.close();
    this.sttSocket = null;

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
        sampleRate: SAMPLE_RATE,
      },
    });

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new Ctx({ sampleRate: SAMPLE_RATE });

    /*
     * A CONSTRUCTED AudioContext IS NOT A RUNNING ONE.
     *
     * Chrome creates it suspended unless it can attribute the construction to
     * a user gesture, and this one is built after an await on getUserMedia,
     * by which point the transient activation may already have lapsed. A
     * suspended context does not advance currentTime and does not emit a
     * sound — which is exactly "the states change and I hear nothing".
     *
     * start() is reached from the Start Conversation click, so resuming here
     * is permitted. It is awaited rather than fired and forgotten, so that
     * anything scheduled afterwards is scheduled against a clock that moves.
     */
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => { /* reported below */ });
    }
    if (this.audioContext.state === 'running') this.milestone('audio_context_running');

    const source = this.audioContext.createMediaStreamSource(this.micStream);

    // ScriptProcessor is deprecated and is used deliberately: an AudioWorklet
    // needs a separate module file served from the same origin, which the
    // published bundle does not guarantee, and this path works in every
    // browser Homatch supports today.
    const frameSize = nextPowerOfTwo((SAMPLE_RATE * FRAME_MS) / 1000);
    this.processor = this.audioContext.createScriptProcessor(frameSize, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const level = rms(input);
      // Proof that the microphone is producing samples, not just that it
      // opened. An open device that yields silence is its own failure and
      // used to be indistinguishable from a working one.
      this.milestone('first_input_audio');
      this.cb.onLevel(level);
      this.trackVoiceActivity(level);

      /*
       * THE MICROPHONE IS MUTED WHILE THE ASSISTANT SPEAKS.
       *
       * Echo cancellation is not enough on a laptop speaker: the reply comes
       * back in, STT transcribes it, and the assistant answers itself. Frames
       * are dropped rather than the track being stopped, so resuming is
       * instant and there is no second permission moment.
       */
      if (this.micGated) return;
      this.sendSttAudio(floatToPcm16(input));
    };

    source.connect(this.processor);
    // Routed to a muted gain node rather than to the destination: connecting a
    // live microphone to the speakers is how a demo screams at its user.
    const sink = this.audioContext.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.audioContext.destination);
  }

  // ── The visible transcript ────────────────────────────────────────────────

  private openSttSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        // ink-whisper is the model that accepts a language hint, which matters
        // because Georgian is the case this has to get right.
        model: 'ink-whisper',
        encoding: 'pcm_s16le',
        sample_rate: String(SAMPLE_RATE),
        cartesia_version: CARTESIA_WS_VERSION,
        access_token: this.grant.token,
        language: this.language.current,
      });
      const socket = new WebSocket(`${STT_WS}?${params.toString()}`);
      this.sttSocket = socket;

      const timeout = window.setTimeout(() => reject(new Error('stt timeout')), 8_000);
      socket.onopen = () => { clearTimeout(timeout); resolve(); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('stt error')); };

      socket.onmessage = (event) => {
        let msg: { type?: string; text?: string; is_final?: boolean; language?: string };
        try { msg = JSON.parse(String(event.data)); } catch { return; }
        if (msg.type !== 'transcript' || typeof msg.text !== 'string') return;
        this.onSttTranscript(msg.text, Boolean(msg.is_final), msg.language ?? null);
      };
    });
  }

  /**
   * Fold one STT result into the visible transcript.
   *
   * `text` from this API is the delta since the last final, so an utterance
   * keeps ONE id until it finalises. That id is what makes reduceTranscript
   * replace rather than append, which is §24's requirement stated exactly:
   * "UI must replace/revise partial transcript rather than permanently
   * appending incorrect text."
   */
  private onSttTranscript(text: string, isFinal: boolean, detected: string | null): void {
    if (!this.currentUtteranceId) {
      this.utteranceSeq += 1;
      this.currentUtteranceId = `u${this.utteranceSeq}`;
    }

    this.turns = reduceTranscript(this.turns, {
      id: this.currentUtteranceId,
      speaker: 'USER',
      text,
      final: isFinal,
      language: detected,
      atMs: Date.now(),
    });
    // The COUNT, never the words. Whether transcription is arriving is a
    // diagnostic; what was said is the customer's.
    this.milestone('first_transcript', this.turns.length);
    this.cb.onTranscript(this.turns);

    const before = this.language.current;
    this.language = stabiliseLanguage(this.language, { text, detected, confidence: isFinal ? 0.8 : 0.5 });
    if (this.language.current !== before || this.language.locked) {
      this.cb.onLanguage(this.language.current, this.language.locked);
    }

    if (isFinal) {
      this.marks.transcriptFinalAtMs = Date.now();
      this.currentUtteranceId = null;
      // The whole conversation hangs off this line: a finished sentence is a
      // turn, and a turn is what produces a reply.
      void this.takeTurn();
    }
  }

  /**
   * The conversational loop, one lap.
   *
   * Their finished sentence goes to the server, which writes the reply and
   * speaks it. The text is shown the moment it arrives — before the audio
   * starts, not after it finishes — because reading the answer while hearing
   * it is what makes this feel like a conversation rather than a wait.
   */
  private async takeTurn(): Promise<void> {
    if (this.closed || this.turnInFlight) return;

    // Everything the person has actually finished saying and that has not yet
    // been answered.
    const said = this.turns
      .filter((t) => t.speaker === 'USER' && t.final)
      .map((t) => t.text)
      .join(' ')
      .slice(this.answeredChars)
      .trim();
    if (!said) return;

    this.turnInFlight = true;
    this.answeredChars += said.length;
    this.history.push({ role: 'user', content: said });

    // Gate the microphone BEFORE anything can come back, so the first audio
    // frame of the reply cannot be transcribed as if the visitor said it.
    this.micGated = true;
    this.setState('UNDERSTANDING');
    this.milestone('user_turn_sent', said.length);

    let reply: AssistantTurn | null = null;
    try {
      reply = await this.cb.onUserTurn(said);
    } catch {
      reply = null;
    }

    if (this.closed) return;

    if (!reply?.text) {
      this.milestone('failed', 'ASSISTANT');
      this.cb.onError?.('ASSISTANT_FAILED');
      this.resumeListening();
      this.turnInFlight = false;
      return;
    }

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

    if (!reply.audioBase64) {
      // Synthesis failed but the sentence is real and already on screen. A
      // silent turn is a degraded conversation; pretending it did not happen
      // would be a broken one.
      this.cb.onError?.('VOICE_UNAVAILABLE');
      this.resumeListening();
      this.turnInFlight = false;
      return;
    }

    this.milestone('tts_audio_received', reply.audioBase64.length);
    await this.speak(reply.audioBase64, reply.mime ?? 'audio/mpeg');
    this.turnInFlight = false;
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

  private sendSttAudio(pcm: Int16Array): void {
    if (this.sttSocket?.readyState !== WebSocket.OPEN) return;
    // Binary frames here, unlike the agents socket's base64 JSON. The cast is
    // safe: this buffer is allocated by floatToPcm16 and is never shared.
    this.sttSocket.send(pcm.buffer as ArrayBuffer);
  }

  // ── Turn taking ───────────────────────────────────────────────────────────

  private trackVoiceActivity(level: number): void {
    const speaking = level >= DEFAULT_BARGE_IN.energyThreshold;
    if (speaking) {
      this.sustainedSpeechMs += FRAME_MS;
      this.lastVoiceAt = Date.now();

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

  /**
   * Has the person finished?
   *
   * The decision itself is decideEndpoint in transcript.ts, which is pure and
   * tested. This only supplies it with the silence and the text so far — and
   * notably does NOT end the turn itself, because the agents socket runs its
   * own endpointer. What this drives is the UI's UNDERSTANDING state, so the
   * visible behaviour matches the conversational behaviour instead of
   * flickering on a different timer.
   */
  private evaluateTurn(): void {
    if (this.state !== 'LISTENING' || !this.lastVoiceAt) return;

    const partial = this.turns[this.turns.length - 1];
    const decision = decideEndpoint({
      text: partial?.final === false ? partial.text : (partial?.text ?? ''),
      silenceMs: Date.now() - this.lastVoiceAt,
      sttFinal: partial?.final ?? false,
      config: { ...DEFAULT_ENDPOINTING, ...this.grant.endpointing },
    });

    if (decision.endOfTurn && partial?.text?.trim()) {
      this.marks.speechEndedAtMs = this.lastVoiceAt;
      this.marks.endpointConfirmedAtMs = Date.now();
      this.setState('UNDERSTANDING');
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  /**
   * Play one chunk of agent audio, scheduled so chunks abut rather than
   * overlap.
   *
   * `as_available` delivery means chunks arrive faster than real time, so the
   * client has to pace them. Playing each one immediately on arrival produces
   * a voice talking over itself.
   */
  private playPcm(bytes: Uint8Array): void {
    if (!this.audioContext) return;
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = this.audioContext.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = this.audioContext.createGain();
    source.connect(gain);
    gain.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    this.playbackTime = Math.max(this.playbackTime, now);
    source.start(this.playbackTime);
    this.playbackTime += buffer.duration;

    this.playingSources.push(source);
    source.onended = () => {
      this.playingSources = this.playingSources.filter((s) => s !== source);
      if (!this.playingSources.length && this.state === 'RESPONDING') this.setState('LISTENING');
    };
  }

  private duckPlayback(): void {
    // Cheapest correct duck: the sources are already connected through their
    // own gain nodes, so lowering output is done by stopping early rather than
    // by tracking every gain. Full stop happens on STOP a moment later.
    this.playbackTime = Math.min(this.playbackTime, (this.audioContext?.currentTime ?? 0) + 0.08);
  }

  private stopPlayback(): void {
    for (const source of this.playingSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.playingSources = [];
    this.playbackTime = this.audioContext?.currentTime ?? 0;
  }

  private setState(state: VoiceState, detail?: string): void {
    if (this.state === state) return;
    this.state = state;
    this.cb.onState(state, detail);
  }
}

// ── Audio helpers ───────────────────────────────────────────────────────────

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) on a 3200-byte frame is fine, on a
  // larger one it blows the argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function nextPowerOfTwo(n: number): number {
  // ScriptProcessor accepts only these sizes.
  const allowed = [256, 512, 1024, 2048, 4096, 8192, 16384];
  return allowed.find((v) => v >= n) ?? 4096;
}
