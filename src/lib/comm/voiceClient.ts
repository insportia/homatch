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

export type VoiceState =
  | 'IDLE' | 'CONNECTING' | 'LISTENING' | 'UNDERSTANDING' | 'RESPONDING'
  | 'INTERRUPTED' | 'RECONNECTING' | 'ENDED' | 'LIMIT_REACHED'
  | 'MIC_DENIED' | 'PROVIDER_ERROR';

export interface VoiceGrant {
  token: string;
  /** The Cartesia agent to stream against. One base agent, overridden per session. */
  agentId: string;
  systemPrompt: string;
  firstMessage: string;
  voiceId: string | null;
  primaryLanguage: string;
  maxDurationSec: number;
  endpointing?: Partial<EndpointConfig>;
}

export interface VoiceCallbacks {
  onState: (state: VoiceState, detail?: string) => void;
  onTranscript: (turns: TranscriptTurn[]) => void;
  onLanguage: (language: string, locked: boolean) => void;
  onLevel: (level: number) => void;
  onSecondsConsumed: (seconds: number) => void;
  onLatency?: (breakdown: ReturnType<typeof latencyBreakdown>) => void;
  onError?: (code: string) => void;
}

const AGENTS_WS = 'wss://api.cartesia.ai/agents/stream';
const STT_WS = 'wss://api.cartesia.ai/stt/websocket';
/** Pinned. The agents and STT APIs are both on this date-versioned contract. */
const CARTESIA_WS_VERSION = '2026-08-14';

/** 16 kHz mono PCM: what the STT models want and what the agents socket accepts. */
const SAMPLE_RATE = 16_000;
const FRAME_MS = 100;

export class VoiceSession {
  private agentSocket: WebSocket | null = null;
  private sttSocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private playbackTime = 0;
  private playingSources: AudioBufferSourceNode[] = [];

  private turns: TranscriptTurn[] = [];
  private language: LanguageState;
  private state: VoiceState = 'IDLE';
  private startedAt = 0;
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

  get currentState(): VoiceState { return this.state; }

  get consumedSeconds(): number {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  async start(): Promise<void> {
    this.setState('CONNECTING');
    try {
      await this.openMicrophone();
    } catch (e) {
      // A refused microphone is a normal outcome with its own screen, not an
      // error state to be logged and forgotten (§98 case B).
      const denied = (e as Error)?.name === 'NotAllowedError' || (e as Error)?.name === 'SecurityError';
      this.setState(denied ? 'MIC_DENIED' : 'PROVIDER_ERROR', (e as Error)?.message);
      this.cb.onError?.(denied ? 'MIC_DENIED' : 'AUDIO_UNAVAILABLE');
      return;
    }

    try {
      await this.openAgentSocket();
      // The transcript stream is a convenience. If it fails, the conversation
      // still works and the user simply does not see the words — far better
      // than refusing to talk to them at all.
      this.openSttSocket().catch(() => { /* transcript display is optional */ });
    } catch {
      this.setState('PROVIDER_ERROR');
      this.cb.onError?.('PROVIDER_ERROR');
      await this.stop('provider_error');
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

    try { this.sttSocket?.send(JSON.stringify({ type: 'close' })); } catch { /* already gone */ }
    this.agentSocket?.close();
    this.sttSocket?.close();
    this.agentSocket = null;
    this.sttSocket = null;

    this.processor?.disconnect();
    this.processor = null;
    this.micStream?.getTracks().forEach((tr) => tr.stop());
    this.micStream = null;
    await this.audioContext?.close().catch(() => { /* already closed */ });
    this.audioContext = null;

    if (this.state !== 'LIMIT_REACHED' && this.state !== 'MIC_DENIED') {
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
      this.cb.onLevel(level);
      this.trackVoiceActivity(level);

      const pcm = floatToPcm16(input);
      // The same frame to both sockets: one to talk to, one to read from.
      this.sendAgentAudio(pcm);
      this.sendSttAudio(pcm);
    };

    source.connect(this.processor);
    // Routed to a muted gain node rather than to the destination: connecting a
    // live microphone to the speakers is how a demo screams at its user.
    const sink = this.audioContext.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.audioContext.destination);
  }

  // ── The agent conversation ────────────────────────────────────────────────

  private openAgentSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${AGENTS_WS}/${encodeURIComponent(this.grant.agentId)}`
        + `?access_token=${encodeURIComponent(this.grant.token)}`
        + `&cartesia_version=${CARTESIA_WS_VERSION}`;
      const socket = new WebSocket(url);
      this.agentSocket = socket;

      const timeout = window.setTimeout(() => { socket.close(); reject(new Error('agent socket timeout')); }, 12_000);

      socket.onopen = () => {
        // The server closes the connection if `start` is not the first thing
        // it receives. The overrides carry Homatch's own assembled prompt, so
        // one Cartesia agent serves every Homatch agent without a per-agent
        // object being created and left behind at the provider.
        socket.send(JSON.stringify({
          event: 'start',
          config: {
            input_format: 'pcm_16000',
            // Lower latency, at the cost of the client having to pace its own
            // playback — which it does, in playPcm below.
            output_audio_delivery: 'as_available',
            ...(this.grant.voiceId ? { voice_id: this.grant.voiceId } : {}),
          },
          agent: {
            system_prompt: this.grant.systemPrompt,
            introduction: this.grant.firstMessage,
          },
        }));
      };

      socket.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(String(event.data)); } catch { return; }

        switch (msg.event ?? msg.type) {
          case 'ack':
            clearTimeout(timeout);
            resolve();
            break;

          case 'media_output': {
            if (this.state !== 'RESPONDING') {
              this.marks.ttsFirstAudioAtMs = Date.now();
              this.cb.onLatency?.(latencyBreakdown(this.marks));
              this.agentAudioStartedAt = Date.now();
              this.setState('RESPONDING');
            }
            const payload = typeof msg.payload === 'string' ? msg.payload
              : typeof (msg.media as Record<string, unknown>)?.payload === 'string'
                ? String((msg.media as Record<string, unknown>).payload) : null;
            if (payload) this.playPcm(base64ToBytes(payload));
            break;
          }

          case 'clear':
            // The agent is interrupting itself. Everything already buffered is
            // stale and playing it would talk over whatever comes next.
            this.stopPlayback();
            this.setState('LISTENING');
            break;

          case 'transfer_call':
            // §39/§113. Homatch's own handoff is a CRM action, not a live
            // transfer, and the demo has nobody to transfer to.
            this.setState('ENDED', 'transfer_requested');
            void this.stop('transfer_requested');
            break;

          default:
            break;
        }
      };

      socket.onerror = () => { clearTimeout(timeout); reject(new Error('agent socket error')); };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!this.closed) {
          this.setState('ENDED', 'socket_closed');
          void this.stop('socket_closed');
        }
      };
    });
  }

  private sendAgentAudio(pcm: Int16Array): void {
    if (this.agentSocket?.readyState !== WebSocket.OPEN) return;
    this.agentSocket.send(JSON.stringify({
      event: 'media_input',
      payload: bytesToBase64(new Uint8Array(pcm.buffer)),
    }));
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
    this.cb.onTranscript(this.turns);

    const before = this.language.current;
    this.language = stabiliseLanguage(this.language, { text, detected, confidence: isFinal ? 0.8 : 0.5 });
    if (this.language.current !== before || this.language.locked) {
      this.cb.onLanguage(this.language.current, this.language.locked);
    }

    if (isFinal) {
      this.marks.transcriptFinalAtMs = Date.now();
      this.currentUtteranceId = null;
    }
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
