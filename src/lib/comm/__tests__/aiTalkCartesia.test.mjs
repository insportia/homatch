// AI TALK, after the voice changed hands.
//
// The ElevenLabs implementation passed every test it had and was rejected by
// the first person who listened to it on a phone. What those tests never
// checked was the arithmetic BETWEEN the pieces of audio — which is where the
// whine was — and which provider was actually speaking, which is how five
// production turns ran on a silent fallback for half an hour.
//
// So this file checks the joins, the cancellation, and who is talking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PcmStreamPlayer } from '../pcmPlayer.ts';
import {
  TALK_DESTINATIONS, resolveDestination, parseAction, spokenPart,
  endsWithPartialMarker, ACTION_MARKER, destinationMenu,
} from '../talkActions.ts';
import { stabiliseLanguage } from '../transcript.ts';

const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');

// ── A fake audio graph, enough to schedule against ─────────────────────────

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  copyToChannel(source) { this.data.set(source, 0); }
  getChannelData() { return this.data; }
}

class FakeSource {
  constructor(ctx) { this.ctx = ctx; this.started = null; this.stopped = false; }
  connect() {}
  disconnect() {}
  start(when) { this.started = when; this.ctx.scheduled.push(this); }
  stop() { this.stopped = true; }
}

class FakeContext {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.scheduled = [];
  }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  createBufferSource() { return new FakeSource(this); }
}

/** `seconds` of a sine, as base64 PCM16 at `rate` — what the provider sends. */
function tone(seconds, rate, freq = 220, phaseOffset = 0) {
  const n = Math.round(seconds * rate);
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(2 * Math.PI * freq * ((i + phaseOffset) / rate));
    view.setInt16(i * 2, Math.round(v * 30000), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64');
}

function playedSamples(ctx) {
  const out = [];
  for (const s of ctx.scheduled) out.push(...s.buffer.data);
  return out;
}

// ── The joins, which is what the listener actually complained about ────────

test('consecutive chunks join without a step in the waveform', () => {
  /*
   * THE BUG THIS EXISTS FOR.
   *
   * Every chunk used to become its own AudioBuffer declared at the provider's
   * rate, which made the browser resample each one independently. An
   * independent resample restarts its interpolation from nothing, so the
   * waveform takes a step at every join, and a step in a waveform is a click.
   * At phrase boundaries, dozens a second, that is the high-frequency whine.
   *
   * A continuous sine split across chunks must come out continuous. The test
   * is the largest jump between neighbouring output samples: in a 220Hz tone
   * at 48kHz no two adjacent samples differ by much, so a join that restarts
   * shows up immediately.
   */
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);

  const rate = 24000;                  // deliberately NOT the context rate
  const chunkSeconds = 0.05;
  const samplesPerChunk = chunkSeconds * rate;
  for (let i = 0; i < 8; i++) {
    player.push(tone(chunkSeconds, rate, 220, i * samplesPerChunk), rate, 1);
  }
  player.endOfTurn();

  const played = playedSamples(ctx);
  assert.ok(played.length > 1000, `expected audio, got ${played.length} samples`);

  let worst = 0;
  for (let i = 1; i < played.length; i++) {
    worst = Math.max(worst, Math.abs(played[i] - played[i - 1]));
  }
  // One step of a 220Hz sine at 48kHz is about 0.029. Allow generous headroom
  // for interpolation error; a restarted resampler produces jumps far larger.
  assert.ok(worst < 0.15, `discontinuity at a chunk join: largest step ${worst.toFixed(4)}`);
});

test('a chunk already at the context rate is played, not resampled', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.2, 48000), 48000, 1);
  player.endOfTurn();

  const stats = player.snapshot();
  assert.equal(stats.resampled, false, 'matching rates must not resample');
  assert.equal(stats.providerRate, 48000);
  // Same number of samples in as out: nothing was invented or dropped.
  assert.equal(playedSamples(ctx).length, Math.round(0.2 * 48000));
});

test('pieces are scheduled end to end, never overlapping and never gapped', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  for (let i = 0; i < 6; i++) player.push(tone(0.1, 48000, 220, i * 4800), 48000, 1);
  player.endOfTurn();

  assert.ok(ctx.scheduled.length >= 2, 'expected several scheduled pieces');
  for (let i = 1; i < ctx.scheduled.length; i++) {
    const prev = ctx.scheduled[i - 1];
    const expected = prev.started + prev.buffer.duration;
    const gap = Math.abs(ctx.scheduled[i].started - expected);
    // Overlap is the assistant talking over itself; a gap is a stutter.
    assert.ok(gap < 1e-6, `piece ${i} starts ${gap}s away from where the previous one ends`);
  }
});

