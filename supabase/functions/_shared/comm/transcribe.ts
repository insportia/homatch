// HOMATCH — turning a recorded utterance into words.
//
// WHY THIS IS NOT CARTESIA
//
// AI TALK streamed the microphone to Cartesia's STT socket. That works, in
// English and in Russian. It does not work in Georgian, and Homatch is a
// Georgia-first product.
//
// Measured against production on 13 September 2026, same Georgian audio, same
// token, three models:
//
//   ink-whisper  language=ka   socket accepted, then dropped at ~5s with
//                              close code 1006 and NO error frame at all.
//                              Reproduced three times.
//   ink-2        language=ka   {"error_code":"language_not_supported",
//                              "message":"The requested language is not
//                              supported by this model.","status_code":400}
//   ink-2        no language   heard it, wrote it in Latin letters:
//                              "Kamarchupa, mekhelo luriintelitis assistant
//                              iwar." That is the Georgian, transliterated.
//   ink-preview  no language   Devanagari.
//
// So the provider can hear Georgian and cannot write it. The silent 1006 is
// what made this so expensive to find: the socket died, the browser's socket
// handlers were only wired for the connect phase, and the panel went on
// saying "Listening" to somebody talking to nothing.
//
// Transcription therefore moves server-side to the OpenAI audio endpoint,
// which returns Georgian in Georgian script and detects the spoken language
// itself. That also removes the thing that made the old design unable to meet
// "understand whatever language the visitor speaks": Cartesia needs the
// language named in the URL before a word is spoken.
//
// WHAT THIS FILE NEVER DOES
//
// It never logs audio, never logs a transcript, and never logs a key. What
// somebody said is theirs. Sizes and durations are diagnostics; words are not.

import { hasSecret, requireSecret } from './contracts.ts';

/**
 * The model, from configuration rather than from a constant.
 *
 * §21/§44: the provider's model names are economics, not application logic.
 * The fallback is a second real model rather than a failure, because a
 * settings row that names a retired model must not take voice input down.
 */
const PRIMARY_MODEL = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-transcribe';
const FALLBACK_MODEL = 'whisper-1';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Vocabulary bias, in the words Georgian buyers actually use.
 *
 * The transcription API takes a prompt as a hint about what it is likely to
 * hear. Georgian real-estate speech is full of terms a general model gets
 * wrong — the frame states (კარკასი) especially, which sound alike and mean
 * completely different amounts of money — and cadastral vocabulary that has
 * no everyday equivalent.
 *
 * This is a HINT, not a constraint: nothing here is inserted into a
 * transcript that did not contain it.
 */
const GEORGIAN_REAL_ESTATE_HINT = [
  'უძრავი ქონება, ბინა, სახლი, კომერციული ფართი, მიწის ნაკვეთი.',
  'თბილისი, ვაკე, საბურთალო, კრწანისი, ორთაჭალა, ისანი, გლდანი, დიდუბე, ჩუღურეთი, მთაწმინდა, ბათუმი, ქუთაისი.',
  'მწვანე კარკასი, თეთრი კარკასი, შავი კარკასი, ახალაშენებული, ძველი აშენებული, მშენებარე.',
  'საკადასტრო კოდი, საჯარო რეესტრი, ამონაწერი, ხელშეკრულება, წინასწარი ნასყიდობის ხელშეკრულება.',
  'იპოთეკა, განვადება, ბიუჯეტი, კვადრატული მეტრი, ფასი კვადრატულზე, სართული, საძინებელი, პარკინგი.',
  'დეველოპერი, ინვესტიცია, ქირის შემოსავალი, ROI, ბინის სტატუსი, ლარი, დოლარი.',
].join(' ');

export interface TranscriptionResult {
  ok: boolean;
  /** What was said, in the script it was said in. Null when nothing was heard. */
  text: string | null;
  /** ISO-639-1, when the provider reports it. Null otherwise — never guessed here. */
  language: string | null;
  model: string;
  latencyMs: number;
  error?: string;
  /** Provider HTTP status, for admin diagnostics. Never shown to a visitor. */
  status?: number | null;
}

export function transcriptionAvailable(): boolean {
  return hasSecret('OPENAI_API_KEY');
}

export interface TranscribeOptions {
  audio: Uint8Array;
  /** The container actually sent. WAV is what the browser produces here. */
  mime?: string;
  /**
   * A language to prefer, or null to let the provider decide.
   *
   * Null is the normal case and is the whole point: a visitor who switches
   * from Georgian to Russian mid-conversation must not have to tell anybody.
   * A hint is only passed when the caller has real evidence.
   */
  languageHint?: string | null;
  /** Extra vocabulary bias on top of the Georgian real-estate glossary. */
  hint?: string | null;
  timeoutMs?: number;
}

