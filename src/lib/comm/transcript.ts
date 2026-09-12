// HOMATCH Communications — the live transcript, and when a person has
// actually stopped talking.
//
// §24 makes Georgian conversational quality a release gate, and is explicit
// that "microphone works, audio returns, STT makes text" is not the bar. Three
// separate problems live in this file, and all three are pure functions so
// they can be tested without a microphone:
//
//   1. A partial hypothesis must be REVISED, never appended. "მე მინდა ბი..."
//      becoming "მე მინდა ბინა კრწანისში." is one utterance that got better,
//      not two utterances.
//   2. Language must STABILISE rather than lock on the first 200ms. Short
//      Georgian speech is routinely misdetected, and locking to English on
//      turn one poisons the rest of the session.
//   3. A 300-700ms gap is not the end of a turn. "მინდა ბინა... კრწანისში...
//      დაახლოებით 180 ათასამდე" has two pauses in it, and an assistant that
//      answers after "ბინა" is unusable.

export type Speaker = 'USER' | 'AGENT';

export interface TranscriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  /** False while the STT may still revise this text. */
  final: boolean;
  language?: string | null;
  confidence?: number | null;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface TranscriptEvent {
  /** Stable per utterance. Two events with the same id are the same utterance. */
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  language?: string | null;
  confidence?: number | null;
  atMs: number;
}

/**
 * Fold one STT event into the running transcript.
 *
 * The whole point is the `id` match: a partial arriving for an utterance that
 * is already on screen REPLACES its text. The naive implementation — push
 * every event — is what produces "მე მინდა ბი მე მინდა ბინა მე მინდა ბინა
 * კრწანისში" on screen, which is §24's named failure.
 *
 * A finalised turn is immutable. A late partial for an utterance the STT has
 * already finalised is stale and is dropped rather than un-finalising it.
 */
export function reduceTranscript(turns: TranscriptTurn[], event: TranscriptEvent): TranscriptTurn[] {
  const index = turns.findIndex((t) => t.id === event.id);

  if (index === -1) {
    if (!event.text.trim() && !event.final) return turns;
    return [...turns, {
      id: event.id,
      speaker: event.speaker,
      text: event.text,
      final: event.final,
      language: event.language ?? null,
      confidence: event.confidence ?? null,
      startedAtMs: event.atMs,
      updatedAtMs: event.atMs,
    }];
  }

  const existing = turns[index];
  if (existing.final && !event.final) return turns;
  // A second `final` for the same utterance can carry a corrected transcript,
  // which is worth taking; an identical one changes nothing.
  if (existing.final && event.final && event.text === existing.text) return turns;

  const next = [...turns];
  next[index] = {
    ...existing,
    text: event.text,
    final: event.final || existing.final,
    language: event.language ?? existing.language,
    confidence: event.confidence ?? existing.confidence,
    updatedAtMs: event.atMs,
  };
  return next;
}

/** What to render: finalised turns, plus at most one in-flight partial per speaker. */
export function visibleTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  const seenPartial = new Set<Speaker>();
  const out: TranscriptTurn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.final) { out.unshift(t); continue; }
    if (seenPartial.has(t.speaker)) continue;
    seenPartial.add(t.speaker);
    out.unshift(t);
  }
  return out.filter((t) => t.text.trim().length > 0 || t.final);
}

// ── Language stabilisation ──────────────────────────────────────────────────

export interface LanguageVote {
  language: string;
  confidence: number;
  /** Characters of transcript this vote was based on. A 3-character sample is weak evidence. */
  chars: number;
}

export interface LanguageState {
  /** What the session is currently treated as. */
  current: string;
  /** True once the evidence is strong enough to stop re-deciding every turn. */
  locked: boolean;
  votes: LanguageVote[];
}

/** Georgian script is unambiguous: U+10A0-U+10FF is Georgian and nothing else. */
export function georgianCharRatio(text: string): number {
  const chars = [...String(text ?? '')].filter((c) => /\S/.test(c));
  if (!chars.length) return 0;
  const ka = chars.filter((c) => c >= 'Ⴀ' && c <= 'ჿ').length;
  return ka / chars.length;
}

export function cyrillicCharRatio(text: string): number {
  const chars = [...String(text ?? '')].filter((c) => /\S/.test(c));
  if (!chars.length) return 0;
  const ru = chars.filter((c) => c >= 'Ѐ' && c <= 'ӿ').length;
  return ru / chars.length;
}