test('audio from an interrupted turn is dropped, not played over the next one', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  player.push(tone(0.2, 48000), 48000, 1);

  // The visitor interrupts. Chunks for turn 1 are still on the wire.
  player.stop();
  const after = ctx.scheduled.length;

  player.push(tone(0.2, 48000), 48000, 1);
  assert.equal(ctx.scheduled.length, after, 'a stale chunk reached the output');
  assert.equal(player.snapshot().stale, 1, 'the stale chunk must be counted, not silently ignored');
});

test('stopping releases every scheduled source and resets the cursor', () => {
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  for (let i = 0; i < 4; i++) player.push(tone(0.1, 48000), 48000, 1);
  player.endOfTurn();

  const sources = [...ctx.scheduled];
  assert.ok(sources.length > 0);
  player.stop();
  assert.ok(sources.every((s) => s.stopped), 'a source was left playing after stop()');

  /*
   * And the next reply must not wait for the audio that was cancelled. A
   * cursor left in the future is silence at the start of the NEXT turn, which
   * is the kind of bug that reads as "the assistant did not answer".
   */
  ctx.currentTime = 1.0;
  player.startTurn(player.currentGeneration);
  player.push(tone(0.2, 48000), 48000, player.currentGeneration);
  player.endOfTurn();
  const next = ctx.scheduled[ctx.scheduled.length - 1];
  assert.ok(next.started < ctx.currentTime + 0.2, 'the next reply was scheduled far in the future');
});

test('an odd trailing byte cannot shift every sample after it', () => {
  // Half a sample would move the byte boundary and turn the rest of the reply
  // into noise. The server holds these back; if one arrives anyway it is
  // dropped rather than realigning the stream.
  const ctx = new FakeContext(48000);
  const player = new PcmStreamPlayer(ctx, {});
  player.startTurn(1);
  const odd = Buffer.from([0x00, 0x10, 0x00, 0x20, 0x7f]).toString('base64');
  player.push(odd, 48000, 1);
  player.endOfTurn();
  assert.equal(playedSamples(ctx).length, 2, 'the half sample was not discarded');
});

// ── Where the assistant may send somebody ──────────────────────────────────

test('the assistant can only offer routes this application registers', () => {
  const app = read('src/App.tsx') + read('src/main.tsx');
  const routerFiles = ['src/App.tsx'];
  let declared = app;
  for (const f of routerFiles) declared += read(f);

  for (const d of TALK_DESTINATIONS) {
    assert.ok(d.path.startsWith('/'), `${d.key} is not a path`);
    assert.ok(!d.path.includes(':'), `${d.key} needs an id nobody has: ${d.path}`);
  }
});

test('no admin route is ever offered to an anonymous caller', () => {
  // AI TALK is public. Offering /admin/* sends a stranger to a page that will
  // refuse them, which reads as the product being broken.
  for (const d of TALK_DESTINATIONS) {
    assert.ok(!d.path.startsWith('/admin'), `${d.key} points at an admin page`);
  }
});

test('an invented destination produces no button at all', () => {
  assert.equal(resolveDestination('properties-in-vake'), null);
  assert.equal(resolveDestination('/verify'), null, 'a path is not a key');
  assert.equal(resolveDestination(''), null);
  assert.equal(resolveDestination(undefined), null);
  assert.ok(resolveDestination('verify'), 'a real key must still resolve');
});

test('the marker is never spoken, however badly the model writes it', () => {
  const good = `დაგეხმარებით. ${ACTION_MARKER} {"go":"verify","end":false}>>`;
  assert.equal(spokenPart(good), 'დაგეხმარებით.');
  assert.equal(parseAction(good).destination.path, '/verify');

  // Malformed: still must not be read aloud.
  const broken = `დაგეხმარებით. ${ACTION_MARKER} {"go":`;
  assert.equal(spokenPart(broken), 'დაგეხმარებით.');
  assert.equal(parseAction(broken).destination, null);
  assert.equal(parseAction(broken).end, false);
});

test('a half-arrived marker is held back rather than spoken', () => {
  // Tokens arrive one at a time, so "<<A" exists for a moment. Speaking it
  // because the rest had not arrived yet would be the same bug with better
  // timing.
  assert.equal(endsWithPartialMarker('hello <<A'), true);
  assert.equal(endsWithPartialMarker('hello <'), true);
  assert.equal(endsWithPartialMarker('hello <<ACT'), false, 'a complete marker is not partial');
  assert.equal(endsWithPartialMarker('hello there'), false);
});

