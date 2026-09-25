// AI TALK answers the language somebody SPEAKS, not the page they opened.
//
// WHY THIS IS A TEST AND NOT A COMMENT
//
// The old design could not have satisfied it. The microphone streamed to
// Cartesia's transcription socket, and that socket's language lives in its
// URL — chosen from the page locale, before anybody had said a word. A
// Russian speaker on the Georgian homepage was transcribed as Georgian, and a
// Georgian speaker was not transcribed at all: asked for language=ka,
// ink-whisper accepted the socket and dropped it at about five seconds with
// close code 1006 and no error frame, while ink-2 answered
// language_not_supported outright.
//
// So the rules below are the product requirement, asserted against the source
// because these are .ts/.tsx modules with JSX and path aliases that a bare
// node test cannot import — the same constraint talkStates.test.mjs works
// under.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The transcription module is a Deno edge file, and reads its model name from
 * Deno.env at import time. The two functions under test here are pure, so the
 * environment is stubbed rather than the functions being copied: this tests
 * the SHIPPED implementation instead of a duplicate that can drift.
 */
globalThis.Deno = globalThis.Deno ?? { env: { get: () => undefined } };
const { scriptLanguage, normaliseLanguage } =
  await import('../../../supabase/functions/_shared/comm/transcribe.ts');

// The stabiliser is pure browser-side domain code, imported directly.
const { stabiliseLanguage } = await import('../comm/transcript.ts');