export const LANGUAGE_LOCK_MIN_CHARS = 24;
export const LANGUAGE_LOCK_MIN_CONFIDENCE = 0.72;

/**
 * Decide the session language from accumulated evidence.
 *
 * Two things §24 asks for, both of which the naive "trust the STT's language
 * field" approach gets wrong:
 *
 *   Do not hard-lock from the first 200ms. A single low-confidence vote over
 *   four characters does not move `current` at all.
 *
 *   Once strong Georgian evidence exists, prefer ka-GE. The SCRIPT is decisive
 *   in a way a confidence score is not: text in Georgian letters is Georgian,
 *   whatever the detector's own guess said, and this is where detectors most
 *   often disagree with reality on short utterances.
 *
 * A locked session still yields to sustained evidence of a real switch — a
 * caller genuinely moving to Russian mid-call is a case §135 requires
 * handling, not a misdetection to suppress.
 */
export function stabiliseLanguage(
  state: LanguageState,
  sample: { text: string; detected?: string | null; confidence?: number | null },
): LanguageState {
  const text = String(sample.text ?? '');
  const chars = [...text].filter((c) => /\S/.test(c)).length;
  if (chars === 0) return state;

  const kaRatio = georgianCharRatio(text);
  const ruRatio = cyrillicCharRatio(text);

  // Script evidence outranks the detector's own label.
  let language = sample.detected ?? state.current;
  let confidence = sample.confidence ?? 0.4;
  if (kaRatio >= 0.5) { language = 'ka'; confidence = Math.max(confidence, 0.5 + kaRatio / 2); }
  else if (ruRatio >= 0.5) { language = 'ru'; confidence = Math.max(confidence, 0.5 + ruRatio / 2); }

  const votes = [...state.votes, { language, confidence, chars }].slice(-12);

  // Weight each vote by how much text it saw. A four-character "hi" cannot
  // outvote a full Georgian sentence.
  const weights = new Map<string, number>();
  for (const v of votes) {
    weights.set(v.language, (weights.get(v.language) ?? 0) + v.confidence * Math.min(v.chars, 120));
  }
  let best = state.current;
  let bestWeight = -1;
  for (const [lang, w] of weights) {
    if (w > bestWeight) { best = lang; bestWeight = w; }
  }

  const totalChars = votes.reduce((s, v) => s + v.chars, 0);
  const bestShare = bestWeight / Math.max(1, [...weights.values()].reduce((a, b) => a + b, 0));

  if (state.locked) {
    // Only a sustained, confident disagreement unlocks. Two consecutive
    // high-confidence votes for another language is a real switch; one is noise.
    const recent = votes.slice(-2);
    const switched = recent.length === 2
      && recent.every((v) => v.language === best && v.confidence >= 0.7 && v.chars >= 12)
      && best !== state.current;
    return switched ? { current: best, locked: true, votes } : { ...state, votes };
  }

  const canLock = totalChars >= LANGUAGE_LOCK_MIN_CHARS && bestShare >= LANGUAGE_LOCK_MIN_CONFIDENCE;
  return { current: best, locked: canLock, votes };
}

// ── Endpointing: has the person finished? ───────────────────────────────────

export interface EndpointConfig {
  /** Never end a turn before this much silence, whatever else is true. */
  minSilenceMs: number;
  /** End the turn at this much silence, whatever else is true. */
  maxSilenceMs: number;
  /** Silence that ends a turn when the utterance already sounds complete. */
  completeSilenceMs: number;
  /** Extra grace after a word that clearly continues ("and", "about", "მინდა"). */
  continuationGraceMs: number;
}

/**
 * Defaults tuned for the case §24 names: an unhurried Georgian speaker listing
 * requirements with thinking pauses between them.
 *
 * 260ms minimum exists because barge-in detection needs a floor below which
 * nothing is a turn end. 1900ms maximum exists because a real silence has to
 * end SOMETIME, or the assistant never answers. Between those two the decision
 * is semantic rather than temporal, which is the whole point — a fixed 700ms
 * threshold is exactly what cuts "მინდა ბინა..." off at "ბინა".
 *
 * These are the shipped defaults, not constants: admin voice tuning (§55)
 * writes them, and a provider that does its own semantic endpointing supplies
 * `semanticComplete` instead of relying on the heuristic below.
 */
export const DEFAULT_ENDPOINTING: EndpointConfig = {
  minSilenceMs: 260,
  maxSilenceMs: 1900,
  completeSilenceMs: 620,
  continuationGraceMs: 900,
};

