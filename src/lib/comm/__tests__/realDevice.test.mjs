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

// -- Speech during a socket rotation must be kept -------------------------
//
// THESE TESTS USED TO READ THE SOURCE OF onAudioBlock AND PASS.
//
// They passed on f6c82c55, which held twenty-one seconds of a real Android
// conversation and completed no turns at all. The branch was present and
// spelled exactly the way these assertions expected; what was wrong was what
// it DID, and no amount of reading it could show that.
//
// The behaviour now lives in LiveAudioRouter, which rotationGap.test.mjs
// drives for real -- rotations, deadlines, ordering and byte accounting. What
// is left here is the one thing source-reading is actually good for: proving
// the session still delegates to it, so the tested code is the shipped code.

test('the session routes its audio through the tested router, not its own copy', () => {
  const fn = body('private onAudioBlock');
  assert.match(fn, /this\.router\.route\(pcm, liveReady\)/,
    'onAudioBlock must not make this decision inline again');
  assert.doesNotMatch(fn, /this\.preReady\.push/,
    'a second, untested buffer inside the session is how the last one shipped');
});

test('audio is resampled exactly once, then routed', () => {
  const fn = body('private onAudioBlock');
  const converts = fn.match(/floatToPcm16\(/g) || [];
  assert.equal(converts.length, 1,
    'two conversion sites is two chances to send the same speech twice');
});

test('the socket is assigned and drained in one synchronous run', () => {
  const fn = body('private async openLiveTranscription');
  const assign = fn.indexOf('this.live = live;');
  const flush = fn.indexOf('this.router.ready()');
  assert.ok(assign > 0 && flush > assign,
    'so no block the microphone produces during the flush can overtake it');
});

test('the resampler survives a rotation', () => {
  // It carries interpolation phase and the last sample; replacing it puts a
  // step into the waveform exactly where somebody is mid-word.
  const fn = body('private async openLiveTranscription');
  assert.ok(/if \(!this\.liveResampler\)/.test(fn), 'only created when there is none');
  const rot = body('private async rotateLive');
  assert.ok(!/this\.liveResampler = null/.test(rot), 'rotation must not discard it');
});

test('every path that stops expecting a socket says so', () => {
  /*
   * The regression, named. `liveExpected` was set by rotateLive and then left
   * true by three separate returns: a failed grant, a socket that never
   * opened, and a provider that went away. Each one meant "fall back to
   * batch" and none of them could, because the hold branch still matched and
   * still returned first.
   */
  const open = body('private async openLiveTranscription');
  const returns = (open.match(/\s+return;/g) || []).length;
  const abandons = (open.match(/this\.abandonLive\(/g) || []).length;
  assert.ok(abandons >= 3,
    `openLiveTranscription has ${returns} early returns and only ${abandons} `
    + 'abandonLive calls; every exit without a socket must disarm the hold');
  const src = strip(client);
  assert.ok(/onUnavailable/.test(src) && /abandonLive\(reason\)/.test(src),
    'a provider that goes away mid-session must release the microphone too');
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

// ── Interrupting the assistant must not end the conversation ──────────────
//
// Measured in a real browser against a local build, with a microphone that
// talks over the reply the way a person does:
//
//   before   turn 1 completes, barge-in fires, and the session is gated for
//            good: panel reads LISTENING, socket READY, blocks arriving,
//            bytes sent frozen, no further turn ever
//   after    turns 1, 2 and 3 complete, with a barge-in in the middle that
//            the session recovers from
//
// setState does not lower the microphone gate. resumeListening is the only
// thing that does, which is why the interrupt path must call it.

test('barge-in hands the floor back, it does not merely relabel the state', () => {
  const src = strip(client);
  const at = src.indexOf("if (action === 'STOP')");
  assert.ok(at > 0, 'the barge-in stop branch is gone');
  const branch = src.slice(at, at + 700);
  assert.match(branch, /this\.resumeListening\(\)/,
    'stopping playback without ungating leaves the session deaf for ever');
  assert.doesNotMatch(branch, /setState\('LISTENING'\)/,
    'setState cannot lower the gate, so claiming LISTENING here is a lie');
});

test('a gate that outlives its reply is forced open and counted', () => {
  const src = strip(client);
  assert.match(src, /MIC_GATE_MAX_MS/,
    'every release path is a promise that can fail to settle; there must be a floor');
  assert.match(src, /gateReleases/,
    'and forcing it must be visible in a trace, not silent');
  const bound = Number(/const MIC_GATE_MAX_MS = ([0-9_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
  assert.ok(bound >= 8000 && bound <= 30000,
    `${bound}ms is either short enough to cut people off or long enough to be useless`);
});

test('the session never reports LISTENING while nothing can consume audio', () => {
  const src = strip(client);
  assert.match(src, /micGated: this\.micGated/,
    'a panel that cannot show why the microphone is idle cannot diagnose this');
  assert.match(src, /transcribing: this\.transcribing/);
});