/*
 * Line endings are normalised on the way in.
 *
 * This repository is worked on from Windows, and every assertion here that
 * slices source by looking for a bare newline silently matches nothing in a
 * CRLF file — which reads as a test failing for a reason that is not there.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
const CLIENT = '../comm/voiceClient.ts';
const SESSION = '../../../supabase/functions/ai-talk-session/index.ts';
const TRANSCRIBE = '../../../supabase/functions/_shared/comm/transcribe.ts';

test('the browser no longer opens a transcription socket at all', () => {
  // The whole class of bug: a socket declared healthy at connect time, killed
  // silently later, with the panel still showing "Listening".
  const src = read(CLIENT);
  assert.ok(!/api\.cartesia\.ai\/stt/.test(src), 'the Cartesia STT socket is back in the browser');
  assert.ok(!/new WebSocket\(/.test(src), 'the voice client should hold no WebSocket of its own');
  assert.ok(/onTranscribe/.test(src), 'utterances should go out through the injected transcription call');
});

test('the audio is labelled with the rate it was actually recorded at', () => {
  const src = read(CLIENT);
  // Asking the browser for a rate and then assuming it obeyed is exactly how
  // a phone ends up sending 48 kHz audio labelled 16 kHz.
  assert.ok(
    /new Ctx\(\)/.test(src),
    'the AudioContext must not be constructed with a sampleRate the device may refuse',
  );
  assert.ok(
    /new Resampler\(this\.audioContext\.sampleRate/.test(src),
    'the resampler must be built from the rate the device actually gave',
  );
  assert.ok(
    /encodeWav\(floatToPcm16\(joinBlocks\(blocks\)\), TARGET_SAMPLE_RATE\)/.test(src),
    'the WAV header must state the rate the samples were converted to',
  );
});

test('a language hint is only sent once the conversation has settled', () => {
  // Hinting from the page locale is the original sin: it is a guess about
  // someone who has not spoken yet, and it overrides what they then say.
  const src = read(CLIENT);
  assert.ok(
    /this\.language\.locked \? this\.language\.current : null/.test(src),
    'the transcription hint must come from a settled spoken language, never from the page',
  );
});

test('an empty transcript never reaches the model', () => {
  const src = read(CLIENT);
  const at = src.indexOf('const said = (reply.text ?? \'\').trim();');
  assert.ok(at > 0, 'the empty-transcript branch was rewritten');
  const branch = src.slice(at, at + 700);
  assert.ok(/if \(!said\)/.test(branch), 'an empty transcript must be handled explicitly');
  assert.ok(
    /resumeListening\(\)/.test(branch) && !/takeTurn/.test(branch),
    'silence must go back to listening, not to the model — answering nothing produces an assistant talking to itself',
  );
});

test('a failed transcription stops claiming to be listening', () => {
  const src = read(CLIENT);
  const at = src.indexOf("this.milestone('failed', 'TRANSCRIBE');");
  assert.ok(at > 0, 'the transcription failure branch was rewritten');
  const branch = src.slice(at - 400, at + 400);
  assert.ok(
    /setState\('PROVIDER_ERROR'\)/.test(branch),
    'a transcription that failed must change the visible state, not leave it on LISTENING',
  );
});

test('the reply language comes from the sentence, and the page is only a fallback', () => {
  const src = read(SESSION);
  assert.ok(
    /const heardLanguage = scriptLanguage\(said\)/.test(src),
    'the script of what was said should decide the reply language first',
  );
  assert.ok(
    /const replyLanguage = heardLanguage \?\? locale;/.test(src),
    'the page locale must be the fallback, never the override',
  );
  assert.ok(
    /publicDemoInstructions\(replyLanguage\)/.test(src),
    'the model must be instructed in the language that was actually spoken',
  );
  const synth = src.slice(src.indexOf('await synthesizeSpeech({'));
  assert.ok(
    /language: replyLanguage,/.test(synth.slice(0, 500)),
    'synthesis must be told the same language the reply was written in',
  );
});

test('Georgian gets its own instructions, not a translation brief', () => {
  const src = read(SESSION);
  const at = src.indexOf("if (name === 'Georgian')");
  assert.ok(at > 0, 'the Georgian-specific instructions are gone');
  const block = src.slice(at, at + 2000);
  assert.ok(/Do NOT compose in English and translate/.test(block));
  // The frame states are the terms that cost real money to get wrong.
  for (const term of ['მწვანე კარკასი', 'საკადასტრო კოდი', 'იპოთეკა']) {
    assert.ok(block.includes(term), `the Georgian vocabulary should include ${term}`);
  }
});

test('script decides the language, and Latin deliberately does not', () => {
  assert.equal(scriptLanguage('გამარჯობა, მინდა ბინა ვიყიდო თბილისში'), 'ka');
  assert.equal(scriptLanguage('Какие документы нужно проверить?'), 'ru');
  assert.equal(scriptLanguage('מה שלומך'), 'he');
  assert.equal(scriptLanguage('ما هي الوثائق'), 'ar');

  // English, Turkish and a Latin transliteration of Georgian all look the
  // same here. A confident wrong answer is worse than none, so Latin returns
  // null and the provider's own label is used instead.
  assert.equal(scriptLanguage('Hello, I want to buy a flat'), null);
  assert.equal(scriptLanguage('Merhaba, daire almak istiyorum'), null);

  // Georgian with English words mixed in is still Georgian. Georgian buyers
  // say "developer" and "ROI" in the middle of Georgian sentences constantly.
  assert.equal(scriptLanguage('ამ property-ს ROI რამდენი აქვს?'), 'ka');
  assert.equal(scriptLanguage('developer-ზე ინფორმაცია მომეცი'), 'ka');

  // Too little to judge.
  assert.equal(scriptLanguage(''), null);
  assert.equal(scriptLanguage('a'), null);
});

test('provider language labels become codes, and unknown ones stay unknown', () => {
  assert.equal(normaliseLanguage('georgian'), 'ka');
  assert.equal(normaliseLanguage('Russian'), 'ru');
  assert.equal(normaliseLanguage('ka'), 'ka');
  assert.equal(normaliseLanguage('ka-GE'), 'ka');
  assert.equal(normaliseLanguage('en_US'), 'en');
  assert.equal(normaliseLanguage(''), null);
  assert.equal(normaliseLanguage('!!'), null);
});

test('the transcription module keeps audio and words out of every log', () => {
  const src = read(TRANSCRIBE);
  assert.ok(!/console\./.test(src), 'nothing in this file should log at all');
  assert.ok(
    /authorization: `Bearer \$\{requireSecret\('OPENAI_API_KEY'\)\}`/.test(src),
    'the key must be read at call time from the secret store',
  );
  // The provider echoes request parameters in its error bodies. The message is
  // carried; the audio never is.
  assert.ok(/detail\.slice\(0, 200\)/.test(src), 'provider error detail must be bounded');
});

test('the server refuses an utterance too large to be one', () => {
  const src = read(SESSION);
  assert.ok(
    /b64\.length > 2_800_000/.test(src),
    'the transcribe action is reachable by anyone holding a session and needs a ceiling',
  );
  assert.ok(/chars: result\.text\?\.length \?\? 0/.test(src),
    'the log should record how many characters came back, never which ones');
  // Only the logEvent object itself, not the JSON response that follows it.
  const at = src.indexOf("logEvent('ai-talk', 'transcribe_ok'");
  const logCall = src.slice(at, src.indexOf('});', at));
  assert.ok(!/result\.text[^?]/.test(logCall),
    'the transcript must never be written to a log');
});

test('near-silence never becomes a sentence the visitor did not say', async () => {
  // Measured in production: a 1.2-second clip came back as the Georgian
  // real-estate glossary, word for word, and went on to the assistant as
  // something the visitor had supposedly said. Whisper-family models do this
  // when there is very little audio and a vocabulary prompt.
  const { looksLikeHintEcho } =
    await import('../../../supabase/functions/_shared/comm/transcribe.ts');

  const hint = 'უძრავი ქონება, ბინა, სახლი, კომერციული ფართი, მიწის ნაკვეთი. '
    + 'თბილისი, ვაკე, საბურთალო, კრწანისი, ორთაჭალა, ისანი. '
    + 'იპოთეკა, განვადება, ბიუჯეტი, კვადრატული მეტრი, სართული, საძინებელი, პარკინგი.';

  assert.equal(looksLikeHintEcho(hint, hint), true, 'the glossary handed straight back is an echo');
  assert.equal(
    looksLikeHintEcho('ბინა, სახლი, კომერციული ფართი, მიწის ნაკვეთი, თბილისი, ვაკე, საბურთალო, კრწანისი', hint),
    true,
    'a reordered fragment of the glossary is still an echo',
  );

  // And a real sentence must survive, even though it is made of the same
  // vocabulary — that vocabulary is in the hint precisely because people say it.
  assert.equal(
    looksLikeHintEcho('გამარჯობა, მინდა ვიყიდო ორსაძინებლიანი ბინა კრწანისში, ბიუჯეტი დაახლოებით ას სამოცი ათასი დოლარი', hint),
    false,
    'a real request must not be mistaken for an echo',
  );
  // Short answers are never judged: "ბინა" is entirely glossary and entirely valid.
  assert.equal(looksLikeHintEcho('ბინა', hint), false);
  assert.equal(looksLikeHintEcho('კი, სწორია', hint), false);
});

test('an utterance must contain real voiced audio before it is paid for', () => {
  const src = read(CLIENT);
  assert.ok(/const MIN_VOICED_MS = \d+;/.test(src), 'voiced audio should have its own floor');
  assert.ok(
    /voicedMs < MIN_VOICED_MS/.test(src),
    'total length is not enough — a clip that is mostly silence with one thump in it is not speech',
  );
});

test('the sentence is shown before the voice is fetched', () => {
  const src = read(CLIENT);
  assert.ok(/onSpeak/.test(src), 'there should be a second call for the audio');
  const at = src.indexOf('if (!audioBase64 && this.cb.onSpeak)');
  assert.ok(at > 0, 'the split was removed');
  // The assistant turn must already be in the transcript by the time audio is
  // requested, or the split buys nothing.
  assert.ok(
    src.indexOf("this.milestone('assistant_text'") < at,
    'the sentence must reach the transcript before the audio request starts',
  );
});

test('a split turn is still counted once, before either half can be skipped', () => {
  const src = read(SESSION);
  const at = src.indexOf('if (body.textOnly)');
  assert.ok(at > 0, 'the text-only branch is gone');
  const before = src.slice(src.indexOf('const llmMs = Date.now() - thoughtAt;'), at);
  assert.ok(
    /turns: Number\(session\.turns \?\? 0\) \+ 1/.test(before),
    'the turn must be counted before the early return, or omitting the second half buys free turns',
  );
});

test('the live socket never holds anything but an ephemeral credential', () => {
  const src = read('../comm/liveTranscribe.ts');

  // A WebSocket subprotocol is visible to anything that can see the
  // connection, which is exactly why what travels in it must expire.
  assert.ok(/openai-insecure-api-key\.\$\{this\.grant\.token\}/.test(src),
    'the credential travels as a subprotocol, because a browser cannot set a header');
  assert.ok(!/OPENAI_API_KEY/.test(src), 'no API key name belongs in browser code');
  assert.ok(!/console\./.test(src), 'nothing here should log');
});

test('a live socket that dies hands the session back rather than going quiet', () => {
  // The whole class of bug this product has already paid for: a transport
  // that stopped while the panel went on saying "Listening".
  const src = read('../comm/liveTranscribe.ts');
  const at = src.indexOf('socket.onclose');
  assert.ok(at > 0, 'the close handler is gone');
  const branch = src.slice(at, at + 500);
  assert.ok(/onUnavailable\('SOCKET_CLOSED'\)/.test(branch),
    'a socket that closes mid-conversation must be reported');

  // And every other way it can fail reports too.
  for (const reason of ['SOCKET_ERROR', 'SOCKET_TIMEOUT', 'SOCKET_REFUSED', 'PROVIDER_ERROR']) {
    assert.ok(src.includes(reason), `${reason} should be a reported outcome`);
  }
});

test('only one transcriber consumes the microphone at a time', () => {
  // Running both would pay for every sentence twice and answer it twice.
  /*
   * The router decides, and its three answers are exclusive.
   *
   * This used to scan the inline live branch for a `return`, first in a fixed
   * 500-character window and then by balanced braces. Both were reading the
   * shape of an implementation rather than its behaviour, which is how a
   * build that completed no turns at all passed this file. The routing now
   * lives in LiveAudioRouter and is driven for real by rotationGap.test.mjs;
   * what belongs here is that the session honours the answer it is given.
   */
  const src = read(CLIENT);
  const at = src.indexOf("const route = this.router.route(pcm, liveReady)");
  assert.ok(at > 0, 'the session no longer routes through the router');
  // 1400 when the HELD branch was a single line. It now credits the held voiced
  // milliseconds to the speech clock before returning, which pushed the
  // live-ready branch to +1398 -- far enough that the match itself was cut in
  // half by the window and the test failed on its own arithmetic.
  const window = src.slice(at, at + 1800);
  assert.ok(/route\.kind === 'SEND'/.test(window), 'SEND must reach the socket');
  /*
   * The GUARANTEE, not the punctuation: a HELD block returns before it can
   * reach the batch capture below. This used to match the one-line
   * `if (route.kind === 'HELD') return;` exactly, which broke the moment the
   * branch acquired a body -- it now credits the held voiced milliseconds to
   * the speech clock before returning, because held audio IS flushed to the
   * recogniser and used to count as no speech at all. Still exactly one
   * consumer of the microphone; the test just stopped reading formatting.
   */
  const heldAt = window.indexOf("if (route.kind === 'HELD')");
  assert.ok(heldAt > 0, 'the HELD answer is no longer handled');
  const readyAt = window.indexOf('if (liveReady)', heldAt);
  assert.ok(readyAt > heldAt, 'the live-ready branch no longer follows the routing');
  assert.ok(/\breturn;/.test(window.slice(heldAt, readyAt)),
    'HELD must not fall through into batch capture as well');
  assert.ok(/route\.kind === 'BATCH'/.test(window),
    'BATCH must be handled, or a failed socket silences the session');
});