/**
 * Words and shapes that say "I have not finished". Georgian first, because it
 * is the release gate; the others are here because §83 makes all six locales
 * first class and a Russian-speaking caller in Tbilisi is the common case.
 */
const CONTINUATION_TOKENS = [
  // Georgian: conjunctions, prepositional tails, and the hesitation sounds a
  // Georgian speaker actually makes.
  'და', 'ან', 'მაგრამ', 'რომ', 'რადგან', 'ანუ', 'დაახლოებით', 'ერთი', 'წუთით',
  'მინდა', 'მჭირდება', 'ვეძებ', 'ვფიქრობ', 'ვგულისხმობ', 'ესეიგი',
  'ეე', 'ემმ', 'მმმ', 'აა',
  // Russian
  'и', 'или', 'но', 'что', 'потому', 'примерно', 'около', 'значит', 'типа',
  'ээ', 'ммм', 'нуу',
  // English
  'and', 'or', 'but', 'because', 'about', 'around', 'like', 'so', 'well',
  'um', 'uh', 'erm', 'hmm',
  // Turkish
  've', 'veya', 'ama', 'yaklaşık', 'şey', 'yani',
];

/** Endings that mean the sentence closed. */
const TERMINAL_PUNCTUATION = /[.!?。？！]\s*$/;
/** Trailing ellipsis is an explicit "still going", not an ending. */
const TRAILING_ELLIPSIS = /(\.\.\.|…)\s*$/;

export interface EndpointInput {
  /** The current partial or final text of the user's turn so far. */
  text: string;
  /** Milliseconds since the last detected speech energy. */
  silenceMs: number;
  /** Whether the provider's own semantic endpointer says this is complete. */
  semanticComplete?: boolean | null;
  /** Whether the STT has already marked this utterance final. */
  sttFinal?: boolean;
  config?: EndpointConfig;
}

export interface EndpointDecision {
  endOfTurn: boolean;
  /** Why, so the admin voice tuning screen can show what is actually happening. */
  reason: 'SILENCE_FLOOR' | 'STT_FINAL' | 'SEMANTIC_COMPLETE' | 'COMPLETE_AND_QUIET'
        | 'MAX_SILENCE' | 'STILL_SPEAKING' | 'CONTINUATION_GRACE';
  /** How much longer to wait before asking again. Drives the runtime's timer. */
  waitMoreMs: number;
}