/**
 * One utterance in, one sentence out.
 *
 * Returns a result rather than throwing: every caller has a defined behaviour
 * for "it could not be transcribed", and none of them is a blank screen that
 * still claims to be listening.
 */
export async function transcribeSpeech(opts: TranscribeOptions): Promise<TranscriptionResult> {
  const started = Date.now();
  const empty: TranscriptionResult = {
    ok: false, text: null, language: null, model: PRIMARY_MODEL, latencyMs: 0,
  };

  if (!transcriptionAvailable()) {
    return { ...empty, error: 'no_api_key', latencyMs: Date.now() - started };
  }
  if (!opts.audio?.byteLength) {
    return { ...empty, error: 'empty_audio', latencyMs: Date.now() - started };
  }

  const first = await callOnce(PRIMARY_MODEL, opts, started);
  // A configured model that the account cannot use is an operations problem,
  // not a reason for a visitor to lose their sentence. One retry, on the
  // model that has been generally available the longest.
  if (!first.ok && first.status === 400 && PRIMARY_MODEL !== FALLBACK_MODEL && /model/i.test(first.error ?? '')) {
    return await callOnce(FALLBACK_MODEL, opts, started);
  }
  return first;
}

async function callOnce(
  model: string, opts: TranscribeOptions, started: number,
): Promise<TranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

  try {
    const form = new FormData();
    // A fresh copy: the caller's buffer may be a view over a larger one, and
    // Blob would otherwise take the whole thing.
    form.append('file', new Blob([opts.audio.slice()], { type: opts.mime ?? 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('response_format', model === FALLBACK_MODEL ? 'verbose_json' : 'json');
    form.append('prompt', [GEORGIAN_REAL_ESTATE_HINT, opts.hint ?? ''].filter(Boolean).join(' ').slice(0, 900));
    if (opts.languageHint) form.append('language', opts.languageHint.slice(0, 5));

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${requireSecret('OPENAI_API_KEY')}` },
      body: form,
      signal: controller.signal,
    });

    const raw = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { parsed = {}; }

    if (!res.ok) {
      const detail = (parsed.error as { message?: string } | undefined)?.message ?? '';
      return {
        ok: false, text: null, language: null, model,
        latencyMs: Date.now() - started,
        // The provider's message names the model and the parameter, which is
        // what an admin needs. It never contains the audio or the key.
        error: detail.slice(0, 200) || `provider returned ${res.status}`,
        status: res.status,
      };
    }

    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    const language = typeof parsed.language === 'string' ? normaliseLanguage(parsed.language) : null;

    return {
      ok: true,
      // An empty transcript is a real answer — silence, or a cough. It is
      // reported as ok with no text so the caller can say "I did not catch
      // that" rather than "transcription failed".
      text: text || null,
      language,
      model,
      latencyMs: Date.now() - started,
      status: res.status,
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, text: null, language: null, model,
      latencyMs: Date.now() - started,
      error: aborted ? 'timeout' : String((e as Error)?.message ?? e).slice(0, 200),
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider language labels to ISO-639-1.
 *
 * whisper-1's verbose_json reports English names ("georgian"), not codes, and
 * the rest of the product speaks in codes. Anything unrecognised comes back
 * null rather than being forced into a guess — the script of the transcript
 * itself is better evidence than a label nobody recognises.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  georgian: 'ka', english: 'en', russian: 'ru', turkish: 'tr',
  arabic: 'ar', hebrew: 'he', ukrainian: 'uk', armenian: 'hy',
  azerbaijani: 'az', german: 'de', french: 'fr', spanish: 'es',
  italian: 'it', persian: 'fa', greek: 'el', polish: 'pl',
};

export function normaliseLanguage(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (LANGUAGE_NAMES[v]) return LANGUAGE_NAMES[v];
  // Already a code: "ka", "ka-GE", "en_US".
  const code = v.split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(code) ? code : null;
}

/**
 * Which language a piece of text is written in, by script.
 *
 * Script is stronger evidence than any label: Georgian is the only thing
 * written in Mkhedruli, and a provider that says "en" over a line of
 * Georgian characters is wrong. Latin is deliberately NOT decided here —
 * English, Turkish and transliteration all share it, and a wrong confident
 * answer is worse than none.
 */
export function scriptLanguage(text: string): string | null {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 2) return null;
  const share = (re: RegExp) => letters.filter((c) => re.test(c)).length / letters.length;

  if (share(/\p{Script=Georgian}/u) >= 0.4) return 'ka';
  if (share(/\p{Script=Hebrew}/u) >= 0.4) return 'he';
  if (share(/\p{Script=Arabic}/u) >= 0.4) return 'ar';
  if (share(/\p{Script=Cyrillic}/u) >= 0.4) return 'ru';
  return null;
}