test('our own voice is discarded rather than transcribed as theirs', () => {
  /*
   * Checked for BOTH sockets, because there are two protocols now.
   *
   * The guarantee is the same either way: nothing the microphone picks up of
   * Homatch's own voice reaches a transcriber. How it is kept differs. Every
   * implementation refuses to send while gated, which is the strong half; the
   * OpenAI socket additionally clears the buffer it may already hold, because
   * that protocol accumulates server-side and ElevenLabs' does not.
   */
  for (const file of ['../comm/liveTranscribe.ts', '../comm/scribeTranscribe.ts']) {
    const src = read(file);
    // The implementation's own gate, not the interface's declaration of one.
    const at = src.indexOf('  setGated(gated: boolean): void {');
    assert.ok(at > 0, `the gate is gone from ${file}`);
    const branch = src.slice(at, at + 400);

    const append = src.indexOf('  append(pcm: Int16Array): void {');
    assert.ok(append > 0, `the append is gone from ${file}`);
    assert.ok(/if \(!this\.isReady \|\| this\.gated/.test(src.slice(append, append + 200)),
      `${file} must not send a frame while the assistant is speaking`);

    if (file.includes('liveTranscribe')) {
      assert.ok(/input_audio_buffer\.clear/.test(branch),
        'ungating must clear what the OpenAI socket buffered while the assistant was speaking');
    }
  }
});

test('the two transcription sockets never speak each other protocol', () => {
  /*
   * A message name that belongs to the wrong provider is silently ignored by
   * the one that receives it, and the conversation simply stops producing
   * transcripts. Keeping the vocabularies disjoint is what makes that a build
   * failure instead of a quiet one.
   */
  // Comments stripped first: each file's header explains the OTHER protocol
  // to say why it is a separate file, and that prose is the documentation,
  // not a leak.
  const code = (file) => read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  const openai = code('../comm/liveTranscribe.ts');
  const scribe = code('../comm/scribeTranscribe.ts');

  assert.ok(!/input_audio_chunk|committed_transcript|partial_transcript/.test(openai),
    'the OpenAI socket has picked up ElevenLabs message names');
  assert.ok(!/input_audio_buffer|conversation\.item\.input_audio_transcription/.test(scribe),
    'the ElevenLabs socket has picked up OpenAI message names');

  // And the choice between them is made in exactly one place, from what the
  // server said rather than from anything the browser assumed.
  const at = read('../comm/liveTranscribe.ts').indexOf('export function createTranscriber(');
  assert.ok(at > 0, 'the factory is gone');
  assert.ok(/grant\.provider === 'ELEVENLABS'/.test(read('../comm/liveTranscribe.ts').slice(at, at + 400)),
    'the provider must come from the grant');
});

test('the live path is an optimisation, and the server says so', () => {
  const src = read(SESSION);
  const at = src.indexOf('async function listen(');
  assert.ok(at > 0, 'the listen action is gone');
  const body = src.slice(at, src.indexOf('\n}\n', at));

  // Every refusal is a 200 with ok:false. A status nobody can act on would
  // make an optimisation look like an outage.
  assert.ok(!/reason: 'UNAVAILABLE' }, 5\d\d/.test(body), 'a refused grant must not be an error status');
  assert.ok(/reason: 'UNAVAILABLE' }, 200/.test(body), 'a refused grant is a normal answer');
  assert.ok(/models = \[/.test(body), 'model availability is per-account, so more than one is tried');
});