/** Does this text look like a finished thought? */
export function looksComplete(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (TRAILING_ELLIPSIS.test(t)) return false;
  if (TERMINAL_PUNCTUATION.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return false;

  const last = words[words.length - 1]
    .toLowerCase()
    .replace(/[.,;:!?()"'«»„“”]/g, '');
  if (CONTINUATION_TOKENS.includes(last)) return false;

  // A number on its own almost always has more coming — a price, a count of
  // bedrooms, a square meterage. "180 ათასამდე" is the completion; "180" is not.
  if (/^[\d٠-٩]+$/.test(last)) return false;

  // Very short utterances are usually acknowledgements, and answering over one
  // is how an assistant talks across a caller who was just saying "ჰო".
  return words.length >= 3;
}

export function decideEndpoint(input: EndpointInput): EndpointDecision {
  const cfg = input.config ?? DEFAULT_ENDPOINTING;
  const text = String(input.text ?? '');
  const silence = Math.max(0, input.silenceMs);

  // Below the floor nothing ends a turn. This is what stops a 300ms breath
  // from being read as the end of a sentence.
  if (silence < cfg.minSilenceMs) {
    return { endOfTurn: false, reason: 'SILENCE_FLOOR', waitMoreMs: cfg.minSilenceMs - silence };
  }

  if (input.semanticComplete && silence >= cfg.minSilenceMs) {
    return { endOfTurn: true, reason: 'SEMANTIC_COMPLETE', waitMoreMs: 0 };
  }

  // An STT final is strong evidence, but not on its own: providers finalise on
  // their own silence timer, which is exactly the fixed threshold this
  // function exists to improve on. It ends the turn only when the text also
  // reads as complete, or when the silence has gone on long enough that it no
  // longer matters.
  if (input.sttFinal && (looksComplete(text) || silence >= cfg.completeSilenceMs)) {
    return { endOfTurn: true, reason: 'STT_FINAL', waitMoreMs: 0 };
  }

  if (silence >= cfg.maxSilenceMs) {
    return { endOfTurn: true, reason: 'MAX_SILENCE', waitMoreMs: 0 };
  }

  if (looksComplete(text)) {
    if (silence >= cfg.completeSilenceMs) {
      return { endOfTurn: true, reason: 'COMPLETE_AND_QUIET', waitMoreMs: 0 };
    }
    return { endOfTurn: false, reason: 'STILL_SPEAKING', waitMoreMs: cfg.completeSilenceMs - silence };
  }

  // The utterance is unfinished — it ends on "და", or on a bare number, or
  // with an ellipsis. Wait longer than a complete one would get.
  const grace = Math.min(cfg.maxSilenceMs, cfg.continuationGraceMs);
  if (silence >= grace) {
    return { endOfTurn: true, reason: 'MAX_SILENCE', waitMoreMs: 0 };
  }
  return { endOfTurn: false, reason: 'CONTINUATION_GRACE', waitMoreMs: grace - silence };
}

// ── Barge-in ────────────────────────────────────────────────────────────────

export interface BargeInConfig {
  /** Sustained speech energy above this fraction of the calibrated floor counts. */
  energyThreshold: number;
  /** How long that energy must persist before the agent yields. */
  sustainMs: number;
  /**
   * Speech arriving within this long of the agent's own audio starting is
   * treated as echo of that audio, not as the user interrupting. Without this,
   * a laptop speaker triggers a barge-in on the agent's own first syllable.
   */
  echoGuardMs: number;
}

export const DEFAULT_BARGE_IN: BargeInConfig = {
  energyThreshold: 0.18,
  sustainMs: 180,
  echoGuardMs: 320,
};

export interface BargeInInput {
  agentSpeaking: boolean;
  /** 0-1, normalised against the calibrated noise floor. */
  inputEnergy: number;
  /** How long the energy has been continuously above the threshold. */
  sustainedMs: number;
  /** How long the agent's audio has been playing. */
  agentAudioElapsedMs: number;
  /** True when the platform gives us acoustic echo cancellation we can trust. */
  echoCancelled?: boolean;
  config?: BargeInConfig;
}

export type BargeInAction = 'NONE' | 'DUCK' | 'STOP';

/**
 * Decide whether the agent should get out of the way.
 *
 * Two steps rather than one, because instantly cutting the agent's audio on
 * the first frame above threshold makes a cough sound like an interruption.
 * DUCK drops the agent's output volume and keeps listening; STOP ends the
 * utterance and hands the turn over. A real interruption passes through both
 * within about 200ms, which is fast enough to feel natural.
 */
export function decideBargeIn(input: BargeInInput): BargeInAction {
  const cfg = input.config ?? DEFAULT_BARGE_IN;
  if (!input.agentSpeaking) return 'NONE';
  if (input.inputEnergy < cfg.energyThreshold) return 'NONE';

  // Without reliable echo cancellation, ignore everything in the opening
  // window — that energy is almost certainly the agent's own voice.
  if (!input.echoCancelled && input.agentAudioElapsedMs < cfg.echoGuardMs) return 'NONE';

  if (input.sustainedMs >= cfg.sustainMs) return 'STOP';
  if (input.sustainedMs >= cfg.sustainMs / 2) return 'DUCK';
  return 'NONE';
}

// ── Latency accounting ──────────────────────────────────────────────────────

export interface LatencyMarks {
  speechEndedAtMs?: number;
  transcriptFinalAtMs?: number;
  endpointConfirmedAtMs?: number;
  llmFirstTokenAtMs?: number;
  ttsFirstAudioAtMs?: number;
}

export interface LatencyBreakdown {
  transcriptionMs: number | null;
  endpointingMs: number | null;
  thinkingMs: number | null;
  synthesisMs: number | null;
  /**
   * What the caller actually experiences: their last word to the first sound
   * back. §24 says to optimise real behaviour rather than laboratory metrics,
   * and this is the only number that describes the real behaviour.
   */
  perceivedMs: number | null;
}

export function latencyBreakdown(m: LatencyMarks): LatencyBreakdown {
  const d = (a?: number, b?: number) => (a != null && b != null && b >= a ? b - a : null);
  return {
    transcriptionMs: d(m.speechEndedAtMs, m.transcriptFinalAtMs),
    endpointingMs: d(m.transcriptFinalAtMs, m.endpointConfirmedAtMs),
    thinkingMs: d(m.endpointConfirmedAtMs, m.llmFirstTokenAtMs),
    synthesisMs: d(m.llmFirstTokenAtMs, m.ttsFirstAudioAtMs),
    perceivedMs: d(m.speechEndedAtMs, m.ttsFirstAudioAtMs),
  };
}