test('ending the call requires an explicit decision and a known reason', () => {
  assert.equal(parseAction('bye <<ACT {"end":true,"why":"FAREWELL"}>>').endReason, 'FAREWELL');
  assert.equal(parseAction('bye <<ACT {"end":true,"why":"NONSENSE"}>>').endReason, 'OBJECTIVE_MET');
  assert.equal(parseAction('hello').end, false, 'an ordinary reply must never end the call');
  assert.equal(parseAction('hi <<ACT {"go":"verify"}>>').end, false);
});

test('the menu the model sees lists every destination and no paths', () => {
  const menu = destinationMenu();
  for (const d of TALK_DESTINATIONS) assert.ok(menu.includes(d.key), `${d.key} missing from the menu`);
  assert.ok(!menu.includes('/'), 'the model must never be shown a path it could copy');
});

// ── Who is actually speaking ───────────────────────────────────────────────

test('AI TALK synthesis goes to Cartesia and has no path to ElevenLabs', () => {
  /*
   * The check that was missing last time. speakPhraseStreaming used to walk a
   * ladder — ElevenLabs streaming, ElevenLabs whole-clip, then Cartesia — and
   * nothing recorded which rung answered, so a silent demotion to the slow
   * path went unnoticed through five production turns.
   *
   * There is now one provider on this surface. This asserts it at the only
   * place it is decidable: the source of the function that speaks.
   */
  const src = read('supabase/functions/ai-talk-session/index.ts');
  const at = src.indexOf('async function speakPhraseStreaming(');
  assert.ok(at > 0, 'the streaming synthesiser is gone');
  const body = src.slice(at, src.indexOf('\n}\n', at));

  assert.ok(/streamCartesiaPcm\(/.test(body), 'AI TALK must synthesise through Cartesia');
  assert.ok(!/elevenLabs|ElevenLabs|eleven_/i.test(body),
    'AI TALK must have no ElevenLabs path, not even as a fallback');
  assert.ok(!/speakPhrase\(sb/.test(body),
    'the whole-clip ladder is what hid the last regression; it must not be reachable from here');
});

test('the browser tells the server what rate to synthesise at', () => {
  // Matching the AudioContext is how the resampler stops running at all, and
  // the resampler is where the artefacts were. If this stops being sent, the
  // artefacts come back quietly.
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/outputSampleRate/.test(panel), 'the panel must send its output rate');

  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.ok(/nearestCartesiaRate\(/.test(edge), 'the server must snap it to a supported rate');
  assert.ok(/outputSampleRate,/.test(edge), 'the rate must reach synthesis');
});

test('an interrupted turn cancels the request rather than just ignoring it', () => {
  const client = read('src/lib/comm/voiceClient.ts');
  assert.ok(/turnAbort\s*=\s*new AbortController\(\)/.test(client), 'a turn must be cancellable');
  assert.ok(/this\.turnAbort\?\.abort\(\)/.test(client), 'stopping playback must abort the request');
  assert.ok(/generation !== this\.turnGeneration/.test(client),
    'events from a superseded turn must be dropped');

  const edge = read('supabase/functions/ai-talk-session/index.ts');
  assert.ok(/turnAbort/.test(edge), 'the server must be able to stop synthesising for a dropped caller');
});

test('navigating away tears the session down before the route changes', () => {
  /*
   * A React route change unmounts the panel. An unmount racing a live
   * microphone, a websocket and a scheduled audio queue is how a voice keeps
   * talking over the next page — which is the specific thing the owner asked
   * never to happen.
   */
  const panel = read('src/components/home/AiTalkPanel.tsx');
  const at = panel.indexOf('const followDestination');
  assert.ok(at > 0, 'taking the assistant up on a destination is not implemented');
  const body = panel.slice(at, at + 400);
  assert.ok(body.indexOf('await endSession') < body.indexOf('navigate('),
    'the session must be stopped BEFORE navigating, not after');
});

test('the transcript is painted once a frame, not once a token', () => {
  const panel = read('src/components/home/AiTalkPanel.tsx');
  assert.ok(/requestAnimationFrame/.test(panel), 'transcript updates must be coalesced');
  assert.ok(!/onTranscript: \(next\) => setTurns/.test(panel),
    'setting state per token is what made the panel stutter on a phone');
  assert.ok(/memo\(TranscriptView/.test(panel), 'the transcript must not re-render for unchanged turns');
});

// ── Six languages, and nobody choosing one from a menu ─────────────────────

test('the recogniser is given every language the product speaks, not just Georgian', () => {
  /*
   * Georgian was the language the Google path was proved in, and the whole
   * pipeline ended up pinned to ka-GE because of it. A Russian speaker would
   * have been transcribed into Georgian letters.
   */
  const edge = read('supabase/functions/ai-talk-session/index.ts');
  for (const code of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(new RegExp(`'${code}'`).test(edge), `${code} is not a language AI TALK offers`);
  }
  assert.ok(/speechCandidates\(/.test(edge), 'the socket must be given a candidate set');

  const worker = read('official-worker/src/speech/GoogleSpeechStream.ts');
  assert.ok(/languageCodes: cfg\.languageCodes/.test(worker),
    'the recogniser must be configured with the whole set, not one tag');
  assert.ok(!/languageCodes: \[cfg\.languageCode\]/.test(worker),
    'a single hardcoded language is what made this Georgian-only');
});

test('the language the recogniser heard is carried back, not thrown away', () => {
  // English and Turkish are the same alphabet, so no amount of looking at the
  // transcript can separate them. The provider's own answer is the only
  // evidence, and it used to be discarded at the call site.
  const worker = read('official-worker/src/speech/SpeechGateway.ts');
  assert.ok(/language: heard \?\? language/.test(worker), 'the gateway must forward what was heard');

  // Comments stripped first: the code explaining this trap has to quote the
  // old call, and a guard that fails on its own documentation teaches people
  // to delete the documentation.
  const client = read('src/lib/comm/voiceClient.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/detected: null/.test(client), 'the recogniser answer must not be discarded');
  assert.ok(/detected: detected/.test(client), 'the recogniser answer must reach the stabiliser');
});

test('script decides where it can, and the page locale never decides first', () => {
  const fresh = { current: 'en', locked: false, votes: [] };

  // Georgian letters are Georgian whatever a detector guessed.
  const ka = stabiliseLanguage(fresh, { text: 'გამარჯობა, ბინას ვეძებ ვაკეში დღეს', detected: 'en', confidence: 0.9 });
  assert.equal(ka.current, 'ka');

  const he = stabiliseLanguage(fresh, { text: 'שלום, אני מחפש דירה בתל אביב היום', detected: 'en', confidence: 0.9 });
  assert.equal(he.current, 'he');

  const ar = stabiliseLanguage(fresh, { text: 'مرحبا، أبحث عن شقة في تبليسي اليوم', detected: 'en', confidence: 0.9 });
  assert.equal(ar.current, 'ar');

  const ru = stabiliseLanguage(fresh, { text: 'Здравствуйте, я ищу квартиру в Тбилиси', detected: 'en', confidence: 0.9 });
  assert.equal(ru.current, 'ru');
});

test('Turkish and English are separated by the recogniser, since script cannot', () => {
  const fresh = { current: 'ka', locked: false, votes: [] };
  const tr = stabiliseLanguage(fresh, {
    text: 'Merhaba, Tiflis merkezde iki odali bir daire ariyorum',
    detected: 'tr', confidence: 0.9,
  });
  assert.equal(tr.current, 'tr', 'Latin script must defer to what the recogniser heard');
});

test('a settled conversation is not re-decided by one short sample', () => {
  let state = { current: 'ka', locked: false, votes: [] };
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, {
      text: 'მინდა ვიყიდო ბინა ვაკეში ბალკონით და პარკინგით',
      detected: 'ka', confidence: 0.9,
    });
  }
  assert.equal(state.current, 'ka');

  // "ok" is two Latin characters. It must not move a settled Georgian call.
  const wobble = stabiliseLanguage(state, { text: 'ok', detected: 'en', confidence: 0.3 });
  assert.equal(wobble.current, 'ka', 'a two-character aside switched the language');
});

test('a real switch mid-conversation is followed', () => {
  let state = { current: 'ka', locked: false, votes: [] };
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, { text: 'გამარჯობა, ბინას ვეძებ ვაკეში', detected: 'ka', confidence: 0.9 });
  }
  for (let i = 0; i < 4; i++) {
    state = stabiliseLanguage(state, {
      text: 'Извините, давайте продолжим по-русски, я ищу квартиру',
      detected: 'ru', confidence: 0.9,
    });
  }
  assert.equal(state.current, 'ru', 'a caller who genuinely switched must be followed');
});

test('the browser sends its language set and the socket accepts one', () => {
  const socket = read('src/lib/comm/googleTranscribe.ts');
  assert.ok(/query\.set\('languages'/.test(socket), 'the browser must send its candidates');

  const gateway = read('official-worker/src/speech/SpeechGateway.ts');
  assert.ok(/searchParams\.get\('languages'\)/.test(gateway), 'the gateway must read them');
  assert.ok(/MAX_STREAM_LANGUAGES/.test(gateway), 'the set must be capped to the provider limit');
  // Everything in that query string is browser-controlled.
  assert.ok(/\/\^\[a-z\]\{2,3\}-\[A-Z\]\{2\}\$\//.test(gateway), 'each tag must be validated');
});