// ── The voice must not change because somebody said "WhatsApp" ─────────────

test('a Georgian sentence does not flap around a brand name', () => {
  /*
   * THIS IS WHAT DECIDES WHICH VOICE SPEAKS.
   *
   * The TTS profile is resolved per turn from the language of that turn, so a
   * language decision that wobbles is a voice that wobbles: Georgian, then an
   * English speaker for one sentence, then Georgian again. Georgian
   * real-estate conversations are full of Latin -- Homatch, WhatsApp, ROI,
   * USD, developer and project names -- and none of them is a language
   * change.
   */
  const sentences = [
    'მინდა WhatsApp-ზე დამიკავშირდეთ.',
    'Homatch-ის Buyer Intelligence აჩვენებს ფასს კვადრატულ მეტრზე.',
    'რამდენია ROI ამ პროექტში, USD-ში?',
    'დეველოპერი არის Archi და პროექტი Archi Kavtaradze.',
    'CRM-ში შემიყვანეთ და AI ასისტენტმა დამირეკოს.',
  ];
  for (const text of sentences) {
    assert.equal(scriptLanguage(text), 'ka',
      `a Georgian sentence containing Latin is still Georgian: ${text}`);
  }
});

test('a bare Latin brand name is not a language, so nothing switches on it', () => {
  /*
   * scriptLanguage answers null rather than guessing English: there is no
   * Latin-script test in it at all, deliberately. Null means "this tells you
   * nothing", and the caller falls back to the language the conversation had
   * already settled into instead of switching voice for one word.
   */
  for (const text of ['WhatsApp', 'Homatch', 'ROI', 'USD', 'AI']) {
    assert.equal(scriptLanguage(text), null,
      `a bare brand name must not be read as a language: ${text}`);
  }
});

test('a settled Georgian session survives an English brand turn', () => {
  let state = { current: 'ka', locked: false, votes: [] };
  // Enough Georgian to settle.
  for (const text of [
    'გამარჯობა, ვეძებ ბინას ვაკეში.',
    'ბიუჯეტი ორასი ათასი დოლარია.',
    'მაინტერესებს ახალაშენებული კორპუსი.',
  ]) {
    state = stabiliseLanguage(state, { text, detected: null, confidence: 0.8 });
  }
  assert.equal(state.current, 'ka');
  assert.ok(state.locked, 'sustained Georgian should settle the session');

  // One brand-name turn, with the detector confidently wrong about it.
  const after = stabiliseLanguage(state, { text: 'WhatsApp', detected: 'en', confidence: 0.9 });
  assert.equal(after.current, 'ka',
    'one English word must not move a settled Georgian session, because the voice moves with it');
  assert.ok(after.locked);
});
