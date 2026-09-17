// What the first real Android microphone trace found, and must never repeat.
//
// Everything before it was synthetic speech played into the stack, and two
// defects hid in the gap between that and a person holding a phone.
//
// THE TRACE (Android 10, Chrome 152, Georgian site):
//
//   turn 1  heard "Abba"            language en   voicedBeforeReady 0
//   turn 2  heard "უძრავი ქონება"    language ka   voicedBeforeReady 853
//   turn 3  heard "რაიც შეიძლება."   language ka   voicedBeforeReady 1877
//
// The speaker reported that their Georgian was not what came back, and that
// it got worse each turn. Both numbers explain it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTurnLanguage } from '../talkLanguage.ts';

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const body = (name) => {
  const at = client.indexOf(name);
  assert.ok(at > 0, `${name} is missing`);
  const open = client.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < client.length; i++) {
    if (client[i] === '{') depth++;
    else if (client[i] === '}' && --depth === 0) return strip(client.slice(open, i + 1));
  }
  throw new Error(`${name} never closes`);
};

// ── One weak token must not redefine the conversation ─────────────────────

test('a four-letter Latin guess does not move a Georgian session', () => {
  // This is the real turn. "Abba" is what a clipped Georgian word came back
  // as, and it switched the whole session to English.
  const r = resolveTurnLanguage({
    transcript: 'Abba', providerLanguage: 'en',
    previousSessionLanguage: null, pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka', 'the page is a prior on the first turn too');
  assert.ok(r.confidence < 0.6, 'and it must not lock on that evidence');
});

test('a real sentence still switches on its very first turn', () => {
  // The prior is a prior, not a lock: six-language first-turn behaviour has
  // to keep working, and it is what the multilingual proof rests on.
  const first = (transcript, providerLanguage) => resolveTurnLanguage({
    transcript, providerLanguage, previousSessionLanguage: null, pageLocale: 'ka',
  }).resolvedLanguage;
  assert.equal(first('Hello, can you help me find an apartment?', 'en'), 'en');
  assert.equal(first('Здравствуйте, я ищу двухкомнатную квартиру.', 'ru'), 'ru');
  assert.equal(first('Merhaba, bir daire arıyorum.', 'tr'), 'tr');
  assert.equal(first('مرحبا، أبحث عن شقة في تبليسي.', 'ar'), 'ar');
  assert.equal(first('שלום, אני מחפש דירה בטביליסי.', 'iw'), 'he');
  // And Georgian on an English page, which is the same rule in reverse.
  assert.equal(resolveTurnLanguage({
    transcript: 'გამარჯობა, ვაკეში ბინა მაინტერესებს.', providerLanguage: 'ka',
    previousSessionLanguage: null, pageLocale: 'en',
  }).resolvedLanguage, 'ka');
});

// ── Speech during a socket rotation must be kept ──────────────────────────

test('audio with no socket yet is held, not dropped', () => {
  const fn = body('private onAudioBlock');
  assert.ok(/this\.preReady\.push\(floatToPcm16\(held\)\)/.test(fn),
    'a rotation takes half a second to a second; the visitor does not wait for it');
  assert.ok(/this\.liveExpected/.test(fn), 'only while a socket is actually coming');
});

test('the held speech is bounded, and the OLDEST is what goes', () => {
  const fn = body('private onAudioBlock');
  assert.ok(/PRE_READY_MAX_SECONDS \* LIVE_SAMPLE_RATE/.test(fn));
  assert.ok(/this\.preReady\.shift\(\)/.test(fn),
    'the newest audio is the sentence still being spoken; drop the oldest');
  const cap = Number(/PRE_READY_MAX_SECONDS = (\d+)/.exec(client)[1]);
  assert.ok(cap >= 2 && cap <= 6, `${cap}s is outside a sane bound`);
});

test('held speech is flushed in order, before anything new, exactly once', () => {
  const fn = body('private async openLiveTranscription');
  const flush = fn.indexOf('for (const chunk of this.preReady)');
  const assign = fn.indexOf('this.live = live;');
  assert.ok(assign > 0 && flush > assign,
    'the socket must be assigned and drained in one synchronous run');
  assert.ok(/this\.preReady = \[\];/.test(fn), 'and emptied, so nothing is sent twice');
});

test('the resampler survives a rotation', () => {
  // It carries interpolation phase and the last sample; replacing it puts a
  // step into the waveform exactly where somebody is mid-word.
  const fn = body('private async openLiveTranscription');
  assert.ok(/if \(!this\.liveResampler\)/.test(fn), 'only created when there is none');
  const rot = body('private async rotateLive');
  assert.ok(!/this\.liveResampler = null/.test(rot), 'rotation must not discard it');
});

test('a socket that never opens releases the held audio and says so', () => {
  const fn = body('private async openLiveTranscription');
  assert.ok(/this\.dropPreReady\(\)/.test(fn));
  assert.ok(/droppedPreReadyBytes/.test(client),
    'audio let go has to be countable, or the next trace cannot prove it was zero');
});

test('the per-turn trace measures the turn, not the session', () => {
  // The first trace reported a running total and had to be differenced by
  // hand to see that about a second was being lost on every rotation.
  assert.ok(/this\.preReadyVoicedMs = 0;/.test(client), 'it must reset each turn');
  assert.ok(/voicedBeforeReadyMs: Math\.round\(this\.preReadyVoicedMs\)/.test(client));
});

// ── The deciding turn is not handed to a guess ────────────────────────────
//
// The baseline this regressed from (6a122459, worker 6680a4bc) configured
// chirp_3 with one language code and never asked it to detect. The socket
// layer then started sending `detect` on every session that had not yet
// locked a language -- which is every conversation's FIRST turn, the one that
// decides the language for all the rest. That is the turn "Abba" came from.

test('a new session configures the recogniser with its prior, not `auto`', () => {
  const open = body('private async openLiveTranscription');
  assert.match(open, /detect:\s*probing/,
    'the socket must ask for detection only when probing was earned');
  assert.doesNotMatch(open, /detect:\s*!this\.language\.locked/,
    'an unlocked session is a new session, and a new session must not use `auto`');
});

test('a probe is spent on one socket and not the next', () => {
  const open = body('private async openLiveTranscription');
  const set = open.indexOf('const probing = this.probeLanguageNext');
  const cleared = open.indexOf('this.probeLanguageNext = false');
  assert.ok(set > 0 && cleared > set,
    'the flag must be cleared as it is read, so `auto` cannot become the mode');
});

test('one weak token can never earn a probe, no matter how often', () => {
  const src = strip(client);
  const speech = /const SWITCH_PROBE_SPEECH_MS = (\d+)/.exec(src);
  const turns = /const SWITCH_PROBE_AFTER_TURNS = (\d+)/.exec(src);
  assert.ok(speech && turns, 'the probe thresholds must be named constants');
  // Above the longest end-of-turn window, so a short answer is never
  // "sustained" however many times it is given.
  const longest = Number(/const END_TURN_LONG_MS = (\d+)/.exec(src)?.[1] ?? 0);
  assert.ok(Number(speech[1]) >= longest,
    `a probe must need more speech (${speech[1]}ms) than the longest turn window (${longest}ms)`);
  assert.ok(Number(turns[1]) >= 2, 'one bad turn is not evidence');
});

test('the counter resets the moment a turn resolves', () => {
  const final = body('private async onLiveFinal');
  assert.match(final, /this\.weakTurns = sustained && unresolved \? this\.weakTurns \+ 1 : 0/,
    'weak turns must be consecutive, not cumulative -- a session that works '
    + 'occasionally must never accumulate its way into `auto`');
});

test('every probe is counted where a real device can report it', () => {
  assert.match(strip(client), /languageProbes/,
    'a probe that cannot be seen in a trace cannot be ruled out from one');
});
